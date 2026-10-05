-- CurricuLogic schema snapshot, generated 2026-10-04 12:45 UTC
-- extensions in use: pg_cron, pg_stat_statements, pgcrypto, plpgsql, supabase_vault, uuid-ossp
set check_function_bodies = false;
create sequence if not exists public.enrollment_id_seq as bigint start with 1 increment by 1 minvalue 1 maxvalue 9223372036854775807 cache 1;
create sequence if not exists public.enrollment_item_id_seq as bigint start with 1 increment by 1 minvalue 1 maxvalue 9223372036854775807 cache 1;
create sequence if not exists public.grade_file_row_id_seq as integer start with 1 increment by 1 minvalue 1 maxvalue 2147483647 cache 1;
create sequence if not exists public.section_id_seq as integer start with 1 increment by 1 minvalue 1 maxvalue 2147483647 cache 1;
create sequence if not exists public.staff_employee_seq as integer start with 1 increment by 1 minvalue 1 maxvalue 99999 cache 1;
create sequence if not exists public.subject_offering_id_seq as integer start with 1 increment by 1 minvalue 1 maxvalue 2147483647 cache 1;
create table public.academic_record (
    id integer generated always as identity not null,
    student_id uuid not null,
    subject_id integer,
    grade character varying(5),
    grade_points numeric(3,2),
    status character varying(50),
    taken_year integer,
    taken_term integer,
    created_at timestamp without time zone default now(),
    updated_at timestamp without time zone default now()
);
create table public.advisee_assignment (
    assignment_id uuid default gen_random_uuid() not null,
    faculty_id uuid not null,
    student_id uuid not null,
    assigned_by uuid,
    assigned_at timestamp with time zone default now() not null,
    is_active boolean default true not null
);
create table public.ai_chat_message (
    id bigint generated always as identity not null,
    student_id uuid not null,
    role text not null,
    text text not null,
    show_recommended_table boolean default false not null,
    created_at timestamp with time zone default now() not null
);
create table public.ai_recommendation (
    id integer generated always as identity not null,
    student_id uuid not null,
    prospectus_id integer not null,
    generated_for_term integer,
    generated_for_year integer,
    rule_version character varying(255),
    recommendation_summary text,
    created_at timestamp without time zone default now(),
    updated_at timestamp without time zone default now()
);
create table public.audit_log (
    id integer generated always as identity not null,
    actor_id uuid,
    actor_role character varying(50),
    action character varying(100),
    table_name character varying(100),
    record_id text,
    old_values jsonb,
    new_values jsonb,
    created_at timestamp without time zone default now()
);
create table public.bulk_upload_history (
    id uuid default gen_random_uuid() not null,
    admin_id uuid,
    file_name text not null,
    total_rows integer default 0 not null,
    success_count integer default 0 not null,
    failed_count integer default 0 not null,
    created_at timestamp with time zone default now() not null
);
create table public.department_staff (
    id uuid default uuid_generate_v4() not null,
    user_id uuid not null,
    employee_id character varying(20) not null,
    first_name character varying(100),
    last_name character varying(100),
    email character varying(255),
    department character varying(100),
    role character varying(100),
    created_at timestamp without time zone default now(),
    updated_at timestamp without time zone default now(),
    is_approved boolean default false not null,
    created_by uuid,
    created_via text default 'SELF_REGISTER'::text,
    must_change_password boolean default false not null,
    avatar_url text,
    program_id integer
);
create table public.elective_group (
    id integer generated always as identity not null,
    prospectus_id integer not null,
    name character varying(200),
    required_count integer default 1,
    created_by uuid not null,
    created_at timestamp without time zone default now(),
    updated_at timestamp without time zone default now()
);
create table public.elective_group_member (
    id integer generated always as identity not null,
    elective_group_id integer not null,
    subject_id integer not null
);
create table public.enrollment (
    id bigint default nextval('enrollment_id_seq'::regclass) not null,
    student_id uuid not null,
    prospectus_id integer not null,
    academic_year integer not null,
    term integer not null,
    status text default 'enrolled'::text not null,
    enrolled_by uuid,
    enrolled_at timestamp with time zone default now() not null,
    notes text,
    created_at timestamp with time zone default now() not null,
    updated_at timestamp with time zone default now() not null
);
create table public.enrollment_item (
    id bigint default nextval('enrollment_item_id_seq'::regclass) not null,
    enrollment_id bigint not null,
    subject_id integer not null,
    offering_id integer not null,
    units numeric(3,1) not null,
    status text default 'enrolled'::text not null,
    created_at timestamp with time zone default now() not null,
    updated_at timestamp with time zone default now() not null
);
create table public.faculty_staff (
    id uuid default uuid_generate_v4() not null,
    user_id uuid not null,
    employee_id character varying(20) not null,
    first_name character varying(100),
    last_name character varying(100),
    email character varying(255),
    department character varying(100),
    created_at timestamp without time zone default now(),
    updated_at timestamp without time zone default now(),
    is_approved boolean default false not null,
    created_by uuid,
    created_via text default 'SELF_REGISTER'::text,
    must_change_password boolean default false not null,
    program_id integer
);
create table public.grade_file (
    id integer generated always as identity not null,
    uploaded_by uuid not null,
    file_name character varying(255),
    file_path character varying(500),
    status character varying(50) default 'pending'::character varying,
    row_count integer,
    matched_count integer,
    error_count integer,
    error_log text,
    uploaded_at timestamp without time zone default now(),
    processed_at timestamp without time zone,
    academic_year integer,
    passing_grade numeric,
    term integer
);
create table public.grade_file_row (
    id integer default nextval('grade_file_row_id_seq'::regclass) not null,
    grade_file_id integer not null,
    row_number integer,
    raw_student_id character varying,
    raw_student_name character varying,
    raw_subject_code character varying,
    raw_grade character varying,
    student_id uuid,
    subject_id integer,
    grade_points numeric,
    status character varying,
    term integer,
    academic_year integer,
    validation_status character varying default 'pending'::character varying not null,
    error_message text,
    processed_at timestamp without time zone
);
create table public.maintenance_log (
    id bigint generated always as identity not null,
    ran_at timestamp with time zone default now() not null,
    task text not null,
    rows_found integer not null,
    dry_run boolean not null
);
create table public.notification (
    id integer generated always as identity not null,
    user_id uuid not null,
    type character varying(50),
    title character varying(255),
    message text,
    related_request_id integer,
    is_read boolean default false,
    created_at timestamp without time zone default now(),
    updated_at timestamp without time zone default now()
);
create table public.prerequisite (
    id integer generated always as identity not null,
    subject_id integer not null,
    prerequisite_subject_id integer,
    requirement_type character varying(50) not null,
    rule_type character varying(50),
    created_by uuid not null,
    created_at timestamp without time zone default now(),
    updated_at timestamp without time zone default now(),
    threshold_value numeric,
    rule_group integer default 1 not null
);
create table public.program (
    id integer generated always as identity not null,
    code character varying(50) not null,
    name character varying(200) not null,
    college character varying(200),
    created_at timestamp without time zone default now(),
    updated_at timestamp without time zone default now(),
    max_units integer default 24 not null,
    max_units_graduating integer default 27 not null,
    target_units integer default 176 not null
);
create table public.prospectus (
    id integer generated always as identity not null,
    program_id integer not null,
    academic_year integer,
    academic_term integer,
    is_active boolean default false,
    published_by uuid,
    published_at timestamp without time zone,
    created_by uuid not null,
    created_at timestamp without time zone default now(),
    updated_at timestamp without time zone default now()
);
create table public.recommendation_item (
    id integer generated always as identity not null,
    recommendation_id integer not null,
    subject_id integer not null,
    status character varying(50),
    reason text,
    prerequisite_evidence text,
    created_at timestamp without time zone default now()
);
create table public.registrar_staff (
    id uuid default uuid_generate_v4() not null,
    user_id uuid not null,
    employee_id character varying(20) not null,
    first_name character varying(100),
    last_name character varying(100),
    email character varying(255),
    created_at timestamp without time zone default now(),
    updated_at timestamp without time zone default now(),
    is_approved boolean default false not null,
    created_by uuid,
    created_via text default 'SELF_REGISTER'::text,
    must_change_password boolean default false not null,
    department character varying,
    program_id integer
);
create table public.request (
    id integer generated always as identity not null,
    student_id uuid not null,
    prospectus_id integer not null,
    status character varying(50) default 'submitted'::character varying,
    requested_term integer,
    requested_year integer,
    created_at timestamp without time zone default now(),
    updated_at timestamp without time zone default now(),
    registrar_status text,
    registrar_id uuid,
    registrar_reviewed_at timestamp with time zone,
    registrar_notes text
);
create table public.request_approval (
    id integer generated always as identity not null,
    request_id integer not null,
    registrar_id uuid not null,
    status character varying(50),
    remarks text,
    approved_at timestamp without time zone,
    created_at timestamp without time zone default now(),
    updated_at timestamp without time zone default now()
);
create table public.request_item (
    id integer generated always as identity not null,
    request_id integer not null,
    subject_id integer not null,
    status character varying(50) default 'pending'::character varying,
    remarks text,
    created_at timestamp without time zone default now(),
    updated_at timestamp without time zone default now(),
    offering_id integer
);
create table public.request_review (
    id integer generated always as identity not null,
    request_id integer not null,
    faculty_id uuid not null,
    status character varying(50),
    remarks text,
    reviewed_at timestamp without time zone,
    created_at timestamp without time zone default now(),
    updated_at timestamp without time zone default now()
);
create table public.section (
    id integer default nextval('section_id_seq'::regclass) not null,
    program_id integer not null,
    code character varying not null,
    year_level integer not null,
    academic_year integer not null,
    is_active boolean default true not null,
    created_by uuid,
    created_at timestamp with time zone default now() not null
);
create table public.stg_prerequisite (
    subject_code text,
    prerequisite_code text,
    requirement_type text,
    rule_type text,
    rule_group integer,
    threshold_value numeric,
    batch_id uuid,
    uploaded_by uuid,
    row_number integer,
    validation_status text default 'pending'::text not null,
    error_message text,
    uploaded_at timestamp with time zone default now() not null
);
create table public.stg_subject (
    code text,
    title text,
    units numeric,
    year_level integer,
    term integer,
    is_elective boolean,
    batch_id uuid,
    uploaded_by uuid,
    row_number integer,
    validation_status text default 'pending'::text not null,
    error_message text,
    uploaded_at timestamp with time zone default now() not null
);
create table public.student_id_counter (
    year integer not null,
    last integer default 0 not null
);
create table public.student_preference (
    student_id uuid not null,
    time_of_day text,
    load text,
    updated_at timestamp with time zone default now() not null
);
create table public.subject (
    id integer generated always as identity not null,
    prospectus_id integer not null,
    code character varying(50) not null,
    title character varying(255) not null,
    units numeric(4,2),
    year_level integer,
    term integer,
    is_elective boolean default false,
    created_by uuid not null,
    created_at timestamp without time zone default now(),
    updated_at timestamp without time zone default now(),
    lec_units numeric,
    lab_units numeric,
    category character varying,
    is_active boolean default true not null,
    retired_at timestamp with time zone,
    retired_by uuid,
    elective_type character varying
);
create table public.subject_offering (
    id integer default nextval('subject_offering_id_seq'::regclass) not null,
    subject_id integer not null,
    academic_year integer not null,
    term integer not null,
    section character varying not null,
    section_id integer,
    edp_code character varying not null,
    schedule_days character varying,
    start_time time without time zone,
    end_time time without time zone,
    room character varying,
    instructor character varying,
    capacity integer,
    is_open boolean default true not null,
    created_by uuid,
    created_at timestamp with time zone default now() not null,
    updated_at timestamp with time zone default now() not null,
    meeting_type character varying(3) default 'LEC'::character varying not null
);
create table public.system_administrator (
    id uuid default uuid_generate_v4() not null,
    user_id uuid not null,
    employee_id character varying(20) not null,
    first_name character varying(100),
    last_name character varying(100),
    email character varying(255),
    created_at timestamp without time zone default now(),
    updated_at timestamp without time zone default now(),
    is_approved boolean default false not null,
    username text,
    created_by uuid,
    created_via text default 'SELF_REGISTER'::text,
    must_change_password boolean default false not null
);
create table public.system_config (
    id smallint default 1 not null,
    current_term smallint not null,
    current_academic_year integer not null,
    updated_by uuid,
    updated_at timestamp with time zone default now() not null
);
create table public.system_log (
    id integer generated always as identity not null,
    level character varying(20),
    message text,
    context jsonb,
    created_at timestamp without time zone default now()
);
create table public.university_student (
    id uuid default gen_random_uuid() not null,
    user_id uuid not null,
    student_id character varying(20),
    first_name character varying(100),
    last_name character varying(100),
    email character varying(255),
    phone character varying(20),
    program_id integer,
    year_level integer,
    academic_standing character varying(50) default 'regular'::character varying,
    created_at timestamp without time zone default now(),
    updated_at timestamp without time zone default now(),
    is_approved boolean default false not null,
    record_verified boolean default false not null,
    declared_path character varying(20),
    approval_status text default 'pending'::text not null,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    review_note text,
    verified_by uuid,
    verified_at timestamp with time zone,
    created_by uuid,
    created_via text default 'SELF_REGISTER'::text,
    must_change_password boolean default false not null,
    prospectus_id integer
);
alter table public.academic_record add constraint academic_record_status_values CHECK (((status IS NULL) OR ((status)::text = ANY ('{PASSED,FAILED,ENROLLED,DROPPED}'::text[]))));
alter table public.academic_record add constraint academic_record_pkey PRIMARY KEY (id);
alter table public.academic_record add constraint academic_record_attempt_key UNIQUE (student_id, subject_id, taken_term, taken_year);
alter table public.advisee_assignment add constraint advisee_assignment_pkey PRIMARY KEY (assignment_id);
alter table public.advisee_assignment add constraint advisee_assignment_faculty_id_student_id_key UNIQUE (faculty_id, student_id);
alter table public.ai_chat_message add constraint ai_chat_message_pkey PRIMARY KEY (id);
alter table public.ai_chat_message add constraint ai_chat_message_text_maxlen CHECK ((char_length(text) <= 4000));
alter table public.ai_chat_message add constraint ai_chat_message_role_check CHECK ((role = ANY (ARRAY['user'::text, 'model'::text])));
alter table public.ai_recommendation add constraint ai_recommendation_recommendation_summary_maxlen CHECK ((char_length(recommendation_summary) <= 10000));
alter table public.ai_recommendation add constraint ai_recommendation_pkey PRIMARY KEY (id);
alter table public.audit_log add constraint audit_log_pkey PRIMARY KEY (id);
alter table public.bulk_upload_history add constraint bulk_upload_history_pkey PRIMARY KEY (id);
alter table public.bulk_upload_history add constraint bulk_upload_history_file_name_maxlen CHECK ((char_length(file_name) <= 255));
alter table public.department_staff add constraint department_staff_avatar_url_maxlen CHECK ((char_length(avatar_url) <= 500));
alter table public.department_staff add constraint department_staff_pkey PRIMARY KEY (id);
alter table public.department_staff add constraint department_staff_user_id_key UNIQUE (user_id);
alter table public.department_staff add constraint department_staff_employee_id_key UNIQUE (employee_id);
alter table public.department_staff add constraint department_staff_created_via_maxlen CHECK ((char_length(created_via) <= 30));
alter table public.department_staff add constraint department_staff_employee_id_format CHECK (((employee_id)::text ~ '^EMP-[0-9]{5}$'::text));
alter table public.elective_group add constraint elective_group_pkey PRIMARY KEY (id);
alter table public.elective_group_member add constraint elective_group_member_elective_group_id_subject_id_key UNIQUE (elective_group_id, subject_id);
alter table public.elective_group_member add constraint elective_group_member_pkey PRIMARY KEY (id);
alter table public.enrollment add constraint enrollment_term_check CHECK (((term >= 1) AND (term <= 3)));
alter table public.enrollment add constraint enrollment_notes_maxlen CHECK ((char_length(notes) <= 1000));
alter table public.enrollment add constraint enrollment_pkey PRIMARY KEY (id);
alter table public.enrollment add constraint enrollment_status_check CHECK ((status = ANY (ARRAY['enrolled'::text, 'completed'::text, 'withdrawn'::text])));
alter table public.enrollment_item add constraint enrollment_item_status_check CHECK ((status = ANY (ARRAY['enrolled'::text, 'dropped'::text])));
alter table public.enrollment_item add constraint enrollment_item_pkey PRIMARY KEY (id);
alter table public.faculty_staff add constraint faculty_staff_pkey PRIMARY KEY (id);
alter table public.faculty_staff add constraint faculty_staff_employee_id_format CHECK (((employee_id)::text ~ '^EMP-[0-9]{5}$'::text));
alter table public.faculty_staff add constraint faculty_staff_employee_id_key UNIQUE (employee_id);
alter table public.faculty_staff add constraint faculty_staff_user_id_key UNIQUE (user_id);
alter table public.faculty_staff add constraint faculty_staff_created_via_maxlen CHECK ((char_length(created_via) <= 30));
alter table public.grade_file add constraint grade_file_status_values CHECK (((status IS NULL) OR ((status)::text = ANY ('{pending,processing,completed,failed}'::text[]))));
alter table public.grade_file add constraint grade_file_error_log_maxlen CHECK ((char_length(error_log) <= 50000));
alter table public.grade_file add constraint grade_file_pkey PRIMARY KEY (id);
alter table public.grade_file_row add constraint grade_file_row_raw_grade_maxlen CHECK ((char_length((raw_grade)::text) <= 20));
alter table public.grade_file_row add constraint grade_file_row_raw_subject_code_maxlen CHECK ((char_length((raw_subject_code)::text) <= 60));
alter table public.grade_file_row add constraint grade_file_row_validation_valid CHECK (((validation_status)::text = ANY ((ARRAY['pending'::character varying, 'matched'::character varying, 'rejected'::character varying, 'applied'::character varying])::text[])));
alter table public.grade_file_row add constraint grade_file_row_pkey PRIMARY KEY (id);
alter table public.grade_file_row add constraint grade_file_row_error_message_maxlen CHECK ((char_length(error_message) <= 500));
alter table public.grade_file_row add constraint grade_file_row_raw_student_name_maxlen CHECK ((char_length((raw_student_name)::text) <= 200));
alter table public.grade_file_row add constraint grade_file_row_status_values CHECK (((status IS NULL) OR ((status)::text = ANY ('{PASSED,FAILED,ENROLLED,DROPPED}'::text[]))));
alter table public.maintenance_log add constraint maintenance_log_pkey PRIMARY KEY (id);
alter table public.maintenance_log add constraint maintenance_log_task_maxlen CHECK ((char_length(task) <= 50));
alter table public.notification add constraint notification_message_maxlen CHECK ((char_length(message) <= 1000));
alter table public.notification add constraint notification_pkey PRIMARY KEY (id);
alter table public.prerequisite add constraint valid_prerequisite CHECK (((((requirement_type)::text = ANY (ARRAY['prerequisite'::text, 'co_requisite'::text])) AND (prerequisite_subject_id IS NOT NULL)) OR (((requirement_type)::text = 'standing'::text) AND (prerequisite_subject_id IS NULL) AND (threshold_value IS NOT NULL))));
alter table public.prerequisite add constraint prerequisite_pkey PRIMARY KEY (id);
alter table public.program add constraint program_max_units_graduating_check CHECK ((max_units_graduating > 0));
alter table public.program add constraint program_pkey PRIMARY KEY (id);
alter table public.program add constraint program_code_key UNIQUE (code);
alter table public.program add constraint program_code_shape CHECK (((code)::text ~ '^[A-Za-z]{2,10}$'::text));
alter table public.program add constraint program_max_units_check CHECK ((max_units > 0));
alter table public.program add constraint program_target_units_check CHECK ((target_units > 0));
alter table public.prospectus add constraint prospectus_pkey PRIMARY KEY (id);
alter table public.recommendation_item add constraint recommendation_item_pkey PRIMARY KEY (id);
alter table public.recommendation_item add constraint recommendation_item_reason_maxlen CHECK ((char_length(reason) <= 2000));
alter table public.recommendation_item add constraint recommendation_item_prerequisite_evidence_maxlen CHECK ((char_length(prerequisite_evidence) <= 2000));
alter table public.registrar_staff add constraint registrar_staff_pkey PRIMARY KEY (id);
alter table public.registrar_staff add constraint registrar_staff_created_via_maxlen CHECK ((char_length(created_via) <= 30));
alter table public.registrar_staff add constraint registrar_staff_employee_id_key UNIQUE (employee_id);
alter table public.registrar_staff add constraint registrar_staff_user_id_key UNIQUE (user_id);
alter table public.registrar_staff add constraint registrar_staff_employee_id_format CHECK (((employee_id)::text ~ '^EMP-[0-9]{5}$'::text));
alter table public.registrar_staff add constraint registrar_staff_department_maxlen CHECK ((char_length((department)::text) <= 100));
alter table public.request add constraint request_registrar_notes_maxlen CHECK ((char_length(registrar_notes) <= 500));
alter table public.request add constraint request_registrar_status_check CHECK (((registrar_status IS NULL) OR (registrar_status = ANY (ARRAY['approved'::text, 'rejected'::text]))));
alter table public.request add constraint request_pkey PRIMARY KEY (id);
alter table public.request add constraint request_status_values CHECK (((status IS NULL) OR ((status)::text = ANY ('{submitted,approved,partially_approved,rejected}'::text[]))));
alter table public.request_approval add constraint request_approval_pkey PRIMARY KEY (id);
alter table public.request_approval add constraint request_approval_remarks_maxlen CHECK ((char_length(remarks) <= 500));
alter table public.request_item add constraint request_item_pkey PRIMARY KEY (id);
alter table public.request_item add constraint request_item_remarks_maxlen CHECK ((char_length(remarks) <= 500));
alter table public.request_item add constraint request_item_status_values CHECK (((status IS NULL) OR ((status)::text = ANY ('{pending,valid,flagged,approved,rejected}'::text[]))));
alter table public.request_review add constraint request_review_pkey PRIMARY KEY (id);
alter table public.request_review add constraint request_review_remarks_maxlen CHECK ((char_length(remarks) <= 5000));
alter table public.request_review add constraint request_review_status_values CHECK (((status IS NULL) OR ((status)::text = ANY ('{approved,partially_approved,rejected}'::text[]))));
alter table public.section add constraint section_program_id_code_academic_year_key UNIQUE (program_id, code, academic_year);
alter table public.section add constraint section_year_level_check CHECK (((year_level >= 1) AND (year_level <= 4)));
alter table public.section add constraint section_pkey PRIMARY KEY (id);
alter table public.student_id_counter add constraint student_id_counter_pkey PRIMARY KEY (year);
alter table public.student_preference add constraint student_preference_load_check CHECK ((load = ANY (ARRAY['light'::text, 'regular'::text, 'full'::text])));
alter table public.student_preference add constraint student_preference_time_of_day_maxlen CHECK ((char_length(time_of_day) <= 20));
alter table public.student_preference add constraint student_preference_pkey PRIMARY KEY (student_id);
alter table public.student_preference add constraint student_preference_time_of_day_check CHECK ((time_of_day = ANY (ARRAY['morning'::text, 'afternoon'::text, 'evening'::text])));
alter table public.student_preference add constraint student_preference_load_maxlen CHECK ((char_length(load) <= 20));
alter table public.subject add constraint subject_pkey PRIMARY KEY (id);
alter table public.subject add constraint subject_prospectus_id_code_key UNIQUE (prospectus_id, code);
alter table public.subject add constraint subject_elective_type_maxlen CHECK ((char_length((elective_type)::text) <= 50));
alter table public.subject add constraint subject_category_maxlen CHECK ((char_length((category)::text) <= 50));
alter table public.subject add constraint subject_elective_type_check CHECK (((elective_type IS NULL) OR ((elective_type)::text = ANY ((ARRAY['IT'::character varying, 'FREE'::character varying])::text[]))));
alter table public.subject add constraint subject_category_check CHECK (((category IS NULL) OR ((category)::text = ANY ((ARRAY['GE'::character varying, 'COMMON_COMPUTING'::character varying, 'PROFESSIONAL_IT'::character varying, 'ELECTIVE'::character varying, 'OTHER'::character varying])::text[]))));
alter table public.subject_offering add constraint subject_offering_term_check CHECK (((term >= 1) AND (term <= 3)));
alter table public.subject_offering add constraint subject_offering_edp_code_maxlen CHECK ((char_length((edp_code)::text) <= 20));
alter table public.subject_offering add constraint subject_offering_section_maxlen CHECK ((char_length((section)::text) <= 50));
alter table public.subject_offering add constraint subject_offering_schedule_days_maxlen CHECK ((char_length((schedule_days)::text) <= 20));
alter table public.subject_offering add constraint subject_offering_room_maxlen CHECK ((char_length((room)::text) <= 50));
alter table public.subject_offering add constraint subject_offering_instructor_maxlen CHECK ((char_length((instructor)::text) <= 150));
alter table public.subject_offering add constraint subject_offering_pkey PRIMARY KEY (id);
alter table public.subject_offering add constraint chk_meeting_type CHECK (((meeting_type)::text = ANY ((ARRAY['LEC'::character varying, 'LAB'::character varying])::text[])));
alter table public.subject_offering add constraint subject_offering_meeting_type_values CHECK (((meeting_type IS NULL) OR ((meeting_type)::text = ANY ('{LEC,LAB}'::text[]))));
alter table public.subject_offering add constraint uq_offering_slot UNIQUE (subject_id, academic_year, term, section, meeting_type);
alter table public.subject_offering add constraint uq_offering_edp UNIQUE (academic_year, term, edp_code);
alter table public.system_administrator add constraint system_administrator_pkey PRIMARY KEY (id);
alter table public.system_administrator add constraint system_administrator_employee_id_format CHECK (((employee_id)::text ~ '^SYS-[A-Z0-9]{3,12}$'::text));
alter table public.system_administrator add constraint system_administrator_username_key UNIQUE (username);
alter table public.system_administrator add constraint system_administrator_created_via_maxlen CHECK ((char_length(created_via) <= 30));
alter table public.system_administrator add constraint system_administrator_username_maxlen CHECK ((char_length(username) <= 50));
alter table public.system_administrator add constraint system_administrator_employee_id_key UNIQUE (employee_id);
alter table public.system_administrator add constraint system_administrator_user_id_key UNIQUE (user_id);
alter table public.system_config add constraint system_config_pkey PRIMARY KEY (id);
alter table public.system_config add constraint system_config_term_range CHECK (((current_term >= 1) AND (current_term <= 3)));
alter table public.system_config add constraint system_config_singleton CHECK ((id = 1));
alter table public.system_log add constraint system_log_message_maxlen CHECK ((char_length(message) <= 2000));
alter table public.system_log add constraint system_log_pkey PRIMARY KEY (id);
alter table public.university_student add constraint university_student_declared_path_values CHECK (((declared_path IS NULL) OR ((declared_path)::text = ANY ('{new,existing}'::text[]))));
alter table public.university_student add constraint university_student_review_note_maxlen CHECK ((char_length(review_note) <= 500));
alter table public.university_student add constraint university_student_student_id_key UNIQUE (student_id);
alter table public.university_student add constraint university_student_user_id_key UNIQUE (user_id);
alter table public.university_student add constraint university_student_pkey PRIMARY KEY (id);
alter table public.university_student add constraint university_student_id_format CHECK (((student_id IS NULL) OR ((student_id)::text ~ '^\d{7}$'::text)));
alter table public.university_student add constraint university_student_created_via_maxlen CHECK ((char_length(created_via) <= 30));
alter table public.university_student add constraint university_student_approval_status_valid CHECK ((approval_status = ANY (ARRAY['pending'::text, 'approved'::text, 'declined'::text])));
alter table public.academic_record add constraint academic_record_student_id_fkey FOREIGN KEY (student_id) REFERENCES university_student(id) ON DELETE CASCADE;
alter table public.academic_record add constraint academic_record_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES subject(id);
alter table public.advisee_assignment add constraint advisee_assignment_student_id_fkey FOREIGN KEY (student_id) REFERENCES university_student(id) ON DELETE CASCADE;
alter table public.advisee_assignment add constraint advisee_assignment_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.advisee_assignment add constraint advisee_assignment_faculty_id_fkey FOREIGN KEY (faculty_id) REFERENCES faculty_staff(id) ON DELETE CASCADE;
alter table public.ai_chat_message add constraint ai_chat_message_student_id_fkey FOREIGN KEY (student_id) REFERENCES university_student(id) ON DELETE CASCADE;
alter table public.ai_recommendation add constraint ai_recommendation_prospectus_id_fkey FOREIGN KEY (prospectus_id) REFERENCES prospectus(id);
alter table public.ai_recommendation add constraint ai_recommendation_student_id_fkey FOREIGN KEY (student_id) REFERENCES university_student(id) ON DELETE CASCADE;
alter table public.bulk_upload_history add constraint bulk_upload_history_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES system_administrator(id);
alter table public.department_staff add constraint department_staff_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.department_staff add constraint department_staff_program_id_fkey FOREIGN KEY (program_id) REFERENCES program(id);
alter table public.department_staff add constraint department_staff_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
alter table public.elective_group add constraint elective_group_created_by_fkey FOREIGN KEY (created_by) REFERENCES department_staff(id);
alter table public.elective_group add constraint elective_group_prospectus_id_fkey FOREIGN KEY (prospectus_id) REFERENCES prospectus(id);
alter table public.elective_group_member add constraint elective_group_member_elective_group_id_fkey FOREIGN KEY (elective_group_id) REFERENCES elective_group(id) ON DELETE CASCADE;
alter table public.elective_group_member add constraint elective_group_member_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES subject(id) ON DELETE CASCADE;
alter table public.enrollment add constraint enrollment_prospectus_id_fkey FOREIGN KEY (prospectus_id) REFERENCES prospectus(id);
alter table public.enrollment add constraint enrollment_student_id_fkey FOREIGN KEY (student_id) REFERENCES university_student(id) ON DELETE CASCADE;
alter table public.enrollment add constraint enrollment_enrolled_by_fkey FOREIGN KEY (enrolled_by) REFERENCES registrar_staff(id);
alter table public.enrollment_item add constraint enrollment_item_offering_id_fkey FOREIGN KEY (offering_id) REFERENCES subject_offering(id);
alter table public.enrollment_item add constraint enrollment_item_enrollment_id_fkey FOREIGN KEY (enrollment_id) REFERENCES enrollment(id) ON DELETE CASCADE;
alter table public.enrollment_item add constraint enrollment_item_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES subject(id);
alter table public.faculty_staff add constraint faculty_staff_program_id_fkey FOREIGN KEY (program_id) REFERENCES program(id);
alter table public.faculty_staff add constraint faculty_staff_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.faculty_staff add constraint faculty_staff_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
alter table public.grade_file add constraint grade_file_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES department_staff(id);
alter table public.grade_file_row add constraint grade_file_row_grade_file_id_fkey FOREIGN KEY (grade_file_id) REFERENCES grade_file(id) ON DELETE CASCADE;
alter table public.grade_file_row add constraint grade_file_row_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES subject(id);
alter table public.grade_file_row add constraint grade_file_row_student_id_fkey FOREIGN KEY (student_id) REFERENCES university_student(id);
alter table public.notification add constraint notification_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.notification add constraint notification_related_request_id_fkey FOREIGN KEY (related_request_id) REFERENCES request(id);
alter table public.prerequisite add constraint prerequisite_prerequisite_subject_id_fkey FOREIGN KEY (prerequisite_subject_id) REFERENCES subject(id);
alter table public.prerequisite add constraint prerequisite_created_by_fkey FOREIGN KEY (created_by) REFERENCES department_staff(id);
alter table public.prerequisite add constraint prerequisite_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES subject(id) ON DELETE CASCADE;
alter table public.prospectus add constraint prospectus_created_by_fkey FOREIGN KEY (created_by) REFERENCES department_staff(id);
alter table public.prospectus add constraint prospectus_program_id_fkey FOREIGN KEY (program_id) REFERENCES program(id);
alter table public.prospectus add constraint prospectus_published_by_fkey FOREIGN KEY (published_by) REFERENCES department_staff(id);
alter table public.recommendation_item add constraint recommendation_item_recommendation_id_fkey FOREIGN KEY (recommendation_id) REFERENCES ai_recommendation(id) ON DELETE CASCADE;
alter table public.recommendation_item add constraint recommendation_item_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES subject(id);
alter table public.registrar_staff add constraint registrar_staff_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
alter table public.registrar_staff add constraint registrar_staff_program_id_fkey FOREIGN KEY (program_id) REFERENCES program(id);
alter table public.registrar_staff add constraint registrar_staff_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.request add constraint request_prospectus_id_fkey FOREIGN KEY (prospectus_id) REFERENCES prospectus(id);
alter table public.request add constraint request_registrar_id_fkey FOREIGN KEY (registrar_id) REFERENCES registrar_staff(id);
alter table public.request add constraint request_student_id_fkey FOREIGN KEY (student_id) REFERENCES university_student(id) ON DELETE CASCADE;
alter table public.request_approval add constraint request_approval_request_id_fkey FOREIGN KEY (request_id) REFERENCES request(id) ON DELETE CASCADE;
alter table public.request_approval add constraint request_approval_registrar_id_fkey FOREIGN KEY (registrar_id) REFERENCES registrar_staff(id);
alter table public.request_item add constraint request_item_request_id_fkey FOREIGN KEY (request_id) REFERENCES request(id) ON DELETE CASCADE;
alter table public.request_item add constraint request_item_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES subject(id);
alter table public.request_item add constraint request_item_offering_id_fkey FOREIGN KEY (offering_id) REFERENCES subject_offering(id) ON DELETE SET NULL;
alter table public.request_review add constraint request_review_faculty_id_fkey FOREIGN KEY (faculty_id) REFERENCES faculty_staff(id);
alter table public.request_review add constraint request_review_request_id_fkey FOREIGN KEY (request_id) REFERENCES request(id) ON DELETE CASCADE;
alter table public.section add constraint section_created_by_fkey FOREIGN KEY (created_by) REFERENCES department_staff(id);
alter table public.section add constraint section_program_id_fkey FOREIGN KEY (program_id) REFERENCES program(id);
alter table public.stg_prerequisite add constraint stg_prerequisite_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES auth.users(id);
alter table public.stg_subject add constraint stg_subject_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES auth.users(id);
alter table public.student_preference add constraint student_preference_student_id_fkey FOREIGN KEY (student_id) REFERENCES university_student(id) ON DELETE CASCADE;
alter table public.subject add constraint subject_created_by_fkey FOREIGN KEY (created_by) REFERENCES department_staff(id);
alter table public.subject add constraint subject_retired_by_fkey FOREIGN KEY (retired_by) REFERENCES department_staff(id);
alter table public.subject add constraint subject_prospectus_id_fkey FOREIGN KEY (prospectus_id) REFERENCES prospectus(id);
alter table public.subject_offering add constraint subject_offering_created_by_fkey FOREIGN KEY (created_by) REFERENCES department_staff(id);
alter table public.subject_offering add constraint subject_offering_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES subject(id) ON DELETE CASCADE;
alter table public.subject_offering add constraint subject_offering_section_id_fkey FOREIGN KEY (section_id) REFERENCES section(id);
alter table public.system_administrator add constraint system_administrator_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
alter table public.system_administrator add constraint system_administrator_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.system_config add constraint system_config_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id);
alter table public.university_student add constraint university_student_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
alter table public.university_student add constraint university_student_prospectus_id_fkey FOREIGN KEY (prospectus_id) REFERENCES prospectus(id);
alter table public.university_student add constraint university_student_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
CREATE INDEX idx_academic_record_student ON public.academic_record USING btree (student_id);
CREATE INDEX academic_record_student_idx ON public.academic_record USING btree (student_id);
CREATE INDEX idx_academic_record_subject ON public.academic_record USING btree (subject_id);
CREATE INDEX advisee_student_idx ON public.advisee_assignment USING btree (student_id);
CREATE INDEX advisee_faculty_idx ON public.advisee_assignment USING btree (faculty_id);
CREATE INDEX ai_chat_message_student_id_created_at_idx ON public.ai_chat_message USING btree (student_id, created_at);
CREATE INDEX idx_recommendation_student ON public.ai_recommendation USING btree (student_id);
CREATE INDEX audit_log_created_idx ON public.audit_log USING btree (created_at DESC);
CREATE INDEX idx_audit_log_actor ON public.audit_log USING btree (actor_id);
CREATE INDEX audit_log_record_idx ON public.audit_log USING btree (table_name, record_id);
CREATE INDEX idx_audit_log_table ON public.audit_log USING btree (table_name);
CREATE INDEX enrollment_student_idx ON public.enrollment USING btree (student_id);
CREATE UNIQUE INDEX enrollment_unique ON public.enrollment USING btree (student_id, academic_year, term);
CREATE INDEX enrollment_term_idx ON public.enrollment USING btree (academic_year, term);
CREATE INDEX enrollment_item_enrollment_idx ON public.enrollment_item USING btree (enrollment_id);
CREATE UNIQUE INDEX enrollment_item_unique ON public.enrollment_item USING btree (enrollment_id, subject_id);
CREATE INDEX grade_file_row_file_idx ON public.grade_file_row USING btree (grade_file_id);
CREATE INDEX idx_notification_user ON public.notification USING btree (user_id);
CREATE INDEX idx_prerequisite_subject ON public.prerequisite USING btree (subject_id);
CREATE INDEX idx_prerequisite_dep ON public.prerequisite USING btree (prerequisite_subject_id);
CREATE UNIQUE INDEX prospectus_one_active ON public.prospectus USING btree (program_id) WHERE is_active;
CREATE INDEX idx_prospectus_program ON public.prospectus USING btree (program_id);
CREATE INDEX idx_request_status ON public.request USING btree (status);
CREATE INDEX idx_request_student ON public.request USING btree (student_id);
CREATE INDEX idx_request_item_request ON public.request_item USING btree (request_id);
CREATE INDEX stg_prerequisite_batch_idx ON public.stg_prerequisite USING btree (batch_id);
CREATE INDEX stg_subject_batch_idx ON public.stg_subject USING btree (batch_id);
CREATE INDEX idx_subject_prospectus ON public.subject USING btree (prospectus_id);
CREATE INDEX subject_active_idx ON public.subject USING btree (prospectus_id) WHERE is_active;
CREATE INDEX subject_offering_term_idx ON public.subject_offering USING btree (academic_year, term);
CREATE INDEX idx_admin_username ON public.system_administrator USING btree (username);
alter table public.academic_record enable row level security;
alter table public.advisee_assignment enable row level security;
alter table public.ai_chat_message enable row level security;
alter table public.ai_recommendation enable row level security;
alter table public.audit_log enable row level security;
alter table public.bulk_upload_history enable row level security;
alter table public.department_staff enable row level security;
alter table public.elective_group enable row level security;
alter table public.elective_group_member enable row level security;
alter table public.enrollment enable row level security;
alter table public.enrollment_item enable row level security;
alter table public.faculty_staff enable row level security;
alter table public.grade_file enable row level security;
alter table public.grade_file_row enable row level security;
alter table public.maintenance_log enable row level security;
alter table public.notification enable row level security;
alter table public.prerequisite enable row level security;
alter table public.program enable row level security;
alter table public.prospectus enable row level security;
alter table public.recommendation_item enable row level security;
alter table public.registrar_staff enable row level security;
alter table public.request enable row level security;
alter table public.request_approval enable row level security;
alter table public.request_item enable row level security;
alter table public.request_review enable row level security;
alter table public.section enable row level security;
alter table public.stg_prerequisite enable row level security;
alter table public.stg_subject enable row level security;
alter table public.student_id_counter enable row level security;
alter table public.student_preference enable row level security;
alter table public.subject enable row level security;
alter table public.subject_offering enable row level security;
alter table public.system_administrator enable row level security;
alter table public.system_config enable row level security;
alter table public.system_log enable row level security;
alter table public.university_student enable row level security;
CREATE OR REPLACE FUNCTION public._audit_actor_role()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case
    when auth.uid() is null                                                   then 'system'
    when exists (select 1 from system_administrator where user_id = auth.uid()) then 'system_administrator'
    when exists (select 1 from registrar_staff      where user_id = auth.uid()) then 'registrar_staff'
    when exists (select 1 from department_staff     where user_id = auth.uid()) then 'department_staff'
    when exists (select 1 from faculty_staff        where user_id = auth.uid()) then 'faculty_staff'
    when exists (select 1 from university_student   where user_id = auth.uid()) then 'student'
    else 'unknown'
  end;
$function$
;
CREATE OR REPLACE FUNCTION public._fresh_student_account(p_user uuid, p_email text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
declare
  v_created timestamptz;
begin
  select u.created_at into v_created
  from auth.users u
  where u.id = p_user
    and lower(u.email) = lower(coalesce(p_email, ''));

  if v_created is null or v_created < now() - interval '15 minutes' then
    return false;
  end if;

  if exists (select 1 from public.faculty_staff   where user_id = p_user)
     or exists (select 1 from public.registrar_staff  where user_id = p_user)
     or exists (select 1 from public.department_staff where user_id = p_user)
     or exists (select 1 from public.system_administrator where user_id = p_user) then
    return false;
  end if;

  return true;
end;
$function$
;
CREATE OR REPLACE FUNCTION public._password_problem(p_password text, p_role text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
  select case
    when length(coalesce(p_password, '')) < (case when lower(trim(coalesce(p_role, ''))) = 'admin' then 12 else 8 end)
      then 'Password must be at least ' || (case when lower(trim(coalesce(p_role, ''))) = 'admin' then 12 else 8 end) || ' characters.'
    when length(p_password) > 72
      then 'Password must be at most 72 characters.'
    when p_password !~ '[^[:alnum:][:space:]]'
      then 'Password must include a special character, such as ! @ # $ or %.'
    else null
  end;
$function$
;
CREATE OR REPLACE FUNCTION public._provision_account(p_first_name text, p_last_name text, p_email text, p_password text, p_role text, p_employee_id text DEFAULT NULL::text, p_student_id text DEFAULT NULL::text, p_department text DEFAULT 'College of Computer Studies'::text, p_year_level text DEFAULT NULL::text, p_username text DEFAULT NULL::text, p_via text DEFAULT 'ADMIN_MANUAL'::text, p_program_code text DEFAULT 'BSIT'::text, p_declared_path text DEFAULT 'existing'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions'
AS $function$
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
$function$
;
CREATE OR REPLACE FUNCTION public.activate_prospectus(target_id integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    v_program integer;
begin
    if not exists (
        select 1 from department_staff
        where user_id = auth.uid() and is_approved
    ) then
        raise exception 'Only Department Staff can activate a curriculum version.'
            using errcode = '42501';
    end if;

    select program_id into v_program from prospectus where id = target_id;

    if v_program is null then
        raise exception 'No such prospectus version.' using errcode = '22023';
    end if;

    if v_program is distinct from public.my_department_program() then
        raise exception 'You can only activate a curriculum version of your own programme.'
            using errcode = '42501';
    end if;

    if not exists (select 1 from subject where prospectus_id = target_id) then
        raise exception 'That version has no subjects. A student placed on it '
                        'would have no curriculum to be assessed against.'
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
$function$
;
CREATE OR REPLACE FUNCTION public.audit_log_append_only()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  raise exception 'audit_log is append-only: % is not allowed', tg_op using errcode = '42501';
end;
$function$
;
CREATE OR REPLACE FUNCTION public.audit_row_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  skip     text[] := array['updated_at', 'created_at'] || string_to_array(coalesce(tg_argv[0], ''), ',');
  o        jsonb;
  n        jsonb;
  k        text;
  old_diff jsonb := '{}'::jsonb;
  new_diff jsonb := '{}'::jsonb;
  rid      text;
begin
  if tg_op = 'INSERT' then
    n   := to_jsonb(new) - skip;
    rid := coalesce(n->>'id', n->>'assignment_id');
    insert into audit_log (actor_id, actor_role, action, table_name, record_id, old_values, new_values)
    values (auth.uid(), public._audit_actor_role(), 'INSERT_' || upper(tg_table_name), tg_table_name, rid, null, n);

  elsif tg_op = 'UPDATE' then
    o := to_jsonb(old);
    n := to_jsonb(new);
    for k in select key from jsonb_each(n) loop
      if k = any (skip) then continue; end if;
      if o -> k is distinct from n -> k then
        old_diff := old_diff || jsonb_build_object(k, o -> k);
        new_diff := new_diff || jsonb_build_object(k, n -> k);
      end if;
    end loop;
    if new_diff = '{}'::jsonb then
      return null;                       -- only noise changed: nothing to record
    end if;
    rid := coalesce(n->>'id', n->>'assignment_id');
    insert into audit_log (actor_id, actor_role, action, table_name, record_id, old_values, new_values)
    values (auth.uid(), public._audit_actor_role(), 'UPDATE_' || upper(tg_table_name), tg_table_name, rid, old_diff, new_diff);

  else  -- DELETE
    o   := to_jsonb(old) - skip;
    rid := coalesce(o->>'id', o->>'assignment_id');
    insert into audit_log (actor_id, actor_role, action, table_name, record_id, old_values, new_values)
    values (auth.uid(), public._audit_actor_role(), 'DELETE_' || upper(tg_table_name), tg_table_name, rid, o, null);
  end if;

  return null;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.can_read_all_students()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select exists (select 1 from system_administrator where user_id = auth.uid() and is_approved); $function$
;
CREATE OR REPLACE FUNCTION public.can_read_program(p_program_id integer)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    select p_program_id is not null and (
        exists (select 1 from system_administrator where user_id = auth.uid() and is_approved)
        or exists (select 1 from university_student where user_id = auth.uid() and program_id = p_program_id)
        or exists (select 1 from faculty_staff    where user_id = auth.uid() and is_approved and program_id = p_program_id)
        or exists (select 1 from registrar_staff  where user_id = auth.uid() and is_approved and program_id = p_program_id)
        or exists (select 1 from department_staff where user_id = auth.uid() and is_approved and program_id = p_program_id)
    );
$function$
;
CREATE OR REPLACE FUNCTION public.can_read_prospectus(p_prospectus_id integer)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select exists (select 1 from prospectus where id = p_prospectus_id and can_read_program(program_id)); $function$
;
CREATE OR REPLACE FUNCTION public.can_read_subject(p_subject_id integer)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select exists (select 1 from subject where id = p_subject_id and can_read_prospectus(prospectus_id)); $function$
;
CREATE OR REPLACE FUNCTION public.can_see_student(p_student_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    select can_read_all_students()
        or is_adviser_of_student(p_student_id)
        or is_department_of_student(p_student_id)
        or is_registrar_of_student(p_student_id);
$function$
;
CREATE OR REPLACE FUNCTION public.cleanup_unused_data(p_dry_run boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
declare
  v_result  jsonb := '{}'::jsonb;
  v_n       integer;
  r         record;
begin
  -- a) Unconfirmed sign-ups older than 7 days (deleting the auth user also
  --    removes the pending student row through ON DELETE CASCADE).
  v_n := 0;
  for r in
    select u.id
    from auth.users u
    where u.email_confirmed_at is null
      and u.created_at < now() - interval '7 days'
      and not exists (select 1 from public.faculty_staff        f where f.user_id = u.id)
      and not exists (select 1 from public.registrar_staff      g where g.user_id = u.id)
      and not exists (select 1 from public.department_staff     d where d.user_id = u.id)
      and not exists (select 1 from public.system_administrator a where a.user_id = u.id)
      and not exists (select 1 from public.university_student   s where s.user_id = u.id and s.is_approved)
  loop
    if p_dry_run then
      v_n := v_n + 1;
    else
      begin
        delete from auth.users where id = r.id;
        v_n := v_n + 1;
      exception when foreign_key_violation then
        null;  -- it already has records: leave it for a person
      end;
    end if;
  end loop;
  v_result := v_result || jsonb_build_object('unconfirmed_signups', v_n);
  insert into public.maintenance_log(task, rows_found, dry_run) values ('unconfirmed_signups', v_n, p_dry_run);

  -- b) Read notifications older than 90 days.
  if p_dry_run then
    select count(*) into v_n from public.notification
     where is_read and created_at < now() - interval '90 days';
  else
    delete from public.notification
     where is_read and created_at < now() - interval '90 days';
    get diagnostics v_n = row_count;
  end if;
  v_result := v_result || jsonb_build_object('read_notifications', v_n);
  insert into public.maintenance_log(task, rows_found, dry_run) values ('read_notifications', v_n, p_dry_run);

  -- c) Advisor chat older than 6 months.
  if p_dry_run then
    select count(*) into v_n from public.ai_chat_message
     where created_at < now() - interval '6 months';
  else
    delete from public.ai_chat_message
     where created_at < now() - interval '6 months';
    get diagnostics v_n = row_count;
  end if;
  v_result := v_result || jsonb_build_object('ai_chat_message', v_n);
  insert into public.maintenance_log(task, rows_found, dry_run) values ('ai_chat_message', v_n, p_dry_run);

  -- d) Import staging rows older than 7 days.
  if p_dry_run then
    select count(*) into v_n from public.stg_subject
     where uploaded_at < now() - interval '7 days';
  else
    delete from public.stg_subject
     where uploaded_at < now() - interval '7 days';
    get diagnostics v_n = row_count;
  end if;
  v_result := v_result || jsonb_build_object('stg_subject', v_n);
  insert into public.maintenance_log(task, rows_found, dry_run) values ('stg_subject', v_n, p_dry_run);

  if p_dry_run then
    select count(*) into v_n from public.stg_prerequisite
     where uploaded_at < now() - interval '7 days';
  else
    delete from public.stg_prerequisite
     where uploaded_at < now() - interval '7 days';
    get diagnostics v_n = row_count;
  end if;
  v_result := v_result || jsonb_build_object('stg_prerequisite', v_n);
  insert into public.maintenance_log(task, rows_found, dry_run) values ('stg_prerequisite', v_n, p_dry_run);

  -- e) The log trims itself (keeps one year).
  if not p_dry_run then
    delete from public.maintenance_log where ran_at < now() - interval '1 year';
  end if;

  return v_result || jsonb_build_object('dry_run', p_dry_run);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.copy_prospectus(source_id integer, new_year integer, new_term integer DEFAULT NULL::integer, author uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;
CREATE OR REPLACE FUNCTION public.create_staff_account(p_first_name text, p_last_name text, p_email text, p_password text, p_employee_id text, p_role text, p_department text DEFAULT 'College of Computer Studies'::text, p_username text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions'
AS $function$
    select _provision_account(
        p_first_name, p_last_name, p_email, p_password, p_role,
        p_employee_id, null, p_department, null,
        p_username, 'ADMIN_MANUAL'
    );
$function$
;
CREATE OR REPLACE FUNCTION public.create_user_account(p_first_name text, p_last_name text, p_email text, p_password text, p_role text, p_employee_id text DEFAULT NULL::text, p_student_id text DEFAULT NULL::text, p_department text DEFAULT 'College of Computer Studies'::text, p_year_level text DEFAULT NULL::text, p_username text DEFAULT NULL::text, p_program_code text DEFAULT 'BSIT'::text, p_declared_path text DEFAULT 'existing'::text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions'
AS $function$
    select _provision_account(
        p_first_name, p_last_name, p_email, p_password, p_role,
        p_employee_id, p_student_id, p_department, p_year_level,
        p_username, 'ADMIN_BULK', p_program_code, p_declared_path
    );
$function$
;
CREATE OR REPLACE FUNCTION public.current_department_staff_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    select id from department_staff where user_id = auth.uid() limit 1;
$function$
;
CREATE OR REPLACE FUNCTION public.current_faculty_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    select id from faculty_staff where user_id = auth.uid() limit 1;
$function$
;
CREATE OR REPLACE FUNCTION public.current_registrar_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    select id from registrar_staff where user_id = auth.uid() limit 1;
$function$
;
CREATE OR REPLACE FUNCTION public.current_student_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    select id from university_student where user_id = auth.uid() limit 1;
$function$
;
CREATE OR REPLACE FUNCTION public.delete_draft_prospectus(target_id integer, confirm boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    p_record       RECORD;
    sub_ids        INT[];
    ai_ids         INT[];
    sub_count      INT := 0;
    prereq_count   INT := 0;
    eg_count       INT := 0;
    egm_count      INT := 0;
    ai_count       INT := 0;
    ri_count       INT := 0;
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
       OR public.my_department_program() IS NULL
       OR p_record.program_id IS DISTINCT FROM public.my_department_program() THEN
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

    SELECT ARRAY_AGG(id) INTO ai_ids FROM ai_recommendation WHERE prospectus_id = target_id;
    ai_count := COALESCE(array_length(ai_ids, 1), 0);
    IF ai_count > 0 THEN
        SELECT COUNT(*) INTO ri_count
          FROM recommendation_item WHERE recommendation_id = ANY(ai_ids);
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
            'elective_members',     egm_count,
            'ai_recommendations',   ai_count,
            'recommendation_items', ri_count
        );
    END IF;

    -- Cascade delete in FK-safe order.
    IF sub_count > 0 THEN
        DELETE FROM prerequisite
         WHERE subject_id = ANY(sub_ids)
            OR prerequisite_subject_id = ANY(sub_ids);
        DELETE FROM recommendation_item WHERE subject_id = ANY(sub_ids);
    END IF;

    IF ai_count > 0 THEN
        DELETE FROM ai_recommendation WHERE id = ANY(ai_ids);
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
        'elective_members',     egm_count,
        'ai_recommendations',   ai_count,
        'recommendation_items', ri_count
    );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.department_ids_for_my_registrar()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select id from department_staff where program_id = my_registrar_program(); $function$
;
CREATE OR REPLACE FUNCTION public.faculty_can_review_request(p_request_id integer, p_faculty_id uuid)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    select exists (
        select 1 from faculty_staff f
        where f.id = p_faculty_id and f.user_id = auth.uid() and f.is_approved
    )
    and public.is_adviser_of_request(p_request_id);
$function$
;
CREATE OR REPLACE FUNCTION public.faculty_can_transition_request(p_request_id integer)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    select public.is_adviser_of_request(p_request_id);
$function$
;
CREATE OR REPLACE FUNCTION public.faculty_can_update_request_item(p_request_id integer, p_faculty_id uuid)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    select exists (
        select 1 from faculty_staff f
        where f.id = p_faculty_id and f.user_id = auth.uid() and f.is_approved
    )
    and public.is_adviser_of_request(p_request_id);
$function$
;
CREATE OR REPLACE FUNCTION public.is_adviser_of_request(p_request_id integer)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    select exists (
        select 1
        from request r
        where r.id = p_request_id
          and public.is_adviser_of_student(r.student_id)
    );
$function$
;
CREATE OR REPLACE FUNCTION public.is_adviser_of_student(p_student_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    select exists (
        select 1
        from university_student s
        join faculty_staff f on f.program_id = s.program_id
        where s.id = p_student_id
          and f.user_id = auth.uid()
          and f.is_approved
    );
$function$
;
CREATE OR REPLACE FUNCTION public.is_approved_staff()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    select
        exists (select 1 from faculty_staff        where user_id = auth.uid() and is_approved)
     or exists (select 1 from registrar_staff      where user_id = auth.uid() and is_approved)
     or exists (select 1 from department_staff     where user_id = auth.uid() and is_approved)
     or exists (select 1 from system_administrator where user_id = auth.uid() and is_approved);
$function$
;
CREATE OR REPLACE FUNCTION public.is_department_of_student(p_student_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select exists (select 1 from university_student s where s.id = p_student_id and s.program_id is not null and s.program_id = my_department_program()); $function$
;
CREATE OR REPLACE FUNCTION public.is_registrar_of_student(p_student_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    select exists (
        select 1 from registrar_staff r, university_student s
        where r.user_id = auth.uid() and r.is_approved
          and s.id = p_student_id
          and (s.program_id is null or s.program_id = r.program_id)
    );
$function$
;
CREATE OR REPLACE FUNCTION public.is_system_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from system_administrator
    where user_id = auth.uid()
      and is_approved
  );
$function$
;
CREATE OR REPLACE FUNCTION public.my_department_program()
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select program_id from department_staff where user_id = auth.uid() and is_approved limit 1; $function$
;
CREATE OR REPLACE FUNCTION public.my_department_staff_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select id from department_staff where user_id = auth.uid() and is_approved limit 1; $function$
;
CREATE OR REPLACE FUNCTION public.my_registrar_program()
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select program_id from registrar_staff where user_id = auth.uid() and is_approved limit 1; $function$
;
CREATE OR REPLACE FUNCTION public.next_staff_employee_id()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;
CREATE OR REPLACE FUNCTION public.next_student_id()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;
CREATE OR REPLACE FUNCTION public.resolve_login_identifier(identifier text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

    -- uc-1234567 only. The hyphen is required: UC2401187 without it is
    -- one keystroke away from a bare ID, and accepting both reintroduces
    -- the ambiguity the prefix exists to remove.
    if cleaned ~ '^UC-[0-9]+$' then
        digits := regexp_replace(cleaned, '^UC-', '');
        digits := lpad(digits, 7, '0');

        select email into found
        from university_student
        where student_id = digits
        limit 1;

        return found;
    end if;

    -- EMP-00871, across the three staff tables. Administrators are NOT
    -- reachable by ID: the admin signs in by email only.
    if cleaned ~ '^EMP-[A-Z0-9]+$' then
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
    -- bare 7-digit number from being treated as a student ID.
    return null;
end;
$function$
;
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

    if v_program is distinct from public.my_department_program() then
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
$function$
;
CREATE OR REPLACE FUNCTION public.staff_employee_id_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;
CREATE OR REPLACE FUNCTION public.student_id_on_approve()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;
CREATE OR REPLACE FUNCTION public.student_id_on_register()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
    if new.is_approved is not true and new.declared_path = 'new' then
        new.student_id := null;
    end if;
    return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.student_register_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  -- Admin / definer functions (_provision_account) run as the owner: leave them alone.
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  -- Only plain pending requests, with nothing a reviewer would fill in.
  if new.approval_status is distinct from 'pending'
     or new.is_approved is distinct from false
     or new.record_verified is distinct from false
     or new.reviewed_by is not null or new.reviewed_at is not null or new.review_note is not null
     or new.verified_by is not null or new.verified_at is not null
     or new.created_by is not null
     or new.prospectus_id is not null
     or new.year_level is not null
     or new.must_change_password is distinct from false
     or new.academic_standing is distinct from 'regular'
     or new.created_via is distinct from 'SELF_REGISTER'
     or new.declared_path is null or new.declared_path not in ('new', 'existing') then
    raise exception 'Invalid registration request' using errcode = '42501';
  end if;

  -- Size limits (same as the form's maxlength).
  if char_length(coalesce(new.first_name, '')) > 60
     or char_length(coalesce(new.last_name, '')) > 60
     or char_length(coalesce(new.email, '')) > 254
     or char_length(coalesce(new.phone, '')) > 30 then
    raise exception 'Invalid registration request' using errcode = '22001';
  end if;

  -- The program, when given, must exist.
  if new.program_id is not null
     and not exists (select 1 from public.program p where p.id = new.program_id) then
    -- (anon can read program since db/026)
    raise exception 'Invalid registration request' using errcode = '23503';
  end if;

  -- The auth user must be brand new (created in the last 15 minutes), carry the
  -- same email, and not already be a staff/admin account. This stops anyone
  -- attaching a student row to somebody else's existing account.
  if not public._fresh_student_account(new.user_id, new.email) then
    raise exception 'Invalid registration request' using errcode = '42501';
  end if;

  return new;
end;
$function$
;
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
    if v_program is distinct from public.my_department_program() then
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
$function$
;
revoke all on function public._audit_actor_role() from public, anon, authenticated, service_role; grant execute on function public._audit_actor_role() to service_role;
revoke all on function public._fresh_student_account(p_user uuid, p_email text) from public, anon, authenticated, service_role; grant execute on function public._fresh_student_account(p_user uuid, p_email text) to anon; grant execute on function public._fresh_student_account(p_user uuid, p_email text) to authenticated; grant execute on function public._fresh_student_account(p_user uuid, p_email text) to service_role;
revoke all on function public._password_problem(p_password text, p_role text) from public, anon, authenticated, service_role; grant execute on function public._password_problem(p_password text, p_role text) to service_role;
revoke all on function public._provision_account(p_first_name text, p_last_name text, p_email text, p_password text, p_role text, p_employee_id text, p_student_id text, p_department text, p_year_level text, p_username text, p_via text, p_program_code text, p_declared_path text) from public, anon, authenticated, service_role; grant execute on function public._provision_account(p_first_name text, p_last_name text, p_email text, p_password text, p_role text, p_employee_id text, p_student_id text, p_department text, p_year_level text, p_username text, p_via text, p_program_code text, p_declared_path text) to authenticated; grant execute on function public._provision_account(p_first_name text, p_last_name text, p_email text, p_password text, p_role text, p_employee_id text, p_student_id text, p_department text, p_year_level text, p_username text, p_via text, p_program_code text, p_declared_path text) to service_role;
revoke all on function public.activate_prospectus(target_id integer) from public, anon, authenticated, service_role; grant execute on function public.activate_prospectus(target_id integer) to authenticated; grant execute on function public.activate_prospectus(target_id integer) to service_role;
revoke all on function public.audit_log_append_only() from public, anon, authenticated, service_role; grant execute on function public.audit_log_append_only() to service_role;
revoke all on function public.audit_row_change() from public, anon, authenticated, service_role; grant execute on function public.audit_row_change() to service_role;
revoke all on function public.can_read_all_students() from public, anon, authenticated, service_role; grant execute on function public.can_read_all_students() to authenticated; grant execute on function public.can_read_all_students() to service_role;
revoke all on function public.can_read_program(p_program_id integer) from public, anon, authenticated, service_role; grant execute on function public.can_read_program(p_program_id integer) to authenticated; grant execute on function public.can_read_program(p_program_id integer) to service_role;
revoke all on function public.can_read_prospectus(p_prospectus_id integer) from public, anon, authenticated, service_role; grant execute on function public.can_read_prospectus(p_prospectus_id integer) to authenticated; grant execute on function public.can_read_prospectus(p_prospectus_id integer) to service_role;
revoke all on function public.can_read_subject(p_subject_id integer) from public, anon, authenticated, service_role; grant execute on function public.can_read_subject(p_subject_id integer) to authenticated; grant execute on function public.can_read_subject(p_subject_id integer) to service_role;
revoke all on function public.can_see_student(p_student_id uuid) from public, anon, authenticated, service_role; grant execute on function public.can_see_student(p_student_id uuid) to authenticated; grant execute on function public.can_see_student(p_student_id uuid) to service_role;
revoke all on function public.cleanup_unused_data(p_dry_run boolean) from public, anon, authenticated, service_role; grant execute on function public.cleanup_unused_data(p_dry_run boolean) to service_role;
revoke all on function public.copy_prospectus(source_id integer, new_year integer, new_term integer, author uuid) from public, anon, authenticated, service_role; grant execute on function public.copy_prospectus(source_id integer, new_year integer, new_term integer, author uuid) to authenticated; grant execute on function public.copy_prospectus(source_id integer, new_year integer, new_term integer, author uuid) to service_role;
revoke all on function public.create_staff_account(p_first_name text, p_last_name text, p_email text, p_password text, p_employee_id text, p_role text, p_department text, p_username text) from public, anon, authenticated, service_role; grant execute on function public.create_staff_account(p_first_name text, p_last_name text, p_email text, p_password text, p_employee_id text, p_role text, p_department text, p_username text) to authenticated; grant execute on function public.create_staff_account(p_first_name text, p_last_name text, p_email text, p_password text, p_employee_id text, p_role text, p_department text, p_username text) to service_role;
revoke all on function public.create_user_account(p_first_name text, p_last_name text, p_email text, p_password text, p_role text, p_employee_id text, p_student_id text, p_department text, p_year_level text, p_username text, p_program_code text, p_declared_path text) from public, anon, authenticated, service_role; grant execute on function public.create_user_account(p_first_name text, p_last_name text, p_email text, p_password text, p_role text, p_employee_id text, p_student_id text, p_department text, p_year_level text, p_username text, p_program_code text, p_declared_path text) to authenticated; grant execute on function public.create_user_account(p_first_name text, p_last_name text, p_email text, p_password text, p_role text, p_employee_id text, p_student_id text, p_department text, p_year_level text, p_username text, p_program_code text, p_declared_path text) to service_role;
revoke all on function public.current_department_staff_id() from public, anon, authenticated, service_role; grant execute on function public.current_department_staff_id() to authenticated; grant execute on function public.current_department_staff_id() to service_role;
revoke all on function public.current_faculty_id() from public, anon, authenticated, service_role; grant execute on function public.current_faculty_id() to authenticated; grant execute on function public.current_faculty_id() to service_role;
revoke all on function public.current_registrar_id() from public, anon, authenticated, service_role; grant execute on function public.current_registrar_id() to authenticated; grant execute on function public.current_registrar_id() to service_role;
revoke all on function public.current_student_id() from public, anon, authenticated, service_role; grant execute on function public.current_student_id() to authenticated; grant execute on function public.current_student_id() to service_role;
revoke all on function public.delete_draft_prospectus(target_id integer, confirm boolean) from public, anon, authenticated, service_role; grant execute on function public.delete_draft_prospectus(target_id integer, confirm boolean) to authenticated; grant execute on function public.delete_draft_prospectus(target_id integer, confirm boolean) to service_role;
revoke all on function public.department_ids_for_my_registrar() from public, anon, authenticated, service_role; grant execute on function public.department_ids_for_my_registrar() to authenticated; grant execute on function public.department_ids_for_my_registrar() to service_role;
revoke all on function public.faculty_can_review_request(p_request_id integer, p_faculty_id uuid) from public, anon, authenticated, service_role; grant execute on function public.faculty_can_review_request(p_request_id integer, p_faculty_id uuid) to authenticated; grant execute on function public.faculty_can_review_request(p_request_id integer, p_faculty_id uuid) to service_role;
revoke all on function public.faculty_can_transition_request(p_request_id integer) from public, anon, authenticated, service_role; grant execute on function public.faculty_can_transition_request(p_request_id integer) to authenticated; grant execute on function public.faculty_can_transition_request(p_request_id integer) to service_role;
revoke all on function public.faculty_can_update_request_item(p_request_id integer, p_faculty_id uuid) from public, anon, authenticated, service_role; grant execute on function public.faculty_can_update_request_item(p_request_id integer, p_faculty_id uuid) to authenticated; grant execute on function public.faculty_can_update_request_item(p_request_id integer, p_faculty_id uuid) to service_role;
revoke all on function public.is_adviser_of_request(p_request_id integer) from public, anon, authenticated, service_role; grant execute on function public.is_adviser_of_request(p_request_id integer) to authenticated; grant execute on function public.is_adviser_of_request(p_request_id integer) to service_role;
revoke all on function public.is_adviser_of_student(p_student_id uuid) from public, anon, authenticated, service_role; grant execute on function public.is_adviser_of_student(p_student_id uuid) to authenticated; grant execute on function public.is_adviser_of_student(p_student_id uuid) to service_role;
revoke all on function public.is_approved_staff() from public, anon, authenticated, service_role; grant execute on function public.is_approved_staff() to authenticated; grant execute on function public.is_approved_staff() to service_role;
revoke all on function public.is_department_of_student(p_student_id uuid) from public, anon, authenticated, service_role; grant execute on function public.is_department_of_student(p_student_id uuid) to authenticated; grant execute on function public.is_department_of_student(p_student_id uuid) to service_role;
revoke all on function public.is_registrar_of_student(p_student_id uuid) from public, anon, authenticated, service_role; grant execute on function public.is_registrar_of_student(p_student_id uuid) to authenticated; grant execute on function public.is_registrar_of_student(p_student_id uuid) to service_role;
revoke all on function public.is_system_admin() from public, anon, authenticated, service_role; grant execute on function public.is_system_admin() to authenticated; grant execute on function public.is_system_admin() to service_role;
revoke all on function public.my_department_program() from public, anon, authenticated, service_role; grant execute on function public.my_department_program() to authenticated; grant execute on function public.my_department_program() to service_role;
revoke all on function public.my_department_staff_id() from public, anon, authenticated, service_role; grant execute on function public.my_department_staff_id() to authenticated; grant execute on function public.my_department_staff_id() to service_role;
revoke all on function public.my_registrar_program() from public, anon, authenticated, service_role; grant execute on function public.my_registrar_program() to authenticated; grant execute on function public.my_registrar_program() to service_role;
revoke all on function public.next_staff_employee_id() from public, anon, authenticated, service_role; grant execute on function public.next_staff_employee_id() to service_role;
revoke all on function public.next_student_id() from public, anon, authenticated, service_role; grant execute on function public.next_student_id() to service_role;
revoke all on function public.resolve_login_identifier(identifier text) from public, anon, authenticated, service_role; grant execute on function public.resolve_login_identifier(identifier text) to service_role;
revoke all on function public.retire_subject(target_id integer, restore boolean, confirm boolean) from public, anon, authenticated, service_role; grant execute on function public.retire_subject(target_id integer, restore boolean, confirm boolean) to authenticated; grant execute on function public.retire_subject(target_id integer, restore boolean, confirm boolean) to service_role;
revoke all on function public.staff_employee_id_guard() from public, anon, authenticated, service_role; grant execute on function public.staff_employee_id_guard() to service_role;
revoke all on function public.student_id_on_approve() from public, anon, authenticated, service_role; grant execute on function public.student_id_on_approve() to service_role;
revoke all on function public.student_id_on_register() from public, anon, authenticated, service_role; grant execute on function public.student_id_on_register() to service_role;
revoke all on function public.student_register_guard() from public, anon, authenticated, service_role; grant execute on function public.student_register_guard() to service_role;
revoke all on function public.update_subject(target_id integer, p_code text, p_title text, p_lec numeric, p_lab numeric, p_year integer, p_term integer, p_category text) from public, anon, authenticated, service_role; grant execute on function public.update_subject(target_id integer, p_code text, p_title text, p_lec numeric, p_lab numeric, p_year integer, p_term integer, p_category text) to authenticated; grant execute on function public.update_subject(target_id integer, p_code text, p_title text, p_lec numeric, p_lab numeric, p_year integer, p_term integer, p_category text) to service_role;
CREATE TRIGGER audit_advisee_assignment AFTER INSERT OR DELETE OR UPDATE ON public.advisee_assignment FOR EACH ROW EXECUTE FUNCTION audit_row_change();
CREATE TRIGGER audit_log_no_change BEFORE DELETE OR UPDATE ON public.audit_log FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON public.audit_log FOR EACH STATEMENT EXECUTE FUNCTION audit_log_append_only();
CREATE TRIGGER audit_department_staff AFTER DELETE OR UPDATE ON public.department_staff FOR EACH ROW EXECUTE FUNCTION audit_row_change('avatar_url');
CREATE TRIGGER staff_employee_id_guard BEFORE INSERT OR UPDATE OF employee_id ON public.department_staff FOR EACH ROW EXECUTE FUNCTION staff_employee_id_guard();
CREATE TRIGGER audit_faculty_staff AFTER DELETE OR UPDATE ON public.faculty_staff FOR EACH ROW EXECUTE FUNCTION audit_row_change('avatar_url');
CREATE TRIGGER staff_employee_id_guard BEFORE INSERT OR UPDATE OF employee_id ON public.faculty_staff FOR EACH ROW EXECUTE FUNCTION staff_employee_id_guard();
CREATE TRIGGER audit_program AFTER INSERT OR DELETE OR UPDATE ON public.program FOR EACH ROW EXECUTE FUNCTION audit_row_change();
CREATE TRIGGER audit_prospectus AFTER INSERT OR DELETE OR UPDATE ON public.prospectus FOR EACH ROW EXECUTE FUNCTION audit_row_change();
CREATE TRIGGER audit_registrar_staff AFTER DELETE OR UPDATE ON public.registrar_staff FOR EACH ROW EXECUTE FUNCTION audit_row_change('avatar_url');
CREATE TRIGGER staff_employee_id_guard BEFORE INSERT OR UPDATE OF employee_id ON public.registrar_staff FOR EACH ROW EXECUTE FUNCTION staff_employee_id_guard();
CREATE TRIGGER audit_system_administrator AFTER DELETE OR UPDATE ON public.system_administrator FOR EACH ROW EXECUTE FUNCTION audit_row_change('avatar_url');
CREATE TRIGGER audit_system_config AFTER INSERT OR DELETE OR UPDATE ON public.system_config FOR EACH ROW EXECUTE FUNCTION audit_row_change();
CREATE TRIGGER student_register_guard BEFORE INSERT ON public.university_student FOR EACH ROW EXECUTE FUNCTION student_register_guard();
CREATE TRIGGER audit_university_student_update AFTER UPDATE ON public.university_student FOR EACH ROW EXECUTE FUNCTION audit_row_change('avatar_url');
CREATE TRIGGER audit_university_student_delete AFTER DELETE ON public.university_student FOR EACH ROW WHEN (old.is_approved) EXECUTE FUNCTION audit_row_change('avatar_url');
CREATE TRIGGER student_id_on_register BEFORE INSERT ON public.university_student FOR EACH ROW EXECUTE FUNCTION student_id_on_register();
CREATE TRIGGER student_id_on_approve BEFORE UPDATE ON public.university_student FOR EACH ROW EXECUTE FUNCTION student_id_on_approve();
create policy department_writes_records on public.academic_record as permissive for all to authenticated using (is_department_of_student(student_id)) with check (is_department_of_student(student_id));
create policy students_read_own_records on public.academic_record as permissive for select to authenticated using ((student_id = current_student_id()));
create policy students_insert_own_records on public.academic_record as permissive for insert to authenticated with check ((student_id = current_student_id()));
create policy students_delete_own_records on public.academic_record as permissive for delete to authenticated using ((student_id = current_student_id()));
create policy "staff read own-programme records" on public.academic_record as permissive for select to authenticated using (can_see_student(student_id));
create policy students_update_own_records on public.academic_record as permissive for update to authenticated using ((student_id = current_student_id())) with check ((student_id = current_student_id()));
create policy "staff read assignments" on public.advisee_assignment as permissive for select to authenticated using (can_see_student(student_id));
create policy "registrar manages advisee assignments" on public.advisee_assignment as permissive for all to authenticated using (is_registrar_of_student(student_id)) with check (is_registrar_of_student(student_id));
create policy "students insert own chat" on public.ai_chat_message as permissive for insert to authenticated with check ((student_id = current_student_id()));
create policy "students read own chat" on public.ai_chat_message as permissive for select to authenticated using ((student_id = current_student_id()));
create policy staff_read_all_recommendations on public.ai_recommendation as permissive for select to authenticated using (can_see_student(student_id));
create policy students_read_own_recommendations on public.ai_recommendation as permissive for select to authenticated using ((student_id = current_student_id()));
create policy admin_reads_audit_log on public.audit_log as permissive for select to authenticated using (is_system_admin());
create policy admin_writes_bulk_history on public.bulk_upload_history as permissive for insert to authenticated with check (is_system_admin());
create policy admin_reads_bulk_history on public.bulk_upload_history as permissive for select to authenticated using (is_system_admin());
create policy "department updates own profile fields" on public.department_staff as permissive for update to authenticated using ((auth.uid() = user_id)) with check ((auth.uid() = user_id));
create policy admin_read_department on public.department_staff as permissive for select to authenticated using (is_system_admin());
create policy admin_update_department on public.department_staff as permissive for update to authenticated using (is_system_admin()) with check (is_system_admin());
create policy "department reads own row" on public.department_staff as permissive for select to authenticated using ((auth.uid() = user_id));
create policy "department updates own row" on public.department_staff as permissive for update to authenticated using ((auth.uid() = user_id)) with check ((auth.uid() = user_id));
create policy elective_groups_readable on public.elective_group as permissive for select to authenticated using (can_read_prospectus(prospectus_id));
create policy department_manage_elective_groups on public.elective_group as permissive for all to authenticated using ((prospectus_id IN ( SELECT prospectus.id
   FROM prospectus
  WHERE (prospectus.program_id = my_department_program())))) with check ((prospectus_id IN ( SELECT prospectus.id
   FROM prospectus
  WHERE (prospectus.program_id = my_department_program()))));
create policy department_manage_elective_members on public.elective_group_member as permissive for all to authenticated using ((elective_group_id IN ( SELECT g.id
   FROM (elective_group g
     JOIN prospectus p ON ((p.id = g.prospectus_id)))
  WHERE (p.program_id = my_department_program())))) with check ((elective_group_id IN ( SELECT g.id
   FROM (elective_group g
     JOIN prospectus p ON ((p.id = g.prospectus_id)))
  WHERE (p.program_id = my_department_program()))));
create policy elective_members_readable on public.elective_group_member as permissive for select to authenticated using (can_read_subject(subject_id));
create policy admin_read_enrollment on public.enrollment as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM system_administrator
  WHERE (system_administrator.user_id = auth.uid()))));
create policy faculty_read_enrollment on public.enrollment as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM faculty_staff
  WHERE ((faculty_staff.user_id = auth.uid()) AND faculty_staff.is_approved))));
create policy registrar_manage_enrollment on public.enrollment as permissive for all to authenticated using (is_registrar_of_student(student_id)) with check (is_registrar_of_student(student_id));
create policy student_read_own_enrollment on public.enrollment as permissive for select to authenticated using ((student_id = current_student_id()));
create policy student_read_own_enrollment_item on public.enrollment_item as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM enrollment e
  WHERE ((e.id = enrollment_item.enrollment_id) AND (e.student_id = current_student_id())))));
create policy admin_read_enrollment_item on public.enrollment_item as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM system_administrator
  WHERE (system_administrator.user_id = auth.uid()))));
create policy registrar_manage_enrollment_item on public.enrollment_item as permissive for all to authenticated using ((EXISTS ( SELECT 1
   FROM enrollment e
  WHERE ((e.id = enrollment_item.enrollment_id) AND is_registrar_of_student(e.student_id))))) with check ((EXISTS ( SELECT 1
   FROM enrollment e
  WHERE ((e.id = enrollment_item.enrollment_id) AND is_registrar_of_student(e.student_id)))));
create policy faculty_read_enrollment_item on public.enrollment_item as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM faculty_staff
  WHERE ((faculty_staff.user_id = auth.uid()) AND faculty_staff.is_approved))));
create policy admin_read_faculty on public.faculty_staff as permissive for select to authenticated using (is_system_admin());
create policy admin_update_faculty on public.faculty_staff as permissive for update to authenticated using (is_system_admin()) with check (is_system_admin());
create policy "faculty reads own row" on public.faculty_staff as permissive for select to authenticated using ((auth.uid() = user_id));
create policy "registrar reads faculty" on public.faculty_staff as permissive for select to authenticated using (((program_id IS NOT NULL) AND (program_id = my_registrar_program())));
create policy department_manage_grade_files on public.grade_file as permissive for all to authenticated using ((uploaded_by = my_department_staff_id())) with check ((uploaded_by = my_department_staff_id()));
create policy registrar_reads_grade_files on public.grade_file as permissive for select to authenticated using ((uploaded_by IN ( SELECT department_ids_for_my_registrar() AS department_ids_for_my_registrar)));
create policy department_manage_grade_rows on public.grade_file_row as permissive for all to authenticated using ((grade_file_id IN ( SELECT grade_file.id
   FROM grade_file
  WHERE (grade_file.uploaded_by = my_department_staff_id())))) with check ((grade_file_id IN ( SELECT grade_file.id
   FROM grade_file
  WHERE (grade_file.uploaded_by = my_department_staff_id()))));
create policy registrar_reads_grade_rows on public.grade_file_row as permissive for select to authenticated using ((grade_file_id IN ( SELECT grade_file.id
   FROM grade_file
  WHERE (grade_file.uploaded_by IN ( SELECT department_ids_for_my_registrar() AS department_ids_for_my_registrar)))));
create policy maintenance_log_admin_read on public.maintenance_log as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM system_administrator a
  WHERE (a.user_id = auth.uid()))));
create policy students_read_own_notifications on public.notification as permissive for select to authenticated using ((user_id = auth.uid()));
create policy "faculty notify advisees" on public.notification as permissive for insert to authenticated with check ((EXISTS ( SELECT 1
   FROM (((request r
     JOIN advisee_assignment a ON ((a.student_id = r.student_id)))
     JOIN faculty_staff f ON ((f.id = a.faculty_id)))
     JOIN university_student us ON ((us.id = r.student_id)))
  WHERE ((r.id = notification.related_request_id) AND (us.user_id = notification.user_id) AND (f.user_id = auth.uid()) AND a.is_active AND f.is_approved))));
create policy students_update_own_notifications on public.notification as permissive for update to authenticated using ((user_id = auth.uid())) with check ((user_id = auth.uid()));
create policy "registrar notify on advising decision" on public.notification as permissive for insert to authenticated with check (((EXISTS ( SELECT 1
   FROM (request r
     JOIN university_student us ON ((us.id = r.student_id)))
  WHERE ((r.id = notification.related_request_id) AND (us.user_id = notification.user_id)))) AND (EXISTS ( SELECT 1
   FROM registrar_staff rs
  WHERE ((rs.user_id = auth.uid()) AND rs.is_approved)))));
create policy prerequisites_readable on public.prerequisite as permissive for select to authenticated using (can_read_subject(subject_id));
create policy department_manage_prerequisites on public.prerequisite as permissive for all to authenticated using ((subject_id IN ( SELECT s.id
   FROM (subject s
     JOIN prospectus p ON ((p.id = s.prospectus_id)))
  WHERE (p.program_id = my_department_program())))) with check ((subject_id IN ( SELECT s.id
   FROM (subject s
     JOIN prospectus p ON ((p.id = s.prospectus_id)))
  WHERE (p.program_id = my_department_program()))));
create policy "read programs" on public.program as permissive for select to authenticated using (true);
create policy "admin creates programs" on public.program as permissive for insert to authenticated with check (is_system_admin());
create policy "programs readable before sign-in" on public.program as permissive for select to anon using (true);
create policy "admin updates programs" on public.program as permissive for update to authenticated using (is_system_admin()) with check (is_system_admin());
create policy prospectus_readable on public.prospectus as permissive for select to authenticated using (can_read_program(program_id));
create policy department_manage_prospectus on public.prospectus as permissive for all to authenticated using ((program_id = my_department_program())) with check ((program_id = my_department_program()));
create policy "registrar reads own row" on public.registrar_staff as permissive for select to authenticated using ((auth.uid() = user_id));
create policy admin_read_registrar on public.registrar_staff as permissive for select to authenticated using (is_system_admin());
create policy admin_update_registrar on public.registrar_staff as permissive for update to authenticated using (is_system_admin()) with check (is_system_admin());
create policy students_create_own_requests on public.request as permissive for insert to authenticated with check ((student_id = current_student_id()));
create policy students_read_own_requests on public.request as permissive for select to authenticated using ((student_id = current_student_id()));
create policy registrar_update_requests on public.request as permissive for update to authenticated using (is_registrar_of_student(student_id)) with check (is_registrar_of_student(student_id));
create policy registrar_read_all_requests on public.request as permissive for select to authenticated using (is_registrar_of_student(student_id));
create policy "faculty update own advisee requests" on public.request as permissive for update to authenticated using (faculty_can_transition_request(id)) with check (faculty_can_transition_request(id));
create policy "faculty read advisee requests" on public.request as permissive for select to authenticated using (is_adviser_of_student(student_id));
create policy "department reads approved enrollment requests" on public.request as permissive for select to authenticated using ((((status)::text = ANY ((ARRAY['approved'::character varying, 'partially_approved'::character varying])::text[])) AND (registrar_status IS DISTINCT FROM 'rejected'::text) AND is_department_of_student(student_id)));
create policy "students read own request items" on public.request_item as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM (request r
     JOIN university_student s ON ((s.id = r.student_id)))
  WHERE ((r.id = request_item.request_id) AND (s.user_id = auth.uid())))));
create policy registrar_read_all_request_items on public.request_item as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM request r
  WHERE ((r.id = request_item.request_id) AND is_registrar_of_student(r.student_id)))));
create policy "students insert own request items" on public.request_item as permissive for insert to authenticated with check ((EXISTS ( SELECT 1
   FROM (request r
     JOIN university_student s ON ((s.id = r.student_id)))
  WHERE ((r.id = request_item.request_id) AND (s.user_id = auth.uid())))));
create policy "faculty update advisee request items" on public.request_item as permissive for update to authenticated using (faculty_can_update_request_item(request_id, ( SELECT faculty_staff.id
   FROM faculty_staff
  WHERE (faculty_staff.user_id = auth.uid())
 LIMIT 1))) with check (faculty_can_update_request_item(request_id, ( SELECT faculty_staff.id
   FROM faculty_staff
  WHERE (faculty_staff.user_id = auth.uid())
 LIMIT 1)));
create policy "faculty read advisee request items" on public.request_item as permissive for select to authenticated using (is_adviser_of_request(request_id));
create policy "department reads approved enrollment items" on public.request_item as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM request r
  WHERE ((r.id = request_item.request_id) AND ((r.status)::text = ANY ((ARRAY['approved'::character varying, 'partially_approved'::character varying])::text[])) AND (r.registrar_status IS DISTINCT FROM 'rejected'::text) AND is_department_of_student(r.student_id)))));
create policy "faculty read own reviews" on public.request_review as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM faculty_staff f
  WHERE ((f.id = request_review.faculty_id) AND (f.user_id = auth.uid())))));
create policy "students read own request review" on public.request_review as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM (request r
     JOIN university_student s ON ((s.id = r.student_id)))
  WHERE ((r.id = request_review.request_id) AND (s.user_id = auth.uid())))));
create policy "registrar reads all reviews" on public.request_review as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM request r
  WHERE ((r.id = request_review.request_id) AND is_registrar_of_student(r.student_id)))));
create policy "faculty insert review for own advisees" on public.request_review as permissive for insert to authenticated with check (faculty_can_review_request(request_id, faculty_id));
create policy "faculty update own review" on public.request_review as permissive for update to authenticated using ((EXISTS ( SELECT 1
   FROM faculty_staff f
  WHERE ((f.id = request_review.faculty_id) AND (f.user_id = auth.uid())))));
create policy sections_readable on public.section as permissive for select to authenticated using (can_read_program(program_id));
create policy department_manage_sections on public.section as permissive for all to authenticated using ((program_id = my_department_program())) with check ((program_id = my_department_program()));
create policy admin_reads_stg_prerequisite on public.stg_prerequisite as permissive for select to authenticated using (is_system_admin());
create policy department_stages_prerequisites on public.stg_prerequisite as permissive for all to authenticated using (((uploaded_by = auth.uid()) AND (EXISTS ( SELECT 1
   FROM department_staff
  WHERE ((department_staff.user_id = auth.uid()) AND department_staff.is_approved))))) with check (((uploaded_by = auth.uid()) AND (EXISTS ( SELECT 1
   FROM department_staff
  WHERE ((department_staff.user_id = auth.uid()) AND department_staff.is_approved)))));
create policy department_stages_subjects on public.stg_subject as permissive for all to authenticated using (((uploaded_by = auth.uid()) AND (EXISTS ( SELECT 1
   FROM department_staff
  WHERE ((department_staff.user_id = auth.uid()) AND department_staff.is_approved))))) with check (((uploaded_by = auth.uid()) AND (EXISTS ( SELECT 1
   FROM department_staff
  WHERE ((department_staff.user_id = auth.uid()) AND department_staff.is_approved)))));
create policy admin_reads_stg_subject on public.stg_subject as permissive for select to authenticated using (is_system_admin());
create policy "student creates own preference" on public.student_preference as permissive for insert to authenticated with check ((EXISTS ( SELECT 1
   FROM university_student u
  WHERE ((u.id = student_preference.student_id) AND (u.user_id = auth.uid())))));
create policy "student changes own preference" on public.student_preference as permissive for update to authenticated using ((EXISTS ( SELECT 1
   FROM university_student u
  WHERE ((u.id = student_preference.student_id) AND (u.user_id = auth.uid()))))) with check ((EXISTS ( SELECT 1
   FROM university_student u
  WHERE ((u.id = student_preference.student_id) AND (u.user_id = auth.uid())))));
create policy "student reads own preference" on public.student_preference as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM university_student u
  WHERE ((u.id = student_preference.student_id) AND (u.user_id = auth.uid())))));
create policy department_manage_subjects on public.subject as permissive for all to authenticated using ((prospectus_id IN ( SELECT prospectus.id
   FROM prospectus
  WHERE (prospectus.program_id = my_department_program())))) with check ((prospectus_id IN ( SELECT prospectus.id
   FROM prospectus
  WHERE (prospectus.program_id = my_department_program()))));
create policy curriculum_readable on public.subject as permissive for select to authenticated using (can_read_prospectus(prospectus_id));
create policy offerings_readable on public.subject_offering as permissive for select to authenticated using (can_read_subject(subject_id));
create policy department_manage_offerings on public.subject_offering as permissive for all to authenticated using ((subject_id IN ( SELECT s.id
   FROM (subject s
     JOIN prospectus p ON ((p.id = s.prospectus_id)))
  WHERE (p.program_id = my_department_program())))) with check ((subject_id IN ( SELECT s.id
   FROM (subject s
     JOIN prospectus p ON ((p.id = s.prospectus_id)))
  WHERE (p.program_id = my_department_program()))));
create policy admin_update_administrators on public.system_administrator as permissive for update to authenticated using (is_system_admin()) with check (is_system_admin());
create policy "administrator reads own row" on public.system_administrator as permissive for select to authenticated using ((auth.uid() = user_id));
create policy admin_read_administrators on public.system_administrator as permissive for select to authenticated using (is_system_admin());
create policy "only system admin can update system_config" on public.system_config as permissive for update to authenticated using (is_system_admin()) with check (is_system_admin());
create policy "any authenticated user can read system_config" on public.system_config as permissive for select to authenticated using (true);
create policy "staff read own-programme students" on public.university_student as permissive for select to authenticated using (can_see_student(id));
create policy registrar_approves_students on public.university_student as permissive for update to authenticated using ((is_registrar_of_student(id) OR is_department_of_student(id))) with check ((is_registrar_of_student(id) OR is_department_of_student(id)));
create policy anon_can_request_account on public.university_student as permissive for insert to anon, authenticated with check (((is_approved = false) AND (record_verified = false)));
create policy admin_read_all on public.university_student as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM system_administrator
  WHERE (system_administrator.user_id = auth.uid()))));
create policy students_read_own_row on public.university_student as permissive for select to authenticated using ((user_id = auth.uid()));
revoke all on public.academic_record from anon, authenticated, service_role; grant DELETE, INSERT, SELECT, UPDATE on public.academic_record to authenticated; grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.academic_record to service_role;
revoke all on public.advisee_assignment from anon, authenticated, service_role; grant DELETE, INSERT, SELECT, UPDATE on public.advisee_assignment to authenticated; grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.advisee_assignment to service_role;
revoke all on public.ai_chat_message from anon, authenticated, service_role; grant DELETE, INSERT, SELECT, UPDATE on public.ai_chat_message to authenticated; grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.ai_chat_message to service_role;
revoke all on public.ai_recommendation from anon, authenticated, service_role; grant DELETE, INSERT, SELECT, UPDATE on public.ai_recommendation to authenticated; grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.ai_recommendation to service_role;
revoke all on public.audit_log from anon, authenticated, service_role; grant SELECT on public.audit_log to authenticated; grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.audit_log to service_role;
revoke all on public.bulk_upload_history from anon, authenticated, service_role; grant DELETE, INSERT, SELECT, UPDATE on public.bulk_upload_history to authenticated; grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.bulk_upload_history to service_role;
revoke all on public.department_staff from anon, authenticated, service_role; grant DELETE, INSERT, SELECT on public.department_staff to authenticated; grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.department_staff to service_role;
revoke all on public.elective_group from anon, authenticated, service_role; grant DELETE, INSERT, SELECT, UPDATE on public.elective_group to authenticated; grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.elective_group to service_role;
revoke all on public.elective_group_member from anon, authenticated, service_role; grant DELETE, INSERT, SELECT, UPDATE on public.elective_group_member to authenticated; grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.elective_group_member to service_role;
revoke all on public.enrollment from anon, authenticated, service_role; grant DELETE, INSERT, SELECT, UPDATE on public.enrollment to authenticated; grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.enrollment to service_role;
revoke all on public.enrollment_item from anon, authenticated, service_role; grant DELETE, INSERT, SELECT, UPDATE on public.enrollment_item to authenticated; grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.enrollment_item to service_role;
revoke all on public.faculty_staff from anon, authenticated, service_role; grant DELETE, INSERT, SELECT, UPDATE on public.faculty_staff to authenticated; grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.faculty_staff to service_role;
revoke all on public.grade_file from anon, authenticated, service_role; grant DELETE, INSERT, SELECT, UPDATE on public.grade_file to authenticated; grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.grade_file to service_role;
revoke all on public.grade_file_row from anon, authenticated, service_role; grant DELETE, INSERT, SELECT, UPDATE on public.grade_file_row to authenticated; grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.grade_file_row to service_role;
revoke all on public.maintenance_log from anon, authenticated, service_role; grant SELECT on public.maintenance_log to authenticated; grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.maintenance_log to service_role;
revoke all on public.notification from anon, authenticated, service_role; grant DELETE, INSERT, SELECT, UPDATE on public.notification to authenticated; grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.notification to service_role;
revoke all on public.prerequisite from anon, authenticated, service_role; grant DELETE, INSERT, SELECT, UPDATE on public.prerequisite to authenticated; grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.prerequisite to service_role;
revoke all on public.program from anon, authenticated, service_role; grant SELECT on public.program to anon; grant DELETE, INSERT, SELECT, UPDATE on public.program to authenticated; grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.program to service_role;
revoke all on public.prospectus from anon, authenticated, service_role; grant DELETE, INSERT, SELECT, UPDATE on public.prospectus to authenticated; grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.prospectus to service_role;
revoke all on public.recommendation_item from anon, authenticated, service_role; grant DELETE, INSERT, SELECT, UPDATE on public.recommendation_item to authenticated; grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.recommendation_item to service_role;
revoke all on public.registrar_staff from anon, authenticated, service_role; grant DELETE, INSERT, SELECT, UPDATE on public.registrar_staff to authenticated; grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.registrar_staff to service_role;
revoke all on public.request from anon, authenticated, service_role; grant DELETE, INSERT, SELECT, UPDATE on public.request to authenticated; grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.request to service_role;
revoke all on public.request_approval from anon, authenticated, service_role; grant DELETE, INSERT, SELECT, UPDATE on public.request_approval to authenticated; grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.request_approval to service_role;
revoke all on public.request_item from anon, authenticated, service_role; grant DELETE, INSERT, SELECT, UPDATE on public.request_item to authenticated; grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.request_item to service_role;
revoke all on public.request_review from anon, authenticated, service_role; grant DELETE, INSERT, SELECT, UPDATE on public.request_review to authenticated; grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.request_review to service_role;
revoke all on public.section from anon, authenticated, service_role; grant DELETE, INSERT, SELECT, UPDATE on public.section to authenticated; grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.section to service_role;
revoke all on public.stg_prerequisite from anon, authenticated, service_role; grant DELETE, INSERT, SELECT, UPDATE on public.stg_prerequisite to authenticated; grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.stg_prerequisite to service_role;
revoke all on public.stg_subject from anon, authenticated, service_role; grant DELETE, INSERT, SELECT, UPDATE on public.stg_subject to authenticated; grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.stg_subject to service_role;
revoke all on public.student_id_counter from anon, authenticated, service_role; grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.student_id_counter to service_role;
revoke all on public.student_preference from anon, authenticated, service_role; grant DELETE, INSERT, SELECT, UPDATE on public.student_preference to authenticated; grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.student_preference to service_role;
revoke all on public.subject from anon, authenticated, service_role; grant DELETE, INSERT, SELECT, UPDATE on public.subject to authenticated; grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.subject to service_role;
revoke all on public.subject_offering from anon, authenticated, service_role; grant DELETE, INSERT, SELECT, UPDATE on public.subject_offering to authenticated; grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.subject_offering to service_role;
revoke all on public.system_administrator from anon, authenticated, service_role; grant DELETE, INSERT, SELECT, UPDATE on public.system_administrator to authenticated; grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.system_administrator to service_role;
revoke all on public.system_config from anon, authenticated, service_role; grant DELETE, INSERT, SELECT, UPDATE on public.system_config to authenticated; grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.system_config to service_role;
revoke all on public.system_log from anon, authenticated, service_role; grant DELETE, INSERT, SELECT, UPDATE on public.system_log to authenticated; grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.system_log to service_role;
revoke all on public.university_student from anon, authenticated, service_role; grant INSERT on public.university_student to anon; grant DELETE, INSERT, SELECT, UPDATE on public.university_student to authenticated; grant DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE on public.university_student to service_role;
select cron.schedule('curriculogic-daily-cleanup', '0 19 * * *', 'select public.cleanup_unused_data(false);');
