-- 117_activate_forward_only_and_publish.sql
--
-- APPLIED 17 Nov 2026 to the CurricuLogic AI project, after a dry run that rolled back. Dry run as the Department account: activating 2020 or 2023
-- (older than the active 2024) was refused; publishing the active 2024 was refused; publishing 2023 worked and left 2024 active; re-activating 2024 worked;
-- a user who is not Department staff was refused. Checked afterwards: both functions exist, anon cannot run them, no version changed.
--
-- Two changes to how a curriculum version becomes available, asked for on 17 Nov 2026:
--
-- 1. The default curriculum can only move FORWARD. activate_prospectus refuses a version whose year is older than the version
--    that is active now. "Active" is where a student with a blank curriculum year is placed, so an accidental click on an
--    old version would have put every new student on it (it nearly happened on 17 Nov: 2020-2021 was activated by mistake).
--    The same year as the active one is fine (it is a no-op re-activation); no active version at all is fine (first activation).
--
-- 2. publish_prospectus(target_id) is new: it makes a version available to students (published_at is set, so a student can be
--    placed on it with a curriculum_year) WITHOUT making it the default. This is how an OLDER curriculum uploaded later is put
--    into use. It is refused for a version that is newer than the active one (that one is made active instead), for the active
--    version (already available), for a version with no subjects, for a future year, and for another programme's version.
--
-- Same permission model as activate_prospectus: approved Department staff, own programme (department_covers_program).
-- Nothing is changed for versions that already exist.
--
-- TO UNDO: re-run db/116 (activate without the forward-only rule) and drop function public.publish_prospectus(integer).

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
    v_active  integer;
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

    select current_academic_year into v_current from system_config where id = 1;

    if v_current is not null and v_year > v_current then
        raise exception 'That version takes effect in % (the system is on %). A student placed on it '
                        'would have a curriculum that has not started. Activate it when its year begins.',
                        v_year, v_current
            using errcode = '22023';
    end if;

    -- (db/117) The default only moves forward.
    select max(academic_year) into v_active
    from prospectus where program_id = v_program and is_active and id <> target_id;

    if v_active is not null and v_year < v_active then
        raise exception 'The % curriculum is older than the active % curriculum. The default can only move forward, '
                        'so new students are never placed on an older curriculum by mistake. '
                        'To let students be placed on the older one, use Publish instead.',
                        v_year, v_active
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

revoke execute on function public.activate_prospectus(integer) from public, anon;
grant  execute on function public.activate_prospectus(integer) to authenticated;


create or replace function public.publish_prospectus(target_id integer)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
    v_program   integer;
    v_year      integer;
    v_is_active boolean;
    v_current   integer;
    v_active    integer;
begin
    if not exists (
        select 1 from department_staff
        where user_id = auth.uid() and is_approved
    ) then
        raise exception 'Only Department Staff can publish a curriculum version.'
            using errcode = '42501';
    end if;

    select program_id, academic_year, is_active into v_program, v_year, v_is_active
    from prospectus where id = target_id;

    if v_program is null then
        raise exception 'No such prospectus version.' using errcode = '22023';
    end if;

    if not public.department_covers_program(v_program) then
        raise exception 'You can only publish a curriculum version of your own programme.'
            using errcode = '42501';
    end if;

    if v_is_active then
        raise exception 'That version is already the active curriculum.' using errcode = '22023';
    end if;

    if not exists (select 1 from subject where prospectus_id = target_id) then
        raise exception 'That version has no subjects, so there is nothing to publish.'
            using errcode = '22023';
    end if;

    select current_academic_year into v_current from system_config where id = 1;
    if v_current is not null and v_year > v_current then
        raise exception 'That version takes effect in % (the system is on %). Publish it when its year begins.',
                        v_year, v_current
            using errcode = '22023';
    end if;

    select max(academic_year) into v_active from prospectus where program_id = v_program and is_active;

    if v_active is null or v_year >= v_active then
        raise exception 'Only a version older than the active curriculum is published this way. '
                        'A newer version is made active instead.'
            using errcode = '22023';
    end if;

    update prospectus
    set published_at = coalesce(published_at, now()), updated_at = now()
    where id = target_id;
end;
$function$;

revoke execute on function public.publish_prospectus(integer) from public, anon;
grant  execute on function public.publish_prospectus(integer) to authenticated;
