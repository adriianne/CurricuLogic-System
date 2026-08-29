# CurricuLogic

A rule-based expert system for subject prerequisite verification and
subject recommendation, built for the BS Information Technology programme
at the University of Cebu, College of Computer Studies.

A student opens the system and sees what they can enrol in this term, why
each subject is suggested, and — for anything they cannot take — the
specific requirement standing in the way.

**Advisory only.** CurricuLogic performs no enrolment transactions and is
not a student records portal. It reads the curriculum and a student's
academic history and reasons over them.

---

## What kind of AI this is

CurricuLogic is a **forward-chaining expert system** — symbolic AI, the
same class of system as MYCIN, not machine learning.

Prerequisite rules are already fully specified by the published
prospectus, so there is nothing to learn from data. Academic advising also
requires decisions that are deterministic and explainable: a student
refused a subject must be shown exactly which requirement failed. A
learned model cannot guarantee that.

The knowledge is **data, not code**. Rules live in the `subject` and
`prerequisite` tables; `engine/engine.js` contains no knowledge of BSIT or
any particular subject. Point it at a different prospectus and it reasons
over that instead. Department Staff amend the rules through the system,
and the change takes effect on the next assessment with no redeploy.

That separation of knowledge from inference is what distinguishes an
expert system from conditional logic.

---

## Architecture

Three layers, deliberately separated:

| Layer | Where | What |
|---|---|---|
| Knowledge base | Supabase — `subject`, `prerequisite`, `prospectus` | The rules |
| Working memory | Supabase — `academic_record` | Facts about one student |
| Inference engine | `engine/engine.js` | Applies rules to facts |

The engine is a pure function: facts and rules in, results out. No
database calls, no DOM, no network. It runs unchanged in the browser, in
Node for tests, and behind an Edge Function.

### What the engine does

- Evaluates conditions grouped for AND/OR logic — same `rule_group` is
  "any one of", different groups are ANDed
- Handles `standing` requirements as *completion through year N*, not a
  unit total. A student can reach 98 units while still owing a subject.
- Treats a retake correctly: any passed attempt counts, so a later pass
  clears an earlier failure without erasing it from the transcript
- Chains forward to find how many terms away each locked subject is
- Ranks suggestions by **unlock impact** — how many later subjects sit
  behind each one in the prerequisite graph
- Caps the suggested load at the unit limit and filters to what is
  actually scheduled

---

## Layout

```
engine/     inference engine — pure, no dependencies
tests/      engine tests, runnable with plain node
data/       transcribed BSIT prospectus (CSV)
db/         SQL migrations as applied to the live project
docs/       decision register and working notes
HTML/       page markup, one file per actor dashboard
JS/         page logic, one file per page
CSS/        dashboard.css is shared across all actor dashboards
Images/     logo and assets
```

---

## Running it

The frontend is plain HTML, CSS, and JavaScript — no build step.

**Serve the pages.** VS Code Live Server, or any static server. Opening a
file directly works, but Supabase auth behaves better over `http://`.

**Configure Supabase.** `JS/config.js` holds the project URL and anon key.
The anon key is public by design; Row Level Security protects the data.

**Run the engine tests:**

```bash
node tests/engine.test.mjs
```

54 assertions against the real prospectus. No database, no `npm install`.

---

## Actors

Five, and the vocabulary is fixed:

| Actor | Can |
|---|---|
| University Student | View eligibility, prospectus, and their own record |
| Faculty Staff | Look up students and review their records |
| Registrar Staff | Approve accounts, verify records, view grades |
| Department Staff | Author the curriculum, publish schedules, upload grades |
| System Administrator | Not yet built |

Roles are resolved from the database at sign-in, never from the page.

Students sign in with `uc-1234567`, staff with `EMP-00871`, or either with
their email address.

---

## Status

Working: authentication and role routing, the knowledge base (58 subjects,
37 rules, 176 units), the inference engine, curriculum authoring, schedule
and grade upload with per-row validation, account approval, and four of
five actor dashboards.

Not yet built: the advising request module, notifications, the System
Administrator dashboard, reporting, and the mobile client.

Known limitations and open decisions are recorded in
[`docs/DECISIONS.md`](docs/DECISIONS.md). Current working state is in
[`docs/NOTES.md`](docs/NOTES.md).

---

## Before deploying

- Set `DEBUG_LOGIN = false` in `JS/auth.js` — it reveals whether an
  identifier exists
- Remove the test accounts and the development academic records

---

A capstone project of the College of Computer Studies,
University of Cebu.