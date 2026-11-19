// analytics.test.mjs
// Academic Analytics (shared/js/reports/analytics.js): hardest subjects, units earned, request funnel, section demand.
//   node --test tests/analytics.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const AN = require('../shared/js/reports/analytics.js');
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const at = new Date('2026-11-19T00:00:00Z');

const rec = (student_id, code, status, units = 3) => ({ student_id, subject_id: code, code, title: code + ' title', status, units });
const students = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
const records = [
    rec('a', 'MATH', 'FAILED'), rec('b', 'MATH', 'FAILED'), rec('c', 'MATH', 'PASSED'), rec('d', 'MATH', 'PASSED'),   // 50% fail
    rec('a', 'PROG', 'FAILED'), rec('a', 'PROG', 'PASSED'),                                                          // failed then passed: passed
    rec('b', 'PROG', 'PASSED'),
    rec('a', 'ENG', 'FAILED'),                                                                                       // 100% (1 of 1)
    rec('c', 'ART', 'ENROLLED'), rec('c', 'PE', 'DROPPED'),                                                         // not outcomes
    rec('zz', 'MATH', 'FAILED'),                                                                                     // not this programme
];
const requests = [
    { student_id: 'a', status: 'approved' }, { student_id: 'b', status: 'partially_approved' }, { student_id: 'c', status: 'rejected' },
    { student_id: 'd', status: 'withdrawn' }, { student_id: 'a', status: 'submitted' }, { student_id: 'zz', status: 'approved' },
];
const demand = [
    { section: 'BSIT-1A', subject_code: 'X', capacity: 40, selected: 45, reported_full: 3 },
    { section: 'BSIT-1A', subject_code: 'Y', capacity: 40, selected: 30, reported_full: 1 },
    { section: 'BSIT-2A', subject_code: 'Z', capacity: 40, selected: 10 },
    { section: 'BSIT-3A', subject_code: 'Q', capacity: 0, selected: 5 },
];
const a = AN.build({ students, records, requests }, demand, { programName: 'BSIT', generatedAt: at });

describe('hardest subjects', () => {
    test('fail rate counts each student once per subject', () => {
        const by = Object.fromEntries(a.hardest.top.map((s) => [s.code, s]));
        assert.equal(by.MATH.failRate, 50);                       // 2 failed, 2 passed ("zz" is not this programme)
        assert.equal(by.MATH.passed, 2);
        assert.equal(by.MATH.failed, 2);
    });
    test('a student who failed and later passed counts as passed', () => {
        assert.ok(!a.hardest.top.some((s) => s.code === 'PROG'));   // a passed it after failing, b passed: no fails
    });
    test('only subjects with a fail are listed, worst first', () => {
        assert.deepEqual(a.hardest.top.map((s) => s.code), ['ENG', 'MATH']);
        assert.equal(a.hardest.top[0].failRate, 100);
    });
    test('dropped and still-enrolled records are not outcomes', () => {
        assert.ok(!a.hardest.top.some((s) => s.code === 'ART' || s.code === 'PE'));
    });
    test('topN limits the list but the total stays', () => {
        const one = AN.build({ students, records, requests }, [], { topN: 1 });
        assert.equal(one.hardest.top.length, 1);
        assert.equal(one.hardest.total, 2);
    });
    test('no fails at all gives an honest empty state', () => {
        const none = AN.build({ students, records: [rec('a', 'MATH', 'PASSED')], requests: [] }, []);
        assert.equal(none.hardest.top.length, 0);
        assert.match(AN.screen(none), /No subject has a failed grade/);
    });
});

describe('units earned', () => {
    test('each student sits in one band, passed subjects counted once', () => {
        const rs = [rec('a', 'A', 'PASSED', 60), rec('a', 'A', 'PASSED', 60), rec('b', 'B', 'PASSED', 150), rec('c', 'C', 'PASSED', 20)];
        const x = AN.build({ students, records: rs, requests: [] }, []);
        const by = Object.fromEntries(x.units.map((u) => [u.label, u.count]));
        assert.equal(by['50 to 74'], 1);          // a: 60, not 120
        assert.equal(by['150 and over'], 1);
        assert.equal(by['Under 25'], 2);          // c and d
        assert.equal(x.units.reduce((t, u) => t + u.count, 0), 4);
    });
});

describe('request funnel', () => {
    test('counts this programme only; the approval rate is of decided requests', () => {
        const f = a.funnel;
        assert.equal(f.sent, 5);
        assert.equal(f.waiting, 1);
        assert.equal(f.decided, 3);                // approved + partly + rejected; withdrawn is not a decision
        assert.equal(f.approvalRate, 67);          // 2 of 3
    });
    test('nothing decided: no rate, not 0 or NaN', () => {
        const x = AN.build({ students, records: [], requests: [{ student_id: 'a', status: 'submitted' }] }, []);
        assert.equal(x.funnel.approvalRate, null);
        assert.doesNotMatch(AN.html(x), /NaN/);
    });
    test('unreadable requests are said so', () => {
        const x = AN.build({ students, records: [], requests: [], requestsUnreadable: true }, []);
        assert.match(AN.screen(x), /cannot be read/);
        assert.match(AN.html(x), /could not be read/);
    });
});

describe('section demand (approved students, db/125)', () => {
    // BSIT-1A: 30 approved students, 5 of them irregular there; 2 reported a subject full. BSIT-2A: 12. BSIT-3A: nobody. Overall: 40 students,
    // 3 of whom are in more than one section.
    const totals = [
        { section: 'BSIT-1A', students: 30, partial: 5, reported_full: 2 },
        { section: 'BSIT-2A', students: 12, partial: 0, reported_full: 0 },
        { section: null, students: 40, partial: 3, reported_full: 2 },
    ];
    const d = AN.build({ students, records, requests }, demand, { totals });
    const by = Object.fromEntries(d.demand.sections.map((x) => [x.section, x]));

    test('each section shows its approved students, the busiest first', () => {
        assert.deepEqual(d.demand.sections.map((x) => [x.section, x.students]), [['BSIT-1A', 30], ['BSIT-2A', 12], ['BSIT-3A', 0]]);
    });
    test('a section nobody was approved into still shows, with 0', () => {
        assert.equal(by['BSIT-3A'].students, 0);
        assert.equal(by['BSIT-3A'].reportedFull, 0);
    });
    test('irregular students: the section says how many of its students take only some of its subjects', () => {
        assert.equal(by['BSIT-1A'].partial, 5);
        const screen = AN.screen(d);
        assert.ok(screen.includes('5 of 30 take only some of its subjects'));
        assert.ok(!screen.includes('0 of 12 take only some'));              // no note when nobody is irregular
        assert.ok(AN.rows(d).some((r) => r[0] === 'BSIT-1A' && r[1] === 30 && r[2] === 5));
    });
    test('the overall line counts each student once and says how many appear in several sections', () => {
        assert.deepEqual(d.demand.overall, { students: 40, multiSection: 3, reportedFull: 2 });
        assert.ok(AN.screen(d).includes('40 students approved in total, each counted once. 3 take subjects from more than one section'));
        assert.ok(AN.html(d).includes('3 take subjects from more than one section'));
        const rows = AN.rows(d);
        assert.ok(rows.some((r) => r[0] === 'Approved students in total (each once)' && r[1] === 40));
        assert.ok(rows.some((r) => r[0] === 'Of them in more than one section' && r[1] === 3));
    });
    test('the overall line says nothing about several sections when there is none', () => {
        const x = AN.build({ students, records, requests }, demand, { totals: [{ section: 'BSIT-1A', students: 1, partial: 0, reported_full: 0 }, { section: null, students: 1, partial: 0, reported_full: 0 }] });
        assert.ok(AN.screen(x).includes('1 student approved in total, each counted once.'));
        assert.ok(!AN.screen(x).includes('more than one section'));
    });
    test('students who reported a section full at the EDP office are shown per section', () => {
        assert.equal(by['BSIT-1A'].reportedFull, 2);
        assert.ok(AN.screen(d).includes('Reported full at EDP'));
        assert.ok(AN.rows(d).some((r) => r[0] === 'BSIT-1A' && r[3] === 2));
    });
    test('the old capacity and "fullest subject" columns are gone: this table is about students', () => {
        const screen = AN.screen(d);
        assert.ok(!screen.includes('Fullest subject'));
        assert.ok(!screen.includes('over capacity'));
        assert.ok(!screen.includes('Choices'));
    });
    test('a section that totals mention but the schedule does not is still listed', () => {
        const x = AN.build({ students, records, requests }, [], { totals: [{ section: 'Z-9', students: 4, partial: 0, reported_full: 0 }] });
        assert.deepEqual(x.demand.sections.map((s) => [s.section, s.students]), [['Z-9', 4]]);
    });
    test('totals that could not be read: say so, never show numbers from another rule', () => {
        const x = AN.build({ students, records, requests }, demand);       // no totals
        assert.equal(x.demand.readable, false);
        assert.ok(AN.screen(x).includes('Section demand could not be loaded.'));
        assert.ok(AN.html(x).includes('Section demand could not be loaded.'));
        assert.ok(AN.rows(x).some((r) => r[0] === 'Not available'));
    });
    test('sections are ordered by students, ties by name', () => {
        const x = AN.build({ students, records, requests }, [{ section: 'B' }, { section: 'A' }, { section: 'C' }],
            { totals: [{ section: 'A', students: 1, partial: 0, reported_full: 0 }, { section: 'B', students: 5, partial: 0, reported_full: 0 }, { section: 'C', students: 1, partial: 0, reported_full: 0 }] });
        assert.deepEqual(x.demand.sections.map((s) => s.section), ['B', 'A', 'C']);
    });
    test('loadTotals asks section_demand_totals and survives an error', async () => {
        let asked = null;
        const ok = { rpc: async (n, p) => { asked = [n, p]; return { data: [{ section: 'S', students: 2, partial: 0, reported_full: 0 }], error: null }; } };
        assert.deepEqual(await AN.loadTotals(ok, { year: 2024, term: 2 }), [{ section: 'S', students: 2, partial: 0, reported_full: 0 }]);
        assert.deepEqual(asked, ['section_demand_totals', { p_year: 2024, p_term: 2 }]);
        assert.equal(await AN.loadTotals({ rpc: async () => ({ data: null, error: { message: 'x' } }) }, { year: 2024, term: 2 }), null);
        assert.equal(await AN.loadTotals(ok, {}), null);
    });
    test('no section scheduled this term: an empty state', () => {
        const none = AN.build({ students, records, requests }, [], { totals: [] });
        assert.equal(none.demand.any, false);
        assert.ok(AN.screen(none).includes('No section is scheduled this term yet.'));
    });
});

describe('page and files', () => {
    test('names are escaped in the printed page and on screen', () => {
        const x = AN.build({ students, records: [{ ...rec('a', 'X', 'FAILED'), title: '<img src=x>' }], requests: [] }, []);
        assert.doesNotMatch(AN.html(x), /<img src=x>/);
        assert.doesNotMatch(AN.screen(x), /<img src=x>/);
    });
    test('rows hold every part', () => {
        const rows = AN.rows(a);
        for (const h of ['Hardest subjects', 'Units earned', 'Request funnel', 'Section demand (this term, approved students)']) assert.ok(rows.some((r) => r[0] === h), h);
    });
    test('loadDemand asks for the term and survives an error', async () => {
        let asked = null;
        const ok = { rpc: async (n, p) => { asked = [n, p]; return { data: [{ section: 'S' }], error: null }; } };
        assert.deepEqual(await AN.loadDemand(ok, { year: 2024, term: 2 }), [{ section: 'S' }]);
        assert.deepEqual(asked, ['section_demand', { p_year: 2024, p_term: 2 }]);
        assert.deepEqual(await AN.loadDemand({ rpc: async () => ({ data: null, error: { message: 'x' } }) }, { year: 2024, term: 2 }), []);
        assert.deepEqual(await AN.loadDemand(ok, {}), []);
    });
    test('the Department Reports tab shows it', () => {
        const h = read('features/department/departmentdashboard.html');
        const j = read('features/department/departmentdashboard.js');
        assert.match(h, /programreport\.js"><\/script>\s*<script src="\.\.\/\.\.\/shared\/js\/reports\/analytics\.js"><\/script>/);
        assert.match(h, /id="report-analytics-body"/);
        assert.ok(j.includes('Analytics.build(raw, demand, { programName: name, totals })'));
        assert.ok(j.includes('Analytics.loadTotals(supabase,'));
    });
});

describe('db/125 section_demand_totals', () => {
    const sql = read('db/125_section_totals_approved_irregular.sql');
    test('approved plans and approved subjects only: a plan waiting for the adviser is not counted', () => {
        assert.ok(sql.includes("where r.status in ('approved', 'partially_approved')"));
        assert.ok(sql.includes("and ri.status = 'approved'"));
        assert.ok(!sql.includes("'submitted'"));
    });
    test('a student counts once per section, and the EDP turn-aways (full, time clash) do not seat them', () => {
        assert.ok(sql.includes('count(distinct sc.subject_id) filter ('));
        assert.ok(sql.includes("ri.edp_result = 'rejected' and ri.edp_reason in ('full', 'conflict')"));
        assert.ok(sql.includes('group by sc.section, r.student_id'));
    });
    test('irregular students are the ones with fewer subjects than the section offers; the overall row has section null', () => {
        assert.ok(sql.includes('seat.taken < size.n'));
        assert.ok(sql.includes('select null::text,'));
        assert.ok(sql.includes('having count(*) > 1'));
    });
    test('own programme only, signed-in staff only, read-only', () => {
        assert.ok(sql.includes('public.department_covers_program(p.program_id)'));
        assert.ok(sql.includes('revoke all on function public.section_demand_totals(integer, integer) from public, anon, authenticated, service_role;'));
        assert.ok(!/\b(insert|update|delete)\b/i.test(sql.replace(/--.*$/gm, '')));
    });
});

describe('db/126: an EDP result that is NULL means "not turned away"', () => {
    const fix = read('db/126_section_demand_null_edp_fix.sql');
    const code = (s) => s.replace(/--.*$/gm, '');
    test('both functions treat an unknown result as false, so students with no EDP report are counted', () => {
        assert.ok(fix.includes("coalesce(ri.edp_result = 'rejected' and ri.edp_reason in ('full', 'conflict'), false) as turned_down"));
        assert.ok(fix.includes("where not coalesce(ri.edp_result = 'rejected' and ri.edp_reason in ('full', 'conflict'), false)) as taken"));
    });
    test('no "not (... = ...)" on the nullable EDP columns is left in the live definitions', () => {
        // the faulty shape: negating a comparison on edp_result without coalesce
        assert.ok(!/where not \(ri\.edp_result/.test(code(fix)));
        assert.ok(!/where not pk\.turned_down\)?\s*\)?\s*as turned/.test(code(fix)));
    });
    test('it only replaces the two functions: same columns, no new tables', () => {
        assert.ok(fix.includes('create or replace function public.section_demand(p_year integer, p_term integer)'));
        assert.ok(fix.includes('create or replace function public.section_demand_totals(p_year integer, p_term integer)'));
        assert.ok(!/\bcreate table\b|\balter table\b|\bdrop function\b/i.test(code(fix)));
    });
});
