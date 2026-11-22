// sectionsbyprogramme.test.mjs
// Section demand shows only the sections of the programme chosen at the top (22 Nov 2026): BSIT-1A never appears while BSCS is selected.
//
//   node --test tests/sectionsbyprogramme.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const A = require('../shared/js/reports/analytics.js');
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const sql = read('db/131_section_demand_by_programme.sql');
const dash = read('features/department/departmentdashboard.js');

const fakeDb = () => { const calls = []; return { calls, rpc: async (name, args) => { calls.push([name, args]); return { data: [], error: null }; } }; };

describe('db/131', () => {
    test('both functions take an optional programme, and the old two-argument forms are dropped first (they would make a two-argument call ambiguous)', () => {
        assert.ok(sql.includes('drop function if exists public.section_demand(integer, integer);'));
        assert.ok(sql.includes('drop function if exists public.section_demand_totals(integer, integer);'));
        assert.ok(sql.includes('create function public.section_demand(p_year integer, p_term integer, p_program_id integer default null)'));
        assert.ok(sql.includes('create function public.section_demand_totals(p_year integer, p_term integer, p_program_id integer default null)'));
        assert.ok(sql.indexOf('drop function if exists public.section_demand(integer, integer);') < sql.indexOf('create function public.section_demand('));
    });
    test('the filter is in both, and a null programme means every covered programme, as before', () => {
        assert.equal((sql.match(/and \(p_program_id is null or p\.program_id = p_program_id\)/g) || []).length, 2);
    });
    test('the department must still cover the programme: the old rule is kept, never replaced', () => {
        assert.equal((sql.match(/and public\.department_covers_program\(p\.program_id\)/g) || []).length, 2);
        assert.ok(sql.indexOf('department_covers_program') < sql.indexOf('p_program_id is null or'));
    });
    test('they stay security definer with a fixed search path, and the same return columns as db/126', () => {
        assert.equal((sql.match(/security definer/g) || []).length, 2);
        assert.equal((sql.match(/set search_path to 'public'/g) || []).length, 2);
        const old = read('db/126_section_demand_null_edp_fix.sql');
        for (const col of ['subject_id    integer', 'subject_code  text', 'edp_codes     text[]', 'reported_full integer']) {
            assert.ok(sql.includes(col) && old.includes(col), col);
        }
        assert.ok(sql.includes('returns table (section text, students integer, partial integer, reported_full integer)'));
    });
    test('only signed-in users and the service role can run them, never anonymous visitors', () => {
        for (const fn of ['section_demand', 'section_demand_totals']) {
            assert.ok(sql.includes(`revoke all on function public.${fn}(integer, integer, integer) from public, anon, authenticated, service_role;`));
            assert.ok(sql.includes(`grant execute on function public.${fn}(integer, integer, integer) to authenticated;`));
            assert.ok(sql.includes(`grant execute on function public.${fn}(integer, integer, integer) to service_role;`));
            assert.ok(!sql.includes(`${fn}(integer, integer, integer) to anon`));
        }
    });
    test('the computation is unchanged: the same unknown-EDP rule as the fix of db/126', () => {
        assert.equal((sql.match(/coalesce\(ri\.edp_result = 'rejected' and ri\.edp_reason in \('full', 'conflict'\), false\)/g) || []).length, 2);
    });
});

describe('analytics.loadDemand / loadTotals', () => {
    test('with a programme: it is passed as p_program_id', async () => {
        const db = fakeDb();
        await A.loadDemand(db, { year: 2024, term: 2, programId: 24 });
        await A.loadTotals(db, { year: 2024, term: 2, programId: 24 });
        assert.deepEqual(db.calls, [['section_demand', { p_year: 2024, p_term: 2, p_program_id: 24 }],
                                    ['section_demand_totals', { p_year: 2024, p_term: 2, p_program_id: 24 }]]);
    });
    test('without one: the call is exactly what it was, so every covered programme', async () => {
        const db = fakeDb();
        await A.loadDemand(db, { year: 2024, term: 2 });
        await A.loadDemand(db, { year: 2024, term: 2, programId: null });
        await A.loadDemand(db, { year: 2024, term: 2, programId: undefined });
        assert.ok(db.calls.every(([, a]) => !('p_program_id' in a)));
    });
    test('programme 0 is not mistaken for "none"', async () => {
        const db = fakeDb();
        await A.loadTotals(db, { year: 2024, term: 2, programId: 0 });
        assert.equal(db.calls[0][1].p_program_id, 0);
    });
    test('a missing year or term still reads nothing', async () => {
        const db = fakeDb();
        assert.deepEqual(await A.loadDemand(db, { programId: 24 }), []);
        assert.equal(await A.loadTotals(db, { programId: 24 }), null);
        assert.equal(db.calls.length, 0);
    });
});

describe('the Department dashboard', () => {
    test('the Section demand panel asks for the chosen programme', () => {
        const fn = dash.slice(dash.indexOf('async function loadSectionDemand()'), dash.indexOf('/* The card lists SECTIONS'));
        assert.ok(fn.includes('if (PROGRAM?.id != null) args.p_program_id = PROGRAM.id;'));
        assert.ok(fn.includes("supabase.rpc('section_demand', args)"));
    });
    test('the reports read the same programme', () => {
        assert.ok(dash.includes('window.Analytics.loadDemand(supabase, { year: term?.year, term: term?.term, programId: PROGRAM?.id })'));
        assert.ok(dash.includes('window.Analytics.loadTotals(supabase, { year: term?.year, term: term?.term, programId: PROGRAM?.id })'));
    });
    test('changing the programme reloads the page, so the panel is read again for the new one', () => {
        assert.ok(dash.includes('saveProgramId(value);\n                window.location.reload();') || /saveProgramId\(value\);\s+window\.location\.reload\(\);/.test(dash));
    });
});
