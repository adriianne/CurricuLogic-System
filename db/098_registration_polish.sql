-- 098_registration_polish.sql
--
-- Three small fixes found while checking account creation before the demo (6 Nov 2026).
--
-- 1. The OFFICIAL name is kept. A student on the "new" path who typed "juan dela cruz" got an approved account
--    saved in lower case (it showed that way in lists and on the printed form). The trigger of db/095 now takes
--    the first and last name from the EDP list row it matched, so the account carries the official spelling.
--    (A middle name is optional and is kept as typed.)
--
-- 2. More letters are folded when names are compared. _norm_name already ignored case, extra spaces and the common
--    accents (ñ á é í ó ú ...). It now also folds ã õ ç å ý ÿ š ž č ř ł and friends, so "Muñoz" / "Munoz" or
--    "João" / "Joao" match.
--
-- 3. The same-name block no longer applies once an EDP list is in use. Two different students can share a name;
--    what identifies a student is the listed row (ID or name, programme AND the e-mail on file), and the trigger
--    of db/095 already refuses a second account for the same listed student. With no list uploaded, registration
--    is refused anyway ("not open yet"). The rule still works as before if the list is ever empty.
--
-- TO UNDO: re-run db/093 (name_already_registered) and db/095 (student_register_autoapprove) and restore
-- _norm_name from db/084. Accounts already created are not changed.
--
-- Safe to re-run.

-- 2. Name comparison.
create or replace function public._norm_name(p text)
returns text
language sql
immutable
as $$
  select regexp_replace(
           translate(lower(btrim(coalesce(p, ''))),
                     'ñáàâäãåéèêëíìîïóòôöõøúùûüýÿçšžčřłśźżňďťěůğ',
                     'naaaaaaeeeeiiiioooooouuuuyycszcrlszzndteug'),
           '\s+', ' ', 'g');
$$;

-- 3. The same-name block steps aside while an EDP list is in use.
create or replace function public.name_already_registered(p_first_name text, p_last_name text, p_middle_name text default null)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select not exists (select 1 from public.expected_student)
     and public._norm_name(p_first_name) <> ''
     and public._norm_name(p_last_name)  <> ''
     and exists (
       select 1 from public.university_student s
       where public._norm_name(s.first_name)  = public._norm_name(p_first_name)
         and public._norm_name(s.last_name)   = public._norm_name(p_last_name)
         and public._norm_name(s.middle_name) = public._norm_name(p_middle_name)
         and coalesce(s.approval_status, 'pending') <> 'declined'
     );
$$;

-- 1. The approved account carries the official name from the list.
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
    new.first_name      := e.first_name;     -- the official spelling, not what was typed
    new.last_name       := e.last_name;
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
