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
