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
- [ ] The table has a **Reference** column after Student ID, and clicking its heading sorts by the request number, not by text (7 before 21 before 1234567). (26 Oct, preview with sample plans)
- [ ] Searching `CL-2026-000021`, `cl 2026 21` or `2026-21` finds that plan; `21` finds students whose ID contains 21; an unknown reference shows no plans. (26 Oct, preview)
- [ ] The plan detail header shows the reference after the student ID. (not seen yet)
- [ ] At phone width the extra column does not break the table (it scrolls or fits). (not checked)

Faculty (Advising requests):
- [ ] Each pending card and the request detail header show the reference. (26 Oct, preview: cards; detail not seen)
- [ ] The search box above the cards finds by name, student ID or reference; the count reads "1 of 3 pending"; no result shows "No matches". (26 Oct, preview)

Student (My requests):
- [ ] Each request card shows the reference first in its small line. (26 Oct, preview with sample requests)

Printed pages (real data needed):
- [ ] The Registrar's and Faculty's **Print approved plan** slip shows `Ref. CL-…` under the term, and the number matches the one on the Registrar table.
- [ ] The student's **Enrolment sheet** shows `Ref. CL-…` at the right of the header, the same number as My requests.
- [ ] The Faculty eligibility slip (not tied to a request) has no reference line.

Before launch:
- [ ] When the data is reset, restart the request counter so the first real request is number 1.
