// systemlogs.test.mjs
// What the Administrator's System logs page shows, and what it keeps private (shared/js/records/systemlogs.js).
//
//   node --test tests/systemlogs.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const L = require('../shared/js/records/systemlogs.js');

const NOW = Date.parse('2026-10-28T15:00:00Z');
const hoursBefore = (h) => new Date(NOW - h * 3600000).toISOString();

describe('plain words for the stored codes', () => {
    test('actions read as what was done', () => {
        assert.equal(L.actionLabel('PROVISION_ACCOUNT'), 'Created account');
        assert.equal(L.actionLabel('UPDATE_UNIVERSITY_STUDENT'), 'Changed');
        assert.equal(L.actionLabel('DELETE_FACULTY_STAFF'), 'Deleted');
        assert.equal(L.actionLabel('INSERT_PROSPECTUS'), 'Added');
        assert.equal(L.actionLabel('COPY_PROSPECTUS'), 'Copied');
        assert.equal(L.actionLabel('SOMETHING_NEW'), 'Something new');
        assert.equal(L.actionLabel(null), 'Unknown');
    });

    test('tables and roles read as people would say them', () => {
        assert.equal(L.tableLabel('university_student'), 'Student');
        assert.equal(L.tableLabel('system_administrator'), 'Administrator');
        assert.equal(L.tableLabel('odd_table'), 'Odd table');
        assert.equal(L.roleLabel('system'), 'System (automatic)');
        assert.equal(L.roleLabel('registrar_staff'), 'Registrar');
        assert.equal(L.roleLabel(undefined), 'Unknown');
    });
});

describe('what an entry changed, with private values masked', () => {
    test('an update lists only the fields that changed', () => {
        const r = L.changesOf({ old_values: { is_approved: false }, new_values: { is_approved: true } });
        assert.deepEqual(r, { fields: [{ field: 'is_approved', from: 'false', to: 'true' }], more: 0 });
    });

    test('fields that are the same on both sides are not listed', () => {
        const r = L.changesOf({ old_values: { a: 1, b: 2 }, new_values: { a: 1, b: 3 } });
        assert.deepEqual(r.fields.map(f => f.field), ['b']);
    });

    test('a removed row lists its fields, with id and sign-in link left out, and an email masked', () => {
        const r = L.changesOf({
            old_values: { id: 'abc', user_id: 'def', email: 'juan@gmail.com', last_name: 'Cruz' }, new_values: null,
        });
        assert.deepEqual(r.fields, [
            { field: 'email', from: 'j***@gmail.com', to: '(empty)' },
            { field: 'last_name', from: 'Cruz', to: '(empty)' },
        ]);
    });

    test('a created row lists what it was created with', () => {
        const r = L.changesOf({ old_values: null, new_values: { code: 'IT 101' } });
        assert.deepEqual(r.fields, [{ field: 'code', from: '(empty)', to: 'IT 101' }]);
    });

    test('passwords, tokens and photos are shown as dots whatever they hold', () => {
        for (const field of ['password', 'encrypted_password', 'reset_token', 'api_key', 'photo_url', 'otp_code', 'password_hash']) {
            const r = L.changesOf({ old_values: { [field]: 'secret-1' }, new_values: { [field]: 'secret-2' } });
            assert.deepEqual([r.fields[0].from, r.fields[0].to], ['••••', '••••'], field);
        }
    });

    test('long values are cut, and a whole row shows at most eight fields and counts the rest', () => {
        const long = 'x'.repeat(200);
        assert.equal(L.shown('note', long).length, 60);
        assert.ok(L.shown('note', long).endsWith('…'));
        const whole = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`f${String(i).padStart(2, '0')}`, i]));
        const r = L.changesOf({ old_values: null, new_values: whole });
        assert.equal(r.fields.length, 8);
        assert.equal(r.more, 4);
    });

    test('an entry with nothing recorded, or odd values, gives nothing and never throws', () => {
        assert.deepEqual(L.changesOf({}), { fields: [], more: 0 });
        assert.deepEqual(L.changesOf(null), { fields: [], more: 0 });
        assert.deepEqual(L.changesOf({ old_values: 'text', new_values: [1] }), { fields: [], more: 0 });
        assert.equal(L.shown('x', null), '(empty)');
        assert.equal(L.shown('x', { a: 1 }), '{"a":1}');
    });
});

describe('times', () => {
    test('how long ago', () => {
        assert.equal(L.agoLabel(hoursBefore(0), NOW), 'just now');
        assert.equal(L.agoLabel(new Date(NOW - 5 * 60000).toISOString(), NOW), '5 minutes ago');
        assert.equal(L.agoLabel(new Date(NOW - 60000).toISOString(), NOW), '1 minute ago');
        assert.equal(L.agoLabel(hoursBefore(3), NOW), '3 hours ago');
        assert.equal(L.agoLabel(hoursBefore(24), NOW), '1 day ago');
        assert.equal(L.agoLabel(hoursBefore(100), NOW), '4 days ago');
        assert.equal(L.agoLabel('not a date', NOW), '');
    });

    test('how long a request took', () => {
        assert.equal(L.durationLabel(850), '850 ms');
        assert.equal(L.durationLabel(37659), '38 s');
        assert.equal(L.durationLabel(2300), '2.3 s');
        assert.equal(L.durationLabel(-1), '');
        assert.equal(L.durationLabel('x'), '');
    });
});

describe('Cura usage summed up', () => {
    const row = (hours, over = {}) => ({
        created_at: hoursBefore(hours), status: 'ok', duration_ms: 1000, model: 'm1', attempts: 1, had_wishes: false, ...over,
    });

    test('no requests gives zeros and no percentages', () => {
        const s = L.curaSummary([], NOW);
        assert.equal(s.total, 0);
        assert.equal(s.successRate, null);
        assert.equal(s.avgMs, null);
        assert.deepEqual(s.byModel, []);
    });

    test('counts, rates, times, tries and models', () => {
        const rows = [
            row(1, { duration_ms: 2000 }),
            row(2, { duration_ms: 4000, attempts: 3, model: 'm2', had_wishes: true }),
            row(3, { status: 'busy', duration_ms: 46000, attempts: 6 }),
            row(4, { status: 'error', duration_ms: 500, attempts: null, model: null }),
            row(5, { status: 'bad_request', duration_ms: 100 }),
        ];
        const s = L.curaSummary(rows, NOW);
        assert.equal(s.total, 5);
        assert.deepEqual([s.ok, s.busy, s.error, s.badRequest], [2, 1, 1, 1]);
        assert.equal(s.successRate, 40);
        assert.equal(s.avgMs, 10520);
        assert.equal(s.maxMs, 46000);
        assert.equal(s.p95Ms, 46000);
        assert.equal(s.avgAttempts, 2.8);     // (1 + 3 + 6 + 1) / 4, the row without a count is left out
        assert.equal(s.retried, 2);
        assert.equal(s.withWishes, 1);
        assert.deepEqual(s.byModel, [{ model: 'm1', count: 3 }, { model: 'm2', count: 1 }]);
    });

    test('only the asked window counts', () => {
        const rows = [row(1), row(23), row(25), row(100)];
        assert.equal(L.curaSummary(rows, NOW, 24).total, 2);
        assert.equal(L.curaSummary(rows, NOW, 168).total, 4);
        assert.equal(L.curaSummary([row(-5)], NOW, 24).total, 0);      // a time in the future is not counted
    });

    test('rows with an unreadable time or time taken do not break it', () => {
        const s = L.curaSummary([{ created_at: 'x', status: 'ok' }, row(1, { duration_ms: null })], NOW);
        assert.equal(s.total, 1);
        assert.equal(s.avgMs, null);
    });

    test('a request outcome has its own colour and word', () => {
        assert.deepEqual(L.statusPill('ok'), { cls: 'ok', label: 'OK' });
        assert.deepEqual(L.statusPill('busy'), { cls: 'waiting', label: 'Busy' });
        assert.deepEqual(L.statusPill('error'), { cls: 'bad', label: 'Error' });
        assert.deepEqual(L.statusPill('bad_request'), { cls: 'info', label: 'Refused' });
        assert.equal(L.statusPill('new').label, 'new');
    });
});

describe('the nightly cleanup', () => {
    const line = (hours, task, rows, dry = false) => ({ ran_at: hoursBefore(hours), task, rows_found: rows, dry_run: dry });

    test('no real run yet is said plainly, and a dry run does not count', () => {
        assert.equal(L.lastCleanup([], NOW).state, 'none');
        assert.equal(L.lastCleanup([line(1, 'a', 0, true)], NOW).state, 'none');
        assert.equal(L.lastCleanup(null, NOW).state, 'none');
    });

    test('a run in the last day is on time, and its lines are listed', () => {
        const r = L.lastCleanup([line(20, 'stg_subject', 5), line(20, 'read_notifications', 0), line(44, 'stg_subject', 9)], NOW);
        assert.equal(r.state, 'ok');
        assert.equal(r.hoursAgo, 20);
        assert.deepEqual(r.tasks, [{ task: 'read_notifications', rowsFound: 0 }, { task: 'stg_subject', rowsFound: 5 }]);
    });

    test('no run for more than 26 hours is late', () => {
        assert.equal(L.lastCleanup([line(26, 'a', 0)], NOW).state, 'ok');
        assert.equal(L.lastCleanup([line(27, 'a', 0)], NOW).state, 'late');
    });

    test('a dry run later than the real one does not hide a late cleanup', () => {
        const r = L.lastCleanup([line(30, 'a', 0), line(1, 'a', 4, true)], NOW);
        assert.equal(r.state, 'late');
        assert.equal(r.hoursAgo, 30);
    });
});

describe('times with no zone on them are read as UTC', () => {
    test('a naive time and the same time marked UTC are the same moment, whatever the computer clock says', () => {
        const naive = L.parseTime('2026-10-28T14:00:00.123456');
        assert.equal(naive, Date.parse('2026-10-28T14:00:00.123Z'));
        assert.equal(L.parseTime('2026-10-28 14:00:00'), Date.parse('2026-10-28T14:00:00Z'));
        assert.equal(L.parseTime('2026-10-28T14:00:00+00'), Date.parse('2026-10-28T14:00:00Z'));
        assert.equal(L.parseTime('2026-10-28T22:00:00+08:00'), Date.parse('2026-10-28T14:00:00Z'));
        assert.ok(Number.isNaN(L.parseTime('')));
        assert.ok(Number.isNaN(L.parseTime(null)));
        assert.ok(Number.isNaN(L.parseTime('nope')));
    });

    test('"how long ago" and the cleanup check use it', () => {
        assert.equal(L.agoLabel('2026-10-28T12:00:00', NOW), '3 hours ago');      // NOW is 15:00 UTC
        const r = L.lastCleanup([{ ran_at: '2026-10-27 19:00:00', task: 't', rows_found: 1, dry_run: false }], NOW);
        assert.equal(r.hoursAgo, 20);
    });
});

describe('the activity chart and the colours on the Activity table', () => {
    // A time at noon on a given local calendar day, so the test does not depend on the machine's time zone.
    const noon = (y, m, d) => new Date(y, m - 1, d, 12).toISOString();
    const now = new Date(2026, 9, 28, 15).getTime();           // 28 Oct 2026, 15:00 local

    test('perDay gives the last 7 days, oldest first, with today last', () => {
        const days = L.perDay([], now, 7);
        assert.equal(days.length, 7);
        assert.equal(days[6].key, '2026-10-28');
        assert.equal(days[0].key, '2026-10-22');
        assert.ok(days.every(d => d.count === 0));
    });

    test('perDay counts rows on their own day and ignores older or unreadable ones', () => {
        const rows = [
            { created_at: noon(2026, 10, 28) }, { created_at: noon(2026, 10, 28) },
            { created_at: noon(2026, 10, 27) },
            { created_at: noon(2026, 10, 15) },     // older than 7 days
            { created_at: 'not a time' }, { created_at: null }, null,
        ];
        const days = L.perDay(rows, now, 7);
        assert.equal(days[6].count, 2);
        assert.equal(days[5].count, 1);
        assert.equal(days.reduce((a, d) => a + d.count, 0), 3);
    });

    test('perDay gives each day a short weekday name', () => {
        const days = L.perDay([], now, 7);
        assert.equal(days[6].label, 'Wed');             // 28 Oct 2026 is a Wednesday
    });

    test('actionTone: green for new, amber for changes, red for removals, blue for the rest', () => {
        assert.equal(L.actionTone('PROVISION_ACCOUNT'), 'ok');
        assert.equal(L.actionTone('INSERT_PROSPECTUS'), 'ok');
        assert.equal(L.actionTone('UPDATE_UNIVERSITY_STUDENT'), 'waiting');
        assert.equal(L.actionTone('DELETE_FACULTY_STAFF'), 'bad');
        assert.equal(L.actionTone('COPY_PROSPECTUS'), 'info');
        assert.equal(L.actionTone(null), 'info');
    });

    test('initials: first and last name, ignoring the role in brackets', () => {
        assert.equal(L.initials('Juan Dela Cruz (Student)'), 'JC');
        assert.equal(L.initials('Madonna'), 'M');
        assert.equal(L.initials('Removed account (Student)'), 'RA');
        assert.equal(L.initials('  '), '?');
        assert.equal(L.initials(null), '?');
    });

    test('splitPerson separates the name from the role', () => {
        assert.deepEqual(L.splitPerson('System Admin (Administrator)'), { name: 'System Admin', role: 'Administrator' });
        assert.deepEqual(L.splitPerson('System (automatic)'), { name: 'System', role: 'automatic' });
        assert.deepEqual(L.splitPerson('Registrar'), { name: 'Registrar', role: '' });
    });
});

describe('the chart you can click: per-day detail, the sentence under it, and the scale', () => {
    const noon = (y, m, d, h = 12) => new Date(y, m - 1, d, h).toISOString();
    const now = new Date(2026, 9, 28, 15).getTime();

    test('each day carries its date, what was done that day, and its exact start and end', () => {
        const rows = [
            { created_at: noon(2026, 10, 28), action: 'UPDATE_UNIVERSITY_STUDENT' },
            { created_at: noon(2026, 10, 28), action: 'UPDATE_PROSPECTUS' },
            { created_at: noon(2026, 10, 28), action: 'INSERT_PROSPECTUS' },
            { created_at: noon(2026, 10, 27), action: 'DELETE_FACULTY_STAFF' },
        ];
        const days = L.perDay(rows, now, 7);
        const today = days[6];
        assert.equal(today.dayNumber, 28);
        assert.equal(today.full, 'Wed, Oct 28');
        assert.deepEqual(today.kinds, { Changed: 2, Added: 1 });
        assert.deepEqual(days[5].kinds, { Deleted: 1 });
        // The range is one calendar day: it contains a noon row and ends at the next midnight.
        assert.ok(Date.parse(today.startIso) < Date.parse(noon(2026, 10, 28)));
        assert.ok(Date.parse(noon(2026, 10, 28)) < Date.parse(today.endIso));
        assert.equal(Date.parse(today.endIso), new Date(2026, 9, 29).getTime());
        assert.equal(Date.parse(today.startIso), new Date(2026, 9, 28).getTime());
    });

    test('a row just before midnight belongs to that day, one just after belongs to the next', () => {
        const rows = [
            { created_at: noon(2026, 10, 27, 23), action: 'INSERT_X' },
            { created_at: noon(2026, 10, 28, 0),  action: 'INSERT_X' },
        ];
        const days = L.perDay(rows, now, 7);
        assert.equal(days[5].count, 1);
        assert.equal(days[6].count, 1);
    });

    test('dayNote says what happened on the picked day, most common first', () => {
        const rows = [
            ...Array.from({ length: 30 }, () => ({ created_at: noon(2026, 10, 28), action: 'UPDATE_STUDENT' })),
            ...Array.from({ length: 2 }, () => ({ created_at: noon(2026, 10, 28), action: 'INSERT_STUDENT' })),
            { created_at: noon(2026, 10, 28), action: 'DELETE_STUDENT' },
        ];
        const today = L.perDay(rows, now, 7)[6];
        assert.equal(L.dayNote(today), 'Wed, Oct 28: 33 changes (30 changed, 2 added, 1 deleted).');
    });

    test('dayNote: one change reads "1 change", an empty day says so, nothing picked says nothing', () => {
        const one = L.perDay([{ created_at: noon(2026, 10, 28), action: 'UPDATE_STUDENT' }], now, 7)[6];
        assert.equal(L.dayNote(one), 'Wed, Oct 28: 1 change (1 changed).');
        assert.equal(L.dayNote(L.perDay([], now, 7)[5]), 'No changes on Tue, Oct 27.');
        assert.equal(L.dayNote(null), '');
    });

    test('axisMax: a tidy top and whole-number steps', () => {
        assert.deepEqual(L.axisMax(33), { max: 40, step: 10, ticks: [0, 10, 20, 30, 40] });
        assert.deepEqual(L.axisMax(3),  { max: 3,  step: 1,  ticks: [0, 1, 2, 3] });
        assert.deepEqual(L.axisMax(1),  { max: 1,  step: 1,  ticks: [0, 1] });
        assert.deepEqual(L.axisMax(0),  { max: 1,  step: 1,  ticks: [0, 1] });
        assert.deepEqual(L.axisMax(7),  { max: 8,  step: 2,  ticks: [0, 2, 4, 6, 8] });
        assert.deepEqual(L.axisMax(100), { max: 100, step: 20, ticks: [0, 20, 40, 60, 80, 100] });
    });

    test('axisMax: the top is never below the highest bar and there are never more than 5 steps', () => {
        for (const n of [1, 2, 5, 6, 9, 11, 17, 33, 48, 99, 101, 250, 999, 4321, 5000]) {
            const a = L.axisMax(n);
            assert.ok(a.max >= n, `max ${a.max} < ${n}`);
            assert.ok(a.ticks.length - 1 <= 5, `${a.ticks.length - 1} steps for ${n}`);
            assert.ok(a.ticks.every(Number.isInteger), `non-integer tick for ${n}`);
        }
    });
});

describe('changeSummary: the one short line in the Activity table', () => {
    test('an update with one field reads as that field alone', () => {
        const row = { action: 'UPDATE_UNIVERSITY_STUDENT', old_values: { is_approved: false }, new_values: { is_approved: true } };
        const s = L.changeSummary(L.changesOf(row));
        assert.equal(s.text, 'is_approved: false → true');
        assert.equal(s.total, 1);
    });

    test('several fields: the first one, then how many more', () => {
        const row = { action: 'UPDATE_X', old_values: { a: 1, b: 2, c: 3 }, new_values: { a: 9, b: 8, c: 7 } };
        const s = L.changeSummary(L.changesOf(row));
        assert.match(s.text, /^[abc]: \d → \d \+2 more$/);
        assert.equal(s.total, 3);
    });

    test('a whole removed row counts every field, including the ones the table cuts off', () => {
        const old = {};
        for (let i = 1; i <= 21; i++) old['field_' + i] = 'v' + i;
        const c = L.changesOf({ action: 'DELETE_UNIVERSITY_STUDENT', old_values: old, new_values: null });
        const s = L.changeSummary(c);
        assert.equal(s.total, 21);
        assert.match(s.text, /\+20 more$/);
    });

    test('private values stay masked in the summary', () => {
        const c = L.changesOf({ action: 'INSERT_X', old_values: null, new_values: { password_hash: 'secret-value' } });
        const s = L.changeSummary(c);
        assert.ok(!s.text.includes('secret-value'));
        assert.ok(s.text.includes('••••'));
    });

    test('nothing recorded gives an empty line', () => {
        assert.deepEqual(L.changeSummary({ fields: [], more: 0 }), { text: '', total: 0 });
        assert.deepEqual(L.changeSummary(null), { text: '', total: 0 });
    });
});

describe('the User status page', () => {
    // The same rule the Admin pages use for what state an account is in (shared/js/accounts/accountstop.js).
    const A = require('../shared/js/accounts/accountstop.js');
    const stopped = new Set(['faculty:f2']);
    const stateOf = (role, row) => A.accountState(role, row, stopped);

    const students = [
        { id: 's1', first_name: 'Athena', last_name: 'Po',   student_id: '24001187', email: 'athena@x.com', program_id: 7, is_approved: true,  approval_status: 'approved', created_at: '2026-09-23' },
        { id: 's2', first_name: 'Ben',    last_name: 'Cruz', student_id: '24001188', email: 'ben@x.com',    program_id: 7, is_approved: false, approval_status: 'pending',  created_at: '2026-10-20' },
        { id: 's3', first_name: 'Cara',   last_name: 'Diaz', student_id: '24001189', email: 'cara@x.com',   program_id: 7, is_approved: false, approval_status: 'declined', created_at: '2026-10-21' },
        { id: 's4', first_name: 'Dan',    last_name: 'Eve',  student_id: '24001190', email: 'dan@x.com',    program_id: 7, is_approved: false, approval_status: 'approved', created_at: '2026-09-01' },
    ];
    const staff = [
        { id: 'f1', role: 'faculty',    first_name: 'Jay',  last_name: 'Darga', employee_id: 'EMP-00003', email: 'jay@x.com',  program_id: 7, is_approved: true },
        { id: 'f2', role: 'faculty',    first_name: 'Ann',  last_name: 'Lee',   employee_id: 'EMP-00004', email: 'ann@x.com',  program_id: 7, is_approved: false },
        { id: 'r1', role: 'registrar',  first_name: 'Carl', last_name: 'Gralo', employee_id: 'EMP-00002', email: 'carl@x.com', program_id: 7, is_approved: true },
        { id: 'd1', role: 'department', first_name: 'Cris', last_name: 'Dizz',  employee_id: 'EMP-00001', email: 'dept@x.com', program_id: 7, is_approved: true },
        { id: 'a1', role: 'admin',      first_name: 'Not',  last_name: 'Listed', is_approved: true },
    ];
    const NOW = Date.parse('2026-11-02T12:00:00Z');
    const signIns = new Map([
        ['student:s1', '2026-11-02T10:00:00+00'],     // 2 hours ago
        ['faculty:f1', '2026-11-01T12:00:00+00'],     // a day ago
        ['registrar:r1', '2026-10-01T12:00:00+00'],
    ]);
    const rows = L.buildUsers({ students, staff, signIns, stateOf });

    test('one row per student and per staff member of the four kinds; anything else is left out', () => {
        assert.equal(rows.length, 8);
        assert.ok(!rows.some(r => r.name === 'Not Listed'));
    });

    test('each row carries the right name, ID, state and sign-in time', () => {
        const by = (key) => rows.find(r => r.key === key);
        assert.equal(by('student:s1').name, 'Athena Po');
        assert.equal(by('student:s1').ident, '24001187');
        assert.equal(by('student:s1').state, 'active');
        assert.equal(by('student:s2').state, 'pending');
        assert.equal(by('student:s3').state, 'declined');
        assert.equal(by('student:s4').state, 'stopped');            // approved on paper, access off
        assert.equal(by('faculty:f2').state, 'stopped');            // the log says so
        assert.equal(by('faculty:f1').ident, 'EMP-00003');
        assert.equal(by('student:s1').lastSignIn, Date.parse('2026-11-02T10:00:00Z'));
        assert.equal(by('student:s2').lastSignIn, null);
    });

    test('newest sign-in first, then those who never signed in, by kind then name', () => {
        assert.deepEqual(rows.slice(0, 3).map(r => r.key), ['student:s1', 'faculty:f1', 'registrar:r1']);
        assert.ok(rows.slice(3).every(r => r.lastSignIn === null));
        const never = rows.slice(3).map(r => r.key);
        assert.equal(never[0].startsWith('student:'), true);      // students before staff
    });

    test('statusCounts adds up per kind and in total', () => {
        const c = L.statusCounts(rows);
        assert.deepEqual(c.student, { active: 1, stopped: 1, pending: 1, declined: 1, total: 4 });
        assert.deepEqual(c.faculty, { active: 1, stopped: 1, pending: 0, declined: 0, total: 2 });
        assert.deepEqual(c.registrar, { active: 1, stopped: 0, pending: 0, declined: 0, total: 1 });
        assert.deepEqual(c.all, { active: 4, stopped: 2, pending: 1, declined: 1, total: 8 });
        assert.deepEqual(L.statusCounts([]).all, { active: 0, stopped: 0, pending: 0, declined: 0, total: 0 });
    });

    test('filterUsers by kind, by state and by words in the name, ID or email', () => {
        assert.equal(L.filterUsers(rows, { role: 'faculty' }).length, 2);
        assert.equal(L.filterUsers(rows, { state: 'stopped' }).length, 2);
        assert.equal(L.filterUsers(rows, { role: 'student', state: 'stopped' }).length, 1);
        assert.deepEqual(L.filterUsers(rows, { term: 'athena po' }).map(r => r.key), ['student:s1']);
        assert.deepEqual(L.filterUsers(rows, { term: '24001188' }).map(r => r.key), ['student:s2']);
        assert.deepEqual(L.filterUsers(rows, { term: 'DEPT@X' }).map(r => r.key), ['department:d1']);
        assert.equal(L.filterUsers(rows, { term: 'zzz' }).length, 0);
        assert.equal(L.filterUsers(rows, {}).length, 8);
    });

    test('signInText: a time, or "Never signed in"', () => {
        assert.deepEqual(L.signInText(null, NOW), { text: 'Never signed in', never: true });
        assert.deepEqual(L.signInText(undefined, NOW), { text: 'Never signed in', never: true });
        assert.deepEqual(L.signInText(Date.parse('2026-11-02T10:00:00Z'), NOW), { text: '2 hours ago', never: false });
        assert.deepEqual(L.signInText(Date.parse('2026-10-30T12:00:00Z'), NOW), { text: '3 days ago', never: false });
    });
});

describe('pressing a role card, a status pill or the Active accounts tile', () => {
    test('pressing something new makes it the filter', () => {
        assert.deepEqual(L.toggleUserFilter({ role: '', state: '' }, { role: 'student', state: '' }), { role: 'student', state: '' });
        assert.deepEqual(L.toggleUserFilter({ role: 'student', state: '' }, { role: 'faculty', state: '' }), { role: 'faculty', state: '' });
        assert.deepEqual(L.toggleUserFilter({ role: '', state: '' }, { role: '', state: 'active' }), { role: '', state: 'active' });
    });

    test('a pill adds a status to the kind; the card itself still means every status of that kind', () => {
        assert.deepEqual(L.toggleUserFilter({ role: 'faculty', state: '' }, { role: 'faculty', state: 'stopped' }), { role: 'faculty', state: 'stopped' });
        assert.deepEqual(L.toggleUserFilter({ role: 'faculty', state: 'stopped' }, { role: 'faculty', state: '' }), { role: 'faculty', state: '' });
    });

    test('pressing the same thing twice goes back to everything', () => {
        assert.deepEqual(L.toggleUserFilter({ role: 'student', state: '' }, { role: 'student', state: '' }), { role: '', state: '' });
        assert.deepEqual(L.toggleUserFilter({ role: 'faculty', state: 'stopped' }, { role: 'faculty', state: 'stopped' }), { role: '', state: '' });
        assert.deepEqual(L.toggleUserFilter({ role: '', state: 'active' }, { role: '', state: 'active' }), { role: '', state: '' });
    });

    test('missing values count as "any"', () => {
        assert.deepEqual(L.toggleUserFilter(null, { role: 'registrar' }), { role: 'registrar', state: '' });
        assert.deepEqual(L.toggleUserFilter(undefined, undefined), { role: '', state: '' });
    });

    test('the sentence says what is showing, with singular and plural', () => {
        assert.equal(L.userFilterNote({ role: 'student', state: '' }, 26, 41), 'Showing 26 Student accounts (of 41).');
        assert.equal(L.userFilterNote({ role: '', state: 'active' }, 41, 41), 'Showing 41 active accounts (of 41).');
        assert.equal(L.userFilterNote({ role: 'faculty', state: 'stopped' }, 1, 41), 'Showing 1 stopped Faculty account (of 41).');
        assert.equal(L.userFilterNote({ role: '', state: '' }, 41, 41), '');
        assert.equal(L.userFilterNote(null, 5, 5), '');
    });
});
