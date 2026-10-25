// requestreview.test.mjs
// The Registrar's account-request card: decline reasons and the approve checklist.
//
//   node --test tests/requestreview.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const R = require('../shared/js/accounts/requestreview.js');

describe('reasonProblem', () => {
    test('a reason is required', () => {
        for (const v of ['', '   ', '\n', null, undefined]) assert.match(R.reasonProblem(v), /required/, JSON.stringify(v));
    });
    test('an ordinary reason is fine, spaces around it are ignored', () => {
        assert.equal(R.reasonProblem('Student ID not found.'), null);
        assert.equal(R.reasonProblem('   ok   '), null);
    });
    test('500 characters is the limit', () => {
        assert.equal(R.reasonProblem('x'.repeat(500)), null);
        assert.match(R.reasonProblem('x'.repeat(501)), /501 characters.*under 500/);
    });
    test('the limit counts the trimmed text', () => {
        assert.equal(R.reasonProblem('  ' + 'x'.repeat(500) + '  '), null);
    });
});

describe('QUICK_REASONS', () => {
    test('each has a label and a text the database accepts', () => {
        assert.ok(R.QUICK_REASONS.length >= 3);
        for (const q of R.QUICK_REASONS) {
            assert.ok(q.label.length > 0);
            assert.equal(R.reasonProblem(q.text), null, q.label);
        }
    });
    test('labels are distinct', () => {
        const labels = R.QUICK_REASONS.map(q => q.label);
        assert.equal(new Set(labels).size, labels.length);
    });
});

describe('checklist', () => {
    test('three checks, always', () => {
        assert.equal(R.checklist('new').length, 3);
        assert.equal(R.checklist('existing').length, 3);
        assert.equal(R.checklist(undefined).length, 3);
    });
    test('the first check follows how the person registered', () => {
        assert.match(R.checklist('new')[0], /incoming student list/);
        assert.match(R.checklist('existing')[0], /Student ID/);
    });
});
