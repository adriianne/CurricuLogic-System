// staffsamename.test.mjs
// Bulk upload: a staff row with the same first and last name as an existing staff account gets a notice, never a refusal (17 Nov 2026).
//   node --test tests/staffsamename.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const ES = createRequire(import.meta.url)('../shared/js/accounts/expectedstudents.js');
const adm = readFileSync(new URL('../features/admin/admindashboard.js', import.meta.url), 'utf8');

describe('sameNameStaffNote', () => {
    test('says which kind of account has the name and that a different person is fine', () => {
        const n = ES.sameNameStaffNote('Department', 'Pedro', 'Reyes');
        assert.match(n, /A Department account named Pedro Reyes already exists/);
        assert.match(n, /If this is a different person, that is fine/);
    });
    test('nothing to say when no staff account has the name', () => {
        assert.equal(ES.sameNameStaffNote(undefined, 'Ana', 'Cruz'), '');
        assert.equal(ES.sameNameStaffNote('', 'Ana', 'Cruz'), '');
    });
});

describe('the Admin bulk check', () => {
    test('existing staff names are read from all four staff tables, keyed by first and last name only', () => {
        assert.match(adm, /faculty_staff: 'Faculty', registrar_staff: 'Registrar', department_staff: 'Department', system_administrator: 'System Administrator'/);
        assert.match(adm, /select\('email, first_name, last_name'\)/);
        assert.match(adm, /BULK_EXISTING\.staffNames\.set\(key, label\)/);
    });
    test('the notice is added to the row note and the row is not failed', () => {
        const block = adm.slice(adm.indexOf('A staff row with the same first and last name'), adm.indexOf('seenEmails.set(email, r.__line);'));
        assert.match(block, /role !== 'student'/);
        assert.match(block, /base\.note = \[base\.note, sameName\]\.filter\(Boolean\)\.join\(' '\)/);
        assert.doesNotMatch(block, /fail\(/);
    });
    test('it keeps the middle-name note when both apply', () => {
        assert.match(adm, /Middle name is not kept for staff accounts, so it was left out\./);
    });
});

// 18 Nov 2026: a bulk row that says "2024-2025" selects the 2024 option instead of being marked "not published".
describe('the bulk Curriculum dropdown', () => {
    test('compares the year, not the typed text', () => {
        const fn = adm.slice(adm.indexOf('function bulkCurriculumOptions'), adm.indexOf('/* The editable review table'));
        assert.match(fn, /const typedYear = current \? CurriculogicExpectedStudents\.parseCurriculumYear\(current\)\.value : null;/);
        assert.match(fn, /const matches = \(y\) => typedYear !== null && Number\(y\) === typedYear;/);
        assert.match(fn, /current && !years\.some\(matches\)/);
        assert.doesNotMatch(fn, /years\.map\(String\)\.includes\(current\)/);
    });
});
