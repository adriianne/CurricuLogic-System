-- 032_faculty_sees_own_program_only.sql
--
-- STATUS: APPLIED to the live database (2026-09-30).
--
-- WHY
--   "staff read all students" and "staff read all records" were granted to
--   is_approved_staff(), which is true for faculty too. A BSN faculty
--   member therefore saw every BSIT student and their grades. Faculty must
--   see only the students of their own programme.
--
-- WHAT THIS CHANGES
--   1. can_read_all_students(): registrar, department and admin only.
--   2. university_student and academic_record: SELECT is allowed for those
--      roles, or for a faculty member whose programme matches the student's
--      (is_adviser_of_student, from db/030). A faculty member with no
--      programme sees no students.
--   Registrar and department are NOT narrowed here.
--
-- ROLLBACK
--   drop policy "staff read own-programme students" on university_student;
--   drop policy "staff read own-programme records" on academic_record;
--   create policy "staff read all students" on university_student
--     for select to authenticated using (is_approved_staff());
--   create policy "staff_read_all_records" on academic_record
--     for select to authenticated using (is_approved_staff());
--   drop function can_read_all_students();

create or replace function public.can_read_all_students()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
    select
        exists (select 1 from registrar_staff      where user_id = auth.uid() and is_approved)
     or exists (select 1 from department_staff     where user_id = auth.uid() and is_approved)
     or exists (select 1 from system_administrator where user_id = auth.uid() and is_approved);
$$;

drop policy if exists "staff read all students" on public.university_student;
create policy "staff read own-programme students"
    on public.university_student for select
    to authenticated
    using (can_read_all_students() or is_adviser_of_student(id));

drop policy if exists "staff_read_all_records" on public.academic_record;
create policy "staff read own-programme records"
    on public.academic_record for select
    to authenticated
    using (can_read_all_students() or is_adviser_of_student(student_id));
