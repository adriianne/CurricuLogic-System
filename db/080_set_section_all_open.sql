-- 080_set_section_all_open.sql
--
-- DRAFT, NOT APPLIED. Read it, then run it in the Supabase SQL editor (or ask for it to be applied).
--
-- The Department closes (or reopens) EVERY subject of a section at once, e.g. all of BSIT-1A, and each student
-- who chose any of them is told ONCE, with the subjects named, instead of one notice per subject.
--
--   set_section_all_open(section, year, term, open)
--
-- Same rules as set_section_open (db/078), applied to all of the section's subjects:
--   * only an approved department-staff account, and only for subjects of its own programme's curriculum
--     (another programme's subjects that share the section name are left alone);
--   * "closed" is subject_offering.is_open = false on every meeting of every such subject;
--   * only subjects whose state really changes are counted, so closing an already-closed subject tells nobody;
--   * students are told only when closing, only those with a sent or approved plan that names one of the
--     changed subjects, one notice each (their latest plan is the one the notice points at);
--   * reopening tells nobody.
--
-- Returns { "updated": <meeting rows changed>, "subjects": <subjects changed>, "notified": <students told> }.

create or replace function public.set_section_all_open(
    p_section text, p_year integer, p_term integer, p_open boolean)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
    v_program     integer := my_department_program();
    v_found       integer;
    v_updated     integer := 0;
    v_subject_ids integer[];
    v_notified    integer := 0;
begin
    if v_program is null then
        raise exception 'Only approved Department staff can open or close a section.' using errcode = '42501';
    end if;
    if p_open is null then
        raise exception 'Say whether the section is open or closed.';
    end if;
    if p_section is null or btrim(p_section) = '' then
        raise exception 'Say which section.';
    end if;

    -- the section's meetings that belong to this department's own curriculum
    select count(*) into v_found
      from subject_offering so
      join subject s   on s.id = so.subject_id
      join prospectus p on p.id = s.prospectus_id
     where p.program_id = v_program and so.section = p_section
       and so.academic_year = p_year and so.term = p_term;
    if v_found = 0 then
        raise exception 'No such section this term.';
    end if;

    with changed as (
        update subject_offering so
           set is_open = p_open, updated_at = now()
          from subject s
          join prospectus p on p.id = s.prospectus_id
         where s.id = so.subject_id and p.program_id = v_program
           and so.section = p_section and so.academic_year = p_year and so.term = p_term
           and so.is_open is distinct from p_open
        returning so.subject_id
    )
    select count(*), coalesce(array_agg(distinct subject_id), '{}')
      into v_updated, v_subject_ids
      from changed;

    -- tell the students who chose any of the changed subjects, once each
    if not p_open and v_updated > 0 then
        insert into notification (user_id, type, title, message, related_request_id)
        select u.user_id, 'section_closed',
               'A section you chose was closed',
               left('The Department closed section ' || p_section || ' for '
                    || string_agg(distinct s.code::text, ', ' order by s.code::text)
                    || '. Choose another section of ' || case when count(distinct s.id) = 1 then 'this subject' else 'each of these subjects' end
                    || ' before you go to the EDP office. Your other subjects are not affected.', 1000),
               (array_agg(r.id order by r.created_at desc))[1]
          from subject_offering so
          join request_item ri     on ri.offering_id = so.id
          join request r           on r.id = ri.request_id
          join subject s           on s.id = so.subject_id
          join university_student u on u.id = r.student_id
         where so.subject_id = any (v_subject_ids)
           and so.section = p_section and so.academic_year = p_year and so.term = p_term
           and r.status in ('submitted', 'approved', 'partially_approved')
           and r.registrar_status is distinct from 'rejected'
           and ri.status is distinct from 'rejected'
         group by u.user_id;
        get diagnostics v_notified = row_count;
    end if;

    return jsonb_build_object('updated', v_updated, 'subjects', coalesce(array_length(v_subject_ids, 1), 0),
                              'notified', v_notified);
end;
$$;

revoke all on function public.set_section_all_open(text, integer, integer, boolean) from public, anon, authenticated, service_role;
grant execute on function public.set_section_all_open(text, integer, integer, boolean) to authenticated;
grant execute on function public.set_section_all_open(text, integer, integer, boolean) to service_role;
