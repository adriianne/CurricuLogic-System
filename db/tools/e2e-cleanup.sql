-- e2e-cleanup.sql
-- Removes everything the 2026-10-04 end-to-end test created. Every test account
-- uses an e-mail of the form zz.e2e.*@example.com, so nothing else is touched.
-- Deleting the auth user cascades to the student/staff row and, from the student,
-- to their records, requests, enrolments and chat. audit_log is append-only and
-- keeps its history by design.
--
-- Run the first query (preview) before the second (delete).

-- preview: what would go
select 'auth users' as what, count(*) from auth.users where email like 'zz.e2e.%@example.com'
union all select 'students', count(*) from university_student where email like 'zz.e2e.%@example.com'
union all select 'staff', (select count(*) from faculty_staff where email like 'zz.e2e.%@example.com')
                        + (select count(*) from registrar_staff where email like 'zz.e2e.%@example.com')
                        + (select count(*) from department_staff where email like 'zz.e2e.%@example.com')
                        + (select count(*) from system_administrator where email like 'zz.e2e.%@example.com');

-- delete (uncomment to run)
-- delete from auth.users where email like 'zz.e2e.%@example.com';
