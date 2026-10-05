-- 030_role_program_limits.sql
--
-- STATUS: APPLIED to the live database (verified 2026-09-30).
--
-- WHY
--   Every role except student had no real link to a programme. Faculty
--   were linked through a many-to-many join table (faculty_program),
--   auto-populated by two triggers that matched free-text
--   faculty_staff.department against free-text program.college --
--   fragile, and it let one faculty member cover multiple programmes
--   with no visible cap. Registrar and department staff had no
--   programme link at all, just the same free-text department field.
--   None of the three had any limit on how many accounts a programme
--   could have.
--
--   This was confirmed against live data before writing this migration:
--   every faculty_program row today is a 1:1 link (no faculty member
--   has more than one), so collapsing to a single column loses nothing
--   that exists right now.
--
-- WHAT THIS CHANGES
--   1. Adds program_id to faculty_staff, registrar_staff and
--      department_staff -- one programme per account, chosen at
--      creation, the same shape university_student already has.
--   2. Backfills faculty_staff.program_id from the existing
--      faculty_program rows.
--   3. Retires the two auto-link triggers and their functions
--      (link_faculty_to_college_programs, link_college_faculty_to_program)
--      and drops faculty_program -- assignment is now an explicit choice
--      at account creation, not a text-matching side effect.
--   4. Rewrites is_adviser_of_student to compare program_id directly.
--      Its signature and callers (the "faculty read advisee requests"
--      policy on request) are unchanged -- only its internal query is.
--   5. Rewrites _provision_account to require a programme for faculty,
--      registrar and department (students already required one;
--      admin stays programme-less, same as before), and to enforce a
--      cap per programme before inserting: faculty 10, registrar 2,
--      department 1. Students remain uncapped.
--
-- HOW TO UNDO: see the ROLLBACK block at the bottom. It restores the
-- join table and triggers but cannot restore data for any account
-- created after this migration runs with a role this migration added
-- program_id for.

-- ── 1. New columns ──────────────────────────────────────────────────

alter table public.faculty_staff    add column if not exists program_id integer references public.program(id);
alter table public.registrar_staff  add column if not exists program_id integer references public.program(id);
alter table public.department_staff add column if not exists program_id integer references public.program(id);

-- ── 2. Backfill faculty from the existing (1:1 today) join table ────

update public.faculty_staff f
set program_id = fp.program_id
from public.faculty_program fp
where fp.faculty_id = f.id
  and f.program_id is null;

-- ── 3. Retire the auto-link triggers, functions, and join table ─────

drop trigger if exists trg_link_faculty_programs on public.faculty_staff;
drop trigger if exists trg_link_college_faculty   on public.program;
drop function if exists public.link_faculty_to_college_programs();
drop function if exists public.link_college_faculty_to_program();
drop table if exists public.faculty_program;

-- ── 4. is_adviser_of_student: compare program_id directly ───────────

create or replace function public.is_adviser_of_student(p_student_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
    select exists (
        select 1
        from university_student s
        join faculty_staff f on f.program_id = s.program_id
        where s.id = p_student_id
          and f.user_id = auth.uid()
          and f.is_approved
    );
$function$;

-- ── 5. _provision_account: require + cap programme for staff roles ──

create or replace function public._provision_account(
    p_first_name text, p_last_name text, p_email text, p_password text, p_role text,
    p_employee_id text default null::text, p_student_id text default null::text,
    p_department text default 'College of Computer Studies'::text, p_year_level text default null::text,
    p_username text default null::text, p_via text default 'ADMIN_MANUAL'::text,
    p_program_code text default 'BSIT'::text, p_declared_path text default 'existing'::text
)
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

    -- Every role except admin belongs to exactly one programme. Resolved
    -- once here so both the student branch (which already needed it) and
    -- the new staff cap check below share the same lookup and the same
    -- "no such programme" error.
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

        -- Students are never capped -- a programme's whole point is to
        -- teach students; the caps below exist so a small administrative
        -- team does not silently balloon, not to gate enrolment.
        select id into v_prospectus
        from prospectus
        where program_id = v_program and is_active = true
        limit 1;

        v_verified := (v_path = 'new');

    else
        if coalesce(trim(p_employee_id), '') = '' then
            raise exception 'Employee ID is required for staff accounts.'
                using errcode = '22023';
        end if;

        if v_role = 'admin' and coalesce(trim(p_username), '') = '' then
            raise exception 'A username is required for administrator accounts.'
                using errcode = '22023';
        end if;

        -- One cap per role, checked against how many accounts THIS
        -- programme already has -- not a university-wide total. A large
        -- college with several programmes can still have ten faculty
        -- per programme; it is one programme accumulating an unbounded
        -- staff roster that this guards against.
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
        insert into faculty_staff (
            user_id, employee_id, first_name, last_name, email, department, program_id,
            is_approved, created_by, created_via, must_change_password
        ) values (
            v_uid, p_employee_id, p_first_name, p_last_name, v_email, p_department, v_program,
            true, v_caller, p_via, true
        )
        returning id into v_actor_id;

    elsif v_role = 'registrar' then
        insert into registrar_staff (
            user_id, employee_id, first_name, last_name, email, department, program_id,
            is_approved, created_by, created_via, must_change_password
        ) values (
            v_uid, p_employee_id, p_first_name, p_last_name, v_email, p_department, v_program,
            true, v_caller, p_via, true
        )
        returning id into v_actor_id;

    elsif v_role = 'department' then
        insert into department_staff (
            user_id, employee_id, first_name, last_name, email, department, program_id,
            is_approved, created_by, created_via, must_change_password
        ) values (
            v_uid, p_employee_id, p_first_name, p_last_name, v_email, p_department, v_program,
            true, v_caller, p_via, true
        )
        returning id into v_actor_id;

    else
        insert into system_administrator (
            user_id, employee_id, first_name, last_name, email, username,
            is_approved, created_by, created_via, must_change_password
        ) values (
            v_uid, p_employee_id, p_first_name, p_last_name, v_email, trim(p_username),
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
            'student_id', v_sid, 'employee_id', p_employee_id,
            'program_code', v_prog_code, 'declared_path', v_path,
            'record_verified', v_verified, 'via', p_via
        )
    );

    return jsonb_build_object(
        'user_id',  v_uid,
        'actor_id', v_actor_id,
        'email',    v_email,
        'role',     v_role
    );
end;
$function$;


-- ROLLBACK --------------------------------------------------------------
-- create table if not exists public.faculty_program (
--     faculty_id uuid not null references public.faculty_staff(id) on delete cascade,
--     program_id integer not null references public.program(id) on delete cascade,
--     created_at timestamptz not null default now(),
--     primary key (faculty_id, program_id)
-- );
-- insert into public.faculty_program (faculty_id, program_id)
--     select id, program_id from public.faculty_staff where program_id is not null;
-- -- link_faculty_to_college_programs, link_college_faculty_to_program, their
-- -- triggers, and the pre-030 _provision_account / is_adviser_of_student
-- -- bodies would need to be restored from source control (this file's own
-- -- history), not reconstructed here.
-- alter table public.faculty_staff    drop column if exists program_id;
-- alter table public.registrar_staff  drop column if exists program_id;
-- alter table public.department_staff drop column if exists program_id;
