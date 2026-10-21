-- 082_activate_requires_schedule.sql
--
-- APPLIED 19 Oct 2026 to the CurricuLogic AI project (checked: the live function has the new check; anon cannot run it).
--
-- A curriculum version can no longer be made active until at least one of its subjects is scheduled.
--
-- Why: "active" is the version a newly registered student is placed on. A version with subjects but no
-- schedule gives that student a curriculum and nothing to enrol in, and the engine will not recommend a
-- subject that has no offering.
--
-- What changes: activate_prospectus (db/042) gets one more check, after the "has subjects" check. It looks
-- for any subject_offering row, in ANY term, for a subject of that version. Any term, not only the current
-- one, because a term's schedule is often posted after the version is activated; the point is that the
-- version has been scheduled at all, not that this term is ready.
--
-- Nothing else changes: same permission checks, same one-active-per-programme switch, same grants.
-- The version that is active today is not touched by this; it only applies the next time someone activates.

create or replace function public.activate_prospectus(target_id integer)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
    v_program integer;
begin
    if not exists (
        select 1 from department_staff
        where user_id = auth.uid() and is_approved
    ) then
        raise exception 'Only Department Staff can activate a curriculum version.'
            using errcode = '42501';
    end if;

    select program_id into v_program from prospectus where id = target_id;

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
