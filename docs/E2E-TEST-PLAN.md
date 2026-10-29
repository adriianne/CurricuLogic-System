# End-to-end test plan (BSIT)

Run 2026-10-04. One programme (BSIT), all roles, website and Android app, against the
live Supabase project. Everything created is marked `ZZ Test` with an e-mail of the
form `zz.e2e.*@example.com` and is removed by `db/tools/e2e-cleanup.sql`. Throwaway
passwords are in `secrets/e2e-accounts.txt` (git-ignored; delete it at cleanup).

## Student profiles
The system records only `declared_path` (new / existing) plus the grade records, so
the other statuses are expressed through the records:

| Profile | How it is set up | What it should show |
|---|---|---|
| New | self-registers, no ID; Registrar approves, ID issued | empty record, 1st-year 1st-term plan |
| Old (regular) | existing path, records through a full year | next term recommended, locks explained |
| Returnee | existing path, old records, gap of terms | resumes where records stop, not by year level |
| Transferee | existing path, credited subjects out of sequence | credited subjects count; unlocks follow |
| Irregular | failed subjects, missing prerequisites | retakes first, locked subjects explained |

## Phases
1. Admin: create one account by hand and a batch by bulk upload; edit, read, update.
2. Registrar: approve and decline a self-registered request; verify a record.
3. Department: upload a grade file per profile.
4. Student (website): curriculum, plan, submit a request, Cura.
5. Faculty and Registrar: review, approve, enrol.
6. Student (phone): the same flows.
7. Cura: fixed questions per profile, answers compared with the engine's result.
8. Cleanup.

Findings go in `docs/E2E-FINDINGS.md`.

## Checks added 7 Oct 2026 (input handling and library changes)
Do these by hand in a browser; the automated tests cannot open the pages.

Libraries (shared/js/vendor/xlsx.full.min.js, pinned Supabase/ExcelJS/Font Awesome with integrity hashes):
- [ ] Every page opens with the browser console clean: no "integrity" or "blocked" error, icons still show. (13 Oct: clean on landing, student/staff/admin login, register; dashboards not checked.)
- [ ] Sign in works on all five login pages (student, staff, admin) and the register page. (13 Oct: admin and Department sign-in worked; student, registrar, faculty, register not tried.)
- [ ] Admin: download the accounts template, upload a small accounts file, create the accounts. (13 Oct: template downloads with the right columns; a bad-rows file is rejected at the preview; a good file was not uploaded.)
- [ ] Department: download a class list, upload a grade file, check the preview and save. (13 Oct: class list and template download, preview works; not saved.)
- [ ] Department: schedule template download and upload still work. (13 Oct: download works, pre-filled for BSIT-1A; upload not tried.)

Names (db/060, shared/js/accounts/namerules.js) - re-run db/060 first; it was corrected after the first run:
- [ ] Register as a new student with the name `<b>x</b>`: refused with a plain message. (13 Oct: rules module refuses it; the register form itself was not submitted.)
- [ ] Same with `Al3x`, `=1+1`, `😀 Ann`, `---`, and a name with a backslash. (13 Oct: all refused by the rules module.)
- [ ] Accepted: `José`, `Dela Cruz`, `O'Brien`, `Smith-Jones`, `田中`. (13 Oct: all accepted by the rules module.)
- [x] Admin Create account and a bulk-upload row with a bad name are refused, with the reason. (13 Oct)

Student ID (register page):
- [ ] `2401187` and `uc-2401187` are accepted; `2024-01187`, 6 and 8 digits show "Student ID is 7 digits". (13 Oct: the same pattern from register.js gives these results; the form was not submitted.)

Passwords (shared/js/accounts/passwordrules.js, db/061):
- [x] Eight spaces plus `!` is refused ("spaces do not count"). (13 Oct, on the Admin Create account form)
- [ ] A 25-character Japanese password is refused ("at most 72 bytes"); 23 characters plus `!` is accepted. (13 Oct: confirmed in the rules module only.)
- [x] Admin-created account and bulk upload apply the same rules. (13 Oct: both refuse the eight-spaces password; the bulk message reads "at least 8 characters" without "spaces do not count".)

Subject codes (shared/js/curriculum/subjectcode.js, db/062 - run it first):
- [x] Department > curriculum builder: type `engl 101` in one row and `ENGL-101` in another: the second shows "This code is already used." (13 Oct: the second row is flagged and the counter shows "Fix N issues". The message text was not displayed at first; the builder now shows each row's reasons on a full-width line under it, and this was checked in the browser, including the message clearing when the code is fixed.)
- [ ] `ＥＮＧＬ １０１` (full-width) is stored as `ENGL 101`; a code with `.` or `/` or emoji is refused with a plain message. (13 Oct: full-width counts as a duplicate of `ENGL 101`, and `.`, `/` and emoji are marked bad; the stored value and the plain message were not checked.)
- [ ] A prospectus PDF with en dashes in codes (BSN, "HUM – REP 101") still imports as `HUM - REP 101` and its prerequisites still link.
- [ ] Save, reload the draft, publish: codes and prerequisites come back unchanged.
- [x] Grade file with `ENGL101`, `engl-101` and `ENGL 101` for the same subject all match it. (13 Oct, preview only; the full-width spelling matches too.)

Email (shared/js/accounts/emailrules.js, db/063 - run it first):
- [ ] Register with `a@b.c`, `a@@b.com`, `x..y@school.edu`, `a@-b.com` and an address with a space or `<`: each is refused with "That does not look like a valid email address." (13 Oct: confirmed in the rules module; the register form was not submitted.)
- [ ] `Althea.V@Gmail.com` is accepted and stored as `althea.v@gmail.com`. (13 Oct: the rules module accepts it and cleans it to lower case; nothing was stored.)
- [x] Admin Create account and a bulk-upload row with a bad email are refused, with the reason. (13 Oct)
- [ ] Sign-in with a normal school email still works on the student and staff pages.

## Checks added 25 Oct 2026 (EDP student list and account verification)
Run `db/084` to `db/087` first (applied 24-25 Oct). Test file: `tests/fixtures/edp-list/edp-list-sample.csv`
(read its `00-README.md`; every ID starts with 99 and every email is example.com). Where a check sends a real
email, use your own addresses, not the sample file's. Notes marked "preview" or "database" were checked
without a real sign-in; the boxes stay open until done in a browser against the live project.

Admin: upload the list (Admin > EDP student list):
- [ ] Upload the sample file: "5 students ready, 5 rejected", with the reasons (unknown programme, ID not 7 digits, missing name, bad email, duplicate ID). (25 Oct: preview, same result from the rules.)
- [ ] Save: the 5 appear in the list with their programme and year. Upload it again: the 5 show as **Update**, not New. (preview)
- [ ] A file without a `year_level` column leaves saved years unchanged; a year of `9` rejects that row; `3rd Year` is read as 3. (rules tested)
- [ ] Search finds by ID, name, email and programme; Remove needs a second click. (preview)
- [ ] A file over 2 MB or 5,000 rows, or a `.pdf`, is refused with a plain sentence.

Admin: create accounts from the list (use your own email addresses):
- [ ] "Check who needs an account" counts the right students and skips anyone who already has an account (by ID or by email), with the reason. (preview)
- [x] The create button needs a second click, then creates at most 50 accounts and says how many wait. (25 Oct, real: 2 accounts created from `edp-real-send-test.csv`; history row "EDP list: create accounts ok=2 failed=0")
- [x] Each person gets a setup email at the address on the list; the link opens the set-password page and the new password signs in. (25 Oct, real: both emails sent; the 3rd-year student set a password and signed in. The 1st-year's first link was used while no server ran on localhost:8123, so it needed "Forgot password". To test links, serve the site on that port first.)
- [x] The accounts are pre-approved: nothing appears in the Registrar's queue, and they show as "Registered" in the list. (25 Oct, real: approved, programme BSIT, years 1 and 3, record not verified, Registrar queue empty)
- [ ] A student created with `year_level` 3 shows year 3 on the Registrar and Department screens, and the student page says their record is being verified.
- [ ] A listed student whose email fails to send is reported, and "Forgot password" gets them a link.
- [ ] Run it again: nobody is created twice.

Register page:
- [ ] With the list uploaded, register as a listed student (new path: name and programme; existing path: ID and programme): no warning. `uc-` before the ID is accepted. (database: matching tested live)
- [ ] An unlisted name, or the right name with the wrong programme: a warning appears and the button reads "Submit anyway". Changing any field clears it. (database + preview)
- [ ] With no list uploaded, nobody gets a warning. (database)
- [ ] Honeypot: fill the hidden `contact-ref` field in the browser tools, then submit: the page says "Request submitted" but no row is created. A normal submit is unaffected. (25 Oct: preview, zero requests sent)

Registrar: request cards:
- [ ] Each pending request shows "On EDP list" or "Not on EDP list"; nothing shows while no list is uploaded. (database)
- [ ] For "Not on EDP list", Approve is disabled and the note says what to do. Upload a corrected list, reload: Approve works. Decline always works.
- [ ] Approve re-checks at click time: remove the student from the list while the page is open, then click Approve: it is refused.
- [ ] Decline opens a box in the card: an empty reason shows an error in the card; a quick reason fills the box; 501 characters cannot be typed. The student sees the reason on their page. (preview, except the student's view)
- [ ] The three checklist ticks and an open decline box survive the page redrawing. Approve works whether or not they are ticked. (preview)
- [ ] A Registrar of another programme does not see this programme's students or their badges. (database)

Admin: Students table:
- [ ] The "EDP list" column shows the right badge for the 20 rows on screen, and refreshes after the list changes. (preview)

Access (database):
- [x] Signed out cannot read or write `expected_student`; a signed-in non-admin sees nothing; the Admin can. (24 Oct, live)
- [x] `edp_status` returns nothing to a non-staff user, only own-programme students to a Registrar, and is refused for signed-out callers. (24 Oct, live)

Cleanup:
- [ ] Remove the list rows: `delete from public.expected_student where student_id like '99000%';`
- [ ] `db/tools/e2e-cleanup.sql` only matches `zz.e2e.*@example.com`. Accounts made with your own addresses are not covered: remove them by hand, or add your address to the script's pattern for that run.

## Checks added 25 Oct 2026 (stop and restore accounts, db/088)
Run `db/088` first (applied 25 Oct). Stopping is reversible and erases nothing. Use a throwaway student and a
throwaway staff account. Notes marked "database" or "preview" were checked without a real sign-in.

Admin: Students and Staff management:
- [ ] An approved student and an active staff member each show a **Stop** button; pending and declined students show none. (preview)
- [x] Stop opens a box in the row; an empty reason shows an error in the box; 300 characters is the limit; a typed reason survives the list redrawing. (preview) (25 Oct, real: stop and restore saved with the reason in the history)
- [x] After Stop the pill reads **Stopped** and the button becomes **Restore**. The student filter has a **Stopped** option; **Approved** no longer lists them. (preview) (25 Oct, real)
- [x] Restore puts them back as Approved or Active, with no new approval and no new student ID. (preview; database) (25 Oct, real: signed in again after Restore)
- [ ] Stopping yourself is refused; there is no Stop button for administrator accounts.

The person who was stopped (use a real sign-in):
- [ ] The sign-in page says "This account has been stopped. Please contact the Office of the Registrar." for a student, and "This account is not active. Please contact the System Administrator." for staff, not "awaiting verification".
- [x] A student who was signed in when stopped can no longer see their records, requests or chat after refreshing; Cura and the plan builder refuse. (database: their student id disappears, so every rule of their own closes) (25 Oct, real: the student was signed out on refresh. Sign-in wording not confirmed.)
- [ ] A stopped staff member can no longer open students, requests or uploads. (database)
- [ ] After Restore they sign in again and everything they had is still there.

Registrar:
- [ ] A stopped student shows **Stopped**, not Approved, in the Registrar's list. (code)
- [ ] The Registrar has no Stop or Restore button.

Access and history (database):
- [x] A non-admin and a signed-out caller cannot call `set_account_stopped`; only the Admin can read `account_stop_log`. (25 Oct, live)
- [x] Stop needs a reason; stopping twice and restoring twice are refused; Restore refuses an account that was never stopped, so it cannot approve a pending or declined student. (25 Oct, live; this found and fixed an ordering bug in the log)
- [x] Each stop and restore is logged with who, when and why, in order. (25 Oct, live)

## Checks added 26 Oct 2026: request reference number (CL-2026-000021)

The reference is only a label made from the request's number and the year it was made. It is not stored, and knowing it gives no access. A bare number in a search box stays a student-ID search; only text that starts with `CL` or the year (`CL-2026-21`, `2026-21`) finds a request.

Registrar (Approved plans page):
- [x] The table has a **Reference** column after Student ID, and clicking its heading sorts by the request number, not by text (7 before 21 before 1234567). (26 Oct, preview with sample plans) (29 Oct, real Registrar: ascending 008, 009, 010, 012, 019, 020, then descending)
- [x] Searching `CL-2026-000021`, `cl 2026 21` or `2026-21` finds that plan; `21` finds students whose ID contains 21; an unknown reference shows no plans. (26 Oct, preview) (29 Oct, real Registrar: CL-2026-000019, cl 2026 19 and 2026-19 each find Athena's plan; 19 finds only the student whose ID contains 19; an unknown reference and another programme's request show no plans)
- [x] The plan detail header shows the reference after the student ID. (29 Oct, real Registrar: "2421984 · CL-2026-000020 · 1st Year · 1st Sem 2023 · submitted 10/17/2026")
- [ ] At phone width the extra column does not break the table (it scrolls or fits). (not checked)

Faculty (Advising requests):
- [x] Each pending card and the request detail header show the reference. (26 Oct, preview: cards; detail not seen) (29 Oct, real Jay Darga: card and detail header "2401187 · CL-2026-000021 · 1st Year · 1st Sem 2023 · submitted 10/29/2026")
- [x] The search box above the cards finds by name, student ID or reference; the count reads "1 of 3 pending"; no result shows "No matches". (26 Oct, preview) (29 Oct, real: reference, cl 2026 21, 2026-21, name and student ID find the request; an unknown reference, junk text and an already-approved request show "0 of 1 pending, No matches"; pending requests only)

Student (My requests):
- [x] Each request card shows the reference first in its small line. (26 Oct, preview with sample requests) (29 Oct, real Athena: four cards CL-2026-000021, 19, 18 and 12, matching the database; a new plan sent through Cura's Apply to my plan became CL-2026-000021, "Awaiting adviser", both items marked valid with the chosen sections)

Printed pages (real data needed):
- [ ] The Registrar's **Print enrollment form** (the advising slip) and the Faculty's print button show `Ref. CL-…` under the term, and the number matches the one on the Registrar table.
- [ ] The student's **Enrolment sheet** shows `Ref. CL-…` at the right of the header, the same number as My requests.
- [ ] The Faculty eligibility slip (not tied to a request) has no reference line.

Before launch:
- [ ] When the data is reset, restart the request counter so the first real request is number 1.

## Checks added 28 Oct 2026: Administrator > System logs (read-only)
Needs a real Administrator sign-in. Notes marked "preview" were checked with sample data (`admindashboard.html?preview#logs`), not the live project.

Summary tiles and tabs:
- [ ] "System logs" is in the Administrator's menu; the four tiles show: changes in the last 24 hours, time since the nightly cleanup, Cura's success rate, Cura's average time. (preview)
- [ ] A non-administrator cannot read any of these tables (try as a student or staff member: the page is not offered and the tables return no rows). (database: rules checked 28 Oct)

Activity:
- [ ] Entries show the time in your own clock (not hours off), who did it by name and role, what was done, the record and the changed fields. A person who has since been removed shows "Removed account". (preview)
- [ ] Privacy: an email shows as j***@host, a password or token as dots, long values are cut. A created or removed account lists its fields without the id. (preview)
- [ ] Filters (action, record kind, who, from/to dates, exact record ID) narrow the list; a filter with no match says so; "Load 50 more" adds the next page without repeating rows. (preview for the filters; paging needs more than 50 live entries)
- [ ] Create one test account and stop it: both appear at the top within a minute, with your name.

Accounts and Uploads:
- [ ] A stop and a restore appear with the account's name, the reason and who did it. A bulk upload appears with its file name and counts.

System health:
- [ ] The nightly cleanup shows its last run and rows removed per rule; if the job is more than 26 hours late a warning appears. (preview)
- [ ] After asking Cura one question, a new row appears in the Cura list (result, time, model, tries) and the 24-hour numbers change. The page shows no message text.
- [ ] With at least 5 requests in the week, a warning is shown when 30% or more needed more than one try, or fewer than 80% went well. (preview)

Phone width:
- [ ] At 390 px the tiles stack, the tabs stay reachable and each table scrolls inside its own box without moving the page. (28 Oct, preview in a 390 px frame: tiles two by two, four tabs on one row, filters stacked, tables scroll inside their box, warnings wrap; also checked in dark mode. Real phone not tried.)

## Checks added 29 Oct 2026: the approval path, with real sign-ins (Athena, Jay Darga, Carl Gralo)
- [x] Student: Cura's "Apply to my plan" fills Build your plan from a typed wish ("mornings only, no classes on Friday, up to 12 units": STS 101 in BSIT-2B and LIT 101 in BSIT-4B, 6 of 12 units, no overlap); the student presses Submit; the request gets its reference (CL-2026-000021) and "Awaiting adviser". (29 Oct)
- [x] Database: the new request has two items, both "valid", with the chosen sections and meeting times. (29 Oct)
- [x] Faculty (the adviser): the pending request appears with its reference; search works; the detail shows both subjects "ready" with their sections; "Approve all" approves the request and both items. (29 Oct)
- [x] The student gets the notification "Your adviser approved your plan..." and the card reads "Approved for enrollment" with the steps Submitted, Adviser review, Approved. (29 Oct)
- [x] The Faculty page then shows "All reviewed" and "Print enrollment form". (29 Oct)
- [ ] Print the same request (CL-2026-000021) from all three places and check `Ref. CL-2026-000021` is on each: the Faculty "Print enrollment form", the Registrar "Print enrollment form" (it should be in the Registrar's list now), and the student's "Enrolment sheet". Needs a person; the print dialog can block the test tool.
- [ ] Reject path: an adviser rejects one subject and the student sees the remark (done once on 17 Oct as CL-2026-000018; repeat after any change to the review page).

## Checks added 29 Oct 2026: Department (real sign-in as Cris Dizz, BSIT), read-only
Nothing was published, uploaded, closed or deleted in this pass.
- [x] Dashboard: curriculum numbers match the active BSIT prospectus (id 8, 2023): 50 subjects, 93 rules, 152 units. (29 Oct)
- [x] Prospectus page lists the 6 BSIT versions; Curriculum, Schedule (term and section selectors, the section demand with seats left), Students and Grade upload (class list, template, check file) all open with no console errors. (29 Oct)
- [x] Students: 13 students, equal to the database; the BSCRIM student Marco Deveza (2401188) is not listed (programme limit holds). (29 Oct)
- [x] A student's detail shows this term's approved plan with each subject's section and time (Athena: STS 101 BSIT-2B, LIT 101 BSIT-4B, 6 units). (29 Oct)
- [ ] Not done on purpose (they change records): publish or activate a prospectus, upload a schedule, close or open a section, upload grades.

Findings to decide on (none is a crash):
- The dashboard line "100 offerings published" counts every BSIT offering of every term: 89 for the current term plus 11 for 2024 term 2. The label does not say so.
- The Department's student detail shows the approved plan without its reference (CL-...), unlike the Registrar, Faculty and Student pages.
- Test leftovers: a Published 2050 prospectus with 85 subjects and 3 students, drafts for 2026, 2027 and 2028, and an inactive 2024 version with 2 students (Athena among them). They also fill the term lists (Grade upload). Athena's detail reads "Curriculum 2024-2025, Older version" although the active curriculum is 2023-2024. Clean up with the pre-launch data reset (docs/DATA-RESET-RUNBOOK.md).

## Checks added 29 Oct 2026: Department > Curriculum > AI-assisted upload, pressing Extract more than once
Found by the user on their own screen (the bar stuck at 19% while 83 subjects were already in the grid); fixed the same day (shared/js/app/singleflight.js, features/department/curriculum-builder.js).
- [x] A PDF is loaded and **Extract Subjects** is pressed five times in a row: exactly ONE request goes to the analysis service; the button reads "Extracting..." and is disabled, the trash and cancel buttons are disabled, and the bar only rises (12% to 95%, never back). When the service answers (here: "Rejected: the document is completely blank", for a dummy PDF) the button and the file buttons come back, the bar is hidden and the message is shown. (29 Oct, real Department sign-in, dummy 192-byte PDF)
- [ ] With a real prospectus PDF: the bar reaches 100%, the card resets to the drop zone and the success message names the number of subjects. (Not run: it would replace the user's unsaved draft.)
- [ ] Switching a year tab or adding a row while the analysis runs keeps the bar and the locked button. (Written to hold; not tried live.)
- [x] The other upload buttons that call the AI already had a guard: the schedule photo scan (an "already reading" lock and one timer cleared on every exit) and the grade file check (a busy flag). (29 Oct, read in the code)

## Checks added 29 Oct 2026: two small Department fixes (from the 29 Oct Department pass)
- [x] Dashboard > Schedule tile counts only the current term's offerings of the programme and says "offerings published this term" (expected for BSIT, 1st Sem AY 2023-2024: 89, not 100); a term with nothing posted says "nothing published for this term yet". Unit-tested in tests/offeringcount.test.mjs. (29 Oct, real Department sign-in: "89 offerings published this term", equal to the database)
- [x] A student's detail (Department > Students > open one) shows the plan's reference first on the approved plan's line, e.g. "CL-2026-000021 - 2 subjects - 6 units - submitted ...". (29 Oct, real: "Approved for enrollment CL-2026-000021 · 2 subjects · 6 units · submitted Oct 29, 2026")

## Checks added 29 Oct 2026: Administrator stop and restore, with a real Admin sign-in (throwaway: Test CrimFaculty, BSCRIM)
- [x] Staff management lists all 15 staff accounts (equal to the database), each with a Stop button; Administrator accounts are not in the list, so they cannot be stopped. (29 Oct)
- [x] Stop with the reason "E2E test": the row reads Stopped with a Restore button, and the page says "... is stopped. They cannot sign in until you restore them." The database shows is_approved false, one account_stop_log row (action stop, the reason, done by the Administrator) and one audit entry. No other staff account changed. (29 Oct)
- [x] Restore: the row reads Active with Stop again; is_approved true; a second log row (action restore, no reason); the employee ID, email and programme are unchanged; no new approval was needed. (29 Oct)
- [x] System logs shows both events at once: Activity ("Changed, Faculty, is_approved true to false", then "false to true", each with the Administrator's name) and the Accounts tab (Stopped with its reason, then Restored); the 24-hour tile counted them. (29 Oct)
- [ ] The stopped person is really locked out: sign in as them while stopped and see "This account is not active..." and no data (needs that account's password).
- [ ] The empty-reason error in the Stop box (not recorded in this run).

## Checks added 29 Oct 2026: printed pages of CL-2026-000021, captured without a print dialog
Method: the page's window.open is replaced with a recorder, the real button is clicked, and the HTML that would have printed is read (so no dialog blocks the test tool). A person should still glance at one real printout for the layout.
- [x] Faculty "Print enrollment form" (the advising slip): the header reads "Enrolment Advising Slip, 1st Semester, AY 2023-2024", then `Ref. CL-2026-000021`, Student ID 2401187, Athena Po, 1st Year, Issued October 29, 2026. (29 Oct, real Jay Darga)
- [x] FIXED 29 Oct (option A, tests/advisingslip-outside.test.mjs): the slip now adds a block "APPROVED SUBJECTS OUTSIDE THIS SEMESTER" (code, title, units, section, Approved, plus a line "Units approved on this plan"), and marks a semester subject Approved by id or by code. Live capture for CL-2026-000021: STS 101 (BSIT-2B MW 10:00-11:30) and LIT 101 (BSIT-4B MW 08:00-09:30), 6 units, Ref line unchanged. Original finding: that slip lists the student's YEAR-LEVEL semester of the curriculum (8 first-year subjects, 23 units) and marks none as "Approved". The two subjects the adviser actually approved (STS 101 and LIT 101, taken from other year levels) are not on it. For a regular student whose plan is their own semester it would match; for an irregular plan it hides what was approved.
- [ ] Registrar "Print enrollment form": the same function (AdvisingSlip.printApprovedRequest) as the Faculty one, so the same slip including the new "approved subjects outside this semester" block; not captured separately (needs a sign-in as the Registrar).
- [x] Student "Enrolment sheet": `Ref. CL-2026-000021` at the top right, "Athena Po 2401187, BSIT, 1st Semester AY 2023-2024", STS 101 (SAMPLE-68B-LEC, BSIT-2B MW 10:00-11:30, backup SAMPLE-68A-LEC BSIT-2A F 8:00-11:00) and LIT 101 (SAMPLE-100B-LEC, BSIT-4B MW 8:00-9:30, backup SAMPLE-100A-LEC BSIT-4A TTH 1:00-2:30), total 6, and the "this is a recommendation" note. (29 Oct, real Athena, captured without a print dialog)

## Checks added 29 Oct 2026: Register page and the EDP list, with a real browser (throwaway sign-ups zz.e2e.*@example.com)
- [x] With no list uploaded, registering a new student raises no warning and the request is created pending (ZZ one, BSIT, new path). (29 Oct)
- [x] Admin uploads the 5-row sample list: "Saved: 5 new, 0 updated"; the database holds 9900001 to 9900005; the 5 bad rows were not saved; programme "bsit" in lower case became BSIT. (29 Oct)
- [x] The database check answers correctly for a visitor who is not signed in: ZZ Nobody gives no_match, Test Alpha gives match, the right ID gives match, a wrong programme gives no_match. (29 Oct)
- [x] BUG FOUND AND FIXED 29 Oct: for an unlisted name the button changed to "Submit anyway" but the explanation was never visible, because the message kind "pending" had no style in features/auth/css/loginpage.css (the box stayed display: none). Added .msg.pending (amber); tests/authmessages.test.mjs now fails if any message kind the sign-in, Register or password pages use has no visible style (it would have caught this). Confirmed on the real page: the amber box "We could not find these details on the university's student list..." appears.
- [ ] OPEN: the message appears at the TOP of the form card while the Submit button is at the bottom, so on a normal screen the student can still miss it. A message could be scrolled into view when it is shown (proposed, not done).
- [ ] The unlisted student presses "Submit anyway" and the request is created; changing any field first clears the warning.
- [ ] A listed student (Test Alpha, BSIT) registers with no warning.
- [ ] Registrar (Account requests): the badges (On EDP list / Not on EDP list), Approve disabled for a person not on the list, and the decline box (empty reason error, quick reasons, 500 character limit).
- [ ] Cleanup: delete from public.expected_student where student_id like '99000%'; and db/tools/e2e-cleanup.sql for the zz.e2e accounts.
