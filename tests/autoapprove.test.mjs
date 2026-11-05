// autoapprove.test.mjs
// The EDP list decides who may have an account; the Registrar no longer approves new accounts (db/095).
//
//   node --test tests/autoapprove.test.mjs
//
// These tests read the files, so they cannot prove the database behaviour. That was tested on the live
// project inside a rolled-back transaction on 4 Nov 2026 (match, wrong e-mail, wrong programme, an approved
// row sent by a client, no list, and the Admin's own path). They pin down what must not change.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const sql = read('db/095_auto_approve_edp_match.sql');
const register = read('shared/js/accounts/register.js');
const page = read('features/auth/html/registerpage.html');

describe('db/095: the migration', () => {
    test('the trigger runs last, after the guards of 046 and 093', () => {
        assert.match(sql, /create trigger student_register_zautoapprove\s+before insert on public\.university_student/);
        // Postgres fires BEFORE triggers by name: ours must sort after the guards.
        const names = ['student_id_on_register', 'student_register_guard', 'student_register_name_guard', 'student_register_zautoapprove'];
        assert.deepEqual([...names].sort(), names);
    });
    test('it acts only on a plain self-registration, so the Admin path is left alone', () => {
        assert.match(sql, /new\.created_via is distinct from 'SELF_REGISTER'/);
        assert.match(sql, /new\.is_approved is true/);
    });
    test('the e-mail must match the one on the list, in both paths', () => {
        const emailChecks = sql.match(/lower\(btrim\([a-z]\.email\)\) = lower\(btrim\(coalesce\(/g) ?? [];
        assert.ok(emailChecks.length >= 3, 'check function, count, and select each compare the e-mail');
    });
    test('a registration that does not match, or with no list, is refused', () => {
        assert.match(sql, /Registration is not open yet/);
        assert.match(sql, /do not match the EDP student list/);
        assert.match(sql, /if v_n <> 1 then/);
    });
    test('the approved row carries the listed ID, year, and the active curriculum, and stays unverified', () => {
        assert.match(sql, /new\.student_id\s+:= e\.student_id/);
        assert.match(sql, /new\.year_level\s+:= e\.year_level/);
        assert.match(sql, /new\.prospectus_id\s+:= v_pros/);
        assert.doesNotMatch(sql, /record_verified\s*:=\s*true/);
    });
    test('the insert policy allows only a SELF_REGISTER row approved without a reviewer', () => {
        assert.match(sql, /created_via = 'SELF_REGISTER' and approval_status = 'approved' and reviewed_by is null/);
        assert.match(sql, /record_verified = false/);
    });
    test('the trigger function cannot be called by a client', () => {
        assert.match(sql, /revoke all on function public\.student_register_autoapprove\(\) from public, anon, authenticated/);
    });
});

describe('the Register page', () => {
    test('it checks the EDP list, with the e-mail, before the sign-in account is created', () => {
        const check = register.indexOf("rpc('check_registration_match'");
        const signUp = register.indexOf('supabase.auth.signUp');
        assert.ok(check > 0 && signUp > 0 && check < signUp);
        assert.match(register, /p_email:\s+CurriculogicEmailRules\.clean\(\$\('email'\)\.value\)/);
    });
    test('a student who does not match is stopped, not warned', () => {
        assert.match(register, /registrationCheck\(await expectedStudentResult\(\)\)/);
        assert.match(register, /if \(!gate\.allow\)/);
        assert.doesNotMatch(register, /Submit anyway|warnedNotOnList/);
    });
    test('the database refusals are turned into plain messages', () => {
        assert.match(register, /EDP student list/);
        assert.match(register, /not open yet/);
    });
    test('the success message no longer promises a Registrar review', () => {
        const msg = register.match(/const SUBMITTED_MESSAGE =\s*'([^']*)'/)[1];
        assert.match(msg, /EDP student list/);
        assert.doesNotMatch(msg, /Registrar/);
    });
    test('the page says the EDP list decides, and the Registrar approves nothing', () => {
        assert.doesNotMatch(page, /Registrar verifies|goes to the Office of the Registrar|Registrar approves/);
        assert.match(page, /approved at once/);
        assert.match(page, /EDP student list/);
    });
});
