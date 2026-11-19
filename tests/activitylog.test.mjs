// activitylog.test.mjs
// System logs > Activity: filter choices, safe search text, the one-line summary, export rows, and the page wiring.
//   node --test tests/activitylog.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SL = require('../shared/js/records/systemlogs.js');
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const NOW = Date.parse('2026-11-19T10:00:00Z');

describe('activitySpec', () => {
    test('no choices: no action or role filter, the last 7 days', () => {
        const s = SL.activitySpec({}, NOW);
        assert.deepEqual(s, { prefixes: null, roles: null, since: '2026-11-12T10:00:00', term: '' });
    });
    test('an action group is a set of code prefixes', () => {
        assert.deepEqual(SL.activitySpec({ group: 'REPORTS' }, NOW).prefixes, ['EXPORT_REPORT', 'BACKUP']);
        assert.deepEqual(SL.activitySpec({ group: 'UPDATE' }, NOW).prefixes, ['UPDATE']);
    });
    test('a role covers the older short forms stored in old rows', () => {
        assert.deepEqual(SL.activitySpec({ role: 'registrar' }, NOW).roles, ['registrar_staff', 'registrar']);
        assert.deepEqual(SL.activitySpec({ role: 'faculty' }, NOW).roles, ['faculty_staff', 'faculty']);
        assert.deepEqual(SL.activitySpec({ role: 'administrator' }, NOW).roles, ['system_administrator']);
    });
    test('the time range counts back from now, in UTC with no zone (audit_log has none); all time has no limit', () => {
        assert.equal(SL.activitySpec({ range: '24h' }, NOW).since, '2026-11-18T10:00:00');
        assert.equal(SL.activitySpec({ range: '30d' }, NOW).since, '2026-10-20T10:00:00');
        assert.equal(SL.activitySpec({ range: 'all' }, NOW).since, null);
    });
    test('an unknown choice means no filter, so a stale selection never hides everything', () => {
        const s = SL.activitySpec({ group: 'GONE', role: 'ghost', range: 'forever' }, NOW);
        assert.equal(s.prefixes, null);
        assert.equal(s.roles, null);
        assert.equal(s.since, null);
    });
    test('every group, role and range offered on the page exists here', () => {
        const html = read('features/admin/admindashboard.html');
        for (const g of SL.ACTION_GROUPS) assert.ok(html.includes(`<option value="${g.value}"`), 'group ' + g.value);
        for (const r of SL.ACTIVITY_ROLES) assert.ok(html.includes(`<option value="${r.value}"`), 'role ' + r.value);
        for (const t of SL.ACTIVITY_RANGES) assert.ok(html.includes(`<option value="${t.value}"`), 'range ' + t.value);
    });
});

describe('cleanTerm', () => {
    test('characters that carry meaning in a filter or a LIKE are dropped', () => {
        assert.equal(SL.cleanTerm("a,b(c)%*_\\\"'`;:<>d"), 'a b c d');
        assert.equal(SL.cleanTerm('x),action.eq.UPDATE,(y'), 'x action.eq.UPDATE y');          // cannot add a condition of its own
    });
    test('trimmed, collapsed and held to 60 characters', () => {
        assert.equal(SL.cleanTerm('   Pedro    Reyes  '), 'Pedro Reyes');
        assert.equal(SL.cleanTerm('x'.repeat(200)).length, 60);
        assert.equal(SL.cleanTerm(null), '');
    });
    test('a filter-breaking term cannot reach the query: no comma, bracket, quote or wildcard survives', () => {
        const nasty = 'x,actor_id.in.(1,2),"y"%*';
        assert.ok(!/[,()"%*]/.test(SL.cleanTerm(nasty)));
    });
});

describe('entrySummary', () => {
    test('a report export says what it was and how', () => {
        assert.equal(SL.entrySummary({ action: 'EXPORT_REPORT', new_values: { report: 'analytics', format: 'print' } }), 'Academic analytics · printed');
        assert.equal(SL.entrySummary({ action: 'EXPORT_REPORT', new_values: { report: 'program_report', format: 'csv', rows: 30 } }), 'Programme report · saved as CSV · 30 rows');
        assert.equal(SL.entrySummary({ action: 'EXPORT_REPORT', new_values: { report: 'backup', format: 'file', rows: 3069 } }), 'Database backup · file saved · 3069 rows');
    });
    test('the start of a backup says so', () => {
        assert.equal(SL.entrySummary({ action: 'BACKUP_DATA_READ', new_values: { tables: 32 } }), 'Database read for a backup (32 tables)');
    });
    test('any other entry shows its first change', () => {
        assert.equal(SL.entrySummary({ action: 'UPDATE_UNIVERSITY_STUDENT', old_values: { year_level: 1 }, new_values: { year_level: 2 } }), 'year_level: 1 → 2');
    });
    test('an entry with nothing recorded gives an empty line, never an error', () => {
        assert.equal(SL.entrySummary({ action: 'UPDATE_X' }), '');
        assert.equal(SL.entrySummary(null), '');
    });
});

describe('activityRows (the export)', () => {
    const entries = [
        { created_at: '2026-11-19 03:17:37.417621', actor_role: 'department_staff', action: 'EXPORT_REPORT', table_name: 'report', record_id: null, new_values: { report: 'analytics', format: 'print' } },
        { created_at: '2026-11-18 09:00:00', actor_role: 'system_administrator', action: 'UPDATE_UNIVERSITY_STUDENT', table_name: 'university_student', record_id: 'abc', old_values: { email: 'jose@uc.edu.ph', password_hash: 'secret' }, new_values: { email: 'jose2@uc.edu.ph', password_hash: 'secret2' } },
    ];
    const rows = SL.activityRows(entries, (r) => (r.actor_role === 'department_staff' ? 'Pedro Reyes (Department)' : 'System Administrator (Administrator)'));

    test('a header, then one line per entry', () => {
        assert.deepEqual(rows[0], ['When (UTC)', 'Who', 'Role', 'What happened', 'Action code', 'Area', 'Record', 'Change']);
        assert.equal(rows.length, 3);
    });
    test('the time is in UTC and says so in the header; the person is the name without the role in brackets', () => {
        assert.equal(rows[1][0], '2026-11-19 03:17:37');
        assert.equal(rows[1][1], 'Pedro Reyes');
        assert.equal(rows[1][2], 'Department');
        assert.equal(rows[1][3], 'Export report');
        assert.equal(rows[1][4], 'EXPORT_REPORT');
        assert.equal(rows[1][7], 'Academic analytics · printed');
    });
    test('private values are masked exactly as on the page: a file never shows more than the screen', () => {
        const change = rows[2][7];
        assert.ok(!change.includes('secret'));
        assert.ok(!/jose@/.test(change));
    });
    test('no entries: just the header', () => {
        assert.equal(SL.activityRows([]).length, 1);
        assert.equal(SL.activityRows(null).length, 1);
    });
    test('a spreadsheet formula in a name or a record is defused by the file writer', () => {
        const RF = require('../shared/js/reports/reportfile.js');
        const out = SL.activityRows([{ created_at: '2026-11-19 00:00:00', actor_role: 'student', action: 'UPDATE_X', table_name: 'x', record_id: '=HYPERLINK("http://evil")' }], () => '=cmd|calc (Student)');
        const csv = RF.csv(out);
        assert.ok(csv.includes("'=cmd|calc"));
        assert.ok(csv.includes("'=HYPERLINK"));
    });
});

describe('activityCount', () => {
    test('wording', () => {
        assert.equal(SL.activityCount(25, 130), '25 of 130 entries');
        assert.equal(SL.activityCount(1, 1), '1 entry');
        assert.equal(SL.activityCount(7, 7), '7 entries');
        assert.equal(SL.activityCount(0, 0), '');
    });
});

describe('the page', () => {
    const html = read('features/admin/admindashboard.html');
    const js = read('features/admin/admindashboard.js');
    test('an Activity tab with search, three filters, export and paging', () => {
        assert.ok(html.includes('data-logs-tab="activity"'));
        assert.ok(html.includes('data-logs-panel="activity"'));
        for (const id of ['logs-a-term', 'logs-a-action', 'logs-a-role', 'logs-a-range', 'logs-a-export', 'logs-a-prev', 'logs-a-next', 'logs-activity-body']) {
            assert.ok(html.includes(`id="${id}"`), id);
        }
        assert.ok(html.includes('data-export="csv"') && html.includes('data-export="xlsx"'));
    });
    test('the tab loads the log, and a typed search waits a moment before asking', () => {
        assert.match(js, /activity: loadActivity,/);
        assert.ok(js.includes('timer = setTimeout(again, 350)'));
    });
    test('the query is built only from cleaned choices, and the newest entries come first', () => {
        assert.ok(js.includes('SL.activitySpec(activityChoices())'));
        assert.ok(js.includes(".order('id', { ascending: false })"));
        assert.ok(js.includes("spec.prefixes.map((p) => `action.like.${p}*`).join(',')"));
        assert.ok(js.includes("q.in('actor_role', spec.roles)"));
    });
    test('an old answer never replaces a newer one', () => {
        assert.ok(js.includes('if (seq !== ACT.seq) return;'));
    });
    test('an export is recorded as system_logs, is capped, and uses the same masked rows', () => {
        assert.ok(js.includes("window.ReportFile.logExport('system_logs', kind, null, entries.length)"));
        assert.ok(js.includes('const ACT_EXPORT_MAX = 5000;'));
        assert.ok(js.includes('SL.activityRows(entries,'));
    });
});

describe('the query builder is never awaited before paging (found live on 19 Nov)', () => {
    const js = read('features/admin/admindashboard.js');
    test('activityQuery is a plain function that returns the builder', () => {
        assert.ok(js.includes('function activityQuery(filter, select, options) {'));
        assert.ok(!js.includes('async function activityQuery'));
    });
    test('nothing awaits activityQuery(...) itself: .range() is added to the builder, then the whole thing is awaited', () => {
        assert.ok(!js.includes('(await activityQuery('));                       // awaiting the builder itself is what broke
        assert.equal((js.match(/await activityQuery\(filter, ACT_COLUMNS, [^)]*\)\.range\(/g) || []).length, 2);
    });
    test('the people the search names are looked up first, in their own step', () => {
        assert.ok(js.includes('async function activityFilter() {'));
        assert.equal((js.match(/await activityFilter\(\)/g) || []).length, 2);
    });
});
