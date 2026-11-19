-- 124_section_demand_totals.sql
--
-- How many DIFFERENT STUDENTS chose each section, counting a student once per section (not once per subject).
--
-- section_demand counts per subject: one student with an 8-subject plan is "1" in each of 8 rows. That is right for a subject's
-- seats, but a section's headline number read as "8 choices" for a single student. This returns one row per section:
--
--   students       different students with at least one subject of the section that the EDP office did not turn away
--                  (the same rule as section_demand, db/123: "full" and "time clash" reports take a student out)
--   reported_full  different students who reported at least one subject of the section FULL at the EDP office
--
-- Same readers and the same programme rule as section_demand: signed-in Department staff, own programme only.
-- Read-only.
--
-- Rollback: drop function public.section_demand_totals(integer, integer);

create function public.section_demand_totals(p_year integer, p_term integer)
returns table (section text, students integer, reported_full integer)
language sql
stable
security definer
set search_path to 'public'
as $function$
    select so.section::text,
           (count(distinct r.student_id) filter (
                where not (ri.edp_result = 'rejected' and ri.edp_reason in ('full', 'conflict'))))::integer,
           (count(distinct r.student_id) filter (
                where ri.edp_result = 'rejected' and ri.edp_reason = 'full'))::integer
    from subject_offering so
    join subject s    on s.id = so.subject_id
    join prospectus p on p.id = s.prospectus_id
    join request_item ri on ri.offering_id = so.id
    join request r       on r.id = ri.request_id
    where so.academic_year = p_year
      and so.term = p_term
      and public.department_covers_program(p.program_id)
      and r.status in ('submitted', 'approved', 'partially_approved')
      and r.registrar_status is distinct from 'rejected'
      and ri.status is distinct from 'rejected'
    group by so.section
    order by so.section;
$function$;

revoke all on function public.section_demand_totals(integer, integer) from public, anon, authenticated, service_role;
grant execute on function public.section_demand_totals(integer, integer) to authenticated;
grant execute on function public.section_demand_totals(integer, integer) to service_role;
