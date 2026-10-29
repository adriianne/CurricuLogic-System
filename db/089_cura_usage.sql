-- 089_cura_usage.sql
-- DRAFT: review, then run once in the Supabase SQL editor.
--
-- A small usage log for Cura (the eligibility-chat function), so speed, failures and cost can be watched.
-- One row per answered request:
--   when it was, which student sign-in, web or app, how it ended (ok / busy / error / bad_request),
--   how long it took, which model answered, how many tries, and whether the answer carried plan wishes.
--
-- NOT stored: the student's message, Cura's reply, the summary, or anything else the student wrote.
-- Only requests from a signed-in, approved student are logged (a signed-out caller cannot fill the table).
--
-- Written only by the function (the service role). Read only by the Administrator. Rows older than 90 days are
-- removed by cleanup_cura_usage(), run nightly by pg_cron right after the existing cleanup (every run is
-- noted in maintenance_log). Safe to re-run.

begin;

create table if not exists public.cura_usage (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  user_id     uuid,                                   -- the student's sign-in, for counting, not for reading chats
  client      text check (client is null or client in ('web', 'app')),
  status      text not null check (status in ('ok', 'busy', 'error', 'bad_request')),
  http_status integer,
  duration_ms integer not null check (duration_ms >= 0),
  model       text,
  attempts    integer check (attempts is null or attempts >= 0),
  had_wishes  boolean not null default false
);

create index if not exists cura_usage_created_idx on public.cura_usage (created_at desc);

alter table public.cura_usage enable row level security;

drop policy if exists cura_usage_admin_read on public.cura_usage;
create policy cura_usage_admin_read on public.cura_usage
  for select to authenticated
  using (is_system_admin());

-- Read-only for the Admin's screen; rows are written by the function with the service role.
revoke all on public.cura_usage from anon, authenticated;
grant select on public.cura_usage to authenticated;

-- Retention: 90 days. cleanup_cura_usage(true) is a dry run that only counts.
create or replace function public.cleanup_cura_usage(p_dry_run boolean default true)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_n integer;
begin
  select count(*) into v_n from public.cura_usage where created_at < now() - interval '90 days';
  if not p_dry_run and v_n > 0 then
    delete from public.cura_usage where created_at < now() - interval '90 days';
  end if;
  insert into public.maintenance_log (task, rows_found, dry_run)
  values ('cura_usage older than 90 days', v_n, p_dry_run);
  return v_n;
end;
$$;

revoke all on function public.cleanup_cura_usage(boolean) from public, anon, authenticated;

commit;

-- The nightly run, ten minutes after the existing cleanup (19:00 UTC). Replaces a job of the same name.
select cron.schedule('cura-usage-cleanup', '10 19 * * *', $job$select public.cleanup_cura_usage(false);$job$);

-- Roll back (keeps nothing of the log):
--   select cron.unschedule('cura-usage-cleanup');
--   drop function if exists public.cleanup_cura_usage(boolean);
--   drop table if exists public.cura_usage;
