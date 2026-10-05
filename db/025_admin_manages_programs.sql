-- 025_admin_manages_programs.sql
--
-- STATUS: DRAFT. Not applied. Read it, then apply it.
--
-- WHY
--   The system holds more than one programme in its data model (each has its
--   own prospectus, and students and faculty are linked to programmes), but
--   nobody can create one: `program` had a read policy and nothing else. A
--   second programme (BSN, say) could only be added by hand in the database.
--
-- WHAT THIS CHANGES
--   * The System Administrator may create and edit programmes. Nobody may
--     delete one from the app: a prospectus, students and faculty links hang
--     off it, and deleting a programme would cascade into them.
--   * A programme code must be 2 to 10 letters. Section names are built from
--     it (BSN-1A) and read back with a letters-only pattern, so a code with a
--     digit or a hyphen would create sections the rest of the system cannot
--     parse. The existing BSIT row satisfies this.
--   * Creating a programme links every faculty member who is already in that
--     programme's college (faculty_staff.department = program.college), the
--     same default 024 gives new faculty. Without it, faculty created before
--     their programme existed would never see its students.
--
-- WHAT IT DOES NOT CHANGE
--   No rows are modified. Reading programmes is unchanged (everyone signed in).
--
-- HOW TO UNDO: run the ROLLBACK block at the bottom of this file.

begin;

-- 1. Admin may create and edit programmes (never delete).
drop policy if exists "admin creates programs" on public.program;
create policy "admin creates programs"
    on public.program for insert
    with check (public.is_system_admin());

drop policy if exists "admin updates programs" on public.program;
create policy "admin updates programs"
    on public.program for update
    using (public.is_system_admin())
    with check (public.is_system_admin());

-- 2. Code shape. Validates the existing rows too (BSIT passes).
alter table public.program
    drop constraint if exists program_code_shape;
alter table public.program
    add constraint program_code_shape check (code ~ '^[A-Za-z]{2,10}$');

-- 3. A new programme picks up the faculty already in its college.
create or replace function public.link_college_faculty_to_program()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
    insert into public.faculty_program (faculty_id, program_id)
    select f.id, new.id
    from public.faculty_staff f
    where new.college is not null
      and f.department = new.college
    on conflict do nothing;
    return new;
end;
$$;

drop trigger if exists trg_link_college_faculty on public.program;
create trigger trg_link_college_faculty
    after insert on public.program
    for each row execute function public.link_college_faculty_to_program();

commit;


-- ROLLBACK ------------------------------------------------------------------
-- Removes the admin's ability to create and edit programmes, and the two
-- additions above. Any programme created in the meantime is kept.
--
-- begin;
-- drop trigger if exists trg_link_college_faculty on public.program;
-- drop function if exists public.link_college_faculty_to_program();
-- alter table public.program drop constraint if exists program_code_shape;
-- drop policy if exists "admin updates programs" on public.program;
-- drop policy if exists "admin creates programs" on public.program;
-- commit;
