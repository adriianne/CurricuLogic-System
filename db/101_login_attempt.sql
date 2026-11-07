-- 101_login_attempt.sql
--
-- Sign-in lockout (security item 3). The sign-in function (supabase/functions/sign-in) now remembers FAILED password
-- attempts here, per account, and refuses further attempts for a while:
--   5 failed attempts within 15 minutes  ->  that account is locked until the 15 minutes have passed.
-- A correct password clears the account's failures. Nobody is locked for ever, so an attacker cannot lock a
-- person out for good.
--
-- The key is the account's e-mail (the function resolves a student ID or an employee ID to the e-mail first, so
-- trying the e-mail, the ID and the "uc-" form of the same account counts as one account). An ID that matches no
-- account is keyed by the ID text itself.
--
-- Only the sign-in function (service role) can read or write this table. Nothing on a page can.
-- Old rows are removed by the function itself (a small share of requests), and by the nightly cleanup
-- if you add the table to it.
--
-- TO UNDO: drop table public.login_attempt; (the function then fails open, with a log line).
-- Safe to re-run.

create table if not exists public.login_attempt (
    id           bigint generated always as identity primary key,
    key          text        not null check (char_length(key) <= 254),
    attempted_at timestamptz not null default now()
);

create index if not exists login_attempt_key_time_idx on public.login_attempt (key, attempted_at desc);

alter table public.login_attempt enable row level security;
-- No policies on purpose: with row-level security on and no policy, nobody but the service role can touch it.

revoke all on public.login_attempt from public, anon, authenticated;
grant select, insert, delete on public.login_attempt to service_role;
