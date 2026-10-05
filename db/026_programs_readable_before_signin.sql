-- 026_programs_readable_before_signin.sql
--
-- STATUS: APPLIED to the live database (2026-09-30).
--
-- WHY
--   The registration page asks a new student which degree program they are
--   enrolled in, and lists the programs from the `program` table. But
--   "read programs" applies to signed-in users only, and a person registering
--   has not signed in. To them the table looks empty, so the page falls back
--   to "the Registrar will confirm your program" and no program is recorded.
--
-- WHAT THIS CHANGES
--   Anyone, signed in or not, may READ the list of programs (code, name,
--   college). It adds no ability to change anything.
--
-- IS THAT SAFE?
--   The program table holds only the degree programs' code, name and college
--   (BSIT, "Bachelor of Science in Information Technology", "College of
--   Computer Studies"): the same information as a public course catalogue,
--   and the registration page has to show it anyway. It holds no student,
--   staff or curriculum data. Prospectuses, subjects and students are
--   protected by their own policies and are not affected.
--
-- IF YOU LEAVE IT OUT
--   Registration keeps working exactly as it does now: the program field says
--   "To be confirmed by the Registrar" and the Registrar sets it when
--   verifying. Nothing breaks.
--
-- HOW TO UNDO: run the ROLLBACK line at the bottom.

drop policy if exists "programs readable before sign-in" on public.program;
create policy "programs readable before sign-in"
    on public.program for select
    to anon
    using (true);


-- ROLLBACK ------------------------------------------------------------------
-- drop policy if exists "programs readable before sign-in" on public.program;
