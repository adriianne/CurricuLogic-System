-- 087_expected_student_year_level.sql
--
-- The EDP list may now say which year each student is in (1 to 4). It is optional: a blank stays blank.
-- It is carried onto the account when the Admin creates accounts from the list, so the Registrar and
-- Department can see at a glance who needs grades uploaded before eligibility can be worked out
-- (a 3rd-year student with no record is "being verified" until that is done).
--
-- Nothing reads the new column except the Admin's EDP list page. Safe to re-run.

alter table public.expected_student
    add column if not exists year_level smallint;

alter table public.expected_student
    drop constraint if exists expected_student_year_level_check;
alter table public.expected_student
    add constraint expected_student_year_level_check check (year_level is null or year_level between 1 and 4);
