-- 115_staff_employee_id_typed.sql
--
-- DRAFT, NOT APPLIED. Needs the user's explicit yes before it runs on the live project.
--
-- Staff (faculty, registrar, department) may now come with their OFFICIAL employee ID, typed by the
-- Administrator in the form or the bulk file, the same way an EDP student ID is typed. A blank still gets
-- the next number from the counter (db/044), so test accounts and new hires without an ID still work.
--
-- The accepted shape is deliberately loose, because the university's real format is not known yet:
--   EMP- followed by 3 to 12 letters or digits, with single hyphens allowed between groups.
--   EMP-00871     ok (every existing ID)
--   EMP-2019-0123 ok
--   EMP-12        refused (too short)     EMP--123  refused (double hyphen)    EMP-12_3  refused
-- When the real format is known, only the regex below (and its copies, listed at the end) change.
--
-- Uniqueness is checked with the hyphens removed, because that is how the sign-in lookup compares IDs:
-- EMP-12-345 and EMP-123-45 would be the same sign-in, so they count as the same ID.
--
-- What this changes:
--   1. next_staff_employee_id(): skips a counter number that matches a held ID once hyphens are ignored.
--   2. staff_employee_id_guard(): accepts the looser shape; the hyphen-less uniqueness check.
--   3. the three format CHECK constraints: replaced with the looser shape.
--   4. _provision_account(): a typed staff ID is checked and used instead of being refused (db/044 / 049).
--      Admin accounts are unchanged: SYS-... typed, as before.
--   5. resolve_login_identifier(): a staff ID with inner hyphens is recognised at sign-in.
--
-- Nothing is renumbered. Existing accounts keep their IDs and keep signing in.
--
-- THE SAME SHAPE LIVES IN FOUR OTHER PLACES, change them together if it is ever tightened:
--   supabase/functions/sign-in/index.ts (STAFF_ID, needs a redeploy)
--   shared/js/accounts/auth.js          (STAFF_SHAPE)
--   features/admin/admindashboard.js    (STAFF_EMPLOYEE_ID)
--   this file                           (guard, constraints, _provision_account, resolve_login_identifier)
--
-- TO UNDO: re-create the db/044 guard + constraints (^EMP-[0-9]{5}$), the db/049 _provision_account and the
-- db/090 resolve_login_identifier. Any staff account created with a typed ID would then fail the old check,
-- so list them first (select employee_id from the three staff tables where employee_id !~ '^EMP-[0-9]{5}$').

-- ---------------------------------------------------------------------
-- 1. The counter skips a held number, hyphens ignored
-- ---------------------------------------------------------------------
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
        exit when not exists (select 1 from faculty_staff    where replace(employee_id, '-', '') = replace(v_id, '-', ''))
              and not exists (select 1 from registrar_staff  where replace(employee_id, '-', '') = replace(v_id, '-', ''))
              and not exists (select 1 from department_staff where replace(employee_id, '-', '') = replace(v_id, '-', ''));
    end loop;
    return v_id;
end;
$function$;

revoke execute on function public.next_staff_employee_id() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. The guard
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

    if new.employee_id !~ '^EMP-(?=[A-Z0-9-]{3,12}$)[A-Z0-9]+(-[A-Z0-9]+)*$' then
        raise exception 'Employee ID must be EMP- followed by 3 to 12 letters or digits, with single hyphens between groups (got %).', new.employee_id
            using errcode = '22023';
    end if;

    if tg_op = 'INSERT' or new.employee_id is distinct from old.employee_id then
        if exists (select 1 from faculty_staff    where replace(employee_id, '-', '') = replace(new.employee_id, '-', '') and id is distinct from new.id)
        or exists (select 1 from registrar_staff  where replace(employee_id, '-', '') = replace(new.employee_id, '-', '') and id is distinct from new.id)
        or exists (select 1 from department_staff where replace(employee_id, '-', '') = replace(new.employee_id, '-', '') and id is distinct from new.id) then
            raise exception 'Employee ID % is already in use.', new.employee_id
                using errcode = '23505';
        end if;
    end if;

    return new;
end;
$function$;

revoke execute on function public.staff_employee_id_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. The format constraints
-- ---------------------------------------------------------------------
alter table public.faculty_staff    drop constraint if exists faculty_staff_employee_id_format;
alter table public.registrar_staff  drop constraint if exists registrar_staff_employee_id_format;
alter table public.department_staff drop constraint if exists department_staff_employee_id_format;

alter table public.faculty_staff
    add constraint faculty_staff_employee_id_format
    check (employee_id ~ '^EMP-(?=[A-Z0-9-]{3,12}$)[A-Z0-9]+(-[A-Z0-9]+)*$');
alter table public.registrar_staff
    add constraint registrar_staff_employee_id_format
    check (employee_id ~ '^EMP-(?=[A-Z0-9-]{3,12}$)[A-Z0-9]+(-[A-Z0-9]+)*$');
alter table public.department_staff
    add constraint department_staff_employee_id_format
    check (employee_id ~ '^EMP-(?=[A-Z0-9-]{3,12}$)[A-Z0-9]+(-[A-Z0-9]+)*$');

-- ---------------------------------------------------------------------
-- 4. _provision_account: a typed staff ID is used, not refused
--    (the live version, with only the employee-ID handling changed: v_emp_in)
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
    v_emp_in     text;
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
            -- (YY + 6-digit counter) and the account is created as a new
            -- student. Nobody types it.
            v_sid  := public.next_student_id();
            v_path := 'new';
        else
            if v_sid !~ '^\d{8}$' then
                raise exception 'Student ID must be 8 digits (got %).', p_student_id
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
            -- Faculty, registrar and department: the official ID may be typed (db/115). The guard trigger
            -- checks it again and refuses one that is already in use.
            v_emp_in := upper(trim(p_employee_id));
            if v_emp_in !~ '^EMP-(?=[A-Z0-9-]{3,12}$)[A-Z0-9]+(-[A-Z0-9]+)*$' then
                raise exception 'Employee ID must be EMP- followed by 3 to 12 letters or digits, with single hyphens between groups (got %). Leave it blank to have one assigned.', p_employee_id
                    using errcode = '22023';
            end if;
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
        -- employee_id is the typed official ID, or null: the trigger then assigns the next EMP- number.
        insert into faculty_staff (
            user_id, employee_id, first_name, last_name, email, department, program_id,
            is_approved, created_by, created_via, must_change_password
        ) values (
            v_uid, v_emp_in, p_first_name, p_last_name, v_email, p_department, v_program,
            true, v_caller, p_via, true
        )
        returning id, employee_id into v_actor_id, v_emp;

    elsif v_role = 'registrar' then
        insert into registrar_staff (
            user_id, employee_id, first_name, last_name, email, department, program_id,
            is_approved, created_by, created_via, must_change_password
        ) values (
            v_uid, v_emp_in, p_first_name, p_last_name, v_email, p_department, v_program,
            true, v_caller, p_via, true
        )
        returning id, employee_id into v_actor_id, v_emp;

    elsif v_role = 'department' then
        insert into department_staff (
            user_id, employee_id, first_name, last_name, email, department, program_id,
            is_approved, created_by, created_via, must_change_password
        ) values (
            v_uid, v_emp_in, p_first_name, p_last_name, v_email, p_department, v_program,
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

-- ---------------------------------------------------------------------
-- 5. Sign-in lookup: a staff ID with inner hyphens (EMP-2019-0123) is recognised
-- ---------------------------------------------------------------------
create or replace function public.resolve_login_identifier(identifier text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
    cleaned text;
    digits  text;
    found   text;
begin
    if identifier is null or btrim(identifier) = '' then
        return null;
    end if;

    -- already an email
    if position('@' in identifier) > 0 then
        return btrim(identifier);
    end if;

    cleaned := upper(regexp_replace(btrim(identifier), '\s', '', 'g'));

    -- uc-24001187 only. The hyphen is required: UC24001187 without it is
    -- one keystroke away from a bare ID, and accepting both reintroduces
    -- the ambiguity the prefix exists to remove.
    if cleaned ~ '^UC-[0-9]+$' then
        digits := regexp_replace(cleaned, '^UC-', '');
        digits := lpad(digits, 8, '0');

        select email into found
        from university_student
        where student_id = digits
        limit 1;

        return found;
    end if;

    -- EMP-00871 or EMP-2019-0123, across the three staff tables. Administrators are NOT
    -- reachable by ID: the admin signs in by email only.
    if cleaned ~ '^EMP-[A-Z0-9-]+$' then
        select email into found from faculty_staff
        where upper(replace(employee_id, '-', '')) = replace(cleaned, '-', '') limit 1;
        if found is not null then return found; end if;

        select email into found from registrar_staff
        where upper(replace(employee_id, '-', '')) = replace(cleaned, '-', '') limit 1;
        if found is not null then return found; end if;

        select email into found from department_staff
        where upper(replace(employee_id, '-', '')) = replace(cleaned, '-', '') limit 1;
        return found;
    end if;

    -- Not a recognised shape. Returning null rather than guessing keeps a
    -- bare 8-digit number from being treated as a student ID.
    return null;
end;
$function$;

revoke execute on function public.resolve_login_identifier(text) from public, anon, authenticated;
grant  execute on function public.resolve_login_identifier(text) to service_role;
