-- 045_student_id_generation.sql
--
-- Student ID generation (item 11 of the security list, 2026-10-03).
--
-- Decided with the user:
--   * UC does not issue student numbers yet, so the system issues them.
--   * A student ID is 7 digits: the 2-digit year, then a 5-digit counter that
--     restarts every year (2600001, 2600002, ... in 2026).
--   * The year is the CALENDAR year on the database clock (Asia/Manila), never
--     something a person types.
--   * The counter is ONE for the whole university, shared by every programme and
--     every Registrar, so two programmes can never receive the same number.
--   * It is fully automatic: the Registrar just approves a new student.
--
-- What this does:
--   1. student_id_counter + next_student_id(): an atomic per-year counter that
--      also skips a number that is somehow already taken;
--   2. a trigger on INSERT: a self-registered NEW student cannot bring their own
--      student ID (they previously could type one, and could claim a number that
--      was not theirs);
--   3. a trigger on UPDATE: when a NEW student is approved, the database assigns
--      the next number, and ignores any ID sent by the client. An existing
--      number on the row is kept.
--   4. _provision_account (the admin form and the bulk upload): a student row
--      with a BLANK student ID is now accepted and the system issues the number
--      (the account is created as a new student). A typed ID is still checked.
--   Students who register with "I already have a record at UC" are unchanged:
--   they enter their ID and the Registrar checks it against the official list.
--
-- ORDER OF ROLLOUT: publish the new registrardashboard.js and register.js first
-- (the old Registrar page still shows a typed ID box, which this migration
-- silently ignores for new students), then run THIS file.
--
-- TO CHECK AFTERWARDS: register a test "new student" (leave no ID), approve it as
-- the programme's Registrar, and see the 7-digit ID appear; approve a second one
-- as another programme's Registrar and see the next number.
-- TO UNDO: drop the two triggers and the two functions; IDs already assigned stay.

-- ---------------------------------------------------------------------
-- 1. The counter
-- ---------------------------------------------------------------------
create table if not exists public.student_id_counter (
    year integer primary key,
    last integer not null default 0
);

-- Nobody reads or writes this table directly; only next_student_id() does.
alter table public.student_id_counter enable row level security;
revoke all on public.student_id_counter from public, anon, authenticated;

create or replace function public.next_student_id()
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
    v_year integer := extract(year from (now() at time zone 'Asia/Manila'))::integer;
    v_yy   text    := lpad((v_year % 100)::text, 2, '0');
    v_n    integer;
    v_id   text;
begin
    loop
        -- atomic: concurrent callers queue on the row lock, none gets the same n
        insert into student_id_counter (year, last) values (v_year, 1)
        on conflict (year) do update set last = student_id_counter.last + 1
        returning last into v_n;

        if v_n > 99999 then
            raise exception 'No more student IDs are available for %.', v_year
                using errcode = '53400';
        end if;

        v_id := v_yy || lpad(v_n::text, 5, '0');

        -- skip a number somebody already holds (an admin-typed or imported ID)
        exit when not exists (select 1 from university_student where student_id = v_id);
    end loop;

    return v_id;
end;
$function$;

revoke execute on function public.next_student_id() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. A self-registered NEW student cannot bring an ID
--    (is_approved = false is how self-registration is recognised; the admin's
--    provisioning inserts approved accounts and is not touched)
-- ---------------------------------------------------------------------
create or replace function public.student_id_on_register()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
    if new.is_approved is not true and new.declared_path = 'new' then
        new.student_id := null;
    end if;
    return new;
end;
$function$;

revoke execute on function public.student_id_on_register() from public, anon, authenticated;

drop trigger if exists student_id_on_register on public.university_student;
create trigger student_id_on_register
    before insert on public.university_student
    for each row execute function public.student_id_on_register();

-- ---------------------------------------------------------------------
-- 3. Approval assigns the number
-- ---------------------------------------------------------------------
create or replace function public.student_id_on_approve()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
    if new.declared_path = 'new'
       and new.approval_status = 'approved'
       and old.approval_status is distinct from 'approved' then

        -- Keep a number the row already has; otherwise issue the next one.
        -- Whatever the client sent is ignored.
        new.student_id := coalesce(old.student_id, public.next_student_id());
    end if;
    return new;
end;
$function$;

revoke execute on function public.student_id_on_approve() from public, anon, authenticated;

drop trigger if exists student_id_on_approve on public.university_student;
create trigger student_id_on_approve
    before update on public.university_student
    for each row execute function public.student_id_on_approve();


-- ---------------------------------------------------------------------
-- 4. Admin-created students: a BLANK student ID is generated (option B)
--
-- The admin form and the bulk upload used to refuse a student without an ID.
-- When the school's list has no IDs (UC does not issue them yet), the admin
-- leaves the cell blank and the system issues the number, from the same
-- counter as the Registrar's approval. A typed ID is still checked (7 digits,
-- unique). A student created without an ID is a NEW student (declared_path
-- 'new'), so the account is marked verified like any new student. The result
-- of this function returns the ID so the admin can see it.
-- (This is _provision_account from db/044 with only the student-ID branch
-- changed.)
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

        if v_sid = '' then
            -- No ID given: the student is new to UC, so the system issues one
            -- (YY + 5-digit counter) and the account is created as a new
            -- student. Nobody types it.
            v_sid  := public.next_student_id();
            v_path := 'new';
        else
            if v_sid !~ '^\d{7}$' then
                raise exception 'Student ID must be 7 digits (got %).', p_student_id
                    using errcode = '22023';
            end if;

            if exists (select 1 from university_student where student_id = v_sid) then
                raise exception 'A student already exists with ID %', v_sid
                    using errcode = '23505';
            end if;
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
