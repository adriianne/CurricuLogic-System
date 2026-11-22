// earlierprereq.test.mjs
// A prerequisite must be in an EARLIER semester (22 Nov 2026). The scan of the ACT PDF gave Web Design 1 the prerequisite Introduction to Computing,
// which sits in the same semester: nothing flagged it, and the picker could not remove it (it only lists subjects that come earlier, and
// nothing comes before a 1st-year 1st-semester subject). Such a subject could never be opened.
//
//   node --test tests/earlierprereq.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const builder = readFileSync(new URL('../features/department/curriculum-builder.js', import.meta.url), 'utf8');
const between = (a, b) => builder.slice(builder.indexOf(a), builder.indexOf(b, builder.indexOf(a)));

describe('the check', () => {
    const val = between('function validate() {', 'const filled  = ()');
    test('every prerequisite link is looked up and must be one of the subjects the row may depend on', () => {
        assert.ok(val.includes('for (const p of r.prereqs ?? []) {'));
        assert.ok(val.includes('candidatesFor(r).includes(target)'));
    });
    test('"goes with" links, standing gates and deleted targets are left out of it', () => {
        assert.ok(val.includes('if (!p.uid || p.co) continue;'));
        assert.ok(val.includes('if (!target || candidatesFor(r).includes(target)) continue;'));
    });
    test('a bad link is an error on the row, in plain words, saying how to fix it', () => {
        assert.ok(val.includes('is not in an earlier semester, so it cannot be a prerequisite. Untick it in the prerequisite list.'));
        assert.ok(val.includes('r.errors.push('));
    });
    test('it runs after the rows have been reset, so an old error never lingers', () => {
        assert.ok(val.indexOf('r.errors = [];') < val.indexOf('candidatesFor(r).includes(target)'));
    });
});

describe('the picker lists what the row already has, even when it is not allowed there', () => {
    const pick = between('function openPicker(row, anchor) {', 'const el = document.createElement');
    test('a ticked prerequisite that is not a candidate is collected, and shown under its own heading', () => {
        assert.ok(pick.includes('const stray = row.prereqs.filter(p => p.uid && !p.co && !opts.some(o => o.uid === p.uid))'));
        assert.ok(pick.includes("groups.set('Not allowed here: untick to remove', stray);"));
    });
    test('it is shown ticked, so unticking removes it through the same handler as any other', () => {
        assert.ok(pick.includes("${chosen.has(o.uid) ? 'checked' : ''}"));
    });
    test('the "No earlier subjects yet" message does not hide it', () => {
        assert.ok(builder.includes("${opts.length || stray.length ? list : '<p class=\"cb-pick-none\">No earlier subjects yet.</p>'}"));
    });
});

describe('the rule on plain data (the same position rules as candidatesFor)', () => {
    const rank = (r) => (r.year === null ? 999 : r.year * 10 + (r.term ?? 0));
    const candidates = (rows, row) => rows.filter((r, j) => {
        if (r === row || !r.code) return false;
        const there = rank(r), here = rank(row);
        if (there !== here) return there < here;
        return row.year === null && j < rows.indexOf(row);
    });
    const errorsFor = (rows, row) => (row.prereqs ?? []).filter((p) => p.uid && !p.co)
        .map((p) => rows.find((x) => x.uid === p.uid)).filter((t) => t && !candidates(rows, row).includes(t));
    const web = { uid: 1, code: 'AD-WEBDEV11', year: 1, term: 1, prereqs: [{ uid: 2 }] };
    const intcom = { uid: 2, code: 'CC-INTCOM11', year: 1, term: 1, prereqs: [] };
    const hci = { uid: 3, code: 'CC-HCI12', year: 1, term: 2, prereqs: [{ uid: 2 }] };
    const rows = [web, intcom, hci];
    test('the ACT case: Web Design 1 needing a subject of its own semester is an error', () => assert.deepEqual(errorsFor(rows, web).map((t) => t.code), ['CC-INTCOM11']));
    test('the same link from the NEXT semester is fine', () => assert.deepEqual(errorsFor(rows, hci), []));
    test('a link to a later semester is an error', () => {
        const early = { uid: 4, code: 'X1', year: 1, term: 1, prereqs: [{ uid: 3 }] };
        assert.equal(errorsFor([...rows, early], early).length, 1);
    });
    test('a "goes with" link in the same term is allowed', () => {
        const co = { uid: 5, code: 'LAB1', year: 1, term: 1, prereqs: [{ uid: 2, co: true }] };
        assert.deepEqual(errorsFor([...rows, co], co), []);
    });
    test('a catalogue elective may depend on one entered before it, and on anything scheduled', () => {
        const e1 = { uid: 6, code: 'EL1', year: null, term: null, prereqs: [] };
        const e2 = { uid: 7, code: 'EL2', year: null, term: null, prereqs: [{ uid: 6 }, { uid: 2 }] };
        assert.deepEqual(errorsFor([...rows, e1, e2], e2), []);
        const early = { uid: 8, code: 'EL0', year: null, term: null, prereqs: [{ uid: 9 }] };
        const late = { uid: 9, code: 'EL9', year: null, term: null, prereqs: [] };
        assert.equal(errorsFor([early, late], early).length, 1);
    });
});

describe('closing the picker re-checks the rows (the check can now change when only a prerequisite changed)', () => {
    test('Done validates before it redraws, so a fixed row stops being flagged at once', () => {
        assert.match(builder, /if \(e\.target\.closest\('\.cb-pick-done'\)\) \{ closePicker\(\); validate\(\); render\(\); \}/);
    });
});
