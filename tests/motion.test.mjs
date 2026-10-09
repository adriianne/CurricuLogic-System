// motion.test.mjs
// The arithmetic behind the count-up of a number.
//
//   node --test tests/motion.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const M = require('../shared/js/motion.js');

describe('easeOutCubic', () => {
    test('starts at 0 and ends at 1', () => {
        assert.equal(M.easeOutCubic(0), 0);
        assert.equal(M.easeOutCubic(1), 1);
    });

    test('is ahead of a straight line in the middle (starts fast)', () => {
        assert.ok(M.easeOutCubic(0.5) > 0.5);
    });

    test('never leaves 0..1, whatever it is given', () => {
        assert.equal(M.easeOutCubic(-3), 0);
        assert.equal(M.easeOutCubic(9), 1);
    });
});

describe('valueAt', () => {
    test('counts from the start to the end', () => {
        assert.equal(M.valueAt(0, 27, 0, 600), 0);
        assert.equal(M.valueAt(0, 27, 600, 600), 27);
    });

    test('never goes past the target', () => {
        assert.equal(M.valueAt(0, 27, 5000, 600), 27);
    });

    test('also counts down', () => {
        assert.equal(M.valueAt(10, 4, 600, 600), 4);
        assert.ok(M.valueAt(10, 4, 300, 600) < 10);
    });

    test('always a whole number', () => {
        for (let ms = 0; ms <= 600; ms += 37) assert.ok(Number.isInteger(M.valueAt(0, 27, ms, 600)));
    });

    test('with no duration it is the target at once', () => {
        assert.equal(M.valueAt(0, 27, 10, 0), 27);
    });
});

describe('countUp without a page', () => {
    test('does nothing for a missing element', () => {
        assert.doesNotThrow(() => M.countUp(null, 5));
    });

    test('sets text directly when there is no animation frame (here, Node)', () => {
        const el = { textContent: '' };
        M.countUp(el, 12);
        assert.equal(el.textContent, '12');
    });

    test('shows a non-number as it is', () => {
        const el = { textContent: '' };
        M.countUp(el, 'n/a');
        assert.equal(el.textContent, 'n/a');
    });
});
