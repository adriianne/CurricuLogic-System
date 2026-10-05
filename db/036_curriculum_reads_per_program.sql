-- 036_curriculum_reads_per_program.sql
--
-- STATUS: APPLIED to the live database (2026-09-30).
--
-- WHY
--   db/033 stopped a department writing another programme's curriculum, but
--   every signed-in account could still READ every programme's prospectus,
--   subjects, prerequisites, electives, sections and offerings. Curriculum
--   reads are now per programme too.
--
-- WHAT THIS CHANGES
--   can_read_program(program_id): true for an administrator, for a student
--   of that programme, and for approved faculty / registrar / department
--   accounts of that programme.
--   can_read_prospectus(id) and can_read_subject(id) build on it.
--   The seven "readable" policies below now use them. Sections and offerings
--   were readable by the public role; they are now for signed-in users only
--   (no page reads them before sign-in).
--   Writes are unchanged (db/033).
--
-- ROLLBACK
--   Recreate each policy below with `using (true)` (roles as noted in each
--   drop line's original: section and subject_offering were `to public`,
--   the others `to authenticated`).

create or replace function public.can_read_program(p_program_id integer)
returns boolean language sql stable security definer set search_path to 'public'
as $$
    select p_program_id is not null and (
        exists (select 1 from system_administrator where user_id = auth.uid() and is_approved)
        or exists (select 1 from university_student where user_id = auth.uid() and program_id = p_program_id)
        or exists (select 1 from faculty_staff    where user_id = auth.uid() and is_approved and program_id = p_program_id)
        or exists (select 1 from registrar_staff  where user_id = auth.uid() and is_approved and program_id = p_program_id)
        or exists (select 1 from department_staff where user_id = auth.uid() and is_approved and program_id = p_program_id)
    );
$$;

create or replace function public.can_read_prospectus(p_prospectus_id integer)
returns boolean language sql stable security definer set search_path to 'public'
as $$
    select exists (select 1 from prospectus where id = p_prospectus_id and can_read_program(program_id));
$$;

create or replace function public.can_read_subject(p_subject_id integer)
returns boolean language sql stable security definer set search_path to 'public'
as $$
    select exists (select 1 from subject where id = p_subject_id and can_read_prospectus(prospectus_id));
$$;

drop policy if exists "prospectus_readable" on public.prospectus;
create policy "prospectus_readable" on public.prospectus for select to authenticated
    using (can_read_program(program_id));

drop policy if exists "sections_readable" on public.section;
create policy "sections_readable" on public.section for select to authenticated
    using (can_read_program(program_id));

drop policy if exists "curriculum_readable" on public.subject;
create policy "curriculum_readable" on public.subject for select to authenticated
    using (can_read_prospectus(prospectus_id));

drop policy if exists "prerequisites_readable" on public.prerequisite;
create policy "prerequisites_readable" on public.prerequisite for select to authenticated
    using (can_read_subject(subject_id));

drop policy if exists "elective_groups_readable" on public.elective_group;
create policy "elective_groups_readable" on public.elective_group for select to authenticated
    using (can_read_prospectus(prospectus_id));

drop policy if exists "elective_members_readable" on public.elective_group_member;
create policy "elective_members_readable" on public.elective_group_member for select to authenticated
    using (can_read_subject(subject_id));

drop policy if exists "offerings_readable" on public.subject_offering;
create policy "offerings_readable" on public.subject_offering for select to authenticated
    using (can_read_subject(subject_id));
