// cataloguegates.test.mjs
// A catalogue elective (no year, no semester) whose footnote says "finish years 1 to N" gets a year gate through year N
// (22 for **, 32 for ***), the way db/121 stored them for BSIT. Before (21 Nov 2026) the scan gave them nothing: 14 electives of
// the BSCS 2024-2025 PDF print ** or ***, and none had a gate.
//
//   node --test tests/cataloguegates.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const FN = require('../shared/js/curriculum/footnotes.js');
const builder = readFileSync(new URL('../features/department/curriculum-builder.js', import.meta.url), 'utf8');
const footnotes = [{ marker: '**', text: 'must finish all 1st year to 2nd year courses', through_year: 2 },
                   { marker: '***', text: 'must finish all 1st year to 3rd year courses', through_year: 3 }];

describe('standingPositionFor a catalogue elective', () => {
    test('no year and no semester: through the 2nd semester of year N', () => {
        assert.equal(FN.standingPositionFor(2, null, null), 22);
        assert.equal(FN.standingPositionFor(3, null, null), 32);
        assert.equal(FN.standingPositionFor(2, undefined, undefined), 22);
        assert.equal(FN.standingPositionFor(2, '', null), 22);
    });
    test('the footnotes of the BSCS PDF read as 22 and 32', () => {
        assert.equal(FN.standingPositionFor(FN.throughYear('**', footnotes), null, null), 22);
        assert.equal(FN.standingPositionFor(FN.throughYear('***', footnotes), null, null), 32);
    });
    test('a year that is not a year still gives nothing', () => {
        for (const y of [0, -1, null, undefined, 'x', 1.5]) assert.equal(FN.standingPositionFor(y, null, null), null, String(y));
    });
});

describe('scheduled subjects are unchanged: a subject never waits for its own semester', () => {
    test('a 2nd-year 1st-semester subject asked for years 1 to 2 is held to the semester before it', () => {
        assert.equal(FN.standingPositionFor(2, 2, 1), 12);
    });
    test('a 3rd-year 1st-semester subject asked for years 1 to 3 is held to 2nd year, 2nd semester', () => {
        assert.equal(FN.standingPositionFor(3, 3, 1), 22);
    });
    test('a 4th-year 1st-semester subject asked for years 1 to 3 gets the full 32', () => {
        assert.equal(FN.standingPositionFor(3, 4, 1), 32);
    });
    test('a 1st-year 1st-semester subject asked for years 1 to 1 has nothing before it: no gate', () => {
        assert.equal(FN.standingPositionFor(1, 1, 1), null);
    });
});

describe('the builder applies a footnote to catalogue electives too', () => {
    const block = builder.slice(builder.indexOf('if (row._aiMarker) {'), builder.indexOf('delete row._aiPrereqCodes;'));
    test('the year guard is gone, and the position is taken from the row\'s own (possibly empty) year and semester', () => {
        assert.ok(block.length > 100);
        assert.ok(!builder.includes('if (row._aiMarker && row.year !== null) {'));
        assert.ok(block.includes('FN.standingPositionFor(y, row.year, row.term)'));
        assert.ok(block.includes('row.prereqs.push({ standing: Math.floor(pos / 10), pos }); gatesAdded++;'));
    });
    test('a mark that is not a year footnote is still listed for a person, never dropped', () => {
        assert.ok(block.includes('followUps.push(`${row.code}: "${row._aiMarker}"`);'));
    });
    test('the stored form of the rule for a catalogue elective matches the BSIT ones: standing 22 / 32', () => {
        const pos = FN.standingPositionFor(2, null, null);
        assert.deepEqual({ standing: Math.floor(pos / 10), pos }, { standing: 2, pos: 22 });
        const pos3 = FN.standingPositionFor(3, null, null);
        assert.deepEqual({ standing: Math.floor(pos3 / 10), pos: pos3 }, { standing: 3, pos: 32 });
    });
});
