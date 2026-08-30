# models/

The knowledge model for CurricuLogic's expert system.

## What is not here

No trained models, no weights, no datasets, no checkpoints.

CurricuLogic is a **rule-based expert system** using forward chaining —
symbolic AI, the classical branch, the same family as MYCIN and DENDRAL.
Knowledge is explicitly encoded from the university prospectus rather
than learned from data. Nothing in this project is trained.

That is a design decision, not a limitation. Academic advising requires
deterministic, auditable, explainable decisions. A student denied
eligibility for a subject must be told exactly which prerequisite
failed. A statistical approach would trade that explainability away for
no benefit, because the prerequisite rules are already fully known and
published.

`models/` here means *domain model* — the structured representation of
curriculum knowledge the inference engine reasons over.

## The three layers

An expert system separates knowledge from reasoning. CurricuLogic keeps
them in different directories, deliberately.

| Layer | Location | Contents |
|---|---|---|
| Knowledge base | `models/` | Production rules, curriculum facts, the prospectus as data |
| Working memory | runtime | Facts about one student, loaded per session |
| Inference engine | `engine/` | The matcher that fires rules until nothing new derives |

Eligibility logic must not live in the UI. If prerequisite checks end up
inside `JS/studentdashboard.js`, the system is a form with
if-statements rather than an expert system, and the architectural claim
in the manuscript no longer holds.

## Contents

| File | Purpose |
|---|---|
| — | To be documented as files are added |

## The rule model

Curriculum knowledge is stored in Supabase and mirrored here as the
canonical definition of rule shape.

**Prerequisite edges** — `subject` requires `required_subject`, typed as
`prerequisite`, `co_requisite`, or `standing`. Vocabulary is lowercase
throughout; the database, the engine, and the manuscript must agree.

**AND / OR grouping** — real prospectuses contain rules of the form
"IT 301 requires (IT 201 *or* IT 205) *and* MATH 102." Rules sharing a
group are ORed; separate groups are ANDed. Without this the engine can
only express pure AND chains and breaks on the first real curriculum
edge case.

**Non-subject gates** — year standing and minimum units earned are
requirements that no single subject satisfies. Standing thresholds
encode year completion, not unit totals.

## Explanation traces

Every eligibility decision must carry the rule that produced it. When
the engine blocks a subject, the trace names the specific prerequisite
that failed and the student's status on it.

This is the property that distinguishes an expert system from a filter,
and it is what a panel will ask to see. Any change to the rule model
that makes a decision harder to explain is a change in the wrong
direction.

## Scope

OCR and automated prospectus extraction are out of scope and recorded
under Future Development. Curriculum data is encoded by Department
Staff, who own the programme. The System Administrator is an IT role and
holds no curriculum write access — separation of duties.

## Related

| Path | Contents |
|---|---|
| `engine/` | Forward-chaining inference engine |
| `db/` | Schema migrations, RLS policies, provisioning functions |
| `data/` | Prospectus transcription source files |
| `docs/DECISIONS.md` | Dated architectural decisions |