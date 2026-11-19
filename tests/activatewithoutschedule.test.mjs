// activatewithoutschedule.test.mjs
// db/116: a curriculum version can be made active before it has a schedule (the owner's order, 17 Nov 2026:
// create the curriculum, make it active, then add the schedule).
//   node --test tests/activatewithoutschedule.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const sql = read('db/116_activate_without_schedule.sql');
const body = sql.slice(sql.indexOf('create or replace function public.activate_prospectus'));
const old = read('db/082_activate_requires_schedule.sql');

describe('db/116 removes only the schedule check', () => {
    test('the old rule is the one that refused a version with no sections', () => {
        assert.match(old, /That version has no schedule yet/);
        assert.match(old, /from subject_offering o/);
    });
    test('the new function has no schedule check at all', () => {
        assert.doesNotMatch(body, /no schedule yet/i);
        assert.doesNotMatch(body, /subject_offering/);
    });
    test('every other check is still there', () => {
        assert.match(body, /Only Department Staff can activate a curriculum version/);
        assert.match(body, /No such prospectus version/);
        assert.match(body, /department_covers_program\(v_program\)/);
        assert.match(body, /That version has no subjects/);
        assert.match(body, /v_year > v_current/);
        assert.match(body, /has not started/);
    });
    test('one active version per programme: the previous one is switched off first, then this one is switched on', () => {
        const off = body.indexOf('set is_active = false');
        const on = body.indexOf('set is_active = true');
        assert.ok(off > 0 && on > off);
        assert.match(body, /where program_id = v_program and is_active and id <> target_id/);
    });
    test('same signature, security definer, and anon still cannot run it', () => {
        assert.match(body, /activate_prospectus\(target_id integer\)\s+returns void/);
        assert.match(body, /security definer/);
        assert.match(body, /revoke execute on function public\.activate_prospectus\(integer\) from public, anon/);
        assert.match(body, /grant\s+execute on function public\.activate_prospectus\(integer\) to authenticated/);
    });
    test('the file says it was applied, and how it was checked', () => {
        assert.match(sql, /APPLIED 17 Nov 2026/);
        assert.match(sql, /dry run that rolled back/);
    });
});

describe('the page', () => {
    const js = read('features/department/departmentdashboard.js');
    test('tells the person what to do after activating', () => {
        assert.match(js, /Next: add this term's schedule on the Schedule tab, so students can be given sections/);
    });
});
