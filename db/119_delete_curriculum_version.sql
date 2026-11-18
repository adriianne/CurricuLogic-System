-- 119_delete_curriculum_version.sql
--
-- APPLIED 17 Nov 2026 to the CurricuLogic AI project, after dry runs that rolled back as the Department account, with a temporary student and a grade record:
-- check mode reports the counts and where students go; a grade record makes it refuse; a real delete moves the student to the active version; a direct
-- DELETE by a signed-in user is still blocked; deleting the active version with no fallback is refused; deleting the active version with a fallback makes
-- that one active again and writes the audit row. Checked afterwards: the function exists, anon cannot run it, no version changed, no test data left.
--
-- A curriculum version activated by mistake can be deleted (owner's request, 17 Nov 2026). Without this, a draft with mistakes that was
-- made active could not be removed (the active version is protected, db/118 blocks deleting a published one, and db/117 refuses to make an
-- older version active again), so the mistake would be stuck.
--
-- delete_curriculum_version(target_id, confirm):
--   confirm = false  -> checks and reports what WOULD happen (counts, where students would go); changes nothing.
--   confirm = true   -> does it.
-- Refused (nothing changes) when the version has real history: grade records (academic_record), grade-upload rows, or advising
-- requests / request items that use it. Deleting those would damage transcripts, so the answer is Retire. A mistake caught before anyone
-- has grades under it passes all of these.
-- Students on the version are MOVED to the curriculum that stays: the active one, or, if the version being deleted IS the active one, the
-- newest other published (not retired) version of the programme, which becomes active again. That is the only time the default goes
-- back, and only through this function. If there is nowhere to go, it is refused.
-- Its sections (subject_offering) go with it (cascade, as for any subject). Every deletion writes DELETE_CURRICULUM to the audit log.
--
-- The trigger from db/118 still blocks every other way of deleting a published version; this function lifts it for its own delete only,
-- through a transaction-local setting.
--
-- TO UNDO the function: drop function public.delete_curriculum_version(integer, boolean); restore the trigger function from db/118.

create or replace function public.prospectus_block_published_delete()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
    if auth.uid() is not null
       and old.published_at is not null
       and coalesce(current_setting('curriculogic.allow_version_delete', true), '') <> old.id::text then
        raise exception 'A published curriculum cannot be deleted. Retire it instead, so it can be restored for a returning student.'
            using errcode = '22023';
    end if;
    return old;
end;
$function$;


create or replace function public.delete_curriculum_version(target_id integer, confirm boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
    v          record;
    sub_ids    integer[];
    sub_count  integer := 0;
    off_count  integer := 0;
    stu_count  integer := 0;
    acad       integer := 0;
    gfr        integer := 0;
    reqs       integer := 0;
    reqitems   integer := 0;
    dest       record;
    dest_note  text;
begin
    select id, academic_year, is_active, published_at, program_id into v from prospectus where id = target_id;

    -- Same answer for "does not exist" and "not yours", so this cannot be used to discover versions.
    if auth.uid() is null or v.id is null or not public.department_covers_program(v.program_id) then
        raise exception 'Only the Department Staff of this programme can delete a curriculum version.' using errcode = '42501';
    end if;

    select array_agg(id) into sub_ids from subject where prospectus_id = target_id;
    sub_count := coalesce(array_length(sub_ids, 1), 0);

    if sub_count > 0 then
        select count(*) into acad     from academic_record where subject_id = any(sub_ids);
        select count(*) into gfr      from grade_file_row  where subject_id = any(sub_ids);
        select count(*) into reqitems from request_item    where subject_id = any(sub_ids);
        select count(*) into off_count from subject_offering where subject_id = any(sub_ids);
    end if;
    select count(*) into reqs     from request           where prospectus_id = target_id;
    select count(*) into stu_count from university_student where prospectus_id = target_id;

    if acad > 0 then
        return jsonb_build_object('ok', false, 'error',
            format('%s grade record(s) of students use this curriculum. Deleting it would damage their transcripts. Retire it instead.', acad));
    end if;
    if gfr > 0 then
        return jsonb_build_object('ok', false, 'error',
            format('%s grade upload row(s) use this curriculum. Retire it instead.', gfr));
    end if;
    if reqs > 0 or reqitems > 0 then
        return jsonb_build_object('ok', false, 'error',
            format('%s advising request(s) use this curriculum. Resolve them first, or retire it instead.', greatest(reqs, reqitems)));
    end if;

    -- Where the students (and the default) go.
    if v.is_active then
        select id, academic_year into dest from prospectus
        where program_id = v.program_id and id <> target_id and published_at is not null and retired_at is null
        order by academic_year desc, id desc limit 1;
        if dest.id is null then
            return jsonb_build_object('ok', false, 'error',
                'This is the active curriculum and there is no other published curriculum to fall back to. Publish or activate another version first.');
        end if;
        dest_note := 'becomes the active curriculum again';
    else
        select id, academic_year into dest from prospectus
        where program_id = v.program_id and is_active and id <> target_id limit 1;
        if dest.id is null and stu_count > 0 then
            return jsonb_build_object('ok', false, 'error',
                'There is no active curriculum to move the students to. Make a version active first.');
        end if;
        dest_note := 'stays the active curriculum';
    end if;

    if not confirm then
        return jsonb_build_object('ok', true, 'check', true,
            'academic_year', v.academic_year, 'was_active', v.is_active,
            'subjects', sub_count, 'sections', off_count, 'students', stu_count,
            'moves_to_year', dest.academic_year, 'becomes_active', v.is_active);
    end if;

    -- Do it. The trigger from db/118 is told which version may go.
    perform set_config('curriculogic.allow_version_delete', target_id::text, true);

    if stu_count > 0 then
        update university_student set prospectus_id = dest.id where prospectus_id = target_id;
    end if;

    if sub_count > 0 then
        delete from prerequisite where subject_id = any(sub_ids) or prerequisite_subject_id = any(sub_ids);
    end if;
    delete from elective_group_member where elective_group_id in (select id from elective_group where prospectus_id = target_id);
    delete from elective_group where prospectus_id = target_id;
    delete from subject where prospectus_id = target_id;       -- its sections go with it (cascade)
    delete from prospectus where id = target_id;

    if v.is_active then
        update prospectus set is_active = true, updated_at = now() where id = dest.id;
    end if;

    insert into audit_log (actor_id, actor_role, action, table_name, record_id, old_values, new_values)
    values (auth.uid(), 'department', 'DELETE_CURRICULUM', 'prospectus', target_id::text,
            jsonb_build_object('academic_year', v.academic_year, 'was_active', v.is_active, 'subjects', sub_count, 'sections', off_count, 'students', stu_count),
            jsonb_build_object('students_moved_to_year', dest.academic_year, 'active_year_after', case when v.is_active then dest.academic_year else null end));

    return jsonb_build_object('ok', true, 'deleted', true,
        'academic_year', v.academic_year, 'subjects', sub_count, 'sections', off_count, 'students', stu_count,
        'moves_to_year', dest.academic_year, 'becomes_active', v.is_active);
end;
$function$;

revoke execute on function public.delete_curriculum_version(integer, boolean) from public, anon;
grant  execute on function public.delete_curriculum_version(integer, boolean) to authenticated;
