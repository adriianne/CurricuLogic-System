-- 095_auto_approve_edp_match.sql
--
-- The EDP student list now decides who may have an account. The Registrar no longer approves new accounts.
--
-- Before: a student registers, the request waits as "pending", and the Registrar approves or declines it.
-- Now: when a student registers, the database checks the details against the EDP list (db/084):
--   * the details match a listed student AND the e-mail is the one the EDP office has on file
--       -> the account is approved at once, with the listed student ID, year level and the active
--          curriculum of the programme. The student still has to confirm the e-mail (the link that
--          Supabase sends), so the address is proven to be theirs before they can sign in.
--   * the details do not match -> the registration is refused with a plain message.
--   * no list has been uploaded yet -> the registration is refused ("not open yet"); the Admin can
--     still create accounts by hand or from the list.
--
-- Why the e-mail must match: the "I already have a record" path lets a person type any student ID.
-- Matching the ID alone would let anyone take another student's account. The e-mail on the list, plus
-- the confirmation link, is what shows that the person is who the list says.
--
-- What does NOT change: the Registrar still verifies the academic record of a student (record_verified)
-- and still sees the approved plans. Accounts made by the Admin (created_via other than SELF_REGISTER)
-- are untouched. The existing guards (046, 093) still run first and still refuse a client that tries
-- to send an approved row itself.
--
-- Order of the BEFORE INSERT triggers (Postgres runs them by name): student_id_on_register,
-- student_register_guard, student_register_name_guard, then student_register_zautoapprove (this file).
--
-- TO UNDO: drop trigger student_register_zautoapprove; drop the two functions below; restore the policy
-- anon_can_request_account to: with check (is_approved = false and record_verified = false).
-- Accounts already approved by this trigger stay approved.
--
-- Safe to re-run.

-- ---------------------------------------------------------------------
-- 1. Lets the Register page ask "does this match the EDP list?" before anything is created.
--    Same idea as check_expected_student (085), but the e-mail must match too.
--    Answers with one word, never a row:  'match' | 'no_match' | 'no_list'
-- ---------------------------------------------------------------------
create or replace function public.check_registration_match(
    p_student_id text,
    p_first_name text,
    p_last_name  text,
    p_program_id integer,
    p_email      text
)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    v_id    text := nullif(btrim(coalesce(p_student_id, '')), '');
    v_match boolean;
begin
    if not exists (select 1 from public.expected_student) then
        return 'no_list';
    end if;

    select exists (
        select 1 from public.expected_student e
        where p_program_id is not null
          and e.program_id = p_program_id
          and lower(btrim(e.email)) = lower(btrim(coalesce(p_email, '')))
          and (
                (v_id is not null and e.student_id = v_id)
             or (v_id is null
                 and public._norm_name(e.first_name) = public._norm_name(p_first_name)
                 and public._norm_name(e.last_name)  = public._norm_name(p_last_name))
          )
    ) into v_match;

    return case when v_match then 'match' else 'no_match' end;
end;
$$;

revoke all on function public.check_registration_match(text, text, text, integer, text) from public;
grant execute on function public.check_registration_match(text, text, text, integer, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. The trigger: decides a self-registration at the moment it is saved.
--    SECURITY DEFINER so it can read the EDP list (admin only) and set the approved fields.
--    It acts only on a plain self-registration (created_via = SELF_REGISTER, still pending); the
--    Admin's own path inserts rows that are approved already and is returned untouched.
-- ---------------------------------------------------------------------
create or replace function public.student_register_autoapprove()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    e      public.expected_student%rowtype;
    v_n    integer;
    v_pros integer;
begin
    if new.created_via is distinct from 'SELF_REGISTER'
       or new.is_approved is true
       or new.approval_status is distinct from 'pending' then
        return new;
    end if;

    if not exists (select 1 from public.expected_student) then
        raise exception 'Registration is not open yet. Please contact the EDP office.' using errcode = '42501';
    end if;

    select count(*) into v_n
    from public.expected_student x
    where new.program_id is not null
      and x.program_id = new.program_id
      and lower(btrim(x.email)) = lower(btrim(coalesce(new.email, '')))
      and (
            (new.declared_path = 'existing' and new.student_id is not null and x.student_id = new.student_id)
         or (new.declared_path = 'new'
             and public._norm_name(x.first_name) = public._norm_name(new.first_name)
             and public._norm_name(x.last_name)  = public._norm_name(new.last_name))
      );

    if v_n <> 1 then
        raise exception 'These details do not match the EDP student list. Check your name, student ID, degree program and e-mail, or contact the EDP office.'
            using errcode = '42501';
    end if;

    select x.* into e
    from public.expected_student x
    where x.program_id = new.program_id
      and lower(btrim(x.email)) = lower(btrim(coalesce(new.email, '')))
      and (
            (new.declared_path = 'existing' and x.student_id = new.student_id)
         or (new.declared_path = 'new'
             and public._norm_name(x.first_name) = public._norm_name(new.first_name)
             and public._norm_name(x.last_name)  = public._norm_name(new.last_name))
      )
    limit 1;

    if exists (select 1 from public.university_student s where s.student_id = e.student_id) then
        raise exception 'This student already has an account. Log in, or use "Forgot password?".'
            using errcode = '42501';
    end if;

    select pr.id into v_pros
    from public.prospectus pr
    where pr.program_id = e.program_id and pr.is_active
    limit 1;

    new.student_id      := e.student_id;
    new.first_name      := coalesce(new.first_name, e.first_name);
    new.last_name       := coalesce(new.last_name,  e.last_name);
    new.year_level      := e.year_level;
    new.prospectus_id   := v_pros;
    new.is_approved     := true;
    new.approval_status := 'approved';
    new.reviewed_at     := now();
    new.review_note     := 'Matched the EDP student list';
    return new;
end;
$$;

revoke all on function public.student_register_autoapprove() from public, anon, authenticated;

drop trigger if exists student_register_zautoapprove on public.university_student;
create trigger student_register_zautoapprove
    before insert on public.university_student
    for each row execute function public.student_register_autoapprove();

-- ---------------------------------------------------------------------
-- 3. The insert policy is checked AFTER the triggers, so it has to allow the row the trigger approved.
--    A client still cannot send an approved row itself: student_register_guard (046) refuses that first.
-- ---------------------------------------------------------------------
drop policy if exists anon_can_request_account on public.university_student;
create policy anon_can_request_account on public.university_student
    for insert to anon, authenticated
    with check (
        record_verified = false
        and (
            is_approved = false
            or (created_via = 'SELF_REGISTER' and approval_status = 'approved' and reviewed_by is null)
        )
    );
