-- 039_sample_schedule.sql  (DRAFT: nothing has been applied)
--
-- A SAMPLE class schedule for the current term (AY 2023, 1st sem), so the
-- Android Plan tab (section picker, Schedule tab) and the website's schedule
-- features have something real to show. Test data only.
--
-- What it makes: for the three active programme prospectuses (BSIT 13,
-- BSCRIM 18, BSN 20), every regular (non-elective) 1st-semester subject gets
-- two sections, A and B, at different times of day. Subjects with 4+ units or
-- a CC-/IT- code also get a lab. The patterns cycle, so some subjects overlap
-- on purpose: that is what lets you see the overlap warnings.
--
-- Every row has an edp_code starting with SAMPLE-, so the whole thing can be
-- removed again with the ROLLBACK statement at the bottom. Safe to re-run:
-- rows that already exist are skipped.
--
-- Side effect worth knowing: once a term has ANY schedule rows, the rules
-- engine only recommends subjects that are offered, and marks others "not
-- scheduled this term". That is the intended behaviour, and what you will see
-- for 2nd-semester subjects (no rows) while this data is in.

insert into public.subject_offering
    (subject_id, academic_year, term, section, edp_code, meeting_type, schedule_days, start_time, end_time, room, is_open)
with pats(i, days, s, e) as (
    values
        (0, 'MW',  '08:00', '09:30'),
        (1, 'MW',  '10:00', '11:30'),
        (2, 'TTH', '08:00', '09:30'),
        (3, 'TTH', '10:00', '11:30'),
        (4, 'MW',  '13:00', '14:30'),
        (5, 'TTH', '13:00', '14:30'),
        (6, 'F',   '08:00', '11:00'),
        (7, 'MW',  '15:00', '16:30'),
        (8, 'TTH', '15:00', '16:30')
),
subs as (
    select s.id, pr.code as prog, s.year_level as yl, s.code, s.units,
           row_number() over (partition by s.prospectus_id order by s.year_level, s.code) - 1 as n
    from public.subject s
    join public.prospectus p on p.id = s.prospectus_id
    join public.program pr   on pr.id = p.program_id
    where s.prospectus_id in (13, 18, 20)
      and s.term = 1
      and s.year_level is not null
      and coalesce(s.is_active, true)
      and not coalesce(s.is_elective, false)
      and s.elective_type is null
),
secs as (
    select subs.*, sec.letter, sec.shift
    from subs
    cross join (values ('A', 0), ('B', 4)) as sec(letter, shift)
),
rows_ as (
    -- the lecture
    select secs.id as subject_id,
           secs.prog || '-' || secs.yl || secs.letter as section,
           'SAMPLE-' || secs.id || secs.letter || '-LEC' as edp_code,
           'LEC' as meeting_type,
           pats.days, pats.s::time as start_time, pats.e::time as end_time,
           'Room ' || (100 + (secs.n % 20) * 2 + (case secs.letter when 'A' then 0 else 1 end)) as room
    from secs
    join pats on pats.i = (secs.n + secs.shift) % 9

    union all

    -- the lab, for 4+ unit subjects and computing subjects
    select secs.id,
           secs.prog || '-' || secs.yl || secs.letter,
           'SAMPLE-' || secs.id || secs.letter || '-LAB',
           'LAB',
           case secs.letter when 'A' then 'F' else 'S' end,
           (case secs.letter when 'A' then '13:00' else '08:00' end)::time,
           (case secs.letter when 'A' then '16:00' else '11:00' end)::time,
           'Lab ' || (1 + secs.n % 4)
    from secs
    where secs.units >= 4 or secs.code ~ '^(CC|IT)-'
)
select r.subject_id, 2023, 1, r.section, r.edp_code, r.meeting_type, r.days, r.start_time, r.end_time, r.room, true
from rows_ r
on conflict do nothing;

-- Check: how many sections per programme were made.
-- select pr.code, count(distinct (o.subject_id, o.section)) sections, count(*) meeting_rows
-- from public.subject_offering o
-- join public.subject s on s.id = o.subject_id
-- join public.prospectus p on p.id = s.prospectus_id
-- join public.program pr on pr.id = p.program_id
-- where o.edp_code like 'SAMPLE-%'
-- group by pr.code order by pr.code;

-- ROLLBACK (removes only the sample rows):
-- delete from public.subject_offering where edp_code like 'SAMPLE-%';
