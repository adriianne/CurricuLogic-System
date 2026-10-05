-- 054: the audit trail (security item 13).
-- DRAFT: review, then run once in the Supabase SQL editor.
--
-- Today audit_log records only account provisioning, subject edits/retirements
-- and curriculum copies, and it is protected only by row-level security:
-- signed-in users hold INSERT/UPDATE/DELETE on the table itself, and nothing
-- stops the owner editing history. This migration:
--   1. makes audit_log APPEND-ONLY (no privileges for signed-in users, and a
--      trigger that refuses UPDATE, DELETE and TRUNCATE for everyone, owner
--      included -- it can still be dropped on purpose by a database admin, so
--      this is tamper-EVIDENT, not tamper-proof);
--   2. records the administrative changes that were not recorded: programme
--      edits, term setting, curriculum version create/activate/publish/delete,
--      staff and administrator account changes, student approval/verification/
--      programme/curriculum changes, adviser assignments. Only the columns that
--      CHANGED are stored, so an UPDATE of one field is one small row;
--   3. adds the two indexes an admin needs to look things up.
--
-- Who can read it: administrators only (policy admin_reads_audit_log, unchanged).
-- NOT logged on purpose: grade uploads (grade_file / grade_file_row already keep
-- who/when/what per upload), adviser decisions (request_review), the sign-up
-- queue (open to the public: logging it would let anyone fill the log), and
-- sign-ins (Supabase Auth keeps its own log of those).
-- Retention: nothing deletes from audit_log (db/048 never touches it).

begin;

-- 1. append-only --------------------------------------------------------------
revoke insert, update, delete, truncate on public.audit_log from authenticated, anon;

create or replace function public.audit_log_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_log is append-only: % is not allowed', tg_op using errcode = '42501';
end;
$$;

-- A trigger function is not callable as an RPC, but it should still not be
-- executable by signed-out visitors (db/052 keeps that list to one function).
revoke all on function public.audit_log_append_only() from public, anon, authenticated;

drop trigger if exists audit_log_no_change   on public.audit_log;
drop trigger if exists audit_log_no_truncate on public.audit_log;
create trigger audit_log_no_change
  before update or delete on public.audit_log
  for each row execute function public.audit_log_append_only();
create trigger audit_log_no_truncate
  before truncate on public.audit_log
  for each statement execute function public.audit_log_append_only();

create index if not exists audit_log_created_idx on public.audit_log (created_at desc);
create index if not exists audit_log_record_idx  on public.audit_log (table_name, record_id);

-- 2. who did it ---------------------------------------------------------------
create or replace function public._audit_actor_role()
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select case
    when auth.uid() is null                                                   then 'system'
    when exists (select 1 from system_administrator where user_id = auth.uid()) then 'system_administrator'
    when exists (select 1 from registrar_staff      where user_id = auth.uid()) then 'registrar_staff'
    when exists (select 1 from department_staff     where user_id = auth.uid()) then 'department_staff'
    when exists (select 1 from faculty_staff        where user_id = auth.uid()) then 'faculty_staff'
    when exists (select 1 from university_student   where user_id = auth.uid()) then 'student'
    else 'unknown'
  end;
$$;
revoke all on function public._audit_actor_role() from public, anon, authenticated;

-- 3. the generic row trigger --------------------------------------------------
-- Argument 0 (optional): comma-separated column names to leave out as noise.
create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  skip     text[] := array['updated_at', 'created_at'] || string_to_array(coalesce(tg_argv[0], ''), ',');
  o        jsonb;
  n        jsonb;
  k        text;
  old_diff jsonb := '{}'::jsonb;
  new_diff jsonb := '{}'::jsonb;
  rid      text;
begin
  if tg_op = 'INSERT' then
    n   := to_jsonb(new) - skip;
    rid := coalesce(n->>'id', n->>'assignment_id');
    insert into audit_log (actor_id, actor_role, action, table_name, record_id, old_values, new_values)
    values (auth.uid(), public._audit_actor_role(), 'INSERT_' || upper(tg_table_name), tg_table_name, rid, null, n);

  elsif tg_op = 'UPDATE' then
    o := to_jsonb(old);
    n := to_jsonb(new);
    for k in select key from jsonb_each(n) loop
      if k = any (skip) then continue; end if;
      if o -> k is distinct from n -> k then
        old_diff := old_diff || jsonb_build_object(k, o -> k);
        new_diff := new_diff || jsonb_build_object(k, n -> k);
      end if;
    end loop;
    if new_diff = '{}'::jsonb then
      return null;                       -- only noise changed: nothing to record
    end if;
    rid := coalesce(n->>'id', n->>'assignment_id');
    insert into audit_log (actor_id, actor_role, action, table_name, record_id, old_values, new_values)
    values (auth.uid(), public._audit_actor_role(), 'UPDATE_' || upper(tg_table_name), tg_table_name, rid, old_diff, new_diff);

  else  -- DELETE
    o   := to_jsonb(old) - skip;
    rid := coalesce(o->>'id', o->>'assignment_id');
    insert into audit_log (actor_id, actor_role, action, table_name, record_id, old_values, new_values)
    values (auth.uid(), public._audit_actor_role(), 'DELETE_' || upper(tg_table_name), tg_table_name, rid, o, null);
  end if;

  return null;
end;
$$;
revoke all on function public.audit_row_change() from public, anon, authenticated;

-- 4. attach it ----------------------------------------------------------------
-- configuration: who changed what, when
drop trigger if exists audit_program on public.program;
create trigger audit_program after insert or update or delete on public.program
  for each row execute function public.audit_row_change();

drop trigger if exists audit_system_config on public.system_config;
create trigger audit_system_config after insert or update or delete on public.system_config
  for each row execute function public.audit_row_change();

-- curriculum versions: create, publish, activate, delete
drop trigger if exists audit_prospectus on public.prospectus;
create trigger audit_prospectus after insert or update or delete on public.prospectus
  for each row execute function public.audit_row_change();

-- accounts: approval, programme, id, e-mail, department changes (account CREATION is
-- already logged by _provision_account, so no INSERT trigger here)
drop trigger if exists audit_faculty_staff on public.faculty_staff;
create trigger audit_faculty_staff after update or delete on public.faculty_staff
  for each row execute function public.audit_row_change('avatar_url');

drop trigger if exists audit_registrar_staff on public.registrar_staff;
create trigger audit_registrar_staff after update or delete on public.registrar_staff
  for each row execute function public.audit_row_change('avatar_url');

drop trigger if exists audit_department_staff on public.department_staff;
create trigger audit_department_staff after update or delete on public.department_staff
  for each row execute function public.audit_row_change('avatar_url');

drop trigger if exists audit_system_administrator on public.system_administrator;
create trigger audit_system_administrator after update or delete on public.system_administrator
  for each row execute function public.audit_row_change('avatar_url');

-- students: approval / verification / id / programme / curriculum changes. Not INSERT
-- (open to the public), and DELETE only for an approved student, so clearing out
-- never-confirmed sign-ups (db/048) does not keep their e-mail addresses forever.
drop trigger if exists audit_university_student_update on public.university_student;
create trigger audit_university_student_update after update on public.university_student
  for each row execute function public.audit_row_change('avatar_url');

drop trigger if exists audit_university_student_delete on public.university_student;
create trigger audit_university_student_delete after delete on public.university_student
  for each row when (old.is_approved) execute function public.audit_row_change('avatar_url');

-- adviser assignments
drop trigger if exists audit_advisee_assignment on public.advisee_assignment;
create trigger audit_advisee_assignment after insert or update or delete on public.advisee_assignment
  for each row execute function public.audit_row_change();

commit;
