-- 044_staff_employee_ids.sql
--
-- Staff employee IDs (item 8 of the security list, 2026-10-03).
--
-- Decided with the user:
--   * Faculty, registrar and department staff share ONE format and ONE counter:
--     EMP- followed by exactly 5 digits, starting at EMP-00001.
--   * The database assigns the number when the account is created. Nobody types
--     it, so there are no typos and no duplicates.
--   * The system administrator is the exception and keeps a typed ID that starts
--     with SYS- (the existing one is SYS-ADMIN01).
--
-- What this does:
--   1. creates the counter (staff_employee_seq) and next_staff_employee_id();
--   2. RENUMBERS the 14 existing staff accounts from EMP-00001, oldest first
--      (every link in the database points at the row id, not the employee
--      number, so nothing else changes; but THE PEOPLE'S SIGN-IN IDs CHANGE);
--   3. adds a trigger on faculty_staff, registrar_staff and department_staff that
--      fills in a blank ID, forces the format, and refuses an ID already used by
--      any other staff table (this is what makes the ID unique across roles);
--   4. adds CHECK constraints for the format;
--   5. re-creates _provision_account so staff IDs are generated (a typed one is
--      refused), and so it returns and audits the ID it generated.
--
-- RUN THIS FILE ONCE. Running it again would renumber everyone a second time.
--
-- ORDER OF ROLLOUT: deploy the new admindashboard.js first or at the same time;
-- the old form still asks for a typed employee ID, which this migration refuses
-- for faculty, registrar and department accounts.
--
-- TO CHECK AFTERWARDS: select employee_id, email from each staff table; create a
-- faculty account with the employee ID blank and see EMP-00015; try to insert a
-- bad ID and see it refused.
-- TO UNDO: drop the three triggers and constraints, restore _provision_account
-- from db/030, and put the old IDs back by hand (they are listed in the
-- security notes, not stored by this file).

-- ---------------------------------------------------------------------
-- 1. The counter
-- ---------------------------------------------------------------------
create sequence if not exists public.staff_employee_seq
    as integer minvalue 1 maxvalue 99999 start 1 no cycle;

create or replace function public.next_staff_employee_id()
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
    v_id text;
begin
    loop
        v_id := 'EMP-' || lpad(nextval('public.staff_employee_seq')::text, 5, '0');
        -- skip a number somebody already holds (an old or hand-typed row)
        exit when not exists (select 1 from faculty_staff    where employee_id = v_id)
              and not exists (select 1 from registrar_staff  where employee_id = v_id)
              and not exists (select 1 from department_staff where employee_id = v_id);
    end loop;
    return v_id;
end;
$function$;

revoke execute on function public.next_staff_employee_id() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Renumber the existing staff from EMP-00001, oldest account first
-- ---------------------------------------------------------------------
with all_staff as (
    select 'f' as t, id, created_at from public.faculty_staff
    union all select 'r', id, created_at from public.registrar_staff
    union all select 'd', id, created_at from public.department_staff
), numbered as (
    select t, id, row_number() over (order by created_at, id) as n from all_staff
)
update public.faculty_staff s
   set employee_id = 'EMP-' || lpad(numbered.n::text, 5, '0')
  from numbered where numbered.t = 'f' and numbered.id = s.id;

with all_staff as (
    select 'f' as t, id, created_at from public.faculty_staff
    union all select 'r', id, created_at from public.registrar_staff
    union all select 'd', id, created_at from public.department_staff
), numbered as (
    select t, id, row_number() over (order by created_at, id) as n from all_staff
)
update public.registrar_staff s
   set employee_id = 'EMP-' || lpad(numbered.n::text, 5, '0')
  from numbered where numbered.t = 'r' and numbered.id = s.id;

with all_staff as (
    select 't' as t, id, created_at from public.department_staff
    union all select 'f', id, created_at from public.faculty_staff
    union all select 'r', id, created_at from public.registrar_staff
), numbered as (
    select t, id, row_number() over (order by created_at, id) as n from all_staff
)
update public.department_staff s
   set employee_id = 'EMP-' || lpad(numbered.n::text, 5, '0')
  from numbered where numbered.t = 't' and numbered.id = s.id;

-- The next new account continues after the highest number in use.
select setval('public.staff_employee_seq',
              greatest(1, (select count(*) from (
                  select 1 from public.faculty_staff
                  union all select 1 from public.registrar_staff
                  union all select 1 from public.department_staff) x)));

-- ---------------------------------------------------------------------
-- 3. The guard trigger (fill in, check format, unique across all three tables)
-- ---------------------------------------------------------------------
create or replace function public.staff_employee_id_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
    if tg_op = 'INSERT' and (new.employee_id is null or btrim(new.employee_id) = '') then
        new.employee_id := public.next_staff_employee_id();
    end if;

    new.employee_id := upper(btrim(new.employee_id));

    if new.employee_id !~ '^EMP-[0-9]{5}$' then
        raise exception 'Employee ID must be EMP- followed by 5 digits (got %).', new.employee_id
            using errcode = '22023';
    end if;

    if tg_op = 'INSERT' or new.employee_id is distinct from old.employee_id then
        if exists (select 1 from faculty_staff    where employee_id = new.employee_id and id is distinct from new.id)
        or exists (select 1 from registrar_staff  where employee_id = new.employee_id and id is distinct from new.id)
        or exists (select 1 from department_staff where employee_id = new.employee_id and id is distinct from new.id) then
            raise exception 'Employee ID % is already in use.', new.employee_id
                using errcode = '23505';
        end if;
    end if;

    return new;
end;
$function$;

revoke execute on function public.staff_employee_id_guard() from public, anon, authenticated;

drop trigger if exists staff_employee_id_guard on public.faculty_staff;
create trigger staff_employee_id_guard
    before insert or update of employee_id on public.faculty_staff
    for each row execute function public.staff_employee_id_guard();

drop trigger if exists staff_employee_id_guard on public.registrar_staff;
create trigger staff_employee_id_guard
    before insert or update of employee_id on public.registrar_staff
    for each row execute function public.staff_employee_id_guard();

drop trigger if exists staff_employee_id_guard on public.department_staff;
create trigger staff_employee_id_guard
    before insert or update of employee_id on public.department_staff
    for each row execute function public.staff_employee_id_guard();

-- ---------------------------------------------------------------------
-- 4. Format constraints (the existing rows now all fit)
-- ---------------------------------------------------------------------
alter table public.faculty_staff
    add constraint faculty_staff_employee_id_format    check (employee_id ~ '^EMP-[0-9]{5}$');
alter table public.registrar_staff
    add constraint registrar_staff_employee_id_format  check (employee_id ~ '^EMP-[0-9]{5}$');
alter table public.department_staff
    add constraint department_staff_employee_id_format check (employee_id ~ '^EMP-[0-9]{5}$');
alter table public.system_administrator
    add constraint system_administrator_employee_id_format check (employee_id ~ '^SYS-[A-Z0-9]{3,12}$');

-- ---------------------------------------------------------------------
-- 5. _provision_account: generate staff IDs, return and audit them
--    (db/030 version, with only the employee-ID handling changed)
-- ---------------------------------------------------------------------
create or replace function public._provision_account(
    p_first_name text, p_last_name text, p_email text, p_password text, p_role text,
    p_employee_id text default null::text, p_student_id text default null::text,
    p_department text default 'College of Computer Studies'::text, p_year_level text default null::text,
    p_username text default null::text, p_via text default 'ADMIN_MANUAL'::text,
    p_program_code text default 'BSIT'::text, p_declared_path text default 'existing'::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'auth', 'extensions'
as $function$
declare
    v_caller     uuid := auth.uid();
    v_uid        uuid := gen_random_uuid();
    v_actor_id   uuid;
    v_role       text := lower(trim(p_role));
    v_email      text := lower(trim(p_email));
    v_sid        text;
    v_emp        text;
    v_year       integer;
    v_program    integer;
    v_prospectus integer;
    v_prog_code  text := upper(trim(coalesce(p_program_code, 'BSIT')));
    v_path       text := lower(trim(coalesce(p_declared_path, 'existing')));
    v_verified   boolean;
    v_limit      integer;
    v_count      integer;
begin
    if not is_system_admin() then
        raise exception 'Not authorised to provision accounts.'
            using errcode = '42501';
    end if;

    if coalesce(trim(p_first_name), '') = '' then
        raise exception 'First name is required.' using errcode = '22023';
    end if;

    if coalesce(trim(p_last_name), '') = '' then
        raise exception 'Last name is required.' using errcode = '22023';
    end if;

    if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
        raise exception 'Enter a valid email address.' using errcode = '22023';
    end if;

    if length(coalesce(p_password, '')) < 8 then
        raise exception 'Password must be at least 8 characters.' using errcode = '22023';
    end if;

    if v_role not in ('student', 'faculty', 'registrar', 'department', 'admin') then
        raise exception 'Unknown role: %', p_role using errcode = '22023';
    end if;

    if v_path not in ('new', 'existing') then
        raise exception 'declared_path must be new or existing (got %).', p_declared_path
            using errcode = '22023';
    end if;

    if exists (select 1 from auth.users where lower(email) = v_email) then
        raise exception 'An account already exists for %', v_email
            using errcode = '23505';
    end if;

    if v_role in ('student', 'faculty', 'registrar', 'department') then
        select id into v_program from program where code = v_prog_code;
        if v_program is null then
            raise exception 'No programme row found for %.', v_prog_code
                using errcode = '23503';
        end if;
    end if;

    if v_role = 'student' then
        v_sid := regexp_replace(coalesce(p_student_id, ''), '^uc-', '', 'i');
        v_sid := trim(v_sid);

        if v_sid !~ '^\d{7}$' then
            raise exception 'Student ID must be 7 digits (got %).', p_student_id
                using errcode = '22023';
        end if;

        if exists (select 1 from university_student where student_id = v_sid) then
            raise exception 'A student already exists with ID %', v_sid
                using errcode = '23505';
        end if;

        v_year := nullif(trim(coalesce(p_year_level, '')), '')::integer;
        if v_year is not null and v_year not between 1 and 4 then
            raise exception 'Year level must be 1 to 4 (got %).', p_year_level
                using errcode = '22023';
        end if;

        select id into v_prospectus
        from prospectus
        where program_id = v_program and is_active = true
        limit 1;

        v_verified := (v_path = 'new');

    else
        if v_role = 'admin' then
            -- Administrators keep a typed ID (SYS-...) and a username.
            if coalesce(trim(p_employee_id), '') = '' then
                raise exception 'An employee ID (SYS-...) is required for administrator accounts.'
                    using errcode = '22023';
            end if;

            if coalesce(trim(p_username), '') = '' then
                raise exception 'A username is required for administrator accounts.'
                    using errcode = '22023';
            end if;
        elsif coalesce(trim(p_employee_id), '') <> '' then
            -- Faculty, registrar and department IDs are generated, never typed.
            raise exception 'Employee IDs for faculty, registrar and department staff are assigned automatically. Leave it blank.'
                using errcode = '22023';
        end if;

        if v_role = 'faculty' then
            v_limit := 10;
            select count(*) into v_count from faculty_staff where program_id = v_program;
        elsif v_role = 'registrar' then
            v_limit := 2;
            select count(*) into v_count from registrar_staff where program_id = v_program;
        elsif v_role = 'department' then
            v_limit := 1;
            select count(*) into v_count from department_staff where program_id = v_program;
        end if;

        if v_limit is not null and v_count >= v_limit then
            raise exception '% already has the maximum of % % account%.',
                v_prog_code, v_limit, v_role, case when v_limit = 1 then '' else 's' end
                using errcode = '23505';
        end if;
    end if;

    insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
        created_at, updated_at,
        confirmation_token, recovery_token, email_change, email_change_token_new
    ) values (
        '00000000-0000-0000-0000-000000000000',
        v_uid, 'authenticated', 'authenticated', v_email,
        extensions.crypt(p_password, extensions.gen_salt('bf')),
        now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object('first_name', p_first_name, 'last_name', p_last_name),
        now(), now(),
        '', '', '', ''
    );

    insert into auth.identities (
        id, user_id, provider_id, identity_data, provider,
        last_sign_in_at, created_at, updated_at
    ) values (
        gen_random_uuid(), v_uid, v_uid::text,
        jsonb_build_object('sub', v_uid::text, 'email', v_email),
        'email', now(), now(), now()
    );

    if v_role = 'student' then
        insert into university_student (
            user_id, student_id, first_name, last_name, email,
            program_id, year_level, is_approved, approval_status,
            record_verified, verified_by, verified_at,
            reviewed_by, reviewed_at,
            created_by, created_via, must_change_password,
            prospectus_id, declared_path
        ) values (
            v_uid, v_sid, p_first_name, p_last_name, v_email,
            v_program, v_year, true, 'approved',
            v_verified,
            case when v_verified then v_caller else null end,
            case when v_verified then now()    else null end,
            v_caller, now(),
            v_caller, p_via, true,
            v_prospectus, v_path
        )
        returning id into v_actor_id;

    elsif v_role = 'faculty' then
        -- employee_id is left null: the trigger assigns the next EMP- number.
        insert into faculty_staff (
            user_id, employee_id, first_name, last_name, email, department, program_id,
            is_approved, created_by, created_via, must_change_password
        ) values (
            v_uid, null, p_first_name, p_last_name, v_email, p_department, v_program,
            true, v_caller, p_via, true
        )
        returning id, employee_id into v_actor_id, v_emp;

    elsif v_role = 'registrar' then
        insert into registrar_staff (
            user_id, employee_id, first_name, last_name, email, department, program_id,
            is_approved, created_by, created_via, must_change_password
        ) values (
            v_uid, null, p_first_name, p_last_name, v_email, p_department, v_program,
            true, v_caller, p_via, true
        )
        returning id, employee_id into v_actor_id, v_emp;

    elsif v_role = 'department' then
        insert into department_staff (
            user_id, employee_id, first_name, last_name, email, department, program_id,
            is_approved, created_by, created_via, must_change_password
        ) values (
            v_uid, null, p_first_name, p_last_name, v_email, p_department, v_program,
            true, v_caller, p_via, true
        )
        returning id, employee_id into v_actor_id, v_emp;

    else
        v_emp := upper(trim(p_employee_id));
        insert into system_administrator (
            user_id, employee_id, first_name, last_name, email, username,
            is_approved, created_by, created_via, must_change_password
        ) values (
            v_uid, v_emp, p_first_name, p_last_name, v_email, trim(p_username),
            true, v_caller, p_via, true
        )
        returning id into v_actor_id;
    end if;

    insert into audit_log (
        actor_id, actor_role, action, table_name, record_id, new_values
    ) values (
        v_caller, 'system_administrator', 'PROVISION_ACCOUNT',
        case v_role
            when 'student'    then 'university_student'
            when 'faculty'    then 'faculty_staff'
            when 'registrar'  then 'registrar_staff'
            when 'department' then 'department_staff'
            else 'system_administrator'
        end,
        v_actor_id::text,
        jsonb_build_object(
            'user_id', v_uid, 'email', v_email, 'role', v_role,
            'student_id', v_sid, 'employee_id', v_emp,
            'program_code', v_prog_code, 'declared_path', v_path,
            'record_verified', v_verified, 'via', p_via
        )
    );

    return jsonb_build_object(
        'user_id',     v_uid,
        'actor_id',    v_actor_id,
        'email',       v_email,
        'role',        v_role,
        'employee_id', v_emp,
        'student_id',  v_sid
    );
end;
$function$;
