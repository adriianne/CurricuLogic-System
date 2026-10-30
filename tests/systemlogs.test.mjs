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
