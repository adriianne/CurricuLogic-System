# Data reset runbook

How to clear the test data and load the real programmes, subjects, sections and
staff. **Written 2026-10-17, updated 2026-11-15 (schema as of migration 114). RUN ON THE LIVE DATABASE ON 2026-11-15** (1 administrator kept, curriculum backup in `workspace/backups/curriculum-before-reset-2026-11-15.json`, storage emptied, fresh snapshot `db/schema-snapshot-2026-11-15.sql`). What is left is step 4 onwards: set the term, then load the real data. Do it only when the owner
says it is time, with a backup, and read the dry-run counts before committing.

## What stays and what goes

| Stays | Goes |
|---|---|
| Database structure: tables, policies, functions, triggers (migrations up to 114) | Students and their records, requests, items, reviews |
| Edge functions and their secrets (Gemini key, mail settings) | Staff accounts (faculty, registrar, department) |
| `system_config` (current term and academic year; set the real values afterwards) | Programmes, prospectuses, subjects, rules, elective lists |
| `audit_log` (a trigger forbids deleting it; it keeps the history) | Offerings and sections, EDP codes, the expected-student (EDP) list |
| ONE administrator account (your choice) | Notifications, Cura chats and preferences, form-print log, login-attempt and Cura-usage logs |
| Storage buckets and their rules | Grade uploads, import history, maintenance log |
| | Every other login (including the test accounts) |
| | Photos in Storage (done by hand, see step 5) |

Row counts on 2026-11-15 (so the dry run can be compared): 28 students, 15 staff
(7 faculty, 4 registrar, 4 department; BSIT has two Department accounts) and 1
administrator, 3 programmes, 9 prospectuses, 363 subjects, 365 rules, 235 offerings,
24 requests (106 items, 72 reviews), 99 academic records, 56 logins (about 12 of them
have no student or staff row), 5 stored files (4 photos, 1 staff avatar), 11 Cura chats
(184 messages), 39 notifications, 39 form prints, 4 expected students, 5 grade files
(47 rows), 220 audit-log rows (kept).

Two things the dry run must show: the final table has **1 login and 1 administrator**,
and **no error** at "delete from public.program" (that line used to fail on
`expected_student` before 15 Nov).

## Before you start

1. **Backup.** Supabase dashboard -> Database -> Backups (note the time of the latest
   one, or take a manual export). The newest schema snapshot is
   `db/schema-snapshot-2026-11-06.sql` (structure only, no rows, and it is older than
   migrations 107-114: re-export with `db/tools/export-schema.sql` first).
2. Keep the programme PDFs, the schedule file and the staff list ready: after the
   reset the system has no subjects and no staff, so nothing can be tested until they
   are loaded.
3. Choose the administrator to keep and write down its e-mail. Make sure you can
   sign in as it first.
4. Close the Android app and website on any phone or browser still signed in; their
   sessions end when the logins are deleted.

## Steps

1. **Dry run.** Open `db/tools/data-reset.sql` in the Supabase SQL editor, replace
   `REPLACE-WITH-ADMIN-EMAIL`, run it as it is. It ends in `rollback`, so nothing
   changes; read the final table (should be 1 login, 1 administrator, zeros, and the
   audit log count). If any statement errors, fix that first: a failure leaves the
   data untouched because of the `begin` / `rollback`.
2. **Commit.** Change the last `rollback;` to `commit;` and run again.
3. **Empty Storage.** Dashboard -> Storage -> `profile-photos` and `staff-avatars`
   -> select all -> delete. (Deleting rows does not delete files.)
4. **Set the term.** Admin -> settings: current term and academic year.
5. **Load the real data, in this order** (later steps point at earlier ones):
   1. Programmes (Admin).
   2. Staff accounts (Admin: one by one, or the bulk upload; see `docs/EMAIL-SETUP.md`
      for the sender limits before uploading many e-mails).
   3. Curriculum per programme: Department -> curriculum builder, upload the
      prospectus PDF, check every line against the PDF, publish.
   4. Schedule: Department -> schedule upload (photo or Excel). Check the EDP codes.
   5. Students: account requests through the Registrar, then grades.
6. **Re-run the checks:** `node --test tests/*.test.mjs`, then the browser checks in
   `docs/E2E-TEST-PLAN.md` with ONE test student of the new data.
7. **Afterwards:** change every test password that is left, review the privacy
   notice placeholders (contact, retention), and take a fresh schema snapshot with
   `db/tools/export-schema.sql`.

## Things to know

- The script has **not been dry-run** on the live database yet. The first dry run
  (step 1) is that test; it is safe because it rolls back.
- Student ids restart from the counter `student_id_counter` (set to 0); staff
  employee numbers restart at `EMP-00001`.
- Cura chat history and preferences go with the students (they cascade).
- If a policy or trigger blocks a delete during the dry run, the message names it:
  report it rather than disabling the protection.
