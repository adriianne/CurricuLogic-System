-- 081_preference_compact.sql
--
-- DRAFT, NOT APPLIED. Read it, then run it in the Supabase SQL editor (or ask for it to be applied).
--
-- "Free time between classes: fewest gaps" (a third preference beside class time and load).
--
-- One new column on student_preference (db/037): compact, true when the student asked for classes close
-- together. False by default, so every existing row keeps behaving exactly as before.
--
-- Nothing else changes: the row-level rules in 037 apply to the whole row, so a student can still read and
-- change only their own preference, and the table grants are unchanged.
--
-- Until this is applied the apps still work: the website and the server read and save the two older columns
-- on their own, and the fewest-gaps choice is kept in that browser only.
--
-- HOW TO UNDO: run the ROLLBACK block at the bottom.

alter table public.student_preference
    add column if not exists compact boolean not null default false;


-- ROLLBACK ------------------------------------------------------------------
-- alter table public.student_preference drop column if exists compact;
