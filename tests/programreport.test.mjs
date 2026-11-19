// programreport.test.mjs
// The Programme Report (shared/js/reports/programreport.js): the numbers, the page, the files and the loader.
//   node --test tests/programreport.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const PR = require('../shared/js/reports/programreport.js');
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const at = new Date('2026-11-19T00:00:00Z');

const pros = [
    { id: 30, label: '2024–2025', units: 100, active: true },
    { id: 20, label: '2023–2024', units: 100, active: false },
];
const pass = (student_id, subject_id, units) => ({ student_id, subject_id, status: 'PASSED', units });
const students = [
    { id: 'a', year_level: 1, prospectus_id: 30, record_verified: true },
    { id: 'b', year_level: 2, prospectus_id: 30, record_verified: true },
    { id: 'c', year_level: 4, prospectus_id: 20, record_verified: true },
    { id: 'd', year_level: 1, prospectus_id: null, record_verified: false },     // no curriculum of their own, no grades
];
const records = [
    pass('a', 1, 10), pass('a', 1, 10),                       // the same subject twice counts once: 10 units = 10%
    pass('b', 1, 30), pass('b', 2, 30),                       // 60 units = 60%
    pass('c', 1, 40), pass('c', 2, 40), pass('c', 3, 10),     // 90 units = 90%, 10 left
];
const requests = [
    { student_id: 'a', status: 'submitted' }, { student_id: 'b', status: 'approved' }, { student_id: 'b', status: 'approved' },
    { student_id: 'c', status: 'rejected' }, { student_id: 'zzz', status: 'approved' },   // not this programme
];
const r = PR.build({ students, records, prospectuses: pros, requests }, { programName: 'BSIT', generatedAt: at });

describe('build', () => {
    test('counts students, those without grades, and the year levels', () => {
        assert.equal(r.total, 4);
        assert.equal(r.noGrades, 1);
        assert.equal(r.withGrades, 3);
        assert.deepEqual(r.years.map((y) => [y.label, y.count]), [['1st Year', 2], ['2nd Year', 1], ['4th Year', 1]]);
    });
    test('a student with no curriculum of their own is measured on the active one and labelled so', () => {
        assert.deepEqual(r.curricula.map((c) => [c.label, c.count]), [['2024–2025 (active)', 3], ['2023–2024', 1]]);
    });
    test('progress is each subject once, against the student\'s own curriculum', () => {
        // a 10%, b 60%, c 90%, d 0% -> average 40
        assert.equal(r.averagePercent, 40);
        assert.deepEqual(r.bands.map((b) => b.count), [2, 0, 1, 1]);
    });
    test('near graduation: 1 to 30 units still to earn', () => {
        assert.equal(r.nearGraduation, 1);                                   // only c (10 left)
        assert.equal(PR.build({ students, records, prospectuses: pros }, { near: 5 }).nearGraduation, 0);
    });
    test('a finished student (nothing left) is not "near graduation"', () => {
        const done = PR.build({ students: [students[0]], records: [pass('a', 1, 100)], prospectuses: pros });
        assert.equal(done.nearGraduation, 0);
    });
    test('requests are counted per status, for this programme\'s students only', () => {
        const by = Object.fromEntries(r.requests.byStatus.map((s) => [s.status, s.count]));
        assert.equal(by.submitted, 1);
        assert.equal(by.approved, 2);
        assert.equal(by.rejected, 1);
        assert.equal(r.requests.total, 4);
    });
    test('an empty programme gives zeros and no average, never NaN', () => {
        const e = PR.build({ students: [], records: [], prospectuses: [], requests: [] });
        assert.equal(e.total, 0);
        assert.equal(e.averagePercent, null);
        assert.equal(e.averageUnits, null);
        assert.doesNotMatch(PR.html(e), /NaN/);
        assert.doesNotMatch(PR.screen(e), /NaN/);
    });
    test('a curriculum with no total units cannot be measured, so it adds no progress', () => {
        const x = PR.build({ students: [students[0]], records, prospectuses: [{ id: 30, label: 'x', units: 0, active: true }] });
        assert.equal(x.averagePercent, null);
    });
});

describe('page and files', () => {
    test('the printed page carries the numbers and the programme name', () => {
        const h = PR.html(r);
        assert.match(h, /Programme Report/);
        assert.match(h, /BSIT/);
        assert.match(h, /Within 30 units of graduating/);
        assert.match(h, /2024–2025 \(active\)/);
    });
    test('names are escaped', () => {
        const h = PR.html(PR.build({ students: [], records: [], prospectuses: [] }, { programName: '<img src=x>' }));
        assert.doesNotMatch(h, /<img src=x>/);
    });
    test('an unreadable request list is said, not shown as zero', () => {
        const u = PR.build({ students, records, prospectuses: pros, requests: [], requestsUnreadable: true });
        assert.match(PR.html(u), /could not be read/);
        assert.match(PR.screen(u), /cannot be read/);
        assert.ok(PR.rows(u).some((x) => /Not readable/.test(x[0])));
    });
    test('rows: a summary, then each table with its heading', () => {
        const rows = PR.rows(r);
        assert.equal(rows[0][0], 'Programme Report');
        for (const h of ['Students by year level', 'Students by curriculum', 'Progress through the degree', 'Advising requests']) {
            assert.ok(rows.some((x) => x[0] === h), h);
        }
        assert.deepEqual(rows.find((x) => x[0] === '1st Year'), ['1st Year', 2]);
    });
});

// A stand-in client: every table answers from `tables`, honours eq / in / range, and records what it was asked.
function fakeClient(tables, { failTable = null } = {}) {
    const calls = [];
    const from = (name) => {
        let rows = [...(tables[name] ?? [])];
        let range = null;
        const q = {
            select: () => q, order: () => q, not: () => q,
            eq: (c, v) => { rows = rows.filter((x) => x[c] === v); return q; },
            in: (c, vals) => { rows = rows.filter((x) => vals.includes(x[c])); return q; },
            range: (a, b) => { range = [a, b]; calls.push([name, a, b]); return q; },
            then: (res, rej) => Promise.resolve(failTable === name
                ? { data: null, error: { message: 'denied' } }
                : { data: range ? rows.slice(range[0], range[1] + 1) : rows, error: null }).then(res, rej),
        };
        return q;
    };
    return { from, calls };
}

describe('load', () => {
    const tables = {
        university_student: [
            { id: 's1', program_id: 1, year_level: 1, prospectus_id: 30, record_verified: true },
            { id: 's2', program_id: 2, year_level: 1, prospectus_id: 40, record_verified: true },
        ],
        prospectus: [
            { id: 30, program_id: 1, academic_year: 2024, is_active: true },
            { id: 40, program_id: 2, academic_year: 2024, is_active: true },
        ],
        subject: [
            { id: 1, prospectus_id: 30, units: 3, year_level: 1, is_active: true }, { id: 2, prospectus_id: 30, units: 4, year_level: 1, is_active: true },
            { id: 3, prospectus_id: 40, units: 9, year_level: 1, is_active: true },
        ],
        academic_record: [
            { student_id: 's1', subject_id: 1, status: 'PASSED', subject: { units: 3, code: 'A1', title: 'Alpha' } },
            { student_id: 's2', subject_id: 3, status: 'PASSED', subject: { units: 9 } },
        ],
        request: [{ student_id: 's1', status: 'approved' }, { student_id: 's2', status: 'approved' }],
    };
    test('reads only the chosen programme and totals its curriculum', async () => {
        const raw = await PR.load(fakeClient(tables), { programId: 1 });
        assert.deepEqual(raw.students.map((s) => s.id), ['s1']);
        assert.deepEqual(raw.prospectuses, [{ id: 30, label: '2024–2025', units: 7, active: true }]);
        assert.deepEqual(raw.records, [{ student_id: 's1', subject_id: 1, status: 'PASSED', units: 3, code: 'A1', title: 'Alpha' }]);
        assert.equal(raw.requests.length, 1);
    });
    test('pages through more than 1000 rows', async () => {
        const many = Array.from({ length: 2300 }, (_, i) => ({ id: 's' + i, program_id: 1, year_level: 1, prospectus_id: 30, record_verified: true }));
        const c = fakeClient({ ...tables, university_student: many, academic_record: [], request: [] });
        const raw = await PR.load(c, { programId: 1 });
        assert.equal(raw.students.length, 2300);
        assert.ok(c.calls.filter((x) => x[0] === 'university_student').length >= 3);
    });
    test('a role that cannot read requests still gets the rest', async () => {
        const raw = await PR.load(fakeClient(tables, { failTable: 'request' }), { programId: 1 });
        assert.equal(raw.requestsUnreadable, true);
        assert.equal(raw.students.length, 1);
    });
    test('a failed read of the students stops the report with an error', async () => {
        await assert.rejects(PR.load(fakeClient(tables, { failTable: 'university_student' }), { programId: 1 }), /denied/);
    });
});

describe('the pages', () => {
    test('the Department has a Reports tab that loads the report', () => {
        const h = read('features/department/departmentdashboard.html');
        const j = read('features/department/departmentdashboard.js');
        assert.match(h, /data-view="reports"/);
        assert.match(h, /id="view-reports"/);
        assert.match(h, /reports\/reportfile\.js"><\/script>\s*<script src="\.\.\/\.\.\/shared\/js\/reports\/studentreport\.js"><\/script>\s*<script src="\.\.\/\.\.\/shared\/js\/reports\/programreport\.js"><\/script>/);
        assert.match(j, /reports:\s+'Reports'/);
        assert.match(j, /if \(name === 'reports'\) initReports\(\);/);
        assert.match(j, /ProgramReport\.load\(supabase, \{ programId: programScoped\(\) && PROGRAM \? PROGRAM\.id : null \}\)/);
    });

    test('the Registrar has the report on the Students page', () => {
        const h = read('features/registrar/registrardashboard.html');
        const j = read('features/registrar/registrardashboard.js');
        assert.match(h, /id="report-program-actions"/);
        assert.match(h, /studentreport\.js"><\/script>\s*<script src="\.\.\/\.\.\/shared\/js\/reports\/programreport\.js"><\/script>/);
        assert.match(j, /if \(name === 'students'\) \{ openStudentList\(\); loadProgramReport\(\); \}/);
        assert.match(j, /ProgramReport\.load\(supabase, \{ programId: PROGRAM_SCOPE === 'all' \? null : PROGRAM_SCOPE \}\)/);
    });
});
