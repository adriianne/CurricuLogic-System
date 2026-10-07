-- 061: password rule counts bytes and ignores spaces (input handling, item 3).
-- DRAFT: review, then run once in the Supabase SQL editor.
--
-- Same change as shared/js/passwordrules.js:
--   * the 72 limit is 72 BYTES (bcrypt reads no more), not 72 characters: a
--     25-character Japanese password is 75 bytes and used to pass
--   * spaces do not count toward the minimum: eight spaces and a "!" used to
--     pass
--
-- Replaces only _password_problem(); _provision_account already calls it, so
-- nothing else changes. Existing accounts keep the passwords they have.
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
    else null
  end;
$$;

revoke all on function public._password_problem(text, text) from public, anon, authenticated;
grant execute on function public._password_problem(text, text) to service_role;
