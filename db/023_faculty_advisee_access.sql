-- 023_faculty_advisee_access.sql
--
-- STATUS: DRAFT. Not applied. Read it, then run it in the Supabase SQL editor
-- (or ask for it to be applied) once you are happy with it.
--
-- WHAT THIS CHANGES
--   Today any approved faculty member can read every student's advising
--   request and approve or reject it. The policies are named "own advisee"
--   but the functions behind them only ask "is this user approved faculty?".
--   After this, a faculty member can read and decide a request only if there
--   is an ACTIVE advisee_assignment linking them to the student who made it.
--
-- WHAT IT DOES NOT CHANGE
--   No rows are modified. Students, the Registrar, Department Staff and the
--   System Administrator keep exactly the access they have now. Faculty can
--   still read the student list and academic records (university_student and
--   academic_record have their own, separate policies).
--
-- BEFORE YOU APPLY
--   advisee_assignment currently has ONE row (Jay Darga -> Rachel New).
--   After this runs, requests from any student with no assignment are
--   invisible to every faculty member and will sit unreviewed. Assign
--   advisers first: Registrar dashboard -> Advisers.
--
-- HOW TO UNDO: run the ROLLBACK block at the bottom of this file.

begin;

-- 1. Is the signed-in user an active, approved adviser of this student?
create or replace function public.is_adviser_of_student(p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
    select exists (
        select 1
        from advisee_assignment a
        join faculty_staff f on f.id = a.faculty_id
        where a.student_id = p_student_id
          and a.is_active
          and f.user_id = auth.uid()
          and f.is_approved
    );
$$;

-- 2. ...and of the student who owns this request?
create or replace function public.is_adviser_of_request(p_request_id integer)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
    select exists (
        select 1
        from request r
        where r.id = p_request_id
          and public.is_adviser_of_student(r.student_id)
    );
$$;

-- 3. The three write guards keep their names and signatures (the policies
--    already point at them) but now also require the advisee relationship.
create or replace function public.faculty_can_transition_request(p_request_id integer)
returns boolean
language sql
security definer
set search_path to 'public'
as $$
    select public.is_adviser_of_request(p_request_id);
$$;

create or replace function public.faculty_can_update_request_item(p_request_id integer, p_faculty_id uuid)
returns boolean
language sql
security definer
set search_path to 'public'
as $$
    select exists (
        select 1 from faculty_staff f
        where f.id = p_faculty_id and f.user_id = auth.uid() and f.is_approved
    )
    and public.is_adviser_of_request(p_request_id);
$$;

create or replace function public.faculty_can_review_request(p_request_id integer, p_faculty_id uuid)
returns boolean
language sql
security definer
set search_path to 'public'
as $$
    select exists (
        select 1 from faculty_staff f
        where f.id = p_faculty_id and f.user_id = auth.uid() and f.is_approved
    )
    and public.is_adviser_of_request(p_request_id);
$$;

-- 4. Reading follows the same rule.
drop policy if exists "faculty_read_requests" on public.request;
create policy "faculty read advisee requests"
    on public.request for select
    using (public.is_adviser_of_student(student_id));

drop policy if exists "faculty read advisee request items" on public.request_item;
create policy "faculty read advisee request items"
    on public.request_item for select
    using (public.is_adviser_of_request(request_id));

-- 5. The Registrar assigns advisers, so the Registrar must be able to list
--    faculty. Today only admins and each faculty member's own row are readable.
drop policy if exists "registrar reads faculty" on public.faculty_staff;
create policy "registrar reads faculty"
    on public.faculty_staff for select
    using (exists (
        select 1 from registrar_staff r
        where r.user_id = auth.uid() and r.is_approved
    ));

commit;


-- ROLLBACK ------------------------------------------------------------------
-- Restores the behaviour that existed before this file (any approved faculty
-- member can read and decide any request). Run the whole block.
--
-- begin;
--
-- drop policy if exists "faculty read advisee requests" on public.request;
-- create policy "faculty_read_requests" on public.request for select
--     using (exists (select 1 from faculty_staff f
--                    where f.user_id = auth.uid() and f.is_approved));
--
-- drop policy if exists "faculty read advisee request items" on public.request_item;
-- create policy "faculty read advisee request items" on public.request_item for select
--     using (exists (select 1 from faculty_staff f
--                    where f.user_id = auth.uid() and f.is_approved));
--
-- drop policy if exists "registrar reads faculty" on public.faculty_staff;
--
-- create or replace function public.faculty_can_transition_request(p_request_id integer)
-- returns boolean language sql security definer set search_path to 'public' as $$
--     select exists (select 1 from faculty_staff f
--                    where f.user_id = auth.uid() and f.is_approved);
-- $$;
--
-- create or replace function public.faculty_can_update_request_item(p_request_id integer, p_faculty_id uuid)
-- returns boolean language sql security definer set search_path to 'public' as $$
--     select exists (select 1 from faculty_staff f
--                    where f.id = p_faculty_id and f.user_id = auth.uid() and f.is_approved);
-- $$;
--
-- create or replace function public.faculty_can_review_request(p_request_id integer, p_faculty_id uuid)
-- returns boolean language sql security definer set search_path to 'public' as $$
--     select exists (select 1 from faculty_staff f
--                    where f.id = p_faculty_id and f.user_id = auth.uid() and f.is_approved);
-- $$;
--
-- drop function if exists public.is_adviser_of_request(integer);
-- drop function if exists public.is_adviser_of_student(uuid);
--
-- commit;
