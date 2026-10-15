-- 076_section_demand.sql
--
-- DRAFT, NOT APPLIED. Read it, then run it in the Supabase SQL editor (or ask for it to be applied).
--
-- How many students chose each section, for the Department.
--
-- A student's plan names one section per subject (request_item.offering_id, the first meeting of
-- that section). This counts DIFFERENT students per (subject, section) among plans that were sent
-- (request.status 'submitted', waiting for the adviser) or approved ('approved', 'partially_approved').
-- Not counted: a plan the registrar rejected, a subject the adviser rejected, a plan that was rejected.
--
-- It is demand the system really knows. It is NOT the EDP office's seat count (the system cannot see
-- that), so the app words it as "students chose it", never as "full at EDP".
--
-- Who can call it: an approved department-staff account, and only for the subjects of its own
-- programme's curriculum (the same scope as the existing policy department_manage_offerings).
-- Anyone else gets no rows. Students are counted whichever programme they belong to (a shared
-- subject is wanted by several programmes), but names are returned only for the department's own
-- students (section_demand_students), the same rule as "department reads approved enrollment items".
--
-- Nothing is written: both functions only read.

-- 1. one row per section ---------------------------------------------------------------------------
create or replace function public.section_demand(p_year integer, p_term integer)
returns table (
    subject_id    integer,
    subject_code  text,
    subject_title text,
    section       text,
    edp_codes     text[],
    capacity      integer,    -- null when the Department has not set one (the app then uses 45)
    is_open       boolean,
    selected      integer,    -- different students, any sent or approved plan
    awaiting      integer,    -- of those, with a plan still waiting for the adviser
    approved      integer     -- of those, with an approved plan
)
language sql
stable
security definer
set search_path to 'public'
as $$
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
          and p.program_id = my_department_program()
        group by so.subject_id, so.section
    ),
    picks as (
        select sec.subject_id, sec.section, r.student_id, r.status as request_status
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
           count(distinct pk.student_id)::integer,
           (count(distinct pk.student_id) filter (where pk.request_status = 'submitted'))::integer,
           (count(distinct pk.student_id) filter (where pk.request_status in ('approved', 'partially_approved')))::integer
    from sec
    join subject s on s.id = sec.subject_id
    left join picks pk on pk.subject_id = sec.subject_id and pk.section = sec.section
    group by sec.subject_id, s.code, s.title, sec.section, sec.edp_codes, sec.capacity, sec.is_open
    order by s.code, sec.section;
$$;

-- 2. the names behind one section's count -----------------------------------------------------------
create or replace function public.section_demand_students(
    p_subject_id integer, p_section text, p_year integer, p_term integer)
returns table (
    student_id     text,
    first_name     text,
    last_name      text,
    year_level     integer,
    request_status text
)
language sql
stable
security definer
set search_path to 'public'
as $$
    select t.student_id, t.first_name, t.last_name, t.year_level, t.request_status
    from (
        select distinct on (u.id)
               u.student_id::text as student_id,
               u.first_name::text as first_name,
               u.last_name::text  as last_name,
               u.year_level       as year_level,
               r.status::text     as request_status
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
          and p.program_id = my_department_program()
          and r.status in ('submitted', 'approved', 'partially_approved')
          and r.registrar_status is distinct from 'rejected'
          and ri.status is distinct from 'rejected'
          and is_department_of_student(u.id)
        order by u.id, r.created_at desc
    ) t
    order by t.last_name, t.first_name;
$$;

-- 3. who may call them ------------------------------------------------------------------------------
revoke all on function public.section_demand(integer, integer) from public, anon, authenticated, service_role;
grant execute on function public.section_demand(integer, integer) to authenticated;
grant execute on function public.section_demand(integer, integer) to service_role;

revoke all on function public.section_demand_students(integer, text, integer, integer) from public, anon, authenticated, service_role;
grant execute on function public.section_demand_students(integer, text, integer, integer) to authenticated;
grant execute on function public.section_demand_students(integer, text, integer, integer) to service_role;

-- Check (read-only), as a department-staff user:
--   select * from section_demand(2023, 1) order by selected desc limit 10;
-- As anyone else (a student, a faculty member) it returns no rows.
