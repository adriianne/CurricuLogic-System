-- 033_department_own_program_only.sql
--
-- STATUS: APPLIED to the live database (2026-09-30).
--
-- WHY
--   A department account is tied to one programme (db/030), but its
--   policies only checked "is an approved department staff member", so a
--   BSN department account could read and change BSIT students, grades,
--   prospectus, subjects and schedules.
--
-- WHAT THIS CHANGES
--   Helpers:
--     my_department_program()         programme of the caller's approved
--                                     department account, else null
--     is_department_of_student(uuid)  that student is in the caller's programme
--   Department policies now require the row to belong to that programme:
--     prospectus, section              program_id
--     subject, elective_group          via prospectus
--     prerequisite, subject_offering,
--     elective_group_member            via subject / elective_group
--     academic_record                  via the student
--     university_student               read and approve, via the student
--     grade_file, grade_file_row       uploaded_by = the caller (no programme
--                                      column exists on these)
--   A department account with no programme now has no access at all.
--   Registrar is NOT changed by this migration.
--
-- ROLLBACK
--   Recreate each policy below with its old expression:
--     exists (select 1 from department_staff
--             where user_id = auth.uid() and is_approved)
--   and restore "staff read own-programme students" to
--     can_read_all_students() or is_adviser_of_student(id)
--   and "registrar_approves_students" to registrar OR any approved department.

create or replace function public.my_department_program()
returns integer
language sql stable security definer
set search_path to 'public'
as $$
    select program_id from department_staff
    where user_id = auth.uid() and is_approved
    limit 1;
$$;

create or replace function public.is_department_of_student(p_student_id uuid)
returns boolean
language sql stable security definer
set search_path to 'public'
as $$
    select exists (
        select 1 from university_student s
        where s.id = p_student_id
          and s.program_id is not null
          and s.program_id = my_department_program()
    );
$$;

-- Department no longer reads every student through this helper; it gets its
-- own programme via is_department_of_student below.
create or replace function public.can_read_all_students()
returns boolean
language sql stable security definer
set search_path to 'public'
as $$
    select
        exists (select 1 from registrar_staff      where user_id = auth.uid() and is_approved)
     or exists (select 1 from system_administrator where user_id = auth.uid() and is_approved);
$$;

-- prospectus, section
drop policy if exists "department_manage_prospectus" on public.prospectus;
create policy "department_manage_prospectus" on public.prospectus for all to authenticated
    using (program_id = my_department_program())
    with check (program_id = my_department_program());

drop policy if exists "department_manage_sections" on public.section;
create policy "department_manage_sections" on public.section for all to authenticated
    using (program_id = my_department_program())
    with check (program_id = my_department_program());

-- subject, elective_group: through the prospectus
drop policy if exists "department_manage_subjects" on public.subject;
create policy "department_manage_subjects" on public.subject for all to authenticated
    using (prospectus_id in (select id from prospectus where program_id = my_department_program()))
    with check (prospectus_id in (select id from prospectus where program_id = my_department_program()));

drop policy if exists "department_manage_elective_groups" on public.elective_group;
create policy "department_manage_elective_groups" on public.elective_group for all to authenticated
    using (prospectus_id in (select id from prospectus where program_id = my_department_program()))
    with check (prospectus_id in (select id from prospectus where program_id = my_department_program()));

-- prerequisite, subject_offering, elective_group_member: through the subject / group
drop policy if exists "department_manage_prerequisites" on public.prerequisite;
create policy "department_manage_prerequisites" on public.prerequisite for all to authenticated
    using (subject_id in (select s.id from subject s join prospectus p on p.id = s.prospectus_id
                          where p.program_id = my_department_program()))
    with check (subject_id in (select s.id from subject s join prospectus p on p.id = s.prospectus_id
                               where p.program_id = my_department_program()));

drop policy if exists "department_manage_offerings" on public.subject_offering;
create policy "department_manage_offerings" on public.subject_offering for all to authenticated
    using (subject_id in (select s.id from subject s join prospectus p on p.id = s.prospectus_id
                          where p.program_id = my_department_program()))
    with check (subject_id in (select s.id from subject s join prospectus p on p.id = s.prospectus_id
                               where p.program_id = my_department_program()));

drop policy if exists "department_manage_elective_members" on public.elective_group_member;
create policy "department_manage_elective_members" on public.elective_group_member for all to authenticated
    using (elective_group_id in (select g.id from elective_group g join prospectus p on p.id = g.prospectus_id
                                 where p.program_id = my_department_program()))
    with check (elective_group_id in (select g.id from elective_group g join prospectus p on p.id = g.prospectus_id
                                      where p.program_id = my_department_program()));

-- students and their grades
drop policy if exists "department_writes_records" on public.academic_record;
create policy "department_writes_records" on public.academic_record for all to authenticated
    using (is_department_of_student(student_id))
    with check (is_department_of_student(student_id));

drop policy if exists "staff read own-programme students" on public.university_student;
create policy "staff read own-programme students" on public.university_student for select to authenticated
    using (can_read_all_students() or is_adviser_of_student(id) or is_department_of_student(id));

drop policy if exists "registrar_approves_students" on public.university_student;
create policy "registrar_approves_students" on public.university_student for update to authenticated
    using (
        exists (select 1 from registrar_staff where user_id = auth.uid() and is_approved)
        or is_department_of_student(id)
    )
    with check (
        exists (select 1 from registrar_staff where user_id = auth.uid() and is_approved)
        or is_department_of_student(id)
    );

-- grade uploads have no programme column: scope to the uploader.
-- grade_file.uploaded_by holds department_staff.id, not the login id.
create or replace function public.my_department_staff_id()
returns uuid
language sql stable security definer
set search_path to 'public'
as $$
    select id from department_staff where user_id = auth.uid() and is_approved limit 1;
$$;

drop policy if exists "department_manage_grade_files" on public.grade_file;
create policy "department_manage_grade_files" on public.grade_file for all to authenticated
    using (uploaded_by = my_department_staff_id())
    with check (uploaded_by = my_department_staff_id());

drop policy if exists "department_manage_grade_rows" on public.grade_file_row;
create policy "department_manage_grade_rows" on public.grade_file_row for all to authenticated
    using (grade_file_id in (select id from grade_file where uploaded_by = my_department_staff_id()))
    with check (grade_file_id in (select id from grade_file where uploaded_by = my_department_staff_id()));
