-- 096_auto_verify_record.sql
--
-- The Registrar no longer verifies a student's record by hand. The flag record_verified (which the
-- assess-student and submit-advising-request functions and the pages already read) is now set by the database:
--
--   * a FIRST-YEAR (or a student with no year level) is marked verified the moment the account is approved.
--     The EDP list decided who may register, and an empty record is correct for a first-year.
--   * a student ABOVE first year is marked verified when the first grade is uploaded for them (the Department's
--     grade upload writes academic_record). Until then they have no history, and recommending subjects from an
--     empty record would wrongly look like "passed nothing", so recommendations and plans wait.
--
-- verified_by stays empty, to show that nobody pressed a button. The Registrar can still look a record up.
--
-- TO UNDO: drop triggers student_register_zzverify (on university_student) and academic_record_autoverify
-- (on academic_record), drop the two functions, and restore the policy anon_can_request_account to its db/095
-- form: with check (record_verified = false and (is_approved = false or (created_via = 'SELF_REGISTER'
-- and approval_status = 'approved' and reviewed_by is null))). Accounts already marked verified stay verified.
--
-- Safe to re-run.

-- 1. When an account is approved (insert, or approval of an older request): first-years are verified at once.
create or replace function public.student_autoverify()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
    if new.is_approved is true and new.record_verified is not true
       and (coalesce(new.year_level, 1) <= 1
            or exists (select 1 from public.academic_record r where r.student_id = new.id)) then
        new.record_verified := true;
        new.verified_at := coalesce(new.verified_at, now());
    end if;
    return new;
end;
$$;

revoke all on function public.student_autoverify() from public, anon, authenticated;

-- Named so that it sorts after student_register_zautoapprove (BEFORE triggers run by name).
drop trigger if exists student_register_zzverify on public.university_student;
create trigger student_register_zzverify
    before insert or update of is_approved on public.university_student
    for each row execute function public.student_autoverify();

-- 2. When a grade is saved for an approved student, they are verified (this is what releases an upper-year student).
create or replace function public.academic_record_autoverify()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    update public.university_student
       set record_verified = true,
           verified_at = coalesce(verified_at, now())
     where id = new.student_id and is_approved is true and record_verified is not true;
    return null;
end;
$$;

revoke all on function public.academic_record_autoverify() from public, anon, authenticated;

drop trigger if exists academic_record_autoverify on public.academic_record;
create trigger academic_record_autoverify
    after insert on public.academic_record
    for each row execute function public.academic_record_autoverify();

-- 3. The insert policy is checked AFTER the triggers: a self-registration approved by the EDP list can arrive
--    verified (a first-year). A client still cannot send an approved or verified row itself:
--    student_register_guard (046) refuses that first.
drop policy if exists anon_can_request_account on public.university_student;
create policy anon_can_request_account on public.university_student
    for insert to anon, authenticated
    with check (
        (is_approved = false and record_verified = false)
        or (created_via = 'SELF_REGISTER' and approval_status = 'approved' and reviewed_by is null)
    );

-- 4. Accounts that are already approved are brought in line with the rule, but only the ones that nobody
--    verified by hand (verified_by is empty): approved first-years and students with grades are verified;
--    an upper-year student with no grades waits for the Department's upload.
update public.university_student s
   set record_verified = (coalesce(s.year_level, 1) <= 1
                          or exists (select 1 from public.academic_record r where r.student_id = s.id)),
       verified_at = case when (coalesce(s.year_level, 1) <= 1
                                or exists (select 1 from public.academic_record r where r.student_id = s.id))
                          then coalesce(s.verified_at, now()) else null end
 where s.is_approved is true and s.verified_by is null;
