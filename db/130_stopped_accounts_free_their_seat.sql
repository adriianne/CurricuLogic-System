-- 130_stopped_accounts_free_their_seat.sql
--
-- WHY
--   Stopping a faculty, registrar or Department account only switches it off (is_approved = false): its
--   programme link stays, so that Restore puts the person back where they were. But the caps that limit a
--   programme (10 faculty, 2 registrars, 1 Department account) counted every linked account, stopped or not.
--   So a programme full of stopped accounts stayed "full" and nobody new could be assigned to it.
--   Seen live on 24 Nov 2026: BSBA had 10 faculty linked, all 10 stopped, 0 active, and refused a new one.
--
-- WHAT THIS CHANGES
--   1. The four places that enforce the caps count ACTIVE accounts only:
--        faculty_program_cap, registrar_program_cap, department_program_cap (triggers on the join tables)
--        _provision_account (account creation: the "and is_approved" added to its three counts)
--      A link for an account that is itself stopped never takes a seat.
--   2. Restoring an account is refused when a programme it belongs to is already full of active accounts,
--      so a Restore cannot push a programme past its cap. The message says which programme and what to do.
--      (_assert_seat_free, called from set_account_stopped.)
--   3. The programme link of a stopped account is kept, so Restore still returns the person to the same place.
--
-- NOTHING IS DELETED OR CHANGED IN THE DATA. Only these functions are replaced.
--
-- ROLLBACK: db/130_rollback.sql puts back the functions as they were before this file.

-- ── 1. the caps count active accounts ───────────────────────────────────────

create or replace function public.faculty_program_cap()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
    v_count integer;
    v_code  text;
begin
    -- A stopped account holds no seat, so linking one cannot fill a programme.
    if not exists (select 1 from public.faculty_staff f where f.id = new.faculty_id and f.is_approved is true) then
        return new;
    end if;

    select count(*) into v_count
    from public.faculty_program fp
    join public.faculty_staff f on f.id = fp.faculty_id
    where fp.program_id = new.program_id
      and fp.faculty_id <> new.faculty_id
      and f.is_approved is true;

    if v_count >= 10 then
        select code into v_code from public.program where id = new.program_id;
        raise exception '% already has the maximum of 10 faculty accounts.', coalesce(v_code, 'This programme')
            using errcode = '23505';
    end if;
    return new;
end;
$function$;

create or replace function public.registrar_program_cap()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
    v_count integer;
    v_code  text;
begin
    if not exists (select 1 from public.registrar_staff r where r.id = new.registrar_id and r.is_approved is true) then
        return new;
    end if;

    select count(*) into v_count
    from public.registrar_program rp
    join public.registrar_staff r on r.id = rp.registrar_id
    where rp.program_id = new.program_id
      and rp.registrar_id <> new.registrar_id
      and r.is_approved is true;

    if v_count >= 2 then
        select code into v_code from public.program where id = new.program_id;
        raise exception '% already has the maximum of 2 registrar accounts.', coalesce(v_code, 'This programme')
            using errcode = '23505';
    end if;
    return new;
end;
$function$;

create or replace function public.department_program_cap()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
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

    -- A stopped account holds no seat.
    if not exists (select 1 from public.department_staff d where d.id = new.department_id and d.is_approved is true) then
        return new;
    end if;

    if exists (
        select 1 from public.department_program dp
        join public.department_staff d on d.id = dp.department_id
        where dp.program_id = new.program_id and dp.department_id <> new.department_id and d.is_approved is true
    ) then
        select code into v_code from public.program where id = new.program_id;
        raise exception '% already has its Department account.', coalesce(v_code, 'This programme')
            using errcode = '23505';
    end if;
    return new;
end;
$function$;

-- ── 2. a Restore cannot push a programme past its cap ──────────────────────

create or replace function public._assert_seat_free(p_role text, p_target uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
    r record;
    v_count integer;
begin
    if p_role = 'faculty' then
        for r in select fp.program_id, p.code from public.faculty_program fp join public.program p on p.id = fp.program_id where fp.faculty_id = p_target loop
            select count(*) into v_count from public.faculty_program x join public.faculty_staff f on f.id = x.faculty_id
             where x.program_id = r.program_id and x.faculty_id <> p_target and f.is_approved is true;
            if v_count >= 10 then
                raise exception '% already has 10 active faculty accounts, so this one cannot be restored. Stop another faculty account in % first.', r.code, r.code
                    using errcode = '23505';
            end if;
        end loop;
    elsif p_role = 'registrar' then
        for r in select rp.program_id, p.code from public.registrar_program rp join public.program p on p.id = rp.program_id where rp.registrar_id = p_target loop
            select count(*) into v_count from public.registrar_program x join public.registrar_staff s on s.id = x.registrar_id
             where x.program_id = r.program_id and x.registrar_id <> p_target and s.is_approved is true;
            if v_count >= 2 then
                raise exception '% already has 2 active registrar accounts, so this one cannot be restored. Stop another registrar account in % first.', r.code, r.code
                    using errcode = '23505';
            end if;
        end loop;
    elsif p_role = 'department' then
        for r in select dp.program_id, p.code from public.department_program dp join public.program p on p.id = dp.program_id where dp.department_id = p_target loop
            select count(*) into v_count from public.department_program x join public.department_staff s on s.id = x.department_id
             where x.program_id = r.program_id and x.department_id <> p_target and s.is_approved is true;
            if v_count >= 1 then
                raise exception '% already has an active Department account, so this one cannot be restored. Stop that account first.', r.code
                    using errcode = '23505';
            end if;
        end loop;
    end if;
end;
$function$;

revoke all on function public._assert_seat_free(text, uuid) from public, anon, authenticated;

create or replace function public.set_account_stopped(p_role text, p_target uuid, p_stop boolean, p_reason text default null::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_user     uuid;
  v_approved boolean;
  v_status   text;
  v_last     text;
  v_reason   text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not public.is_system_admin() then
    raise exception 'Only an administrator can stop or restore an account.' using errcode = '42501';
  end if;

  if p_role = 'student' then
    select user_id, is_approved, approval_status into v_user, v_approved, v_status
      from public.university_student where id = p_target for update;
  elsif p_role = 'faculty' then
    select user_id, is_approved into v_user, v_approved from public.faculty_staff where id = p_target for update;
  elsif p_role = 'registrar' then
    select user_id, is_approved into v_user, v_approved from public.registrar_staff where id = p_target for update;
  elsif p_role = 'department' then
    select user_id, is_approved into v_user, v_approved from public.department_staff where id = p_target for update;
  else
    raise exception 'Unknown role: %.', p_role using errcode = '22023';
  end if;

  if not found then
    raise exception 'Account not found.' using errcode = 'P0002';
  end if;

  if v_user is not null and v_user = auth.uid() then
    raise exception 'You cannot stop your own account.' using errcode = '42501';
  end if;

  if p_stop then
    if v_approved is not true then
      raise exception 'This account is not active, so there is nothing to stop.' using errcode = '22023';
    end if;
    if v_reason is null then
      raise exception 'A reason is required to stop an account.' using errcode = '22023';
    end if;
    if char_length(v_reason) > 300 then
      raise exception 'Keep the reason under 300 characters.' using errcode = '22023';
    end if;
  else
    select action into v_last from public.account_stop_log
      where role = p_role and target_id = p_target order by seq desc limit 1;
    if v_last is distinct from 'stop' or v_approved is true then
      raise exception 'This account was not stopped, so there is nothing to restore.' using errcode = '22023';
    end if;
    if p_role = 'student' and v_status is distinct from 'approved' then
      raise exception 'This student is not an approved account, so it cannot be restored.' using errcode = '22023';
    end if;
    -- db/130: a stopped account gave its seat up, so a Restore needs one free.
    if p_role in ('faculty', 'registrar', 'department') then
      perform public._assert_seat_free(p_role, p_target);
    end if;
  end if;

  if p_role = 'student' then
    update public.university_student set is_approved = not p_stop where id = p_target;
  elsif p_role = 'faculty' then
    update public.faculty_staff set is_approved = not p_stop where id = p_target;
  elsif p_role = 'registrar' then
    update public.registrar_staff set is_approved = not p_stop where id = p_target;
  else
    update public.department_staff set is_approved = not p_stop where id = p_target;
  end if;

  insert into public.account_stop_log (role, target_id, user_id, action, reason)
  values (p_role, p_target, v_user, case when p_stop then 'stop' else 'restore' end,
          case when p_stop then v_reason else null end);

  return jsonb_build_object('ok', true, 'action', case when p_stop then 'stop' else 'restore' end);
end;
$function$;

-- ── 3. account creation counts active accounts ──────────────────────────────
-- _provision_account is long; only its three seat counts change, so they are patched in place from the live
-- definition (and the patch is checked, so a change that did not take stops the migration).

do $mig$
declare
    d text;
begin
    d := pg_get_functiondef('public._provision_account'::regproc);
    d := replace(d, 'from faculty_staff where program_id = v_program;',    'from faculty_staff where program_id = v_program and is_approved is true;');
    d := replace(d, 'from registrar_staff where program_id = v_program;',  'from registrar_staff where program_id = v_program and is_approved is true;');
    d := replace(d, 'from department_staff where program_id = v_program;', 'from department_staff where program_id = v_program and is_approved is true;');
    if d not like '%from faculty_staff where program_id = v_program and is_approved is true;%'
       or d not like '%from registrar_staff where program_id = v_program and is_approved is true;%'
       or d not like '%from department_staff where program_id = v_program and is_approved is true;%' then
        raise exception 'db/130: the seat counts in _provision_account were not found, nothing was changed.';
    end if;
    execute d;
end
$mig$;
