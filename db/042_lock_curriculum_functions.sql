-- 042_lock_curriculum_functions.sql
--
-- Security fix found by testing on 2026-10-03.
--
-- 1. delete_draft_prospectus() could be called by anyone, even signed out, with
--    only the public API key. It checked no caller and no programme, so any
--    unused draft or old prospectus of ANY programme could be deleted (with its
--    subjects, prerequisites, elective groups and AI recommendations).
-- 2. activate_prospectus(), retire_subject() and update_subject() checked that
--    the caller was SOME approved department account, but not that the
--    prospectus or subject belongs to THEIR programme. A BSIT department
--    account could activate, retire or edit BSN curriculum.
--
-- After this migration all four require an approved department account whose
-- programme owns the prospectus (or the subject's prospectus), and the signed-out
-- (anon) and public roles can no longer execute them at all. The only caller in
-- the app is the department dashboard, which is signed in as that programme's
-- department account, so nothing it does today changes.
--
-- TO APPLY: run this file in the Supabase SQL editor.
-- TO CHECK AFTERWARDS: a signed-out call to delete_draft_prospectus must return
-- an error (permission denied), and the department dashboard must still be able
-- to delete a draft, activate a version, edit and retire a subject.
-- TO UNDO: re-run the previous definitions of these four functions and
-- grant execute to the roles you want.

-- ---------------------------------------------------------------------
-- delete_draft_prospectus: add the caller + programme check at the top.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_draft_prospectus(target_id integer, confirm boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    p_record       RECORD;
    sub_ids        INT[];
    ai_ids         INT[];
    sub_count      INT := 0;
    prereq_count   INT := 0;
    eg_count       INT := 0;
    egm_count      INT := 0;
    ai_count       INT := 0;
    ri_count       INT := 0;
    req_count      INT := 0;
    reqitem_count  INT := 0;
    stu_count      INT := 0;
    acad_count     INT := 0;
    gfr_count      INT := 0;
BEGIN
    SELECT id, academic_year, is_active, program_id
      INTO p_record
      FROM prospectus
     WHERE id = target_id;

    -- Same message whether the version does not exist or belongs to another
    -- programme, so this cannot be used to discover which versions exist.
    IF auth.uid() IS NULL
       OR public.my_department_program() IS NULL
       OR p_record.program_id IS DISTINCT FROM public.my_department_program() THEN
        RAISE EXCEPTION 'Only the Department Staff of this programme can delete a curriculum version.'
            USING ERRCODE = '42501';
    END IF;

    IF p_record.is_active THEN
        RETURN jsonb_build_object(
            'ok', false,
            'error', 'Cannot delete the active version. Make another version active first.'
        );
    END IF;

    SELECT ARRAY_AGG(id) INTO sub_ids FROM subject WHERE prospectus_id = target_id;
    sub_count := COALESCE(array_length(sub_ids, 1), 0);

    IF sub_count > 0 THEN
        SELECT COUNT(*) INTO prereq_count
          FROM prerequisite
         WHERE subject_id = ANY(sub_ids)
            OR prerequisite_subject_id = ANY(sub_ids);

        SELECT COUNT(*) INTO acad_count
          FROM academic_record WHERE subject_id = ANY(sub_ids);

        SELECT COUNT(*) INTO gfr_count
          FROM grade_file_row WHERE subject_id = ANY(sub_ids);

        SELECT COUNT(*) INTO reqitem_count
          FROM request_item WHERE subject_id = ANY(sub_ids);
    END IF;

    SELECT COUNT(*) INTO eg_count FROM elective_group WHERE prospectus_id = target_id;
    IF eg_count > 0 THEN
        SELECT COUNT(*) INTO egm_count
          FROM elective_group_member
         WHERE elective_group_id IN (
             SELECT id FROM elective_group WHERE prospectus_id = target_id
         );
    END IF;

    SELECT ARRAY_AGG(id) INTO ai_ids FROM ai_recommendation WHERE prospectus_id = target_id;
    ai_count := COALESCE(array_length(ai_ids, 1), 0);
    IF ai_count > 0 THEN
        SELECT COUNT(*) INTO ri_count
          FROM recommendation_item WHERE recommendation_id = ANY(ai_ids);
    END IF;

    SELECT COUNT(*) INTO req_count FROM request WHERE prospectus_id = target_id;
    SELECT COUNT(*) INTO stu_count FROM university_student WHERE prospectus_id = target_id;

    -- Refusal checks, evaluated in BOTH modes, so the frontend knows upfront
    -- that the delete would be refused and never opens the confirmation modal
    -- just to fail at the end.
    IF stu_count > 0 THEN
        RETURN jsonb_build_object('ok', false,
            'error', format('%s student(s) are still enrolled under this version. Move them to another version first.', stu_count));
    END IF;

    IF acad_count > 0 THEN
        RETURN jsonb_build_object('ok', false,
            'error', format('%s academic record(s) reference subjects in this version — deleting would lose those grades from student transcripts.', acad_count));
    END IF;

    IF gfr_count > 0 THEN
        RETURN jsonb_build_object('ok', false,
            'error', format('%s grade upload row(s) reference subjects in this version.', gfr_count));
    END IF;

    IF req_count > 0 THEN
        RETURN jsonb_build_object('ok', false,
            'error', format('%s request(s) reference this version. Resolve them first.', req_count));
    END IF;

    IF reqitem_count > 0 THEN
        RETURN jsonb_build_object('ok', false,
            'error', format('%s request item(s) reference subjects in this version.', reqitem_count));
    END IF;

    -- Check-only mode: everything is clear, report what WOULD go.
    IF NOT confirm THEN
        RETURN jsonb_build_object(
            'ok', true,
            'check', true,
            'academic_year',        p_record.academic_year,
            'subjects',             sub_count,
            'prerequisites',        prereq_count,
            'elective_groups',      eg_count,
            'elective_members',     egm_count,
            'ai_recommendations',   ai_count,
            'recommendation_items', ri_count
        );
    END IF;

    -- Cascade delete in FK-safe order.
    IF sub_count > 0 THEN
        DELETE FROM prerequisite
         WHERE subject_id = ANY(sub_ids)
            OR prerequisite_subject_id = ANY(sub_ids);
        DELETE FROM recommendation_item WHERE subject_id = ANY(sub_ids);
    END IF;

    IF ai_count > 0 THEN
        DELETE FROM ai_recommendation WHERE id = ANY(ai_ids);
    END IF;

    IF eg_count > 0 THEN
        DELETE FROM elective_group_member
         WHERE elective_group_id IN (
             SELECT id FROM elective_group WHERE prospectus_id = target_id
         );
    END IF;

    DELETE FROM elective_group WHERE prospectus_id = target_id;
    DELETE FROM subject        WHERE prospectus_id = target_id;
    DELETE FROM prospectus     WHERE id = target_id;

    RETURN jsonb_build_object(
        'ok', true, 'deleted', true,
        'academic_year',        p_record.academic_year,
        'subjects',             sub_count,
        'prerequisites',        prereq_count,
        'elective_groups',      eg_count,
        'elective_members',     egm_count,
        'ai_recommendations',   ai_count,
        'recommendation_items', ri_count
    );
END;
$function$;

-- ---------------------------------------------------------------------
-- activate_prospectus: the version must belong to the caller's programme.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.activate_prospectus(target_id integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

-- ---------------------------------------------------------------------
-- retire_subject: the subject must belong to the caller's programme.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.retire_subject(target_id integer, restore boolean DEFAULT false, confirm boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_staff     uuid;
    v_code      text;
    v_program   integer;
    v_records   integer;
    v_dependent text[];
    v_offerings integer;
begin
    select id into v_staff from department_staff
    where user_id = auth.uid() and is_approved;

    if v_staff is null then
        raise exception 'Only Department Staff can retire a subject.'
            using errcode = '42501';
    end if;

    select s.code, p.program_id into v_code, v_program
    from subject s
    join prospectus p on p.id = s.prospectus_id
    where s.id = target_id;

    if v_code is null then
        raise exception 'No such subject.' using errcode = '22023';
    end if;

    if v_program is distinct from public.my_department_program() then
        raise exception 'You can only retire a subject of your own programme.'
            using errcode = '42501';
    end if;

    if restore then
        update subject
        set is_active = true, retired_at = null, retired_by = null,
            updated_at = now()
        where id = target_id;

        return jsonb_build_object('done', true, 'code', v_code, 'restored', true);
    end if;

    -- How many students have taken it. Not a blocker: their records stay
    -- readable either way. It is the number that tells the operator this
    -- subject has history.
    select count(*) into v_records
    from academic_record where subject_id = target_id;

    -- Subjects that require this one. Deactivating it leaves them with a
    -- condition no student can ever satisfy, which blocks them silently —
    -- the one consequence nothing else in the system would surface.
    select array_agg(distinct s.code order by s.code) into v_dependent
    from prerequisite p
    join subject s on s.id = p.subject_id
    where p.prerequisite_subject_id = target_id and s.is_active;

    select count(*) into v_offerings
    from subject_offering where subject_id = target_id;

    if not confirm then
        return jsonb_build_object(
            'done',       false,
            'code',       v_code,
            'records',    v_records,
            'dependents', coalesce(v_dependent, array[]::text[]),
            'offerings',  v_offerings
        );
    end if;

    update subject
    set is_active = false, retired_at = now(), retired_by = v_staff,
        updated_at = now()
    where id = target_id;

    insert into audit_log (actor_id, actor_role, action, table_name, record_id, new_values)
    values (auth.uid(), 'department_staff', 'RETIRE_SUBJECT', 'subject',
            target_id::text,
            jsonb_build_object('code', v_code, 'records', v_records,
                               'dependents', coalesce(v_dependent, array[]::text[])));

    return jsonb_build_object('done', true, 'code', v_code,
                              'records', v_records,
                              'dependents', coalesce(v_dependent, array[]::text[]));
end;
$function$;

-- ---------------------------------------------------------------------
-- update_subject: the subject must belong to the caller's programme.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_subject(target_id integer, p_code text, p_title text, p_lec numeric, p_lab numeric, p_year integer DEFAULT NULL::integer, p_term integer DEFAULT NULL::integer, p_category text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_staff   uuid;
    v_old     record;
    v_program integer;
    v_units   numeric;
begin
    select id into v_staff from department_staff
    where user_id = auth.uid() and is_approved;

    if v_staff is null then
        raise exception 'Only Department Staff can edit a subject.'
            using errcode = '42501';
    end if;

    select * into v_old from subject where id = target_id;
    if v_old.id is null then
        raise exception 'No such subject.' using errcode = '22023';
    end if;

    select program_id into v_program from prospectus where id = v_old.prospectus_id;
    if v_program is distinct from public.my_department_program() then
        raise exception 'You can only edit a subject of your own programme.'
            using errcode = '42501';
    end if;

    if coalesce(trim(p_code), '') = '' then
        raise exception 'Code is required.' using errcode = '22023';
    end if;

    if trim(p_code) !~ '^[A-Za-z][A-Za-z0-9 _-]*$' then
        raise exception 'Code must start with a letter.' using errcode = '22023';
    end if;

    if coalesce(trim(p_title), '') = '' then
        raise exception 'Title is required.' using errcode = '22023';
    end if;

    if p_title !~ '[A-Za-z]' then
        raise exception 'Title must contain words, not only numbers.'
            using errcode = '22023';
    end if;

    v_units := coalesce(p_lec, 0) + coalesce(p_lab, 0);
    if v_units <= 0 then
        raise exception 'Units must be more than zero.' using errcode = '22023';
    end if;

    if exists (
        select 1 from subject
        where prospectus_id = v_old.prospectus_id
          and upper(code) = upper(trim(p_code))
          and id <> target_id
    ) then
        raise exception 'Another subject in this curriculum year already uses %',
            upper(trim(p_code)) using errcode = '23505';
    end if;

    update subject
    set code       = upper(trim(p_code)),
        title      = trim(p_title),
        lec_units  = coalesce(p_lec, 0),
        lab_units  = coalesce(p_lab, 0),
        units      = v_units,
        year_level = p_year,
        term       = p_term,
        category   = coalesce(p_category, category),
        updated_at = now()
    where id = target_id;

    insert into audit_log (actor_id, actor_role, action, table_name, record_id,
                           old_values, new_values)
    values (auth.uid(), 'department_staff', 'UPDATE_SUBJECT', 'subject',
            target_id::text,
            jsonb_build_object('code', v_old.code, 'title', v_old.title,
                               'units', v_old.units, 'lec', v_old.lec_units,
                               'lab', v_old.lab_units,
                               'year', v_old.year_level, 'term', v_old.term),
            jsonb_build_object('code', upper(trim(p_code)), 'title', trim(p_title),
                               'units', v_units, 'lec', coalesce(p_lec, 0),
                               'lab', coalesce(p_lab, 0),
                               'year', p_year, 'term', p_term));

    return jsonb_build_object(
        'done', true,
        'code', upper(trim(p_code)),
        'code_changed', upper(v_old.code) is distinct from upper(trim(p_code)),
        'records', (select count(*) from academic_record where subject_id = target_id)
    );
end;
$function$;

-- ---------------------------------------------------------------------
-- Only signed-in users may call these four. (Each still checks the caller
-- inside; this just stops signed-out callers from reaching the function.)
-- ---------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.delete_draft_prospectus(integer, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.activate_prospectus(integer)              FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.retire_subject(integer, boolean, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.update_subject(integer, text, text, numeric, numeric, integer, integer, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.delete_draft_prospectus(integer, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.activate_prospectus(integer)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.retire_subject(integer, boolean, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_subject(integer, text, text, numeric, numeric, integer, integer, text) TO authenticated;
