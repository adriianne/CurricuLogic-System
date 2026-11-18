-- 116_activate_without_schedule.sql
--
-- APPLIED 17 Nov 2026 to the CurricuLogic AI project, after a dry run that rolled back: before the change activating the 2024-2025
-- draft was refused with "That version has no schedule yet"; after it, the same call succeeded and only that version was active.
-- Checked afterwards: the live function has no schedule check, still has the programme, subjects and year checks, and anon cannot run it.
--
-- A curriculum version can be made active BEFORE it has a schedule. This reverses the schedule check added in
-- db/082 (19 Oct 2026).
--
-- Why: a curriculum is the permanent structure and a schedule is per term, so the natural order is the one the owner
-- asked for on 17 Nov 2026: create the curriculum, make it active, then add the schedule. db/082 forced the reverse and
-- left a first-time setup with no way to activate until sections had been entered for a curriculum that was not
-- active yet. The student side already copes with a subject that has no schedule yet: the engine judges eligibility by
-- the curriculum alone and the subject says so (tests/assess-student.test.mjs, tests/engine.test.mjs, tests/preferences.test.mjs),
-- and the Department Dashboard has a state for it ("No schedule is published yet").
--
-- What changes: activate_prospectus loses ONE check, the one that raised "That version has no schedule yet".
-- Everything else is the live function as it is today (it already uses department_covers_program, db/114):
--   * only approved Department staff may activate;
--   * the version must exist and belong to a programme the caller covers;
--   * the version must have subjects;
--   * its year must not be later than the current academic year (db/083);
--   * one active version per programme: the previous one is deactivated first.
-- Same signature, same security definer, same grants (authenticated and service_role may run it; anon may not).
--
-- TO UNDO: re-create the function from db/083 as amended by db/114 (it has the extra "no schedule yet" check).

create or replace function public.activate_prospectus(target_id integer)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
    v_program integer;
    v_year    integer;
    v_current integer;
begin
    if not exists (
        select 1 from department_staff
        where user_id = auth.uid() and is_approved
    ) then
        raise exception 'Only Department Staff can activate a curriculum version.'
            using errcode = '42501';
    end if;

    select program_id, academic_year into v_program, v_year from prospectus where id = target_id;

    if v_program is null then
        raise exception 'No such prospectus version.' using errcode = '22023';
    end if;

    if not public.department_covers_program(v_program) then
        raise exception 'You can only activate a curriculum version of your own programme.'
            using errcode = '42501';
    end if;

    if not exists (select 1 from subject where prospectus_id = target_id) then
        raise exception 'That version has no subjects. A student placed on it '
                        'would have no curriculum to be assessed against.'
            using errcode = '22023';
    end if;

    -- (db/116) The "has a schedule" check that used to be here is gone: a schedule is added after the curriculum is active.

    select current_academic_year into v_current from system_config where id = 1;

    if v_current is not null and v_year > v_current then
        raise exception 'That version takes effect in % (the system is on %). A student placed on it '
                        'would have a curriculum that has not started. Activate it when its year begins.',
                        v_year, v_current
            using errcode = '22023';
    end if;

    -- One active version per programme. Deactivate first so the partial
    -- unique index is never momentarily violated.
    update prospectus set is_active = false, updated_at = now()
    where program_id = v_program and is_active and id <> target_id;

    update prospectus
    set is_active = true, published_at = coalesce(published_at, now()),
        updated_at = now()
    where id = target_id;
end;
$function$;

-- create or replace keeps the existing grants; stated again so the file stands on its own.
revoke execute on function public.activate_prospectus(integer) from public, anon;
grant  execute on function public.activate_prospectus(integer) to authenticated;
