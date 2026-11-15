-- 114_department_multi_program.sql
--
-- STATUS: DRAFTED, NOT APPLIED. Needs a backup first and the owner's explicit yes (production security rules).
--
-- A Department account (a "Dean") can cover MORE THAN ONE programme, but only RELATED ones: programmes of the same
-- college, like Faculty (db/107, db/108). A dean over BSIT may also cover IS, AI or Animation, never Nursing.
--
-- Same shape as db/107 and db/110:
--   * department_staff.program_id stays as the account's MAIN programme (everything that reads it keeps working).
--   * a new table department_program lists EVERY programme the account covers, the main one included. Existing
--     accounts are copied in, so nobody loses access.
--   * the rules that said "the row belongs to MY programme" now say "to ANY of my programmes", through one function,
--     department_covers_program(programme). Policies and functions are rewritten from the 6 Nov 2026 schema snapshot
--     and change in exactly that one respect.
--   * the cap stays at 1 Department account per programme, counted across everyone who covers it (a trigger).
--   * the college rule is a trigger, so it holds however a row gets in.
--   * Admin sets the list through set_department_programs(); the table has no write policy for anyone else.
--   * every cross-table check inside a security rule goes through a SECURITY DEFINER function, so the rules cannot
--     loop (the mistake db/107 made and db/109 repaired).
--
-- What is NOT changed on purpose: grade files stay "uploaded by me", the stage tables stay "my own uploads", and
-- create_staff_account still counts the cap from the main programme.
--
-- TO UNDO (in this order):
--   drop trigger department_program_college on public.department_program;
--   drop trigger department_program_cap on public.department_program;
--   drop trigger department_main_program_link on public.department_staff;
--   re-create the 6 policies, 9 functions, is_department_of_student, can_read_program and department_ids_for_my_registrar
--   from schema-snapshot-2026-11-06.sql / db/110 (they are the "before" text of this file);
--   drop function public.set_department_programs(uuid, integer[]); drop function public.department_covers_program(integer);
--   drop function public.my_department_programs(); drop function public.is_my_department_row(uuid);
--   drop table public.department_program;
--
-- Safe to re-run.

-- ── 1. The table ───────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.department_program (
    department_id uuid    not null references public.department_staff(id) on delete cascade,
    program_id    integer not null references public.program(id),
    created_at    timestamptz not null default now(),
    primary key (department_id, program_id)
);

create index if not exists department_program_program_idx on public.department_program (program_id);

insert into public.department_program (department_id, program_id)
select id, program_id from public.department_staff where program_id is not null
on conflict do nothing;

-- ── 2. The main programme is always in the list ────────────────────────────────────────────────────────────────
create or replace function public.department_main_program_link()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
    if new.program_id is not null then
        insert into public.department_program (department_id, program_id)
        values (new.id, new.program_id)
        on conflict do nothing;
    end if;
    return new;
end;
$$;

drop trigger if exists department_main_program_link on public.department_staff;
create trigger department_main_program_link
    after insert or update of program_id on public.department_staff
    for each row execute function public.department_main_program_link();

-- ── 3. The cap: 1 Department account per programme, counted across everyone who covers it ──────────────────────
create or replace function public.department_program_cap()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
    v_code text;
begin
    -- A row that is already there is not a new claim on the programme: "insert ... on conflict do nothing" fires this
    -- trigger first, and BSIT already has two Department accounts (made before the cap existed). Neither may be locked
    -- out of editing because of the other.
    if exists (
        select 1 from public.department_program
        where program_id = new.program_id and department_id = new.department_id
    ) then
        return new;
    end if;

    if exists (
        select 1 from public.department_program
        where program_id = new.program_id and department_id <> new.department_id
    ) then
        select code into v_code from public.program where id = new.program_id;
        raise exception '% already has its Department account.', coalesce(v_code, 'This programme')
            using errcode = '23505';
    end if;
    return new;
end;
$$;

drop trigger if exists department_program_cap on public.department_program;
create trigger department_program_cap
    before insert on public.department_program
    for each row execute function public.department_program_cap();

-- ── 4. Related programmes only: the same college ───────────────────────────────────────────────────────────────
create or replace function public.department_program_college()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
    v_college text;
    v_clash   boolean;
begin
    select lower(btrim(coalesce(college, ''))) into v_college from public.program where id = new.program_id;

    select exists (
        select 1
        from public.department_program dp
        join public.program p on p.id = dp.program_id
        where dp.department_id = new.department_id
          and dp.program_id <> new.program_id
          and lower(btrim(coalesce(p.college, ''))) <> coalesce(v_college, '')
    ) into v_clash;

    if v_clash then
        raise exception 'A Department account can only cover programmes from one college.'
            using errcode = '23514';
    end if;
    return new;
end;
$$;

drop trigger if exists department_program_college on public.department_program;
create trigger department_program_college
    before insert on public.department_program
    for each row execute function public.department_program_college();

-- ── 5. Helpers (all SECURITY DEFINER, so no rule can loop through another rule) ────────────────────────────────
create or replace function public.is_my_department_row(p_department_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
    select exists (select 1 from public.department_staff d where d.id = p_department_id and d.user_id = auth.uid());
$$;

create or replace function public.my_department_programs()
returns integer[]
language sql
stable
security definer
set search_path to 'public'
as $$
    select coalesce(array_agg(dp.program_id), '{}'::integer[])
    from public.department_program dp
    join public.department_staff d on d.id = dp.department_id
    where d.user_id = auth.uid() and d.is_approved;
$$;

-- True when the caller is an approved Department account that covers [p_program_id]. Null is never covered.
create or replace function public.department_covers_program(p_program_id integer)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
    select p_program_id is not null and p_program_id = any (public.my_department_programs());
$$;

revoke all on function public.is_my_department_row(uuid) from public, anon, authenticated, service_role;
grant execute on function public.is_my_department_row(uuid) to authenticated;
grant execute on function public.is_my_department_row(uuid) to service_role;
revoke all on function public.my_department_programs() from public, anon, authenticated, service_role;
grant execute on function public.my_department_programs() to authenticated;
grant execute on function public.my_department_programs() to service_role;
revoke all on function public.department_covers_program(integer) from public, anon, authenticated, service_role;
grant execute on function public.department_covers_program(integer) to authenticated;
grant execute on function public.department_covers_program(integer) to service_role;

-- ── 6. Who can read the list ───────────────────────────────────────────────────────────────────────────────────
alter table public.department_program enable row level security;

drop policy if exists "department reads own programmes"   on public.department_program;
drop policy if exists "admin reads department programmes" on public.department_program;
drop policy if exists "registrar reads department programmes" on public.department_program;

create policy "department reads own programmes" on public.department_program
    for select to authenticated
    using (public.is_my_department_row(department_id));

create policy "admin reads department programmes" on public.department_program
    for select to authenticated
    using (public.is_system_admin());

create policy "registrar reads department programmes" on public.department_program
    for select to authenticated
    using (program_id = any (public.my_registrar_programs()));

-- No insert, update or delete policy: only set_department_programs() (below) changes the list.

-- ── 7. Admin sets the list ─────────────────────────────────────────────────────────────────────────────────────
create or replace function public.set_department_programs(p_department_id uuid, p_program_ids integer[])
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
    v_ids     integer[];
    v_main    integer;
    v_missing integer;
begin
    if not public.is_system_admin() then
        raise exception 'Only an administrator can change a Department account''s programmes.' using errcode = '42501';
    end if;

    select array_agg(distinct x order by x) into v_ids from unnest(coalesce(p_program_ids, '{}'::integer[])) as x where x is not null;

    if v_ids is null or array_length(v_ids, 1) is null then
        raise exception 'A Department account must cover at least one programme.' using errcode = '22023';
    end if;
    if array_length(v_ids, 1) > 12 then
        raise exception 'Too many programmes chosen.' using errcode = '22023';
    end if;

    select program_id into v_main from public.department_staff where id = p_department_id for update;
    if not found then
        raise exception 'That Department account was not found.' using errcode = '02000';
    end if;

    select count(*) into v_missing from unnest(v_ids) as x where not exists (select 1 from public.program where id = x);
    if v_missing > 0 then
        raise exception 'One of the chosen programmes does not exist.' using errcode = '23503';
    end if;

    -- The main programme moves only if the old one was taken away.
    if v_main is null or not (v_main = any (v_ids)) then
        v_main := v_ids[1];
    end if;

    delete from public.department_program
    where department_id = p_department_id and not (program_id = any (v_ids));

    -- New rows go through the cap and college triggers. Rows already there are left alone.
    insert into public.department_program (department_id, program_id)
    select p_department_id, x from unnest(v_ids) as x
    on conflict do nothing;

    update public.department_staff set program_id = v_main where id = p_department_id and program_id is distinct from v_main;
end;
$$;

revoke all on function public.set_department_programs(uuid, integer[]) from public, anon, authenticated, service_role;
grant execute on function public.set_department_programs(uuid, integer[]) to authenticated;
grant execute on function public.set_department_programs(uuid, integer[]) to service_role;

-- ── 8. The access helpers now use the list ─────────────────────────────────────────────────────────────────────
create or replace function public.is_department_of_student(p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
    select exists (
        select 1 from university_student s
        where s.id = p_student_id and s.program_id is not null and public.department_covers_program(s.program_id)
    );
$$;

create or replace function public.department_ids_for_my_registrar()
returns setof uuid
language sql
stable
security definer
set search_path to 'public'
as $$
    select distinct dp.department_id from public.department_program dp
    where dp.program_id = any (public.my_registrar_programs());
$$;

create or replace function public.can_read_program(p_program_id integer)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
    select p_program_id is not null and (
        exists (select 1 from system_administrator where user_id = auth.uid() and is_approved)
        or exists (select 1 from university_student where user_id = auth.uid() and program_id = p_program_id)
        or p_program_id = any (public.my_faculty_programs())
        or p_program_id = any (public.my_registrar_programs())
        or p_program_id = any (public.my_department_programs())
    );
$$;

-- ── 9. The Department rules, rewritten: "my programme" became "any of my programmes" ──────────────────────────
-- 9a. functions (9)
CREATE OR REPLACE FUNCTION public.activate_prospectus(target_id integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_program integer;
    v_year    integer;
    v_current integer;
begin
    if not exists (
        select 1 from department_staff
        where user_id = auth.uid() and is_approved
    ) then
        raise exception 'Only Department Staff can activate a curriculum version.'
            using errcode = '42501';
    end if;

    select program_id, academic_year into v_program, v_year from prospectus where id = target_id;

    if v_program is null then
        raise exception 'No such prospectus version.' using errcode = '22023';
    end if;

    if not public.department_covers_program(v_program) then
        raise exception 'You can only activate a curriculum version of your own programme.'
            using errcode = '42501';
    end if;

    if not exists (select 1 from subject where prospectus_id = target_id) then
        raise exception 'That version has no subjects. A student placed on it '
                        'would have no curriculum to be assessed against.'
            using errcode = '22023';
    end if;

    if not exists (
        select 1
        from subject_offering o
        join subject s on s.id = o.subject_id
        where s.prospectus_id = target_id
    ) then
        raise exception 'That version has no schedule yet. Add its sections on the Schedule tab '
                        'first, so a student placed on it has subjects to enrol in.'
            using errcode = '22023';
    end if;

    select current_academic_year into v_current from system_config where id = 1;

    if v_current is not null and v_year > v_current then
        raise exception 'That version takes effect in % (the system is on %). A student placed on it '
                        'would have a curriculum that has not started. Activate it when its year begins.',
                        v_year, v_current
            using errcode = '22023';
    end if;

    -- One active version per programme. Deactivate first so the partial
    -- unique index is never momentarily violated.
    update prospectus set is_active = false, updated_at = now()
    where program_id = v_program and is_active and id <> target_id;

    update prospectus
    set is_active = true, published_at = coalesce(published_at, now()),
        updated_at = now()
    where id = target_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.copy_prospectus(source_id integer, new_year integer, new_term integer DEFAULT NULL::integer, author uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_me       uuid    := public.my_department_staff_id();
    v_prog     integer;
    v_src      prospectus%rowtype;
    v_new      integer;
    v_subjects integer := 0;
    v_total    integer := 0;
    v_rules    integer := 0;
    v_groups   integer := 0;
    v_members  integer := 0;
    v_n        integer;
    g          record;
    v_gid      integer;
begin
    -- Same message whether the version does not exist or belongs to another
    -- programme, so this cannot be used to discover which versions exist.
    select * into v_src from prospectus where id = source_id;
    v_prog := v_src.program_id;
    if auth.uid() is null or v_me is null or v_src.id is null
       or not public.department_covers_program(v_prog) then
        raise exception 'Only the Department Staff of this programme can copy a curriculum version.'
            using errcode = '42501';
    end if;

    if new_year is null or new_year not between 2000 and 2100 then
        raise exception 'Enter a four-digit effective year.' using errcode = '22023';
    end if;
    if new_term is not null and new_term not between 1 and 3 then
        raise exception 'The term must be 1, 2 or 3.' using errcode = '22023';
    end if;

    -- Two people creating the same year at the same moment must not both pass
    -- the check below.
    perform pg_advisory_xact_lock(hashtext('copy_prospectus:' || v_prog::text || ':' || new_year::text));

    if exists (select 1 from prospectus where program_id = v_prog and academic_year = new_year) then
        raise exception 'A % version already exists.', new_year using errcode = '23505';
    end if;

    -- 1. the version
    insert into prospectus (program_id, academic_year, academic_term, is_active, created_by)
    values (v_prog, new_year, coalesce(new_term, v_src.academic_term), false, v_me)
    returning id into v_new;

    -- 2. active subjects (code is unique inside a version, so it maps old -> new)
    insert into subject (prospectus_id, code, title, units, year_level, term, is_elective,
                         lec_units, lab_units, category, elective_type, is_active, created_by)
    select v_new, s.code, s.title, s.units, s.year_level, s.term, s.is_elective,
           s.lec_units, s.lab_units, s.category, s.elective_type, true, v_me
    from subject s
    where s.prospectus_id = source_id and s.is_active;
    get diagnostics v_subjects = row_count;

    -- 3. rules between those subjects, re-pointed at the new ids
    select count(*) into v_total
    from prerequisite p
    join subject os on os.id = p.subject_id and os.prospectus_id = source_id and os.is_active;

    insert into prerequisite (subject_id, prerequisite_subject_id, requirement_type,
                              rule_type, threshold_value, rule_group, created_by)
    select ns.id, np.id, p.requirement_type, p.rule_type, p.threshold_value, p.rule_group, v_me
    from prerequisite p
    join subject os on os.id = p.subject_id and os.prospectus_id = source_id and os.is_active
    join subject ns on ns.prospectus_id = v_new and ns.code = os.code
    left join subject op on op.id = p.prerequisite_subject_id
    left join subject np on np.prospectus_id = v_new and np.code = op.code
    where p.prerequisite_subject_id is null                              -- a standing rule
       or (op.prospectus_id = source_id and op.is_active and np.id is not null);
    get diagnostics v_rules = row_count;

    -- 4. elective groups and members
    for g in select id, name, required_count from elective_group where prospectus_id = source_id loop
        insert into elective_group (prospectus_id, name, required_count, created_by)
        values (v_new, g.name, g.required_count, v_me)
        returning id into v_gid;
        v_groups := v_groups + 1;

        insert into elective_group_member (elective_group_id, subject_id)
        select v_gid, ns.id
        from elective_group_member m
        join subject os on os.id = m.subject_id and os.prospectus_id = source_id and os.is_active
        join subject ns on ns.prospectus_id = v_new and ns.code = os.code
        where m.elective_group_id = g.id;
        get diagnostics v_n = row_count;
        v_members := v_members + v_n;
    end loop;

    insert into audit_log (actor_id, actor_role, action, table_name, record_id, new_values)
    values (auth.uid(), 'department_staff', 'COPY_PROSPECTUS', 'prospectus', v_new::text,
            jsonb_build_object('source_id', source_id, 'new_year', new_year,
                               'subjects', v_subjects, 'rules', v_rules,
                               'skipped_rules', v_total - v_rules,
                               'elective_groups', v_groups));

    return jsonb_build_object(
        'ok', true,
        'id', v_new,
        'academic_year', new_year,
        'subjects', v_subjects,
        'prerequisites', v_rules,
        'skipped_rules', v_total - v_rules,
        'elective_groups', v_groups,
        'elective_members', v_members
    );
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_draft_prospectus(target_id integer, confirm boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    p_record       RECORD;
    sub_ids        INT[];
    sub_count      INT := 0;
    prereq_count   INT := 0;
    eg_count       INT := 0;
    egm_count      INT := 0;
    req_count      INT := 0;
    reqitem_count  INT := 0;
    stu_count      INT := 0;
    acad_count     INT := 0;
    gfr_count      INT := 0;
BEGIN
    SELECT id, academic_year, is_active, program_id
      INTO p_record
      FROM prospectus
     WHERE id = target_id;

    -- Same message whether the version does not exist or belongs to another
    -- programme, so this cannot be used to discover which versions exist.
    IF auth.uid() IS NULL
       OR NOT public.department_covers_program(p_record.program_id) THEN
        RAISE EXCEPTION 'Only the Department Staff of this programme can delete a curriculum version.'
            USING ERRCODE = '42501';
    END IF;

    IF p_record.is_active THEN
        RETURN jsonb_build_object(
            'ok', false,
            'error', 'Cannot delete the active version. Make another version active first.'
        );
    END IF;

    SELECT ARRAY_AGG(id) INTO sub_ids FROM subject WHERE prospectus_id = target_id;
    sub_count := COALESCE(array_length(sub_ids, 1), 0);

    IF sub_count > 0 THEN
        SELECT COUNT(*) INTO prereq_count
          FROM prerequisite
         WHERE subject_id = ANY(sub_ids)
            OR prerequisite_subject_id = ANY(sub_ids);

        SELECT COUNT(*) INTO acad_count
          FROM academic_record WHERE subject_id = ANY(sub_ids);

        SELECT COUNT(*) INTO gfr_count
          FROM grade_file_row WHERE subject_id = ANY(sub_ids);

        SELECT COUNT(*) INTO reqitem_count
          FROM request_item WHERE subject_id = ANY(sub_ids);
    END IF;

    SELECT COUNT(*) INTO eg_count FROM elective_group WHERE prospectus_id = target_id;
    IF eg_count > 0 THEN
        SELECT COUNT(*) INTO egm_count
          FROM elective_group_member
         WHERE elective_group_id IN (
             SELECT id FROM elective_group WHERE prospectus_id = target_id
         );
    END IF;

    SELECT COUNT(*) INTO req_count FROM request WHERE prospectus_id = target_id;
    SELECT COUNT(*) INTO stu_count FROM university_student WHERE prospectus_id = target_id;

    -- Refusal checks, evaluated in BOTH modes, so the frontend knows upfront
    -- that the delete would be refused and never opens the confirmation modal
    -- just to fail at the end.
    IF stu_count > 0 THEN
        RETURN jsonb_build_object('ok', false,
            'error', format('%s student(s) are still enrolled under this version. Move them to another version first.', stu_count));
    END IF;

    IF acad_count > 0 THEN
        RETURN jsonb_build_object('ok', false,
            'error', format('%s academic record(s) reference subjects in this version — deleting would lose those grades from student transcripts.', acad_count));
    END IF;

    IF gfr_count > 0 THEN
        RETURN jsonb_build_object('ok', false,
            'error', format('%s grade upload row(s) reference subjects in this version.', gfr_count));
    END IF;

    IF req_count > 0 THEN
        RETURN jsonb_build_object('ok', false,
            'error', format('%s request(s) reference this version. Resolve them first.', req_count));
    END IF;

    IF reqitem_count > 0 THEN
        RETURN jsonb_build_object('ok', false,
            'error', format('%s request item(s) reference subjects in this version.', reqitem_count));
    END IF;

    -- Check-only mode: everything is clear, report what WOULD go.
    IF NOT confirm THEN
        RETURN jsonb_build_object(
            'ok', true,
            'check', true,
            'academic_year',        p_record.academic_year,
            'subjects',             sub_count,
            'prerequisites',        prereq_count,
            'elective_groups',      eg_count,
            'elective_members',     egm_count
        );
    END IF;

    -- Cascade delete in FK-safe order.
    IF sub_count > 0 THEN
        DELETE FROM prerequisite
         WHERE subject_id = ANY(sub_ids)
            OR prerequisite_subject_id = ANY(sub_ids);
    END IF;

    IF eg_count > 0 THEN
        DELETE FROM elective_group_member
         WHERE elective_group_id IN (
             SELECT id FROM elective_group WHERE prospectus_id = target_id
         );
    END IF;

    DELETE FROM elective_group WHERE prospectus_id = target_id;
    DELETE FROM subject        WHERE prospectus_id = target_id;
    DELETE FROM prospectus     WHERE id = target_id;

    RETURN jsonb_build_object(
        'ok', true, 'deleted', true,
        'academic_year',        p_record.academic_year,
        'subjects',             sub_count,
        'prerequisites',        prereq_count,
        'elective_groups',      eg_count,
        'elective_members',     egm_count
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.retire_subject(target_id integer, restore boolean DEFAULT false, confirm boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_staff     uuid;
    v_code      text;
    v_program   integer;
    v_records   integer;
    v_dependent text[];
    v_offerings integer;
begin
    select id into v_staff from department_staff
    where user_id = auth.uid() and is_approved;

    if v_staff is null then
        raise exception 'Only Department Staff can retire a subject.'
            using errcode = '42501';
    end if;

    select s.code, p.program_id into v_code, v_program
    from subject s
    join prospectus p on p.id = s.prospectus_id
    where s.id = target_id;

    if v_code is null then
        raise exception 'No such subject.' using errcode = '22023';
    end if;

    if not public.department_covers_program(v_program) then
        raise exception 'You can only retire a subject of your own programme.'
            using errcode = '42501';
    end if;

    if restore then
        update subject
        set is_active = true, retired_at = null, retired_by = null,
            updated_at = now()
        where id = target_id;

        return jsonb_build_object('done', true, 'code', v_code, 'restored', true);
    end if;

    -- How many students have taken it. Not a blocker: their records stay
    -- readable either way. It is the number that tells the operator this
    -- subject has history.
    select count(*) into v_records
    from academic_record where subject_id = target_id;

    -- Subjects that require this one. Deactivating it leaves them with a
    -- condition no student can ever satisfy, which blocks them silently —
    -- the one consequence nothing else in the system would surface.
    select array_agg(distinct s.code order by s.code) into v_dependent
    from prerequisite p
    join subject s on s.id = p.subject_id
    where p.prerequisite_subject_id = target_id and s.is_active;

    select count(*) into v_offerings
    from subject_offering where subject_id = target_id;

    if not confirm then
        return jsonb_build_object(
            'done',       false,
            'code',       v_code,
            'records',    v_records,
            'dependents', coalesce(v_dependent, array[]::text[]),
            'offerings',  v_offerings
        );
    end if;

    update subject
    set is_active = false, retired_at = now(), retired_by = v_staff,
        updated_at = now()
    where id = target_id;

    insert into audit_log (actor_id, actor_role, action, table_name, record_id, new_values)
    values (auth.uid(), 'department_staff', 'RETIRE_SUBJECT', 'subject',
            target_id::text,
            jsonb_build_object('code', v_code, 'records', v_records,
                               'dependents', coalesce(v_dependent, array[]::text[])));

    return jsonb_build_object('done', true, 'code', v_code,
                              'records', v_records,
                              'dependents', coalesce(v_dependent, array[]::text[]));
end;
$function$;

CREATE OR REPLACE FUNCTION public.section_demand(p_year integer, p_term integer)
 RETURNS TABLE(subject_id integer, subject_code text, subject_title text, section text, edp_codes text[], capacity integer, is_open boolean, selected integer, awaiting integer, approved integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
          and public.department_covers_program(p.program_id)
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
$function$;

CREATE OR REPLACE FUNCTION public.section_demand_students(p_subject_id integer, p_section text, p_year integer, p_term integer)
 RETURNS TABLE(student_id text, first_name text, last_name text, year_level integer, request_status text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
          and public.department_covers_program(p.program_id)
          and r.status in ('submitted', 'approved', 'partially_approved')
          and r.registrar_status is distinct from 'rejected'
          and ri.status is distinct from 'rejected'
          and is_department_of_student(u.id)
        order by u.id, r.created_at desc
    ) t
    order by t.last_name, t.first_name;
$function$;

CREATE OR REPLACE FUNCTION public.set_section_all_open(p_section text, p_year integer, p_term integer, p_open boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_program     integer := my_department_program();
    v_found       integer;
    v_updated     integer := 0;
    v_subject_ids integer[];
    v_notified    integer := 0;
begin
    if v_program is null then
        raise exception 'Only approved Department staff can open or close a section.' using errcode = '42501';
    end if;
    if p_open is null then
        raise exception 'Say whether the section is open or closed.';
    end if;
    if p_section is null or btrim(p_section) = '' then
        raise exception 'Say which section.';
    end if;

    -- the section's meetings that belong to this department's own curriculum
    select count(*) into v_found
      from subject_offering so
      join subject s   on s.id = so.subject_id
      join prospectus p on p.id = s.prospectus_id
     where public.department_covers_program(p.program_id) and so.section = p_section
       and so.academic_year = p_year and so.term = p_term;
    if v_found = 0 then
        raise exception 'No such section this term.';
    end if;

    with changed as (
        update subject_offering so
           set is_open = p_open, updated_at = now()
          from subject s
          join prospectus p on p.id = s.prospectus_id
         where s.id = so.subject_id and public.department_covers_program(p.program_id)
           and so.section = p_section and so.academic_year = p_year and so.term = p_term
           and so.is_open is distinct from p_open
        returning so.subject_id
    )
    select count(*), coalesce(array_agg(distinct subject_id), '{}')
      into v_updated, v_subject_ids
      from changed;

    -- tell the students who chose any of the changed subjects, once each
    if not p_open and v_updated > 0 then
        insert into notification (user_id, type, title, message, related_request_id)
        select u.user_id, 'section_closed',
               'A section you chose was closed',
               left('The Department closed section ' || p_section || ' for '
                    || string_agg(distinct s.code::text, ', ' order by s.code::text)
                    || '. Choose another section of ' || case when count(distinct s.id) = 1 then 'this subject' else 'each of these subjects' end
                    || ' before you go to the EDP office. Your other subjects are not affected.', 1000),
               (array_agg(r.id order by r.created_at desc))[1]
          from subject_offering so
          join request_item ri     on ri.offering_id = so.id
          join request r           on r.id = ri.request_id
          join subject s           on s.id = so.subject_id
          join university_student u on u.id = r.student_id
         where so.subject_id = any (v_subject_ids)
           and so.section = p_section and so.academic_year = p_year and so.term = p_term
           and r.status in ('submitted', 'approved', 'partially_approved')
           and r.registrar_status is distinct from 'rejected'
           and ri.status is distinct from 'rejected'
         group by u.user_id;
        get diagnostics v_notified = row_count;
    end if;

    return jsonb_build_object('updated', v_updated, 'subjects', coalesce(array_length(v_subject_ids, 1), 0),
                              'notified', v_notified);
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_section_open(p_subject_id integer, p_section text, p_year integer, p_term integer, p_open boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_program  integer := my_department_program();
    v_code     text;
    v_edp      text;
    v_updated  integer;
    v_notified integer := 0;
begin
    if v_program is null then
        raise exception 'Only approved Department staff can open or close a section.' using errcode = '42501';
    end if;
    if p_open is null then
        raise exception 'Say whether the section is open or closed.';
    end if;

    select s.code::text into v_code
      from subject s
      join prospectus p on p.id = s.prospectus_id
     where s.id = p_subject_id and public.department_covers_program(p.program_id);
    if v_code is null then
        raise exception 'That subject is not in your department''s curriculum.' using errcode = '42501';
    end if;

    select string_agg(distinct so.edp_code::text, ' + ' order by so.edp_code::text)
      into v_edp
      from subject_offering so
     where so.subject_id = p_subject_id and so.section = p_section
       and so.academic_year = p_year and so.term = p_term;

    update subject_offering
       set is_open = p_open, updated_at = now()
     where subject_id = p_subject_id and section = p_section
       and academic_year = p_year and term = p_term
       and is_open is distinct from p_open;
    get diagnostics v_updated = row_count;

    if v_updated = 0 and v_edp is null then
        raise exception 'No such section this term.';
    end if;

    if not p_open and v_updated > 0 then
        insert into notification (user_id, type, title, message, related_request_id)
        select u.user_id, 'section_closed',
               'A section you chose was closed',
               left('The Department closed section ' || p_section || ' of ' || v_code
                    || coalesce(' (EDP ' || v_edp || ')', '')
                    || '. Choose another section of this subject before you go to the EDP office. '
                    || 'Your other subjects are not affected.', 1000),
               picked.request_id
          from (
              select distinct on (r.student_id) r.student_id, r.id as request_id
                from subject_offering so
                join request_item ri on ri.offering_id = so.id
                join request r       on r.id = ri.request_id
               where so.subject_id = p_subject_id and so.section = p_section
                 and so.academic_year = p_year and so.term = p_term
                 and r.status in ('submitted', 'approved', 'partially_approved')
                 and r.registrar_status is distinct from 'rejected'
                 and ri.status is distinct from 'rejected'
               order by r.student_id, r.created_at desc
          ) picked
          join university_student u on u.id = picked.student_id;
        get diagnostics v_notified = row_count;
    end if;

    return jsonb_build_object('updated', v_updated, 'notified', v_notified);
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_subject(target_id integer, p_code text, p_title text, p_lec numeric, p_lab numeric, p_year integer DEFAULT NULL::integer, p_term integer DEFAULT NULL::integer, p_category text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_staff   uuid;
    v_old     record;
    v_program integer;
    v_units   numeric;
begin
    select id into v_staff from department_staff
    where user_id = auth.uid() and is_approved;

    if v_staff is null then
        raise exception 'Only Department Staff can edit a subject.'
            using errcode = '42501';
    end if;

    select * into v_old from subject where id = target_id;
    if v_old.id is null then
        raise exception 'No such subject.' using errcode = '22023';
    end if;

    select program_id into v_program from prospectus where id = v_old.prospectus_id;
    if not public.department_covers_program(v_program) then
        raise exception 'You can only edit a subject of your own programme.'
            using errcode = '42501';
    end if;

    if coalesce(trim(p_code), '') = '' then
        raise exception 'Code is required.' using errcode = '22023';
    end if;

    if trim(p_code) !~ '^[A-Za-z][A-Za-z0-9 _-]*$' then
        raise exception 'Code must start with a letter.' using errcode = '22023';
    end if;

    if coalesce(trim(p_title), '') = '' then
        raise exception 'Title is required.' using errcode = '22023';
    end if;

    if p_title !~ '[A-Za-z]' then
        raise exception 'Title must contain words, not only numbers.'
            using errcode = '22023';
    end if;

    v_units := coalesce(p_lec, 0) + coalesce(p_lab, 0);
    if v_units <= 0 then
        raise exception 'Units must be more than zero.' using errcode = '22023';
    end if;

    if exists (
        select 1 from subject
        where prospectus_id = v_old.prospectus_id
          and upper(code) = upper(trim(p_code))
          and id <> target_id
    ) then
        raise exception 'Another subject in this curriculum year already uses %',
            upper(trim(p_code)) using errcode = '23505';
    end if;

    update subject
    set code       = upper(trim(p_code)),
        title      = trim(p_title),
        lec_units  = coalesce(p_lec, 0),
        lab_units  = coalesce(p_lab, 0),
        units      = v_units,
        year_level = p_year,
        term       = p_term,
        category   = coalesce(p_category, category),
        updated_at = now()
    where id = target_id;

    insert into audit_log (actor_id, actor_role, action, table_name, record_id,
                           old_values, new_values)
    values (auth.uid(), 'department_staff', 'UPDATE_SUBJECT', 'subject',
            target_id::text,
            jsonb_build_object('code', v_old.code, 'title', v_old.title,
                               'units', v_old.units, 'lec', v_old.lec_units,
                               'lab', v_old.lab_units,
                               'year', v_old.year_level, 'term', v_old.term),
            jsonb_build_object('code', upper(trim(p_code)), 'title', trim(p_title),
                               'units', v_units, 'lec', coalesce(p_lec, 0),
                               'lab', coalesce(p_lab, 0),
                               'year', p_year, 'term', p_term));

    return jsonb_build_object(
        'done', true,
        'code', upper(trim(p_code)),
        'code_changed', upper(v_old.code) is distinct from upper(trim(p_code)),
        'records', (select count(*) from academic_record where subject_id = target_id)
    );
end;
$function$;

-- 9b. policies (6)
drop policy if exists department_manage_elective_groups on public.elective_group;
create policy department_manage_elective_groups on public.elective_group as permissive for all to authenticated using ((prospectus_id IN ( SELECT prospectus.id
   FROM prospectus
  WHERE (department_covers_program(prospectus.program_id))))) with check ((prospectus_id IN ( SELECT prospectus.id
   FROM prospectus
  WHERE (department_covers_program(prospectus.program_id)))));

drop policy if exists department_manage_elective_members on public.elective_group_member;
create policy department_manage_elective_members on public.elective_group_member as permissive for all to authenticated using ((elective_group_id IN ( SELECT g.id
   FROM (elective_group g
     JOIN prospectus p ON ((p.id = g.prospectus_id)))
  WHERE (department_covers_program(p.program_id))))) with check ((elective_group_id IN ( SELECT g.id
   FROM (elective_group g
     JOIN prospectus p ON ((p.id = g.prospectus_id)))
  WHERE (department_covers_program(p.program_id)))));

drop policy if exists department_manage_prerequisites on public.prerequisite;
create policy department_manage_prerequisites on public.prerequisite as permissive for all to authenticated using ((subject_id IN ( SELECT s.id
   FROM (subject s
     JOIN prospectus p ON ((p.id = s.prospectus_id)))
  WHERE (department_covers_program(p.program_id))))) with check ((subject_id IN ( SELECT s.id
   FROM (subject s
     JOIN prospectus p ON ((p.id = s.prospectus_id)))
  WHERE (department_covers_program(p.program_id)))));

drop policy if exists department_manage_prospectus on public.prospectus;
create policy department_manage_prospectus on public.prospectus as permissive for all to authenticated using ((department_covers_program(program_id))) with check ((department_covers_program(program_id)));

drop policy if exists department_manage_subjects on public.subject;
create policy department_manage_subjects on public.subject as permissive for all to authenticated using ((prospectus_id IN ( SELECT prospectus.id
   FROM prospectus
  WHERE (department_covers_program(prospectus.program_id))))) with check ((prospectus_id IN ( SELECT prospectus.id
   FROM prospectus
  WHERE (department_covers_program(prospectus.program_id)))));

drop policy if exists department_manage_offerings on public.subject_offering;
create policy department_manage_offerings on public.subject_offering as permissive for all to authenticated using ((subject_id IN ( SELECT s.id
   FROM (subject s
     JOIN prospectus p ON ((p.id = s.prospectus_id)))
  WHERE (department_covers_program(p.program_id))))) with check ((subject_id IN ( SELECT s.id
   FROM (subject s
     JOIN prospectus p ON ((p.id = s.prospectus_id)))
  WHERE (department_covers_program(p.program_id)))));

-- ── 10. Check afterwards (read-only) ───────────────────────────────────────────────────────────────────────────
-- select count(*) as accounts, (select count(*) from public.department_program) as rows_in_list from public.department_staff;   -- equal today
-- select pg_get_functiondef('public.department_covers_program(integer)'::regprocedure);
-- select policyname from pg_policies where qual ilike '%my_department_program()%' or with_check ilike '%my_department_program()%';  -- none
