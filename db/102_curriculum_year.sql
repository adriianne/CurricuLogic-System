-- 102_curriculum_year.sql
--
-- A student can now be put on the curriculum they STARTED under, not only on the one that is active the day the
-- account is made.
--
--   * expected_student.curriculum_year (optional): the curriculum year of that student, for example 2024. It comes
--     from the EDP list file, like year_level.
--   * curriculum_for(program, year): the curriculum version of that programme and year (the active one first if there
--     are several terms); with no year, the programme's active version.
--   * student_register_autoapprove (db/098): a student who matches the list is pinned to curriculum_for(...). If the
--     listed year has no version (it was typed wrongly or not published yet), the active version is used and the
--     review note says so, so a typing mistake in the list never stops a student from registering.
--   * set_student_curriculum(student_id, year): puts an existing student on a version. Used by the Admin forms after
--     they create an account, and ready for a "Change curriculum" control. Allowed for the System Administrator and
--     for the Registrar of that student's programme. It refuses a year that has no version for the programme.
--
-- Nothing existing changes: a student with no curriculum year gets the active version as before.
--
-- TO UNDO: drop function public.set_student_curriculum(text, integer); drop function public.curriculum_for(integer,
-- integer); alter table public.expected_student drop column curriculum_year; and re-run db/098 for the trigger.
--
-- Safe to re-run.

alter table public.expected_student add column if not exists curriculum_year smallint;

do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'expected_student_curriculum_year_range') then
        alter table public.expected_student
            add constraint expected_student_curriculum_year_range check (curriculum_year is null or curriculum_year between 2000 and 2100);
    end if;
end $$;

create or replace function public.curriculum_for(p_program integer, p_year integer default null)
returns integer
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select pr.id
  from public.prospectus pr
  where pr.program_id = p_program
    and (
         (p_year is not null and pr.academic_year = p_year)
      or (p_year is null and pr.is_active)
    )
  order by pr.is_active desc, pr.academic_term, pr.id
  limit 1;
$$;

revoke all on function public.curriculum_for(integer, integer) from public, anon, authenticated;
grant execute on function public.curriculum_for(integer, integer) to authenticated;

create or replace function public.set_student_curriculum(p_student_id text, p_year integer)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
    s   public.university_student%rowtype;
    pid integer;
begin
    select * into s from public.university_student where student_id = p_student_id;
    if not found then
        raise exception 'No student with ID %.', p_student_id using errcode = 'P0002';
    end if;

    if not (public.is_system_admin() or public.is_registrar_of_student(s.id)) then
        raise exception 'Not allowed.' using errcode = '42501';
    end if;

    if s.program_id is null then
        raise exception 'This student has no programme, so no curriculum can be chosen.' using errcode = '22023';
    end if;

    pid := public.curriculum_for(s.program_id, p_year);
    if pid is null then
        raise exception 'No curriculum for % exists for this programme.', coalesce(p_year::text, 'the active year') using errcode = '22023';
    end if;

    update public.university_student set prospectus_id = pid where id = s.id;
    return pid;
end;
$$;

revoke all on function public.set_student_curriculum(text, integer) from public, anon, authenticated;
grant execute on function public.set_student_curriculum(text, integer) to authenticated;

-- The registration trigger of db/098, now pinning the curriculum year from the list.
create or replace function public.student_register_autoapprove()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    e      public.expected_student%rowtype;
    v_n    integer;
    v_pros integer;
    v_note text := 'Matched the EDP student list';
begin
    if new.created_via is distinct from 'SELF_REGISTER'
       or new.is_approved is true
       or new.approval_status is distinct from 'pending' then
        return new;
    end if;

    if not exists (select 1 from public.expected_student) then
        raise exception 'Registration is not open yet. Please contact the EDP office.' using errcode = '42501';
    end if;

    select count(*) into v_n
    from public.expected_student x
    where new.program_id is not null
      and x.program_id = new.program_id
      and lower(btrim(x.email)) = lower(btrim(coalesce(new.email, '')))
      and (
            (new.declared_path = 'existing' and new.student_id is not null and x.student_id = new.student_id)
         or (new.declared_path = 'new'
             and public._norm_name(x.first_name) = public._norm_name(new.first_name)
             and public._norm_name(x.last_name)  = public._norm_name(new.last_name))
      );

    if v_n <> 1 then
        raise exception 'These details do not match the EDP student list. Check your name, student ID, degree program and e-mail, or contact the EDP office.'
            using errcode = '42501';
    end if;

    select x.* into e
    from public.expected_student x
    where x.program_id = new.program_id
      and lower(btrim(x.email)) = lower(btrim(coalesce(new.email, '')))
      and (
            (new.declared_path = 'existing' and x.student_id = new.student_id)
         or (new.declared_path = 'new'
             and public._norm_name(x.first_name) = public._norm_name(new.first_name)
             and public._norm_name(x.last_name)  = public._norm_name(new.last_name))
      )
    limit 1;

    if exists (select 1 from public.university_student s where s.student_id = e.student_id) then
        raise exception 'This student already has an account. Log in, or use "Forgot password?".'
            using errcode = '42501';
    end if;

    -- The curriculum of the listed year when there is one; otherwise (or when that year has no version) the active one.
    if e.curriculum_year is not null then
        v_pros := public.curriculum_for(e.program_id, e.curriculum_year);
        if v_pros is null then
            v_note := v_note || '; curriculum ' || e.curriculum_year || ' not found, active curriculum used';
        end if;
    end if;
    if v_pros is null then
        v_pros := public.curriculum_for(e.program_id, null);
    end if;

    new.student_id      := e.student_id;
    new.first_name      := e.first_name;
    new.last_name       := e.last_name;
    new.year_level      := e.year_level;
    new.prospectus_id   := v_pros;
    new.is_approved     := true;
    new.approval_status := 'approved';
    new.reviewed_at     := now();
    new.review_note     := v_note;
    return new;
end;
$$;

revoke all on function public.student_register_autoapprove() from public, anon, authenticated;
