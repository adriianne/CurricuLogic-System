-- 099_password_letter_and_number.sql
--
-- The password rule now also needs at least one letter and one number (6 Nov 2026), the same change as
-- shared/js/accounts/passwordrules.js. Before, "12345678!" and "!!!!!!!!" passed (8 characters and a special
-- character was all it asked). This is the database copy, used by _provision_account for accounts the Admin
-- creates (single and bulk). A student's own sign-up and password change go straight to Supabase Auth, so for those
-- the pages and the app are the check.
--
-- Existing accounts keep the passwords they have. Replaces only _password_problem().
--
-- TO UNDO: re-run db/061.
-- Safe to re-run.

create or replace function public._password_problem(p_password text, p_role text)
returns text
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select case
    when length(regexp_replace(coalesce(p_password, ''), '\s', '', 'g'))
         < (case when lower(trim(coalesce(p_role, ''))) = 'admin' then 12 else 8 end)
      then 'Password must be at least '
           || (case when lower(trim(coalesce(p_role, ''))) = 'admin' then 12 else 8 end)
           || ' characters' || (case when p_password ~ '\s' then ' (spaces do not count).' else '.' end)
    when octet_length(p_password) > 72
      then 'Password must be at most 72 bytes (accented, emoji and non-Latin characters count as 2 to 4 each).'
    when p_password !~ '[^[:alnum:][:space:]]'
      then 'Password must include a special character, such as ! @ # $ or %.'
    when p_password !~ '[[:alpha:]]'
      then 'Password must include a letter.'
    when p_password !~ '[[:digit:]]'
      then 'Password must include a number.'
    else null
  end;
$$;

revoke all on function public._password_problem(text, text) from public, anon, authenticated;
grant execute on function public._password_problem(text, text) to service_role;
