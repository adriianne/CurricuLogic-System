// reportexportlog.test.mjs
// Every report print or export is recorded in the audit log (db/122, log_report_export): who, which report, which format.
//   node --test tests/reportexportlog.test.mjs

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const RF = require('../shared/js/reports/reportfile.js');
const SR = require('../shared/js/reports/studentreport.js');
const PR = require('../shared/js/reports/programreport.js');
const AN = require('../shared/js/reports/analytics.js');
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

globalThis.ReportFile = RF;
globalThis.window = { open: () => null };      // the print window is "blocked": the log must already be written
globalThis.alert = () => {};

function fakeClient(result = { error: null }) {
    const calls = [];
    return { calls, rpc: async (name, args) => { calls.push([name, args]); return result; } };
}

describe('ReportFile.logExport', () => {
    beforeEach(() => RF.setClient(null));
    test('calls log_report_export with the report, format, target and row count', async () => {
        const c = fakeClient();
        RF.setClient(c);
        assert.equal(await RF.logExport('student_report', 'csv', '24001188', 40), true);
        assert.deepEqual(c.calls, [['log_report_export', { p_report: 'student_report', p_format: 'csv', p_target: '24001188', p_rows: 40 }]]);
    });
    test('target and rows are optional', async () => {
        const c = fakeClient();
        RF.setClient(c);
        await RF.logExport('analytics', 'print');
        assert.deepEqual(c.calls[0][1], { p_report: 'analytics', p_format: 'print', p_target: null, p_rows: null });
    });
    test('without a client nothing is called and nothing throws', async () => {
        assert.equal(await RF.logExport('analytics', 'csv'), false);
    });
    test('a refused or failed log never throws: the person already has the report', async () => {
        RF.setClient(fakeClient({ error: { message: 'You cannot export this report.' } }));
        assert.equal(await RF.logExport('analytics', 'csv'), false);
        RF.setClient({ rpc: async () => { throw new Error('network'); } });
        assert.equal(await RF.logExport('analytics', 'csv'), false);
    });
});

// A stand-in for the button bar: pressing a button runs the click handler the module installed.
function press(mount, getReport, kind) {
    const el = { innerHTML: '' };
    mount(el, getReport);
    el.onclick({ target: { closest: () => ({ dataset: { rep: kind } }) } });
}

describe('each report logs when a button is pressed', () => {
    beforeEach(() => RF.setClient(null));
    const student = SR.build({ student: { first_name: 'A', last_name: 'B', student_id: '24001188' }, records: [] });
    const program = PR.build({ students: [], records: [], prospectuses: [] }, { programName: 'BSIT' });
    const analytics = AN.build({ students: [], records: [], requests: [] }, [], { programName: 'BSIT' });

    test('student report: the student\'s ID is the target, never the name', async () => {
        const c = fakeClient();
        RF.setClient(c);
        press(SR.mount, () => student, 'print');
        await new Promise((r) => setTimeout(r, 5));
        assert.deepEqual(c.calls[0], ['log_report_export', { p_report: 'student_report', p_format: 'print', p_target: '24001188', p_rows: null }]);
        assert.ok(!JSON.stringify(c.calls).includes('A B'));
    });
    test('programme report', async () => {
        const c = fakeClient();
        RF.setClient(c);
        press(PR.mount, () => program, 'print');
        await new Promise((r) => setTimeout(r, 5));
        assert.equal(c.calls[0][1].p_report, 'program_report');
        assert.equal(c.calls[0][1].p_format, 'print');
    });
    test('analytics', async () => {
        const c = fakeClient();
        RF.setClient(c);
        press(AN.mount, () => analytics, 'print');
        await new Promise((r) => setTimeout(r, 5));
        assert.equal(c.calls[0][1].p_report, 'analytics');
    });
    test('a file export logs its format and how many rows it holds', async () => {
        const c = fakeClient();
        RF.setClient(c);
        const real = RF.download;
        RF.download = () => {};                       // no browser here
        try { press(PR.mount, () => program, 'csv'); } finally { RF.download = real; }
        await new Promise((r) => setTimeout(r, 5));
        assert.equal(c.calls[0][1].p_format, 'csv');
        assert.ok(c.calls[0][1].p_rows > 10);
    });
    test('no report built yet (still loading): nothing is logged', async () => {
        const c = fakeClient();
        RF.setClient(c);
        press(PR.mount, () => null, 'print');
        await new Promise((r) => setTimeout(r, 5));
        assert.equal(c.calls.length, 0);
    });
});

describe('the migration and the pages', () => {
    const sql = read('db/122_report_export_log.sql');
    test('only staff, only their own reports, only known formats', () => {
        assert.match(sql, /p_format not in \('print', 'xlsx', 'csv', 'file'\)/);
        assert.match(sql, /p_report = 'student_report' and v_role in \('faculty_staff', 'registrar_staff'\)/);
        assert.match(sql, /p_report = 'program_report' and v_role in \('department_staff', 'registrar_staff'\)/);
        assert.match(sql, /p_report = 'analytics'\s+and v_role = 'department_staff'/);
        assert.match(sql, /p_report in \('system_logs', 'backup'\) and v_role = 'system_administrator'/);
    });
    test('it is closed to the public and to anonymous callers', () => {
        assert.match(sql, /revoke all on function public\.log_report_export\(text, text, text, integer\) from public, anon;/);
        assert.match(sql, /grant execute on function public\.log_report_export\(text, text, text, integer\) to authenticated;/);
    });
    test('it stores the report and format, never content or names', () => {
        assert.match(sql, /jsonb_build_object\('report', p_report, 'format', p_format, 'rows', p_rows\)/);
        assert.doesNotMatch(sql, /first_name|last_name|email/);
    });
    test('the three staff pages hand the signed-in client to ReportFile', () => {
        for (const f of ['department', 'registrar', 'faculty']) {
            assert.match(read(`features/${f}/${f}dashboard.js`), /window\.ReportFile\?\.setClient\(supabase\);/);
        }
    });
});
