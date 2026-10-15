-- 079_move_item_section.sql
--
-- APPLIED 14 Oct 2026.
--
-- A student moves ONE subject of their approved plan to another section of the SAME subject, without going
-- back to the adviser for approval (the subject, the units and the term do not change). The adviser is told
-- with an information note only.
--
--   move_request_item_section(item_id, new_offering_id)
--
-- The server checks:
--   * the caller is a student and the item is theirs, in an approved plan the registrar did not reject, and
--     approved by the adviser;
--   * the new meeting belongs to the SAME subject, academic year and term as the current one, and is open;
--   * it is a different meeting from the current one and has the same meeting type (a lecture is replaced by
--     a lecture, a lab by a lab).
-- It does NOT check clashes with the student's other subjects: the apps work that out from the schedule
-- before they offer the move (the schedule text is free-form, so the database does not parse it).
--
-- A move clears any EDP report on that item (the report was about the old section) and tells the active
-- adviser(s): one notification each, type 'section_moved'.
--
-- Returns { "item_id", "from_section", "to_section", "notified" }.

create or replace function public.move_request_item_section(p_item_id integer, p_new_offering_id integer)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
    me          uuid := current_student_id();
    v_old       subject_offering%rowtype;
    v_new       subject_offering%rowtype;
    v_request   integer;
    v_code      text;
    v_student   text;
    v_notified  integer := 0;
begin
    if me is null then
        raise exception 'Only a student account can move a subject to another section.' using errcode = '42501';
    end if;

    select so.* into v_old
      from request_item ri
      join request rq        on rq.id = ri.request_id
      join subject_offering so on so.id = ri.offering_id
     where ri.id = p_item_id
       and rq.student_id = me
       and rq.status in ('approved', 'partially_approved')
       and rq.registrar_status is distinct from 'rejected'
       and ri.status = 'approved';
    if not found then
        raise exception 'That subject is not in one of your approved plans.';
    end if;

    select request_id into v_request from request_item where id = p_item_id;

    select * into v_new from subject_offering where id = p_new_offering_id;
    if not found then
        raise exception 'That section does not exist.';
    end if;
    if v_new.id = v_old.id then
        raise exception 'You are already in that section.';
    end if;
    if v_new.subject_id <> v_old.subject_id
       or v_new.academic_year <> v_old.academic_year
       or v_new.term <> v_old.term then
        raise exception 'That section is for a different subject or term.';
    end if;
    if coalesce(v_new.is_open, true) = false then
        raise exception 'That section is closed.';
    end if;
    if v_new.meeting_type is distinct from v_old.meeting_type then
        raise exception 'Pick the same kind of meeting (lecture or lab).';
    end if;

    update request_item
       set offering_id     = v_new.id,
           edp_result      = null,
           edp_reason      = null,
           edp_reported_at = null,
           updated_at      = now()
     where id = p_item_id;

    select s.code::text into v_code from subject s where s.id = v_old.subject_id;
    select coalesce(nullif(trim(u.first_name || ' ' || u.last_name), ''), u.student_id::text)
      into v_student from university_student u where u.id = me;

    -- information note for the adviser(s); nothing to approve
    insert into notification (user_id, type, title, message, related_request_id)
    select f.user_id, 'section_moved',
           'A student changed a section',
           left(coalesce(v_student, 'A student') || ' moved ' || coalesce(v_code, 'a subject')
                || ' from section ' || v_old.section || ' to ' || v_new.section
                || '. The subject and units are the same, so nothing needs your approval.', 1000),
           v_request
      from advisee_assignment a
      join faculty_staff f on f.id = a.faculty_id
     where a.student_id = me and a.is_active and f.user_id is not null;
    get diagnostics v_notified = row_count;

    return jsonb_build_object('item_id', p_item_id,
                              'from_section', v_old.section,
                              'to_section', v_new.section,
                              'notified', v_notified);
end;
$$;

revoke all on function public.move_request_item_section(integer, integer) from public, anon, authenticated, service_role;
grant execute on function public.move_request_item_section(integer, integer) to authenticated;
grant execute on function public.move_request_item_section(integer, integer) to service_role;
