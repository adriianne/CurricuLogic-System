// recordpolicy.test.mjs
// db/132: a student reading their own record must not run the staff checks on every row of academic_record
// (4,202 rows: 10.8 s and a statement timeout, so the Android Academic record said "Could not load").
//
//   node --test tests/recordpolicy.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../db/132_record_policy_speed.sql', import.meta.url), 'utf8');
const code = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

describe('db/132 academic_record policies', () => {
    test('the staff checks run only for approved staff, once per query', () => {
        assert.match(code, /"staff read own-programme records"[\s\S]*?\(select public\.is_approved_staff\(\)\) and public\.can_see_student\(student_id\)/);
        assert.match(code, /"department_writes_records"[\s\S]*?using \(\(select public\.is_approved_staff\(\)\) and public\.is_department_of_student\(student_id\)\)/);
        assert.match(code, /with check \(\(select public\.is_approved_staff\(\)\) and public\.is_department_of_student\(student_id\)\)/);
    });
    test('"my row" reads the caller once', () => {
        assert.match(code, /student_id = \(select public\.current_student_id\(\)\)/);
    });
    test('only three policies change, and no data is touched', () => {
        assert.equal((code.match(/alter policy/g) || []).length, 3);
        assert.doesNotMatch(code, /\b(delete|update|insert|drop|truncate)\b/i);
    });
    test('the rollback is written down', () => {
        assert.match(sql, /ROLLBACK/);
        assert.match(sql, /using \(student_id = current_student_id\(\)\)/);
    });
});
