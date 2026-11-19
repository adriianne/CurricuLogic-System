-- 123_section_demand_edp_reports.sql
--
-- What the EDP office told the student now reaches the Department's Section demand.
--
-- A student reports, per approved subject, whether the EDP office took it (request_item.edp_result, db/077). Until now the
-- demand numbers ignored that, so a student turned away from a full section still counted as a seat taken there.
--
--   section_demand:
--     selected / awaiting / approved   no longer count a student the EDP office turned down because the section was FULL or
--                                      the times CLASHED: they did not get that section. (They count again in the new section
--                                      if they move: db/079 clears the result and changes the offering.) Reasons that belong
--                                      to the student, not the section (record, overload, hold, code_error, other), still count:
--                                      the student still wants the section.
--     reported_full  (new)             how many different students reported the section FULL at the EDP office. A rising number
--                                      is the sign to raise the capacity or open another section.
--
--   section_demand_students (the Names list):
--     lists every student who chose the section, turned-down ones included, and says why in the new edp_reason column
--     (null when the EDP office has not turned them down), so the Department sees who reported what.
--
-- A return type cannot change in place, so both functions are dropped and made again, with the same grants as db/076.
--
-- Rollback: re-run the section_demand and section_demand_students definitions of db/076 (the live pair before this).

drop function if exists public.section_demand(integer, integer);
drop function if exists public.section_demand_students(integer, text, integer, integer);

create function public.section_demand(p_year integer, p_term integer)
returns table (
    subject_id    integer,
    subject_code  text,
    subject_title text,
    section       text,
    edp_codes     text[],
    capacity      integer,
    is_open       boolean,
    selected      integer,
    awaiting      integer,
    approved      integer,
    reported_full integer
)
language sql
stable
security definer
set search_path to 'public'
as $function$
    with sec as (
        select so.subject_id,
               so.section::text                  as section,
               array_agg(so.id)                  as offering_ids,
               array_agg(distinct so.edp_code::text) as edp_codes,
               max(so.capacity)                  as capacity,
               bool_and(so.is_open)              as is_open
        from subject_offering so
        join subject s    on s.id = so.subject_id
        join prospectus p on p.id = s.prospectus_id
        where so.academic_year = p_year
          and so.term = p_term
          and public.department_covers_program(p.program_id)
        group by so.subject_id, so.section
    ),
    picks as (
        select sec.subject_id, sec.section, r.student_id, r.status as request_status,
               -- the EDP office turned the subject down because of the SECTION (full or a time clash)
               (ri.edp_result = 'rejected' and ri.edp_reason in ('full', 'conflict')) as turned_down,
               (ri.edp_result = 'rejected' and ri.edp_reason = 'full')                as said_full
        from sec
        join request_item ri on ri.offering_id = any (sec.offering_ids)
        join request r       on r.id = ri.request_id
        where r.status in ('submitted', 'approved', 'partially_approved')
          and r.registrar_status is distinct from 'rejected'
          and ri.status is distinct from 'rejected'
    )
    select sec.subject_id,
           s.code::text,
           s.title::text,
           sec.section,
           sec.edp_codes,
           sec.capacity,
           sec.is_open,
           (count(distinct pk.student_id) filter (where not pk.turned_down))::integer,
           (count(distinct pk.student_id) filter (where not pk.turned_down and pk.request_status = 'submitted'))::integer,
           (count(distinct pk.student_id) filter (where not pk.turned_down and pk.request_status in ('approved', 'partially_approved')))::integer,
           (count(distinct pk.student_id) filter (where pk.said_full))::integer
    from sec
    join subject s on s.id = sec.subject_id
    left join picks pk on pk.subject_id = sec.subject_id and pk.section = sec.section
    group by sec.subject_id, s.code, s.title, sec.section, sec.edp_codes, sec.capacity, sec.is_open
    order by s.code, sec.section;
$function$;

create function public.section_demand_students(p_subject_id integer, p_section text, p_year integer, p_term integer)
returns table (
    student_id     text,
    first_name     text,
    last_name      text,
    year_level     integer,
    request_status text,
    edp_reason     text
)
language sql
stable
security definer
set search_path to 'public'
as $function$
    select t.student_id, t.first_name, t.last_name, t.year_level, t.request_status, t.edp_reason
    from (
        select distinct on (u.id)
               u.student_id::text as student_id,
               u.first_name::text as first_name,
               u.last_name::text  as last_name,
               u.year_level       as year_level,
               r.status::text     as request_status,
               case when ri.edp_result = 'rejected' then ri.edp_reason end::text as edp_reason
        from subject_offering so
        join subject s    on s.id = so.subject_id
        join prospectus p on p.id = s.prospectus_id
        join request_item ri on ri.offering_id = so.id
        join request r       on r.id = ri.request_id
        join university_student u on u.id = r.student_id
        where so.subject_id = p_subject_id
          and so.section = p_section
          and so.academic_year = p_year
          and so.term = p_term
          and public.department_covers_program(p.program_id)
          and r.status in ('submitted', 'approved', 'partially_approved')
          and r.registrar_status is distinct from 'rejected'
          and ri.status is distinct from 'rejected'
          and is_department_of_student(u.id)
        order by u.id, r.created_at desc
    ) t
    order by t.last_name, t.first_name;
$function$;

revoke all on function public.section_demand(integer, integer) from public, anon, authenticated, service_role;
grant execute on function public.section_demand(integer, integer) to authenticated;
grant execute on function public.section_demand(integer, integer) to service_role;

revoke all on function public.section_demand_students(integer, text, integer, integer) from public, anon, authenticated, service_role;
grant execute on function public.section_demand_students(integer, text, integer, integer) to authenticated;
grant execute on function public.section_demand_students(integer, text, integer, integer) to service_role;
