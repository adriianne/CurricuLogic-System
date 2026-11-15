// studentid8.test.mjs
// A student ID is 8 digits (YY + 6-digit counter), decided 29 Oct 2026 for the printed UC-Form 1A (db/090).
// This guards the places that check an ID in the browser so a 7-digit rule cannot come back.
//
//   node --test tests/studentid8.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

describe('no page checks for a 7-digit student ID any more', () => {
    for (const file of [
        'shared/js/accounts/register.js', 'shared/js/accounts/expectedstudents.js', 'shared/js/accounts/auth.js',
        'features/admin/admindashboard.js', 'features/admin/admindashboard.html', 'features/department/departmentdashboard.js',
        'features/auth/html/registerpage.html',
    ]) {
        test(`${file} has no 7-digit ID rule or example`, () => {
            const s = read(file);
            assert.ok(!s.includes('\\d{7}'), 'a 7-digit regex');
            assert.doesNotMatch(s, /7 digits/, 'the words "7 digits"');
            assert.doesNotMatch(s, /\b\d{2}0?1187\b(?<!\d{8})/, 'a 7-digit sample ID');
        });
    }

    test('the Register page accepts 8 digits and a uc- prefix, and nothing else', () => {
        const s = read('shared/js/accounts/register.js');
        assert.ok(s.includes('/^\\d{8}$/.test(digits)'));
        assert.match(s, /8 digits, for example 24001187/);
    });

    test('the Department grade upload pads and checks to 8 digits', () => {
        const s = read('features/department/departmentdashboard.js');
        assert.match(s, /raw\.length < 8\) return raw\.padStart\(8, '0'\)/);
        assert.match(s, /cleanId\.length !== 8/);
    });
});

describe('db/090 migration', () => {
    const sql = read('db/090_student_id_8_digits.sql');
    test('converts every 7-digit ID by putting a 0 after the year, and makes the check 8 digits', () => {
        assert.match(sql, /left\(student_id, 2\) \|\| '0' \|\| substr\(student_id, 3\)/);
        assert.ok(sql.includes("check (student_id is null or student_id ~ '^\\d{8}$')"));
    });
    test('the counter becomes 6 digits with a 999999 ceiling, and every function edit is checked', () => {
        assert.match(sql, /lpad\(v_n::text, 6/);
        assert.match(sql, /v_n > 999999/);
        assert.match(sql, /raise exception 'db\/090: "%" not found/);
    });
});
