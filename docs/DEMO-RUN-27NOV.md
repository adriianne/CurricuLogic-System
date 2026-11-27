# Demo run for the defense (27 Nov 2026)

Written 25 Nov 2026 from the live data. The system term is **2nd Sem, AY 2024-2025**. Passwords are not written here: use the ones you set.

## Accounts (checked in the database)

| Role | Account | Why this one |
|---|---|---|
| Student A (the swap) | BSIT year 1: **24001191** (also 24001192 to 24001194, 24001189 is locked on CC-COMPROG12) | no request yet; passed CC-COMPROG11, so CC-COMPROG12 is open; BSIT has sections 1A, 1B, 1C |
| Student A2 (an approved plan) | BSIT year 1: **24001190** (Kenneth Montemayor, the phone account) | already has an APPROVED request (CL-2026-000036, 5 subjects, 14 units, 19 Nov): use it for My requests, Schedule tab, Enrolment sheet, Cura; its 5 approved subjects are locked, so do not use it for the swap |
| Student B (a clean plan) | BSIT year 2: **24001200** | 8 subjects open, 22 units, sections 2A and 2B, no retake |
| Student C (a locked subject) | BSIT year 2: **24001197** | CC-APPSDEV22 is locked (a prerequisite not passed); shows the "why locked" reason |
| Student D (advanced record) | BSIT **24001188** (your test account) | Academic record and Curriculum screens on the phone |
| Another programme | BSCSAI year 1: 25513386, 25618437 | sections 1A and 1B; 1A has 13 h of vacant time, the swap saves 4 h |
| BSHM | year 2: **20252001**, year 3: **20243001** | all four BSHM sections exist |
| Adviser (Faculty) | BSIT: **EMP-240001** (EMP-240001 to EMP-240010) | advisers of BSIT students |
| Registrar | BSIT: **EMP-240011** or EMP-240012 | Approved plans, reprint |
| Department | **EMP-240013** (Pedro) | Schedule, Reports, Grade upload |
| Admin | **SYS-ADMIN01** | Staff, Programs, Backup, Delete account |

## The run, in order

1. **Student A (24001191) on the phone or the website.** Home / Dashboard: progress, suggested subjects. Curriculum: Passed, Can take, Locked (tap a locked subject for the reason).
2. **Build your plan.** Press **Auto-select plan**. It picks the suggested subjects in sections that do not overlap, inside the unit limit. Try **Morning / Afternoon / Evening schedules**.
3. **Suggest a swap.** To get a sure result, pick the eight subjects and set every section to **BSIT-1A** (the section boxes), then press **Suggest a swap to cut vacant time**.
   Expected: about **2.5 h of vacant time**, take **CC-COMPROG12 in BSIT-1B** instead of 1A, **down to 0 h**. Press **Apply this swap** (the section box changes). Nothing is sent yet.
   For Student B (24001200) the button says "no vacant time to save" (2A has 2.0 h, no swap helps): shows that it never suggests an overlap.
4. **Send the plan.** Press Submit for review. My requests: status Waiting for the adviser.
5. **Adviser (Faculty).** Advising requests: open the plan, each subject shows the check result. Approve (or reject one with a reason), then print the enrollment form.
6. **Student.** My requests shows Approved; open the **Enrolment sheet** (EDP codes) for the EDP office.
7. **Registrar.** Approved plans: find the student, reprint the form (UC-Form 1A).
8. **Department (Pedro).** Schedule: Sections this term (BSIT 8, BSCSAI 6, BSCS 4, ACT 1, BSHM 4). Reports: Programme report and Academic analytics. Grade upload: the history.
9. **Admin.** Staff management: Stop a test account, then Delete it (type its ID). Programs: faculty 10 / 10 per programme. Backup: Create backup.

## After the demo
- Plans sent during the demo are real rows. Remove them with `db/tools/e2e-cleanup.sql` (ask first), or leave them.
- Do not delete a real account: Delete only works on stopped accounts with no history.

## If something goes wrong
- **Academic record "Not available" in the app:** fixed 25 Nov (db/132). Pull down to refresh; the app should be version 1.1 (Profile).
- **A plan page says "No schedule posted yet":** the subject has no section this term; use another subject or another student from the table.
- **BSA and BSCRIM students show "Nothing recorded yet":** no curriculum for those programmes yet. Use BSIT, BSCS, BSCSAI, ACT or BSHM.
- **Backup first:** Admin, Backup, Create backup, before the panel arrives.
