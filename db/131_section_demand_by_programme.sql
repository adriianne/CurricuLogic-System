-- 131_section_demand_by_programme.sql
-- 22 Nov 2026
--
-- Section demand shows only the sections of the programme the Department has chosen.
--
-- Until now section_demand and section_demand_totals returned every programme the account COVERS, so a staff member working in BSCS saw
-- BSIT-1A, BSIT-2A ... on the dashboard. Both functions now take an optional third argument, p_program_id:
--   null (the default)  every programme the account covers, exactly as before, so any caller that passes two arguments is unchanged
--   a programme id      only the subjects of that programme (the department must still cover it: department_covers_program is kept)
--
-- The two-argument functions are dropped first: leaving them beside a three-argument one with a default would make a two-argument call
-- ambiguous. Same return columns, same body, same grants (authenticated and service_role only, as in db/076, db/123, db/124).
--
-- Rollback: re-apply db/126 (it makes the two-argument versions again); the dashboard would then show every covered programme, and a call
-- that passes p_program_id would fail until the page is rolled back too.

drop function if exists public.section_demand(integer, integer);
drop function if exists public.section_demand_totals(integer, integer);

create function public.section_demand(p_year integer, p_term integer, p_program_id integer default null)
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
          and (p_program_id is null or p.program_id = p_program_id)
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

create function public.section_demand_totals(p_year integer, p_term integer, p_program_id integer default null)
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
          and (p_program_id is null or p.program_id = p_program_id)
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

revoke all on function public.section_demand(integer, integer, integer) from public, anon, authenticated, service_role;
grant execute on function public.section_demand(integer, integer, integer) to authenticated;
grant execute on function public.section_demand(integer, integer, integer) to service_role;

revoke all on function public.section_demand_totals(integer, integer, integer) from public, anon, authenticated, service_role;
grant execute on function public.section_demand_totals(integer, integer, integer) to authenticated;
grant execute on function public.section_demand_totals(integer, integer, integer) to service_role;
