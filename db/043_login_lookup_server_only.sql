-- 043_login_lookup_server_only.sql
--
-- Security fix (item 7 of the security list, 2026-10-03).
--
-- resolve_login_identifier() turns a uc-/EMP- ID into the account's email so a
-- sign-in can happen. It was callable by anyone, signed out, with only the
-- public API key, and it RETURNED THE EMAIL. Anyone could try IDs one after
-- another, harvest emails, and learn which IDs exist.
--
-- Now:
--   * the lookup runs only inside the `sign-in` edge function (service role),
--     which returns a session or one generic failure and never the email;
--   * anon, authenticated and PUBLIC can no longer execute it;
--   * the administrator-username branch is gone (the only admin signs in by
--     email, admin@uc.edu.ph, and its username is empty), so an admin account
--     can no longer be found through this function at all;
--   * its source is now in the repo (it was created directly on the server).
--
-- ORDER OF ROLLOUT (login breaks if this is applied before steps 1 and 2):
--   1. deploy the `sign-in` edge function
--   2. publish the new shared/js/auth.js that calls it
--   3. run THIS file in the Supabase SQL editor
--
-- TO CHECK AFTERWARDS: a signed-out call to /rest/v1/rpc/resolve_login_identifier
-- must be refused (permission denied), and signing in with an email, a uc- ID
-- and an EMP- ID must still work on their pages.
-- TO UNDO: grant execute back with
--   grant execute on function public.resolve_login_identifier(text) to anon, authenticated;
-- (and the old auth.js), which reopens the leak.

create or replace function public.resolve_login_identifier(identifier text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
    cleaned text;
    digits  text;
    found   text;
begin
    if identifier is null or btrim(identifier) = '' then
        return null;
    end if;

    -- already an email
    if position('@' in identifier) > 0 then
        return btrim(identifier);
    end if;

    cleaned := upper(regexp_replace(btrim(identifier), '\s', '', 'g'));

    -- uc-1234567 only. The hyphen is required: UC2401187 without it is
    -- one keystroke away from a bare ID, and accepting both reintroduces
    -- the ambiguity the prefix exists to remove.
    if cleaned ~ '^UC-[0-9]+$' then
        digits := regexp_replace(cleaned, '^UC-', '');
        digits := lpad(digits, 7, '0');

        select email into found
        from university_student
        where student_id = digits
        limit 1;

        return found;
    end if;

    -- EMP-00871, across the three staff tables. Administrators are NOT
    -- reachable by ID: the admin signs in by email only.
    if cleaned ~ '^EMP-[A-Z0-9]+$' then
        select email into found from faculty_staff
        where upper(replace(employee_id, '-', '')) = replace(cleaned, '-', '') limit 1;
        if found is not null then return found; end if;

        select email into found from registrar_staff
        where upper(replace(employee_id, '-', '')) = replace(cleaned, '-', '') limit 1;
        if found is not null then return found; end if;

        select email into found from department_staff
        where upper(replace(employee_id, '-', '')) = replace(cleaned, '-', '') limit 1;
        return found;
    end if;

    -- Not a recognised shape. Returning null rather than guessing keeps a
    -- bare 7-digit number from being treated as a student ID.
    return null;
end;
$function$;

revoke execute on function public.resolve_login_identifier(text) from public, anon, authenticated;
grant  execute on function public.resolve_login_identifier(text) to service_role;
