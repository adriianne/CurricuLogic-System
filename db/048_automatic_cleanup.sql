-- 048: automatic cleanup of unused data (security item 18).
-- DRAFT: review, then run once in the Supabase SQL editor.
--
-- Rules (change the numbers in cleanup_unused_data() if you disagree):
--   * unconfirmed sign-ups (never clicked the email link) older than 7 days,
--     together with their pending student row. NEVER staff/admin accounts,
--     never an approved student, never a student that already has records
--     (that delete simply fails on its foreign keys and is skipped).
--   * notifications that were read, older than 90 days.
--   * advisor chat messages older than 6 months.
--   * import staging rows (stg_subject, stg_prerequisite) older than 7 days.
--   * the cleanup log itself, older than 1 year.
-- NEVER touched: audit_log, academic_record, request/approval rows, grade files.
--
-- Safe by design: cleanup_unused_data(true) is a DRY RUN that only counts.
-- Every real run writes one line per rule to maintenance_log.

begin;

-- 1. A small log of what each run removed (admin read only).
create table if not exists public.maintenance_log (
  id         bigint generated always as identity primary key,
  ran_at     timestamptz not null default now(),
  task       text        not null,
  rows_found integer     not null,
  dry_run    boolean     not null
);

alter table public.maintenance_log enable row level security;

drop policy if exists maintenance_log_admin_read on public.maintenance_log;
create policy maintenance_log_admin_read on public.maintenance_log
  for select to authenticated
  using (exists (select 1 from public.system_administrator a where a.user_id = auth.uid()));

revoke all on public.maintenance_log from anon, authenticated;
grant select on public.maintenance_log to authenticated;

-- 2. The cleanup. Only the database owner (and so pg_cron) can run it.
create or replace function public.cleanup_unused_data(p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_result  jsonb := '{}'::jsonb;
  v_n       integer;
  r         record;
begin
  -- a) Unconfirmed sign-ups older than 7 days (deleting the auth user also
  --    removes the pending student row through ON DELETE CASCADE).
  v_n := 0;
  for r in
    select u.id
    from auth.users u
    where u.email_confirmed_at is null
      and u.created_at < now() - interval '7 days'
      and not exists (select 1 from public.faculty_staff        f where f.user_id = u.id)
      and not exists (select 1 from public.registrar_staff      g where g.user_id = u.id)
      and not exists (select 1 from public.department_staff     d where d.user_id = u.id)
      and not exists (select 1 from public.system_administrator a where a.user_id = u.id)
      and not exists (select 1 from public.university_student   s where s.user_id = u.id and s.is_approved)
  loop
    if p_dry_run then
      v_n := v_n + 1;
    else
      begin
        delete from auth.users where id = r.id;
        v_n := v_n + 1;
      exception when foreign_key_violation then
        null;  -- it already has records: leave it for a person
      end;
    end if;
  end loop;
  v_result := v_result || jsonb_build_object('unconfirmed_signups', v_n);
  insert into public.maintenance_log(task, rows_found, dry_run) values ('unconfirmed_signups', v_n, p_dry_run);

  -- b) Read notifications older than 90 days.
  if p_dry_run then
    select count(*) into v_n from public.notification
     where is_read and created_at < now() - interval '90 days';
  else
    delete from public.notification
     where is_read and created_at < now() - interval '90 days';
    get diagnostics v_n = row_count;
  end if;
  v_result := v_result || jsonb_build_object('read_notifications', v_n);
  insert into public.maintenance_log(task, rows_found, dry_run) values ('read_notifications', v_n, p_dry_run);

  -- c) Advisor chat older than 6 months.
  if p_dry_run then
    select count(*) into v_n from public.ai_chat_message
     where created_at < now() - interval '6 months';
  else
    delete from public.ai_chat_message
     where created_at < now() - interval '6 months';
    get diagnostics v_n = row_count;
  end if;
  v_result := v_result || jsonb_build_object('ai_chat_message', v_n);
  insert into public.maintenance_log(task, rows_found, dry_run) values ('ai_chat_message', v_n, p_dry_run);

  -- d) Import staging rows older than 7 days.
  if p_dry_run then
    select count(*) into v_n from public.stg_subject
     where uploaded_at < now() - interval '7 days';
  else
    delete from public.stg_subject
     where uploaded_at < now() - interval '7 days';
    get diagnostics v_n = row_count;
  end if;
  v_result := v_result || jsonb_build_object('stg_subject', v_n);
  insert into public.maintenance_log(task, rows_found, dry_run) values ('stg_subject', v_n, p_dry_run);

  if p_dry_run then
    select count(*) into v_n from public.stg_prerequisite
     where uploaded_at < now() - interval '7 days';
  else
    delete from public.stg_prerequisite
     where uploaded_at < now() - interval '7 days';
    get diagnostics v_n = row_count;
  end if;
  v_result := v_result || jsonb_build_object('stg_prerequisite', v_n);
  insert into public.maintenance_log(task, rows_found, dry_run) values ('stg_prerequisite', v_n, p_dry_run);

  -- e) The log trims itself (keeps one year).
  if not p_dry_run then
    delete from public.maintenance_log where ran_at < now() - interval '1 year';
  end if;

  return v_result || jsonb_build_object('dry_run', p_dry_run);
end;
$$;

revoke all on function public.cleanup_unused_data(boolean) from public, anon, authenticated;

-- 3. Run it every day at 03:00 Manila time (19:00 UTC) with pg_cron.
create extension if not exists pg_cron;

select cron.schedule(
  'curriculogic-daily-cleanup',
  '0 19 * * *',
  $cron$select public.cleanup_unused_data(false);$cron$
);

commit;

-- To look at what it WOULD remove, without deleting anything:
--   select public.cleanup_unused_data(true);
-- To see past runs:
--   select * from public.maintenance_log order by ran_at desc limit 20;
-- To stop the schedule:
--   select cron.unschedule('curriculogic-daily-cleanup');
