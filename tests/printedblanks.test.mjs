// printedblanks.test.mjs
// A prospectus that prints an elective slot with the rest of its code left as a blank line to write on ("CS-EL____") is read as a
// numbered placeholder, not as a repeated code (21 Nov 2026: the BSCS 2023-2024 scan showed "This code is already used" on six rows).
//
//   node --test tests/printedblanks.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SC = require('../shared/js/curriculum/subjectcode.js');
const EL = require('../shared/js/curriculum/electives.js');
const builder = readFileSync(new URL('../features/department/curriculum-builder.js', import.meta.url), 'utf8');

describe('fromPrinted', () => {
    test('blank fill-in lines are dropped, however the reader spaced them', () => {
        for (const [printed, code] of [['CS-EL_ _ _ _', 'CS-EL'], ['CS-EL____', 'CS-EL'], ['CS-FRE _ _ _', 'CS-FRE'], ['CS-FRE____', 'CS-FRE'], ['cs-el___', 'CS-EL'], ['CS-EL-___', 'CS-EL']]) {
            assert.equal(SC.fromPrinted(printed), code, printed);
        }
    });
    test('an underscore inside a code is part of it and stays', () => {
        for (const c of ['AI-EL_FUNDAI', 'AI-FRE_KNWREP', 'AI-EL_ MLEARN', 'AI-EL_ROBOT']) assert.equal(SC.fromPrinted(c), SC.clean(c), c);
    });
    test('ordinary codes, spaced codes and numbered placeholders are unchanged', () => {
        for (const c of ['ELDNET1', 'HUM - REP 101', 'ENGL 101', 'CC-INTCOM11', 'IT-EL', 'IT-EL3']) assert.equal(SC.fromPrinted(c), SC.clean(c), c);
    });
    test('a code is never stripped down to nothing', () => {
        assert.equal(SC.fromPrinted('____'), SC.clean('____'));
        assert.equal(SC.fromPrinted('123___'), SC.clean('123___'));
        assert.equal(SC.fromPrinted(''), '');
        assert.equal(SC.fromPrinted(null), '');
    });
    test('the dash cleaning of clean() still applies', () => {
        assert.equal(SC.fromPrinted('CS–EL____'), 'CS-EL');
    });
});

describe('what the builder then does with them', () => {
    const printed = ['CS-EL_ _ _ _', 'CS-FRE_ _ _ _', 'CS-FRE_ _ _ _', 'CS-EL_ _ _ _', 'CS-FRE_ _ _ _', 'CS-EL_ _ _ _', 'CS-EL_ _ _ _', 'CS-FRE_ _ _ _'];
    test('every one is an un-numbered placeholder of the right kind, so the duplicate check leaves it alone', () => {
        for (const p of printed) {
            const ph = EL.placeholderOf(SC.fromPrinted(p));
            assert.ok(ph && ph.num === null, p);
            assert.equal(ph.type, /FRE/.test(p) ? 'FREE' : 'IT', p);
        }
    });
    test('before the fix the same codes were not placeholders at all, and all collided on one key', () => {
        assert.equal(EL.placeholderOf(SC.clean('CS-EL_ _ _ _')), null);
        assert.equal(SC.key('CS-EL_ _ _ _'), SC.key('CS-EL_ _ _ _'));
        assert.equal(SC.key('CS-EL_ _ _ _'), 'CSEL');
    });
    test('they are numbered one by one, per kind, the way normalizeElectiveCodes does it', () => {
        const counters = {};
        const out = printed.map((p) => {
            const ph = EL.placeholderOf(SC.fromPrinted(p));
            counters[ph.base] = (counters[ph.base] || 0) + 1;
            return `${ph.base}${counters[ph.base]}`;
        });
        assert.deepEqual(out, ['CS-EL1', 'CS-FRE1', 'CS-FRE2', 'CS-EL2', 'CS-FRE3', 'CS-EL3', 'CS-EL4', 'CS-FRE4']);
        assert.equal(new Set(out.map((c) => SC.key(c))).size, out.length);
    });
});

describe('the builder reads scanned codes through it', () => {
    test('the row\'s code, and the code used to guess a catalogue entry\'s kind, both go through fromPrinted', () => {
        assert.ok(builder.includes('row.code  = SC.fromPrinted(item.code);'));
        assert.ok(builder.includes('const code = SC.fromPrinted(item.code);'));
        assert.ok(!builder.includes('row.code  = SC.clean(item.code);'));
    });
    test('typed codes are not changed: only scanned ones go through it', () => {
        assert.equal((builder.match(/SC\.fromPrinted\(/g) || []).length, 2);
    });
});
