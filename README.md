# CurricuLogic

A rule-based expert system for academic advising at the University of
Cebu, College of Computer Studies. Verifies prerequisites, checks
eligibility, and recommends subjects for the BSIT programme.

Advisory only. The system does not enrol students or record transactions.

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
inference. Eligibility logic lives in `engine/`, never in a dashboard.
If prerequisite checks end up inside `JS/studentdashboard.js`, the
system is a form with if-statements and the claim no longer holds.

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
assets/     logo and assets
```

---

## Login identifiers

| Actor | Format | Example |
|---|---|---|
| University Student | `uc-` + 7 digits | `uc-2401187` |
| Staff | `EMP-` + digits | `EMP-00871` |
| System Administrator | username | `sysadmin` |
| Any | email | `althea1@gmail.com` |

`resolve_login_identifier(text)` maps all four to an email server-side,
so the actor tables need no anon read policy — one would expose the
entire student list to anyone holding the public anon key.

Student IDs are stored bare (`2401187`). The `uc-` prefix exists only at
the login boundary. Storing the prefixed form inserts cleanly and then
fails login silently.

The hyphen in `uc-` is required. `UC2401187` is one keystroke from a
bare ID, and accepting both reintroduces the ambiguity the prefix exists
to remove.

---

### PDF extraction is not reliable for this document

`pdftotext -layout` scrambles the prospectus: merged cells, wrapped
prerequisite lists, symbolic markers (`●`, `●●`, `**`, `***`), and
placeholder codes with underscore runs. OCR from a photograph is worse.

A misread subject code produces a rule that blocks a subject forever
with no error anywhere. Out of scope, recorded under Future Development.

---

A capstone project of the College of Computer Studies,
University of Cebu.
