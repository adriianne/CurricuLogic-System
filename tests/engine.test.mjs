// engine.test.mjs
// Tests for the CurricuLogic inference engine.
//
//   node --test tests/
//
// No database, no npm install. The fixtures below are small synthetic
// curricula, plus a slice of the real BSIT 2023-2024 prospectus where a
// test is about actual encoded rules rather than about the logic.
//
// Two areas get disproportionate attention:
//
//   OR groups. All 37 live prerequisite rules are single-member groups,
//   so the disjunctive branch never executes against real data. If it is
//   broken, only a synthetic rule will reveal it.
//
//   Standing gates. CC-PROFIS10 and IT-CPSTONE30 are the only two rules
//   of that shape in the prospectus, and they gate the capstone.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const E = require('../shared/engine/engine.js');

const { assess, buildFacts, evaluateSubject, chainForward,
        highestCompletedPosition, standingPosition, explain,
        PASSED, FAILED, ENROLLED } = E;


/* ---- fixture helpers ---- */

let nextId = 1;

const subj = (code, opts = {}) => ({
    id: opts.id ?? nextId++,
    code,
    title: opts.title ?? code,
    units: opts.units ?? 3,
    year_level: opts.year ?? 1,
    term: opts.term ?? 1,
    is_elective: opts.elective ?? false,
});

const rule = (subject, required, opts = {}) => ({
    subject_id: subject.id,
    prerequisite_subject_id: required ? required.id : null,
    requirement_type: opts.type ?? 'prerequisite',
    rule_type: 'and',
    rule_group: opts.group ?? 1,
    threshold_value: opts.threshold ?? null,
});

const rec = (subject, status, opts = {}) => ({
    subject_id: subject.id,
    status,
    grade: opts.grade ?? (status === PASSED ? '2.00' : '5.00'),
    taken_year: opts.year ?? 2024,
    taken_term: opts.term ?? 1,
});

const student = (opts = {}) => ({ id: 'stu-1', year_level: opts.year ?? 1 });

const kbOf = (subjects, rules = [], offerings = []) => ({ subjects, rules, offerings });

/* Assess without offering filtering — most tests are about rules, not
   about what the department happens to be running this term. */
const ignoreOfferings = { respectOfferings: false };


/* ---- working memory ---- */

describe('buildFacts', () => {

    test('a passed attempt overrides an earlier failure', () => {
        const a = subj('A');
        const facts = buildFacts(student(), [
            rec(a, FAILED, { term: 1 }),
            rec(a, PASSED, { term: 2 }),
        ], [a]);

        assert.ok(facts.passed.has(a.id), 'retake should count as passed');
        assert.ok(!facts.failed.has(a.id), 'the earlier failure should be cleared');
    });

    test('order does not matter — a failure recorded after a pass still clears', () => {
        const a = subj('A');
        const facts = buildFacts(student(), [
            rec(a, PASSED, { term: 1 }),
            rec(a, FAILED, { term: 2 }),
        ], [a]);

        assert.ok(facts.passed.has(a.id));
        assert.ok(!facts.failed.has(a.id));
    });

    test('units earned counts only passed subjects', () => {
        const a = subj('A', { units: 3 });
        const b = subj('B', { units: 2 });
        const c = subj('C', { units: 5 });

        const facts = buildFacts(student(), [
            rec(a, PASSED), rec(b, FAILED), rec(c, ENROLLED),
        ], [a, b, c]);

        assert.equal(facts.unitsEarned, 3);
    });

    test('enrolled is distinct from passed', () => {
        const a = subj('A');
        const facts = buildFacts(student(), [rec(a, ENROLLED)], [a]);

        assert.ok(facts.enrolled.has(a.id));
        assert.ok(!facts.passed.has(a.id));
    });

    test('a record with no subject_id is ignored rather than throwing', () => {
        const a = subj('A');
        const facts = buildFacts(student(),
            [{ subject_id: null, status: PASSED }, rec(a, PASSED)], [a]);

        assert.equal(facts.passed.size, 1);
    });

    test('an empty history produces empty facts, not an error', () => {
        const facts = buildFacts(student(), [], [subj('A')]);
        assert.equal(facts.passed.size, 0);
        assert.equal(facts.unitsEarned, 0);
        assert.equal(facts.completedThroughPosition, 0);
    });
});


/* ---- standing (position = year × 10 + term) ---- */

describe('highestCompletedPosition', () => {

    test('a position counts only when every required subject up to it is passed', () => {
        const a = subj('A', { year: 1, term: 1 });
        const b = subj('B', { year: 1, term: 2 });
        const subjects = [a, b];

        assert.equal(highestCompletedPosition(new Set([a.id]), subjects), 11);
        assert.equal(highestCompletedPosition(new Set([a.id, b.id]), subjects), 12);
        assert.equal(highestCompletedPosition(new Set(), subjects), 0);
    });

    test('electives do not hold a position back', () => {
        const core = subj('CORE', { year: 1, term: 1 });
        const el   = subj('EL', { year: 1, term: 1, elective: true });

        assert.equal(highestCompletedPosition(new Set([core.id]), [core, el]), 11,
            'choosing not to take an elective is not an incomplete term');
    });

    test('completion stops at the first incomplete position', () => {
        const y1 = subj('Y1', { year: 1 });
        const y2 = subj('Y2', { year: 2 });
        const y3 = subj('Y3', { year: 3 });
        const subjects = [y1, y2, y3];

        // Third year passed, second year still owing.
        const passed = new Set([y1.id, y3.id]);
        assert.equal(highestCompletedPosition(passed, subjects), 11,
            'a later year passed out of order must not raise standing');
    });
});


/* ---- rule evaluation ---- */

describe('evaluateSubject — AND across groups', () => {

    test('every group must be satisfied', () => {
        const a = subj('A'), b = subj('B'), target = subj('T');
        const rules = [
            rule(target, a, { group: 1 }),
            rule(target, b, { group: 2 }),
        ];
        const byId = new Map([a, b, target].map(s => [s.id, s]));

        const only_a = buildFacts(student(), [rec(a, PASSED)], [a, b, target]);
        assert.equal(evaluateSubject(target, rules, only_a, byId).satisfied, false);

        const both = buildFacts(student(), [rec(a, PASSED), rec(b, PASSED)], [a, b, target]);
        assert.equal(evaluateSubject(target, rules, both, byId).satisfied, true);
    });
});

describe('evaluateSubject — OR within a group', () => {
    // No live rule exercises this. These are the only tests that do.

    test('any one member of a group satisfies it', () => {
        const a = subj('A'), b = subj('B'), target = subj('T');
        const rules = [
            rule(target, a, { group: 1 }),
            rule(target, b, { group: 1 }),
        ];
        const byId = new Map([a, b, target].map(s => [s.id, s]));

        const viaA = buildFacts(student(), [rec(a, PASSED)], [a, b, target]);
        assert.equal(evaluateSubject(target, rules, viaA, byId).satisfied, true,
            'passing A alone should open T');

        const viaB = buildFacts(student(), [rec(b, PASSED)], [a, b, target]);
        assert.equal(evaluateSubject(target, rules, viaB, byId).satisfied, true,
            'passing B alone should open T');

        const neither = buildFacts(student(), [], [a, b, target]);
        assert.equal(evaluateSubject(target, rules, neither, byId).satisfied, false);
    });

    test('a group with alternatives is labelled any_of, a lone condition is not', () => {
        const a = subj('A'), b = subj('B'), target = subj('T');
        const byId = new Map([a, b, target].map(s => [s.id, s]));
        const facts = buildFacts(student(), [], [a, b, target]);

        const choice = evaluateSubject(target,
            [rule(target, a, { group: 1 }), rule(target, b, { group: 1 })], facts, byId);
        assert.equal(choice.trace[0].kind, 'any_of');

        const single = evaluateSubject(target,
            [rule(target, a, { group: 1 })], facts, byId);
        assert.equal(single.trace[0].kind, 'required',
            'a single condition must not read as though an alternative exists');
    });

    test('mixed shape: (A or B) and C', () => {
        const a = subj('A'), b = subj('B'), c = subj('C'), target = subj('T');
        const all = [a, b, c, target];
        const byId = new Map(all.map(s => [s.id, s]));
        const rules = [
            rule(target, a, { group: 1 }),
            rule(target, b, { group: 1 }),
            rule(target, c, { group: 2 }),
        ];

        const aOnly = buildFacts(student(), [rec(a, PASSED)], all);
        assert.equal(evaluateSubject(target, rules, aOnly, byId).satisfied, false,
            'the second group is still unmet');

        const aAndC = buildFacts(student(), [rec(a, PASSED), rec(c, PASSED)], all);
        assert.equal(evaluateSubject(target, rules, aAndC, byId).satisfied, true);

        const bAndC = buildFacts(student(), [rec(b, PASSED), rec(c, PASSED)], all);
        assert.equal(evaluateSubject(target, rules, bAndC, byId).satisfied, true,
            'either branch of the disjunction must work');
    });
});


/* ---- condition types ---- */

describe('conditions', () => {

    test('a standing gate reads year completion, not units', () => {
        const y1a = subj('Y1A', { year: 1, units: 3 });
        const y1b = subj('Y1B', { year: 1, units: 3 });
        const gated = subj('GATED', { year: 2 });
        const all = [y1a, y1b, gated];
        const byId = new Map(all.map(s => [s.id, s]));
        // 11 = through 1st year, 1st sem: both fixture subjects sit there.
        const rules = [rule(gated, null, { type: 'standing', threshold: 11 })];

        const partial = buildFacts(student(), [rec(y1a, PASSED)], all);
        assert.equal(evaluateSubject(gated, rules, partial, byId).satisfied, false,
            'six units earned but the year is incomplete');

        const whole = buildFacts(student(),
            [rec(y1a, PASSED), rec(y1b, PASSED)], all);
        assert.equal(evaluateSubject(gated, rules, whole, byId).satisfied, true);
    });

    test('a co-requisite accepts a subject being taken concurrently', () => {
        const a = subj('A'), target = subj('T');
        const byId = new Map([a, target].map(s => [s.id, s]));
        const rules = [rule(target, a, { type: 'co_requisite' })];

        const taking = buildFacts(student(), [rec(a, ENROLLED)], [a, target]);
        assert.equal(evaluateSubject(target, rules, taking, byId).satisfied, true);

        const plain = buildFacts(student(), [], [a, target]);
        assert.equal(evaluateSubject(target, rules, plain, byId).satisfied, false);
    });

    test('a prerequisite does NOT accept a subject still in progress', () => {
        const a = subj('A'), target = subj('T');
        const byId = new Map([a, target].map(s => [s.id, s]));
        const rules = [rule(target, a)];

        const taking = buildFacts(student(), [rec(a, ENROLLED)], [a, target]);
        const result = evaluateSubject(target, rules, taking, byId);

        assert.equal(result.satisfied, false);
        assert.match(result.trace[0].conditions[0].detail, /in progress/i,
            'the reason must distinguish in-progress from never taken');
    });

    test('a rule pointing at a missing subject is unmet, not ignored', () => {
        const target = subj('T');
        const byId = new Map([[target.id, target]]);
        const rules = [{
            subject_id: target.id,
            prerequisite_subject_id: 999999,
            requirement_type: 'prerequisite',
            rule_group: 1,
        }];

        const facts = buildFacts(student(), [], [target]);
        const result = evaluateSubject(target, rules, facts, byId);

        assert.equal(result.satisfied, false,
            'silently dropping a dangling rule would open a gate the department closed');
    });

    test('a failed prerequisite is reported as needing a retake', () => {
        const a = subj('A'), target = subj('T');
        const byId = new Map([a, target].map(s => [s.id, s]));

        const facts = buildFacts(student(), [rec(a, FAILED)], [a, target]);
        const result = evaluateSubject(target, [rule(target, a)], facts, byId);

        assert.match(result.trace[0].conditions[0].detail, /retake/i);
    });

    test('a subject with no rules at all is open', () => {
        const target = subj('T');
        const byId = new Map([[target.id, target]]);
        const facts = buildFacts(student(), [], [target]);

        assert.equal(evaluateSubject(target, [], facts, byId).satisfied, true);
    });
});


/* ---- forward chaining ---- */

describe('chainForward', () => {

    test('depth increases along a chain', () => {
        const a = subj('A'), b = subj('B'), c = subj('C');
        const subjects = [a, b, c];
        const rules = [rule(b, a), rule(c, b)];

        const kb = buildKb(subjects, rules);
        const facts = buildFacts(student(), [rec(a, PASSED)], subjects);
        const reach = chainForward(facts, kb);

        assert.equal(reach.get(b.id), 1, 'B is open now');
        assert.equal(reach.get(c.id), 2, 'C opens once B is passed');
    });

    test('a subject behind an unmet branch is not reachable', () => {
        const a = subj('A'), b = subj('B'), target = subj('T');
        const subjects = [a, b, target];
        // T needs A and B; only A is ever passed and B has no route.
        const rules = [rule(target, a, { group: 1 }), rule(target, b, { group: 2 })];

        const kb = buildKb(subjects, rules);
        const facts = buildFacts(student(), [rec(a, PASSED)], subjects);
        const reach = chainForward(facts, kb);

        assert.equal(reach.get(b.id), 1, 'B itself has no prerequisites');
        assert.equal(reach.get(target.id), 2, 'T follows once B is taken');
    });

    test('a cycle terminates instead of spinning', () => {
        const a = subj('A'), b = subj('B');
        const subjects = [a, b];
        const rules = [rule(a, b), rule(b, a)];   // mutually dependent

        const kb = buildKb(subjects, rules);
        const facts = buildFacts(student(), [], subjects);

        const reach = chainForward(facts, kb);
        assert.equal(reach.size, 0, 'neither subject is ever reachable');
    });

    test('assumed passes open what they should', () => {
        const a = subj('A'), b = subj('B');
        const subjects = [a, b];
        const rules = [rule(b, a)];

        const kb = buildKb(subjects, rules);
        const facts = buildFacts(student(), [], subjects);

        assert.equal(chainForward(facts, kb).get(b.id), 2);
        assert.equal(chainForward(facts, kb, [a.id]).get(b.id), 1,
            'assuming A is passed brings B one term closer');
    });
});

/* chainForward takes the internal kb shape assess() builds. */
function buildKb(subjects, rules) {
    const byId = new Map(subjects.map(s => [s.id, s]));

    const bySubject = new Map();
    for (const r of rules) {
        if (!bySubject.has(r.subject_id)) bySubject.set(r.subject_id, []);
        bySubject.get(r.subject_id).push(r);
    }

    const dependents = new Map();
    for (const [sid, rs] of bySubject) {
        const size = new Map();
        for (const r of rs) {
            const g = r.rule_group ?? 1;
            size.set(g, (size.get(g) ?? 0) + 1);
        }
        for (const r of rs) {
            if (r.prerequisite_subject_id == null) continue;
            const w = 1 / size.get(r.rule_group ?? 1);
            if (!dependents.has(r.prerequisite_subject_id)) {
                dependents.set(r.prerequisite_subject_id, []);
            }
            dependents.get(r.prerequisite_subject_id).push({ id: sid, weight: w });
        }
    }

    return {
        subjects, byId,
        rulesFor: id => bySubject.get(id) ?? [],
        dependentsOf: id => dependents.get(id) ?? [],
    };
}


/* ---- the real prospectus ---- */

describe('BSIT 2023-2024', () => {

    /* A slice of the real curriculum. Codes, units, year levels and rules
       are as encoded in the database. */
    function bsit() {
        nextId = 100;

        const intcom  = subj('CC-INTCOM11',   { year: 1, term: 1 });
        const prog1   = subj('CC-COMPROG11',  { year: 1, term: 1 });
        const engl100 = subj('ENGL 100',      { year: 1, term: 1 });
        const prog2   = subj('CC-COMPROG12',  { year: 1, term: 2 });
        const discret = subj('CC-DISCRET12',  { year: 1, term: 2 });
        const engl101 = subj('ENGL 101',      { year: 1, term: 2 });

        const oop     = subj('IT-OOPROG21',   { year: 2, term: 1 });
        const sad     = subj('IT-SAD21',      { year: 2, term: 1 });
        const twrite  = subj('CC-TWRITE21',   { year: 2, term: 1 });
        const appsdev = subj('CC-APPSDEV22',  { year: 2, term: 2 });

        const profis  = subj('CC-PROFIS10',   { year: 3, term: 3 });

        const subjects = [intcom, prog1, engl100, prog2, discret, engl101,
                          oop, sad, twrite, appsdev, profis];

        const rules = [
            rule(prog2,   prog1),
            rule(discret, intcom),
            rule(engl101, engl100),
            rule(oop,     prog2),
            rule(sad,     prog2),
            rule(twrite,  engl101, { group: 1 }),
            rule(twrite,  intcom,  { group: 2 }),
            // CC-APPSDEV22 requires both, in separate groups.
            rule(appsdev, oop, { group: 1 }),
            rule(appsdev, sad, { group: 2 }),
            // "must finish all 1st year to 2nd year courses"
            rule(profis, null, { type: 'standing', threshold: 22 }),
        ];

        return { subjects, rules, byCode: c => subjects.find(s => s.code === c) };
    }

    test('a new student can take only the subjects with no prerequisites', () => {
        const { subjects, rules, byCode } = bsit();
        const out = assess(student(), [], kbOf(subjects, rules), ignoreOfferings);

        const open = out.eligible.map(e => e.subject.code).sort();
        assert.deepEqual(open, ['CC-COMPROG11', 'CC-INTCOM11', 'ENGL 100'],
            'first-term subjects only');

        assert.ok(out.locked.some(l => l.subject.code === 'CC-APPSDEV22'));
    });

    test('CC-APPSDEV22 needs both IT-OOPROG21 and IT-SAD21', () => {
        const { subjects, rules, byCode } = bsit();
        const oop = byCode('IT-OOPROG21');
        const sad = byCode('IT-SAD21');

        const half = assess(student(), [rec(oop, PASSED)],
            kbOf(subjects, rules), ignoreOfferings);
        assert.ok(half.locked.some(l => l.subject.code === 'CC-APPSDEV22'),
            'one of the two is not enough');

        const both = assess(student(), [rec(oop, PASSED), rec(sad, PASSED)],
            kbOf(subjects, rules), ignoreOfferings);
        assert.ok(both.eligible.some(e => e.subject.code === 'CC-APPSDEV22'));
    });

    test('CC-PROFIS10 stays locked until every first and second year subject is passed', () => {
        const { subjects, rules } = bsit();
        const core = subjects.filter(s => s.year_level <= 2);

        const allButOne = core.slice(1).map(s => rec(s, PASSED));
        const partial = assess(student({ year: 3 }), allButOne,
            kbOf(subjects, rules), ignoreOfferings);
        assert.ok(partial.locked.some(l => l.subject.code === 'CC-PROFIS10'),
            'one outstanding subject must keep the gate closed');

        const complete = assess(student({ year: 3 }), core.map(s => rec(s, PASSED)),
            kbOf(subjects, rules), ignoreOfferings);
        assert.ok(complete.eligible.some(e => e.subject.code === 'CC-PROFIS10'));
    });

    test('a failed subject is recommended ahead of new work', () => {
        const { subjects, rules, byCode } = bsit();
        const prog1 = byCode('CC-COMPROG11');

        const out = assess(student(), [rec(prog1, FAILED)],
            kbOf(subjects, rules), ignoreOfferings);

        assert.equal(out.recommended[0].subject.code, 'CC-COMPROG11');
        assert.equal(out.recommended[0].retake, true);
    });

    test('the unit cap is respected', () => {
        const { subjects, rules } = bsit();
        const out = assess(student(), [], kbOf(subjects, rules),
            { ...ignoreOfferings, maxUnits: 6 });

        assert.ok(out.recommendedUnits <= 6);
        assert.equal(out.recommended.length, 2, 'two three-unit subjects fit');
    });

    test('a locked subject knows how many terms away it is', () => {
        const { subjects, rules } = bsit();
        const out = assess(student(), [], kbOf(subjects, rules), ignoreOfferings);

        const appsdev = out.locked.find(l => l.subject.code === 'CC-APPSDEV22');
        assert.ok(appsdev.termsAway >= 3,
            'COMPROG11 -> COMPROG12 -> OOPROG21 -> APPSDEV22');
    });

    test('every locked subject carries at least one unmet reason', () => {
        const { subjects, rules } = bsit();
        const out = assess(student(), [], kbOf(subjects, rules), ignoreOfferings);

        for (const l of out.locked) {
            assert.ok(l.unmet.length > 0,
                `${l.subject.code} is locked with no reason given`);
        }
    });

    test('a passed subject is completed, not eligible', () => {
        const { subjects, rules, byCode } = bsit();
        const intcom = byCode('CC-INTCOM11');

        const out = assess(student(), [rec(intcom, PASSED)],
            kbOf(subjects, rules), ignoreOfferings);

        assert.ok(out.completed.some(s => s.code === 'CC-INTCOM11'));
        assert.ok(!out.eligible.some(e => e.subject.code === 'CC-INTCOM11'));
    });

    test('an enrolled subject is in progress, not eligible', () => {
        const { subjects, rules, byCode } = bsit();
        const intcom = byCode('CC-INTCOM11');

        const out = assess(student(), [rec(intcom, ENROLLED)],
            kbOf(subjects, rules), ignoreOfferings);

        assert.ok(out.inProgress.some(s => s.code === 'CC-INTCOM11'));
        assert.ok(!out.eligible.some(e => e.subject.code === 'CC-INTCOM11'));
    });
});


/* ---- offerings ---- */

describe('offerings', () => {

    test('an eligible subject that is not offered is not recommended', () => {
        const a = subj('A'), b = subj('B');
        const subjects = [a, b];
        const kb = kbOf(subjects, [], [{ subject_id: a.id, section: '1-A' }]);

        const out = assess(student(), [], kb);

        assert.equal(out.eligible.length, 2, 'both are eligible by the rules');
        assert.deepEqual(out.recommended.map(r => r.subject.code), ['A'],
            'only the one actually being run is recommended');
    });
});


/* ---- term filter, load cap ---- */

describe('term filter', () => {

    test('without offerings, only the current term is recommended', () => {
        const t1 = subj('T1', { year: 1, term: 1 });
        const t2 = subj('T2', { year: 1, term: 2 });

        const out = assess(student(), [], kbOf([t1, t2]),
            { ...ignoreOfferings, term: 1 });

        assert.equal(out.eligible.length, 2, 'both are still eligible by the rules');
        assert.deepEqual(out.recommended.map(r => r.subject.code), ['T1']);
    });

    test('a retake is recommended whatever term it belongs to', () => {
        const t1 = subj('T1', { year: 1, term: 1 });
        const t2 = subj('T2', { year: 1, term: 2 });

        const out = assess(student(), [rec(t2, FAILED)], kbOf([t1, t2]),
            { ...ignoreOfferings, term: 1 });

        assert.deepEqual(out.recommended.map(r => r.subject.code).sort(), ['T1', 'T2']);
    });

    test('a scheduled subject is recommended whatever its curriculum term', () => {
        const t1 = subj('T1', { year: 1, term: 1 });
        const t2 = subj('T2', { year: 1, term: 2 });
        const kb = kbOf([t1, t2], [], [{ subject_id: t2.id, section: '1-A' }]);

        const out = assess(student(), [], kb, { term: 1 });

        const t2out = out.recommended.find(r => r.subject.code === 'T2');
        assert.equal(t2out.scheduleState, 'offered');
        // T1's semester has nothing scheduled yet, so it is judged by the
        // curriculum (its term matches) and labelled as pending.
        assert.equal(out.recommended.find(r => r.subject.code === 'T1').scheduleState, 'pending');
    });

    test('no term option leaves recommendations unfiltered', () => {
        const t1 = subj('T1', { year: 1, term: 1 });
        const t2 = subj('T2', { year: 1, term: 2 });

        const out = assess(student(), [], kbOf([t1, t2]), ignoreOfferings);

        assert.equal(out.recommended.length, 2);
    });
});

describe('unit cap', () => {

    const many = (n) => Array.from({ length: n }, (_, i) => subj('S' + i, { units: 3 }));

    test('units already being carried count against the cap', () => {
        const subjects = many(20);
        const out = assess(student(), [rec(subjects[0], ENROLLED)],
            kbOf(subjects), ignoreOfferings);

        assert.equal(out.enrolledUnits, 3);
        assert.equal(out.availableUnits, 21);
        assert.equal(out.recommended.length, 7);
        assert.ok(out.recommendedUnits <= out.availableUnits);
    });

    test('the standard cap is 24', () => {
        const out = assess(student(), [], kbOf(many(20)), ignoreOfferings);

        assert.equal(out.graduating, false);
        assert.equal(out.maxUnits, 24);
        assert.equal(out.recommendedUnits, 24);
    });

    test('a student whose remaining work fits in 27 units gets the graduating cap', () => {
        const subjects = many(10);   // 30 units in the curriculum
        const out = assess(student(), [rec(subjects[0], PASSED)],
            kbOf(subjects), ignoreOfferings);

        assert.equal(out.graduating, true);
        assert.equal(out.maxUnits, 27);
        assert.equal(out.recommendedUnits, 27);
    });

    test('a student with a full curriculum still ahead is not graduating', () => {
        const subjects = many(12);   // 36 units, one passed -> 33 remaining
        const out = assess(student(), [rec(subjects[0], PASSED)],
            kbOf(subjects), ignoreOfferings);

        assert.equal(out.graduating, false);
        assert.equal(out.maxUnits, 24);
    });
});


/* ---- explanations ---- */

describe('explain', () => {

    test('a locked subject explains which condition failed', () => {
        const a = subj('A'), target = subj('T');
        const out = assess(student(), [], kbOf([a, target], [rule(target, a)]),
            ignoreOfferings);

        const locked = out.locked.find(l => l.subject.code === 'T');
        const lines = explain(locked);

        assert.ok(lines.length > 0);
        assert.ok(lines.some(l => l.includes('A')),
            'the blocking subject must be named');
    });

    test('an alternative group is explained as a choice', () => {
        const a = subj('A'), b = subj('B'), target = subj('T');
        const rules = [rule(target, a, { group: 1 }), rule(target, b, { group: 1 })];

        const out = assess(student(), [], kbOf([a, b, target], rules), ignoreOfferings);
        const locked = out.locked.find(l => l.subject.code === 'T');

        assert.ok(explain(locked).some(l => /any one of/i.test(l)),
            'a disjunction must not read as though both are required');
    });
});


/* ---- standing thresholds are positions ---- */

describe('standingPosition', () => {
    test('a position is used as it is', () => {
        for (const p of [11, 12, 21, 22, 31, 32, 41]) assert.equal(standingPosition(p), p);
        assert.equal(standingPosition('22'), 22);
    });
    test('a bare year (1-9) means through the end of that year', () => {
        assert.equal(standingPosition(1), 12);
        assert.equal(standingPosition(2), 22);
        assert.equal(standingPosition(3), 32);
        assert.equal(standingPosition('2'), 22);
    });
    test('nothing usable means no requirement', () => {
        assert.equal(standingPosition(null), 0);
        assert.equal(standingPosition(undefined), 0);
        assert.equal(standingPosition(0), 0);
        assert.equal(standingPosition('abc'), 0);
    });
});

describe('a standing gate is not met by partial progress', () => {
    // Year 1 has two semesters; the gate is "finish all of 2nd year".
    const y11 = subj('Y11', { year: 1, term: 1 });
    const y12 = subj('Y12', { year: 1, term: 2 });
    const y21 = subj('Y21', { year: 2, term: 1 });
    const y22 = subj('Y22', { year: 2, term: 2 });
    const gated = subj('G31', { year: 3, term: 1 });
    const all = [y11, y12, y21, y22, gated];
    const byId = new Map(all.map(s => [s.id, s]));
    const met = (records, threshold) => evaluateSubject(
        gated, [rule(gated, null, { type: 'standing', threshold })],
        buildFacts(student(), records, all), byId).satisfied;


    for (const threshold of [22, 2]) {
        const label = threshold === 22 ? 'position 22' : 'legacy year 2';
        test(label + ': first year only leaves it closed', () => {
            assert.equal(met([rec(y11, PASSED), rec(y12, PASSED)], threshold), false);
        });
        test(label + ': all of second year opens it', () => {
            assert.equal(met([rec(y11, PASSED), rec(y12, PASSED),
                              rec(y21, PASSED), rec(y22, PASSED)], threshold), true);
        });
        test(label + ': one second-year subject short keeps it closed', () => {
            assert.equal(met([rec(y11, PASSED), rec(y12, PASSED), rec(y21, PASSED)], threshold), false);
        });
    }
});


/* ---- the degree's units: what counts toward "still to do" ---- */

describe('totalUnits and the graduating cap', () => {
    const many = (n, opts = {}) => Array.from({ length: n }, (_, i) => subj('D' + i, { units: 3, ...opts }));
    // An elective catalogue entry: no year, no term, an option a student picks.
    const catalogue = (n) => Array.from({ length: n }, (_, i) =>
        ({ ...subj('CAT' + i, { units: 3, elective: true }), year_level: null, term: null }));

    test('catalogue electives are not part of the degree total', () => {
        const scheduled = many(10);                 // 30 units
        const out = assess(student(), [], kbOf([...scheduled, ...catalogue(6)]), ignoreOfferings);
        assert.equal(out.totalUnits, 30);
    });

    test('a catalogue does not stop a student who is nearly done from being "graduating"', () => {
        // 10 scheduled subjects (30 units), 2 passed -> 24 left, which fits under 27.
        // Six catalogue options (18 units) used to push "remaining" to 42.
        const scheduled = many(10);
        const passed = [rec(scheduled[0], PASSED), rec(scheduled[1], PASSED)];
        const out = assess(student(), passed, kbOf([...scheduled, ...catalogue(6)]), ignoreOfferings);
        assert.equal(out.graduating, true);
        assert.equal(out.maxUnits, 27);
    });

    test('a catalogue elective is not boosted as "owed from an earlier year"', () => {
        const core = subj('CORE', { year: 3, units: 3 });
        const [opt] = catalogue(1);
        const out = assess(student({ year: 3 }), [], kbOf([core, opt]), ignoreOfferings);
        const eOpt = out.eligible.find(e => e.subject.id === opt.id);
        assert.ok(!Number.isNaN(eOpt.priority));
        assert.ok(eOpt.priority < out.eligible.find(e => e.subject.id === core.id).priority,
            'a required subject outranks an optional catalogue entry');
        const reason = out.recommended.find(r => r.subject.id === opt.id)?.reason ?? '';
        assert.ok(!/earlier year/.test(reason));
    });

    test('remaining units never go negative when electives push earned above the total', () => {
        const scheduled = many(2);                  // 6 units
        const extra = catalogue(3);                 // 9 units of electives passed
        const out = assess(student(),
            [...scheduled, ...extra].map(s => rec(s, PASSED)),
            kbOf([...scheduled, ...extra]), ignoreOfferings);
        assert.equal(out.graduating, false, 'nothing left to take is not "graduating"');
    });
});

describe('inactive subjects', () => {
    test('an inactive subject the student never took is out of the plan and the total', () => {
        const a = subj('A'), b = subj('B'), gone = { ...subj('GONE'), is_active: false };
        const out = assess(student(), [], kbOf([a, b, gone]), ignoreOfferings);
        const codes = [...out.eligible, ...out.locked].map(e => e.subject.code);
        assert.ok(!codes.includes('GONE'));
        assert.equal(out.totalUnits, 6);
        assert.ok(!out.recommended.some(r => r.subject.code === 'GONE'));
    });

    test('an inactive subject the student passed still counts as completed', () => {
        const a = subj('A'), old = { ...subj('OLD'), is_active: false };
        const out = assess(student(), [rec(old, PASSED)], kbOf([a, old]), ignoreOfferings);
        assert.ok(out.completed.some(s => s.code === 'OLD'));
        assert.equal(out.totalUnits, 6);
        assert.equal(out.facts.unitsEarned, 3);
    });

    test('an unpassed inactive subject cannot hold up a year-standing gate', () => {
        const y11 = subj('Y11', { year: 1, term: 1 });
        const gone = { ...subj('GONE', { year: 1, term: 2 }), is_active: false };
        const gated = subj('G21', { year: 2, term: 1 });
        const rules = [rule(gated, null, { type: 'standing', threshold: 12 })];
        const out = assess(student({ year: 2 }), [rec(y11, PASSED)],
            kbOf([y11, gone, gated], rules), ignoreOfferings);
        assert.ok(out.eligible.some(e => e.subject.code === 'G21'),
            'first year is finished once the only active subject is passed');
    });

    test('a subject without an is_active field is treated as active', () => {
        const a = subj('A');
        const out = assess(student(), [], kbOf([a]), ignoreOfferings);
        assert.equal(out.totalUnits, 3);
    });
});

describe('a standing gate at a semester that holds no subjects', () => {
    test('is met once everything at or before it is passed, and not before', () => {
        const y11 = subj('Y11', { year: 1, term: 1 });
        const y12 = subj('Y12', { year: 1, term: 2 });
        const gated = subj('G21', { year: 2, term: 1 });
        // 13 = through 1st-year summer; this programme has no summer subjects.
        const rules = [rule(gated, null, { type: 'standing', threshold: 13 })];
        const all = [y11, y12, gated];
        const byId = new Map(all.map(s => [s.id, s]));
        const sat = (records) => evaluateSubject(gated, rules, buildFacts(student(), records, all), byId).satisfied;

        assert.equal(sat([rec(y11, PASSED)]), false, 'Y12 is still owed');
        assert.equal(sat([rec(y11, PASSED), rec(y12, PASSED)]), true);
    });
});


/* ---- the year-level gate (printed ** / *** footnotes, for every programme) ---- */

describe('year gate', () => {
    // A four-year programme, one subject per semester, no prerequisites at
    // all: only the gate can hold anything back.
    const s = {};
    for (let y = 1; y <= 4; y++) for (let t = 1; t <= 2; t++) {
        s[`${y}${t}`] = subj(`S${y}${t}`, { year: y, term: t });
    }
    const all = Object.values(s);
    const passedThrough = (...keys) => keys.map(k => rec(s[k], PASSED));
    const codes = (list) => list.map(e => e.subject.code).sort();

    test('a subject with no prerequisites in year 3 is locked until year 2 is finished', () => {
        const out = assess(student({ year: 2 }), passedThrough('11', '12', '21'),
            kbOf(all), ignoreOfferings);
        assert.ok(codes(out.eligible).includes('S22'), 'next semester is open');
        assert.ok(!codes(out.eligible).includes('S31'), '3rd year stays locked');
        assert.ok(!codes(out.eligible).includes('S41'));
        assert.ok(codes(out.locked).includes('S31'));
    });

    test('year 1 and year 2 are not gated', () => {
        const out = assess(student(), [], kbOf(all), ignoreOfferings);
        for (const c of ['S11', 'S12', 'S21', 'S22']) assert.ok(codes(out.eligible).includes(c), c);
    });

    test('year 3 opens once year 2 is complete, year 4 once year 3 is', () => {
        const y2 = passedThrough('11', '12', '21', '22');
        let out = assess(student({ year: 3 }), y2, kbOf(all), ignoreOfferings);
        assert.ok(codes(out.eligible).includes('S31') && codes(out.eligible).includes('S32'));
        assert.ok(!codes(out.eligible).includes('S41'), 'year 4 still needs year 3');

        out = assess(student({ year: 4 }), [...y2, ...passedThrough('31', '32')],
            kbOf(all), ignoreOfferings);
        assert.ok(codes(out.eligible).includes('S41'));
    });

    test('one missing second-year subject keeps year 3 closed', () => {
        const out = assess(student({ year: 3 }), passedThrough('11', '12', '21'),
            kbOf(all), ignoreOfferings);
        assert.ok(!codes(out.eligible).includes('S31'));
    });

    test('the reason a gated subject is locked names what is missing', () => {
        const out = assess(student(), [], kbOf(all), ignoreOfferings);
        const l = out.locked.find(e => e.subject.code === 'S31');
        assert.match(explain(l).join(' '), /2nd Year, 2nd Semester/);
    });

    test('a prospectus that states its own gates is followed as written', () => {
        // S31 says "through 1st year, 2nd semester" (12). Because this prospectus
        // states a gate of its own, the system default steps aside entirely:
        // S31 opens with year 1 done, and S32 (no mark) is not held back either.
        const rules = [rule(s['31'], null, { type: 'standing', threshold: 12 })];
        const out = assess(student({ year: 3 }), passedThrough('11', '12'),
            kbOf(all, rules), ignoreOfferings);
        assert.ok(codes(out.eligible).includes('S31'));
        assert.ok(codes(out.eligible).includes('S32'), 'unmarked subjects are not gated by the default');
        assert.ok(codes(out.eligible).includes('S41'));
    });

    test('a marked subject is still held back until its own gate is met', () => {
        const rules = [rule(s['41'], null, { type: 'standing', threshold: 32 })];
        const behind = assess(student({ year: 4 }), passedThrough('11', '12', '21', '22', '31'),
            kbOf(all, rules), ignoreOfferings);
        assert.ok(!codes(behind.eligible).includes('S41'), 'year 3 is not finished');
        const done = assess(student({ year: 4 }), passedThrough('11', '12', '21', '22', '31', '32'),
            kbOf(all, rules), ignoreOfferings);
        assert.ok(codes(done.eligible).includes('S41'));
    });

    test('a standing rule belonging to another prospectus does not switch the default off', () => {
        const stranger = { ...subj('OTHER', { year: 3, term: 1 }), id: 999999 };
        const rules = [rule(stranger, null, { type: 'standing', threshold: 22 })];
        const out = assess(student({ year: 2 }), passedThrough('11', '12', '21'),
            kbOf(all, rules), ignoreOfferings);
        assert.ok(!codes(out.eligible).includes('S31'), 'the default still holds here');
    });

    test('a gate that asks a subject to pass itself is held to the semester before it', () => {
        // S42 marked "through 4th year" (42) would need S42 itself first. It
        // is read as "through 4th year, 1st sem" (41), so it can open.
        const rules = [rule(s['42'], null, { type: 'standing', threshold: 42 })];
        const before = assess(student({ year: 4 }), passedThrough('11', '12', '21', '22', '31', '32'),
            kbOf(all, rules), ignoreOfferings);
        assert.ok(!codes(before.eligible).includes('S42'), 'S41 is still owed');
        const after = assess(student({ year: 4 }), passedThrough('11', '12', '21', '22', '31', '32', '41'),
            kbOf(all, rules), ignoreOfferings);
        assert.ok(codes(after.eligible).includes('S42'), 'opens once 4th year 1st sem is done');
    });

    test('the gate can be turned off', () => {
        const out = assess(student(), [], kbOf(all), { respectOfferings: false, yearGate: false });
        assert.ok(codes(out.eligible).includes('S31'));
    });

    test('a locked year-3 subject is reachable in the forward chain, not "unreachable"', () => {
        const out = assess(student({ year: 2 }), passedThrough('11', '12', '21'),
            kbOf(all), ignoreOfferings);
        const l = out.locked.find(e => e.subject.code === 'S31');
        assert.ok(l.termsAway !== null && l.termsAway > 1);
    });
});


/* ---- a partly published schedule ---- */

describe('partial schedule', () => {
    // Year 1 has no schedule; only year 2 term 1 has one section published.
    const a = subj('A11', { year: 1, term: 1 });
    const b = subj('B11', { year: 1, term: 1 });
    const c = subj('C12', { year: 1, term: 2 });
    const x = subj('X21', { year: 2, term: 1 });
    const y = subj('Y21', { year: 2, term: 1 });
    const all = [a, b, c, x, y];
    const offerings = [{ subject_id: x.id, section: 'BSIT-2A' }];
    const codes = (list) => list.map(r => r.subject.code).sort();

    test('publishing one section no longer empties other students lists', () => {
        const out = assess(student(), [], kbOf(all, [], offerings), { term: 1 });
        assert.ok(codes(out.recommended).includes('A11'));
        assert.ok(codes(out.recommended).includes('B11'));
    });

    test('a subject in an unscheduled block is labelled pending, a scheduled one offered', () => {
        const out = assess(student(), [], kbOf(all, [], offerings), { term: 1 });
        const state = (code) => out.eligible.find(e => e.subject.code === code).scheduleState;
        assert.equal(state('A11'), 'pending');
        assert.equal(state('X21'), 'offered');
    });

    test('a subject the department is not running, in a block it IS scheduling, is not recommended', () => {
        const out = assess(student(), [], kbOf(all, [], offerings), { term: 1 });
        assert.equal(out.eligible.find(e => e.subject.code === 'Y21').scheduleState, 'not-run');
        assert.ok(!codes(out.recommended).includes('Y21'));
    });

    test('pending subjects still respect the current term', () => {
        const out = assess(student(), [], kbOf(all, [], offerings), { term: 1 });
        assert.ok(!codes(out.recommended).includes('C12'), 'a 2nd-semester subject is not for a 1st-semester term');
    });

    test('a retake in an unscheduled block is recommended whatever its term', () => {
        const out = assess(student(), [rec(c, FAILED)], kbOf(all, [], offerings), { term: 1 });
        assert.ok(codes(out.recommended).includes('C12'));
    });

    test('with no schedule at all every subject is "none" and offered is true', () => {
        const out = assess(student(), [], kbOf(all), { term: 1 });
        assert.ok(out.eligible.every(e => e.scheduleState === 'none' && e.offered === true));
    });

    test('with the schedule switched off nothing is treated as scheduled or unscheduled', () => {
        const out = assess(student(), [], kbOf(all, [], offerings), { term: 1, respectOfferings: false });
        assert.ok(out.eligible.every(e => e.scheduleState === 'none'));
    });
});
