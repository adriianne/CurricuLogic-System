-- 130_prospectus_one_per_year.sql
-- 21 Nov 2026
--
-- A programme can hold only ONE curriculum version per academic year.
--
-- Until now nothing in the database stopped two prospectus rows for the same programme and the same year (the page
-- checked the list it had loaded, which a second tab or a slow reload can make stale). Two rows for one year would make
-- "the 2024 curriculum" mean two different things.
--
-- Safe to apply: checked on 21 Nov 2026, no programme has the same year twice. If this ever fails with a duplicate key
-- error, find the pairs first:
--     select program_id, academic_year, array_agg(id) from prospectus group by 1,2 having count(*) > 1;
-- A row with no year (academic_year is null) is not counted; null never equals null in a unique index.

create unique index if not exists prospectus_program_year_key
    on public.prospectus (program_id, academic_year);
