-- 083_activate_not_post_dated.sql
--
-- APPLIED 19 Oct 2026 to the CurricuLogic AI project (checked 20 Oct: the live function compares the version's year with system_config.current_academic_year).
--
-- A curriculum version whose effective year is later than the current academic year can no longer be
-- made active.
--
-- Why: "active" is the version a newly registered student is placed on. A post-dated active version
-- puts every new student on a curriculum that has not started. The student pages and the two server
-- functions (assess-student, submit-advising-request) now refuse such a student too; this stops the
-- problem at the source.
--
-- What changes: activate_prospectus (db/042, db/082) gets one more check after the "has a schedule"
-- check. The current academic year is system_config.current_academic_year (id = 1). If that is not
-- set, nothing is refused on this account. A version of the current year, or an earlier one, is fine.
--
-- Nothing else changes: same permission checks, same one-active-per-programme switch, same grants.
-- A version that is already active and post-dated is not touched; replace it by activating another
-- version of that programme.

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

    if v_program is distinct from public.my_department_program() then
        raise exception 'You can only activate a curriculum version of your own programme.'
            using errcode = '42501';
    end if;

    if not exists (select 1 from subject where prospectus_id = target_id) then
        raise exception 'That version has no subjects. A student placed on it '
                        'would have no curriculum to be assessed against.'
            using errcode = '22023';
    end if;

    if not exists (
        select 1
        from subject_offering o
        join subject s on s.id = o.subject_id
        where s.prospectus_id = target_id
    ) then
        raise exception 'That version has no schedule yet. Add its sections on the Schedule tab '
                        'first, so a student placed on it has subjects to enrol in.'
            using errcode = '22023';
    end if;

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
