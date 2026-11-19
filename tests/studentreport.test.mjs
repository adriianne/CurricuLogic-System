// studentreport.test.mjs
// The Student Academic Report (shared/js/reports/studentreport.js) and the export helper (reportfile.js).
//   node --test tests/studentreport.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SR = require('../shared/js/reports/studentreport.js');
const RF = require('../shared/js/reports/reportfile.js');
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

const rec = (id, code, units, status, gp, year = 2024, term = 1) =>
    ({ subject_id: id, subject_code: code, subject_title: code + ' title', units, status, grade: gp, grade_points: gp, taken_year: year, taken_term: term });

const student = { first_name: 'Mark Anthony', last_name: 'Sarmiento', student_id: '24001188', year_level: 2, email: 'm@uc.edu.ph' };
const at = new Date('2026-11-19T00:00:00Z');

describe('build', () => {
    const records = [
        rec(1, 'A', 3, 'PASSED', 1.0),
        rec(2, 'B', 3, 'PASSED', 2.0),
        rec(3, 'C', 2, 'FAILED', 5.0),
        rec(4, 'D', 3, 'FAILED', 5.0, 2024, 1),
        rec(4, 'D', 3, 'PASSED', 3.0, 2024, 2),          // failed, then passed
        rec(5, 'E', 3, 'ENROLLED', null, 2024, 2),
        rec(1, 'A', 3, 'PASSED', 1.0, 2025, 1),           // the same subject recorded twice
    ];
    const r = SR.build({ student, program: 'BSIT', curriculum: '2024-2025', totalUnits: 161, records, generatedAt: at });

    test('units count each passed subject once', () => {
        assert.equal(r.units, 9);                         // A 3 + B 3 + D 3
        assert.equal(r.percent, Math.round(9 / 161 * 100));
    });
    test('counts: passed, still failed, retaken and being taken', () => {
        assert.deepEqual(r.counts, { passed: 3, failed: 1, retaken: 1, taking: 1 });
    });
    test('the average is weighted by units over the passed subjects', () => {
        assert.equal(r.average, Math.round(((1.0 * 3 + 2.0 * 3 + 3.0 * 3) / 9) * 100) / 100);   // 2.00
    });
    test('the average is left out when a passed subject has no numeric grade', () => {
        const r2 = SR.build({ student, records: [rec(1, 'A', 3, 'PASSED', 1.0), { ...rec(2, 'B', 3, 'PASSED', null), grade: 'P', grade_points: null }], generatedAt: at });
        assert.equal(r2.average, null);
    });
    test('groups follow the transcript: newest term first', () => {
        assert.equal(r.groups[0].label, '1st Sem · 2025');
        assert.ok(r.groups.length >= 2);
    });
    test('a student with no grades has an empty, honest report', () => {
        const e = SR.build({ student, records: [], generatedAt: at });
        assert.equal(e.units, 0);
        assert.equal(e.average, null);
        assert.deepEqual(e.groups, []);
        assert.match(SR.html(e), /No grades are on file/);
    });
    test('no curriculum total: no percentage, no divide by zero', () => {
        const e = SR.build({ student, records, generatedAt: at });
        assert.equal(e.percent, 0);
        assert.doesNotMatch(SR.html(e), /% of the degree/);
    });
});

describe('html', () => {
    const r = SR.build({
        student: { ...student, first_name: '<b>Mark</b>' }, program: 'BSIT', curriculum: '2024-2025', totalUnits: 161,
        records: [rec(1, 'A', 3, 'PASSED', 1.0)],
        plan: { reference: 'CL-2026-000035', term: '2nd Sem 2024', items: [{ code: 'CC-COMPROG12', title: 'Computer Programming 2', units: 3, schedule: 'BSIT-1A · F 07:30–09:30 + LAB F 13:00–16:00' }] },
        generatedAt: at,
    });
    const h = SR.html(r);
    test('names are escaped', () => {
        assert.doesNotMatch(h, /<b>Mark<\/b>/);
        assert.match(h, /&lt;b&gt;Mark&lt;\/b&gt;/);
    });
    test('shows the headline numbers, the grades and the approved plan with its lab', () => {
        assert.match(h, /3 \/ 161/);
        assert.match(h, /CL-2026-000035/);
        assert.match(h, /LAB F 13:00–16:00/);
        assert.match(h, /2nd Year/);
    });
});

describe('rows (CSV and Excel)', () => {
    const r = SR.build({ student, program: 'BSIT', curriculum: '2024-2025', totalUnits: 161, records: [rec(1, 'A', 3, 'PASSED', 1.0), rec(2, 'B', 3, 'FAILED', 5.0)], generatedAt: at });
    const rows = SR.rows(r);
    test('a summary block, then one line per subject attempt', () => {
        assert.equal(rows[0][0], 'Student Academic Report');
        const head = rows.findIndex((x) => x[0] === 'Term');
        assert.equal(rows.length - head - 1, 2);
        assert.deepEqual(rows[head + 1].slice(1, 3), ['A', 'A title']);
    });
});

describe('ReportFile.csv', () => {
    test('quotes commas, quotes and line breaks', () => {
        assert.equal(RF.csv([['a,b', 'say "hi"', 'x\ny']]), '"a,b","say ""hi""","x\ny"');
    });
    test('rows are joined with CRLF; null and undefined are empty', () => {
        assert.equal(RF.csv([['a', null], ['b', undefined, 3]]), 'a,\r\nb,,3');
    });
    test('a cell that would run as a formula is defused', () => {
        assert.equal(RF.csv([['=SUM(A1)', '+1', '@x']]), "'=SUM(A1),'+1,'@x");
    });
    test('grades and numbers are not defused', () => {
        assert.equal(RF.csv([['1.75', '-', 2, '-3']]), "1.75,'-,2,-3");
    });
    test('safeName makes a file name', () => {
        assert.equal(RF.safeName('Report: Sarmiento, Mark'), 'Report-Sarmiento-Mark');
        assert.equal(RF.safeName(''), 'report');
    });
});

describe('the pages', () => {
    test('the Registrar and the Faculty adviser load the report scripts', () => {
        for (const f of ['features/registrar/registrardashboard.html', 'features/faculty/facultydashboard.html']) {
            const h = read(f);
            assert.match(h, /shared\/js\/reports\/reportfile\.js"><\/script>\s*<script src="\.\.\/\.\.\/shared\/js\/reports\/studentreport\.js"><\/script>/);
        }
    });
});
