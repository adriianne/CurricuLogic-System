-- 121_elective_standing_rules.sql
--
-- APPLIED 19 Nov 2026 to the CurricuLogic AI project, after a dry run that rolled back (8 rows added, a second run adds 0). Checked afterwards: the curriculum has
-- 11 standing rules (the original 3 plus these 8), the 2023 and 2020 versions are untouched, and on Mark Anthony's dashboard (Year 2) eligible went from 26 to 18
-- with none of the eight electives open to him.
--
-- The year-standing footnotes of the printed BSIT 2024-2025 elective lists were never stored (19 Nov 2026). The prospectus says, under
-- the IT and Free elective course lists:
--     **   must finish all 1st year to 2nd year courses     (standing through Year 2 = position 22)
--     ***  must finish all 1st year to 3rd year courses     (standing through Year 3 = position 32)
-- and marks eight courses with them. Our database held no rule for any of the eight, so the engine treated them as open to everyone:
-- a Year 2 student was shown ELAI, ELASI and ELPYTHON as the choices for his IT Elective slot.
--
--   **   ELPYTHON, FREFORLAN, FREIP, FRETRNDS, FREKYI      -> standing 22
--   ***  ELAI, ELASI, FRECERT                              -> standing 32
--
-- Same shape as the three standing rules already there (CC-PROFIS10 22, IT-CPSTONE41 32, CC-PRACT40 32): requirement_type 'standing', no
-- prerequisite subject, rule_group 1, created_by the Department account that holds the other rules of this curriculum (the same user as the
-- existing standing rules). Only prospectus 30 (BSIT 2024-2025, the active curriculum) is changed; the 2023 and 2020 versions
-- are not touched. Safe to re-run: a rule that already exists is not added twice.
--
-- The elective SLOTS (IT Elective 1 to 3, Free Elective 1 to 3) have no rule in the prospectus and are left as they are.
--
-- TO UNDO: delete from prerequisite where requirement_type = 'standing' and subject_id in (the eight) and threshold_value in (22, 32).

insert into public.prerequisite (subject_id, prerequisite_subject_id, requirement_type, rule_type, rule_group, threshold_value, created_by)
select s.id, null, 'standing', 'and', 1, t.threshold,
       (select p0.created_by from public.prerequisite p0 join public.subject s0 on s0.id = p0.subject_id
         where s0.prospectus_id = 30 and p0.requirement_type = 'standing' and p0.created_by is not null limit 1)
from public.subject s
join (values
        ('ELPYTHON',  22), ('FREFORLAN', 22), ('FREIP',  22), ('FRETRNDS', 22), ('FREKYI', 22),
        ('ELAI',      32), ('ELASI',     32), ('FRECERT', 32)
     ) as t(code, threshold) on t.code = s.code
where s.prospectus_id = 30
  and not exists (
        select 1 from public.prerequisite p
        where p.subject_id = s.id and p.requirement_type = 'standing' and p.threshold_value = t.threshold);
