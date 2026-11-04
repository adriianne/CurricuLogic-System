// namerules.test.mjs
// The one name rule: letters, spaces and ' . - , only; at least one letter; 60 at most.
//
//   node --test tests/namerules.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const N = require('../shared/js/accounts/namerules.js');

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

describe('middleProblem (the optional middle name)', () => {
    test('blank is fine: a middle name is optional', () => {
        for (const n of ['', '   ', null, undefined]) assert.equal(N.middleProblem(n), null, String(n));
    });

    test('ordinary middle names pass', () => {
        for (const n of ['Cursoara', 'Santos', 'De la Cruz', "O'Brien", 'Mae-Ann', 'Muñoz', 'José', 'Ng', 'Q. Jr']) {
            assert.equal(N.middleProblem(n), null, n);
        }
    });

    test('digits and symbols are refused ("Cas@12", "123124")', () => {
        for (const n of ['Cas@12', '123124', 'Ann2', 'Ann_B', '<b>x</b>', '=SUM(A1)', 'Ann 😀']) {
            assert.match(N.middleProblem(n), /can only contain/, n);
        }
    });

    test('a single letter is refused ("Q"), with or without a full stop', () => {
        for (const n of ['Q', 'q', 'Q.', ' Q ']) assert.match(N.middleProblem(n), /at least 2 letters/, n);
    });

    test('must start with a letter, and no two punctuation marks in a row', () => {
        assert.match(N.middleProblem("'Ann"), /start with a letter/);
        assert.match(N.middleProblem('-Ann'), /start with a letter/);
        assert.match(N.middleProblem('Ann..B'), /two punctuation marks/);
        assert.match(N.middleProblem('Ann--Bea'), /two punctuation marks/);
    });

    test('too long is refused', () => {
        assert.match(N.middleProblem('a'.repeat(61)), /at most 60/);
        assert.equal(N.middleProblem('a'.repeat(60)), null);
    });
});
