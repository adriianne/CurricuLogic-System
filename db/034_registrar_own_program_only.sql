-- 034_registrar_own_program_only.sql
--
-- STATUS: APPLIED to the live database (2026-09-30).
--
-- WHY
--   Same gap as db/032 (faculty) and db/033 (department), for the registrar:
--   every registrar account could read and change every programme's
--   students, requests, enrollments and advisee assignments. A registrar
--   account belongs to one programme (db/030).
--
-- WHAT THIS CHANGES
--   Helpers:
--     my_registrar_program()          programme of the caller's approved
--                                     registrar account
--     is_registrar_of_student(uuid)   student is in that programme, OR has no
--                                     programme yet (a self-registered
--                                     student who chose "to be confirmed by
--                                     the Registrar" must still be reachable)
--     can_see_student(uuid)           admin, the student's faculty, department
--                                     or registrar
--   can_read_all_students() is now administrators only.
--   Registrar policies now require the student to be theirs:
--     university_student (read, approve), academic_record (read), request,
--     request_item, request_review, enrollment, enrollment_item,
--     advisee_assignment
--   grade_file / grade_file_row (registrar read): only files uploaded by the
--     department account of the registrar's programme.
--   Also closes two reads that used is_approved_staff() and so let faculty of
--   any programme see them: ai_recommendation and advisee_assignment.
--
-- ROLLBACK
--   Recreate each policy with its old expression (registrar: exists (select 1
--   from registrar_staff where user_id = auth.uid() and is_approved);
--   ai_recommendation / advisee_assignment read: is_approved_staff()), and
--   restore can_read_all_students() to registrar + department + admin.

create or replace function public.my_registrar_program()
returns integer language sql stable security definer set search_path to 'public'
as $$ select program_id from registrar_staff where user_id = auth.uid() and is_approved limit 1; $$;

create or replace function public.is_registrar_of_student(p_student_id uuid)
returns boolean language sql stable security definer set search_path to 'public'
as $$
    select exists (
        select 1 from registrar_staff r, university_student s
        where r.user_id = auth.uid() and r.is_approved
          and s.id = p_student_id
          and (s.program_id is null or s.program_id = r.program_id)
    );
$$;

create or replace function public.can_read_all_students()
returns boolean language sql stable security definer set search_path to 'public'
as $$ select exists (select 1 from system_administrator where user_id = auth.uid() and is_approved); $$;

create or replace function public.can_see_student(p_student_id uuid)
returns boolean language sql stable security definer set search_path to 'public'
as $$
    select can_read_all_students()
        or is_adviser_of_student(p_student_id)
        or is_department_of_student(p_student_id)
        or is_registrar_of_student(p_student_id);
$$;

-- students
drop policy if exists "staff read own-programme students" on public.university_student;
create policy "staff read own-programme students" on public.university_student for select to authenticated
    using (can_see_student(id));

drop policy if exists "registrar_approves_students" on public.university_student;
create policy "registrar_approves_students" on public.university_student for update to authenticated
    using (is_registrar_of_student(id) or is_department_of_student(id))
    with check (is_registrar_of_student(id) or is_department_of_student(id));

drop policy if exists "staff read own-programme records" on public.academic_record;
create policy "staff read own-programme records" on public.academic_record for select to authenticated
    using (can_see_student(student_id));

-- advising requests
drop policy if exists "registrar_read_all_requests" on public.request;
create policy "registrar_read_all_requests" on public.request for select to authenticated
    using (is_registrar_of_student(student_id));

drop policy if exists "registrar_update_requests" on public.request;
create policy "registrar_update_requests" on public.request for update to authenticated
    using (is_registrar_of_student(student_id))
    with check (is_registrar_of_student(student_id));

drop policy if exists "registrar_read_all_request_items" on public.request_item;
create policy "registrar_read_all_request_items" on public.request_item for select to authenticated
    using (exists (select 1 from request r where r.id = request_item.request_id
                   and is_registrar_of_student(r.student_id)));

drop policy if exists "registrar reads all reviews" on public.request_review;
create policy "registrar reads all reviews" on public.request_review for select to public
    using (exists (select 1 from request r where r.id = request_review.request_id
                   and is_registrar_of_student(r.student_id)));

-- enrollment
drop policy if exists "registrar_manage_enrollment" on public.enrollment;
create policy "registrar_manage_enrollment" on public.enrollment for all to authenticated
    using (is_registrar_of_student(student_id)) with check (is_registrar_of_student(student_id));

drop policy if exists "registrar_manage_enrollment_item" on public.enrollment_item;
create policy "registrar_manage_enrollment_item" on public.enrollment_item for all to authenticated
    using (exists (select 1 from enrollment e where e.id = enrollment_item.enrollment_id
                   and is_registrar_of_student(e.student_id)))
    with check (exists (select 1 from enrollment e where e.id = enrollment_item.enrollment_id
                        and is_registrar_of_student(e.student_id)));

-- advisee assignments and AI recommendations
drop policy if exists "registrar manages advisee assignments" on public.advisee_assignment;
create policy "registrar manages advisee assignments" on public.advisee_assignment for all to authenticated
    using (is_registrar_of_student(student_id)) with check (is_registrar_of_student(student_id));

drop policy if exists "staff read assignments" on public.advisee_assignment;
create policy "staff read assignments" on public.advisee_assignment for select to authenticated
    using (can_see_student(student_id));

drop policy if exists "staff_read_all_recommendations" on public.ai_recommendation;
create policy "staff_read_all_recommendations" on public.ai_recommendation for select to authenticated
    using (can_see_student(student_id));

-- grade uploads the registrar may read: those of their programme's department.
-- A helper, because a registrar cannot read department_staff directly.
create or replace function public.department_ids_for_my_registrar()
returns setof uuid language sql stable security definer set search_path to 'public'
as $$ select id from department_staff where program_id = my_registrar_program(); $$;

drop policy if exists "registrar_reads_grade_files" on public.grade_file;
create policy "registrar_reads_grade_files" on public.grade_file for select to authenticated
    using (uploaded_by in (select department_ids_for_my_registrar()));

drop policy if exists "registrar_reads_grade_rows" on public.grade_file_row;
create policy "registrar_reads_grade_rows" on public.grade_file_row for select to authenticated
    using (grade_file_id in (select id from grade_file
                             where uploaded_by in (select department_ids_for_my_registrar())));
