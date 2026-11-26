// deleteaccount.test.mjs
// Delete account (db/131): a second step after Stop, with the ID typed, refused when the account has history.
//
//   node --test tests/deleteaccount.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const A = require('../shared/js/accounts/accountstop.js');
const sql = readFileSync(new URL('../db/131_delete_account.sql', import.meta.url), 'utf8');
const admin = readFileSync(new URL('../features/admin/admindashboard.js', import.meta.url), 'utf8');

describe('who can be deleted', () => {
    test('only a stopped account', () => {
        assert.equal(A.canDelete('stopped', 'faculty'), true);
        for (const state of ['active', 'pending', 'declined']) assert.equal(A.canDelete(state, 'faculty'), false, state);
    });
    test('students and staff, never an administrator', () => {
        for (const role of ['student', 'faculty', 'registrar', 'department']) assert.equal(A.canDelete('stopped', role), true, role);
        assert.equal(A.canDelete('stopped', 'admin'), false);
    });
});

describe('the ID that is typed to confirm', () => {
    test('a student is confirmed by the student ID, staff by the employee ID', () => {
        assert.equal(A.deleteIdentifier('student', { student_id: '24001188', employee_id: 'x' }), '24001188');
        assert.equal(A.deleteIdentifier('faculty', { employee_id: 'EMP-00032', student_id: 'x' }), 'EMP-00032');
    });
    test('an account without an ID is confirmed by its email', () => {
        assert.equal(A.deleteIdentifier('faculty', { employee_id: null, email: 'a@b.c' }), 'a@b.c');
    });
    test('the match is exact, ignores case and the spaces at the ends', () => {
        assert.equal(A.deleteConfirmMatches('emp-00032', 'EMP-00032'), true);
        assert.equal(A.deleteConfirmMatches('  EMP-00032 ', 'EMP-00032'), true);
        assert.equal(A.deleteConfirmMatches('EMP-0003', 'EMP-00032'), false);
        assert.equal(A.deleteConfirmMatches('EMP-000322', 'EMP-00032'), false);
    });
    test('nothing typed, or nothing to match, never matches', () => {
        assert.equal(A.deleteConfirmMatches('', 'EMP-00032'), false);
        assert.equal(A.deleteConfirmMatches(undefined, 'EMP-00032'), false);
        assert.equal(A.deleteConfirmMatches('', ''), false);
        assert.equal(A.deleteConfirmMatches('x', ''), false);
    });
});

describe('db/131 delete_account', () => {
    test('only an administrator can call it, and the public cannot', () => {
        assert.match(sql, /if not public\.is_system_admin\(\) then/);
        assert.match(sql, /revoke all on function public\.delete_account\(text, uuid, text\) from public, anon/);
        assert.match(sql, /grant execute on function public\.delete_account\(text, uuid, text\) to authenticated/);
    });
    test('administrator accounts and your own account cannot be deleted', () => {
        assert.match(sql, /Administrator accounts cannot be deleted here/);
        assert.match(sql, /You cannot delete your own account/);
    });
    test('an account that is not stopped is refused, and the typed ID must match', () => {
        assert.match(sql, /Only a stopped account can be deleted\. Stop it first\./);
        assert.match(sql, /To delete this account, type its ID/);
    });
    test('history is refused in plain words, for every role', () => {
        for (const w of ['academic record', 'plan request', 'grade-upload row', 'approval decision', 'curriculum version', 'schedule row', 'grade upload', 'accounts? it created|account\' \\|\\| case']) {
            assert.ok(new RegExp(w).test(sql), w);
        }
        assert.match(sql, /Keep it stopped instead/);
    });
    test('one audit line is written before the sign-in is removed, and the sign-in removal does the rest', () => {
        const audit = sql.indexOf("'DELETE_ACCOUNT'");
        const del = sql.indexOf('delete from auth.users');
        assert.ok(audit > 0 && del > audit);
    });
    test('a link that still points at the account stops the delete with a plain message, not a database error', () => {
        assert.match(sql, /exception when foreign_key_violation then/);
        assert.match(sql, /other records still refer to it/);
    });
});

describe('the admin page', () => {
    test('Delete is offered next to Restore, on stopped accounts only', () => {
        assert.match(admin, /A\.canDelete\(state, role\)/);
        assert.match(admin, /data-acct="delete"/);
    });
    test('the Delete button stays off until the ID matches', () => {
        assert.match(admin, /data-acct-delete="\$\{role\}" data-id="\$\{id\}" \$\{ok \? '' : 'disabled'\}/);
        assert.match(admin, /btn\.disabled = !CurriculogicAccountStop\.deleteConfirmMatches/);
    });
    test('it calls delete_account with the typed ID and shows the database message as it is', () => {
        assert.match(admin, /supabase\.rpc\('delete_account', \{ p_role: role, p_target: id, p_confirm: ui\.typed\.trim\(\) \}\)/);
        assert.match(admin, /err\.textContent = error\.message/);
    });
    test('a deleted account leaves the list and the screen is redrawn', () => {
        assert.match(admin, /list\.splice\(at, 1\)/);
        assert.match(admin, /was deleted\./);
    });
});
