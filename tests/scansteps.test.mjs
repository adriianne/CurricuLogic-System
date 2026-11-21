// scansteps.test.mjs
// The circles in the scan check: 0----0----0----0 (extractioncheck.js overview().steps and html()).
//
//   node --test tests/scansteps.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const X = require('../shared/js/curriculum/extractioncheck.js');
const css = readFileSync(new URL('../features/department/curriculum-builder.css', import.meta.url), 'utf8');

const sub = (code, y, t, lec, lab = 0, title = code) => ({ code, title, year_level: y, term: t, lecture_units: lec, laboratory_units: lab });
const good = () => X.overview(
    [sub('A', 1, 1, 3), sub('B', 1, 2, 3), sub('IT-EL1', null, null, 3, 0, 'IT Elective 1')],
    { grand_total_units: 6, blocks: [{ year_level: 1, term: 1, total_units: 3 }, { year_level: 1, term: 2, total_units: 3 }] },
    { prereqLinks: 1, gates: 2, followUps: [], interpreted: [], rowsWithErrors: 0 });
const byTitle = (r, t) => r.steps.find((s) => s.title === t);

describe('the six steps of a clean scan', () => {
    const r = good();
    test('there are six, in the order the file went through them', () => {
        assert.deepEqual(r.steps.map((s) => s.title),
            ['PDF read', 'Subjects found', 'Units checked', 'Semesters checked', 'Prerequisites linked', 'Rows ready']);
    });
    test('all pass, and each says what it found', () => {
        assert.ok(r.steps.every((s) => s.status === 'ok'));
        assert.equal(byTitle(r, 'Subjects found').detail, '3 found: 2 scheduled, 1 electives');
        assert.equal(byTitle(r, 'Units checked').detail, '6 of 6 units match');
        assert.equal(byTitle(r, 'Semesters checked').detail, 'All 2 totals match');
        assert.equal(byTitle(r, 'Prerequisites linked').detail, '1 read, 2 year gates');
        assert.equal(byTitle(r, 'Rows ready').detail, 'No repeats, every row valid');
    });
});

describe('the steps when something needs a look', () => {
    test('a missing summer term turns the units and the semesters amber, and nothing else', () => {
        const r = X.overview([sub('A', 3, 1, 3), sub('B', 3, 2, 3)], { grand_total_units: 12, blocks: [
            { year_level: 3, term: 1, total_units: 3 }, { year_level: 3, term: 2, total_units: 3 }, { year_level: 3, term: 3, total_units: 6 }] },
        { prereqLinks: 1 });
        assert.equal(byTitle(r, 'Units checked').status, 'warn');
        assert.equal(byTitle(r, 'Units checked').detail, '6 read, 12 printed');
        assert.equal(byTitle(r, 'Semesters checked').status, 'warn');
        assert.equal(byTitle(r, 'Semesters checked').detail, '1 of 3 differ');
        assert.equal(byTitle(r, 'PDF read').status, 'ok');
        assert.equal(byTitle(r, 'Rows ready').status, 'ok');
    });
    test('a prerequisite pointing outside the document, or a note to add by hand, turns the prerequisites amber', () => {
        const a = X.overview([sub('A', 1, 1, 3)], {}, { prereqLinks: 2, followUps: ['A: prerequisite "Z" is not a subject in this document'] });
        assert.equal(byTitle(a, 'Prerequisites linked').status, 'warn');
        assert.equal(byTitle(a, 'Prerequisites linked').detail, '1 point outside the document');
        const b = X.overview([sub('A', 1, 1, 3)], {}, { prereqLinks: 2, followUps: ['A: "GEC"'] });
        assert.equal(byTitle(b, 'Prerequisites linked').detail, '1 to add by hand');
    });
    test('repeats, zero units and rows with issues turn "Rows ready" amber and are named', () => {
        const r = X.overview([sub('A', 1, 1, 3), sub('A', 1, 2, 3), sub('Z', 1, 2, 0)], {}, { rowsWithErrors: 2 });
        const s = byTitle(r, 'Rows ready');
        assert.equal(s.status, 'warn');
        assert.equal(s.detail, '1 repeated, 1 with no units, 2 with issues');
    });
    test('a document with no printed totals leaves the two checks grey, not green', () => {
        const r = X.overview([sub('A', 1, 1, 3)], {}, { prereqLinks: 1 });
        assert.equal(byTitle(r, 'Units checked').status, 'info');
        assert.equal(byTitle(r, 'Units checked').detail, 'No grand total printed');
        assert.equal(byTitle(r, 'Semesters checked').status, 'info');
        assert.equal(byTitle(r, 'Semesters checked').detail, 'No semester totals printed');
    });
    test('nothing read: the subjects step is amber and says nothing could be read', () => {
        const r = X.overview([], { grand_total_units: 100 }, {});
        assert.equal(byTitle(r, 'Subjects found').status, 'warn');
        assert.equal(byTitle(r, 'Subjects found').detail, 'Nothing could be read');
    });
    test('the circles and the checks agree: a warning in the list is always a warning in a circle', () => {
        for (const extras of [{}, { rowsWithErrors: 1 }, { followUps: ['x: "GEC"'] }, { prereqLinks: 3 }]) {
            const r = X.overview([sub('A', 1, 1, 3), sub('A', 1, 1, 3)], { grand_total_units: 9 }, extras);
            assert.equal(r.checks.some((c) => c.status === 'warn'), r.steps.some((s) => s.status === 'warn'));
        }
    });
});

describe('html(): the row of circles', () => {
    test('one list item per step, each with its mark, title and description', () => {
        const h = X.html(good());
        assert.equal((h.match(/class="cb-step is-/g) || []).length, 6);
        assert.ok(h.includes('class="cb-steps"'));
        assert.ok(h.includes('<strong>Units checked</strong><span>6 of 6 units match</span>'));
        assert.ok(h.includes('class="cb-step-dot" aria-hidden="true">✓'));
    });
    test('an amber step shows "!" and a grey one "i"', () => {
        const h = X.html(X.overview([sub('A', 1, 1, 3), sub('A', 1, 1, 3)], {}, {}));
        assert.ok(h.includes('class="cb-step is-warn"'));
        assert.ok(h.includes('class="cb-step is-info"'));
    });
    test('a screen reader hears whether each step passed', () => {
        const h = X.html(good());
        assert.ok(h.includes('Passed.'));
        const w = X.html(X.overview([sub('A', 1, 1, 3), sub('A', 1, 1, 3)], {}, {}));
        assert.ok(w.includes('Needs a look.') && w.includes('Not checked.'));
    });
    test('the full list is still there under "All checks": closed when all is well, open when something needs a look', () => {
        // every check a plain pass: closed. (good() has a note, no prerequisites found, so it opens: see the next test.)
        const allOk = X.overview([{ ...sub('A', 1, 1, 3), prerequisites: [] }, { ...sub('B', 1, 2, 3), prerequisites: ['A'] }], { grand_total_units: 6, blocks: [] }, { prereqLinks: 1 });
        assert.ok(allOk.checks.every((c) => c.status === 'ok'));
        const ok = X.html(allOk);
        assert.ok(ok.includes('<details class="cb-scan-all">'));
        assert.ok(ok.includes('All checks ('));
        const warn = X.html(X.overview([sub('A', 1, 1, 3), sub('A', 1, 1, 3)], {}, {}));
        assert.ok(warn.includes('<details class="cb-scan-all" open>'));
    });
    test('step text from a document is escaped', () => {
        const evil = '<img src=x onerror=alert(1)>';
        const r = X.overview([sub(evil, 1, 1, 3), sub(evil, 1, 1, 3)], {}, { followUps: [evil + ' is not a subject in this document'] });
        const h = X.html(r);
        assert.ok(!h.includes('<img'));
    });
    test('a report without steps still draws (an older report kept in memory)', () => {
        const r = good();
        delete r.steps;
        const h = X.html(r);
        assert.ok(h.includes('cb-scan-head') && !h.includes('cb-steps'));
    });
});

describe('the styles for the circles', () => {
    test('the circles, the joining line and a narrow-screen layout exist', () => {
        for (const c of ['.cb-steps {', '.cb-step-dot {', '.cb-step + .cb-step::before', '.cb-step.is-ok + .cb-step::before', '.cb-step.is-warn + .cb-step::before', '@media (max-width: 720px)', '.cb-scan-all']) {
            assert.ok(css.includes(c), c);
        }
    });
});
