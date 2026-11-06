-- 103_autoverify_definer.sql
--
-- Bug fix for db/096, found 6 Nov 2026 while testing db/102.
--
-- student_autoverify() looks at academic_record to decide whether a student above first year already has grades.
-- It ran with the rights of the person registering (a signed-out visitor), who may not read academic_record, so the
-- registration of any student of year 2 or higher failed with "permission denied for table academic_record". First-years
-- were fine because the year check ends the test before the table is read.
--
-- The function now runs with its owner's rights and a fixed search_path, and is still not callable by anyone.
--
-- TO UNDO: re-run db/096 (not recommended: it brings the bug back).
-- Safe to re-run.

create or replace function public.student_autoverify()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
    if new.is_approved is true and new.record_verified is not true
       and (coalesce(new.year_level, 1) <= 1
            or exists (select 1 from public.academic_record r where r.student_id = new.id)) then
        new.record_verified := true;
        new.verified_at := coalesce(new.verified_at, now());
    end if;
    return new;
end;
$$;

revoke all on function public.student_autoverify() from public, anon, authenticated;
