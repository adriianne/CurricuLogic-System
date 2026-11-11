-- 106_curriculum_admin_only.sql
--
-- Who decides a student's curriculum: the System Administrator, and only the Administrator.
--
--   * It is chosen when the account is created (the EDP list's curriculum_year, or the Admin forms), and the
--     registration trigger of db/102 still pins it from the list. After that only the Administrator can change it.
--   * set_student_curriculum (db/102, was Admin or the Registrar of the programme) is now Admin only.
--   * Every change is written to the audit log: action UPDATE_CURRICULUM on university_student, with the student's
--     old and new curriculum (programme, year) in old_values / new_values. A call that changes nothing writes nothing.
--
-- TO UNDO: re-run db/102 (it recreates set_student_curriculum with the Registrar allowed).
-- Safe to re-run.

create or replace function public.set_student_curriculum(p_student_id text, p_year integer)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
    s       public.university_student%rowtype;
    pid     integer;
    v_old   jsonb;
    v_new   jsonb;
begin
    if not public.is_system_admin() then
        raise exception 'Only the System Administrator can change a student''s curriculum.' using errcode = '42501';
    end if;

    select * into s from public.university_student where student_id = p_student_id;
    if not found then
        raise exception 'No student with ID %.', p_student_id using errcode = 'P0002';
    end if;

    if s.program_id is null then
        raise exception 'This student has no programme, so no curriculum can be chosen.' using errcode = '22023';
    end if;

    pid := public.curriculum_for(s.program_id, p_year);
    if pid is null then
        raise exception 'No published curriculum for % exists for this programme.', coalesce(p_year::text, 'the active year') using errcode = '22023';
    end if;

    if s.prospectus_id is distinct from pid then
        select jsonb_build_object('student_id', s.student_id, 'curriculum_year', pr.academic_year, 'active', pr.is_active)
          into v_old from public.prospectus pr where pr.id = s.prospectus_id;
        select jsonb_build_object('student_id', s.student_id, 'curriculum_year', pr.academic_year, 'active', pr.is_active)
          into v_new from public.prospectus pr where pr.id = pid;

        update public.university_student set prospectus_id = pid where id = s.id;

        insert into public.audit_log (actor_id, actor_role, action, table_name, record_id, old_values, new_values)
        values (auth.uid(), 'system_administrator', 'UPDATE_CURRICULUM', 'university_student', s.id::text,
                coalesce(v_old, jsonb_build_object('student_id', s.student_id, 'curriculum_year', null)), v_new);
    end if;
    return pid;
end;
$$;

revoke all on function public.set_student_curriculum(text, integer) from public, anon, authenticated;
grant execute on function public.set_student_curriculum(text, integer) to authenticated;
