-- 133_offsem_sections.sql
--
-- WHY
--   A student who failed a subject of ANOTHER semester (for example a 1st-semester subject, now that it is the 2nd
--   semester) had no way to retake it: the Department's schedule builder and file upload only accept a subject whose
--   year and semester match the section and the chosen term ("wrong term"), so no section could be posted for it.
--   Without a section the student cannot send the subject (db/128 and the "no section, no send" rule, 27 Nov 2026).
--
-- WHAT THIS ADDS (nothing existing is changed; two new functions, no new table, no new column)
--   public.add_offsem_section(program_id, subject_id, section, meetings)
--     Posts a section of ANY subject of the programme's curriculum in the CURRENT term (system_config). Who may call it:
--     the System administrator, or an approved Department Staff who covers that programme. Checks, all in one
--     transaction (any failure leaves nothing behind):
--       * the subject belongs to a curriculum of that programme (not retired) and is active
--       * the section is named PROGRAMME-<year><letter>, for example BSIT-1R
--       * 1 to 2 meetings: at most one LEC and one LAB (a LAB only if the subject has laboratory units)
--       * days (M T W TH F S), start before end, between 07:00 and 21:00, a room, a 5-digit EDP code not yet used this term
--       * no overlap in the same room, with the same instructor, or with another meeting of the same section, this term
--     Writes one audit_log row (ADD_OFFSEM_SECTION). The offering is an ordinary subject_offering row, so the engine,
--     Build your plan, the adviser's view, the enrollment form and the Enrolment sheet need no change.
--   public.remove_offsem_section(program_id, section, subject_id)
--     Removes OFF-SEMESTER meetings of a section in the current term (subject's own semester is not the term), only if no
--     student has chosen it yet (no request_item points at it). Same callers. One audit_log row (REMOVE_OFFSEM_SECTION).
--
-- ROLLBACK: drop function public.add_offsem_section(integer, integer, text, jsonb);
--           drop function public.remove_offsem_section(integer, text, integer);
--           (sections already posted stay: they are ordinary schedule rows)

create or replace function public.add_offsem_section(p_program_id integer, p_subject_id integer, p_section text, p_meetings jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
    v_caller uuid := auth.uid();
    v_admin  boolean;
    v_dept   uuid;
    v_year   integer;
    v_term   integer;
    v_code   text;
    v_sec    text := upper(trim(coalesce(p_section, '')));
    v_sub    record;
    m        jsonb;
    i        integer := 0;
    v_type   text;  v_days text;  v_room text;  v_instr text;  v_edp text;
    v_st     time;  v_en time;
    v_id     integer;
    v_types  text[] := '{}';
    v_n      integer := 0;
begin
    if v_caller is null then raise exception 'Sign in first.' using errcode = '42501'; end if;

    v_admin := public.is_system_admin();
    select d.id into v_dept
    from department_staff d
    where d.user_id = v_caller and d.is_approved and public.department_covers_program(p_program_id)
    limit 1;
    if not v_admin and v_dept is null then
        raise exception 'Only the System administrator or a Department Staff of this programme can add an off-semester section.'
            using errcode = '42501';
    end if;

    select code into v_code from program where id = p_program_id;
    if v_code is null then raise exception 'No such programme.' using errcode = '22023'; end if;

    select current_academic_year, current_term into v_year, v_term from system_config where id = 1;
    if v_year is null or v_term is null then raise exception 'The current term is not set.' using errcode = '22023'; end if;

    select s.id, s.code, s.term, s.is_active, coalesce(s.lab_units, 0) as lab_units, pr.program_id, pr.retired_at
      into v_sub
    from subject s join prospectus pr on pr.id = s.prospectus_id
    where s.id = p_subject_id;
    if v_sub.id is null or v_sub.program_id is distinct from p_program_id then
        raise exception 'That subject is not in a curriculum of this programme.' using errcode = '22023';
    end if;
    if v_sub.retired_at is not null or v_sub.is_active is false then
        raise exception 'That subject is retired, so it cannot be offered.' using errcode = '22023';
    end if;

    if v_sec !~ ('^' || v_code || '-[1-9][A-Z]$') then
        raise exception 'The section must be named % followed by a dash, the year and a letter, for example %-1R.', v_code, v_code
            using errcode = '22023';
    end if;

    if jsonb_typeof(p_meetings) is distinct from 'array' or jsonb_array_length(p_meetings) not between 1 and 2 then
        raise exception 'Give one lecture meeting, and one laboratory meeting if the subject has a laboratory.' using errcode = '22023';
    end if;

    for m in select * from jsonb_array_elements(p_meetings) loop
        i := i + 1;
        v_type  := upper(trim(coalesce(m->>'type', 'LEC')));
        v_days  := upper(trim(coalesce(m->>'days', '')));
        v_room  := trim(coalesce(m->>'room', ''));
        v_instr := nullif(trim(coalesce(m->>'instructor', '')), '');
        v_edp   := trim(coalesce(m->>'edp_code', ''));

        if v_type not in ('LEC', 'LAB') then raise exception 'Meeting %: the type must be LEC or LAB.', i using errcode = '22023'; end if;
        if v_type = any (v_types) then raise exception 'Meeting %: there can be only one % meeting.', i, v_type using errcode = '22023'; end if;
        if v_type = 'LAB' and v_sub.lab_units <= 0 then raise exception '% has no laboratory, so it cannot have a LAB meeting.', v_sub.code using errcode = '22023'; end if;
        v_types := v_types || v_type;

        if v_days !~ '^(TH|[MTWFS])+$' then raise exception 'Meeting %: days must be letters like MW, TTH, F or S.', i using errcode = '22023'; end if;
        begin
            v_st := (m->>'start')::time;  v_en := (m->>'end')::time;
        exception when others then
            raise exception 'Meeting %: start and end must be times like 13:00.', i using errcode = '22023';
        end;
        if v_st is null or v_en is null or v_st >= v_en then raise exception 'Meeting %: the start must be before the end.', i using errcode = '22023'; end if;
        if v_st < time '07:00' or v_en > time '21:00' then raise exception 'Meeting %: classes run between 07:00 and 21:00.', i using errcode = '22023'; end if;
        if v_room = '' or length(v_room) > 40 then raise exception 'Meeting %: give a room (up to 40 characters).', i using errcode = '22023'; end if;
        if v_instr is not null and length(v_instr) > 80 then raise exception 'Meeting %: the instructor name is too long.', i using errcode = '22023'; end if;
        if v_edp !~ '^[0-9]{5}$' then raise exception 'Meeting %: the EDP code is five digits.', i using errcode = '22023'; end if;
        if exists (select 1 from subject_offering o where o.academic_year = v_year and o.term = v_term and o.edp_code = v_edp) then
            raise exception 'Meeting %: EDP code % is already used this term.', i, v_edp using errcode = '23505';
        end if;

        insert into subject_offering (subject_id, academic_year, term, section, edp_code, schedule_days, start_time, end_time,
                                      room, instructor, capacity, is_open, created_by, meeting_type)
        values (p_subject_id, v_year, v_term, v_sec, v_edp, v_days, v_st, v_en, v_room, v_instr, null, true, v_dept, v_type)
        returning id into v_id;
        v_n := v_n + 1;

        -- Overlaps, this term, in this programme (days: TH counts as one letter so it is not read as T and H)
        if exists (
            select 1 from subject_offering o join subject s2 on s2.id = o.subject_id join prospectus p2 on p2.id = s2.prospectus_id
            where p2.program_id = p_program_id and o.academic_year = v_year and o.term = v_term and o.id <> v_id
              and lower(coalesce(o.room, '')) = lower(v_room)
              and regexp_split_to_array(replace(upper(coalesce(o.schedule_days, '')), 'TH', 'R'), '') && regexp_split_to_array(replace(v_days, 'TH', 'R'), '')
              and o.start_time < v_en and v_st < o.end_time) then
            raise exception 'Meeting %: room % is already in use at that time.', i, v_room using errcode = '23P01';
        end if;
        if v_instr is not null and exists (
            select 1 from subject_offering o join subject s2 on s2.id = o.subject_id join prospectus p2 on p2.id = s2.prospectus_id
            where p2.program_id = p_program_id and o.academic_year = v_year and o.term = v_term and o.id <> v_id
              and lower(coalesce(o.instructor, '')) = lower(v_instr)
              and regexp_split_to_array(replace(upper(coalesce(o.schedule_days, '')), 'TH', 'R'), '') && regexp_split_to_array(replace(v_days, 'TH', 'R'), '')
              and o.start_time < v_en and v_st < o.end_time) then
            raise exception 'Meeting %: % is already teaching at that time.', i, v_instr using errcode = '23P01';
        end if;
        if exists (
            select 1 from subject_offering o join subject s2 on s2.id = o.subject_id join prospectus p2 on p2.id = s2.prospectus_id
            where p2.program_id = p_program_id and o.academic_year = v_year and o.term = v_term and o.id <> v_id
              and o.section = v_sec
              and regexp_split_to_array(replace(upper(coalesce(o.schedule_days, '')), 'TH', 'R'), '') && regexp_split_to_array(replace(v_days, 'TH', 'R'), '')
              and o.start_time < v_en and v_st < o.end_time) then
            raise exception 'Meeting %: it overlaps another meeting of section %.', i, v_sec using errcode = '23P01';
        end if;
    end loop;

    insert into audit_log (actor_id, actor_role, action, table_name, record_id, new_values)
    values (v_caller, case when v_admin then 'system_administrator' else 'department_staff' end,
            'ADD_OFFSEM_SECTION', 'subject_offering', p_subject_id::text,
            jsonb_build_object('programme', v_code, 'subject', v_sub.code, 'section', v_sec, 'year', v_year, 'term', v_term,
                               'meetings', v_n, 'off_semester', v_sub.term is distinct from v_term));

    return jsonb_build_object('ok', true, 'section', v_sec, 'subject', v_sub.code, 'year', v_year, 'term', v_term,
                              'meetings', v_n, 'off_semester', v_sub.term is distinct from v_term);
end;
$function$;

create or replace function public.remove_offsem_section(p_program_id integer, p_section text, p_subject_id integer default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
    v_caller uuid := auth.uid();
    v_admin  boolean;
    v_dept   uuid;
    v_year   integer;
    v_term   integer;
    v_sec    text := upper(trim(coalesce(p_section, '')));
    v_ids    integer[];
    v_n      integer;
begin
    if v_caller is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
    v_admin := public.is_system_admin();
    select d.id into v_dept from department_staff d
    where d.user_id = v_caller and d.is_approved and public.department_covers_program(p_program_id) limit 1;
    if not v_admin and v_dept is null then
        raise exception 'Only the System administrator or a Department Staff of this programme can remove an off-semester section.'
            using errcode = '42501';
    end if;

    select current_academic_year, current_term into v_year, v_term from system_config where id = 1;

    select array_agg(o.id) into v_ids
    from subject_offering o join subject s on s.id = o.subject_id join prospectus p on p.id = s.prospectus_id
    where p.program_id = p_program_id and o.academic_year = v_year and o.term = v_term and o.section = v_sec
      and s.term is distinct from o.term                         -- off-semester meetings only: a regular section is never touched here
      and (p_subject_id is null or o.subject_id = p_subject_id);

    if v_ids is null then raise exception 'There is no off-semester section % to remove this term.', v_sec using errcode = '22023'; end if;
    if exists (select 1 from request_item ri where ri.offering_id = any (v_ids)) then
        raise exception 'A student has already chosen section %, so it cannot be removed.', v_sec using errcode = '23503';
    end if;

    delete from subject_offering where id = any (v_ids);
    get diagnostics v_n = row_count;

    insert into audit_log (actor_id, actor_role, action, table_name, record_id, old_values)
    values (v_caller, case when v_admin then 'system_administrator' else 'department_staff' end,
            'REMOVE_OFFSEM_SECTION', 'subject_offering', v_sec,
            jsonb_build_object('programme_id', p_program_id, 'section', v_sec, 'year', v_year, 'term', v_term, 'meetings', v_n));

    return jsonb_build_object('ok', true, 'section', v_sec, 'removed', v_n);
end;
$function$;

revoke execute on function public.add_offsem_section(integer, integer, text, jsonb) from public, anon;
grant  execute on function public.add_offsem_section(integer, integer, text, jsonb) to authenticated;
revoke execute on function public.remove_offsem_section(integer, text, integer) from public, anon;
grant  execute on function public.remove_offsem_section(integer, text, integer) to authenticated;
