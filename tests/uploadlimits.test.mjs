// uploadlimits.test.mjs
// What a file may be before the app reads it.
//
//   node --test tests/uploadlimits.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const U = require('../shared/js/uploadlimits.js');

const MB = 1024 * 1024;
const file = (name, size, type = '') => ({ name, size, type });

describe('fileProblem: pdf', () => {
    test('a normal PDF is fine', () => {
        assert.equal(U.fileProblem(file('BSIT.pdf', 364 * 1024, 'application/pdf'), 'pdf'), null);
    });
    test('the type or the ending is enough', () => {
        assert.equal(U.fileProblem(file('a.PDF', 1000, ''), 'pdf'), null);
        assert.equal(U.fileProblem(file('scan', 1000, 'application/pdf'), 'pdf'), null);
    });
    test('another kind of file is refused', () => {
        assert.match(U.fileProblem(file('a.docx', 1000, 'application/msword'), 'pdf'), /Only PDF/);
    });
    test('over 10 MB is refused with both sizes', () => {
        const msg = U.fileProblem(file('big.pdf', 12.3 * MB, 'application/pdf'), 'pdf');
        assert.match(msg, /12\.3 MB/);
        assert.match(msg, /10\.0 MB/);
    });
    test('exactly 10 MB is accepted, one byte more is not', () => {
        assert.equal(U.fileProblem(file('a.pdf', 10 * MB, 'application/pdf'), 'pdf'), null);
        assert.ok(U.fileProblem(file('a.pdf', 10 * MB + 1, 'application/pdf'), 'pdf'));
    });
    test('an empty file is refused', () => {
        assert.match(U.fileProblem(file('a.pdf', 0, 'application/pdf'), 'pdf'), /empty/);
    });
});

describe('fileProblem: photo', () => {
    test('an image is fine, a non-image is not', () => {
        assert.equal(U.fileProblem(file('p.jpg', 3 * MB, 'image/jpeg'), 'photo'), null);
        assert.match(U.fileProblem(file('p.pdf', 3 * MB, 'application/pdf'), 'photo'), /not an image/);
    });
    test('a phone photo of 12 MB is fine; 26 MB is not', () => {
        assert.equal(U.fileProblem(file('p.jpg', 12 * MB, 'image/jpeg'), 'photo'), null);
        assert.match(U.fileProblem(file('p.jpg', 26 * MB, 'image/jpeg'), 'photo'), /limit is 25\.0 MB/);
    });
});

describe('fileProblem: spreadsheets', () => {
    for (const kind of ['grades', 'schedule', 'accounts']) {
        test(`${kind}: csv, xlsx and xls are accepted, in any case`, () => {
            for (const n of ['a.csv', 'a.XLSX', 'a.xls']) assert.equal(U.fileProblem(file(n, 1000), kind), null, n);
        });
        test(`${kind}: other endings are refused`, () => {
            assert.ok(U.fileProblem(file('a.pdf', 1000), kind));
            assert.ok(U.fileProblem(file('a.exe', 1000), kind));
            assert.ok(U.fileProblem(file('noending', 1000), kind));
        });
    }
    test('grades and schedule: 5 MB; accounts: 2 MB', () => {
        assert.equal(U.fileProblem(file('a.xlsx', 5 * MB), 'grades'), null);
        assert.ok(U.fileProblem(file('a.xlsx', 5 * MB + 1), 'grades'));
        assert.equal(U.fileProblem(file('a.xlsx', 2 * MB), 'accounts'), null);
        assert.match(U.fileProblem(file('a.xlsx', 3 * MB), 'accounts'), /accounts file is 3\.0 MB.*2\.0 MB/);
    });
});

describe('fileProblem: misuse', () => {
    test('no file', () => assert.match(U.fileProblem(null, 'pdf'), /Choose a file/));
    test('unknown kind throws, it is a programming error', () => {
        assert.throws(() => U.fileProblem(file('a.pdf', 1), 'video'), /Unknown upload kind/);
    });
});

describe('dataRows', () => {
    test('counts only rows that hold something', () => {
        assert.equal(U.dataRows([['a', 'b'], ['', ''], [' ', null], ['x', '']]), 2);
    });
    test('empty and missing input', () => {
        assert.equal(U.dataRows([]), 0);
        assert.equal(U.dataRows(undefined), 0);
    });
    test('a number cell counts, including zero', () => {
        assert.equal(U.dataRows([[0]]), 1);
    });
});

describe('rowsProblem', () => {
    test('within the limit is fine, one over is not', () => {
        assert.equal(U.rowsProblem(5000, 'grades'), null);
        assert.match(U.rowsProblem(5001, 'grades'), /5,001 rows.*5,000.*Split/);
        assert.equal(U.rowsProblem(1000, 'schedule'), null);
        assert.ok(U.rowsProblem(1001, 'schedule'));
        assert.equal(U.rowsProblem(500, 'accounts'), null);
        assert.ok(U.rowsProblem(501, 'accounts'));
    });
    test('a kind with no row limit never complains', () => {
        assert.equal(U.rowsProblem(999999, 'pdf'), null);
    });
});

describe('aiProblem', () => {
    test('says something useful for the refusals the functions send', () => {
        assert.match(U.aiProblem(401), /Sign in/);
        assert.match(U.aiProblem(403), /not allowed/);
        assert.match(U.aiProblem(413), /too large/);
    });
    test('accepts the status as a string, and stays silent otherwise', () => {
        assert.match(U.aiProblem('413'), /too large/);
        assert.equal(U.aiProblem(500), null);
        assert.equal(U.aiProblem(undefined), null);
    });
});
