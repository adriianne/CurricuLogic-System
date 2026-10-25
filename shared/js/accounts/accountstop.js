// accountstop.js
//
// The rules of stopping and restoring an account (db/088). Pure functions only, so they are testable
// without a browser.
//
// Stopping is reversible and erases nothing: the person cannot sign in or reach any data until the Admin
// restores them. It applies to students and to faculty, registrar and department staff. Administrator
// accounts are not covered.
//
// Which accounts are stopped comes from account_stop_log: an account is stopped when the latest event for it
// is a "stop". A student the log has never heard of, but whose request was approved and whose access is off,
// is also shown as stopped (the flag was switched off by hand).

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.CurriculogicAccountStop = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const REASON_MAX = 300;

/* null when the reason can be saved, otherwise a sentence for the Admin. */
function reasonProblem(raw) {
    const text = String(raw ?? '').trim();
    if (!text) return 'A reason is required. It is kept in the history of this account.';
    if (text.length > REASON_MAX) return `That reason is ${text.length} characters. Please keep it under ${REASON_MAX}.`;
    return null;
}

const keyOf = (role, targetId) => `${role}:${targetId}`;

/* The set of accounts the log says are stopped now.
   rows: [{ role, target_id, action, seq }] in any order. The highest seq of each account is its latest event. */
function latestStops(rows) {
    const latest = new Map();
    for (const r of rows ?? []) {
        const k = keyOf(r.role, r.target_id);
        const seen = latest.get(k);
        if (!seen || Number(r.seq) > Number(seen.seq)) latest.set(k, r);
    }
    const stopped = new Set();
    for (const [k, r] of latest) if (r.action === 'stop') stopped.add(k);
    return stopped;
}

/* 'active' | 'stopped' | 'pending' | 'declined'.
   role: 'student' | 'faculty' | 'registrar' | 'department'; row: { id, is_approved, approval_status? }. */
function accountState(role, row, stopped) {
    if (row?.is_approved === true) return 'active';
    if (stopped?.has(keyOf(role, row?.id))) return 'stopped';
    if (role === 'student') {
        if (row?.approval_status === 'approved') return 'stopped';
        if (row?.approval_status === 'declined') return 'declined';
    }
    return 'pending';
}

/* The pill for a state. A student who is active reads "Approved", staff read "Active". */
function stateBadge(role, state) {
    switch (state) {
        case 'active':   return { kind: 'ok', label: role === 'student' ? 'Approved' : 'Active' };
        case 'stopped':  return { kind: 'bad', label: 'Stopped' };
        case 'declined': return { kind: 'bad', label: 'Declined' };
        default:         return { kind: 'waiting', label: 'Pending' };
    }
}

const canStop = (state) => state === 'active';
const canRestore = (state) => state === 'stopped';

/* What a sign-in page says to someone whose account is not active. The default is the old wording, for a
   person whose request is still being reviewed. A stopped account says so plainly and says who to ask.
   roleKey is the key of the sign-in page's role table (university_student, faculty_staff, ...). */
const PENDING_MESSAGE = 'This account is awaiting verification. You will be notified once it is approved.';

function notActiveMessage(roleKey, row) {
    if (roleKey === 'university_student') {
        return row?.approval_status === 'approved'
            ? 'This account has been stopped. Please contact the Office of the Registrar.'
            : PENDING_MESSAGE;
    }
    if (roleKey === 'faculty_staff' || roleKey === 'registrar_staff' || roleKey === 'department_staff') {
        return 'This account is not active. Please contact the System Administrator.';
    }
    return PENDING_MESSAGE;
}

return { REASON_MAX, reasonProblem, latestStops, accountState, stateBadge, canStop, canRestore, notActiveMessage, PENDING_MESSAGE };

}));
