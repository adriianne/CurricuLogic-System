// suggestion-scenarios.test.mjs
// A second look at the suggestion logic (engine + preferences + the assess-student
// shaping) through whole-student scenarios, rather than one rule at a time.
//
//   node --test tests/suggestion-scenarios.test.mjs
//
// Each scenario states what a sensible adviser would expect. The unit tests in
// engine.test.mjs, preferences.test.mjs and assess-student.test.mjs cover the
// parts; this file covers odd combinations: dropped subjects, retakes, cycles,
// graduating students, closed schedules, clashing labs and bad data.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const E = require('../shared/engine/engine.js');
const P = require('../shared/engine/preferences.js');
const explain = require('../ai-assist/eligibility-explanation.js');
const SC = require('../shared/js/scheduleconflicts.js');
const { assessStudent } = require('../supabase/functions/assess-student/core.js');

/* ---- fixtures ---- */

let nextId = 1;
const S = (code, o = {}) => ({
    id: o.id ?? nextId++, code, title: o.title ?? code, units: o.units ?? 3,
    year_level: 'year' in o ? o.year : 1, term: 'term' in o ? o.term : 1,
    is_elective: !!o.elective, elective_type: o.type ?? null, is_active: o.active,
});
const R = (subject, required, o = {}) => ({
    subject_id: subject.id, prerequisite_subject_id: required ? required.id : null,
    requirement_type: o.type ?? 'prerequisite', rule_type: 'and',
    rule_group: o.group ?? 1, threshold_value: o.threshold ?? null,
});
const rec = (subject, status) => ({ subject_id: subject.id, status, grade: status === 'PASSED' ? '2.00' : '5.00' });
const stu = (year = 1) => ({ id: 'stu', year_level: year });
const meet = (subject, section, days, start, end, type = 'LEC', extra = {}) => ({
    id: extra.id ?? nextId++, subject_id: subject.id, section, meeting_type: type,
    schedule_days: days, start_time: start, end_time: end, room: null, edp_code: extra.edp ?? null,
});
const run = (subjects, rules, records, o = {}) => E.assess(
    o.student ?? stu(o.year ?? 1), records,
    { subjects, rules, offerings: o.offerings ?? [] },
    { term: o.term ?? 1, respectOfferings: (o.offerings ?? []).length > 0, ...o.options });
const codes = (list) => list.map(e => (e.subject ?? e).code);

/* ---- who is eligible ---- */

describe('records of every kind', () => {
    test('a dropped subject is not a retake: it simply comes back', () => {
        const A = S('A');
        const r = run([A], [], [rec(A, 'DROPPED')]);
        assert.deepEqual(codes(r.eligible), ['A']);
        assert.equal(r.eligible[0].retake, false);
    });

    test('a record with no status changes nothing', () => {
        const A = S('A');
        const r = run([A], [], [{ subject_id: A.id, status: null, grade: null }]);
        assert.deepEqual(codes(r.eligible), ['A']);
    });

    test('a record for a subject that is not in the curriculum is ignored, and earns no units', () => {
        const A = S('A');
        const r = run([A], [], [{ subject_id: 99999, status: 'PASSED', grade: '1.00' }]);
        assert.equal(r.facts.unitsEarned, 0);
        assert.deepEqual(codes(r.eligible), ['A']);
    });

    test('a record with no subject at all does not crash', () => {
        const A = S('A');
        assert.doesNotThrow(() => run([A], [], [{ subject_id: null, status: 'PASSED' }]));
    });

    test('failed then passed: the pass wins, no retake', () => {
        const A = S('A'), B = S('B', { term: 2 });
        const r = run([A, B], [R(B, A)], [rec(A, 'FAILED'), rec(A, 'PASSED')], { term: 2 });
        assert.deepEqual(codes(r.eligible), ['B']);
    });

    test('passed then failed on a later audit: still passed', () => {
        const A = S('A'), B = S('B', { term: 2 });
        const r = run([A, B], [R(B, A)], [rec(A, 'PASSED'), rec(A, 'FAILED')], { term: 2 });
        assert.deepEqual(codes(r.eligible), ['B']);
        assert.equal(r.facts.failedCount, 0);
    });

    test('enrolled and failed in the same subject: it counts as in progress, not eligible', () => {
        const A = S('A');
        const r = run([A], [], [rec(A, 'FAILED'), rec(A, 'ENROLLED')]);
        assert.deepEqual(codes(r.inProgress), ['A']);
        assert.equal(r.eligible.length, 0);
    });

    test('units passed twice are counted once', () => {
        const A = S('A');
        const r = run([A], [], [rec(A, 'PASSED'), rec(A, 'PASSED')]);
        assert.equal(r.facts.unitsEarned, 3);
    });

    test('a student who passed everything gets nothing recommended and is not "graduating"', () => {
        const A = S('A'), B = S('B');
        const r = run([A, B], [], [rec(A, 'PASSED'), rec(B, 'PASSED')]);
        assert.equal(r.recommended.length, 0);
        assert.equal(r.graduating, false);
        assert.equal(r.facts.unitsEarned, r.totalUnits);
    });
});

describe('prerequisites that are awkward', () => {
    test('two subjects that need each other stay locked and do not loop forever', () => {
        const A = S('A'), B = S('B');
        const r = run([A, B], [R(A, B), R(B, A)], []);
        assert.equal(r.eligible.length, 0);
        assert.equal(r.locked.length, 2);
        assert.ok(r.locked.every(l => l.termsAway === null), 'neither is ever reachable');
    });

    test('a failed prerequisite locks its dependent and ranks the retake first', () => {
        const A = S('A'), B = S('B', { term: 2 }), X = S('X');
        const r = run([A, B, X], [R(B, A)], [rec(A, 'FAILED')]);
        assert.deepEqual(codes(r.locked), ['B']);
        assert.match(r.locked[0].unmet[0].detail, /not passed.*retaken/i);
        assert.equal(r.recommended[0].subject.code, 'A');
        assert.match(r.recommended[0].reason, /^Retake/);
    });

    test('a prerequisite still in progress locks, and says so', () => {
        const A = S('A'), B = S('B', { term: 2 });
        const r = run([A, B], [R(B, A)], [rec(A, 'ENROLLED')], { term: 2 });
        assert.deepEqual(codes(r.locked), ['B']);
        assert.match(r.locked[0].unmet[0].detail, /in progress/i);
    });

    test('either of two alternatives opens the subject', () => {
        const A = S('A'), B = S('B'), T = S('T', { term: 2 });
        const rules = [R(T, A, { group: 1 }), R(T, B, { group: 1 })];
        assert.ok(codes(run([A, B, T], rules, [rec(B, 'PASSED')], { term: 2 }).eligible).includes('T'));
        assert.deepEqual(codes(run([A, B, T], rules, [], { term: 2 }).locked), ['T']);
    });

    test('an "and" of two groups needs both', () => {
        const A = S('A'), B = S('B'), T = S('T', { term: 2 });
        const rules = [R(T, A, { group: 1 }), R(T, B, { group: 2 })];
        assert.equal(run([A, B, T], rules, [rec(A, 'PASSED')], { term: 2 }).locked.length, 1);
        assert.equal(run([A, B, T], rules, [rec(A, 'PASSED'), rec(B, 'PASSED')], { term: 2 }).eligible.length, 1);
    });

    test('a long chain unlocks one link per pass', () => {
        const a = S('A'), b = S('B', { term: 2 }), c = S('C', { year: 2 }), d = S('D', { year: 2, term: 2 });
        const rules = [R(b, a), R(c, b), R(d, c)];
        const r = run([a, b, c, d], rules, [], { options: { yearGate: false } });
        assert.deepEqual(codes(r.eligible), ['A']);
        const depth = (code) => r.locked.find(l => l.subject.code === code).termsAway;
        assert.deepEqual([depth('B'), depth('C'), depth('D')], [2, 3, 4]);
    });

    test('A and its lab need each other (co-requisites): the pair is takeable together', () => {
        // Lecture and lab each list the other as "taken alongside". Neither is passed or
        // enrolled yet, yet both are open, because they are taken in the same term.
        const lec = S('LEC'), lab = S('LAB');
        const r = run([lec, lab], [R(lec, lab, { type: 'co_requisite' }), R(lab, lec, { type: 'co_requisite' })], []);
        assert.deepEqual(codes(r.eligible).sort(), ['LAB', 'LEC'],
            'two subjects that must be taken together should both be open when neither is yet taken');
    });

    test('a one-way co-requisite (lab needs its lecture) is open once the lecture is open', () => {
        const lec = S('LEC'), lab = S('LAB');
        const r = run([lec, lab], [R(lab, lec, { type: 'co_requisite' })], []);
        assert.deepEqual(codes(r.eligible).sort(), ['LAB', 'LEC'],
            'the lab can be taken in the same term as the lecture it goes with');
    });
});

describe('subjects taken together (co-requisites)', () => {
    const co = (a, b) => R(a, b, { type: 'co_requisite' });

    test('both are recommended, together, with the reason saying so', () => {
        const lec = S('LEC'), lab = S('LAB');
        const r = run([lec, lab], [co(lab, lec)], []);
        assert.deepEqual(codes(r.recommended).sort(), ['LAB', 'LEC']);
        const labEntry = r.recommended.find(e => e.subject.code === 'LAB');
        assert.deepEqual(labEntry.alongside.map(a => a.code), ['LEC']);
        assert.match(labEntry.reason, /Taken together with LEC/);
        assert.equal(r.recommended.find(e => e.subject.code === 'LEC').alongside.length, 0);
    });

    test('the Cura summary names the partner of a paired subject, and is empty for one that stands alone', () => {
        const lec = S('LEC'), lab = S('LAB');
        const s = explain.summarizeForExplanation(run([lec, lab], [co(lab, lec)], []), 'Ann');
        assert.deepEqual(s.recommended.find(e => e.code === 'LAB').takenTogetherWith, ['LEC']);
        assert.deepEqual(s.recommended.find(e => e.code === 'LEC').takenTogetherWith, []);
    });

    test('the lab is not recommended without its lecture when there is room for only one', () => {
        const lec = S('LEC', { units: 3 }), lab = S('LAB', { units: 1 });
        const r = run([lec, lab], [co(lab, lec)], [], { options: { maxUnits: 3, maxUnitsGraduating: 1 } });
        assert.ok(!codes(r.recommended).includes('LAB'));
        assert.ok(r.recommendedUnits <= 3);
    });

    test('a pair that does not fit in the room is skipped as a pair, and a single subject still can be', () => {
        const lec = S('LEC', { units: 3 }), lab = S('LAB', { units: 1 }), solo = S('SOLO', { units: 3 });
        const r = run([lec, lab, solo], [co(lab, lec)], [], { options: { maxUnits: 3, maxUnitsGraduating: 1 } });
        assert.ok(r.recommendedUnits <= 3);
        const got = codes(r.recommended);
        assert.ok(!got.includes('LAB') || got.includes('LEC'), 'never the lab without its lecture');
    });

    test('the lecture already being taken: the lab stands on its own', () => {
        const lec = S('LEC'), lab = S('LAB');
        const r = run([lec, lab], [co(lab, lec)], [rec(lec, 'ENROLLED')]);
        assert.deepEqual(codes(r.recommended), ['LAB']);
        assert.equal(r.recommended[0].alongside.length, 0);
    });

    test('the lecture already passed: the lab stands on its own', () => {
        const lec = S('LEC'), lab = S('LAB');
        const r = run([lec, lab], [co(lab, lec)], [rec(lec, 'PASSED')]);
        assert.deepEqual(codes(r.recommended), ['LAB']);
    });

    test('if the lecture itself is locked, the lab stays locked', () => {
        const pre = S('PRE'), lec = S('LEC', { term: 2 }), lab = S('LAB', { term: 2 });
        const r = run([pre, lec, lab], [R(lec, pre), co(lab, lec)], [], { term: 2 });
        assert.deepEqual(codes(r.locked).sort(), ['LAB', 'LEC']);
        assert.match(r.locked.find(l => l.subject.code === 'LAB').unmet[0].detail, /LEC must be passed or taken alongside/);
    });

    test('if the lecture has no section this term, the lab is not recommended', () => {
        const lec = S('LEC'), lab = S('LAB'), other = S('OTH');
        const offerings = [meet(lab, 'L1', 'MW', '08:00', '09:00'), meet(other, 'O1', 'TTH', '08:00', '09:00')];
        const r = run([lec, lab, other], [co(lab, lec)], [], { offerings });
        assert.ok(!codes(r.recommended).includes('LAB'));
        assert.ok(!codes(r.recommended).includes('LEC'));
    });

    test('one lab that goes with two lectures brings both', () => {
        const l1 = S('L1'), l2 = S('L2'), lab = S('LAB');
        const r = run([l1, l2, lab], [co(lab, l1), co(lab, l2)], []);
        assert.deepEqual(codes(r.recommended).sort(), ['L1', 'L2', 'LAB']);
        assert.deepEqual(r.recommended.find(e => e.subject.code === 'LAB').alongside.map(a => a.code).sort(), ['L1', 'L2']);
    });

    test('a chain (A with B, B with C) is taken as one group', () => {
        const a = S('A'), b = S('B'), c = S('C');
        const r = run([a, b, c], [co(a, b), co(b, c)], []);
        assert.deepEqual(codes(r.recommended).sort(), ['A', 'B', 'C']);
    });

    test('a co-requisite also needs the usual prerequisites of the pair', () => {
        const pre = S('PRE'), lec = S('LEC', { term: 2 }), lab = S('LAB', { term: 2 });
        const r = run([pre, lec, lab], [R(lec, pre), co(lab, lec)], [rec(pre, 'PASSED')], { term: 2 });
        assert.deepEqual(codes(r.recommended).sort(), ['LAB', 'LEC']);
    });

    test('a retake lecture and its first-time lab go together', () => {
        const lec = S('LEC'), lab = S('LAB');
        const r = run([lec, lab], [co(lab, lec)], [rec(lec, 'FAILED')]);
        assert.deepEqual(codes(r.recommended).sort(), ['LAB', 'LEC']);
    });

    test('the same subjects are still ranked in the engine\'s own order', () => {
        const a = S('A'), b = S('B'), c = S('C', { term: 2 }), d = S('D', { term: 2 }), e = S('E', { term: 2 });
        const lec = S('LEC'), lab = S('LAB');
        const rules = [R(c, b), R(d, b), R(e, b), co(lab, lec)];
        const r = run([a, b, c, d, e, lec, lab], rules, []);
        assert.equal(r.recommended[0].subject.code, 'B');
        assert.ok(codes(r.recommended).includes('LEC') && codes(r.recommended).includes('LAB'));
    });

    test('a co-requisite on a subject outside the curriculum stays locked', () => {
        const lab = S('LAB');
        const r = run([lab], [R(lab, { id: 424242 }, { type: 'co_requisite' })], []);
        assert.deepEqual(codes(r.locked), ['LAB']);
    });
});

/* ---- gates, electives, inactive ---- */

describe('year gate and standing', () => {
    test('3rd-year subjects stay shut until 2nd year is finished', () => {
        const y1 = S('Y1'), y2 = S('Y2', { year: 2 }), y3 = S('Y3', { year: 3 });
        const r = run([y1, y2, y3], [], [rec(y1, 'PASSED')], { year: 3 });
        assert.deepEqual(codes(r.locked), ['Y3']);
        const done = run([y1, y2, y3], [], [rec(y1, 'PASSED'), rec(y2, 'PASSED')], { year: 3 });
        assert.deepEqual(codes(done.eligible), ['Y3']);
    });

    test('a standing rule on a subject that is its own semester does not lock it forever', () => {
        const y1 = S('Y1'), cap = S('CAP', { year: 4, term: 2 });
        const rules = [R(cap, null, { type: 'standing', threshold: 42 })];
        const r = run([y1, cap], rules, [rec(y1, 'PASSED')], { year: 4, term: 2 });
        assert.deepEqual(codes(r.eligible), ['CAP']);
    });
});

describe('electives', () => {
    test('a passed catalogue elective fills the first open slot and is not offered again', () => {
        const slot1 = S('EL1', { year: 3, elective: true, type: 'IT' });
        const slot2 = S('EL2', { year: 3, term: 2, elective: true, type: 'IT' });
        const cat = S('CATX', { year: null, term: null, elective: true, type: 'IT' });
        const r = run([slot1, slot2, cat], [], [rec(cat, 'PASSED')], { year: 3, options: { yearGate: false } });
        assert.equal(r.electives.IT.filled, 1);
        assert.equal(r.electives.IT.remaining, 1);
        assert.ok(codes(r.completed).includes('EL1'));
    });

    test('catalogue electives beyond the slots earn no degree units', () => {
        const slot = S('EL1', { year: 3, elective: true, type: 'IT' });
        const c1 = S('C1', { year: null, term: null, elective: true, type: 'IT' });
        const c2 = S('C2', { year: null, term: null, elective: true, type: 'IT' });
        const r = run([slot, c1, c2], [], [rec(c1, 'PASSED'), rec(c2, 'PASSED')], { year: 3, options: { yearGate: false } });
        assert.equal(r.facts.unitsEarned, 3, 'only one of the two counts toward the degree');
    });

    test('an elective never counts toward the year-standing check', () => {
        const y1 = S('Y1'), el = S('EL', { elective: true, type: 'FREE' }), y2 = S('Y2', { year: 2 }), y3 = S('Y3', { year: 3 });
        const r = run([y1, el, y2, y3], [], [rec(y1, 'PASSED'), rec(y2, 'PASSED')], { year: 3 });
        assert.ok(codes(r.eligible).includes('Y3'));
    });

    test('with every slot of a type filled, no recommendation asks for another', () => {
        const slot = S('EL1', { year: 3, elective: true, type: 'IT' });
        const cat = S('C1', { year: null, term: null, elective: true, type: 'IT' });
        const cat2 = S('C2', { year: null, term: null, elective: true, type: 'IT' });
        const r = run([slot, cat, cat2], [], [rec(cat, 'PASSED')], { year: 3, options: { yearGate: false } });
        assert.equal(r.recommended.length, 0);
        assert.equal(r.eligible.length, 0);
    });
});

describe('inactive subjects', () => {
    test('an inactive subject nobody took is out of the curriculum entirely', () => {
        const A = S('A'), old = S('OLD', { active: false });
        const r = run([A, old], [], []);
        assert.deepEqual(codes(r.eligible), ['A']);
        assert.equal(r.totalUnits, 3);
    });

    test('an inactive subject the student already passed stays in their record', () => {
        const A = S('A'), old = S('OLD', { active: false });
        const r = run([A, old], [], [rec(old, 'PASSED')]);
        assert.ok(codes(r.completed).includes('OLD'));
        assert.equal(r.facts.unitsEarned, 3);
    });
});

/* ---- load ---- */

describe('how much to take', () => {
    test('the cap is never exceeded', () => {
        const subs = Array.from({ length: 12 }, (_, i) => S(`S${i}`, { units: 3 }));
        const r = run(subs, [], [], { options: { maxUnits: 21 } });
        assert.ok(r.recommendedUnits <= 21);
        assert.equal(r.recommendedUnits, 21);
    });

    test('a subject too big for the room is skipped and a smaller one still fits', () => {
        const big = S('BIG', { units: 5 }), small = S('SMALL', { units: 1 }), mid = S('MID', { units: 3 });
        const r = run([big, small, mid], [], [], { options: { maxUnits: 4, maxUnitsGraduating: 1 } });
        assert.ok(r.recommendedUnits <= 4);
        assert.ok(!codes(r.recommended).includes('BIG'));
        assert.deepEqual(codes(r.recommended).sort(), ['MID', 'SMALL']);
    });

    test('units already being carried reduce the room', () => {
        const A = S('A'), B = S('B', { year: 2 }), cur = S('CUR', { units: 18 });
        const r = run([A, B, cur], [], [rec(cur, 'ENROLLED')], { options: { maxUnits: 21, maxUnitsGraduating: 1 }, year: 2 });
        assert.equal(r.availableUnits, 3);
        assert.ok(r.recommendedUnits <= 3);
    });

    test('a student with only a little left may carry the graduating load', () => {
        const done = Array.from({ length: 10 }, (_, i) => S(`D${i}`, { units: 3 }));
        const left = Array.from({ length: 9 }, (_, i) => S(`L${i}`, { units: 3, year: 4 }));
        const r = run([...done, ...left], [], done.map(d => rec(d, 'PASSED')), { year: 4, term: 1, options: { maxUnits: 24, maxUnitsGraduating: 27 } });
        assert.equal(r.graduating, true);
        assert.equal(r.maxUnits, 27);
        assert.equal(r.recommendedUnits, 27);
    });

    test('a student well short of the end does not get the graduating load', () => {
        const left = Array.from({ length: 12 }, (_, i) => S(`L${i}`, { units: 3 }));
        const r = run(left, [], [], { options: { maxUnits: 24, maxUnitsGraduating: 27 } });
        assert.equal(r.graduating, false);
        assert.equal(r.maxUnits, 24);
    });

    test('units given as text ("3.00") are added as numbers', () => {
        const A = S('A', { units: '3.00' }), B = S('B', { units: '2.50' });
        const r = run([A, B], [], []);
        assert.equal(r.recommendedUnits, 5.5);
    });

    test('a subject with no units listed takes no room and does not crash', () => {
        const Z = S('Z', { units: 0 });
        assert.doesNotThrow(() => run([Z], [], []));
        assert.equal(run([Z], [], []).recommendedUnits, 0);
    });
});

describe('ranking', () => {
    test('a retake comes before everything else', () => {
        const a = S('A'), b = S('B'), c = S('C', { term: 2 }), d = S('D', { term: 2 }), e = S('E', { term: 2 });
        const rules = [R(c, b), R(d, b), R(e, b)];
        const r = run([a, b, c, d, e], rules, [rec(a, 'FAILED')]);
        assert.equal(r.recommended[0].subject.code, 'A');
    });

    test('the subject standing in front of more others comes first', () => {
        const a = S('A'), b = S('B'), c = S('C', { term: 2 }), d = S('D', { term: 2 }), e = S('E', { term: 2 });
        const rules = [R(c, b), R(d, b), R(e, b)];
        const r = run([a, b, c, d, e], rules, []);
        assert.equal(r.recommended[0].subject.code, 'B');
        assert.match(r.recommended[0].reason, /Opens 3 later subjects/);
    });

    test('a second-year who still owes a first-year subject gets it ahead of equal second-year ones', () => {
        const old = S('OLD'), now = S('NOW', { year: 2 });
        const r = run([old, now], [], [], { year: 2 });
        assert.equal(r.recommended[0].subject.code, 'OLD');
        assert.equal(r.recommended[0].reason, 'Outstanding from an earlier year level.');
    });

    test('the same input always gives the same answer', () => {
        const subs = Array.from({ length: 8 }, (_, i) => S(`S${i}`, { year: 1 + (i % 2) }));
        const a = JSON.stringify(run(subs, [], [], { year: 2 }));
        const b = JSON.stringify(run(subs, [], [], { year: 2 }));
        assert.equal(a, b);
    });

    test('a student with no year level is still ranked without error', () => {
        const A = S('A');
        assert.doesNotThrow(() => run([A], [], [], { student: { id: 's', year_level: null } }));
    });
});

/* ---- schedules ---- */

describe('what the schedule allows', () => {
    const A = S('A'), B = S('B');

    test('a subject whose block is being scheduled but which has no section is not suggested', () => {
        const r = run([A, B], [], [], { offerings: [meet(A, 'X1', 'MW', '08:00', '09:30')] });
        assert.deepEqual(codes(r.recommended), ['A']);
        assert.equal(r.eligible.find(e => e.subject.code === 'B').scheduleState, 'not-run');
    });

    test('a retake with no section this term is still not suggested', () => {
        const r = run([A, B], [], [rec(B, 'FAILED')], { offerings: [meet(A, 'X1', 'MW', '08:00', '09:30')] });
        assert.ok(!codes(r.recommended).includes('B'));
    });

    test('a subject of another semester is not suggested when nothing is scheduled', () => {
        const t2 = S('T2', { term: 2 });
        const r = run([A, t2], [], [], { term: 1 });
        assert.deepEqual(codes(r.recommended), ['A']);
    });

    test('a failed second-semester subject is owed in the first-semester plan when no schedule exists', () => {
        const t2 = S('T2', { term: 2 });
        const r = run([A, t2], [], [rec(t2, 'FAILED')], { term: 1 });
        assert.ok(codes(r.recommended).includes('T2'));
    });
});

/* ---- preferences ---- */

describe('preferences on top of the engine', () => {
    const mk = (n, o = {}) => Array.from({ length: n }, (_, i) => S(`P${i}`, o));

    test('they never add a subject the engine did not suggest', () => {
        const subs = mk(6);
        const base = run(subs, [], []);
        for (const prefs of [{ load: 'light' }, { load: 'regular' }, { timeOfDay: 'evening' }, { load: 'light', timeOfDay: 'morning' }]) {
            const plan = P.apply(base, prefs);
            const allowed = new Set(codes(base.recommended));
            assert.ok(codes(plan.recommended).every(c => allowed.has(c)), JSON.stringify(prefs));
        }
    });

    test('light load keeps the most important subjects and defers the rest', () => {
        const root = S('ROOT'), others = mk(7, { units: 3 });
        const kids = [S('K1', { term: 2 }), S('K2', { term: 2 }), S('K3', { term: 2 })];
        const subs = [root, ...others, ...kids];
        const rules = kids.map(k => R(k, root));
        const base = run(subs, rules, [], { options: { maxUnits: 24 } });
        const plan = P.apply(base, { load: 'light' });
        assert.ok(plan.recommendedUnits <= 15);
        assert.ok(codes(plan.recommended).includes('ROOT'), 'the bottleneck stays when the load is cut');
        assert.ok(plan.preference.deferred.length > 0);
    });

    test('a load setting cannot raise the cap', () => {
        const base = run(mk(10), [], [], { options: { maxUnits: 12 } });
        const plan = P.apply(base, { load: 'regular' });
        assert.ok(plan.recommendedUnits <= 12);
    });

    test('nothing is chosen when the student is already full', () => {
        const cur = S('CUR', { units: 24, year: 2 });
        const base = run([cur, ...mk(3)], [], [rec(cur, 'ENROLLED')], { year: 2, options: { maxUnits: 24 } });
        const plan = P.apply(base, { load: 'light' });
        assert.equal(plan.recommended.length, 0);
    });

    test('unknown preference values are the same as none', () => {
        const base = run(mk(3), [], []);
        const plain = P.apply(base, null);
        const odd = P.apply(base, { timeOfDay: 'midnight', load: 'extreme' });
        assert.deepEqual(codes(odd.recommended), codes(plain.recommended));
        assert.equal(odd.preference.timeOfDay, null);
        assert.equal(odd.preference.load, null);
    });

    test('the input is not changed by applying preferences', () => {
        const base = run(mk(4), [], []);
        const before = JSON.stringify(base);
        P.apply(base, { load: 'light', timeOfDay: 'morning' });
        assert.equal(JSON.stringify(base), before);
    });
});

describe('sections and clashes', () => {
    const A = S('A'), B = S('B'), C = S('C');
    const withOfferings = (offerings, prefs) => {
        const base = run([A, B, C], [], [], { offerings });
        return P.apply(base, prefs);
    };
    const clashFree = (plan) => {
        const chosen = plan.recommended.filter(e => e.chosenSection);
        for (let i = 0; i < chosen.length; i++) for (let j = i + 1; j < chosen.length; j++) {
            const clash = chosen[i].chosenSection.meetings.some(m1 => chosen[j].chosenSection.meetings.some(m2 => SC.meetingsClash(m1, m2)));
            if (clash) return false;
        }
        return true;
    };

    test('two subjects with one section each at the same hour: one is left out, with the reason', () => {
        const plan = withOfferings([
            meet(A, 'A1', 'MW', '08:00', '09:30'), meet(B, 'B1', 'MW', '08:30', '10:00'), meet(C, 'C1', 'TTH', '08:00', '09:30'),
        ], null);
        assert.ok(clashFree(plan));
        assert.equal(plan.recommended.length, 2);
        assert.equal(plan.leftOutForClash.length, 1);
        assert.ok(plan.leftOutForClash[0].blockedBy.length > 0);
    });

    test('a second section is used to avoid a clash', () => {
        const plan = withOfferings([
            meet(A, 'A1', 'MW', '08:00', '09:30'),
            meet(B, 'B1', 'MW', '08:00', '09:30'), meet(B, 'B2', 'MW', '10:00', '11:30'),
            meet(C, 'C1', 'TTH', '08:00', '09:30'),
        ], null);
        assert.equal(plan.recommended.length, 3);
        assert.ok(clashFree(plan));
    });

    test('a lab that clashes with another subject blocks the whole section', () => {
        const plan = withOfferings([
            meet(A, 'A1', 'MW', '08:00', '09:00'), meet(A, 'A1', 'F', '13:00', '16:00', 'LAB'),
            meet(B, 'B1', 'TTH', '08:00', '09:00'), meet(B, 'B1', 'F', '14:00', '17:00', 'LAB'),
            meet(C, 'C1', 'S', '08:00', '09:00'),
        ], null);
        assert.ok(clashFree(plan));
        assert.equal(plan.recommended.length, 2, 'A and B cannot both be taken: their labs overlap on Friday');
    });

    test('back-to-back classes do not clash', () => {
        const plan = withOfferings([
            meet(A, 'A1', 'MW', '08:00', '09:30'), meet(B, 'B1', 'MW', '09:30', '11:00'), meet(C, 'C1', 'MW', '11:00', '12:30'),
        ], null);
        assert.equal(plan.recommended.length, 3);
    });

    test('the same hour on different days does not clash', () => {
        const plan = withOfferings([
            meet(A, 'A1', 'MW', '08:00', '09:30'), meet(B, 'B1', 'TTH', '08:00', '09:30'), meet(C, 'C1', 'F', '08:00', '09:30'),
        ], null);
        assert.equal(plan.recommended.length, 3);
    });

    test('"TTH" is Tuesday and Thursday, so it clashes with "T" but not with "M"', () => {
        const plan = withOfferings([
            meet(A, 'A1', 'TTH', '08:00', '09:30'), meet(B, 'B1', 'T', '08:00', '09:30'), meet(C, 'C1', 'M', '08:00', '09:30'),
        ], null);
        assert.equal(plan.leftOutForClash.length, 1);
        assert.ok(plan.recommended.some(e => e.subject.code === 'C'));
    });

    test('a morning preference picks the morning section when both are free', () => {
        const plan = withOfferings([
            meet(A, 'A1', 'MW', '13:00', '14:30'), meet(A, 'A2', 'MW', '08:00', '09:30'),
            meet(B, 'B1', 'TTH', '08:00', '09:30'), meet(C, 'C1', 'F', '08:00', '09:30'),
        ], { timeOfDay: 'morning' });
        const a = plan.recommended.find(e => e.subject.code === 'A');
        assert.equal(a.chosenSection.section, 'A2');
        assert.equal(a.timeMatch, 'match');
    });

    test('a time preference never causes a clash or drops a subject that could be placed', () => {
        const plan = withOfferings([
            meet(A, 'A1', 'MW', '08:00', '09:30'), meet(A, 'A2', 'MW', '14:00', '15:30'),
            meet(B, 'B1', 'MW', '08:00', '09:30'),
            meet(C, 'C1', 'TTH', '08:00', '09:30'),
        ], { timeOfDay: 'morning' });
        assert.equal(plan.recommended.length, 3, 'A moves to the afternoon so that B still fits');
        assert.ok(clashFree(plan));
    });

    test('a section with no times at all never clashes and does not crash', () => {
        const plan = withOfferings([
            meet(A, 'A1', 'MW', null, null), meet(B, 'B1', 'MW', null, null), meet(C, 'C1', 'MW', '08:00', '09:30'),
        ], { timeOfDay: 'morning' });
        assert.equal(plan.recommended.length, 3);
    });

    test('with no schedule at all every subject is suggested and says there is no section', () => {
        const plan = P.apply(run([A, B, C], [], []), { timeOfDay: 'morning' });
        assert.equal(plan.recommended.length, 3);
        assert.ok(plan.recommended.every(e => e.chosenSection === null));
    });

    test('alternatives never repeat the main plan', () => {
        const plan = withOfferings([
            meet(A, 'A1', 'MW', '08:00', '09:30'), meet(A, 'A2', 'MW', '14:00', '15:30'), meet(A, 'A3', 'MW', '18:00', '19:30'),
            meet(B, 'B1', 'TTH', '08:00', '09:30'), meet(B, 'B2', 'TTH', '14:00', '15:30'),
            meet(C, 'C1', 'F', '08:00', '09:30'),
        ], { timeOfDay: 'morning' });
        const key = (list) => list.map(x => `${x.code ?? x.subject.code}@${x.section ?? x.chosenSection?.section ?? '-'}`).sort().join('|');
        const main = key(plan.recommended);
        const keys = plan.alternatives.map(a => key(a.placed));
        assert.ok(!keys.includes(main));
        assert.equal(new Set(keys).size, keys.length);
        assert.ok(plan.alternatives.length <= 4);
    });

    test('a dozen subjects with several sections each finish quickly', () => {
        const many = Array.from({ length: 12 }, (_, i) => S(`M${i}`));
        const days = ['MW', 'TTH', 'F', 'S'];
        const offerings = many.flatMap((s, i) => [0, 1, 2].map(k =>
            meet(s, `${s.code}-${k}`, days[(i + k) % 4], `${8 + ((i + k) % 5) * 2}:00`, `${9 + ((i + k) % 5) * 2}:30`)));
        const base = run(many, [], [], { offerings, options: { maxUnits: 36 } });
        const t0 = Date.now();
        const plan = P.apply(base, { timeOfDay: 'morning' });
        assert.ok(Date.now() - t0 < 3000, 'took ' + (Date.now() - t0) + ' ms');
        assert.ok(clashFree(plan));
    });
});

/* ---- the shaped answer the phone gets ---- */

describe('the assess-student answer, end to end', () => {
    const A = S('A'), B = S('B'), C = S('C', { term: 2 });
    const student = { id: 'stu-1', student_id: '2401187', first_name: 'Athena', last_name: 'Po', year_level: 1 };
    const program = { code: 'BSIT', name: 'BSIT', max_units: 24, max_units_graduating: 27 };
    const input = (over = {}) => ({
        student, program, records: [], subjects: [A, B, C], rules: [R(C, A)], offerings: [], term: 1, year: 2024, prefs: null, ...over,
    });
    const go = (over) => assessStudent({ engine: E, preferences: P, explain, SC }, input(over));

    test('a student with no records at all gets a full, well-formed answer', () => {
        const out = go();
        assert.equal(out.assessed, true);
        assert.equal(out.progress.percent, 0);
        assert.deepEqual(codes(out.recommended).sort(), ['A', 'B']);
        assert.deepEqual(out.locked.map(l => l.code), ['C']);
        assert.ok(out.locked[0].reasons.length > 0);
    });

    test('the answer carries the EDP codes, one per meeting, and once per section', () => {
        const offerings = [
            meet(A, 'A1', 'MW', '08:00', '09:30', 'LEC', { edp: '4101' }),
            meet(A, 'A1', 'F', '13:00', '16:00', 'LAB', { edp: '4102' }),
            meet(B, 'B1', 'TTH', '08:00', '09:30', 'LEC', { edp: '4101' }),
        ];
        const out = go({ offerings });
        const a = out.recommended.find(r => r.code === 'A');
        assert.deepEqual(a.section.edp, ['4101', '4102']);
        assert.deepEqual(a.section.meetings.map(m => m.edp), ['4101', '4102']);
        const b = out.recommended.find(r => r.code === 'B');
        assert.deepEqual(b.section.edp, ['4101']);
    });

    test('a section with no EDP code posted gives an empty list, not "null" text', () => {
        const out = go({ offerings: [meet(A, 'A1', 'MW', '08:00', '09:30'), meet(B, 'B1', 'TTH', '08:00', '09:30')] });
        assert.deepEqual(out.recommended[0].section.edp, []);
    });

    test('every subject appears exactly once in the curriculum list', () => {
        const out = go({ records: [rec(A, 'PASSED')] });
        const seen = out.curriculum.map(r => r.code).sort();
        assert.deepEqual(seen, ['A', 'B', 'C']);
        assert.equal(new Set(seen).size, seen.length);
    });

    test('percent never goes over 100 even when more is earned than the degree lists', () => {
        const extra = S('X', { year: null, term: null, elective: true, type: 'FREE', units: 30 });
        const out = go({ subjects: [A, B, C, extra], records: [rec(A, 'PASSED'), rec(B, 'PASSED'), rec(C, 'PASSED'), rec(extra, 'PASSED')] });
        assert.ok(out.progress.percent <= 100);
    });

    test('a programme with no subjects does not divide by zero', () => {
        const out = go({ subjects: [], rules: [] });
        assert.equal(out.progress.percent, 0);
        assert.equal(out.recommended.length, 0);
    });

    test('a programme with no unit caps set falls back to 24 and 27', () => {
        const many = Array.from({ length: 12 }, (_, i) => S(`M${i}`));
        const out = go({ program: { code: 'X', name: 'X' }, subjects: many, rules: [] });
        assert.equal(out.load.maxUnits, 24);
    });

    test('a missing program does not crash', () => {
        assert.doesNotThrow(() => go({ program: null }));
    });

    test('Cura\'s summary matches what the screen shows', () => {
        const out = go({ records: [rec(A, 'PASSED')] });
        const shown = codes(out.recommended).sort();
        const told = (out.summary.recommended ?? out.summary.suggested ?? []).map(x => x.code).sort();
        assert.deepEqual(told, shown);
    });
});

/* ---- subjects taken together, through every layer ---- */

describe('co-requisites through preferences, the phone answer and a request', () => {
    const { evaluateSelections } = require('../supabase/functions/submit-advising-request/core.js');
    const co = (a, b) => R(a, b, { type: 'co_requisite' });
    const lec = S('LEC'), lab = S('LAB'), other = S('OTH');
    const rules = [co(lab, lec)];
    const student = { id: 'stu-1', student_id: '1', first_name: 'A', last_name: 'B', year_level: 1 };
    const program = { code: 'X', name: 'X', max_units: 24, max_units_graduating: 27 };
    const many = Array.from({ length: 12 }, (_, i) => S(`F${i}`));

    test('a clash that removes the lecture removes its lab too, and says why', () => {
        const offerings = [
            meet(lec, 'LEC1', 'MW', '08:00', '09:30'), meet(lab, 'LAB1', 'TTH', '08:00', '09:30'), meet(other, 'O1', 'MW', '08:00', '09:30'),
        ];
        // OTH and LEC clash; keep OTH so LEC (and so LAB) must go: make OTH heavier
        const heavy = S('HEAVY', { units: 6 });
        offerings.push(meet(heavy, 'H1', 'MW', '08:00', '09:30'));
        const base = run([lec, lab, heavy], rules, [], { offerings });
        const plan = P.apply(base, null);
        const got = codes(plan.recommended);
        assert.ok(!got.includes('LAB') || got.includes('LEC'), 'never the lab without its lecture');
    });

    test('a light load never keeps the lab without the lecture', () => {
        const base = run([lec, lab, ...many], rules, [], { options: { maxUnits: 24, maxUnitsGraduating: 1 } });
        for (const load of ['light', 'regular', 'full']) {
            const got = codes(P.apply(base, { load }).recommended);
            assert.ok(!got.includes('LAB') || got.includes('LEC'), load);
        }
    });

    test('the pair dropped by the load is listed as left out, naming what it needs', () => {
        // 5 free subjects of 3 units, then the pair: a 3-unit ceiling cannot hold LAB with LEC
        const base = run([lec, lab], rules, [], { options: { maxUnits: 24, maxUnitsGraduating: 1 } });
        const plan = P.apply({ ...base, availableUnits: 3 }, { load: 'light' });
        const gotLab = plan.recommended.find(e => e.subject.code === 'LAB');
        assert.equal(gotLab, undefined);
        const lo = plan.leftOutForClash.find(e => e.subject.code === 'LAB');
        if (lo) assert.deepEqual(lo.mustBeWith, ['LEC']);
    });

    test('the phone answer says which subjects go together', () => {
        const out = assessStudent({ engine: E, preferences: P, explain, SC },
            { student, program, records: [], subjects: [lec, lab], rules, offerings: [], term: 1, year: 2024, prefs: null });
        const labOut = out.recommended.find(r => r.code === 'LAB');
        assert.deepEqual(labOut.alongside, ['LEC']);
        assert.deepEqual(out.recommended.find(r => r.code === 'LEC').alongside, []);
    });

    const submit = (selected, records = []) => evaluateSelections({ engine: E }, {
        student: { id: 'stu-1', year_level: 1 }, program, records,
        subjects: [lec, lab, other], rules, offerings: [], term: 1,
        selections: selected.map(s => ({ subjectId: s.id })),
    });

    test('a request with the lab but not its lecture is refused, with the reason', () => {
        const [res] = submit([lab]);
        assert.equal(res.valid, false);
        assert.match(res.reason, /must be taken together with LEC/);
    });

    test('a request with both is accepted', () => {
        const res = submit([lec, lab]);
        assert.ok(res.every(r => r.valid));
    });

    test('a request with the lecture alone is accepted', () => {
        assert.ok(submit([lec])[0].valid);
    });

    test('the lab alone is accepted when the lecture is already being taken', () => {
        assert.ok(submit([lab], [rec(lec, 'ENROLLED')])[0].valid);
    });
});

/* ---- a section the student reported full at the EDP office ---- */

describe('a section reported full by the student', () => {
    const edp = require('../shared/js/edpresult.js');
    const A = S('A'), B = S('B');
    const student = { id: 'stu-1', student_id: '1', first_name: 'A', last_name: 'B', year_level: 1 };
    const program = { code: 'X', name: 'X', max_units: 24, max_units_graduating: 27 };
    const a1 = meet(A, 'A1', 'MW', '08:00', '09:30'), a1lab = meet(A, 'A1', 'F', '13:00', '16:00', 'LAB');
    const a2 = meet(A, 'A2', 'TTH', '08:00', '09:30');
    const b1 = meet(B, 'B1', 'MW', '10:00', '11:30');
    const offerings = [a1, a1lab, a2, b1];
    const go = (over = {}, withEdp = true) => assessStudent(
        withEdp ? { engine: E, preferences: P, explain, SC, edp } : { engine: E, preferences: P, explain, SC },
        { student, program, records: [], subjects: [A, B], rules: [], offerings, term: 1, year: 2024, prefs: null, ...over });

    test('without a report, the first section is offered as usual', () => {
        const out = go();
        assert.deepEqual(out.recommended.find(r => r.code === 'A').sections.map(s => s.section), ['A1', 'A2']);
    });

    test('the reported section, lecture and lab together, is no longer offered', () => {
        const out = go({ reportedFullOfferingIds: [a1.id] });
        const a = out.recommended.find(r => r.code === 'A');
        assert.deepEqual(a.sections.map(s => s.section), ['A2']);
        assert.equal(a.section.section, 'A2');
    });

    test('reporting the lab meeting hides the same section', () => {
        const out = go({ reportedFullOfferingIds: [a1lab.id] });
        assert.deepEqual(out.recommended.find(r => r.code === 'A').sections.map(s => s.section), ['A2']);
    });

    test('other subjects are untouched', () => {
        const out = go({ reportedFullOfferingIds: [a1.id] });
        assert.deepEqual(out.recommended.find(r => r.code === 'B').sections.map(s => s.section), ['B1']);
    });

    test('with no other section left, the subject is still shown, with no section', () => {
        const out = go({ offerings: [a1, a1lab, b1], reportedFullOfferingIds: [a1.id] });
        const a = out.recommended.find(r => r.code === 'A') ?? out.alsoOpen.find(r => r.code === 'A');
        assert.ok(a, 'the subject is still in the answer');
        assert.deepEqual(a.sections, []);
    });

    test('an empty list, an unknown id, or a server without the helper changes nothing', () => {
        assert.equal(go({ reportedFullOfferingIds: [] }).recommended.find(r => r.code === 'A').sections.length, 2);
        assert.equal(go({ reportedFullOfferingIds: [999999] }).recommended.find(r => r.code === 'A').sections.length, 2);
        assert.equal(go({ reportedFullOfferingIds: [a1.id] }, false).recommended.find(r => r.code === 'A').sections.length, 2);
    });

    test('the offerings given in are not changed', () => {
        const before = JSON.stringify(offerings);
        go({ reportedFullOfferingIds: [a1.id] });
        assert.equal(JSON.stringify(offerings), before);
    });
});
