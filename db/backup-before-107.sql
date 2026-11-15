-- backup-before-107.sql
-- Taken 12 Nov 2026 just before db/107_faculty_multi_program.sql was applied to the live database.
-- To go back to the old behaviour: run this file's functions and policy, then drop the new objects listed in the
-- header of db/107 (drop triggers, drop set_faculty_programs, my_faculty_programs, drop table faculty_program).

CREATE OR REPLACE FUNCTION public.can_read_program(p_program_id integer)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    select p_program_id is not null and (
        exists (select 1 from system_administrator where user_id = auth.uid() and is_approved)
        or exists (select 1 from university_student where user_id = auth.uid() and program_id = p_program_id)
        or exists (select 1 from faculty_staff    where user_id = auth.uid() and is_approved and program_id = p_program_id)
        or exists (select 1 from registrar_staff  where user_id = auth.uid() and is_approved and program_id = p_program_id)
        or exists (select 1 from department_staff where user_id = auth.uid() and is_approved and program_id = p_program_id)
    );
$function$;

CREATE OR REPLACE FUNCTION public.is_adviser_of_student(p_student_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    select exists (
        select 1
        from university_student s
        join faculty_staff f on f.program_id = s.program_id
        where s.id = p_student_id
          and f.user_id = auth.uid()
          and f.is_approved
    );
$function$;

drop policy if exists "registrar reads faculty" on public.faculty_staff;
create policy "registrar reads faculty" on public.faculty_staff for SELECT to authenticated
    using (((program_id IS NOT NULL) AND (program_id = my_registrar_program())));

-- faculty_staff (id, employee_id, program_id) at the time: 7 accounts
--   95551cd2.. EMP-00003 -> 7     134aed14.. EMP-00004 -> 14    858574a8.. EMP-00005 -> 14
--   6833e88e.. EMP-00009 -> 15    fa26b5cc.. EMP-00010 -> 15    7bb4fc4b.. EMP-00014 -> 15
--   5674d3cb.. EMP-00026 -> 7
