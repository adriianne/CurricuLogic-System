-- 066_drop_unused_ai_and_section.sql
--
-- Second step after 065. Removes three empty tables nothing uses:
--
--   * recommendation_item, ai_recommendation
--       the first AI design; Cura now answers live and keeps its chat in
--       ai_chat_message. delete_draft_prospectus is rewritten first so it
--       no longer counts or deletes from them.
--   * section (and the unused subject_offering.section_id that pointed at it)
--       the sections in use are the plain text column subject_offering.section
--       (e.g. "BSIT-1A"); the section table was never filled or read.
--
-- Safe by construction: stops if any of the three tables has a row or if any
-- subject_offering row has a section_id; DROP TABLE has no CASCADE.
--
-- The only visible change: the "delete a draft curriculum" check no longer
-- reports ai_recommendations / recommendation_items (always 0 before).

do $$
declare
    t text;
    n bigint;
begin
    foreach t in array array['recommendation_item', 'ai_recommendation', 'section'] loop
        if to_regclass('public.' || t) is not null then
            execute format('select count(*) from public.%I', t) into n;
            if n > 0 then
                raise exception 'public.% has % row(s); not dropping it.', t, n;
            end if;
        end if;
    end loop;

    if exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = 'subject_offering'
                  and column_name = 'section_id') then
        execute 'select count(*) from public.subject_offering where section_id is not null' into n;
        if n > 0 then
            raise exception 'subject_offering.section_id is used by % row(s); not dropping it.', n;
        end if;
    end if;
end $$;

create or replace function public.delete_draft_prospectus(target_id integer, confirm boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
    p_record       RECORD;
    sub_ids        INT[];
    sub_count      INT := 0;
    prereq_count   INT := 0;
    eg_count       INT := 0;
    egm_count      INT := 0;
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
            'elective_members',     egm_count
        );
    END IF;

    -- Cascade delete in FK-safe order.
    IF sub_count > 0 THEN
        DELETE FROM prerequisite
         WHERE subject_id = ANY(sub_ids)
            OR prerequisite_subject_id = ANY(sub_ids);
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
        'elective_members',     egm_count
    );
END;
$function$;

drop table if exists public.recommendation_item;
drop table if exists public.ai_recommendation;

alter table public.subject_offering drop column if exists section_id;
drop table if exists public.section;
