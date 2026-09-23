# CurricuLogic

A rule-based expert system for academic advising at the University of
Cebu, College of Computer Studies. Verifies prerequisites, checks
eligibility, and recommends subjects. Currently scoped to the BSIT
programme — the schema carries a `program` table and the section
format is derived from `program.code`, but no second programme has
been loaded yet.

Advisory only. The system does not enrol students or record financial
transactions.

---

## What kind of system this is

Symbolic AI, not machine learning. Forward chaining over explicitly
encoded production rules — the MYCIN family. Nothing is trained, there
is no dataset, and there are no weights.

That is deliberate. Academic advising needs deterministic, auditable
decisions. A student told they cannot take a subject must be told
exactly which prerequisite failed. A statistical model would trade that
away for nothing, because the rules are already published in the
prospectus.

The core architectural claim is the separation of knowledge from
inference. Eligibility logic lives in `shared/engine/`, never in a
dashboard. If prerequisite checks end up inside
`features/student/studentdashboard.js`, the system is a form with
if-statements and the claim no longer holds.

---

## Status

Working end-to-end for **Department Staff** (authoring) and
**University Student** (advising). Faculty, Registrar, and System
Administrator dashboards exist and are functional but have not been
through the same consistency and redesign pass.

### Shipped

- **Curriculum authoring** — subjects, prerequisite rules, retire and
  restore.
- **Prospectus versions** — create from scratch, copy from an existing
  version, activate, delete with a typed-year confirmation.
- **Schedule** — CSV or Excel upload, AI photo scan of the registrar's
  printed form, EDP-validated rows, per-section save.
- **Grade upload** — student and prospectus validation, audit trail via
  `grade_file` and `grade_file_row`, xlsx template with fixed column
  widths.
- **Student advisory** — eligibility engine over the live knowledge
  base, plus the Cura AI chat.
- **Profile** — avatar upload to `staff-avatars`, editable and
  read-only columns, change-password modal.

### In flight

- **Grade upload UI refresh** — end-to-end verification pending.
- **Schedule photo scan prompt rule 4** — reporting unknown subject
  codes instead of substituting. Needs confirmation that it is
  deployed to the live Edge Function.

### Open

- **`features/prospectus/prospectus.css`** carries duplicate `.photo-*`
  rules from successive passes; the older ones win. Deduplication
  pending.
- **`commitGrades()`** is four independent DB writes, not atomic. A
  failure mid-sequence leaves a stranded `grade_file` row. Candidate
  for a Postgres RPC wrapped in `BEGIN...COMMIT`.
- **Faculty, Registrar, and Admin dashboards** have not been rebuilt to
  match the Department Staff visual language.

### Deferred until a second programme lands

- **Program-scoped access** — `department_staff.program_id` plus RLS
  policies. Today `department_staff.department` is a free-text string,
  which cannot distinguish two programmes under one college.
- **Section letters and year ranges** become per-programme settings.
  The `SECTION_LETTERS` constant is `['A','B','C','D']` today, and
  year level is 1–4 — both correct for BSIT, both wrong for two-year
  diploma programmes and post-baccalaureate programmes.

### Data notices

- One prospectus with **effective year 2031** is in the live database.
  Almost certainly test data — worth confirming before any
  demonstration.
- **14 Year-2+ subjects** carry no prerequisite rule. Visible on the
  dashboard integrity tile.

---

## Roles

| Role | Path | Status |
|------|------|--------|
| Department Staff | `features/department/` | Authoring — complete |
| University Student | `features/student/` | Advisory — complete |
| Faculty | `features/faculty/` | Advising queue — functional, not audited |
| Registrar | `features/registrar/` | Oversight — functional, not audited |
| System Administrator | `features/admin/` | Account management — functional, not audited |

Each dashboard is a single HTML file with hash routing. One JavaScript
module per dashboard, one shared stylesheet.

---

## Layout
