-- 129_bulk_staff_programs.sql
--
-- Admin > Staff management: change the programmes of many faculty (or registrars) in ONE action.
--
--   bulk_set_staff_programs(p_role, p_staff_ids, p_mode, p_program_ids, p_apply)
--
--     p_role         'faculty' or 'registrar'  (a Department account stays per person: one account per programme)
--     p_staff_ids    the accounts ticked on the page (at most 100)
--     p_mode         'add'     every programme in p_program_ids is added to each account
--                    'remove'  every programme in p_program_ids is taken off each account
--                    'replace' each account ends up with exactly p_program_ids
--     p_apply        false = PREVIEW: does the work, reports what would happen, and rolls everything back
--                    true  = does it and keeps it
--
--   Returns jsonb { applied, role, mode, programs: [codes], changed, unchanged, skipped,
--                   results: [{ id, employee_id, name, status, before: [codes], after: [codes], reason }] }
--
-- The preview and the real run are the SAME code (the preview raises a private error at the end that undoes the
-- work and carries the answer out), so what the admin reads in the preview is what the real run does.
--
-- Rules are the ones the single Edit already has, enforced by the same triggers, never copied:
--   - faculty_program_cap / registrar_program_cap: at most 10 faculty and 2 registrars per programme
--   - faculty_program_college: a faculty member covers programmes of ONE college only
--   - a person must keep at least one programme
-- and one more, for removing: a faculty member with active advisees in a programme is NOT taken off it
--   (the advisees would be left with no adviser). The person is skipped, with the reason, and the rest go through.
--
-- One account failing never stops the others: each account is done in its own savepoint and is reported as
-- changed / unchanged / skipped. The programmes involved are locked first, in order, with the same lock key as
-- account creation (db/047), so two admins (or an account being created) cannot push a programme past its cap.
-- One audit row records the whole action. Only a System administrator may call it.
--
-- Rollback:  drop function public.bulk_set_staff_programs(text, uuid[], text, integer[], boolean);

create or replace function public.bulk_set_staff_programs(
    p_role        text,
    p_staff_ids   uuid[],
    p_mode        text,
    p_program_ids integer[],
    p_apply       boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_ids     uuid[];
    v_progs   integer[];
    v_missing integer;
    v_link    text;
    v_col     text;
    v_staff   text;
    v_table   text;
    v_sid     uuid;
    v_pid     integer;
    v_cur     integer[];
    v_new     integer[];
    v_removed integer[];
    v_main    integer;
    v_emp     text;
    v_name    text;
    v_n       integer;
    v_results jsonb := '[]'::jsonb;
    v_one     jsonb;
    v_changed integer := 0;
    v_same    integer := 0;
    v_skipped integer := 0;
    v_out     jsonb;
    v_codes   text[];
    v_reason  text;
begin
    if not public.is_system_admin() then
        raise exception 'Only an administrator can change staff programmes.' using errcode = '42501';
    end if;

    if p_role not in ('faculty', 'registrar') then
        raise exception 'Choose faculty or registrar.' using errcode = '22023';
    end if;
    if p_mode not in ('add', 'remove', 'replace') then
        raise exception 'Choose add, remove or replace.' using errcode = '22023';
    end if;

    select array_agg(distinct x order by x) into v_ids   from unnest(coalesce(p_staff_ids,   '{}'::uuid[]))    as x where x is not null;
    select array_agg(distinct x order by x) into v_progs from unnest(coalesce(p_program_ids, '{}'::integer[])) as x where x is not null;

    if v_ids is null then
        raise exception 'Tick at least one account.' using errcode = '22023';
    end if;
    if array_length(v_ids, 1) > 100 then
        raise exception 'At most 100 accounts at a time.' using errcode = '22023';
    end if;
    if v_progs is null then
        raise exception 'Choose at least one programme.' using errcode = '22023';
    end if;
    if array_length(v_progs, 1) > 30 then
        raise exception 'Too many programmes chosen.' using errcode = '22023';
    end if;

    select count(*) into v_missing from unnest(v_progs) as x where not exists (select 1 from program where id = x);
    if v_missing > 0 then
        raise exception 'One of the chosen programmes does not exist.' using errcode = '23503';
    end if;

    v_link  := case p_role when 'faculty' then 'faculty_program'  else 'registrar_program' end;
    v_col   := case p_role when 'faculty' then 'faculty_id'       else 'registrar_id'      end;
    v_staff := case p_role when 'faculty' then 'faculty_staff'    else 'registrar_staff'   end;

    -- Same lock key as account creation (db/047), taken in programme order so two callers cannot deadlock.
    foreach v_pid in array v_progs loop
        perform pg_advisory_xact_lock(hashtext('provision:' || p_role || ':' || v_pid::text));
    end loop;

    begin   -- the work; for a preview it is undone by the error raised at the end
        for v_sid in
            select x from unnest(v_ids) as x
            order by (select employee_id from faculty_staff   where id = x and p_role = 'faculty'),
                     (select employee_id from registrar_staff where id = x and p_role = 'registrar'),
                     x
        loop
            v_one := null;

            execute format('select program_id, employee_id, btrim(coalesce(first_name, '''') || '' '' || coalesce(last_name, '''')) from %I where id = $1 for update', v_staff)
               into v_main, v_emp, v_name using v_sid;
            if v_emp is null then
                v_one := jsonb_build_object('id', v_sid, 'employee_id', null, 'name', null, 'status', 'skipped',
                                            'before', '[]'::jsonb, 'after', '[]'::jsonb, 'reason', 'That account was not found.');
                v_skipped := v_skipped + 1;
                v_results := v_results || v_one;
                continue;
            end if;

            execute format('select coalesce(array_agg(program_id order by program_id), ''{}''::integer[]) from %I where %I = $1', v_link, v_col)
               into v_cur using v_sid;

            v_new := case p_mode
                when 'add'     then (select coalesce(array_agg(distinct y order by y), '{}'::integer[]) from unnest(v_cur || v_progs) as y)
                when 'remove'  then (select coalesce(array_agg(y order by y), '{}'::integer[]) from unnest(v_cur) as y where not (y = any (v_progs)))
                else v_progs
            end;
            v_removed := (select coalesce(array_agg(y order by y), '{}'::integer[]) from unnest(v_cur) as y where not (y = any (v_new)));

            select coalesce(array_agg(code order by code), '{}') into v_codes from program where id = any (v_cur);
            v_one := jsonb_build_object('id', v_sid, 'employee_id', v_emp, 'name', v_name, 'before', to_jsonb(v_codes));

            if v_new = v_cur then
                v_same := v_same + 1;
                v_results := v_results || (v_one || jsonb_build_object('status', 'unchanged', 'after', to_jsonb(v_codes), 'reason', null));
                continue;
            end if;

            begin   -- this account only: any failure undoes just this account
                if array_length(v_new, 1) is null then
                    raise exception 'A % must keep at least one programme.', p_role using errcode = '22023';
                end if;

                if p_role = 'faculty' and array_length(v_removed, 1) is not null then
                    select count(*) into v_n
                      from advisee_assignment a
                      join university_student s on s.id = a.student_id
                     where a.faculty_id = v_sid and a.is_active and s.program_id = any (v_removed);
                    if v_n > 0 then
                        raise exception 'Has % active advisee% in a programme being removed: reassign them first.', v_n, case when v_n = 1 then '' else 's' end
                            using errcode = '23503';
                    end if;
                end if;

                if array_length(v_removed, 1) is not null then
                    execute format('delete from %I where %I = $1 and program_id = any ($2)', v_link, v_col) using v_sid, v_removed;
                end if;

                foreach v_pid in array v_new loop
                    if not (v_pid = any (v_cur)) then
                        execute format('insert into %I (%I, program_id) values ($1, $2) on conflict do nothing', v_link, v_col) using v_sid, v_pid;
                    end if;
                end loop;

                if v_main is null or not (v_main = any (v_new)) then
                    execute format('update %I set program_id = $1 where id = $2 and program_id is distinct from $1', v_staff) using v_new[1], v_sid;
                end if;

                select coalesce(array_agg(code order by code), '{}') into v_codes from program where id = any (v_new);
                v_changed := v_changed + 1;
                v_results := v_results || (v_one || jsonb_build_object('status', 'changed', 'after', to_jsonb(v_codes), 'reason', null));
            exception when others then
                v_reason := case
                    when sqlstate = '23505' then sqlerrm
                    when sqlstate = '23514' then sqlerrm
                    when sqlstate in ('22023', '23503') then sqlerrm
                    else 'Could not be changed.'
                end;
                v_skipped := v_skipped + 1;
                v_results := v_results || (v_one || jsonb_build_object('status', 'skipped', 'after', v_one -> 'before', 'reason', v_reason));
            end;
        end loop;

        select coalesce(array_agg(code order by code), '{}') into v_codes from program where id = any (v_progs);
        v_out := jsonb_build_object(
            'applied', p_apply, 'role', p_role, 'mode', p_mode, 'programs', to_jsonb(v_codes),
            'changed', v_changed, 'unchanged', v_same, 'skipped', v_skipped, 'results', v_results);

        if p_apply then
            v_table := v_staff;
            if v_changed > 0 then
                insert into audit_log (actor_id, actor_role, action, table_name, record_id, new_values)
                values (auth.uid(), 'system_administrator', 'BULK_SET_STAFF_PROGRAMS', v_table, v_changed::text,
                        jsonb_build_object('role', p_role, 'mode', p_mode, 'programs', to_jsonb(v_codes),
                                           'changed', v_changed, 'unchanged', v_same, 'skipped', v_skipped,
                                           'accounts', (select coalesce(jsonb_agg(r -> 'employee_id'), '[]'::jsonb) from jsonb_array_elements(v_results) r where r ->> 'status' = 'changed')));
            end if;
            return v_out;
        end if;

        -- PREVIEW: undo everything and carry the answer out in a private error
        raise exception using errcode = 'PR001', message = v_out::text;
    exception when sqlstate 'PR001' then
        return sqlerrm::jsonb;
    end;
end;
$$;

revoke all on function public.bulk_set_staff_programs(text, uuid[], text, integer[], boolean) from public, anon;
grant execute on function public.bulk_set_staff_programs(text, uuid[], text, integer[], boolean) to authenticated;
