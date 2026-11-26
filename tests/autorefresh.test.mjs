// autorefresh.test.mjs
// The refresher that keeps a screen current (shared/js/app/autorefresh.js), and its use on the student page.
//
//   node --test tests/autorefresh.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { create, EVERY_MS } = require('../shared/js/app/autorefresh.js');

const make = (answers, over = {}) => {
    const log = { probes: 0, redraws: 0 };
    const queue = [...answers];
    const r = create({
        probe: async () => { log.probes++; return queue.length ? queue.shift() : queue.at?.(-1) ?? null; },
        onChange: async () => { log.redraws++; },
        isHidden: () => false,
        ...over,
    });
    return { r, log };
};

describe('create().tick', () => {
    test('the first answer is the baseline: nothing is redrawn', async () => {
        const { r, log } = make(['a']);
        assert.equal(await r.tick(), 'baseline');
        assert.equal(log.redraws, 0);
    });
    test('the same answer again redraws nothing', async () => {
        const { r, log } = make(['a', 'a', 'a']);
        await r.tick();
        assert.equal(await r.tick(), 'same');
        assert.equal(await r.tick(), 'same');
        assert.equal(log.redraws, 0);
    });
    test('a different answer redraws once, then is the new baseline', async () => {
        const { r, log } = make(['a', 'b', 'b']);
        await r.tick();
        assert.equal(await r.tick(), 'changed');
        assert.equal(await r.tick(), 'same');
        assert.equal(log.redraws, 1);
    });
    test('while someone is busy the redraw waits, and happens at the next check once they are done', async () => {
        let busy = true;
        const { r, log } = make(['a', 'b', 'b', 'b'], { isBusy: () => busy });
        await r.tick();
        assert.equal(await r.tick(), 'waiting');
        assert.equal(log.redraws, 0);
        busy = false;
        assert.equal(await r.tick(), 'changed');
        assert.equal(log.redraws, 1);
    });
    test('a hidden tab asks nothing', async () => {
        const { r, log } = make(['a'], { isHidden: () => true });
        assert.equal(await r.tick(), 'skipped');
        assert.equal(log.probes, 0);
    });
    test('when the check cannot be made (offline, signed out) the screen is left as it is', async () => {
        const { r, log } = make(['a', null, 'a']);
        await r.tick();
        assert.equal(await r.tick(), 'unavailable');
        assert.equal(await r.tick(), 'same');
        assert.equal(log.redraws, 0);
    });
    test('a check that throws never breaks anything and the next one still works', async () => {
        let n = 0;
        const r = create({ probe: async () => { if (++n === 2) throw new Error('boom'); return n === 3 ? 'b' : 'a'; }, onChange: async () => {}, isHidden: () => false });
        await r.tick();
        assert.equal(await r.tick(), 'error');
        assert.equal(await r.tick(), 'changed');
    });
    test('two checks at once run only one', async () => {
        let release; const gate = new Promise(res => { release = res; });
        let probes = 0;
        const r = create({ probe: async () => { probes++; await gate; return 'a'; }, onChange: async () => {}, isHidden: () => false });
        const first = r.tick();
        assert.equal(await r.tick(), 'skipped');
        release(); await first;
        assert.equal(probes, 1);
    });
    test('the check is once a minute', () => assert.equal(EVERY_MS, 60000));
});

describe('the student page uses it', () => {
    const page = readFileSync(new URL('../features/student/studentdashboard.js', import.meta.url), 'utf8');
    const html = readFileSync(new URL('../features/student/studentdashboard.html', import.meta.url), 'utf8');
    test('the helper is loaded before the page script', () => {
        const helper = html.indexOf('shared/js/app/autorefresh.js');
        const script = html.indexOf('studentdashboard.js');
        assert.ok(helper > 0 && script > helper);
    });
    test('it is started on the real (signed-in) path, with a probe, a redraw and a busy check', () => {
        assert.match(page, /window\.AutoRefresh\?\.start\(\{ probe: probeStudentUpdates, onChange: applyStudentUpdates, isBusy: studentIsBusy \}\)/);
    });
    test('the probe asks for notifications and the requests with their subjects, and is skipped in preview', () => {
        const i = page.indexOf('async function probeStudentUpdates()');
        const body = page.slice(i, i + 1400);
        assert.match(body, /if \(PREVIEW \|\| !supabase \|\| !AUTH_UID \|\| !STUDENT_ROW_ID\) return null/);
        assert.match(body, /from\('notification'\)/);
        assert.match(body, /from\('request'\)/);
        assert.match(body, /request_item\(/);
    });
    test('the redraw leaves Build your plan alone, so a plan being built is never wiped', () => {
        const i = page.indexOf('async function applyStudentUpdates()');
        const body = page.slice(i, i + 900);
        assert.match(body, /view === 'plan'/);
        assert.match(body, /loadRequestHistory\(\)/);
        assert.match(body, /loadNotifications\(\)/);
    });
    test('a dialog or a field being typed in counts as busy', () => {
        const i = page.indexOf('function studentIsBusy()');
        const body = page.slice(i, i + 600);
        assert.match(body, /dialog\[open\]/);
        assert.match(body, /INPUT\|TEXTAREA\|SELECT/);
    });
});
