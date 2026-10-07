-- 062: subject codes: one shape, one meaning of "the same code" (input handling, item 5).
-- DRAFT: review, then run once in the Supabase SQL editor.
--
-- Real codes mix styles on purpose (ENGL 101, CC-DATACOM22, IT-NETWORK31), so
-- the code is kept as typed. What was missing:
--   * nothing stopped a code outside the shape the builder allows
--     (shared/js/subjectcode.js): upper case, starting with a letter, then
--     letters, digits, space, hyphen or underscore, at most 20 characters, no
--     doubled or edge spaces
--   * the same subject could be saved twice under different separators in one
--     curriculum: ENGL 101, ENGL-101 and ENGL101 were three rows, because the
--     old unique rule compared the text exactly
--
-- Added here:
--   subject_code_shape        the shape above
--   subject_code_key_unique   at most one subject per curriculum for the same
--                             letters and digits
--
-- Measured on 2026-10-07: all 253 existing subjects already pass both, and no
-- curriculum holds two codes with the same letters and digits.
--
-- Un-numbered elective placeholders (IT-EL, BSN-ELEC) are numbered by the
-- builder before they are saved, so they do not collide.
--
-- Safe to re-run.

begin;

alter table public.subject drop constraint if exists subject_code_shape;
alter table public.subject add constraint subject_code_shape
  check (code ~ '^[A-Z][A-Z0-9 _-]*$'
         and char_length(code) <= 20
         and code = btrim(code)
         and code !~ '  ');

drop index if exists public.subject_code_key_unique;
create unique index subject_code_key_unique
  on public.subject (prospectus_id, (regexp_replace(upper(code), '[^A-Z0-9]', '', 'g')));

commit;

-- To see them:
--   select conname from pg_constraint where conname = 'subject_code_shape';
--   select indexname from pg_indexes where indexname = 'subject_code_key_unique';
