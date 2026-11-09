// registrationpolish.test.mjs
// Account-creation fixes of 6 Nov 2026 (db/098 and the EDP upload check).
//
//   node --test tests/registrationpolish.test.mjs
//
// The database behaviour was checked on the live project inside rolled-back blocks: a student who typed
// "  tEST " / "DELTA" got an account stored as "Test Delta" with the listed ID; "Muñoz", "João" and "Łukasz" match
// their plain spellings; and the same-name block steps aside while an EDP list is in use.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const X = require('../shared/js/accounts/expectedstudents.js');
const sql = readFileSync(new URL('../db/098_registration_polish.sql', import.meta.url), 'utf8');

const PROGRAMS = [{ id: 7, code: 'BSIT' }];
const row = (o = {}) => ({ __line: 2, student_id: '99000020', first_name: 'Ana', last_name: 'Cruz', program_code: 'BSIT', email: 'ana@example.com', ...o });

describe('db/098', () => {
    test('the approved account takes the official name from the list', () => {
        assert.match(sql, /new\.first_name\s+:= e\.first_name/);
        assert.match(sql, /new\.last_name\s+:= e\.last_name/);
        assert.doesNotMatch(sql, /coalesce\(new\.first_name/);
    });
    test('more letters are folded, and the two translate strings are the same length', () => {
        const m = sql.match(/'([^']+)',\s*\n\s*'([a-z]+)'\),/);
        assert.ok(m, 'translate strings found');
        assert.equal([...m[1]].length, [...m[2]].length);
        for (const ch of 'ãõçłšž') assert.ok(m[1].includes(ch), ch);
    });
    test('the same-name block steps aside while a list is in use', () => {
        assert.match(sql, /select not exists \(select 1 from public\.expected_student\)/);
    });
});

describe('EDP upload: one e-mail, one student', () => {
    test('two students with the same e-mail in one file: the second is rejected with the first line', () => {
        const { ok, bad } = X.checkRows([row({ __line: 2 }), row({ __line: 3, student_id: '99000021', first_name: 'Ben' })], PROGRAMS);
        assert.equal(ok.length, 1);
        assert.match(bad[0].why, /already used by another student in the file \(line 2\)/);
    });
    test('the same e-mail in different letter case is still the same e-mail', () => {
        const { ok, bad } = X.checkRows([row(), row({ __line: 3, student_id: '99000021', email: 'ANA@Example.com' })], PROGRAMS);
        assert.equal(ok.length, 1);
        assert.equal(bad.length, 1);
    });
    test('an e-mail already on the list for another student is rejected', () => {
        const existing = new Map([['ana@example.com', '99000099']]);
        const { ok, bad } = X.checkRows([row()], PROGRAMS, new Set(), existing);
        assert.equal(ok.length, 0);
        assert.match(bad[0].why, /already on the list for student 99000099/);
    });
    test('the same student keeping their own e-mail is an update, not a clash', () => {
        const existing = new Map([['ana@example.com', '99000020']]);
        const { ok, bad } = X.checkRows([row()], PROGRAMS, new Set(['99000020']), existing);
        assert.equal(bad.length, 0);
        assert.equal(ok[0].isUpdate, true);
    });
    test('an e-mail moving from one listed student to another in the same file is allowed', () => {
        const existing = new Map([['ana@example.com', '99000099']]);
        const rows = [row({ __line: 2, student_id: '99000099', email: 'new.owner@example.com', first_name: 'Old' }), row({ __line: 3 })];
        const { ok, bad } = X.checkRows(rows, PROGRAMS, new Set(['99000099']), existing);
        assert.equal(bad.length, 0);
        assert.equal(ok.length, 2);
    });
});
