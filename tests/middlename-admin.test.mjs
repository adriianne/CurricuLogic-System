// middlename-admin.test.mjs
// The optional middle name on the Admin side (db/104): single form, bulk table, EDP list.
//   node --test tests/middlename-admin.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ES = require('../shared/js/accounts/expectedstudents.js');
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const js = read('features/admin/admindashboard.js');
const html = read('features/admin/admindashboard.html');

const programs = [{ id: 1, code: 'BSIT' }];
const row = (o = {}) => ({ __line: 2, student_id: '26100001', first_name: 'Ana', last_name: 'Cruz', program_code: 'BSIT', email: 'ana@example.com', ...o });

describe('EDP list rows', () => {
    test('a middle name is kept, cleaned and saved', () => {
        const r = ES.checkRows([row({ middle_name: '  Reyes ' })], programs);
        assert.equal(r.ok[0].middle, 'Reyes');
    });
    test('a file with no middle_name column leaves saved middle names alone (undefined)', () => {
        assert.equal(ES.checkRows([row()], programs).ok[0].middle, undefined);
    });
    test('a blank middle name is saved as none', () => {
        assert.equal(ES.checkRows([row({ middle_name: '' })], programs).ok[0].middle, null);
    });
    test('a middle name with digits is rejected with a reason', () => {
        const r = ES.checkRows([row({ middle_name: 'R3yes' })], programs);
        assert.equal(r.ok.length, 0);
        assert.match(r.bad[0].why, /middle name/i);
    });
    test('the column is in the template and searchable', () => {
        assert.ok(ES.COLUMNS.includes('middle_name'));
        assert.equal(ES.search([{ student_id: '1', first_name: 'Ana', middle_name: 'Reyes', last_name: 'Cruz', email: 'a@b.c' }], 'ana reyes cruz').length, 1);
    });
});

describe('the Admin page', () => {
    test('the single form has an optional middle name, shown for students only', () => {
        assert.match(html, /id="a-middle-name"/);
        assert.match(js, /\$\('a-middle-name-wrap'\)\.hidden\s*= !isStudent;/);
        assert.match(js, /\$\('a-role'\)\.value === 'student' \? CurriculogicNameRules\.clean/);
    });
    test('it is checked with the same rule and saved after the account is made', () => {
        assert.match(js, /CurriculogicNameRules\.middleProblem\(middle\)/);
        assert.match(js, /rpc\('set_student_middle_name'/);
    });
    test('the bulk file has a middle_name column; staff rows with one are refused; the same-name key includes it', () => {
        assert.match(js, /'first_name', 'middle_name', 'last_name',/);
        assert.match(js, /A middle name is only kept for students/);
        assert.match(js, /bulkNameKey = \(first, last, middle = ''\)/);
        assert.match(js, /bulkNameKey\(first, last, middle\)/);
    });
});
