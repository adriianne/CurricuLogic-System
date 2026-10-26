-- 088_stop_restore_accounts.sql
--
-- The Admin can STOP an account and RESTORE it. Stopping is reversible and erases nothing: the person
-- cannot sign in or reach any data, and every record they own stays as it was.
--
--   * A stopped account is is_approved = false. Staff already lose all data access when that flag is false,
--     because every staff access rule asks for it (is_registrar_of_student, is_department_of_student,
--     can_read_all_students, the program-scoped helpers, ...). The sign-in pages already refuse it.
--   * Students were the gap: their rules ask only "which student is this user" (current_student_id()), not
--     "is that student approved". current_student_id() now returns nothing for an account that is not
--     approved, so a stopped student's own records, requests and chat close in one place, even for a session
--     that was already open. (An unapproved student cannot sign in anyway, so nothing else changes.)
--   * Every stop and restore is written to account_stop_log with who did it, when, and the reason.
--   * Restore only works on an account the log says was stopped. It cannot be used to approve a pending or
--     declined student, or to approve anyone who was never stopped.
--   * A stopped student keeps approval_status = 'approved', so restoring needs no new approval and issues
--     no new student ID.
--   * Only an approved administrator may call it, never on their own account. Administrator accounts are
--     not covered: stopping the last one would lock everyone out.
--
-- Safe to re-run.

create table if not exists public.account_stop_log (
    id          uuid primary key default gen_random_uuid(),
    seq         bigint generated always as identity,   -- the order of events (timestamps tie inside one transaction)
    role        text not null check (role in ('student', 'faculty', 'registrar', 'department')),
    target_id   uuid not null,              -- the id of the row in that role's own table
    user_id     uuid,                       -- their sign-in, for reference
    action      text not null check (action in ('stop', 'restore')),
    reason      text,
    actor_id    uuid default auth.uid(),
    created_at  timestamptz not null default now(),
    constraint account_stop_log_reason_length check (reason is null or char_length(reason) <= 300),
    constraint account_stop_log_stop_needs_reason check (action = 'restore' or (reason is not null and btrim(reason) <> ''))
);

-- For a table made by an earlier run of this file, which had no seq column.
alter table public.account_stop_log add column if not exists seq bigint generated always as identity;

drop index if exists public.account_stop_log_target_idx;
create index if not exists account_stop_log_target_idx on public.account_stop_log (role, target_id, seq desc);

alter table public.account_stop_log enable row level security;

drop policy if exists admin_read_account_stop_log on public.account_stop_log;
create policy admin_read_account_stop_log on public.account_stop_log
    for select to authenticated
    using (is_system_admin());

-- Read-only for the Admin's screen. Rows are written only by set_account_stopped below.
revoke all on public.account_stop_log from anon, authenticated;
grant select on public.account_stop_log to authenticated;


create or replace function public.set_account_stopped(
    p_role   text,
    p_target uuid,
    p_stop   boolean,
    p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user     uuid;
  v_approved boolean;
  v_status   text;
  v_last     text;
  v_reason   text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not public.is_system_admin() then
    raise exception 'Only an administrator can stop or restore an account.' using errcode = '42501';
  end if;

  if p_role = 'student' then
    select user_id, is_approved, approval_status into v_user, v_approved, v_status
      from public.university_student where id = p_target for update;
  elsif p_role = 'faculty' then
    select user_id, is_approved into v_user, v_approved from public.faculty_staff where id = p_target for update;
  elsif p_role = 'registrar' then
    select user_id, is_approved into v_user, v_approved from public.registrar_staff where id = p_target for update;
  elsif p_role = 'department' then
    select user_id, is_approved into v_user, v_approved from public.department_staff where id = p_target for update;
  else
    raise exception 'Unknown role: %.', p_role using errcode = '22023';
  end if;

  if not found then
    raise exception 'Account not found.' using errcode = 'P0002';
  end if;

  if v_user is not null and v_user = auth.uid() then
    raise exception 'You cannot stop your own account.' using errcode = '42501';
  end if;

  if p_stop then
    if v_approved is not true then
      raise exception 'This account is not active, so there is nothing to stop.' using errcode = '22023';
    end if;
    if v_reason is null then
      raise exception 'A reason is required to stop an account.' using errcode = '22023';
    end if;
    if char_length(v_reason) > 300 then
      raise exception 'Keep the reason under 300 characters.' using errcode = '22023';
    end if;
  else
    select action into v_last from public.account_stop_log
      where role = p_role and target_id = p_target order by seq desc limit 1;
    if v_last is distinct from 'stop' or v_approved is true then
      raise exception 'This account was not stopped, so there is nothing to restore.' using errcode = '22023';
    end if;
    if p_role = 'student' and v_status is distinct from 'approved' then
      raise exception 'This student is not an approved account, so it cannot be restored.' using errcode = '22023';
    end if;
  end if;

  if p_role = 'student' then
    update public.university_student set is_approved = not p_stop where id = p_target;
  elsif p_role = 'faculty' then
    update public.faculty_staff set is_approved = not p_stop where id = p_target;
  elsif p_role = 'registrar' then
    update public.registrar_staff set is_approved = not p_stop where id = p_target;
  else
    update public.department_staff set is_approved = not p_stop where id = p_target;
  end if;

  insert into public.account_stop_log (role, target_id, user_id, action, reason)
  values (p_role, p_target, v_user, case when p_stop then 'stop' else 'restore' end,
          case when p_stop then v_reason else null end);

  return jsonb_build_object('ok', true, 'action', case when p_stop then 'stop' else 'restore' end);
end;
$$;

revoke all on function public.set_account_stopped(text, uuid, boolean, text) from public, anon;
grant execute on function public.set_account_stopped(text, uuid, boolean, text) to authenticated;


-- A student's own access rules ask this. An account that is not approved (a stopped one, or one never
-- approved) now has no student id, so those rules deny it.
create or replace function public.current_student_id()
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $$
    select id from university_student where user_id = auth.uid() and is_approved limit 1;
$$;
