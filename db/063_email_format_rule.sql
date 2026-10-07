-- 063: email format rule on the account tables (input handling, item 6).
-- DRAFT: review, then run once in the Supabase SQL editor.
--
-- The check used everywhere was "something, an @, something, a dot,
-- something", which let through a@b.c, a@@b.com, x..y@school.edu, a@-b.com and
-- an address of any length. The browser now uses shared/js/emailrules.js; this
-- puts the same rule in the database, so a client that skips the form is
-- refused too.
--
--   exactly one @
--   before it: letters, digits and . ! # $ % & ' * + / = ? ^ _ ` { | } ~ -
--              at most 64 characters, no dot at either end, no two dots in a row
--   after it:  two or more parts joined by dots; each is letters, digits and
--              hyphens, not starting or ending with a hyphen; the last is
--              letters only, at least 2 long
--   at most 254 characters in all; plain ASCII only
--
-- The match ignores case (the browser lower-cases, older rows may not be).
-- NULL still passes. Measured on 2026-10-07: all 45 existing rows pass.
--
-- Safe to re-run: each constraint is dropped and re-added.

begin;

do $$
declare
  t text;
begin
  foreach t in array array['university_student', 'faculty_staff', 'registrar_staff',
                           'department_staff', 'system_administrator']
  loop
    execute format('alter table public.%I drop constraint if exists %I', t, t || '_email_format');
    execute format(
      'alter table public.%I add constraint %I check ('
      || 'email ~* %L'
      || ' and email !~ %L and email !~ %L'
      || ' and char_length(split_part(email, %L, 1)) <= 64'
      || ' and char_length(email) <= 254'
      || ' and email ~* %L)',
      t, t || '_email_format',
      '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$',
      '\.\.', '(^\.|\.@)', '@',
      '\.[a-z]{2,}$');
  end loop;
end $$;

commit;

-- To see them:
--   select conrelid::regclass as tbl, conname
--   from pg_constraint where conname like '%\_email\_format' order by 1;
