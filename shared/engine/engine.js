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
    /* Guard only. With an acyclic graph the fixpoint is reached in far
       fewer passes; this stops a cycle that slipped past the integrity
       checks from spinning forever. */
    maxIterations: 20,
};


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
        completedThroughYear: highestCompletedYear(passed, subjects),
    };
}

/*
 * The highest year level for which every non-elective subject has been
 * passed.
 *
 * This backs the `standing` requirement, which the prospectus expresses
 * as "must finish all 1st to 2nd year courses". A unit threshold would be
 * a weaker reading — a student can reach the unit count while still owing
 * a subject, and would then clear a gate the printed curriculum does not
 * open.
 *
 * Electives are excluded: a student choosing three of seventeen has not
 * failed to complete the year by leaving fourteen untaken.
 */
function highestCompletedYear(passed, subjects) {
    let year = 0;

    for (let y = 1; y <= 4; y++) {
        const required = subjects.filter(s => s.year_level === y && !s.is_elective);
        if (required.length === 0) break;
        if (!required.every(s => passed.has(s.id))) break;
        year = y;
    }

    return year;
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
        const results = conditions.map(c => evaluateCondition(c, facts, byId));
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

function evaluateCondition(rule, facts, byId) {
    const type = rule.requirement_type;

    if (type === STANDING) {
        const need = Number(rule.threshold_value);
        const met  = facts.completedThroughYear >= need;
        return {
            type, met,
            threshold: need,
            detail: met
                ? `All subjects through year ${need} are complete.`
                : `Requires every subject up to year ${need} to be passed. ` +
                  `Currently complete through year ${facts.completedThroughYear || 0}.`,
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
    working.completedThroughYear = highestCompletedYear(passed, kb.subjects);

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
        working.completedThroughYear = highestCompletedYear(working.passed, kb.subjects);

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
 *   options  - { maxUnits, term, respectOfferings }
 */
function assess(student, records, knowledgeBase, options = {}) {
    const subjects  = knowledgeBase.subjects  ?? [];
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

    const kb = {
        subjects, byId,
        rulesFor: (id) => rulesBySubject.get(id) ?? [],
        dependentsOf: (id) => dependents.get(id) ?? [],
    };

    const facts = buildFacts(student, records, subjects);

    const offeredIds = new Set(offerings.map(o => o.subject_id));
    const respectOfferings = options.respectOfferings !== false && offerings.length > 0;

    const eligible = [];
    const locked   = [];
    const completed = [];
    const inProgress = [];

    for (const subject of subjects) {
        if (facts.passed.has(subject.id))   { completed.push(subject);  continue; }
        if (facts.enrolled.has(subject.id)) { inProgress.push(subject); continue; }

        const subjectRules = kb.rulesFor(subject.id);
        const { satisfied, trace } = evaluateSubject(subject, subjectRules, facts, byId);

        const offered = !respectOfferings || offeredIds.has(subject.id);

        const entry = {
            subject,
            trace,
            offered,
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

    /* Ranking, then the unit cap. */

    for (const e of eligible) {
        e.unlocks = unlockImpact(e.subject.id, facts, kb);
        e.priority = scoreSubject(e, facts);
    }

    eligible.sort((a, b) =>
        b.priority - a.priority ||
        b.unlocks - a.unlocks ||
        a.subject.year_level - b.subject.year_level ||
        a.subject.code.localeCompare(b.subject.code));

    const maxUnits = Number(options.maxUnits) || DEFAULTS.maxUnits;
    const recommended = [];
    let units = 0;

    for (const e of eligible) {
        /* A subject that is eligible but not scheduled is not a
           recommendation. Sending a student to enrol in something the
           department is not running is the failure this replaces. */
        if (respectOfferings && !e.offered) continue;

        const u = Number(e.subject.units) || 0;
        if (units + u > maxUnits) continue;

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
            unitsEarned: facts.unitsEarned,
            completedThroughYear: facts.completedThroughYear,
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
        totalUnits: subjects.reduce((t, s) => t + Number(s.units || 0), 0),
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

    if (facts.yearLevel) {
        const behind = facts.yearLevel - s.year_level;
        if (behind > 0) score += behind * 60;   // owed from an earlier year
        if (behind < 0) score += behind * 30;   // running ahead, deprioritised
    }

    if (!s.is_elective) score += 20;

    return score;
}

function recommendationReason(entry, facts) {
    if (entry.retake) {
        return entry.unlocks > 0
            ? `Retake. Passing this opens ${Math.round(entry.unlocks)} further subject${entry.unlocks === 1 ? '' : 's'}.`
            : 'Retake. This subject was not passed and is still required.';
    }

    if (entry.unlocks >= 3) {
        return `Opens ${Math.round(entry.unlocks)} later subjects — taking it now avoids a bottleneck.`;
    }

    if (facts.yearLevel && entry.subject.year_level < facts.yearLevel) {
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
    highestCompletedYear,
    explain,
    DEFAULTS,
    PASSED, FAILED, ENROLLED,
    PREREQUISITE, CO_REQUISITE, STANDING,
};

}));