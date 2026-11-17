// geminicall.test.mjs
// The careful Gemini call used by the document readers (supabase/functions/_shared/geminicall.mjs).
//
//   node --test tests/geminicall.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { callGemini, isBusy, RETRY_STATUSES, DEFAULT_MODELS, BUSY_MESSAGE } from '../supabase/functions/_shared/geminicall.mjs';

const KEY = 'SECRET-KEY-123';

/* A fake fetch that answers from a list, one answer per call, and remembers the models asked. */
function rig(answers, opts = {}) {
    const calls = [];
    const sleeps = [];
    let clock = 0;
    const fetchFn = async (url) => {
        calls.push(url.match(/models\/([^:]+):/)[1]);
        const a = answers[Math.min(calls.length - 1, answers.length - 1)];
        if (a === 'network') throw new Error('socket hang up ' + KEY);
        if (a.status >= 200 && a.status < 300) return { ok: true, status: a.status, json: async () => a.json ?? { candidates: [] }, text: async () => '' };
        return { ok: false, status: a.status, text: async () => a.text ?? `error ${a.status} ${KEY}` };
    };
    const sleepFn = async (ms) => { sleeps.push(ms); clock += ms; };
    const nowFn = () => clock;
    const run = (extra = {}) => callGemini({ apiKey: KEY, body: { x: 1 }, fetchFn, sleepFn, nowFn, ...opts, ...extra });
    return { run, calls, sleeps, advance: (ms) => { clock += ms; } };
}

describe('success', () => {
    test('the first try on the first model is returned as it is', async () => {
        const r = rig([{ status: 200, json: { ok: 'yes' } }]);
        const out = await r.run();
        assert.equal(out.ok, true);
        assert.deepEqual(out.data, { ok: 'yes' });
        assert.equal(out.model, DEFAULT_MODELS[0]);
        assert.equal(out.attempts, 1);
        assert.deepEqual(r.sleeps, []);
    });
});

describe('a busy service is retried', () => {
    test('503 twice then success: waits 1.5 s then 4 s and stays on the same model', async () => {
        const r = rig([{ status: 503 }, { status: 503 }, { status: 200 }]);
        const out = await r.run();
        assert.equal(out.ok, true);
        assert.equal(out.attempts, 3);
        assert.deepEqual(r.calls, Array(3).fill(DEFAULT_MODELS[0]));
        assert.deepEqual(r.sleeps, [1500, 4000]);
    });

    test('every busy status counts: 429, 500, 502, 504, 408, 425', async () => {
        for (const status of [429, 500, 502, 504, 408, 425]) {
            const r = rig([{ status }, { status: 200 }]);
            const out = await r.run();
            assert.equal(out.ok, true, 'status ' + status);
            assert.equal(out.attempts, 2);
        }
        assert.ok(RETRY_STATUSES.has(503));
    });

    test('a network failure is retried too', async () => {
        const r = rig(['network', { status: 200 }]);
        const out = await r.run();
        assert.equal(out.ok, true);
        assert.equal(out.attempts, 2);
    });
});

describe('another model', () => {
    test('still busy after its retries: the next model is tried and can succeed', async () => {
        const r = rig([{ status: 503 }, { status: 503 }, { status: 503 }, { status: 200 }]);
        const out = await r.run();
        assert.equal(out.ok, true);
        assert.equal(out.model, DEFAULT_MODELS[1]);
        assert.deepEqual(r.calls, [DEFAULT_MODELS[0], DEFAULT_MODELS[0], DEFAULT_MODELS[0], DEFAULT_MODELS[1]]);
    });

    test('a model that no longer exists (404) is skipped without retrying it', async () => {
        const r = rig([{ status: 404 }, { status: 200 }]);
        const out = await r.run();
        assert.equal(out.ok, true);
        assert.equal(out.model, DEFAULT_MODELS[1]);
        assert.equal(out.attempts, 2);
        assert.deepEqual(r.sleeps, []);
    });

    test('all models busy: gives up with busy = true and every try listed', async () => {
        const r = rig([{ status: 503 }]);
        const out = await r.run();
        assert.equal(out.ok, false);
        assert.equal(out.busy, true);
        assert.equal(out.status, 503);
        assert.equal(out.attempts, 9);
        assert.equal(out.tried.length, 9);
        assert.deepEqual([...new Set(out.tried.map(t => t.model))], DEFAULT_MODELS);
    });

    test('all models gone (404) is a failure but not "busy"', async () => {
        const out = await rig([{ status: 404 }]).run();
        assert.equal(out.ok, false);
        assert.equal(out.busy, false);
        assert.equal(out.attempts, 3);
    });
});

describe('stops at once when another try cannot help', () => {
    for (const status of [400, 401, 403]) {
        test(`HTTP ${status} is returned after one call`, async () => {
            const r = rig([{ status }]);
            const out = await r.run();
            assert.equal(out.ok, false);
            assert.equal(out.busy, false);
            assert.equal(out.status, status);
            assert.equal(out.attempts, 1);
            assert.equal(r.calls.length, 1);
        });
    }

    test('an unexpected status (418) is not retried either', async () => {
        const r = rig([{ status: 418 }]);
        const out = await r.run();
        assert.equal(out.ok, false);
        assert.equal(out.attempts, 1);
    });
});

describe('the time budget', () => {
    test('stops starting new tries once the budget is used', async () => {
        const r = rig([{ status: 503 }], { backoffMs: [60000, 60000], budgetMs: 100000 });
        const out = await r.run();
        assert.equal(out.ok, false);
        assert.ok(out.attempts < 9, 'stopped early, made ' + out.attempts);
        assert.match(out.detail, /time budget used/);
    });
});

describe('the key never leaks', () => {
    test('the failure text has the key scrubbed', async () => {
        const out = await rig([{ status: 503, text: 'overloaded for key ' + KEY }]).run();
        assert.ok(!JSON.stringify(out).includes(KEY), 'the key appears in the result');
        assert.match(out.detail, /\*\*\*/);
    });

    test('a network error message that contains the key is not copied', async () => {
        const out = await rig(['network']).run();
        assert.ok(!JSON.stringify(out).includes(KEY));
    });
});

describe('small helpers', () => {
    test('busy means Google is busy or unreachable, nothing else', () => {
        assert.equal(isBusy(0), true);
        assert.equal(isBusy(503), true);
        assert.equal(isBusy(429), true);
        assert.equal(isBusy(400), false);
        assert.equal(isBusy(404), false);
        assert.equal(isBusy(200), false);
    });

    test('there is a message for people and it says to try again', () => {
        assert.match(BUSY_MESSAGE, /try again/i);
    });

    test('the models are tried in the order given', () => {
        assert.equal(DEFAULT_MODELS[0], 'gemini-3.1-flash-lite');
        assert.ok(DEFAULT_MODELS.length >= 2);
    });
});

describe('a call that is not answered in time (16 Nov 2026: 150 s, then killed by the platform)', () => {
    const timeoutError = () => Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });

    /* Like rig, but a fetch can hang: it uses up the time it was given (the signal's limit) and then throws a
       TimeoutError, the way AbortSignal.timeout does. The clock moves with it. */
    function hangRig(plan) {
        const limits = [];
        const calls = [];
        const sleeps = [];
        let clock = 0;
        const fetchFn = async (url, init) => {
            const model = url.match(/models\/([^:]+):/)[1];
            calls.push(model);
            const step = plan[Math.min(calls.length - 1, plan.length - 1)];
            if (step === 'hang') { clock += init.signal.limit; throw timeoutError(); }
            return { ok: true, status: 200, json: async () => ({ candidates: [] }), text: async () => '' };
        };
        const run = (extra = {}) => callGemini({
            apiKey: KEY, body: { x: 1 }, fetchFn,
            sleepFn: async (ms) => { sleeps.push(ms); clock += ms; },
            nowFn: () => clock,
            signalFn: (ms) => { limits.push(ms); return { limit: ms }; },
            ...extra,
        });
        return { run, calls, limits, sleeps, clock: () => clock };
    }

    test('every call carries a time limit', async () => {
        const r = hangRig(['ok']);
        const out = await r.run();
        assert.equal(out.ok, true);
        assert.deepEqual(r.limits, [80000]);
    });
    test('a hang moves straight on to the next model: no waiting, no second try on the same one', async () => {
        const r = hangRig(['hang', 'ok']);
        const out = await r.run({ models: ['a', 'b', 'c'] });
        assert.equal(out.ok, true);
        assert.equal(out.model, 'b');
        assert.deepEqual(r.calls, ['a', 'b']);
        assert.deepEqual(r.sleeps, []);
        assert.deepEqual(out.tried[0], { model: 'a', status: 0, timedOut: true });
    });
    test('every model hangs: a clean "busy" failure, well inside the 150 s the platform allows', async () => {
        const r = hangRig(['hang']);
        const out = await r.run({ models: ['a', 'b', 'c'] });
        assert.equal(out.ok, false);
        assert.equal(out.busy, true);
        // the first model gets its 80 s, the second what is left before 140 s, and no third call is started
        assert.deepEqual(r.calls, ['a', 'b']);
        assert.deepEqual(r.limits, [80000, 60000]);
        assert.ok(r.clock() <= 140000, `took ${r.clock()} ms`);
        assert.match(out.detail, /no answer from b within 60 s/);
        assert.deepEqual(out.tried.map((t) => t.timedOut), [true, true]);
    });
    test('a late call gets only the time that is left before the hard limit', async () => {
        const r = hangRig(['hang']);
        await r.run({ models: ['a', 'b', 'c', 'd'], budgetMs: 200000 });
        assert.deepEqual(r.limits.slice(0, 2), [80000, 60000]);
        assert.ok(r.limits.every((ms) => ms >= 1000 && ms <= 80000));
        assert.ok(r.clock() <= 140000 + 3000, `took ${r.clock()} ms`);
    });
    test('a slow but healthy answer inside the limit still counts', async () => {
        const r = hangRig(['ok']);
        const out = await r.run({ signalFn: (ms) => { r.limits.push(ms); return { limit: ms }; } });
        assert.equal(out.ok, true);
    });
    test('an answer that starts and does not finish counts as a hang too', async () => {
        const calls = [];
        const fetchFn = async (url) => {
            calls.push(url.match(/models\/([^:]+):/)[1]);
            if (calls.length === 1) return { ok: true, status: 200, json: async () => { throw timeoutError(); }, text: async () => '' };
            return { ok: true, status: 200, json: async () => ({ candidates: [] }), text: async () => '' };
        };
        const out = await callGemini({ apiKey: KEY, body: {}, models: ['a', 'b'], fetchFn, sleepFn: async () => {}, nowFn: () => 0, signalFn: () => ({}) });
        assert.equal(out.ok, true);
        assert.equal(out.model, 'b');
        assert.deepEqual(calls, ['a', 'b']);
    });
    test('an ordinary network failure is still retried on the same model', async () => {
        const r = rig(['network', { status: 200 }]);
        const out = await r.run({ signalFn: () => ({}) });
        assert.equal(out.ok, true);
        assert.deepEqual(r.calls, [DEFAULT_MODELS[0], DEFAULT_MODELS[0]]);
    });
    test('isTimeout knows both names the platform uses', async () => {
        const { isTimeout } = await import('../supabase/functions/_shared/geminicall.mjs');
        assert.equal(isTimeout(timeoutError()), true);
        assert.equal(isTimeout(Object.assign(new Error('x'), { name: 'AbortError' })), true);
        assert.equal(isTimeout(new Error('socket hang up')), false);
        assert.equal(isTimeout(null), false);
    });
});
