-- 031_program_unit_limits.sql
--
-- WHY
--   The advising engine capped every student at 24 units (27 when
--   graduating) and the curriculum builder expected 176 total units,
--   both BSIT numbers. Other programmes differ.
--
-- WHAT THIS CHANGES
--   Adds three columns to program. Existing rows get the old numbers,
--   so behaviour is unchanged until a programme's values are edited.
--     max_units             per-term cap
--     max_units_graduating  per-term cap for a student finishing the degree
--     target_units          expected total for a full curriculum (advisory)
--
-- ROLLBACK
--   alter table program drop column max_units,
--     drop column max_units_graduating, drop column target_units;

alter table program
  add column if not exists max_units integer not null default 24 check (max_units > 0),
  add column if not exists max_units_graduating integer not null default 27 check (max_units_graduating > 0),
  add column if not exists target_units integer not null default 176 check (target_units > 0);
