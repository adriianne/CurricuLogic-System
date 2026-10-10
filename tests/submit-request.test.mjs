// submit-request.test.mjs
// The decisions of the submit-advising-request function: which subjects are
// locked by an earlier request, and whether each chosen subject is really open.
//
//   node --test tests/submit-request.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { lockedSubjectIds, evaluateSelections, submissionLimit, MAX_PER_DAY } = require('../supabase/functions/submit-advising-request/core.js');
const engine = require('../shared/engine/engine.js');

let id = 500;
const subj = (code, y, t) => ({ id: id++, code, title: code, units: '3.00', year_level: y, term: t, is_elective: false, elective_type: null });
const A = subj('A', 1, 1), B = subj('B', 1, 1), C = subj('C', 1, 2), D = subj('D', 3, 1);
const subjects = [A, B, C, D];
const rules = [{ subject_id: C.id, prerequisite_subject_id: A.id, requirement_type: 'prerequisite', rule_type: 'and', rule_group: 1, threshold_value: null }];
const student = { id: 's1', year_level: 1 };
const records = [{ subject_id: B.id, status: 'PASSED', grade: '1.5' }];
const offerings = [{ id: 9001, subject_id: A.id }, { id: 9002, subject_id: C.id }];

const run = (selections, over = {}) => evaluateSelections({ engine }, {
    student, program: null, records, subjects, rules, offerings, term: 1, selections, ...over,
});

describe('evaluateSelections', () => {
    test('an open subject with its own section is valid', () => {
        const [r] = run([{ subjectId: A.id, offeringId: 9001 }]);
        assert.equal(r.valid, true);
        assert.equal(r.reason, null);
    });

    test('a subject whose prerequisite is unmet is flagged with the engine reason', () => {
        const [r] = run([{ subjectId: C.id, offeringId: 9002 }]);
        assert.equal(r.valid, false);
        assert.match(r.reason, /A has not been taken/);
    });

    test('already-passed and unknown subjects are flagged', () => {
        const [p, u] = run([{ subjectId: B.id, offeringId: null }, { subjectId: 99999, offeringId: null }]);
        assert.equal(p.valid, false);
        assert.match(p.reason, /already passed/);
        assert.equal(u.valid, false);
        assert.match(u.reason, /not found/);
    });

    test('a section that belongs to another subject is flagged', () => {
        const [r] = run([{ subjectId: A.id, offeringId: 9002 }]);
        assert.equal(r.valid, false);
        assert.match(r.reason, /section/);
    });

    test('a missing section is allowed and order is kept', () => {
        const out = run([{ subjectId: C.id }, { subjectId: A.id }]);
        assert.deepEqual(out.map(r => r.subjectId), [C.id, A.id]);
        assert.equal(out[1].offeringId, null);
        assert.equal(out[1].valid, true);
    });

    test('the same engine gates a later-year subject', () => {
        const prospectusWithGate = [...subjects];
        const [r] = run([{ subjectId: D.id }], { subjects: prospectusWithGate });
        assert.equal(r.valid, false, 'year 3 is not open to a student who has not finished year 1 and 2');
    });
});

describe('lockedSubjectIds', () => {
    const req = (registrar_status, ...items) => ({ registrar_status, request_item: items.map(([subject_id, status]) => ({ subject_id, status })) });

    test('a pending or accepted item is locked', () => {
        const locked = lockedSubjectIds([req(null, [1, 'valid'], [2, 'flagged'], [3, 'approved'])]);
        assert.deepEqual([...locked].sort(), [1, 2, 3]);
    });

    test('a rejected item or a plan sent back is free again', () => {
        assert.equal(lockedSubjectIds([req(null, [1, 'rejected'])]).has(1), false);
        assert.equal(lockedSubjectIds([req('rejected', [1, 'valid'])]).has(1), false);
    });

    test('only the most recent request per subject counts', () => {
        // newest first: a later rejection frees it even though an older one is live
        assert.equal(lockedSubjectIds([req(null, [1, 'rejected']), req(null, [1, 'valid'])]).has(1), false);
        assert.equal(lockedSubjectIds([req(null, [1, 'valid']), req(null, [1, 'rejected'])]).has(1), true);
    });

    test('nothing in, nothing locked', () => {
        assert.equal(lockedSubjectIds(null).size, 0);
    });
});

describe('submissionLimit', () => {
    const now = Date.parse('2026-10-10T12:00:00Z');
    const ago = (seconds) => ({ created_at: new Date(now - seconds * 1000).toISOString() });

    test('a first request is allowed', () => {
        assert.equal(submissionLimit([], now).ok, true);
    });

    test('a second request seconds after the first is refused', () => {
        const r = submissionLimit([ago(5)], now);
        assert.equal(r.ok, false);
        assert.ok(r.retryAfterSeconds > 0 && r.retryAfterSeconds <= 30);
    });

    test('a few requests spread out through the day are fine', () => {
        const reqs = [ago(120), ago(3600), ago(7200), ago(10800)];
        assert.equal(submissionLimit(reqs, now).ok, true);
    });

    test('the daily maximum is refused until the oldest one is a day old', () => {
        const reqs = Array.from({ length: MAX_PER_DAY }, (_, i) => ago(3600 * (i + 1)));
        const r = submissionLimit(reqs, now);
        assert.equal(r.ok, false);
        assert.equal(r.retryAfterSeconds, 24 * 3600 - 3600 * MAX_PER_DAY);
    });

    test('requests older than a day do not count', () => {
        const reqs = Array.from({ length: MAX_PER_DAY + 3 }, (_, i) => ago(86400 + 60 * (i + 1)));
        assert.equal(submissionLimit(reqs, now).ok, true);
    });

    test('bad dates are ignored rather than crashing', () => {
        assert.equal(submissionLimit([{ created_at: 'nope' }, { created_at: null }], now).ok, true);
    });
});


describe('evaluateSelections: availability this semester', () => {
    // Block 1st year 1st sem has one scheduled subject (A), so B in the same block is "not run".
    const x = subj('X', 2, 1), y = subj('Y', 2, 2);
    const items = [A, B, C, x, y];
    const offs = [{ id: 9101, subject_id: A.id }, { id: 9102, subject_id: C.id }];
    const go = (selections) => evaluateSelections({ engine }, {
        student, program: null, records: [], subjects: items, rules: [], offerings: offs, term: 1, selections,
    });

    test('a subject with a section this term is accepted', () => {
        const [r] = go([{ subjectId: A.id, offeringId: 9101 }]);
        assert.equal(r.valid, true);
        assert.ok(!r.unavailable);
    });

    test('a subject its block is not running is refused as unavailable', () => {
        const [r] = go([{ subjectId: B.id, offeringId: null }]);
        assert.equal(r.valid, false);
        assert.equal(r.unavailable, true);
        assert.match(r.reason, /not running this subject/);
    });

    test('another semester\'s subject with no section is refused as unavailable', () => {
        const [r] = go([{ subjectId: y.id, offeringId: null }]);
        assert.equal(r.unavailable, true);
        assert.match(r.reason, /another semester/);
    });

    test('a subject of this semester in an unscheduled block is still accepted', () => {
        const [r] = go([{ subjectId: x.id, offeringId: null }]);
        assert.equal(r.valid, true);
    });
});
