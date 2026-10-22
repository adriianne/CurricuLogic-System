// recordgrades.test.mjs
// Which grade the curriculum grid shows for each subject, and the grid's Grade column.
//
//   node --test tests/recordgrades.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const G = require('../shared/js/records/recordgrades.js');

const row = (subject_id, status, o = {}) => ({
    subject_id, status, grade: o.grade ?? null, grade_points: o.gp ?? null,
    taken_year: o.year ?? 2022, taken_term: o.term ?? 1,
});

describe('pick / byStudent', () => {
    test('a passing attempt shows its grade points', () => {
        const m = G.byStudent([row(1, 'PASSED', { gp: 1.75 })]);
        assert.deepEqual(m.get(1), { grade: '1.75', tone: 'pass', title: '1st Sem · 2022' });
    });

    test('the raw grade is shown when there are no grade points', () => {
        assert.equal(G.byStudent([row(1, 'PASSED', { grade: '1.5' })]).get(1).grade, '1.5');
    });

    test('a pass after a fail shows the pass', () => {
        const m = G.byStudent([row(1, 'FAILED', { gp: 5, year: 2021 }), row(1, 'PASSED', { gp: 2.5, year: 2022 })]);
        assert.equal(m.get(1).grade, '2.50');
        assert.equal(m.get(1).tone, 'pass');
    });

    test('only failed attempts show the latest failure', () => {
        const m = G.byStudent([row(1, 'FAILED', { gp: 5, year: 2021 }), row(1, 'FAILED', { grade: 'INC', year: 2023 })]);
        assert.equal(m.get(1).grade, 'INC');
        assert.equal(m.get(1).tone, 'fail');
    });

    test('a failed attempt with no grade written says Failed', () => {
        assert.equal(G.byStudent([row(1, 'FAILED')]).get(1).grade, 'Failed');
    });

    test('a subject being taken has no grade yet, and a dropped one says so', () => {
        assert.equal(G.byStudent([row(1, 'ENROLLED')]).has(1), false);
        assert.equal(G.byStudent([row(1, 'DROPPED')]).get(1).grade, 'Dropped');
    });

    test('rows without a subject are ignored, and each subject is separate', () => {
        const m = G.byStudent([row(null, 'PASSED', { gp: 1 }), row(1, 'PASSED', { gp: 1 }), row(2, 'FAILED', { gp: 5 })]);
        assert.deepEqual([...m.keys()].sort(), [1, 2]);
    });
});

describe('attach', () => {
    test('puts the grade on the status entry and switches the column on', () => {
        const st = new Map([[1, { state: 'passed' }], [2, { state: 'eligible' }]]);
        G.attach(st, [row(1, 'PASSED', { gp: 1.25 })]);
        assert.equal(st.get(1).grade, '1.25');
        assert.equal(st.get(1).gradeTone, 'pass');
        assert.equal(st.get(2).grade, undefined);
        assert.equal(st.showGrade, true);
    });

    test('an elective slot takes the grade of the subject that filled it', () => {
        const st = new Map([[10, { state: 'passed', filledBy: { id: 99 } }]]);
        G.attach(st, [row(99, 'PASSED', { gp: 2 })]);
        assert.equal(st.get(10).grade, '2.00');
    });
});

describe('the grid\'s Grade column', () => {
    const sandbox = { window: {} };
    vm.runInNewContext(readFileSync(new URL('../shared/js/curriculum/prospectusgrid.js', import.meta.url), 'utf8'), sandbox);
    const grid = sandbox.window.ProspectusGrid;

    const rows = [
        { id: 1, code: 'A', title: 'Alpha', units: 3, lec_units: 3, lab_units: 0, year_level: 1, term: 1 },
        { id: 2, code: 'B', title: 'Beta',  units: 3, lec_units: 3, lab_units: 0, year_level: 1, term: 1 },
        { id: 3, code: 'C', title: 'Gamma', units: 2, lec_units: 2, lab_units: 0, year_level: 1, term: 1 },
    ];
    const rules = new Map();
    const statuses = (extra = {}) => {
        const m = new Map([
            [1, { state: 'passed', grade: '1.75', gradeTone: 'pass', gradeTitle: '1st Sem · 2022' }],
            [2, { state: 'retake', grade: '5.00', gradeTone: 'fail' }],
            [3, { state: 'eligible' }],
        ]);
        Object.assign(m, extra);
        return m;
    };

    test('shows the Grade column after Status, with colours, when grades are supplied', () => {
        const html = grid.panelHtml('1st Semester', rows, rules, false, statuses({ showGrade: true }));
        assert.match(html, /<th>Status<\/th><th class="pg-gr-h">Grade<\/th>/);
        assert.match(html, /<td class="pg-gr pass" title="1st Sem · 2022">1\.75<\/td>/);
        assert.match(html, /<td class="pg-gr fail">5\.00<\/td>/);
        assert.match(html, /<td class="pg-gr"><\/td>/);
        assert.match(html, /3 subjects · 1 passed/);
    });

    test('leaves the table as it was when no grades are supplied', () => {
        const html = grid.panelHtml('1st Semester', rows, rules, false, statuses());
        assert.doesNotMatch(html, /pg-gr/);
        assert.ok(html.includes('<span class="pg-note">3 subjects</span>'));
        assert.match(html, /<th>Status<\/th><\/tr>/);
    });

    test('the progress line counts passed units', () => {
        const html = grid.progressHtml(rows, statuses({ showGrade: true }));
        assert.match(html, /<strong>3<\/strong> of 8 units passed/);
        assert.match(html, /38%/);
        assert.equal(grid.progressHtml(rows, statuses()), '');
    });

    test('escapes what is printed in the Grade cell', () => {
        const m = new Map([[1, { state: 'passed', grade: '<b>x</b>', gradeTone: 'pass' }]]);
        m.showGrade = true;
        const html = grid.panelHtml('S', [rows[0]], rules, false, m);
        assert.ok(!html.includes('<b>x</b>'));
    });
});


describe('groupByTerm / chipFor', () => {
    const r = (code, status, year, term, units = 3) => ({
        subject_id: code.length, subject_code: code, units, status, taken_year: year, taken_term: term,
    });

    test('one group per term, newest first, with counts', () => {
        const groups = G.groupByTerm([
            r('B', 'PASSED', 2022, 1), r('A', 'FAILED', 2022, 1),
            r('C', 'PASSED', 2023, 1, 2), r('D', 'PASSED', 2022, 2),
        ]);
        assert.deepEqual(groups.map(g => g.label), ['1st Sem · 2023', '2nd Sem · 2022', '1st Sem · 2022']);
        const last = groups[2];
        assert.equal(last.subjects, 2);
        assert.equal(last.passed, 1);
        assert.equal(last.unitsEarned, 3);
        assert.deepEqual(last.rows.map(x => x.subject_code), ['A', 'B']);
        assert.equal(groups[0].unitsEarned, 2);
    });

    test('rows with no year are gathered last', () => {
        const groups = G.groupByTerm([r('A', 'PASSED', null, null), r('B', 'PASSED', 2022, 1)]);
        assert.equal(groups.at(-1).label, 'Term not recorded');
        assert.equal(groups.length, 2);
    });

    test('an empty record gives no groups', () => {
        assert.deepEqual(G.groupByTerm([]), []);
        assert.deepEqual(G.groupByTerm(null), []);
    });

    test('status chips match the grid', () => {
        assert.deepEqual(G.chipFor('PASSED'), ['ok', 'Passed']);
        assert.deepEqual(G.chipFor('FAILED'), ['locked', 'Failed']);
        assert.deepEqual(G.chipFor('ENROLLED'), ['info', 'Taking']);
        assert.deepEqual(G.chipFor('DROPPED'), ['', 'Dropped']);
        assert.deepEqual(G.chipFor('ODD'), ['', 'ODD']);
    });
});


describe('curriculum-year chips', () => {
    const sandbox = { window: {} };
    vm.runInNewContext(readFileSync(new URL('../shared/js/curriculum/prospectusgrid.js', import.meta.url), 'utf8'), sandbox);
    const grid = sandbox.window.ProspectusGrid;

    const v = (id, year, active, published = '2024-08-12T00:00:00Z') =>
        ({ id, academic_year: year, is_active: active, published_at: published });

    test('the line under the picker says what the version is and how big', () => {
        const text = grid.versionMeta(v(1, 2024, true), { subjects: 54, units: 176 });
        assert.match(text, /^Active curriculum · published .*2024 · 54 subjects · 176 units$/);
        assert.match(grid.versionMeta(v(2, 2023, false), { subjects: 1, units: 3 }), /^Older version .*1 subject · 3 units$/);
    });

    test('it leaves out what it does not know', () => {
        assert.equal(grid.versionMeta(v(1, 2024, true, null), null), 'Active curriculum');
    });

    test('counts only active subjects placed in a semester', () => {
        const stats = grid.versionStats([
            { prospectus_id: 1, units: 3, term: 1, is_active: true },
            { prospectus_id: 1, units: 3, term: 2, is_active: true },
            { prospectus_id: 1, units: 3, term: null, is_active: true },   // catalogue elective
            { prospectus_id: 1, units: 3, term: 1, is_active: false },      // retired
            { prospectus_id: 2, units: 2, term: 1, is_active: true },
        ]);
        assert.equal(stats.get(1).subjects, 2);
        assert.equal(stats.get(1).units, 6);
        assert.equal(stats.get(2).subjects, 1);
        assert.equal(stats.get(2).units, 2);
    });

    test('one chip per version, the selected one on, the active one tagged', () => {
        const html = grid.chipsHtml([v(1, 2024, true), v(2, 2023, false)], 2);
        assert.equal((html.match(/class="pv-chip/g) ?? []).length, 2);
        assert.match(html, /class="pv-chip on"[^>]*aria-checked="true"[^>]*data-version="2"/);
        assert.match(html, /2024–2025[\s\S]*Active/);
        assert.equal((html.match(/pv-tag/g) ?? []).length, 1);
    });
});
