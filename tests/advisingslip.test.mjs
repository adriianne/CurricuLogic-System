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

describe('requirementLines', () => {
    const byId = new Map(subjects.map(s => [s.id, s]));
    const r = (sub, req, o = {}) => ({ subject_id: sub.id, prerequisite_subject_id: req?.id ?? null,
        requirement_type: o.type ?? 'prerequisite', rule_group: o.group ?? 1, threshold_value: o.t ?? null });

    test('each "and" group is its own line', () => {
        assert.deepEqual(Slip.requirementLines(C.id, [r(C, A, { group: 1 }), r(C, B, { group: 2 })], byId), ['A21', 'B21']);
    });

    test('"or" choices stay together on one line', () => {
        assert.deepEqual(Slip.requirementLines(C.id, [r(C, A, { group: 1 }), r(C, B, { group: 1 })], byId), ['A21 or B21']);
    });

    test('no rules gives no lines', () => {
        assert.deepEqual(Slip.requirementLines(A.id, [], byId), []);
    });

    test('the text form is the lines joined, as before', () => {
        const rules = [r(C, A, { group: 1 }), r(C, B, { group: 2 })];
        assert.equal(Slip.requirementText(C.id, rules, byId), Slip.requirementLines(C.id, rules, byId).join(', '));
    });

    test('rows carry the lines', () => {
        const rows = Slip.semesterRows({ subjects, rules: [r(C, A, { group: 1 }), r(C, B, { group: 2 })], records: [], yearLevel: 2, term: current });
        assert.deepEqual(rows.find(x => x.code === 'C21').requiresLines, ['A21', 'B21']);
        assert.deepEqual(rows.find(x => x.code === 'A21').requiresLines, []);
    });
});

describe('the pre-requisite and remarks columns', () => {
    const student = { first_name: 'Althea', last_name: 'Villanueva', student_id: '2401187', year_level: 2 };
    const r = (sub, req, o = {}) => ({ subject_id: sub.id, prerequisite_subject_id: req.id,
        requirement_type: 'prerequisite', rule_group: o.group ?? 1, threshold_value: null });
    const html = (over = {}) => Slip.html({
        student, subjects, rules: [], records: [], term: current, adviser: 'Rhea Lumactod',
        program: { name: 'BS Information Technology', code: 'BSIT', college: 'College of Computer Studies' },
        ...over,
    });

    test('they are two columns, with their own headings', () => {
        const h = html();
        assert.match(h, /<th class="req">Pre-requisite<\/th><th class="rem">Remarks<\/th>/);
        assert.doesNotMatch(h, /Pre-requisite \/ Remarks/);
    });

    test('each prerequisite is on its own line, never split', () => {
        const h = html({ rules: [r(C, A, { group: 1 }), r(C, B, { group: 2 })] });
        assert.match(h, /<span class="ln">A21<\/span><span class="ln">B21<\/span>/);
    });

    test('a subject with no prerequisite shows a dash', () => {
        assert.match(html(), /<span class="ln none-dash">—<\/span>/);
    });

    test('Approved sits in the remarks column, not with the prerequisites', () => {
        const h = html({ approvedIds: [A.id], rules: [r(C, A)] });
        assert.match(h, /<td class="rem"><strong>Approved<\/strong><\/td>/);
        const reqCell = h.match(/<td class="req">[\s\S]*?<\/td>/g).join('');
        assert.ok(!reqCell.includes('Approved'));
    });

    test('the totals row and the empty row span all eight columns', () => {
        assert.match(html(), /<td class="n">9<\/td><td colspan="2"><\/td>/);
        assert.match(html({ student: { ...student, year_level: 4 } }), /colspan="8" class="none"/);
    });
});

describe('the adviser note on an approved subject', () => {
    const student = { first_name: 'Althea', last_name: 'Villanueva', student_id: '2401187', year_level: 2 };
    const page = (over = {}) => Slip.html({
        student, subjects, rules: [], records: [], term: current, adviser: 'Rhea Lumactod',
        program: { name: 'BS Information Technology', code: 'BSIT', college: 'College of Computer Studies' },
        approvedIds: [A.id, B.id], ...over,
    });

    test('is printed under "Approved" for that subject only', () => {
        const h = page({ approvalNotes: { [A.id]: 'Take this together with B21' } });
        assert.match(h, /<strong>Approved<\/strong><span class="note">Take this together with B21<\/span>/);
        assert.equal((h.match(/class="note"/g) || []).length, 1);
    });

    test('a subject with no note prints just "Approved"', () => {
        const h = page({ approvalNotes: {} });
        assert.doesNotMatch(h, /class="note"/);
        assert.match(h, /<strong>Approved<\/strong>/);
    });

    test('a note on a subject that was not approved is not printed', () => {
        const h = page({ approvedIds: [A.id], approvalNotes: { [B.id]: 'should not show' } });
        assert.doesNotMatch(h, /should not show/);
    });

    test('a note with markup cannot break the page', () => {
        const h = page({ approvalNotes: { [A.id]: '<script>alert(1)</script>' } });
        assert.ok(!h.includes('<script>alert'));
        assert.match(h, /&lt;script&gt;/);
    });

    test('a blank or spaces-only note is no note', () => {
        const h = page({ approvalNotes: { [A.id]: '   ' } });
        assert.doesNotMatch(h, /class="note"/);
    });
});
