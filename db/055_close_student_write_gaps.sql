-- 055_close_student_write_gaps.sql
--
-- Found while reading the 2026-10-04 schema snapshot, and confirmed with a
-- rolled-back test as a signed-in student:
--
--   1. A student could INSERT / UPDATE / DELETE their own academic_record rows,
--      e.g. add a PASSED grade for any subject. The app never does this: grade
--      entry was removed from the student view (see db/013) and grades arrive
--      through the Department Staff's validated grade-file upload. The three
--      student write policies are simply dropped; students keep read access.
--
--   2. A student could INSERT a request that is already 'approved' (and with
--      registrar_status 'approved'), because the policy only checked student_id.
--      Requests are created by the submit-advising-request function, which
--      inserts status 'submitted' as the signed-in student. The policy now allows
--      exactly that and nothing else.
--
--   3. faculty_read_enrollment / faculty_read_enrollment_item let ANY approved
--      faculty member read every enrollment in every programme. They are limited
--      to the faculty member's own programme's students, as the other faculty
--      policies already are (is_adviser_of_student).
--
-- Safe to re-run.

-- 1 -------------------------------------------------------------------------
drop policy if exists students_insert_own_records on public.academic_record;
drop policy if exists students_update_own_records on public.academic_record;
drop policy if exists students_delete_own_records on public.academic_record;

-- Belt and braces: the table grants too (students are 'authenticated', which
-- also covers staff, whose own policies are separate; revoking here would break
-- them, so the policies above are the control).

-- 2 -------------------------------------------------------------------------
drop policy if exists students_create_own_requests on public.request;
create policy students_create_own_requests on public.request
  as permissive for insert to authenticated
  with check (
    student_id = current_student_id()
    and status = 'submitted'
    and registrar_status is null
    and registrar_id is null
    and registrar_reviewed_at is null
    and registrar_notes is null
  );

-- request_item: a student may add items only to their own request while it is
-- still 'submitted', and may not pre-approve an item.
drop policy if exists "students insert own request items" on public.request_item;
create policy "students insert own request items" on public.request_item
  as permissive for insert to authenticated
  with check (
    status in ('valid', 'flagged', 'pending')
    and exists (
      select 1
      from request r
      join university_student s on s.id = r.student_id
      where r.id = request_item.request_id
        and s.user_id = auth.uid()
        and r.status = 'submitted'
    )
  );

-- 3 -------------------------------------------------------------------------
drop policy if exists faculty_read_enrollment on public.enrollment;
create policy faculty_read_enrollment on public.enrollment
  as permissive for select to authenticated
  using (is_adviser_of_student(student_id));

drop policy if exists faculty_read_enrollment_item on public.enrollment_item;
create policy faculty_read_enrollment_item on public.enrollment_item
  as permissive for select to authenticated
  using (
    exists (
      select 1 from enrollment e
      where e.id = enrollment_item.enrollment_id
        and is_adviser_of_student(e.student_id)
    )
  );
