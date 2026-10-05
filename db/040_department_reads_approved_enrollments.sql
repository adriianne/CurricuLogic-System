-- 040_department_reads_approved_enrollments.sql
--
-- Lets a department read the APPROVED enrollment requests of its own
-- programme's students, and nothing else.
--
-- WHY
--   The Grade upload can give a department a class list for one subject:
--   the students whose enrollment in it was approved, ready for the grades to
--   be filled in. An approved request (request.registrar_status = 'approved',
--   with its request_item rows) is the system's record of who is taking what;
--   the enrollment / enrollment_item tables exist but nothing writes to them.
--   Until now only the student, their adviser and the Registrar could read
--   requests, so a department saw an empty list.
--
-- WHAT IT ALLOWS
--   A department_staff account may SELECT
--     - request rows that the Registrar approved, for students of its own
--       programme (is_department_of_student, from db/033)
--     - the request_item rows of those requests
--   It cannot read requests still under review, requests that were sent
--   back, or any other programme's requests. It still cannot change any.
--
-- TO APPLY: run this file in the Supabase SQL editor.
-- TO UNDO:
--   drop policy "department reads approved enrollment requests" on public.request;
--   drop policy "department reads approved enrollment items" on public.request_item;

create policy "department reads approved enrollment requests"
    on public.request
    for select
    to authenticated
    using (
        registrar_status = 'approved'
        and public.is_department_of_student(student_id)
    );

create policy "department reads approved enrollment items"
    on public.request_item
    for select
    to authenticated
    using (
        exists (
            select 1
            from public.request r
            where r.id = request_item.request_id
              and r.registrar_status = 'approved'
              and public.is_department_of_student(r.student_id)
        )
    );
