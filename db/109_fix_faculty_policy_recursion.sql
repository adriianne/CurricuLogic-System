-- 109_fix_faculty_policy_recursion.sql
--
-- HOTFIX for db/107. Two row-level-security rules pointed at each other:
--   * faculty_staff   "registrar reads faculty"      looked inside faculty_program
--   * faculty_program "faculty reads own programmes" looked inside faculty_staff
-- Postgres refuses that loop ("infinite recursion detected in policy"), and it did so for EVERY signed-in read of
-- faculty_staff or faculty_program, which would have broken the Faculty dashboard (it reads its own row) and the
-- Admin staff list. db/107's own tests ran through SECURITY DEFINER functions, which skip the rules, so they did
-- not catch it; a read as a signed-in user did.
--
-- Fix: the two cross-table checks now go through SECURITY DEFINER functions, which read the other table without
-- applying its rules, so there is no loop. Same access as before, nothing widened.
--
-- TO UNDO: restore the two policies from db/107 (and the loop comes back, so only do it together with undoing 107).
--
-- Safe to re-run.

create or replace function public.is_my_faculty_row(p_faculty_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
    select exists (select 1 from public.faculty_staff f where f.id = p_faculty_id and f.user_id = auth.uid());
$$;

create or replace function public.registrar_covers_faculty(p_faculty_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
    select exists (
        select 1 from public.faculty_program fp
        where fp.faculty_id = p_faculty_id
          and fp.program_id = public.my_registrar_program()
    );
$$;

revoke all on function public.is_my_faculty_row(uuid) from public, anon, authenticated, service_role;
grant execute on function public.is_my_faculty_row(uuid) to authenticated;
grant execute on function public.is_my_faculty_row(uuid) to service_role;
revoke all on function public.registrar_covers_faculty(uuid) from public, anon, authenticated, service_role;
grant execute on function public.registrar_covers_faculty(uuid) to authenticated;
grant execute on function public.registrar_covers_faculty(uuid) to service_role;

drop policy if exists "faculty reads own programmes" on public.faculty_program;
create policy "faculty reads own programmes" on public.faculty_program
    for select to authenticated
    using (public.is_my_faculty_row(faculty_id));

drop policy if exists "registrar reads faculty" on public.faculty_staff;
create policy "registrar reads faculty" on public.faculty_staff
    for select to authenticated
    using (public.registrar_covers_faculty(id));
