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
- [ ] Every page opens with the browser console clean: no "integrity" or "blocked" error, icons still show.
- [ ] Sign in works on all five login pages (student, staff, admin) and the register page.
- [ ] Admin: download the accounts template, upload a small accounts file, create the accounts.
- [ ] Department: download a class list, upload a grade file, check the preview and save.
- [ ] Department: schedule template download and upload still work.

Names (db/060, shared/js/namerules.js) - re-run db/060 first; it was corrected after the first run:
- [ ] Register as a new student with the name `<b>x</b>`: refused with a plain message.
- [ ] Same with `Al3x`, `=1+1`, `😀 Ann`, `---`, and a name with a backslash.
- [ ] Accepted: `José`, `Dela Cruz`, `O'Brien`, `Smith-Jones`, `田中`.
- [ ] Admin Create account and a bulk-upload row with a bad name are refused, with the reason.

Student ID (register page):
- [ ] `2401187` and `uc-2401187` are accepted; `2024-01187`, 6 and 8 digits show "Student ID is 7 digits".

Passwords (shared/js/passwordrules.js, db/061):
- [ ] Eight spaces plus `!` is refused ("spaces do not count").
- [ ] A 25-character Japanese password is refused ("at most 72 bytes"); 23 characters plus `!` is accepted.
- [ ] Admin-created account and bulk upload apply the same rules.

Subject codes (shared/js/subjectcode.js, db/062 - run it first):
- [ ] Department > curriculum builder: type `engl 101` in one row and `ENGL-101` in another: the second shows "This code is already used."
- [ ] `ＥＮＧＬ １０１` (full-width) is stored as `ENGL 101`; a code with `.` or `/` or emoji is refused with a plain message.
- [ ] A prospectus PDF with en dashes in codes (BSN, "HUM – REP 101") still imports as `HUM - REP 101` and its prerequisites still link.
- [ ] Save, reload the draft, publish: codes and prerequisites come back unchanged.
- [ ] Grade file with `ENGL101`, `engl-101` and `ENGL 101` for the same subject all match it.

Email (shared/js/emailrules.js, db/063 - run it first):
- [ ] Register with `a@b.c`, `a@@b.com`, `x..y@school.edu`, `a@-b.com` and an address with a space or `<`: each is refused with "That does not look like a valid email address."
- [ ] `Althea.V@Gmail.com` is accepted and stored as `althea.v@gmail.com`.
- [ ] Admin Create account and a bulk-upload row with a bad email are refused, with the reason.
- [ ] Sign-in with a normal school email still works on the student and staff pages.
