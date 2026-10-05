-- 052: what a signed-OUT visitor (role anon) can reach (security item 12).
-- DRAFT: review, then run once in the Supabase SQL editor.
--
-- Found 2026-10-04 (Supabase security advisor + a read of the live catalog):
--   * 35 RLS policies (on 16 tables) were granted to the role "public", which includes anon.
--     They are safe today only because each one tests "who is signed in" and a
--     signed-out visitor has no identity; they should not apply to anon at all.
--   * 23 SECURITY DEFINER functions could be run by anon over /rest/v1/rpc,
--     including create_user_account, and 5 of them were only reachable because
--     those policies call them.
--   * anon held every table privilege on every table in public (RLS was the
--     only thing standing in the way). TRUNCATE in particular is not covered
--     by RLS at all.
-- The only things a signed-out visitor legitimately needs are: read the list of
-- programmes (registration page), and file a registration request (insert into
-- university_student, checked by the db/046 trigger, which calls
-- _fresh_student_account as the visitor).
--
-- Nothing changes for a signed-in user: every policy keeps its USING / WITH
-- CHECK; functions keep EXECUTE for authenticated and service_role.

begin;

-- 1. Policies: public -> authenticated ----------------------------------------
do $$
declare
  r record;
begin
  for r in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public' and roles::text = '{public}'
  loop
    execute format('alter policy %I on %I.%I to authenticated',
                   r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

-- 2. Functions: no EXECUTE for anon / PUBLIC -----------------------------------
-- Whoever could run a function before (authenticated, service_role) still can:
-- the grant is re-stated explicitly, in case it came only through PUBLIC.
do $$
declare
  r record;
  had_auth boolean;
  had_service boolean;
begin
  for r in
    select p.oid, p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and p.proname <> '_fresh_student_account'   -- the registration trigger runs as the visitor and calls it
  loop
    had_auth    := has_function_privilege('authenticated', r.oid, 'execute');
    had_service := has_function_privilege('service_role',  r.oid, 'execute');
    execute format('revoke execute on function %s from public, anon', r.sig);
    if had_auth    then execute format('grant execute on function %s to authenticated', r.sig); end if;
    if had_service then execute format('grant execute on function %s to service_role',  r.sig); end if;
  end loop;
end $$;

-- A function created later is not callable by anon unless someone grants it.
alter default privileges for role postgres in schema public revoke execute on functions from anon;

-- 3. Tables: anon gets only what registration needs ----------------------------
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
grant select on public.program            to anon;   -- "programs readable before sign-in"
grant insert on public.university_student to anon;   -- "anon_can_request_account"

-- TRUNCATE, REFERENCES and TRIGGER are not covered by RLS; nobody signed in
-- through the API needs them either.
revoke truncate, references, trigger on all tables in schema public from authenticated;

alter default privileges for role postgres in schema public revoke all on tables from anon;

commit;

-- After running, these should all be empty / false:
--   select count(*) from pg_policies where schemaname='public' and roles::text = '{public}';
--   select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--     where n.nspname='public' and p.prokind='f' and has_function_privilege('anon', p.oid, 'execute');
--     (expect only _fresh_student_account)
