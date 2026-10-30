// offeringcount.test.mjs
// The Department dashboard counts the offerings of THIS term and THIS programme (shared/js/schedule/offeringcount.js).
//
//   node --test tests/offeringcount.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { forTerm } = require('../shared/js/schedule/offeringcount.js');

const row = (section, academic_year, term) => ({ section, academic_year, term });

describe('offerings published for this term', () => {
    const rows = [
        ...Array.from({ length: 89 }, () => row('BSIT-1A', 2023, 1)),
        ...Array.from({ length: 11 }, () => row('BSIT-1A', 2024, 2)),
    ];

    test('only the current term is counted (the 100 on the old dashboard was 89 + 11)', () => {
        assert.equal(forTerm(rows, { year: 2023, term: 1 }, 'BSIT-'), 89);
        assert.equal(forTerm(rows, { year: 2024, term: 2 }, 'BSIT-'), 11);
        assert.equal(forTerm(rows, { year: 2023, term: 2 }, 'BSIT-'), 0);
    });

    test('another programme\'s sections are not counted, whatever the letter case', () => {
        const mixed = [row('BSIT-1A', 2023, 1), row('bsit-2b', 2023, 1), row('BSCRIM-1A', 2023, 1), row('BSN-1A', 2023, 1)];
        assert.equal(forTerm(mixed, { year: 2023, term: 1 }, 'BSIT-'), 2);
        assert.equal(forTerm(mixed, { year: 2023, term: 1 }, 'bscrim-'), 1);
    });

    test('an empty prefix counts every programme', () => {
        const mixed = [row('BSIT-1A', 2023, 1), row('BSN-1A', 2023, 1)];
        assert.equal(forTerm(mixed, { year: 2023, term: 1 }, ''), 2);
        assert.equal(forTerm(mixed, { year: 2023, term: 1 }), 2);
    });

    test('when the current term is not known, every offering of the programme counts, so a real schedule is not hidden', () => {
        assert.equal(forTerm(rows, null, 'BSIT-'), 100);
        assert.equal(forTerm(rows, { year: null, term: 1 }, 'BSIT-'), 100);
        assert.equal(forTerm(rows, { year: 2023, term: undefined }, 'BSIT-'), 100);
        assert.equal(forTerm(rows, {}, 'BSIT-'), 100);
    });

    test('numbers that arrive as text are still matched', () => {
        assert.equal(forTerm([row('BSIT-1A', '2023', '1')], { year: 2023, term: 1 }, 'BSIT-'), 1);
    });

    test('no rows, or odd rows, give zero and never throw', () => {
        assert.equal(forTerm([], { year: 2023, term: 1 }, 'BSIT-'), 0);
        assert.equal(forTerm(null, { year: 2023, term: 1 }, 'BSIT-'), 0);
        assert.equal(forTerm([null, {}, { section: null }], { year: 2023, term: 1 }, 'BSIT-'), 0);
    });
});
