// uploadprogress.test.mjs
// A progress percentage that measures real work.
//
//   node --test tests/uploadprogress.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const UP = require('../shared/js/uploadprogress.js');

const phases = () => UP.tracker([
    { id: 'read', weight: 10, label: 'Reading' },
    { id: 'rows', weight: 60, label: 'Checking rows' },
    { id: 'save', weight: 30, label: 'Saving' },
]);

describe('tracker', () => {
    test('starts at the phase\'s own place in the whole', () => {
        const t = phases();
        assert.equal(t.update('read', 0).percent, 0);
        assert.equal(t.update('rows', 0).percent, 10);
        assert.equal(t.update('save', 0).percent, 70);
    });

    test('moves with the work done inside a phase', () => {
        const t = phases();
        assert.equal(t.update('rows', 0.5).percent, 40);   // 10 + 60 * 0.5
        assert.equal(t.update('rows', 1).percent, 70);
    });

    test('never goes backwards', () => {
        const t = phases();
        t.update('rows', 0.9);
        assert.equal(t.update('rows', 0.1).percent, 64);
        assert.equal(t.update('read', 0).percent, 64);
    });

    test('is held below 100 until the work is finished', () => {
        const t = phases();
        assert.equal(t.update('save', 1).percent, 99);
        assert.equal(t.finish().percent, 100);
        assert.equal(t.percent, 100);
    });

    test('reports the label and the detail it was given', () => {
        const u = phases().update('rows', 0.25, '15 of 60');
        assert.equal(u.label, 'Checking rows');
        assert.equal(u.detail, '15 of 60');
    });

    test('a fraction outside 0-1, or not a number, is held to the phase', () => {
        const t = phases();
        assert.equal(t.update('rows', 7).percent, 70);
        const t2 = phases();
        assert.equal(t2.update('rows', -3).percent, 10);
        assert.equal(phases().update('rows', NaN).percent, 10);
    });

    test('an unknown phase is a mistake, not a silent zero', () => {
        assert.throws(() => phases().update('nope', 0.5), /Unknown progress phase/);
    });

    test('no phases never divides by zero', () => {
        assert.equal(UP.tracker([]).finish().percent, 100);
    });
});

describe('fraction', () => {
    test('done over total', () => {
        assert.equal(UP.fraction(25, 100), 0.25);
        assert.equal(UP.fraction(100, 100), 1);
    });
    test('an empty job is complete, and overshoot is held at 1', () => {
        assert.equal(UP.fraction(0, 0), 1);
        assert.equal(UP.fraction(150, 100), 1);
    });
});
