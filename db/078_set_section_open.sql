-- 078_set_section_open.sql
--
-- DRAFT, NOT APPLIED. Read it, then run it in the Supabase SQL editor (or ask for it to be applied).
--
-- The Department closes a section (or opens it again), and the students who chose it are told.
--
--   set_section_open(subject, section, year, term, open)
--
-- "Closed" is subject_offering.is_open = false, on every meeting of the section (a lecture and its lab are
-- one section). The apps and the planner stop offering a closed section; a plan that already holds it is
-- not changed, but its owner gets a notice so they can choose another section before the EDP office.
--
-- Who may call it: an approved department-staff account, and only for subjects of its own programme's
-- curriculum (the same scope as the policy department_manage_offerings). Anyone else is refused.
-- Students are notified only when a section is CLOSED, and only the students with a sent or approved plan
-- that names it (one notice each, even if they have two plans). Reopening tells nobody.
--
-- Returns { "updated": <meeting rows changed>, "notified": <students told> }.

create or replace function public.set_section_open(
    p_subject_id integer, p_section text, p_year integer, p_term integer, p_open boolean)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
    v_program  integer := my_department_program();
    v_code     text;
    v_edp      text;
    v_updated  integer;
    v_notified integer := 0;
begin
    if v_program is null then
        raise exception 'Only approved Department staff can open or close a section.' using errcode = '42501';
    end if;
    if p_open is null then
        raise exception 'Say whether the section is open or closed.';
    end if;

    -- the subject must belong to this department's own curriculum
    select s.code::text into v_code
      from subject s
      join prospectus p on p.id = s.prospectus_id
     where s.id = p_subject_id and p.program_id = v_program;
    if v_code is null then
        raise exception 'That subject is not in your department''s curriculum.' using errcode = '42501';
    end if;

    select string_agg(distinct so.edp_code::text, ' + ' order by so.edp_code::text)
      into v_edp
      from subject_offering so
     where so.subject_id = p_subject_id and so.section = p_section
       and so.academic_year = p_year and so.term = p_term;

    update subject_offering
       set is_open = p_open, updated_at = now()
     where subject_id = p_subject_id and section = p_section
       and academic_year = p_year and term = p_term
       and is_open is distinct from p_open;
    get diagnostics v_updated = row_count;

    if v_updated = 0 and v_edp is null then
        raise exception 'No such section this term.';
    end if;

    -- tell the students who chose it, once each
    if not p_open and v_updated > 0 then
        insert into notification (user_id, type, title, message, related_request_id)
        select u.user_id, 'section_closed',
               'A section you chose was closed',
               left('The Department closed section ' || p_section || ' of ' || v_code
                    || coalesce(' (EDP ' || v_edp || ')', '')
                    || '. Choose another section of this subject before you go to the EDP office. '
                    || 'Your other subjects are not affected.', 1000),
               picked.request_id
          from (
              select distinct on (r.student_id) r.student_id, r.id as request_id
                from subject_offering so
                join request_item ri on ri.offering_id = so.id
                join request r       on r.id = ri.request_id
               where so.subject_id = p_subject_id and so.section = p_section
                 and so.academic_year = p_year and so.term = p_term
                 and r.status in ('submitted', 'approved', 'partially_approved')
                 and r.registrar_status is distinct from 'rejected'
                 and ri.status is distinct from 'rejected'
               order by r.student_id, r.created_at desc
          ) picked
          join university_student u on u.id = picked.student_id;
        get diagnostics v_notified = row_count;
    end if;

    return jsonb_build_object('updated', v_updated, 'notified', v_notified);
end;
$$;

revoke all on function public.set_section_open(integer, text, integer, integer, boolean) from public, anon, authenticated, service_role;
grant execute on function public.set_section_open(integer, text, integer, integer, boolean) to authenticated;
grant execute on function public.set_section_open(integer, text, integer, integer, boolean) to service_role;
