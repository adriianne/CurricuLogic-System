// scantidy.test.mjs
// Two tidy-ups of the scan check (21 Nov 2026): the headline counts what it says, and the status line is short.
//   node --test tests/scantidy.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const X = require('../shared/js/curriculum/extractioncheck.js');
const sub = (code, y, t, lec) => ({ code, title: code, year_level: y, term: t, lecture_units: lec, laboratory_units: 0 });
const printed = { grand_total_units: 3, blocks: [{ year_level: 1, term: 1, total_units: 3 }] };

describe('the headline counts the notes as well as the passes', () => {
    test('with year-standing gates (a grey note) it says "plus 1 note to read"', () => {
        const r = X.overview([sub('A', 1, 1, 3)], printed, { prereqLinks: 1, gates: 4 });
        assert.equal(r.sub, 'All 7 checks passed, plus 1 note to read. No mistakes found by the scan check.');
        assert.equal(r.checks.length, 8);          // the list holds the 7 passes and the 1 note
    });
    test('several notes are counted: gates, goes-with links and rules', () => {
        const r = X.overview([sub('A', 1, 1, 3)], printed, { prereqLinks: 1, gates: 2, coreqs: 1, interpreted: ['B: "x" \u2192 rule'] });
        assert.match(r.sub, /plus 3 notes to read\./);
    });
    test('with no notes it says nothing extra', () => {
        const r = X.overview([sub('A', 1, 1, 3)], printed, { prereqLinks: 1 });
        assert.equal(r.sub, 'All 7 checks passed. No mistakes found by the scan check.');
    });
    test('the count in the headline plus the notes is the number of lines in "All checks"', () => {
        for (const extras of [{ prereqLinks: 1 }, { prereqLinks: 1, gates: 4 }, { prereqLinks: 1, gates: 1, coreqs: 1 }]) {
            const r = X.overview([sub('A', 1, 1, 3)], printed, extras);
            const notes = r.checks.filter((c) => c.status === 'info').length;
            assert.equal(r.passed + notes, r.checks.length);
        }
    });
    test('a scan that needs a look keeps its own wording', () => {
        const r = X.overview([sub('A', 1, 1, 3), sub('A', 1, 1, 3)], {}, {});
        assert.match(r.sub, /checks? passed\. The ones that need a look are marked\./);
    });
});
