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
Images/     logo and assets
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

## Notes worth keeping

### RLS with no SELECT policy returns empty sets, silently

Not an error. Not a warning. The query succeeds and returns nothing, the
table renders its empty state, and it looks like there is no data.

This has cost four separate debugging cycles on this project —
`audit_log`, `stg_subject`, `stg_prerequisite`, and the admin read path
across the staff tables were all affected.

Before concluding a table is empty:

```sql
select relname, relrowsecurity from pg_class where relname = 'x';
select tablename, policyname, cmd, qual from pg_policies where tablename = 'x';
```

RLS enabled with zero policies means fully closed, not fully open.

### SECURITY DEFINER bypasses RLS entirely

Functions that write to the `auth` schema must be `SECURITY DEFINER`,
which means RLS does not protect them. Two things are then load-bearing:

1. An authorisation guard as the first statement in the function body
2. `revoke execute ... from public, anon`

Postgres grants EXECUTE to PUBLIC on new functions by default. Without
the revoke, anyone holding the anon key can call a provisioning function
from the browser console and grant themselves Department Staff — which
carries write access to the entire knowledge base.

### `auth.identities` is required for password sign-in

Writing `auth.users` alone produces an account that looks correct in
Studio and cannot log in. GoTrue requires a matching identities row with
`provider = 'email'` and `provider_id` set to the user id as text.

The token columns (`confirmation_token`, `recovery_token`,
`email_change`, `email_change_token_new`) should be empty strings, not
null. Some GoTrue versions error on nulls.

### Inspect the schema before writing a migration

The database predates most of these migrations. `007_academic_record.sql`
used `create table if not exists` against a table that already existed,
so it silently did nothing and the real column names differed from the
migration's. That broke two dashboards.

```sql
select column_name, data_type from information_schema.columns
where table_schema = 'public' and table_name = 'x' order by ordinal_position;

select proname, pg_get_function_identity_arguments(oid), prosecdef
from pg_proc where pronamespace = 'public'::regnamespace;
```

`create or replace function` with a changed signature creates a second
overload rather than replacing. PostgREST then fails on ambiguity.

### `auth.uid()` maps to `user_id`, not `id`

Every actor table has both. `auth.uid()` matches `user_id`; every
foreign key targets `id`. Getting this backwards produces policies that
silently match nothing.

### Grades are inverted

1.00 is highest, 5.00 is failing, 3.00 typically passes. The comparison
is `grade <= passing_grade`. Reversing it would mark every passing
student as failed, and the engine would faithfully reason over it.

`academic_record.status` is authoritative. The engine reads `status` and
never re-derives pass or fail from the numeric grade — that logic
belongs to the upload validator, in one place.

### Staging exists so bad data cannot reach the knowledge base

A wrong grade affects one student. A wrong prerequisite affects every
student who ever takes that subject, silently, forever — the engine has
no way to know a rule is wrong, it just enforces it.

Uploads are parsed, validated, and reviewed before commit. A prerequisite
referencing a subject code that does not exist must be rejected, not
warned about.

### PDF extraction is not reliable for this document

`pdftotext -layout` scrambles the prospectus: merged cells, wrapped
prerequisite lists, symbolic markers (`●`, `●●`, `**`, `***`), and
placeholder codes with underscore runs. OCR from a photograph is worse.

A misread subject code produces a rule that blocks a subject forever
with no error anywhere. Out of scope, recorded under Future Development.

---

## Conventions

Commits follow Conventional Commits, short messages, no body unless
needed. Check attribution before pushing — the shared machine has
committed under a teammate's account before.

Code comments are short. `<!-- Dashboard -->`, not decorative banners.

Fonts: Space Grotesk for display, Inter for body, JetBrains Mono for IDs
and codes. Canvas `#F8FAFC`, accent `#4F46E5`. Do not change without
instruction.

Migrations are numbered sequentially in `db/`. Renumber before
committing; the working files use `0XX_` as a placeholder.

---

## Before deploying

- Set `DEBUG_LOGIN = false` in `JS/auth.js` — it reveals whether an
  identifier exists
- Remove the test accounts and the development academic records

---

A capstone project of the College of Computer Studies,
University of Cebu.