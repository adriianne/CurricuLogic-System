-- 027_registrar_reads_faculty_for_slip.sql
--
-- STATUS: DRAFT. Not applied. Read it, then apply it.
--
-- WHY
--   Migration 024 dropped "registrar reads faculty" because the Advisers
--   screen it existed for was removed the same night (routing moved to
--   programmes instead). But the Registrar's "Print approved plan" also
--   depends on reading faculty_staff — it looks up who reviewed the
--   request (request_review.faculty_id) so it can print their name on the
--   advising slip's signature line. That read has had no policy to allow
--   it since 024, so every printed slip has shown the generic "Faculty
--   adviser" instead of the real name. Confirmed live: printing request
--   #8's real, already-approved plan returned adviser: "Faculty adviser"
--   through the actual signed-in Registrar session, not a placeholder in
--   a test.
--
-- WHAT THIS CHANGES
--   The Registrar may SELECT from faculty_staff. Nothing else changes —
--   no write access, and every other role's access is untouched.
--
-- HOW TO UNDO: run the ROLLBACK line at the bottom.

drop policy if exists "registrar reads faculty" on public.faculty_staff;
create policy "registrar reads faculty"
    on public.faculty_staff for select
    using (exists (
        select 1 from registrar_staff r
        where r.user_id = auth.uid() and r.is_approved
    ));


-- ROLLBACK ------------------------------------------------------------------
-- drop policy if exists "registrar reads faculty" on public.faculty_staff;
