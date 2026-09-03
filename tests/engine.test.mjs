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
const E = require('../engine/engine.js');

const { assess, buildFacts, evaluateSubject, chainForward,
        highestCompletedYear, explain,
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
        assert.equal(facts.completedThroughYear, 0);
    });
});


/* ---- year standing ---- */

describe('highestCompletedYear', () => {

    test('a year counts only when every required subject in it is passed', () => {
        const a = subj('A', { year: 1 });
        const b = subj('B', { year: 1 });
        const subjects = [a, b];

        assert.equal(highestCompletedYear(new Set([a.id]), subjects), 0);
        assert.equal(highestCompletedYear(new Set([a.id, b.id]), subjects), 1);
    });

    test('electives do not hold a year back', () => {
        const core = subj('CORE', { year: 1 });
        const el   = subj('EL', { year: 1, elective: true });

        assert.equal(highestCompletedYear(new Set([core.id]), [core, el]), 1,
            'choosing not to take an elective is not an incomplete year');
    });

    test('completion stops at the first incomplete year', () => {
        const y1 = subj('Y1', { year: 1 });
        const y2 = subj('Y2', { year: 2 });
        const y3 = subj('Y3', { year: 3 });
        const subjects = [y1, y2, y3];

        // Third year passed, second year still owing.
        const passed = new Set([y1.id, y3.id]);
        assert.equal(highestCompletedYear(passed, subjects), 1,
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
        const rules = [rule(gated, null, { type: 'standing', threshold: 1 })];

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
            rule(profis, null, { type: 'standing', threshold: 2 }),
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
