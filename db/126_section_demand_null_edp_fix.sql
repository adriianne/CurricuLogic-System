-- 126_section_demand_null_edp_fix.sql
--
-- FIX for db/123 and db/125: a student who has NOT yet reported anything from the EDP office was left out of the counts.
--
-- request_item.edp_result is NULL until the student reports. "turned away" was written as
--     (edp_result = 'rejected' and edp_reason in ('full', 'conflict'))
-- which is NULL (not false) when edp_result is NULL, and "not NULL" is NULL, so the row fell out of every
--     filter (where not turned_down)
-- Only students who had reported something (accepted / rejected for another reason) were counted. A plan just sent, or an approved
-- one with no EDP report yet, counted for nothing. Found on 19 Nov 2026 while testing a mixed-section student (request 36).
--
-- The fix: an unknown result is "not turned away" (coalesce to false), in
--   section_demand          (db/123)  selected / awaiting / approved
--   section_demand_totals   (db/125)  students / partial
-- Nothing else changes: same columns, same grants (create or replace keeps them), same rules.
--
-- Rollback: re-apply db/123 and db/125 (they contain the faulty version, so only do that to go back deliberately).

create or replace function public.section_demand(p_year integer, p_term integer)
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
               -- the EDP office turned the subject down because of the SECTION (full or a time clash); no report yet = not turned down
               coalesce(ri.edp_result = 'rejected' and ri.edp_reason in ('full', 'conflict'), false) as turned_down,
               coalesce(ri.edp_result = 'rejected' and ri.edp_reason = 'full', false)                as said_full
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

create or replace function public.section_demand_totals(p_year integer, p_term integer)
returns table (section text, students integer, partial integer, reported_full integer)
language sql
stable
security definer
set search_path to 'public'
as $function$
    with scope as (
        select so.id, so.section::text as section, so.subject_id
        from subject_offering so
        join subject s    on s.id = so.subject_id
        join prospectus p on p.id = s.prospectus_id
        where so.academic_year = p_year
          and so.term = p_term
          and public.department_covers_program(p.program_id)
    ),
    size as (
        select section, count(distinct subject_id) as n from scope group by section
    ),
    seat as (       -- one row per student and section
        select sc.section, r.student_id,
               count(distinct sc.subject_id) filter (
                   where not coalesce(ri.edp_result = 'rejected' and ri.edp_reason in ('full', 'conflict'), false)) as taken,
               coalesce(bool_or(ri.edp_result = 'rejected' and ri.edp_reason = 'full'), false) as said_full
        from scope sc
        join request_item ri on ri.offering_id = sc.id
        join request r       on r.id = ri.request_id
        where r.status in ('approved', 'partially_approved')
          and r.registrar_status is distinct from 'rejected'
          and ri.status = 'approved'
        group by sc.section, r.student_id
    ),
    by_section as (
        select seat.section,
               (count(*) filter (where seat.taken > 0))::integer                    as students,
               (count(*) filter (where seat.taken > 0 and seat.taken < size.n))::integer as partial,
               (count(*) filter (where seat.said_full))::integer                    as reported_full
        from seat
        join size on size.section = seat.section
        group by seat.section
    )
    select b.section, b.students, b.partial, b.reported_full from by_section b
    union all
    select null::text,
           (count(distinct s.student_id) filter (where s.taken > 0))::integer,
           (select count(*)::integer from (
                select student_id from seat where taken > 0 group by student_id having count(*) > 1) m),
           (count(distinct s.student_id) filter (where s.said_full))::integer
    from seat s
    order by 1 nulls last;
$function$;
