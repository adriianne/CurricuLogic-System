-- data-reset.sql   (WRITTEN, NEVER RUN)
--
-- Clears the live DATA so the real programmes, subjects, sections and staff can be
-- loaded fresh. It keeps the structure (tables, policies, functions, migrations up
-- to 081), system_config (current term and year), the audit_log (append-only by
-- design), the Storage buckets and ONE administrator account.
--
-- IRREVERSIBLE. Read docs/DATA-RESET-RUNBOOK.md first. Needs the owner's explicit
-- yes and a backup. Do not run it from here on the strength of a general "go ahead".
--
-- HOW TO RUN (Supabase SQL editor)
--   1. Set the administrator to keep in the two places marked EDIT.
--   2. Run the whole file as it is: it ends in ROLLBACK and prints the row counts
--      that WOULD go. Check them against the runbook.
--   3. Only then change the last line from  rollback;  to  commit;  and run again.
--
-- Order matters: several created_by columns point at auth.users with no cascade, and
-- request / subject / prospectus rows point at each other, so dependants go first.

begin;

-- EDIT 1: the administrator account that stays (its e-mail).
create temp table keep_admin on commit drop as
select user_id from public.system_administrator where email = 'REPLACE-WITH-ADMIN-EMAIL';

do $$
begin
  if (select count(*) from keep_admin) <> 1 then
    raise exception 'keep_admin must match exactly one administrator; check the e-mail in EDIT 1';
  end if;
end $$;

-- 1. Requests and what hangs off them.
delete from public.request_review;
delete from public.request_item;
delete from public.notification;                       -- all users, the kept admin too
delete from public.request;

-- 2. Uploads and import history.
delete from public.grade_file_row;
delete from public.grade_file;
delete from public.bulk_upload_history;
delete from public.stg_prerequisite;
delete from public.stg_subject;

-- 3. Students. Cascades to academic records, chats, preferences, advisee links.
delete from public.university_student;

-- 4. Curriculum data.
delete from public.prerequisite;
delete from public.elective_group_member;
delete from public.elective_group;
delete from public.subject_offering;
delete from public.subject;
delete from public.prospectus;

-- 5. Staff (faculty, registrar, department), then programmes.
delete from public.faculty_staff;
delete from public.registrar_staff;
delete from public.department_staff;
delete from public.program;

-- 6. Every login that is not the kept administrator. The student and staff rows
--    above are already gone, so nothing is left pointing at these users.
delete from auth.users where id not in (select user_id from keep_admin);

-- 7. Counters and logs.
update public.student_id_counter set last = 0;        -- the next student id starts again; use "delete from" instead to drop the years
alter sequence public.staff_employee_seq restart with 1;
alter sequence public.subject_offering_id_seq restart with 1;
alter sequence public.grade_file_row_id_seq restart with 1;
delete from public.maintenance_log;
-- audit_log is NOT touched: a trigger forbids deleting or truncating it.
-- system_config is NOT touched: set the real term and academic year in Admin afterwards.

-- What is left (should be: 1 administrator, 1 system_config row, the audit log, no data).
select 'auth.users' as what, count(*) from auth.users
union all select 'system_administrator', count(*) from public.system_administrator
union all select 'university_student', count(*) from public.university_student
union all select 'faculty/registrar/department', (select count(*) from public.faculty_staff) + (select count(*) from public.registrar_staff) + (select count(*) from public.department_staff)
union all select 'program', count(*) from public.program
union all select 'prospectus', count(*) from public.prospectus
union all select 'subject', count(*) from public.subject
union all select 'subject_offering', count(*) from public.subject_offering
union all select 'request', count(*) from public.request
union all select 'academic_record', count(*) from public.academic_record
union all select 'audit_log (kept)', count(*) from public.audit_log;

-- EDIT 2: rollback = dry run. Change to  commit;  only after the owner's yes.
rollback;

-- STORAGE is not covered here (files are not rows). After a real commit, empty the
-- buckets "profile-photos" and "staff-avatars" in Supabase -> Storage (select all, delete).
