-- 120_year_level_follows_grades.sql
--
-- APPLIED 19 Nov 2026 to the CurricuLogic AI project, after a dry run that rolled back (existing students: stored year equals the derived year for all 32;
-- adding Mark Anthony's 8 second-semester grades in one statement moved him from Year 1 to Year 2; deleting them left him at Year 2; 3 of 8 passed stayed Year 1).
-- Checked afterwards: the three triggers exist next to academic_record_autoverify, the 32 students are unchanged, anon cannot run any of the functions.
--
-- A student's year level follows what they have passed (owner's request, 19 Nov 2026: "it must not be static, every semester it
-- will update"). Until now university_student.year_level was written once, at account creation or from the EDP list, and no grade
-- upload ever changed it, so a student who finished Year 1 was still labelled "1st Year" next term.
--
-- Rule: the year is 1 + the number of years of the student's OWN curriculum whose cumulative units they have earned.
--   units earned = the units of the curriculum's subjects that the student has PASSED (matched by subject code, so a record made
--                  under an older curriculum version still counts; each subject once, so a retake does not count twice)
--   thresholds   = cumulative units of years 1, 2, 3, ... of that curriculum (BSIT 2024: 46, 92, 140), the last year has none
--   example      = 46 units earned -> Year 2; 116 -> Year 3; 152 -> Year 4
-- It only ever goes UP: year_level = greatest(stored, derived). A value set on purpose by the EDP list (for example a transferee
-- credited with Year 3 before any grade exists) is a floor, never overwritten downwards.
--
-- It is recomputed by statement-level triggers on academic_record (insert, update, delete), so a bulk grade upload costs one
-- pass, not one per row. year_level_for(student) is the pure rule and can be called on its own. Existing students are brought up
-- to date once, at the end of this file.
--
-- TO UNDO: drop triggers academic_record_year_ins/upd/del, drop functions sync_year_levels_new, sync_year_levels_old,
-- sync_student_year_level and year_level_for. Years already moved up stay as they are.

create or replace function public.year_level_for(p_student uuid)
returns integer
language sql
stable
security definer
set search_path to 'public'
as $function$
    with st as (
        select prospectus_id from university_student where id = p_student
    ),
    mine as (                                    -- the subjects of the student's curriculum, with the year they sit in
        select s.code, s.units, s.year_level
        from subject s join st on s.prospectus_id = st.prospectus_id
        where s.is_active and s.year_level is not null
    ),
    per_year as (
        select year_level, sum(units) as units from mine group by year_level
    ),
    cum as (
        select year_level, sum(units) over (order by year_level) as cum_units from per_year
    ),
    earned as (                                  -- each passed subject once, by code
        select coalesce(sum(m.units), 0) as units
        from mine m
        where exists (
            select 1 from academic_record r join subject rs on rs.id = r.subject_id
            where r.student_id = p_student and r.status = 'PASSED' and rs.code = m.code
        )
    )
    select coalesce(
        1 + (select count(*) from cum, earned
             where cum.year_level < (select max(year_level) from per_year) and earned.units >= cum.cum_units),
        1)::integer;
$function$;

revoke execute on function public.year_level_for(uuid) from public, anon;
grant  execute on function public.year_level_for(uuid) to authenticated;


create or replace function public.sync_student_year_level(p_student uuid)
returns void
language sql
security definer
set search_path to 'public'
as $function$
    update university_student u
       set year_level = public.year_level_for(u.id)
     where u.id = p_student
       and public.year_level_for(u.id) > coalesce(u.year_level, 0);
$function$;

revoke execute on function public.sync_student_year_level(uuid) from public, anon, authenticated;


-- Statement-level: one pass per grade upload, for the students it touched.
create or replace function public.sync_year_levels_new()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
    update university_student u
       set year_level = y.lvl
      from (select s.id, public.year_level_for(s.id) as lvl
              from university_student s
             where s.id in (select distinct student_id from new_rows)) y
     where u.id = y.id and y.lvl > coalesce(u.year_level, 0);
    return null;
end;
$function$;

create or replace function public.sync_year_levels_old()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
    update university_student u
       set year_level = y.lvl
      from (select s.id, public.year_level_for(s.id) as lvl
              from university_student s
             where s.id in (select distinct student_id from old_rows)) y
     where u.id = y.id and y.lvl > coalesce(u.year_level, 0);
    return null;
end;
$function$;

revoke execute on function public.sync_year_levels_new(), public.sync_year_levels_old() from public, anon, authenticated;

drop trigger if exists academic_record_year_ins on public.academic_record;
create trigger academic_record_year_ins after insert on public.academic_record
    referencing new table as new_rows for each statement execute function public.sync_year_levels_new();

drop trigger if exists academic_record_year_upd on public.academic_record;
create trigger academic_record_year_upd after update on public.academic_record
    referencing new table as new_rows for each statement execute function public.sync_year_levels_new();

drop trigger if exists academic_record_year_del on public.academic_record;
create trigger academic_record_year_del after delete on public.academic_record
    referencing old table as old_rows for each statement execute function public.sync_year_levels_old();


-- One-time catch-up for the students who already have grades.
update university_student u
   set year_level = y.lvl
  from (select s.id, public.year_level_for(s.id) as lvl from university_student s) y
 where u.id = y.id and y.lvl > coalesce(u.year_level, 0);
