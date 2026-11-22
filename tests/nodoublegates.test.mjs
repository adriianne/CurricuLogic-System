// nodoublegates.test.mjs
// A year gate is never added twice to one row (22 Nov 2026). The ACT PDF's Internship and Capstone rows print "must all finish 1st year to 2nd
// year subjects" in the prerequisite cell: the builder turned that wording into the gate, and then added the same gate again from the
// footnote mark, so each row showed two identical "**" gates.
//
//   node --test tests/nodoublegates.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const FN = require('../shared/js/curriculum/footnotes.js');
const builder = readFileSync(new URL('../features/department/curriculum-builder.js', import.meta.url), 'utf8');

describe('the footnote gate', () => {
    const block = builder.slice(builder.indexOf('if (row._aiMarker) {'), builder.indexOf('delete row._aiPrereqCodes;'));
    test('is skipped when the row already has that same gate, whichever way it got there', () => {
        assert.ok(block.includes('const already = row.prereqs.some(p => p.standing && (p.pos ?? p.standing * 10 + 2) === pos);'));
        assert.ok(block.includes('if (pos && !already) { row.prereqs.push({ standing: Math.floor(pos / 10), pos }); gatesAdded++; }'));
    });
    test('only a gate that was really added is counted, so the scan card does not count the skipped one', () => {
        assert.ok(block.indexOf('gatesAdded++') > block.indexOf('!already'));
    });
    test('the check is made after the wording was handled, so the wording wins and the footnote adds nothing', () => {
        const all = builder.slice(builder.indexOf('for (const row of ROWS) {', builder.indexOf('const looseIndex')), builder.indexOf('delete row._aiPrereqCodes;'));
        assert.ok(all.indexOf("rule?.kind === 'standing'") < all.indexOf('const already ='));
    });
});

describe('the same rule on plain data', () => {
    const footnotes = [{ marker: '**', text: 'must finish all 1st year to 2nd year courses', through_year: 2 }];
    const addFootnoteGate = (row, marker) => {
        const y = FN.throughYear(marker, footnotes);
        const pos = y ? FN.standingPositionFor(y, row.year, row.term) : null;
        const already = row.prereqs.some(p => p.standing && (p.pos ?? p.standing * 10 + 2) === pos);
        if (pos && !already) { row.prereqs.push({ standing: Math.floor(pos / 10), pos }); return 1; }
        return 0;
    };
    test('Internship (2nd year, 2nd semester) that already has the gate from its wording gets no second one', () => {
        // held to 21, not 22: a subject cannot wait for its own semester
        assert.equal(FN.standingPositionFor(2, 2, 2), 21);
        const row = { year: 2, term: 2, prereqs: [{ standing: 2, pos: 21 }] };
        assert.equal(addFootnoteGate(row, '**'), 0);
        assert.equal(row.prereqs.length, 1);
    });
    test('the same row without the wording still gets its gate from the footnote', () => {
        const row = { year: 2, term: 2, prereqs: [] };
        assert.equal(addFootnoteGate(row, '**'), 1);
        assert.deepEqual(row.prereqs, [{ standing: 2, pos: 21 }]);
    });
    test('a different gate is not mistaken for the same one', () => {
        const row = { year: 4, term: 1, prereqs: [{ standing: 2, pos: 22 }] };
        const f3 = [{ marker: '***', text: 'must finish all 1st year to 3rd year courses', through_year: 3 }];
        const y = FN.throughYear('***', f3);
        const pos = FN.standingPositionFor(y, row.year, row.term);
        assert.equal(row.prereqs.some(p => p.standing && (p.pos ?? p.standing * 10 + 2) === pos), false);
    });
    test('a gate saved in the older form (no pos) is compared by its year', () => {
        const row = { year: 3, term: 1, prereqs: [{ standing: 2 }] };      // older form: no pos, read as 22, which is what a 3rd-year subject asks for
        assert.equal(addFootnoteGate(row, '**'), 0);
    });
    test('a catalogue elective (no year) with a gate already is not given another', () => {
        const row = { year: null, term: null, prereqs: [{ standing: 2, pos: 22 }] };
        assert.equal(addFootnoteGate(row, '**'), 0);
    });
});
