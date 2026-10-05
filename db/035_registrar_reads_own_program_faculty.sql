-- 035_registrar_reads_own_program_faculty.sql
--
-- STATUS: APPLIED to the live database (2026-09-30).
--
-- WHY   A registrar could read every faculty account. They need faculty only
--       for the adviser name on the advising slip, and an adviser is always
--       of the student's own programme.
-- WHAT  "registrar reads faculty" now returns only faculty of the
--       registrar's own programme (my_registrar_program(), db/034).
-- ROLLBACK
--   drop policy "registrar reads faculty" on faculty_staff;
--   create policy "registrar reads faculty" on faculty_staff for select to public
--     using (exists (select 1 from registrar_staff r
--                    where r.user_id = auth.uid() and r.is_approved));

drop policy if exists "registrar reads faculty" on public.faculty_staff;
create policy "registrar reads faculty" on public.faculty_staff for select to public
    using (program_id is not null and program_id = my_registrar_program());
