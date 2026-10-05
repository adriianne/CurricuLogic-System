-- 049: the password rule, enforced by the database for accounts an
-- administrator creates (security item 4).
-- DRAFT: review, then run once in the Supabase SQL editor.
--
-- Rule (same as shared/js/passwordrules.js): at least 8 characters and at
-- least one special character (not a letter, digit or space); an ADMIN account
-- needs at least 12; at most 72.
--
-- Only the admin's Create account form and bulk upload go through this. A
-- student's own sign-up and password change go straight to Supabase Auth and
-- are checked in the browser only.
--
-- This is the db/047 version of _provision_account with ONE change: the old
-- "length < 8" check is replaced by a call to _password_problem() (marked
-- "db/049"). Existing accounts keep the passwords they have.

-- Returns null when the password is acceptable, otherwise the sentence to show.
create or replace function public._password_problem(p_password text, p_role text)
returns text
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select case
    when length(coalesce(p_password, '')) < (case when lower(trim(coalesce(p_role, ''))) = 'admin' then 12 else 8 end)
      then 'Password must be at least ' || (case when lower(trim(coalesce(p_role, ''))) = 'admin' then 12 else 8 end) || ' characters.'
    when length(p_password) > 72
      then 'Password must be at most 72 characters.'
    when p_password !~ '[^[:alnum:][:space:]]'
      then 'Password must include a special character, such as ! @ # $ or %.'
    else null
  end;
$$;

revoke all on function public._password_problem(text, text) from public, anon, authenticated;

create or replace function public._provision_account(p_first_name text, p_last_name text, p_email text, p_password text, p_role text, p_employee_id text DEFAULT NULL::text, p_student_id text DEFAULT NULL::text, p_department text DEFAULT 'College of Computer Studies'::text, p_year_level text DEFAULT NULL::text, p_username text DEFAULT NULL::text, p_via text DEFAULT 'ADMIN_MANUAL'::text, p_program_code text DEFAULT 'BSIT'::text, p_declared_path text DEFAULT 'existing'::text)
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
    v_pw_problem text;
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

    -- db/049: replaces the old "length < 8" check.
    v_pw_problem := public._password_problem(p_password, v_role);
    if v_pw_problem is not null then
        raise exception '%', v_pw_problem using errcode = '22023';
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

        -- db/047: one creator at a time per role + programme, so the count
        -- below cannot be stale by the time the row is inserted.
        if v_role in ('faculty', 'registrar', 'department') then
            perform pg_advisory_xact_lock(hashtext('provision:' || v_role || ':' || v_program::text));
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

-- Privileges: signed-out callers have no use for this function (the body also
-- requires is_system_admin()), so remove anon/public and keep authenticated.
-- This may TIGHTEN what was there before (security item 12).
revoke all on function public._provision_account(text,text,text,text,text,text,text,text,text,text,text,text,text) from public, anon;
grant execute on function public._provision_account(text,text,text,text,text,text,text,text,text,text,text,text,text) to authenticated;
