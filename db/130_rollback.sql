-- 130_rollback.sql
--
-- Puts back the functions exactly as they were before db/130_stopped_accounts_free_their_seat.sql
-- (24 Nov 2026): the caps count every linked account, stopped or not, and Restore has no seat check.
-- Run it only if db/130 has to be undone. Data is not touched.

create or replace function public.faculty_program_cap()
returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare
    v_count integer;
    v_code  text;
begin
    select count(*) into v_count
    from public.faculty_program
    where program_id = new.program_id and faculty_id <> new.faculty_id;

    if v_count >= 10 then
        select code into v_code from public.program where id = new.program_id;
        raise exception '% already has the maximum of 10 faculty accounts.', coalesce(v_code, 'This programme')
            using errcode = '23505';
    end if;
    return new;
end;
$function$;

create or replace function public.registrar_program_cap()
returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare
    v_count integer;
    v_code  text;
begin
    select count(*) into v_count
    from public.registrar_program
    where program_id = new.program_id and registrar_id <> new.registrar_id;

    if v_count >= 2 then
        select code into v_code from public.program where id = new.program_id;
        raise exception '% already has the maximum of 2 registrar accounts.', coalesce(v_code, 'This programme')
            using errcode = '23505';
    end if;
    return new;
end;
$function$;

create or replace function public.department_program_cap()
returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare
    v_code text;
begin
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
$function$;

-- set_account_stopped: take the "db/130" block out of the restore branch, i.e. the three lines
--     if p_role in ('faculty', 'registrar', 'department') then perform public._assert_seat_free(p_role, p_target); end if;
-- (re-create the function from db/130 without them), then:
drop function if exists public._assert_seat_free(text, uuid);

-- _provision_account: remove " and is_approved is true" from its three seat counts
-- (faculty_staff, registrar_staff, department_staff "where program_id = v_program").
do $mig$
declare d text;
begin
    d := pg_get_functiondef('public._provision_account'::regproc);
    d := replace(d, ' where program_id = v_program and is_approved is true;', ' where program_id = v_program;');
    execute d;
end
$mig$;
