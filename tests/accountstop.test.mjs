// accountstop.test.mjs
// Stopping and restoring accounts: the reason rule, who counts as stopped, the pill, the sign-in message.
//
//   node --test tests/accountstop.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const A = require('../shared/js/accounts/accountstop.js');

describe('reasonProblem', () => {
    test('a reason is required', () => {
        for (const v of ['', '  ', null, undefined, '\n']) assert.match(A.reasonProblem(v), /required/, JSON.stringify(v));
    });
    test('300 characters is the limit, counted without the spaces around it', () => {
        assert.equal(A.reasonProblem('x'.repeat(300)), null);
        assert.equal(A.reasonProblem('  ' + 'x'.repeat(300) + '  '), null);
        assert.match(A.reasonProblem('x'.repeat(301)), /301 characters.*under 300/);
    });
    test('an ordinary reason is fine', () => {
        assert.equal(A.reasonProblem('Graduated, March 2027.'), null);
    });
});

describe('latestStops', () => {
    const row = (role, id, action, seq) => ({ role, target_id: id, action, seq });

    test('an account whose latest event is a stop is stopped', () => {
        const s = A.latestStops([row('student', 'a', 'stop', 1)]);
        assert.equal(s.has('student:a'), true);
    });
    test('a later restore ends it, whatever order the rows come in', () => {
        assert.equal(A.latestStops([row('student', 'a', 'stop', 1), row('student', 'a', 'restore', 2)]).size, 0);
        assert.equal(A.latestStops([row('student', 'a', 'restore', 2), row('student', 'a', 'stop', 1)]).size, 0);
    });
    test('stopped again after a restore is stopped', () => {
        const s = A.latestStops([row('student', 'a', 'stop', 1), row('student', 'a', 'restore', 2), row('student', 'a', 'stop', 3)]);
        assert.equal(s.has('student:a'), true);
    });
    test('the same id in two roles is two accounts', () => {
        const s = A.latestStops([row('student', 'x', 'stop', 1), row('faculty', 'x', 'restore', 2)]);
        assert.equal(s.has('student:x'), true);
        assert.equal(s.has('faculty:x'), false);
    });
    test('seq is compared as a number, not as text', () => {
        const s = A.latestStops([row('student', 'a', 'stop', 9), row('student', 'a', 'restore', 10)]);
        assert.equal(s.size, 0);
    });
    test('empty or missing input', () => {
        assert.equal(A.latestStops([]).size, 0);
        assert.equal(A.latestStops(null).size, 0);
    });
});

describe('accountState', () => {
    const none = new Set();
    test('an approved account is active', () => {
        assert.equal(A.accountState('student', { id: 'a', is_approved: true }, none), 'active');
        assert.equal(A.accountState('faculty', { id: 'f', is_approved: true }, none), 'active');
    });
    test('the log decides stopped, for staff as well as students', () => {
        const stopped = new Set(['faculty:f', 'student:a']);
        assert.equal(A.accountState('faculty', { id: 'f', is_approved: false }, stopped), 'stopped');
        assert.equal(A.accountState('student', { id: 'a', is_approved: false, approval_status: 'approved' }, stopped), 'stopped');
    });
    test('a student approved earlier but switched off is stopped even with no log entry', () => {
        assert.equal(A.accountState('student', { id: 'a', is_approved: false, approval_status: 'approved' }, none), 'stopped');
    });
    test('a student who was never approved is pending or declined, not stopped', () => {
        assert.equal(A.accountState('student', { id: 'a', is_approved: false, approval_status: 'pending' }, none), 'pending');
        assert.equal(A.accountState('student', { id: 'a', is_approved: false, approval_status: null }, none), 'pending');
        assert.equal(A.accountState('student', { id: 'a', is_approved: false, approval_status: 'declined' }, none), 'declined');
    });
    test('staff that is not approved and not in the log is pending', () => {
        assert.equal(A.accountState('registrar', { id: 'r', is_approved: false }, none), 'pending');
    });
});

describe('stateBadge, canStop, canRestore', () => {
    test('labels differ for a student and for staff, and stopped is red', () => {
        assert.deepEqual(A.stateBadge('student', 'active'), { kind: 'ok', label: 'Approved' });
        assert.deepEqual(A.stateBadge('faculty', 'active'), { kind: 'ok', label: 'Active' });
        assert.deepEqual(A.stateBadge('student', 'stopped'), { kind: 'bad', label: 'Stopped' });
        assert.deepEqual(A.stateBadge('student', 'pending'), { kind: 'waiting', label: 'Pending' });
        assert.deepEqual(A.stateBadge('student', 'declined'), { kind: 'bad', label: 'Declined' });
    });
    test('only an active account can be stopped, and only a stopped one restored', () => {
        for (const s of ['active', 'stopped', 'pending', 'declined']) {
            assert.equal(A.canStop(s), s === 'active', s);
            assert.equal(A.canRestore(s), s === 'stopped', s);
        }
    });
});

describe('notActiveMessage', () => {
    test('a stopped student is told so and who to ask', () => {
        const m = A.notActiveMessage('university_student', { approval_status: 'approved' });
        assert.match(m, /stopped/);
        assert.match(m, /Registrar/);
    });
    test('a student still being reviewed keeps the old wording', () => {
        assert.equal(A.notActiveMessage('university_student', { approval_status: 'pending' }), A.PENDING_MESSAGE);
        assert.equal(A.notActiveMessage('university_student', {}), A.PENDING_MESSAGE);
    });
    test('staff are pointed to the System Administrator', () => {
        for (const k of ['faculty_staff', 'registrar_staff', 'department_staff']) {
            assert.match(A.notActiveMessage(k, { is_approved: false }), /System Administrator/, k);
        }
    });
    test('anything else keeps the old wording', () => {
        assert.equal(A.notActiveMessage('system_administrator', {}), A.PENDING_MESSAGE);
    });
});
