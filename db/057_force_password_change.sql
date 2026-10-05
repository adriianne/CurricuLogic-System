-- 057_force_password_change.sql
--
-- Accounts an administrator creates carry a temporary password and
-- must_change_password = true. Nothing ever made the person change it:
--   * the student dashboard ignored the flag;
--   * the faculty / registrar dashboards tried to clear it with a direct UPDATE
--     after a voluntary password change, which row-level security refuses
--     (only the Department had an own-row update policy), so it stayed true.
--
-- The website now shows a blocking "Choose a new password" box until the flag is
-- cleared. These two functions let a person read and clear THEIR OWN flag without
-- opening up UPDATE on the account tables. The server cannot see whether the
-- password was really changed; the box changes it first, then clears the flag.
-- A person who skips the box by calling the function themselves only keeps their
-- own temporary password, which they were given anyway.
--
-- Safe to re-run.

create or replace function public.my_must_change_password()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from university_student   where user_id = auth.uid() and must_change_password)
      or exists (select 1 from faculty_staff        where user_id = auth.uid() and must_change_password)
      or exists (select 1 from registrar_staff      where user_id = auth.uid() and must_change_password)
      or exists (select 1 from department_staff     where user_id = auth.uid() and must_change_password)
      or exists (select 1 from system_administrator where user_id = auth.uid() and must_change_password);
$$;

create or replace function public.clear_must_change_password()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;
  update university_student   set must_change_password = false where user_id = auth.uid() and must_change_password;
  update faculty_staff        set must_change_password = false where user_id = auth.uid() and must_change_password;
  update registrar_staff      set must_change_password = false where user_id = auth.uid() and must_change_password;
  update department_staff     set must_change_password = false where user_id = auth.uid() and must_change_password;
  update system_administrator set must_change_password = false where user_id = auth.uid() and must_change_password;
end;
$$;

revoke all on function public.my_must_change_password()    from public, anon, authenticated;
revoke all on function public.clear_must_change_password() from public, anon, authenticated;
grant execute on function public.my_must_change_password()    to authenticated;
grant execute on function public.clear_must_change_password() to authenticated;
