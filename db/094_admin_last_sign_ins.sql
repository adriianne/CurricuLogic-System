-- 094_admin_last_sign_ins.sql
--
-- The Administrator's "User status" page shows when each account last signed in. That time lives in the sign-in
-- service (auth.users.last_sign_in_at), which the page cannot read. This function reads it on the Administrator's
-- behalf and answers with one row per account: which kind of account, the id of the row in that kind's own table,
-- and the time. It answers nothing to anyone who is not an approved Administrator.
--
-- It returns only times, never emails, passwords or tokens. The page matches each row to the account it already
-- has by (role, account_id), the same ids account_stop_log uses.
--
-- Safe to re-run. To undo:
--   drop function if exists public.admin_last_sign_ins();

create or replace function public.admin_last_sign_ins()
returns table (role text, account_id uuid, last_sign_in_at timestamptz)
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if not public.is_system_admin() then
    raise exception 'Only an administrator can read sign-in times.' using errcode = '42501';
  end if;

  return query
    select 'student'::text, s.id, u.last_sign_in_at
      from public.university_student s join auth.users u on u.id = s.user_id
    union all
    select 'faculty'::text, f.id, u.last_sign_in_at
      from public.faculty_staff f join auth.users u on u.id = f.user_id
    union all
    select 'registrar'::text, r.id, u.last_sign_in_at
      from public.registrar_staff r join auth.users u on u.id = r.user_id
    union all
    select 'department'::text, d.id, u.last_sign_in_at
      from public.department_staff d join auth.users u on u.id = d.user_id;
end;
$$;

revoke all on function public.admin_last_sign_ins() from public, anon;
grant execute on function public.admin_last_sign_ins() to authenticated;
