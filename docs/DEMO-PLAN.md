# Demo plan (written 6 Nov 2026)

A script and a checklist for the defence. Everything here was checked against the live system on 6 Nov 2026, except where a line says "to check".

## 1. What the live system holds today (checked 6 Nov)

| Needed for the demo | State |
|---|---|
| Term | AY 2023, 1st Sem |
| Active curriculum | BSCRIM 2019, BSIT 2023, BSN 2025 |
| Schedule | 231 sections posted, all with EDP codes |
| Students | 26, all with a record on file (19 have grades) |
| Approved plans (Registrar print, Faculty form) | 15 |
| A plan waiting for the adviser (Faculty review) | 1 (CL-2026-000022). **Do not review it before the demo.** |
| Staff accounts | 7 faculty, 4 registrar, 4 department, 1 admin |
| **EDP student list** | **empty: upload it first (section 2)** |

## 2. One hour before (setup)

1. **Upload the EDP list.** Admin, EDP student list, choose `workspace/demo/edp-demo-list.csv` (4 demo students; edit the e-mails first if you want other aliases; each must be an address you can open). Press Save.
2. **Check the e-mail sender:** use Forgot password on the login page with one of your own addresses. The mail must arrive within a minute. If it does not, use the "no e-mail" demo path in section 5.
3. **Log in once to every role you will show** and tick **Remember me** where offered (the staff and admin pages keep a session for the tab only). Idle sign-out is 15 minutes (Admin), 30 (staff), 60 (student): do not leave a tab idle for longer.
4. **Test the room's connection** with a student login, the Dashboard and Cura (the AI answers in about 20 seconds). If it is slow, use your phone's hotspot.
5. Open **Chrome tabs in this order:** Student, Faculty, Registrar, Department, Admin (separate windows are safest).

## 3. The story (about 10 minutes)

| # | Role | What to show | Say |
|---|---|---|---|
| 1 | Visitor | Request an account with `Demo Registers` (BSIT, `+demo1` e-mail). Show a wrong e-mail being refused first | "Only students on the EDP list can register, and the e-mail must be the one on file." |
| 2 | Visitor | The confirmation e-mail, then the login page "e-mail confirmed" | The student logs in with the e-mail or the `uc-` ID |
| 3 | Student | Dashboard, then My prospectus (the whole curriculum), then Build your plan with **Auto-select** (try Morning) | Locked subjects name their missing prerequisite |
| 4 | Student | Submit the plan, then My requests (reference number), then ask **Cura** why a subject is locked | Cura answers from the same engine as the page |
| 5 | Faculty | Advising requests: approve some subjects, reject one with a reason, print the enrollment form | "The adviser's approval is final." |
| 6 | Student | Notification of the decision; the rejected subject is back in Build your plan with the reason | |
| 7 | Registrar | Students (search, open a record, degree audit), Approved plans (search by reference, reprint) | The Registrar does not approve accounts any more |
| 8 | Department | Grade upload **by section**: pick an EDP code, download the class list, upload grades | The first grade releases an upper-year student automatically |
| 9 | Admin | EDP student list (upload preview), **Bulk upload review table** (use `tests/fixtures/bulk-accounts/bulk-accounts-with-problems.csv`: fix a row, press Create, rows with problems are skipped), System logs | "Nothing with a problem is ever saved." |
| 10 | Admin | Try 6 wrong passwords on a **demo** account: the lockout message | "Five failures lock an account for 15 minutes." |

## 4. If the connection is slow or something breaks

- **Fallback:** the screenshots in `workspace/screenshots/` and a short screen recording of steps 3 to 9, made the evening before.
- **Slowest parts:** Cura (about 20 s), the first load of the Schedule page, and the curriculum builder.
- **Do not demo live:** the Admin two-step sign-in (not built, by choice), hosting (the demo runs from the local site), or a bulk upload of real students.

## 5. Without e-mail

If the sender fails on the day, the Admin can create an account with a **password** (Admin, Create account, choose "Temporary password"): no e-mail is sent. Use that for steps 1 and 2, and say the e-mail step was shown in the screenshots.

## 6. After the demo

- Remove the demo accounts and the demo EDP rows (`db/tools/e2e-cleanup.sql` shows the method; delete only addresses that start `hotarooriki01+demo`).
- Refresh the schema snapshot after any migration (`db/README.md`).

## 7. Likely questions, and the honest answers

- **Is it secure?** 17 of 18 hardening items are done (lockout, row-level security, audit log, content-security policy, server-side checks). The Admin two-step sign-in is future work.
- **What is not built?** Report and analytics screens (only printable forms), the Admin two-step sign-in, automatic data backups (need a paid Supabase plan), hosting.
- **Why does the Registrar not approve accounts?** The EDP list decides who may register, and the e-mail on file proves who they are.
- **What if two students share a name?** The listed row (ID, programme and e-mail) identifies the student, so the name alone never blocks anyone.
