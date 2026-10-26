// requestref.test.mjs
// The request reference number (CL-2026-000021): how it is made and how a typed one is read back.
//
//   node --test tests/requestref.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const R = require('../shared/js/enrolment/requestref.js');

test('the id is padded to six digits and the year comes from created_at', () => {
    assert.equal(R.format(21, '2026-10-25T08:00:00Z'), 'CL-2026-000021');
    assert.equal(R.format(1, '2026-01-02'), 'CL-2026-000001');
    assert.equal(R.format(123456, '2027-03-04T00:00:00'), 'CL-2027-123456');
});

test('an id longer than six digits is kept whole, not cut', () => {
    assert.equal(R.format(1234567, '2026-05-05'), 'CL-2026-1234567');
});

test('the id may arrive as a string', () => {
    assert.equal(R.format('21', '2026-10-25'), 'CL-2026-000021');
});

test('the year is the one written, whatever the viewer time zone', () => {
    assert.equal(R.format(7, '2026-12-31T23:59:59'), 'CL-2026-000007');
    assert.equal(R.format(7, '2026-01-01T00:00:00'), 'CL-2026-000007');
});

test('a Date object works too', () => {
    assert.equal(R.format(5, new Date(2026, 5, 15, 12)), 'CL-2026-000005');
});

test('a bad id or date gives nothing, never a half reference', () => {
    for (const id of [0, -3, 1.5, 'abc', '', null, undefined, NaN, Infinity]) {
        assert.equal(R.format(id, '2026-10-25'), '', `id ${String(id)}`);
    }
    for (const d of [null, undefined, '', 'not a date']) {
        assert.equal(R.format(21, d), '', `date ${String(d)}`);
    }
});

test('format and parse agree', () => {
    for (const id of [1, 21, 999999, 1234567]) {
        assert.equal(R.parse(R.format(id, '2026-10-25')), id);
    }
});

test('parse reads the ways a person types it', () => {
    for (const t of ['CL-2026-000021', 'cl-2026-000021', ' CL-2026-000021 ', 'cl 2026 21', 'CL2026-21', '2026-21', '2026 000021', '21', '000021']) {
        assert.equal(R.parse(t), 21, JSON.stringify(t));
    }
});

test('parse refuses what is not a reference', () => {
    for (const t of ['', '   ', 'abc', 'CL-', 'CL-2026-', '0', '000000', '-5', '1.5', '21 22 23', 'CL-2026-21-9', null, undefined, 'drop table']) {
        assert.equal(R.parse(t), null, JSON.stringify(t));
    }
});

test('fromSearch leaves a bare number to the student-ID search', () => {
    for (const t of ['21', '000021', '9900011', '2026', '']) assert.equal(R.fromSearch(t), null, JSON.stringify(t));
});

test('fromSearch reads only text that starts with CL or the year', () => {
    for (const t of ['CL-2026-000021', 'cl 2026 21', 'CL21', 'cl-21', '2026-21', '2026 000021']) {
        assert.equal(R.fromSearch(t), 21, JSON.stringify(t));
    }
    for (const t of ['clara', 'Cruz', 'cl-', 'cl-2026-21-9', null, undefined]) assert.equal(R.fromSearch(t), null, JSON.stringify(t));
});
