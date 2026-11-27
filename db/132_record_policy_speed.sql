-- 132_record_policy_speed.sql
--
-- STATUS: APPLIED to the live database on 25 Nov 2026 (owner said yes). Verified: the same query went from 10,794 ms to 817 ms, and the phone shows the record.
--
-- WHY
--   The Android app's Academic record said "Could not load your academic record" for every student. The server
--   answered HTTP 500 / PostgREST error 57014 (statement timeout) after about 8 seconds.
--   Cause: the app reads academic_record without a student filter ("row-level security limits it to theirs"). The three
--   policies on the table are OR-ed, and Postgres checked can_see_student() and is_department_of_student() for EVERY row
--   (4,202 rows since the 3,152 grade rows were uploaded on 24 Nov), about 2.5 ms each:
--       student 24001188, 16 rows of their own: Execution Time 10,794 ms   (Filter: student_id = current_student_id()
--       OR can_see_student(student_id) OR is_department_of_student(student_id), 4,186 rows removed, 78,772 buffers).
--
-- WHAT THIS CHANGES (who may see or write what is UNCHANGED)
--   * the staff policies run their per-row checks only when the caller is an approved staff member: the cheap test
--     (select is_approved_staff()) is read once per query and, for a student, is false, so the per-row functions are
--     never called;
--   * "is this my row" reads current_student_id() once per query instead of once per row.
--   No data is touched. Three ALTER POLICY statements.
--
-- ROLLBACK (the policies as they were):
--   alter policy "students_read_own_records" on public.academic_record using (student_id = current_student_id());
--   alter policy "staff read own-programme records" on public.academic_record using (can_see_student(student_id));
--   alter policy "department_writes_records" on public.academic_record
--       using (is_department_of_student(student_id)) with check (is_department_of_student(student_id));

alter policy "students_read_own_records" on public.academic_record
    using (student_id = (select public.current_student_id()));

alter policy "staff read own-programme records" on public.academic_record
    using ((select public.is_approved_staff()) and public.can_see_student(student_id));

alter policy "department_writes_records" on public.academic_record
    using ((select public.is_approved_staff()) and public.is_department_of_student(student_id))
    with check ((select public.is_approved_staff()) and public.is_department_of_student(student_id));
