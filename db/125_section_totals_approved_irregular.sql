-- 125_section_totals_approved_irregular.sql
--
-- section_demand_totals (db/124), now for APPROVED students only, with the irregular ones counted.
--
-- One row per section:
--   students       different students whose plan the adviser APPROVED with at least one subject in the section that the EDP
--                  office did not turn away ("full" or "time clash", the rule of db/123). A plan still waiting for the adviser
--                  is not counted here (the Dashboard demand card does count it: it is an early signal).
--   partial        of those, the students who take only SOME of the section's subjects: irregular students. A section's
--                  subjects are the distinct subjects it is offered this term; a student with fewer of them approved is partial.
--   reported_full  different students who reported a subject of the section FULL at the EDP office.
--
-- One extra row with section = NULL is the overall line:
--   students       different approved students in total (a student in two sections is counted once here, twice in the rows)
--   partial        how many of them are in MORE THAN ONE section
--   reported_full  different students who reported anything full
--
-- Same readers as before: signed-in Department staff, own programme only. Read-only.
--
-- Rollback: re-create the db/124 version of the function (drop function first: the columns differ).

drop function if exists public.section_demand_totals(integer, integer);

create function public.section_demand_totals(p_year integer, p_term integer)
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
                   where not (ri.edp_result = 'rejected' and ri.edp_reason in ('full', 'conflict'))) as taken,
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

revoke all on function public.section_demand_totals(integer, integer) from public, anon, authenticated, service_role;
grant execute on function public.section_demand_totals(integer, integer) to authenticated;
grant execute on function public.section_demand_totals(integer, integer) to service_role;
