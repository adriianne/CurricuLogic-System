// advisingslip.test.mjs
// The enrolment advising slip: one semester block of the curriculum, with a Grade
// column (PASSED / FAILED / RETAKE) taken from the student's record.
//
//   node --test tests/advisingslip.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Slip = require('../shared/js/advisingslip.js');

let id = 1;
const subj = (code, year, term, o = {}) => ({
    id: id++, code, title: o.title ?? `${code} title`, units: o.units ?? 3,
    lec_units: o.lec ?? 3, lab_units: o.lab ?? 0, year_level: year, term, is_elective: false, is_active: true,
});

const A = subj('A21', 2, 1);                          // 2nd year, 1st sem
const B = subj('B21', 2, 1, { lec: 2, lab: 1 });
const C = subj('C21', 2, 1);
const D = subj('D22', 2, 2);                          // 2nd year, 2nd sem
const E = subj('E11', 1, 1);                          // 1st year
const subjects = [A, B, C, D, E];
const current = { number: 1, year: 2023 };

const rec = (s, status, year = 2022, term = 1) => ({ subject_id: s.id, status, taken_year: year, taken_term: term });

describe('gradeFor', () => {
    test('a passing record is PASSED, even if it was failed first', () => {
        const rs = [rec(A, 'FAILED', 2021), rec(A, 'PASSED', 2022)];
        assert.equal(Slip.gradeFor(A.id, rs, current), 'PASSED');
    });

    test('failed in the term being enrolled is FAILED', () => {
        assert.equal(Slip.gradeFor(A.id, [rec(A, 'FAILED', 2023, 1)], current), 'FAILED');
    });

    test('failed in an earlier term is RETAKE', () => {
        assert.equal(Slip.gradeFor(A.id, [rec(A, 'FAILED', 2022, 2)], current), 'RETAKE');
    });

    test('not taken, being taken or dropped is blank', () => {
        assert.equal(Slip.gradeFor(A.id, [], current), '');
        assert.equal(Slip.gradeFor(A.id, [rec(A, 'ENROLLED', 2023, 1)], current), '');
        assert.equal(Slip.gradeFor(A.id, [rec(A, 'DROPPED', 2022, 2)], current), '');
    });
});

describe('requirementText', () => {
    const byId = new Map(subjects.map(s => [s.id, s]));
    const r = (sub, req, o = {}) => ({ subject_id: sub.id, prerequisite_subject_id: req?.id ?? null,
        requirement_type: o.type ?? 'prerequisite', rule_group: o.group ?? 1, threshold_value: o.t ?? null });

    test('groups are "and", choices inside a group are "or"', () => {
        assert.equal(Slip.requirementText(C.id, [r(C, A, { group: 1 }), r(C, B, { group: 2 })], byId), 'A21, B21');
        assert.equal(Slip.requirementText(C.id, [r(C, A, { group: 1 }), r(C, B, { group: 1 })], byId), 'A21 or B21');
    });

    test('a co-requisite and a standing are described', () => {
        assert.equal(Slip.requirementText(C.id, [r(C, A, { type: 'co_requisite' })], byId), 'A21 (co)');
        assert.equal(Slip.requirementText(C.id, [r(C, null, { type: 'standing', t: 22 })], byId), '2nd yr standing');
    });

    test('a subject with no rules has no text', () => {
        assert.equal(Slip.requirementText(A.id, [], byId), '');
    });
});

describe('semesterRows', () => {
    test('prints only the student\'s year level in the term being enrolled', () => {
        const rows = Slip.semesterRows({ subjects, rules: [], records: [], yearLevel: 2, term: current });
        assert.deepEqual(rows.map(r => r.code), ['A21', 'B21', 'C21']);
    });

    test('carries the grade, units and the approved mark', () => {
        const rows = Slip.semesterRows({
            subjects, rules: [], yearLevel: 2, term: current, approvedIds: [B.id],
            records: [rec(A, 'PASSED'), rec(C, 'FAILED', 2022, 2)],
        });
        assert.equal(rows[0].grade, 'PASSED');
        assert.equal(rows[2].grade, 'RETAKE');
        assert.equal(rows[1].approved, true);
        assert.equal(rows[0].approved, false);
        assert.equal(rows[1].lec, '2');
        assert.equal(rows[1].lab, '1');
        assert.equal(rows[0].lab, '');
    });

    test('a semester with no subjects gives no rows', () => {
        assert.deepEqual(Slip.semesterRows({ subjects, rules: [], records: [], yearLevel: 4, term: current }), []);
    });
});

describe('the printed slip', () => {
    const student = { first_name: 'Althea', last_name: 'Villanueva', student_id: '2401187', year_level: 2 };
    const html = (over = {}) => Slip.html({
        student, subjects, rules: [], records: [rec(A, 'PASSED')], term: current, adviser: 'Rhea Lumactod',
        program: { name: 'BS Information Technology', code: 'BSIT', college: 'College of Computer Studies' },
        ...over,
    });

    test('has the header and one semester block, with the grade column', () => {
        const h = html();
        assert.match(h, /Enrolment Advising Slip/);
        assert.match(h, /1st Semester, AY 2023–2024/);
        assert.match(h, /BS Information Technology \(BSIT\)/);
        assert.match(h, /II – SECOND YEAR · 1st Semester/);
        assert.match(h, /<th class="grade">Grade<\/th>/);
        assert.match(h, /PASSED/);
        for (const code of ['A21', 'B21', 'C21']) assert.ok(h.includes(code));
        for (const code of ['D22', 'E11']) assert.ok(!h.includes(code), `${code} is another semester`);
    });

    test('has no date started, expected graduation or CMO lines', () => {
        const h = html();
        assert.doesNotMatch(h, /Date started|Expected graduation|CMO/i);
    });

    test('totals the units of the semester', () => {
        assert.match(html(), /Total units<\/td><td class="n">9<\/td>/);
    });

    test('marks the subjects the adviser approved', () => {
        assert.match(html({ approvedIds: [A.id] }), /<strong>Approved<\/strong>/);
        assert.doesNotMatch(html(), /<strong>Approved<\/strong>/);
    });

    test('says so when the year level is missing or the semester is empty', () => {
        assert.match(html({ student: { ...student, year_level: null } }), /year level is not set/);
        assert.match(html({ student: { ...student, year_level: 4 } }), /No subjects in this student/);
    });

    test('escapes what a person typed', () => {
        const h = html({ student: { ...student, first_name: '<script>x</script>' } });
        assert.ok(!h.includes('<script>x</script>'));
        assert.match(h, /&lt;script&gt;/);
    });
});
