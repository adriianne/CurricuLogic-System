// retirecurriculum.test.mjs
// db/118: a used curriculum is retired, not deleted; a retired one can be restored for a returnee.
//   node --test tests/retirecurriculum.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const sql = read('db/118_retire_curriculum.sql');
const js = read('features/department/departmentdashboard.js');
const adm = read('features/admin/admindashboard.js');
const ES = createRequire(import.meta.url)('../shared/js/accounts/expectedstudents.js');

describe('db/118 functions', () => {
    const retire = sql.slice(sql.indexOf('function public.retire_prospectus'), sql.indexOf('function public.restore_prospectus'));
    const restore = sql.slice(sql.indexOf('function public.restore_prospectus'), sql.indexOf('create or replace function public.curriculum_for'));
    test('retire: Department of the programme only; refuses the active, a draft, and one already retired', () => {
        assert.match(retire, /Only Department Staff can retire/);
        assert.match(retire, /department_covers_program\(v_program\)/);
        assert.match(retire, /The active curriculum cannot be retired/);
        assert.match(retire, /v_published is null then\s+raise exception 'A draft was never in use/);
        assert.match(retire, /already retired/);
        assert.match(retire, /set retired_at = now\(\)/);
    });
    test('restore: Department only; refuses a version that is not retired; clears retired_at and nothing else about activity', () => {
        assert.match(restore, /Only Department Staff can restore/);
        assert.match(restore, /That version is not retired/);
        assert.match(restore, /set retired_at = null/);
        assert.doesNotMatch(restore, /is_active\s*=/);
    });
    test('a retired year is not given to an account, and a retired version cannot be activated', () => {
        const cf = sql.slice(sql.indexOf('function public.curriculum_for'), sql.indexOf('function public.activate_prospectus'));
        assert.match(cf, /pr\.published_at is not null and pr\.retired_at is null/);
        assert.match(sql, /That version is retired\. Restore it first/);
    });
    test('the forward-only rule from db/117 is kept in the new activate', () => {
        assert.match(sql, /v_year < v_active/);
        assert.match(sql, /use Publish instead/);
    });
    test('a published curriculum cannot be deleted by a signed-in user; direct database work (no user) is not blocked', () => {
        assert.match(sql, /auth\.uid\(\) is not null and old\.published_at is not null/);
        assert.match(sql, /create trigger prospectus_no_delete_published\s+before delete on public\.prospectus/);
    });
    test('anon cannot run the new functions', () => {
        assert.match(sql, /revoke execute on function public\.retire_prospectus\(integer\), public\.restore_prospectus\(integer\) from public, anon/);
    });
    test('the file says it was applied', () => assert.match(sql, /APPLIED 17 Nov 2026/));
});

describe('the Prospectus page', () => {
    const versionAction = new Function(js.slice(js.indexOf('function versionAction'), js.indexOf('async function retireOrRestore')) + '; return { versionAction, canDelete };')();
    const V = [
        { id: 30, program_id: 1, academic_year: 2024, is_active: true,  published_at: 'x', retired_at: null },
        { id: 31, program_id: 1, academic_year: 2023, is_active: false, published_at: null, retired_at: null },
        { id: 32, program_id: 1, academic_year: 2020, is_active: false, published_at: 'x', retired_at: null },
        { id: 33, program_id: 1, academic_year: 2018, is_active: false, published_at: 'x', retired_at: 'y' },
    ];
    test('published: Retire. retired: Restore. active: nothing', () => {
        assert.equal(versionAction.versionAction(V[2], V), 'retire');
        assert.equal(versionAction.versionAction(V[3], V), 'restore');
        assert.equal(versionAction.versionAction(V[0], V), null);
    });
    test('Delete is offered on every version (db/119); the database decides', () => {
        for (const v of V) assert.equal(versionAction.canDelete(v), true);
    });
    test('the page calls the two functions and shows a Retired status', () => {
        assert.match(js, /'retire_prospectus'/);
        assert.match(js, /'restore_prospectus'/);
        assert.match(js, /pill waiting" title="Kept for returning students/);
    });
});

describe('account upload', () => {
    const progs = [{ id: 1, code: 'BSIT' }];
    const row = { __line: 2, student_id: '24000001', first_name: 'Ana', last_name: 'Cruz', email: 'ana@example.com', program_code: 'BSIT', year_level: '1', curriculum_year: '2020' };
    test('a row naming a retired year is told to ask for a restore', () => {
        const { bad } = ES.checkRows([row], progs, new Set(), new Map(), new Map([[1, new Set([2024])]]), new Map(), new Map([[1, new Set([2020])]]));
        assert.match(bad[0].why, /2020 curriculum for BSIT is retired/);
        assert.match(bad[0].why, /restore it/);
    });
    test('the Admin page reads retired versions and keeps them out of the offered years', () => {
        assert.match(adm, /if \(r\.retired_at\) \{[\s\S]{0,200}RETIRED_CURRICULA[\s\S]{0,120}continue;/);
    });
});
