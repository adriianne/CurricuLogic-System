-- 038_bsit_standing_footnotes.sql
--
-- STATUS: DRAFT. Not applied. Read it, then apply it.
--
-- WHY
--   The BSIT prospectus PDF (2024-2025) prints two footnotes:
--       **  must finish all 1st year to 2nd year courses
--       *** must finish all 1st year to 3rd year courses
--   and marks three subjects with them:
--       CC-PROFIS10   **      (4th year, 1st sem)
--       IT-CPSTONE41  ***     (4th year, 1st sem)
--       CC-PRACT40    ***     (4th year, 2nd sem)
--   The importer had no field for footnotes, so the active BSIT prospectus
--   (id 13) was created without them: it has zero year-standing rules.
--
-- WHAT THIS CHANGES
--   Adds one year-standing rule to each of those three subjects, in the form
--   the engine reads: threshold_value is a position, year*10+term, so
--   22 = "through 2nd year, 2nd sem" and 32 = "through 3rd year, 2nd sem".
--   The rule gets its own rule_group, so it is ANDed with any prerequisite
--   the subject already has. Safe to run twice: a subject that already has a
--   standing rule is skipped.
--
--   EFFECT ON STUDENTS. Once a prospectus has any standing rule it is
--   followed as written: only these three subjects are gated by year, and
--   the system's default gate for 3rd/4th-year subjects stops applying to
--   BSIT. Its other subjects are then controlled by prerequisites alone, as
--   the printed document says.
--
-- HOW TO UNDO: run the ROLLBACK line at the bottom.

insert into public.prerequisite
    (subject_id, prerequisite_subject_id, requirement_type, rule_type, rule_group, threshold_value, created_by)
select s.id,
       null,
       'standing',
       'and',
       coalesce((select max(p.rule_group) from public.prerequisite p where p.subject_id = s.id), 0) + 1,
       g.threshold,
       (select d.id from public.department_staff d
         where d.program_id = (select program_id from public.prospectus where id = s.prospectus_id)
         order by d.created_at limit 1)
from public.subject s
join (values ('CC-PROFIS10', 22),
             ('IT-CPSTONE41', 32),
             ('CC-PRACT40',   32)) as g(code, threshold) on g.code = s.code
where s.prospectus_id = 13
  and not exists (select 1 from public.prerequisite q
                  where q.subject_id = s.id and q.requirement_type = 'standing');


-- ROLLBACK ------------------------------------------------------------------
-- delete from public.prerequisite
--  where requirement_type = 'standing'
--    and subject_id in (select id from public.subject
--                       where prospectus_id = 13
--                         and code in ('CC-PROFIS10', 'IT-CPSTONE41', 'CC-PRACT40'));
