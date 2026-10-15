-- 072_setup_link_accounts.sql
--
-- STATUS: DRAFT. Not applied. Run it in the Supabase SQL editor.
--
-- Security item 6: an account the administrator creates no longer needs a typed
-- temporary password. The admin leaves the password blank, the database gives the
-- account a long random password that nobody is ever shown, and the person is
-- emailed a one-time link to choose their own (the website then calls
-- supabase.auth.resetPasswordForEmail).
--
--   * A BLANK or missing p_password in create_user_account now means "random".
--     A typed password still works exactly as before (the db/049 and db/061 rules
--     still apply to it), so an admin can still hand out a temporary password if
--     email is not set up.
--   * The generated password always satisfies the same rule (24+ characters, one
--     special character), so _provision_account accepts it without a special case.
--   * must_change_password stays true until the person sets their own password
--     (db/057), so an account nobody has opened yet is flagged as such.
--   * Nothing else changes: same caps, IDs, audit log and permissions.
--
-- Safe to re-run.

create or replace function public._random_password()
returns text
language sql
volatile
set search_path = pg_catalog, extensions
as $$
  -- 24 random bytes, base64 -> 32 characters; '=' padding becomes '!' so a special
  -- character is guaranteed, and 'Aa1' guarantees the rest. Never shown to anyone.
  select translate(encode(extensions.gen_random_bytes(24), 'base64'), E'=\n', '!') || 'Aa1!';
$$;

revoke all on function public._random_password() from public, anon, authenticated;

create or replace function public.create_user_account(
    p_first_name text,
    p_last_name text,
    p_email text,
    p_password text,
    p_role text,
    p_employee_id text default null,
    p_student_id text default null,
    p_department text default 'College of Computer Studies',
    p_year_level text default null,
    p_username text default null,
    p_program_code text default 'BSIT',
    p_declared_path text default 'existing'
)
returns jsonb
language sql
security definer
set search_path to 'public', 'auth', 'extensions'
as $$
    select _provision_account(
        p_first_name, p_last_name, p_email,
        coalesce(nullif(trim(coalesce(p_password, '')), ''), public._random_password()),
        p_role,
        p_employee_id, p_student_id, p_department, p_year_level,
        p_username, 'ADMIN_BULK', p_program_code, p_declared_path
    );
$$;

-- Same access as before: signed-in callers only (the function itself checks that
-- the caller is an administrator).
revoke all on function public.create_user_account(text, text, text, text, text, text, text, text, text, text, text, text)
    from public, anon;
grant execute on function public.create_user_account(text, text, text, text, text, text, text, text, text, text, text, text)
    to authenticated, service_role;
