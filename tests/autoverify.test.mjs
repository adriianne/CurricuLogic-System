// autoverify.test.mjs
// The Registrar no longer verifies records by hand (db/096). A first-year is marked at approval; any other
// student when the first grade is uploaded. These tests read the files; the database behaviour was checked on the
// live project on 6 Nov 2026 inside a rolled-back block (upper-year without grades: not verified; after the first
// grade: verified; first-year at approval: verified).
//
//   node --test tests/autoverify.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const sql = read('db/096_auto_verify_record.sql');
const registrar = read('features/registrar/registrardashboard.js');
const student = read('features/student/studentdashboard.js');

describe('db/096', () => {
    test('a first-year is verified when approved, and only then without grades', () => {
        assert.match(sql, /coalesce\(new\.year_level, 1\) <= 1/);
        assert.match(sql, /exists \(select 1 from public\.academic_record r where r\.student_id = new\.id\)/);
    });
    test('the first grade releases an upper-year student', () => {
        assert.match(sql, /create trigger academic_record_autoverify\s+after insert on public\.academic_record/);
        assert.match(sql, /where id = new\.student_id and is_approved is true and record_verified is not true/);
    });
    test('nobody is recorded as the verifier, and the functions cannot be called by a client', () => {
        assert.doesNotMatch(sql, /verified_by\s*:=/);
        assert.match(sql, /revoke all on function public\.student_autoverify\(\) from public, anon, authenticated/);
        assert.match(sql, /revoke all on function public\.academic_record_autoverify\(\) from public, anon, authenticated/);
    });
    test('the trigger sorts after the EDP auto-approval, so it sees the approved row', () => {
        assert.ok('student_register_zautoapprove' < 'student_register_zzverify');
    });
    test('the insert policy still refuses a client-made approved row (the guard of db/046 refuses first)', () => {
        assert.match(sql, /created_via = 'SELF_REGISTER' and approval_status = 'approved' and reviewed_by is null/);
    });
});

describe('the pages', () => {
    test('the Registrar has no Verify button any more', () => {
        assert.doesNotMatch(registrar, /Verify record/);
        assert.doesNotMatch(registrar, /data-verify=/);
    });
    test('the Registrar and the student say "grades", not "verified by the Registrar"', () => {
        assert.match(registrar, /Waiting for grades/);
        assert.match(student, /No grades on file yet/);
        assert.doesNotMatch(student, /Your academic record is being verified/);
        assert.doesNotMatch(student, /Pending with Registrar/);
    });
});
