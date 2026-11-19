// activateforwardonly.test.mjs
// db/117: the default curriculum only moves forward, and an older curriculum is put into use with Publish.
//   node --test tests/activateforwardonly.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const sql = read('db/117_activate_forward_only_and_publish.sql');
const [activateSql, publishSql] = sql.split('create or replace function public.publish_prospectus');
const js = read('features/department/departmentdashboard.js');

describe('db/117 activate_prospectus', () => {
    test('refuses a version older than the active one, and says to use Publish', () => {
        assert.match(activateSql, /v_year < v_active/);
        assert.match(activateSql, /can only move forward/);
        assert.match(activateSql, /use Publish instead/);
    });
    test('the active one it compares with excludes the version being activated (re-activating the same one is fine)', () => {
        assert.match(activateSql, /is_active and id <> target_id/);
    });
    test('the earlier checks are all still there', () => {
        for (const re of [/Only Department Staff/, /department_covers_program\(v_program\)/, /That version has no subjects/, /v_year > v_current/])
            assert.match(activateSql, re);
        assert.doesNotMatch(activateSql, /no schedule yet/i);
    });
    test('the forward-only check comes before anything is changed', () => {
        assert.ok(activateSql.indexOf('can only move forward') < activateSql.indexOf('set is_active = false'));
    });
});

describe('db/117 publish_prospectus', () => {
    test('only Department staff of the programme', () => {
        assert.match(publishSql, /Only Department Staff can publish/);
        assert.match(publishSql, /department_covers_program\(v_program\)/);
    });
    test('refuses the active version, a version with no subjects, a future year, and a version that is not older than the active one', () => {
        assert.match(publishSql, /already the active curriculum/);
        assert.match(publishSql, /no subjects, so there is nothing to publish/);
        assert.match(publishSql, /v_year > v_current/);
        assert.match(publishSql, /v_active is null or v_year >= v_active/);
    });
    test('sets published_at only; it never touches is_active', () => {
        const upd = publishSql.slice(publishSql.indexOf('update prospectus'));
        assert.match(upd, /set published_at = coalesce\(published_at, now\(\)\)/);
        assert.doesNotMatch(upd, /is_active\s*=/);
    });
    test('anon cannot run either function', () => {
        assert.match(sql, /revoke execute on function public\.publish_prospectus\(integer\) from public, anon/);
        assert.match(sql, /grant\s+execute on function public\.publish_prospectus\(integer\) to authenticated/);
    });
    test('the file says it was applied', () => assert.match(sql, /APPLIED 17 Nov 2026/));
});

describe('the Prospectus page buttons', () => {
    const fn = js.slice(js.indexOf('function versionAction'), js.indexOf('async function publishVersion'));
    const versionAction = new Function(fn + '; return versionAction;')();
    const V = [
        { id: 30, program_id: 1, academic_year: 2024, is_active: true,  published_at: 'x' },
        { id: 31, program_id: 1, academic_year: 2023, is_active: false, published_at: null },
        { id: 32, program_id: 1, academic_year: 2020, is_active: false, published_at: 'x' },
        { id: 33, program_id: 1, academic_year: 2025, is_active: false, published_at: null },
        { id: 34, program_id: 1, academic_year: 2018, is_active: false, published_at: null },
    ];
    test('the active version has no button', () => assert.equal(versionAction(V[0], V), null));
    test('an older draft can only be published', () => { assert.equal(versionAction(V[1], V), 'publish'); assert.equal(versionAction(V[4], V), 'publish'); });
    test('an already published version can be retired, not activated or published again', () => assert.equal(versionAction(V[2], V), 'retire'));
    test('a newer draft can be made active', () => assert.equal(versionAction(V[3], V), 'activate'));
    test('with no active version, a draft can be made active', () => assert.equal(versionAction(V[1], [V[1]]), 'activate'));
    test('the page wires the Publish button to the publish_prospectus function', () => {
        assert.match(js, /data-publish/);
        assert.match(js, /supabase\.rpc\('publish_prospectus', \{ target_id: id \}\)/);
    });
});
