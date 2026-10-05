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
