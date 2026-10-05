// The summary Cura reads: the unit limit, and subjects already submitted.
//   node --test tests/cura-summary.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const engine = require('../shared/engine/engine.js');
const explain = require('../ai-assist/eligibility-explanation.js');

let id = 1;
const subj = (code, o = {}) => ({ id: id++, code, title: `${code} title`, units: o.units ?? '3.00', year_level: o.y ?? 1, term: o.t ?? 1, is_elective: false, elective_type: null });
const A = subj('A'), B = subj('B'), C = subj('C', { units: '2.00' });
const BIG = subj('BIG', { units: '40.00', y: 2, t: 1 });   // keeps the student far from graduating
const subjects = [A, B, C, BIG];

const assess = (maxUnits = 24) => engine.assess(
    { id: 's', year_level: 1 }, [],
    { subjects, rules: [], offerings: [] },
    { maxUnits, maxUnitsGraduating: 27, term: 1, respectOfferings: false },
);

test('the summary carries the unit limit, apart from the recommended load', () => {
    const s = explain.summarizeForExplanation(assess(24), 'Ann');
    assert.equal(s.unitLimit, 24);
    assert.equal(s.graduating, false);
    assert.equal(s.recommendedUnits, 8);                 // 3 + 3 + 2, well under the limit
    assert.notEqual(s.recommendedUnits, s.unitLimit);
});

test('a programme with a bigger limit shows that limit', () => {
    assert.equal(explain.summarizeForExplanation(assess(31), 'Ann').unitLimit, 31);
});

test('near graduation the higher limit is reported', () => {
    const s = explain.summarizeForExplanation(engine.assess({ id: 's', year_level: 1 }, [], { subjects: [A, B, C], rules: [], offerings: [] }, { maxUnits: 24, maxUnitsGraduating: 27, term: 1, respectOfferings: false }), 'Ann');
    assert.equal(s.unitLimit, 27);
    assert.equal(s.graduating, true);
});

test('with no request in review nothing changes', () => {
    const s = explain.summarizeForExplanation(assess(), 'Ann');
    assert.equal(s.recommended.length, 3);
    assert.deepEqual(s.inReview, []);
    assert.equal(s.inReviewUnits, 0);
});

test('subjects already submitted leave "recommended" and move to "inReview"', () => {
    const s = explain.summarizeForExplanation(assess(), 'Ann', { inRequestIds: [A.id, C.id] });
    assert.deepEqual(s.recommended.map(r => r.code), ['B']);
    assert.deepEqual(s.inReview.map(r => r.code).sort(), ['A', 'C']);
    assert.equal(s.recommendedUnits, 3, 'units of what is still to submit');
    assert.equal(s.inReviewUnits, 5);
});

test('when everything is submitted nothing is left to recommend', () => {
    const s = explain.summarizeForExplanation(assess(), 'Ann', { inRequestIds: [A.id, B.id, C.id] });
    assert.deepEqual(s.recommended, []);
    assert.equal(s.recommendedUnits, 0);
    assert.equal(s.inReview.length, 3);
});

test('an id that is not recommended is ignored', () => {
    const s = explain.summarizeForExplanation(assess(), 'Ann', { inRequestIds: [9999] });
    assert.equal(s.recommended.length, 3);
    assert.deepEqual(s.inReview, []);
});

// ---- the section planner's leftovers ----
const P = require('../shared/engine/preferences.js');
const meet = (s, section, days, start, end) => ({ subject_id: s.id, section, meeting_type: 'LEC', schedule_days: days, start_time: start, end_time: end });

test('a subject left out for a clash reaches Cura with what blocks it', () => {
    const X = subj('PX'), Y = subj('PY');
    const offerings = [meet(X, '1-A', 'MW', '08:00', '09:30'), meet(Y, '1-A', 'MW', '08:30', '10:00')];
    const result = engine.assess({ id: 's', year_level: 1 }, [], { subjects: [X, Y], rules: [], offerings }, { maxUnits: 24, maxUnitsGraduating: 27, term: 1 });
    const plan = P.apply(result, {});
    const s = explain.summarizeForExplanation(plan, 'Ann');
    assert.equal(s.recommended.length, 1);
    assert.equal(s.leftOutForClash.length, 1);
    assert.ok(s.leftOutForClash[0].blockedBy[0].startsWith(s.recommended[0].code));
    // the pair-level clash list still covers the left-out subject's sections
    assert.equal(s.scheduleConflicts.length, 1);
});

test('when everything fits, leftOutForClash is null', () => {
    const X = subj('QX'), Y = subj('QY');
    const offerings = [meet(X, '1-A', 'MW', '08:00', '09:30'), meet(Y, '1-A', 'TTH', '08:00', '09:30')];
    const result = engine.assess({ id: 's', year_level: 1 }, [], { subjects: [X, Y], rules: [], offerings }, { maxUnits: 24, maxUnitsGraduating: 27, term: 1 });
    assert.equal(explain.summarizeForExplanation(P.apply(result, {}), 'Ann').leftOutForClash, null);
});
