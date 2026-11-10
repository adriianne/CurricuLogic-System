-- 100_security_tidy.sql
--
-- Small clean-ups from the security re-check of 6 Nov 2026 (after db/093 to 099).
--
-- 1. check_expected_student (db/085) is not called by the website or the app any more: the Register page and the
--    Android registration use check_registration_match (db/095), which also checks the e-mail. The old function
--    only needed the ID or the name, so it was a weaker "is this person on the list?" test open to a signed-out
--    caller. It is now closed to anon and authenticated (the function itself stays, for the Admin or for undo).
--
-- 2. student_register_name_guard is a trigger function: nobody needs to call it, and it does not need EXECUTE to
--    fire. It was executable by the signed-out role, so that is removed.
--
-- 3. _norm_name (db/098, recreated) had a role-mutable search_path (Supabase advisor warning). It now has a fixed one.
--
-- Left as they are on purpose: check_registration_match (the Register page needs it before sign-up; it answers
-- "match / no match / no list" only, and a guess needs the ID, the programme AND the e-mail on file),
-- name_already_registered (only answers "false" while an EDP list is in use) and _fresh_student_account (used by
-- the registration guard of db/046).
--
-- TO UNDO: grant execute on function public.check_expected_student(text, text, text, integer) to anon, authenticated;
--          grant execute on function public.student_register_name_guard() to anon, authenticated;
--
-- Safe to re-run.

revoke all on function public.check_expected_student(text, text, text, integer) from public, anon, authenticated;
revoke all on function public.student_register_name_guard() from public, anon, authenticated;

create or replace function public._norm_name(p text)
returns text
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select regexp_replace(
           translate(lower(btrim(coalesce(p, ''))),
                     'ñáàâäãåéèêëíìîïóòôöõøúùûüýÿçšžčřłśźżňďťěůğ',
                     'naaaaaaeeeeiiiioooooouuuuyycszcrlszzndteug'),
           '\s+', ' ', 'g');
$$;
