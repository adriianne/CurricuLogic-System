// singleflight.test.mjs
// "One at a time": a second press while an action runs does nothing, and a failure never leaves it stuck.
//
//   node --test tests/singleflight.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { guard } = require('../shared/js/app/singleflight.js');

const later = () => { let resolve, reject; const p = new Promise((a, b) => { resolve = a; reject = b; }); return { p, resolve, reject }; };

describe('one at a time', () => {
    test('a second call while the first runs is ignored, and runs nothing', async () => {
        let started = 0;
        const gate = later();
        const run = guard(async () => { started++; await gate.p; return 'done'; });

        const first = run();
        const second = run();
        const third = run();
        assert.equal(run.busy, true);
        gate.resolve();

        assert.equal(await first, 'done');
        assert.equal(await second, undefined);
        assert.equal(await third, undefined);
        assert.equal(started, 1);
        assert.equal(run.ignored, 2);        // the second and third calls; the first one ran
        assert.equal(run.busy, false);
    });

    test('after it finishes, the next call runs again', async () => {
        let started = 0;
        const run = guard(async () => { started++; });
        await run();
        await run();
        assert.equal(started, 2);
        assert.equal(run.ignored, 0);
    });

    test('a failure releases it, passes the error on, and still calls onEnd', async () => {
        const events = [];
        const run = guard(async () => { throw new Error('the service failed'); }, {
            onStart: () => events.push('start'), onEnd: () => events.push('end'),
        });
        await assert.rejects(run(), /the service failed/);
        assert.deepEqual(events, ['start', 'end']);
        assert.equal(run.busy, false);

        const ok = guard(async () => 'fine');
        assert.equal(await ok(), 'fine');
    });

    test('onStart and onEnd run once per accepted call, never for an ignored one', async () => {
        const events = [];
        const gate = later();
        const run = guard(async () => { await gate.p; }, { onStart: () => events.push('start'), onEnd: () => events.push('end') });
        const a = run();
        run(); run();
        assert.deepEqual(events, ['start']);
        gate.resolve();
        await a;
        assert.deepEqual(events, ['start', 'end']);
    });

    test('the arguments reach the action, and a returned value comes back', async () => {
        const run = guard(async (a, b) => a + b);
        assert.equal(await run(2, 3), 5);
    });

    test('a result that never comes keeps it busy, so the button stays blocked until it ends', async () => {
        const gate = later();
        const run = guard(() => gate.p);
        const first = run();
        for (let i = 0; i < 5; i++) await run();
        assert.equal(run.busy, true);
        gate.resolve();
        await first;
        assert.equal(run.busy, false);
    });
});
