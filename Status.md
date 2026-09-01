# Status

Last updated 31 August 2026.

Legend: **Done** — built and verified working. **Partial** — built but
untested, or working with a known gap. **Not started** — no code exists.

---

## Done

### Database

| Item | Notes |
|---|---|
| Schema | 26 tables |
| RLS across actor tables | Own-row reads, staff cross-reads, admin reads |
| Curriculum read policies | `using (true)` for all authenticated actors |
| `resolve_login_identifier` | Email, `uc-`, `EMP-`, and admin username |
| `is_system_admin()` | SECURITY DEFINER, checks `is_approved` |
| `_provision_account` | Shared internal, no grantees |
| `create_staff_account` | Wrapper, guarded, EXECUTE revoked from public |
| `create_user_account` | Bulk wrapper, same guard |
| `bulk_upload_history` | Table plus policies |
| `audit_log` | `record_id` widened to text, admin read policy, now written by provisioning |
| Curriculum staging policies | `stg_subject`, `stg_prerequisite` — see note below |

### Knowledge base

BSIT 2023–2024 fully encoded. 58 subjects, 37 prerequisite rules,
152 core units plus 24 elective units for 176 total. Verified against
the printed prospectus.

### Frontend

| Item | Notes |
|---|---|
| Student login and registration | `uc-` identifier |
| Staff login | `EMP-` identifier |
| Admin login | Username, separate portal |
| Five actor dashboards | Session guards, profile loads, empty states |
| Admin account provisioning | Single-account form, verified end to end |
| Bulk account upload | CSV parse, per-row validation, preview, commit |
| Department curriculum upload | Two-file CSV, validation, preview, commit |
| Prospectus versioning | Copy-forward, activation, version selector |
| Curriculum editor | Subject CRUD, prerequisite editor |
| Integrity checks | Cycle detection on every dashboard load |
| Schedule upload | Template generated from prospectus, Excel and CSV |
| Grade upload | Template, validation, preview, configurable passing grade |
| Setup readiness | Blocked panels explaining what is missing |

### Engine

`engine/engine.js`, 553 lines. Fact building with retake handling, year
standing from completed levels, AND/OR rule groups, standing gates,
co-requisites, forward chaining to fixpoint, unlock impact, scoring,
and explanation traces.

The code is written. See Partial for why it is not counted as finished.

---

## Partial

| Item | Gap |
|---|---|
| **Engine tests** | `tests/engine.test.mjs` is byte-identical to `engine.js`. No tests exist. The OR branch, cycle guard, and standing gates have never executed. |
| Bulk student accounts | Faculty path verified. Student path — `program_id` lookup, 7-digit validation, `uc-` stripping — never run. |
| `must_change_password` | Column set on every provisioned account. Nothing reads it. |
| Bulk role list | `VALID_ROLES` still accepts `admin`. Administrators should not be created from a spreadsheet row. |
| Bulk result banner | Total failure renders in success styling. `failed.length ? 'error' : 'success'`. |
| Staging tables | `stg_subject` and `stg_prerequisite` have policies but nothing writes to them — validation happens in JS. Use them or drop them. |
| Grade upload volume | Single file, sequential commit. At roughly 5,000 rows per term this is slow, non-transactional, and unreviewable. |
| `DEBUG_LOGIN` | Still `true`. |
| Orphan auth users | `tester@gmail.com`, `curriculum@uc.edu.ph` |

---

## Not started

### Correctness — do before defense

| Item | Why it matters |
|---|---|
| `university_student.prospectus_id` | Students are not pinned to a curriculum version. When a second prospectus activates, existing students get assessed against a curriculum they never enrolled under. |
| Single-active-prospectus constraint | Nothing in the database prevents two active versions. Partial unique index on `(program_id) where is_active`. |
| Curriculum changes to `audit_log` | Provisioning writes there; editing a prerequisite — which changes eligibility for everyone — does not. |
| Units total validation | 176 is printed on the prospectus. One check on commit. |

### Engine surfaces

| Item | Notes |
|---|---|
| Student eligibility view | The engine has no UI. Its output is not visible anywhere. |
| Faculty advisee checklist | Prospectus grid in the printed layout, status per subject, engine-filled |
| Advisee assignment data | `advisee_assignment` is empty. One row links Rhea to Althea and makes the demo real. |

### Grade upload redesign

| Item | Notes |
|---|---|
| Multi-file upload | Accept every section file at once |
| Header-embedded metadata | Subject and section read from the sheet, not selected in a form |
| Grouped per-file results | Twenty collapsed rows, not 780 flat ones |
| Batch transactional commit | One RPC per file, all or nothing |
| Skip files with errors | One bad row should not hold up nineteen clean sections |
| Coverage panel | Sections outstanding, by teacher. Needs a `section` table. |

### Deferred

Faculty self-upload of grades. Section and teaching-assignment tables.
Impact preview on rule edits. Version diff. Elective group management
UI. Curriculum export. Grade correction path. One-file prospectus upload
matching the printed layout.

### Out of scope

OCR prospectus extraction. Recorded under Future Development —
extraction accuracy on tabular curriculum documents is not reliable
enough for advisory decisions.

---

## Manuscript

| Item | State |
|---|---|
| **Validation board reframing** | Not done. Pre-development survey figures (90%, 85%, 88%) are presented as post-development outcomes. Highest-risk item at defense. |
| Actor naming sweep | Residual "Enrollment Staff", "Dean", "Academic Advisor" |
| Figure and table numbering | Duplicates and collisions across chapters |
| Front-matter page numbers | Regenerate after renumbering, not before |
| Grade upload authority | Department Staff versus Registrar — undocumented |
| Bootstrap administrator | First admin provisioned out-of-band. Deliberate, unwritten. |
| SECURITY DEFINER rationale | Guard inside the function, EXECUTE revoked. Worth stating. |
| Staging rationale | Bad rules cannot reach the knowledge base. Worth stating. |

---

## The honest summary

Eleven modules are built and most work. The knowledge base is complete
and verified. The engine is written and appears sound on reading.

It has no tests, and its output is not visible in any interface.

Everything else on this list is an improvement to something that already
works. Those two are the difference between a well-built CRUD
application and an expert system.