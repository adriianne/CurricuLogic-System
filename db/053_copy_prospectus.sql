-- 053: copy_prospectus -- "new curriculum version, copied from an existing one".
-- DRAFT: review, then run once in the Supabase SQL editor.
--
-- departmentdashboard.js (createVersion) has always called
--     supabase.rpc('copy_prospectus', { source_id, new_year, new_term, author })
-- but the function was never created in the live database (and there is no
-- migration for it), so choosing a source version ended in an error. The
-- "start empty" path never needed it.
--
-- What it copies, into a NEW draft version of the caller's own programme:
--   * the ACTIVE subjects (a retired subject is not part of the curriculum)
--   * every prerequisite / co-requisite / standing rule between those subjects,
--     pointed at the NEW subject ids (this is why it has to run on the server:
--     the rows must agree with each other or the curriculum is broken)
--   * elective groups and their members, pointed at the new subject ids
-- What it does NOT copy: offerings (per term), students, grades, requests.
-- A rule whose other end is not an active subject of the source version cannot
-- be re-pointed, so it is left out and counted in "skipped_rules".
--
-- Who may call it: an approved Department Staff account, for a version of ITS
-- OWN programme. The creator on the new rows is the signed-in account; the
-- "author" argument the page sends is accepted for compatibility and ignored.
-- Safe to re-run (create or replace).

create or replace function public.copy_prospectus(
    source_id integer,
    new_year  integer,
    new_term  integer default null,
    author    uuid    default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
    v_me       uuid    := public.my_department_staff_id();
    v_prog     integer := public.my_department_program();
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
    if auth.uid() is null or v_me is null or v_prog is null
       or v_src.id is null or v_src.program_id is distinct from v_prog then
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
$$;

-- Signed-in users only (the body checks the role and the programme).
revoke all on function public.copy_prospectus(integer, integer, integer, uuid) from public, anon;
grant execute on function public.copy_prospectus(integer, integer, integer, uuid) to authenticated, service_role;
