# knowledge/

The knowledge model for CurricuLogic's expert system, explained.

This folder holds no code and no data. It explains where the knowledge
lives and how the system keeps knowledge apart from reasoning. The rules
themselves are in the database and in `data/prospectus/`; the reasoning is
in `shared/engine/`.

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

"Model" here means *domain model* — the structured representation of
curriculum knowledge the inference engine reasons over.

## The three layers

An expert system separates knowledge from reasoning. CurricuLogic keeps
them in different places, deliberately.

| Layer | Location | Contents |
|---|---|---|
| Knowledge base | Supabase tables `subject` and `prerequisite` (seeded from `data/prospectus/`) | Production rules, curriculum facts, the prospectus as data |
| Working memory | runtime | Facts about one student, loaded per session |
| Inference engine | `shared/engine/` | The matcher that fires rules until nothing new derives |

Eligibility logic must not live in the UI. If prerequisite checks end up
inside `features/student/studentdashboard.js`, the system is a form with
if-statements rather than an expert system, and the architectural claim
in the manuscript no longer holds. The same engine file runs in the
browser and in the server functions (`supabase/functions/assess-student`
and `submit-advising-request`), so the two cannot disagree.

## The rule model

Curriculum knowledge is stored in Supabase. The CSV files in
`data/prospectus/` are the transcribed source it was seeded from.

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

## Where AI is and is not used

The eligibility decision is never made by AI. Two places do use a
generative model (Gemini), and both only read or narrate:

- **Cura**, the student chat (`cura/` and `supabase/functions/eligibility-chat`),
  explains facts the rule engine has already computed. It cannot change a
  decision.
- **Document readers** (`supabase/functions/analyze-curriculum-document` and
  `analyze-schedule-document`) read an uploaded curriculum or schedule file
  and propose rows. Department Staff review every row and save it
  themselves; nothing is saved automatically.

Curriculum data is owned and encoded by Department Staff, who own the
programme. The System Administrator is an IT role and holds no curriculum
write access — separation of duties.

## Related

| Path | Contents |
|---|---|
| `shared/engine/` | Forward-chaining inference engine and student preferences |
| `cura/` | Browser side of the Cura chat |
| `db/` | Schema migrations, RLS policies, provisioning functions |
| `data/prospectus/` | Prospectus transcription source files (CSV) |
| `docs/` | Operations notes, test plans, the Cura chat design |
