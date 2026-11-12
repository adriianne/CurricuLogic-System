// bulkgrid.test.mjs
// The Admin bulk upload review table and the curriculum year (6 Nov 2026). These tests read the files and run the pure
// parts; the database side (db/102, db/103) was checked on the live project inside rolled-back blocks, and the page
// was driven in a browser.
//
//   node --test tests/bulkgrid.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const X = require('../shared/js/accounts/expectedstudents.js');
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const js = read('features/admin/admindashboard.js');
const sql = read('db/102_curriculum_year.sql');

describe('the curriculum year in the EDP list', () => {
    const programs = [{ id: 7, code: 'BSIT' }];
    const curricula = new Map([[7, new Set([2023, 2024])]]);
    const row = (o = {}) => ({ __line: 2, student_id: '99000020', first_name: 'Ana', last_name: 'Cruz', program_code: 'BSIT', email: 'ana@example.com', ...o });

    test('a year, or a school year, is read; blank stays blank', () => {
        assert.deepEqual(X.parseCurriculumYear('2024'), { value: 2024 });
        assert.deepEqual(X.parseCurriculumYear('2024-2025'), { value: 2024 });
        assert.deepEqual(X.parseCurriculumYear(' '), { value: null });
    });
    test('anything else is refused with a plain sentence', () => {
        for (const bad of ['abc', '1999', '2101', '24', '20x4']) assert.ok(X.parseCurriculumYear(bad).error, bad);
    });
    test('a year that has a curriculum for the programme is accepted', () => {
        const { ok, bad } = X.checkRows([row({ curriculum_year: '2024' })], programs, new Set(), new Map(), curricula);
        assert.equal(bad.length, 0);
        assert.equal(ok[0].curriculumYear, 2024);
    });
    test('a year with no curriculum is refused, and the published years are named', () => {
        const { ok, bad } = X.checkRows([row({ curriculum_year: '2031' })], programs, new Set(), new Map(), curricula);
        assert.equal(ok.length, 0);
        assert.match(bad[0].why, /No curriculum for 2031 exists for BSIT \(published: 2023, 2024\)/);
    });
    test('a file without the column leaves saved years alone; a blank cell clears it', () => {
        assert.equal(X.checkRows([row()], programs).ok[0].curriculumYear, undefined);
        assert.equal(X.checkRows([row({ curriculum_year: '' })], programs).ok[0].curriculumYear, null);
    });
});

describe('db/102', () => {
    test('a year that has no curriculum never stops a student registering: the active one is used and the note says so', () => {
        assert.match(sql, /not found, active curriculum used/);
        assert.match(sql, /v_pros := public\.curriculum_for\(e\.program_id, null\)/);
    });
    test('db/102 let the administrator or the registrar change a curriculum; db/106 narrowed it to the administrator (see changecurriculum.test.mjs)', () => {
        assert.match(sql, /public\.is_system_admin\(\) or public\.is_registrar_of_student\(s\.id\)/);
        assert.match(sql, /revoke all on function public\.set_student_curriculum\(text, integer\) from public, anon, authenticated/);
    });
});

describe('the review table', () => {
    test('every row is checked by one function, so the table, the button and the saving agree', () => {
        assert.match(js, /function checkBulkRows\(rows\)/);
        assert.match(js, /BULK_RESULTS = checkBulkRows\(PENDING_BULK_RAW\)/);
    });
    test('the checks include names, e-mails, IDs, passwords, years, curriculum and repeats', () => {
        for (const re of [/CurriculogicNameRules\.problem\(first, 'first name'\)/, /CurriculogicEmailRules\.problem\(email\)/,
            /Student ID must be 8 digits/, /CurriculogicPasswordRules\.problem\(password, role\)/, /Year level must be 1 to 4/,
            /parseCurriculumYear\(cyText\)/, /Duplicate email in file/, /Same name as line/, /An account with this e-mail already exists/,
            /A student with this ID already exists/, /A student with this name already exists/]) assert.match(js, re);
    });
    test('the table is editable and re-checks as you type, without redrawing the cell being typed in', () => {
        assert.match(js, /data-bulk-cell/);
        assert.match(js, /box\.addEventListener\('input', onEdit\)/);
        const edit = js.slice(js.indexOf('const onEdit'), js.indexOf("box.addEventListener('input', onEdit)"));
        assert.doesNotMatch(edit, /renderBulkPreview/);
        assert.match(edit, /updateBulkStatus\(\)/);
    });
    test('the Curriculum cell is a dropdown of the years that exist for THAT row\'s programme', () => {
        assert.match(js, /function bulkCurriculumOptions\(r\)/);
        assert.match(js, /CURRICULA\?\.get\(prog\.id\)/);
        assert.match(js, /key === 'curriculum_year'\s*\n\s*\? `<td><select/);
        // changing the programme of a row refreshes that row's choices
        assert.match(js, /cell\.dataset\.bulkCell === 'program_code'[\s\S]{0,200}bulkCurriculumOptions\(PENDING_BULK_RAW\[i\]\)/);
    });
    test('a year typed in the file that does not exist stays visible and marked, so the row\'s problem makes sense', () => {
        assert.match(js, /\(not published\)/);
    });
    test('a row can be removed', () => {
        assert.match(js, /data-bulk-remove/);
    });
    test('pressing Create re-checks first; rows with a problem are skipped and listed, the others are saved', () => {
        const commit = js.slice(js.indexOf('async function commitBulk'));
        assert.match(commit, /refreshBulkResults\(\);\s*const skipped = \[\.\.\.PENDING_BULK_BAD\];/);
        assert.match(commit, /Not saved: these rows had a problem/);
        assert.match(commit, /skipped because of a problem/);
        // only the rows that passed are ever sent to the database
        assert.match(commit, /const toCreate = PENDING_BULK\s*\n/);
    });
    test('a student row with a curriculum year is put on that curriculum after the account exists', () => {
        assert.match(js, /rpc\('set_student_curriculum',\s*\n?\s*\{ p_student_id: data\?\.student_id \?\? row\.studentId, p_year: row\.curriculumYear \}/);
    });
    test('the template has the new column', () => {
        assert.match(js, /'year_level', 'curriculum_year', 'password', 'username'/);
    });
});
