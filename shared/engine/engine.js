// engine.js
// CurricuLogic inference engine.
//
// Pure functions only. No Supabase, no DOM, no network — facts and rules
// in, results out. That makes it testable without a database and usable
// unchanged in the browser, in Node, or behind an Edge Function.
//
//
// WHAT THIS IS
//
// A forward-chaining rule engine over the prerequisite graph. Knowledge
// lives in the `subject` and `prerequisite` tables; this file contains no
// knowledge of BSIT or of any particular subject. Point it at a different
// prospectus and it reasons over that instead.
//
//
// WHERE THE CHAINING ACTUALLY HAPPENS
//
// Worth being precise, because it is the thing a panel will probe.
//
// Deciding whether a student may take a subject right now is a single
// pass: check each rule against the facts. No chaining required.
//
// Chaining matters for the second question — what becomes reachable if
// the student passes what is recommended. That is genuine forward
// inference: assume the recommended load is passed, derive the newly
// satisfied rules, repeat until no new subject unlocks. The fixpoint is
// what produces the unlock counts used for ranking, and it is what a
// human advisor cannot do reliably across a fifty-eight subject graph.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.CurricuLogicEngine = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';


/* status vocabulary, matching academic_record */

const PASSED   = 'PASSED';
const FAILED   = 'FAILED';
const ENROLLED = 'ENROLLED';

/* requirement_type vocabulary, matching the prerequisite table */

const PREREQUISITE = 'prerequisite';
const CO_REQUISITE = 'co_requisite';
const STANDING     = 'standing';

const DEFAULTS = {
    maxUnits: 24,
    maxUnitsGraduating: 27,
    /* First year level held back by the year gate (see assess). */
    gateFromYear: 3,
    /* Guard only. With an acyclic graph the fixpoint is reached in far
       fewer passes; this stops a cycle that slipped past the integrity
       checks from spinning forever. */
    maxIterations: 20,
};


/* An elective slot, however it was stored. Some rows carry an elective_type
   with is_elective left false (an older save path did that), and treating
   those as required subjects would hold up year-standing checks and inflate
   what the student "owes". Either field marks a slot. */
const isElective = (s) => s.is_elective === true || s.elective_type != null;

/* ---- working memory ---- */

/*
 * Builds the fact base from a student's academic history.
 *
 * A subject may appear several times — academic_record keys on the
 * attempt, so a retake is a separate row. PASSED therefore means ANY
 * attempt passed, not the most recent. Reading only the latest row would
 * be correct by accident on a simple record and wrong the moment a
 * student passes a subject and later audits it.
 */
function buildFacts(student, records, subjects) {
    const byId = new Map(subjects.map(s => [s.id, s]));

    const passed   = new Set();
    const failed   = new Set();
    const enrolled = new Set();

    for (const r of records) {
        if (r.subject_id == null) continue;
        if (r.status === PASSED)   passed.add(r.subject_id);
        if (r.status === FAILED)   failed.add(r.subject_id);
        if (r.status === ENROLLED) enrolled.add(r.subject_id);
    }

    // A passed attempt overrides an earlier failure.
    for (const id of passed) failed.delete(id);

    let unitsEarned = 0;
    for (const id of passed) unitsEarned += Number(byId.get(id)?.units || 0);

    return {
        studentId: student?.id ?? null,
        yearLevel: Number(student?.year_level) || null,
        passed, failed, enrolled,
        unitsEarned,
        completedThroughPosition: highestCompletedPosition(passed, subjects),
        firstIncompletePosition: firstIncompletePosition(passed, subjects),
    };
}

/* A position is Y×10 + T: 11 = Year 1 Term 1, 12 = Year 1 Term 2,
   22 = Year 2 Term 2, and so on. A position is complete when every
   non-elective subject at that position or earlier is passed.
   Iterating positions in order and stopping at the first gap gives
   the highest contiguous position the student has finished. */
function highestCompletedPosition(passed, subjects) {
    const positions = [...new Set(
        subjects
            .filter(s => !isElective(s) && s.year_level != null && s.term != null)
            .map(s => s.year_level * 10 + s.term)
    )].sort((a, b) => a - b);

    let highest = 0;
    for (const pos of positions) {
        const upto = subjects.filter(s =>
            !isElective(s) &&
            s.year_level != null && s.term != null &&
            s.year_level * 10 + s.term <= pos
        );
        if (upto.every(s => passed.has(s.id))) highest = pos;
        else break;
    }
    return highest;
}

/* The earliest position still holding a required subject the student has
   not passed (Infinity when there is none). A standing rule "through
   position N" is met when that is later than N. Asking it this way, rather
   than comparing against the highest position with subjects in it, means a
   semester that holds no subjects (no summer term, or a term emptied by an
   inactive subject) can never leave a gate permanently closed. */
function firstIncompletePosition(passed, subjects) {
    let first = Infinity;
    for (const s of subjects) {
        if (isElective(s) || s.year_level == null || s.term == null) continue;
        if (passed.has(s.id)) continue;
        first = Math.min(first, s.year_level * 10 + s.term);
    }
    return first;
}

/* A standing rule's threshold_value is a position (see above): 22 means
   "through 2nd year, 2nd semester". Some writers stored a bare year (1-9)
   instead, and read against completedThroughPosition that would be met as
   soon as the student finished one semester. A bare year is read as
   "through the end of that year" (2 -> 22), so a rule written either way
   means what its author intended. */
function standingPosition(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return n < 10 ? n * 10 + 2 : n;
}

/* Human-readable label for a position, used in the student-facing
   "Why is this locked?" panel. */
function describePosition(pos) {
    if (!pos) return 'nothing yet';
    const y = Math.floor(pos / 10);
    const t = pos % 10;
    const ord = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th' }[y] || `${y}th`;
    const term = { 1: '1st Semester', 2: '2nd Semester', 3: 'Summer' }[t] || '';
    return `${ord} Year, ${term}`;
}


/* ---- rule evaluation ---- */

/*
 * Evaluates every condition on one subject.
 *
 * rule_group encodes the logic:
 *   same group      -> OR  (any one member satisfies the group)
 *   different groups -> AND (every group must be satisfied)
 *
 * So "(IT 201 or IT 205) and MATH 102" is two conditions in group 1 and
 * one in group 2. A flat list with a per-row AND/OR flag cannot express
 * that unambiguously once a subject has two independent OR sets.
 *
 * Returns a trace either way. An unexplained refusal is the failure this
 * system exists to prevent — a student turned away at the counter with no
 * reason is exactly the situation being replaced.
 */
function evaluateSubject(subject, rules, facts, byId) {
    const groups = new Map();

    for (const r of rules) {
        const g = r.rule_group ?? 1;
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g).push(r);
    }

    const trace = [];
    let satisfied = true;

    for (const [groupId, conditions] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
        const results = conditions.map(c => evaluateCondition(c, facts, byId, subject));
        const met = results.some(r => r.met);

        if (!met) satisfied = false;

        trace.push({
            group: groupId,
            met,
            /* Only a multi-condition group is a real choice. Labelling a
               single condition "any one of" reads as though an
               alternative exists. */
            kind: conditions.length > 1 ? 'any_of' : 'required',
            conditions: results,
        });
    }

    return { satisfied, trace };
}

function evaluateCondition(rule, facts, byId, subject) {
    const type = rule.requirement_type;

    if (type === STANDING) {
        /* A subject cannot require its own semester or a later one: it would
           have to pass itself first and could never open. Such a rule is a
           data mistake (a footnote read as "through 4th year" on a 4th-year
           subject), so it is held to the semester just before the subject. */
        let need = standingPosition(rule.threshold_value);
        if (subject && subject.year_level != null) {
            const own = subject.year_level * 10 + (Number(subject.term) || 1);
            if (need >= own) need = own - 1;
        }
        const have = facts.completedThroughPosition;
        const met  = facts.firstIncompletePosition !== undefined
            ? facts.firstIncompletePosition > need
            : have >= need;
        return {
            type, met,
            threshold: need,
            detail: met
                ? `Completed through ${describePosition(need)}.`
                : `Requires completion through ${describePosition(need)}. ` +
                `Currently through ${describePosition(have)}.`,
        };
    }

    const required = byId.get(rule.prerequisite_subject_id);

    if (!required) {
        /* A rule pointing at a subject that no longer exists. Treating it
           as unmet is the safe reading — silently ignoring it would open
           a gate the department intended to close. */
        return {
            type, met: false,
            detail: 'This condition refers to a subject that is no longer in the prospectus.',
        };
    }

    if (type === CO_REQUISITE) {
        const met = facts.passed.has(required.id) || facts.enrolled.has(required.id);
        return {
            type, met,
            subjectId: required.id, code: required.code, title: required.title,
            detail: met
                ? `${required.code} is passed or currently being taken.`
                : `${required.code} must be passed or taken alongside this subject.`,
        };
    }

    const met = facts.passed.has(required.id);
    const currentlyTaking = facts.enrolled.has(required.id);
    const previouslyFailed = facts.failed.has(required.id);

    return {
        type: PREREQUISITE, met,
        subjectId: required.id, code: required.code, title: required.title,
        detail: met
            ? `${required.code} passed.`
            : currentlyTaking
                ? `${required.code} is in progress. It must be passed first.`
                : previouslyFailed
                    ? `${required.code} was not passed. It must be retaken.`
                    : `${required.code} has not been taken.`,
    };
}


/* ---- forward chaining ---- */

/*
 * Derives which subjects become reachable once the given set is passed,
 * and how many terms away each one is.
 *
 * This is the fixpoint iteration. Start from the student's actual facts,
 * add the assumed passes, then repeatedly scan for subjects whose
 * conditions are now satisfied. Each sweep is one notional term. Stop
 * when a sweep derives nothing new.
 *
 * Depth 1 means "eligible now", depth 2 means "eligible after passing
 * what is eligible now", and so on. That number is what makes a
 * recommendation defensible: taking CC-COMPROG12 is not merely allowed,
 * it is what stands between the student and fifteen later subjects.
 */
function chainForward(facts, kb, assumePassed = []) {
    const passed = new Set(facts.passed);
    for (const id of assumePassed) passed.add(id);

    const working = { ...facts, passed };
    working.completedThroughPosition = highestCompletedPosition(passed, kb.subjects);
    working.firstIncompletePosition = firstIncompletePosition(passed, kb.subjects);

    const depth = new Map();
    let iteration = 0;
    let derivedThisPass;

    do {
        derivedThisPass = 0;
        iteration++;

        const newlyPassed = [];

        for (const subject of kb.subjects) {
            if (working.passed.has(subject.id)) continue;
            if (depth.has(subject.id)) continue;

            const rules = kb.rulesFor(subject.id);
            const { satisfied } = evaluateSubject(subject, rules, working, kb.byId);

            if (satisfied) {
                depth.set(subject.id, iteration);
                newlyPassed.push(subject.id);
                derivedThisPass++;
            }
        }

        /* Assume this notional term is passed before the next sweep —
           that is what makes the next depth level meaningful. */
        for (const id of newlyPassed) working.passed.add(id);
        working.completedThroughPosition = highestCompletedPosition(working.passed, kb.subjects);
        working.firstIncompletePosition = firstIncompletePosition(working.passed, kb.subjects);

    } while (derivedThisPass > 0 && iteration < DEFAULTS.maxIterations);

    return depth;
}

/*
 * How many not-yet-passed subjects sit behind this one in the graph.
 *
 * Measured as transitive dependents: follow the prerequisite edges
 * backwards from this subject and count everything reachable that the
 * student has not already passed.
 *
 * An earlier version compared the forward-chain depth with and without
 * the subject. That was the wrong measure — chainForward assumes each
 * notional term is passed, so every subject is eventually reachable and
 * the difference only expressed how much *sooner* something arrived. The
 * question ranking needs is what is standing behind this subject, which
 * is a property of the graph rather than of the timeline.
 *
 * Conditions in the same rule_group are alternatives, so a subject with
 * two ways in is only half-blocked by either one. Counting it whole
 * would overstate the impact of a prerequisite the student can route
 * around.
 */
function unlockImpact(subjectId, facts, kb) {
    const dependents = kb.dependentsOf(subjectId);
    const seen = new Set([subjectId]);
    const queue = [...dependents];

    let count = 0;

    while (queue.length > 0) {
        const { id, weight } = queue.shift();
        if (seen.has(id)) continue;
        seen.add(id);

        if (facts.passed.has(id)) continue;

        count += weight;

        for (const next of kb.dependentsOf(id)) {
            if (!seen.has(next.id)) queue.push({ id: next.id, weight: weight * next.weight });
        }
    }

    return Math.round(count * 10) / 10;
}


/* ---- main entry point ---- */

/*
 * assess(student, records, knowledgeBase, options)
 *
 *   student  - university_student row
 *   records  - academic_record rows, one per attempt
 *   kb       - { subjects, rules, offerings }
 *   options  - { maxUnits, maxUnitsGraduating, term, respectOfferings,
 *                yearGate (false turns the year gate off), gateFromYear }
 *
 * totalUnits is the degree's own units: subjects placed in a semester
 * (elective slots included), not the optional catalogue entries, and not
 * subjects set inactive that the student never took.
 */
function assess(student, records, knowledgeBase, options = {}) {
    /* A subject the department has set inactive is out of the curriculum:
       it is not offered, not counted, and must not hold up a year-standing
       check. One the student already passed or is taking stays, so their
       record and units still make sense. Filtering here means everything
       below sees the curriculum as it stands. */
    const kept = new Set(records
        .filter(r => r.status === PASSED || r.status === ENROLLED)
        .map(r => r.subject_id));
    const subjects  = (knowledgeBase.subjects ?? [])
        .filter(s => s.is_active !== false || kept.has(s.id));
    const rules     = knowledgeBase.rules     ?? [];
    const offerings = knowledgeBase.offerings ?? [];

    const byId = new Map(subjects.map(s => [s.id, s]));

    const rulesBySubject = new Map();
    for (const r of rules) {
        if (!rulesBySubject.has(r.subject_id)) rulesBySubject.set(r.subject_id, []);
        rulesBySubject.get(r.subject_id).push(r);
    }

    /* Reverse index: which subjects require this one, and how heavily.
       A condition sitting alone in its group blocks its dependent
       outright; one of three alternatives blocks it by a third. */
    const dependents = new Map();
    for (const [subjectId, subjectRules] of rulesBySubject) {
        const groupSize = new Map();
        for (const r of subjectRules) {
            const g = r.rule_group ?? 1;
            groupSize.set(g, (groupSize.get(g) ?? 0) + 1);
        }

        for (const r of subjectRules) {
            if (r.prerequisite_subject_id == null) continue;
            const weight = 1 / groupSize.get(r.rule_group ?? 1);
            if (!dependents.has(r.prerequisite_subject_id)) {
                dependents.set(r.prerequisite_subject_id, []);
            }
            dependents.get(r.prerequisite_subject_id).push({ id: subjectId, weight });
        }
    }

    /* The year-level gate. A curriculum is a chain: a 3rd-year subject is
       not open to a student who has not finished 2nd year, whatever its own
       prerequisites say. This is the system's default for a programme whose
       prospectus states no gates of its own.

       A prospectus that DOES state them (the printed ** / *** footnotes, or a
       "Finished Third Year Subjects" prerequisite) is followed as written:
       its gates apply to the subjects that carry them and nothing else is
       gated. So the default switches off as soon as any subject of this
       prospectus has a standing rule. options.yearGate === false switches it
       off for everyone; gateFromYear moves where it starts. */
    const documented = rules.some(r => r.requirement_type === STANDING && byId.has(r.subject_id));
    const gateFrom = (options.yearGate === false || documented)
        ? Infinity
        : (Number(options.gateFromYear) || DEFAULTS.gateFromYear);

    const gateFor = (id) => {
        const s = byId.get(id);
        const y = Number(s?.year_level);
        if (!s || !Number.isFinite(y) || y < gateFrom) return null;
        const own = rulesBySubject.get(id) ?? [];
        if (own.some(r => r.requirement_type === STANDING)) return null;
        return {
            subject_id: id,
            prerequisite_subject_id: null,
            requirement_type: STANDING,
            rule_type: 'and',
            rule_group: 99,
            threshold_value: (y - 1) * 10 + 2,   // through the end of the year before
            implicit: true,
        };
    };

    const kb = {
        subjects, byId,
        rulesFor: (id) => {
            const own = rulesBySubject.get(id) ?? [];
            const gate = gateFor(id);
            return gate ? [...own, gate] : own;
        },
        dependentsOf: (id) => dependents.get(id) ?? [],
    };

    const facts = buildFacts(student, records, subjects);

    const offeredIds = new Set(offerings.map(o => o.subject_id));
    const useSchedule = options.respectOfferings !== false && offerings.length > 0;

    /* A schedule is rarely published all at once: one section goes up
       before the others. So availability is judged per year-and-semester
       block of the curriculum, not for the whole degree:
         offered   the subject has a section this term
         not-run   its block IS being scheduled but this subject is not, so
                   the department is not running it — not recommended
         pending   nothing in its block is scheduled yet, so there is no
                   evidence either way — recommended from the curriculum and
                   labelled, instead of leaving the student an empty list
         none      no schedule exists at all (or it is switched off)
       Without this, publishing a single section emptied the list of every
       other student. */
    const blockOf = (s) => `${s.year_level ?? '-'}:${s.term ?? '-'}`;
    const scheduledBlocks = new Set(
        useSchedule ? subjects.filter(s => offeredIds.has(s.id)).map(blockOf) : []);
    const scheduleStateOf = (s) => {
        if (!useSchedule) return 'none';
        if (offeredIds.has(s.id)) return 'offered';
        return scheduledBlocks.has(blockOf(s)) ? 'not-run' : 'pending';
    };

    /* ---- elective slots ----
       A slot sits in a semester ("IT Elective 1", year 3); the catalogue is
       the list of real subjects a student picks from to fill one. Passing a
       catalogue subject fills one open slot of its type, earliest semester
       first. A slot can also be passed directly (a grade recorded against the
       placeholder itself), which counts as filled too.
         - a filled slot is done: it is not offered again
         - catalogue subjects beyond the number of slots earn no degree units
         - once every slot of a type is filled, that type's catalogue subjects
           stop being offered: there is nothing left for them to fill
       elective_type is 'IT' (a programme elective) or 'FREE'; none means 'IT'. */
    const typeOf      = (s) => s.elective_type ?? 'IT';
    const isSlot      = (s) => isElective(s) && s.year_level != null;
    const isCatalogue = (s) => isElective(s) && s.year_level == null;
    const positionOf  = (s) => s.year_level * 10 + (Number(s.term) || 0);

    const slotFill = new Map();          // slot id -> the catalogue subject filling it
    const electives = {};                // per type: { slots, filled, remaining, options }
    let overflowUnits = 0;

    for (const type of new Set(subjects.filter(isElective).map(typeOf))) {
        const slots = subjects
            .filter(s => isSlot(s) && typeOf(s) === type)
            .sort((a, b) => positionOf(a) - positionOf(b) || a.code.localeCompare(b.code));
        const direct = slots.filter(s => facts.passed.has(s.id));
        const open   = slots.filter(s => !facts.passed.has(s.id) && !facts.enrolled.has(s.id));
        const picked = subjects.filter(s => isCatalogue(s) && typeOf(s) === type && facts.passed.has(s.id));

        picked.forEach((c, i) => {
            if (i < open.length) slotFill.set(open[i].id, c);
            else overflowUnits += Number(c.units) || 0;
        });

        const filled = direct.length + Math.min(open.length, picked.length);
        electives[type] = {
            slots: slots.length,
            filled,
            remaining: Math.max(0, open.length - picked.length),
            options: 0,
        };
    }
    const unitsEarned = Math.max(0, facts.unitsEarned - overflowUnits);

    const eligible = [];
    const locked   = [];
    const completed = [];
    const inProgress = [];

    for (const subject of subjects) {
        if (facts.passed.has(subject.id))   { completed.push(subject);  continue; }
        if (facts.enrolled.has(subject.id)) { inProgress.push(subject); continue; }

        if (slotFill.has(subject.id)) {
            completed.push({ ...subject, filledBy: slotFill.get(subject.id) });
            continue;
        }
        if (isCatalogue(subject)) {
            const t = electives[typeOf(subject)];
            if (t.slots > 0 && t.remaining === 0) continue;   // every slot of its type is filled
        }

        const subjectRules = kb.rulesFor(subject.id);
        const { satisfied, trace } = evaluateSubject(subject, subjectRules, facts, byId);

        const scheduleState = scheduleStateOf(subject);

        const entry = {
            subject,
            trace,
            /* True when a student could enrol now as far as the schedule
               goes: it has a section, or there is no schedule to judge by. */
            offered: scheduleState === 'offered' || scheduleState === 'none',
            scheduleState,
            sections: offerings.filter(o => o.subject_id === subject.id),
            retake: facts.failed.has(subject.id),
        };

        if (satisfied) {
            eligible.push(entry);
        } else {
            entry.unmet = trace
                .filter(g => !g.met)
                .flatMap(g => g.conditions.filter(c => !c.met));
            locked.push(entry);
        }
    }

    /* Each open slot carries the catalogue options the student can fill it
       with, so a client can say "choose one of N" and list them. */
    for (const type of Object.keys(electives)) {
        electives[type].options = eligible
            .filter(e => isCatalogue(e.subject) && typeOf(e.subject) === type).length;
    }
    for (const e of eligible) {
        if (!isSlot(e.subject)) continue;
        e.slotOptions = eligible
            .filter(o => isCatalogue(o.subject) && typeOf(o.subject) === typeOf(e.subject))
            .map(o => ({ code: o.subject.code, title: o.subject.title, units: o.subject.units }));
    }

    /* Ranking, then the unit cap. */

    for (const e of eligible) {
        e.unlocks = unlockImpact(e.subject.id, facts, kb);
        e.priority = scoreSubject(e, facts);
    }

    eligible.sort((a, b) =>
        b.priority - a.priority ||
        b.unlocks - a.unlocks ||
        (a.subject.year_level ?? 9) - (b.subject.year_level ?? 9) ||
        a.subject.code.localeCompare(b.subject.code));

    /* Units already being carried count against the load. A student is
       "graduating" when everything still unfinished fits inside the
       graduating cap, which is the only case the higher cap applies to. */
    const enrolledUnits = inProgress
        .reduce((t, s) => t + (Number(s.units) || 0), 0);
    /* The degree is the subjects placed in a semester, elective slots
       included. Catalogue entries (no year) are the options a student picks
       to fill those slots, so counting them as well would add every option
       on the list to what is "still to do". */
    const totalUnits = subjects
        .filter(s => s.year_level != null)
        .reduce((t, s) => t + Number(s.units || 0), 0);
    const remainingUnits = Math.max(0, totalUnits - unitsEarned - enrolledUnits);
    const gradCap = Number(options.maxUnitsGraduating) || DEFAULTS.maxUnitsGraduating;
    const graduating = remainingUnits > 0 && remainingUnits <= gradCap;

    const maxUnits = graduating
        ? Math.max(Number(options.maxUnits) || 0, gradCap)
        : (Number(options.maxUnits) || DEFAULTS.maxUnits);
    const availableUnits = Math.max(0, maxUnits - enrolledUnits);

    /* With no schedule to lean on, the curriculum's own term is the next
       best signal for what belongs in this semester. A retake is exempt:
       a failed subject is owed whatever term it was originally placed in. */
    const term = Number(options.term) || null;

    /* Can this subject be enrolled in THIS semester? Eligible only means the
       prerequisites are met; this adds the schedule and the semester:
         - it has a section this term                                  yes
         - its block is being scheduled but it is not run              no (even a retake)
         - nothing says otherwise (no schedule, or its block is not
           scheduled yet): it must belong to the current semester of the
           curriculum, or be a retake, which is owed whatever its term
         - an elective choice (no semester of its own) needs a section
       With no current term given there is nothing to judge by, so it stays yes. */
    for (const e of eligible) {
        let ok;
        if (e.scheduleState === 'offered') ok = true;
        else if (e.scheduleState === 'not-run') ok = false;
        else if (isCatalogue(e.subject)) ok = false;
        else ok = e.retake || term === null || Number(e.subject.term) === term;
        e.availableThisTerm = ok;
    }

    const recommended = [];
    let units = 0;

    for (const e of eligible) {
        /* A catalogue subject is a choice offered to fill a slot, not load
           in its own right: the slot it would fill is what carries the
           units, and it is what gets recommended. */
        if (isCatalogue(e.subject)) continue;

        /* Not run this term, or not this semester's subject: not a
           recommendation. Sending a student to enrol in something with no
           section is the failure this replaces. */
        if (!e.availableThisTerm) continue;

        const u = Number(e.subject.units) || 0;
        if (units + u > availableUnits) continue;

        recommended.push({ ...e, reason: recommendationReason(e, facts) });
        units += u;
    }

    /* Depth from the forward chain tells a locked subject how far off it
       is — one term, two, or unreachable within the horizon. */
    const baseline = chainForward(facts, kb);
    for (const l of locked) {
        l.termsAway = baseline.get(l.subject.id) ?? null;
    }

    return {
        facts: {
            unitsEarned,
            completedThroughPosition: facts.completedThroughPosition,
            passedCount: facts.passed.size,
            failedCount: facts.failed.size,
            enrolledCount: facts.enrolled.size,
        },
        completed,
        inProgress,
        eligible,
        locked,
        recommended,
        recommendedUnits: units,
        maxUnits,
        enrolledUnits,
        availableUnits,
        graduating,
        totalUnits,
        electives,
    };
}


/*
 * Ranking weights.
 *
 * A retake outranks everything: a failed subject blocks its own chain and
 * delays graduation directly. After that, unlock impact — the subject
 * standing in front of the most others. Then cohort alignment, so a
 * student is not pushed forward while owing earlier work.
 */
function scoreSubject(entry, facts) {
    const s = entry.subject;
    let score = 0;

    if (entry.retake) score += 1000;

    score += entry.unlocks * 25;

    /* A catalogue elective has no year, so it is neither owed nor ahead. */
    if (facts.yearLevel && s.year_level != null) {
        const behind = facts.yearLevel - s.year_level;
        if (behind > 0) score += behind * 60;   // owed from an earlier year
        if (behind < 0) score += behind * 30;   // running ahead, deprioritised
    }

    if (!isElective(s)) score += 20;

    return score;
}

function recommendationReason(entry, facts) {
    if (isElective(entry.subject) && entry.subject.year_level != null) {
        const n = entry.slotOptions?.length ?? 0;
        const kind = entry.subject.elective_type === 'FREE' ? 'free elective' : 'programme elective';
        return n > 0
            ? `Elective slot: choose one of ${n} ${kind}${n === 1 ? '' : 's'}.`
            : 'Elective slot: no electives are listed for it yet.';
    }

    if (entry.retake) {
        return entry.unlocks > 0
            ? `Retake. Passing this opens ${Math.round(entry.unlocks)} further subject${entry.unlocks === 1 ? '' : 's'}.`
            : 'Retake. This subject was not passed and is still required.';
    }

    if (entry.unlocks >= 3) {
        return `Opens ${Math.round(entry.unlocks)} later subjects — taking it now avoids a bottleneck.`;
    }

    if (facts.yearLevel && entry.subject.year_level != null
        && entry.subject.year_level < facts.yearLevel) {
        return 'Outstanding from an earlier year level.';
    }

    return 'On track for this year level.';
}


/* Plain-language rendering of a trace, for the "Why is this locked?"
   panel. Kept here rather than in the UI so every client explains a
   result the same way. */
function explain(entry) {
    if (!entry.trace || entry.trace.length === 0) {
        return ['No conditions — this subject is open to any student.'];
    }

    return entry.trace.map(group => {
        const parts = group.conditions.map(c => c.detail);
        const body = group.kind === 'any_of'
            ? 'Any one of: ' + parts.join(' or ')
            : parts.join(' ');
        return (group.met ? '\u2713 ' : '\u2717 ') + body;
    });
}


return {
    assess,
    buildFacts,
    evaluateSubject,
    chainForward,
    highestCompletedPosition,
    firstIncompletePosition,
    isElective,
    describePosition,
    standingPosition,
    explain,
    DEFAULTS,
    PASSED, FAILED, ENROLLED,
    PREREQUISITE, CO_REQUISITE, STANDING,
};

}));