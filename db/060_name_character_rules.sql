-- 060: character rules for first and last names (security item 2, input handling).
-- DRAFT: review, then run once in the Supabase SQL editor.
--
-- The browser now refuses names with markup, formulas, digits, emoji and other
-- symbols (shared/js/namerules.js). This puts the same floor in the database,
-- so a client that skips the form is refused too. The browser rule is the
-- strict one (letters, marks, spaces and ' . - , only); the database refuses
-- the characters that do harm and leaves the rest to the browser, so a name in
-- an unusual script is never refused here.
--
--   refused:  control characters, invisible/zero-width characters,
--             < > = @ + * % $ # ^ ~ | \ / { } [ ] ; : " ! ? and digits
--   required: at least one letter
--
-- NULL still passes (an "existing record" registration has no name yet).
-- Measured on 2026-10-07: all 45 existing rows already satisfy the rule.
--
-- Safe to re-run: each constraint is dropped and re-added.

begin;

do $$
declare
  t text;
  c text;
begin
  foreach t in array array['university_student', 'faculty_staff', 'registrar_staff',
                           'department_staff', 'system_administrator']
  loop
    foreach c in array array['first_name', 'last_name']
    loop
      execute format('alter table public.%I drop constraint if exists %I', t, t || '_' || c || '_chars');
      execute format(
        'alter table public.%I add constraint %I check ('
        || '%I !~ %L and %I ~ %L)',
        t, t || '_' || c || '_chars',
        c, '[\x01-\x1f\x7f-\x9f\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff<>=@+*%$#^~|\\/{}\[\];:"!?0-9]',
        c, '[[:alpha:]]');
    end loop;
  end loop;
end $$;

commit;

-- To see them:
--   select conrelid::regclass as tbl, conname
--   from pg_constraint where conname like '%\_chars' order by 1, 2;
