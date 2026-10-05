-- 024_faculty_program_access.sql
--
-- STATUS: DRAFT. Not applied. Read it, then apply it.
--
-- WHY
--   023 made faculty access depend on advisee_assignment: the Registrar had to
--   pick an adviser for every student. Programs have their own faculty, so
--   that is needless work. Access now follows the PROGRAM instead: a faculty
--   member covers every student whose program is one of theirs.
--
-- WHAT THIS CHANGES
--   * New table faculty_program (which programs each faculty member covers).
--   * New faculty accounts are linked automatically to every program of their
--     own college (faculty_staff.department = program.college). Existing
--     faculty are backfilled the same way. The System Administrator can then
--     add or remove programs per faculty member (Admin -> Staff).
--   * is_adviser_of_student() now means "this student's program is one of my
--     programs". The policies and guard functions from 023 already call it, so
--     they follow without being touched.
--   * The "registrar reads faculty" policy from 023 is dropped: the Registrar
--     no longer lists faculty because it no longer assigns them.
--
-- WHAT IT DOES NOT CHANGE
--   No student or request rows are modified. advisee_assignment is left in
--   place but is no longer consulted.
--
-- DEFAULT BEHAVIOUR TO BE AWARE OF
--   Faculty are linked by college name, so a faculty member whose department
--   text does not exactly equal a program's college gets NO programs and
--   sees no requests until an administrator links them.
--
-- HOW TO UNDO: run the ROLLBACK block at the bottom of this file.

begin;

-- 1. Which programs each faculty member covers.
create table if not exists public.faculty_program (
    faculty_id uuid    not null references public.faculty_staff(id) on delete cascade,
    program_id integer not null references public.program(id)       on delete cascade,
    created_at timestamptz not null default now(),
    primary key (faculty_id, program_id)
);

alter table public.faculty_program enable row level security;

drop policy if exists "admin manages faculty programs" on public.faculty_program;
create policy "admin manages faculty programs"
    on public.faculty_program for all
    using (public.is_system_admin())
    with check (public.is_system_admin());

drop policy if exists "staff read faculty programs" on public.faculty_program;
create policy "staff read faculty programs"
    on public.faculty_program for select
    using (public.is_approved_staff());

-- 2. Default links: every program of the faculty member's own college.
insert into public.faculty_program (faculty_id, program_id)
select f.id, p.id
from public.faculty_staff f
join public.program p on p.college = f.department
on conflict do nothing;

create or replace function public.link_faculty_to_college_programs()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
    insert into public.faculty_program (faculty_id, program_id)
    select new.id, p.id
    from public.program p
    where p.college = new.department
    on conflict do nothing;
    return new;
end;
$$;

drop trigger if exists trg_link_faculty_programs on public.faculty_staff;
create trigger trg_link_faculty_programs
    after insert on public.faculty_staff
    for each row execute function public.link_faculty_to_college_programs();

-- 3. The access rule. Same name and signature as 023, so every policy and
--    guard function that calls it now follows the program link.
create or replace function public.is_adviser_of_student(p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
    select exists (
        select 1
        from university_student s
        join faculty_program fp on fp.program_id = s.program_id
        join faculty_staff f    on f.id = fp.faculty_id
        where s.id = p_student_id
          and f.user_id = auth.uid()
          and f.is_approved
    );
$$;

comment on function public.is_adviser_of_student(uuid) is
    'True when the signed-in approved faculty member covers the program of this student (faculty_program). Name kept from 023, which used advisee_assignment.';

-- 4. The Registrar no longer assigns advisers.
drop policy if exists "registrar reads faculty" on public.faculty_staff;

commit;


-- ROLLBACK ------------------------------------------------------------------
-- Returns to the 023 behaviour (access by advisee_assignment, Registrar can
-- list faculty). The faculty_program table and its rows are kept so nothing is
-- lost; drop it separately if you really want it gone.
--
-- begin;
--
-- drop trigger if exists trg_link_faculty_programs on public.faculty_staff;
-- drop function if exists public.link_faculty_to_college_programs();
--
-- create or replace function public.is_adviser_of_student(p_student_id uuid)
-- returns boolean language sql stable security definer set search_path to 'public' as $$
--     select exists (
--         select 1 from advisee_assignment a
--         join faculty_staff f on f.id = a.faculty_id
--         where a.student_id = p_student_id and a.is_active
--           and f.user_id = auth.uid() and f.is_approved);
-- $$;
--
-- create policy "registrar reads faculty" on public.faculty_staff for select
--     using (exists (select 1 from registrar_staff r
--                    where r.user_id = auth.uid() and r.is_approved));
--
-- commit;
