// namerules.test.mjs
// The one name rule: letters, spaces and ' . - , only; at least one letter; 60 at most.
//
//   node --test tests/namerules.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const N = require('../shared/js/namerules.js');

describe('problem', () => {
    test('ordinary names pass, in any alphabet', () => {
        for (const n of ['Althea', 'Dela Cruz', "O'Brien", 'O’Brien', 'Smith-Jones', 'Jr.', 'Muñoz',
                         'José', 'Nguyễn', 'Αθηνά', 'Иванов', '田中', 'Reyes, Jr.']) {
            assert.equal(N.problem(n, 'first name'), null, n);
        }
    });

    test('empty and blank names are refused', () => {
        for (const n of ['', '   ', null, undefined]) assert.match(N.problem(n, 'first name'), /Enter a first name/);
    });

    test('a name of only symbols or punctuation is refused', () => {
        for (const n of ['-', '...', "'", ',,', '- . -']) assert.match(N.problem(n, 'last name'), /at least one letter/, n);
    });

    test('markup, formulas, digits and emoji are refused', () => {
        for (const n of ['<b>x</b>', '"><img src=x onerror=alert(1)>', '=HYPERLINK("http://x")', '+1', '@x',
                         'Al3x', 'Bob;DROP', 'a\\b', '😀 Ann', 'Ann 😀']) {
            assert.match(N.problem(n, 'first name'), /can only contain|at least one letter/, n);
        }
    });

    test('control and zero-width characters are dropped, not refused', () => {
        assert.equal(N.problem('Al​thea', 'first name'), null);
        assert.equal(N.clean('Al​thea\u0000'), 'Althea');
    });

    test('60 characters is the limit', () => {
        assert.equal(N.problem('a'.repeat(60), 'first name'), null);
        assert.match(N.problem('a'.repeat(61), 'first name'), /at most 60/);
    });
});

describe('clean', () => {
    test('trims and collapses spaces', () => {
        assert.equal(N.clean('  Maria   Clara \n'), 'Maria Clara');
    });
    test('joins a decomposed accent to one character', () => {
        assert.equal(N.clean('José'), 'José');
    });
    test('null becomes an empty string', () => {
        assert.equal(N.clean(null), '');
    });
});
