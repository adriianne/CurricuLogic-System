// geminihedged.test.mjs
// callGeminiHedged: the curriculum reader's call (supabase/functions/_shared/geminicall.mjs), 21 Nov 2026.
// A slow AI (95 s one day, 160 s and a 503 the next) must not cost the whole wait: a second model starts in parallel
// after 35 s, the first GOOD answer wins, and nothing runs past one 135 s clock.
//
// Time is virtual: a 95-second answer is simulated instantly and exactly.
//
//   node --test tests/geminihedged.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { callGeminiHedged, DEFAULT_MODELS } from '../supabase/functions/_shared/geminicall.mjs';

const KEY = 'SECRET-KEY-123';
const [A, B, C] = DEFAULT_MODELS;     // A: the accurate one, tried first. B: the quicker one, started in parallel when A is slow.
const flush = () => new Promise((r) => setImmediate(r));

class VirtualTime {
    constructor() { this.now = 0; this.queue = []; this.seq = 0; }
    at(t, fn) { this.queue.push({ t, seq: this.seq++, fn }); }
    sleep(ms) { return new Promise((resolve) => this.at(this.now + ms, resolve)); }
    /* Runs the clock until the promise settles (or nothing is left to happen) and says when it settled. */
    async run(promise) {
        let value; let doneAt = null; let error;
        promise.then((v) => { value = v; doneAt = this.now; }, (e) => { error = e; doneAt = this.now; });
        for (let guard = 0; guard < 100000; guard++) {
            await flush();
            if (doneAt !== null) break;
            if (!this.queue.length) break;
            this.queue.sort((a, b) => a.t - b.t || a.seq - b.seq);
            const event = this.queue.shift();
            this.now = Math.max(this.now, event.t);
            event.fn();
        }
        await flush();
        if (error) throw error;
        return { result: value, at: doneAt };
    }
}

/* plan: { [model]: [ { ms, status = 200, worth = 'good', text } ... ] } consumed one per call, the last repeating.
   ms is how long the call takes; Infinity = never answers. */
function rig(plan, options = {}) {
    const vt = new VirtualTime();
    const calls = [];
    const counters = {};
    const fetchFn = (url, init) => new Promise((resolve, reject) => {
        const model = url.match(/models\/([^:]+):/)[1];
        const steps = plan[model] ?? [{ ms: Infinity, status: 404 }];
        const step = steps[Math.min(counters[model] = (counters[model] ?? -1) + 1, steps.length - 1)];
        const call = { model, startedAt: vt.now, aborted: false, limitMs: init.signal.ms, endedAt: null };
        calls.push(call);
        const status = step.status ?? 200;
        let over = false;
        const end = (fn) => { if (over) return; over = true; call.endedAt = vt.now; fn(); };

        if (Number.isFinite(step.ms)) {
            vt.at(vt.now + step.ms, () => end(() => resolve({
                ok: status >= 200 && status < 300, status,
                json: async () => ({ worth: step.worth ?? 'good', model }),
                text: async () => step.text ?? '',
            })));
        }
        vt.at(vt.now + init.signal.ms, () => end(() => reject(Object.assign(new Error('timeout'), { name: 'TimeoutError' }))));
        init.signal.ctrl.signal.addEventListener('abort', () => end(() => { call.aborted = true; reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); }));
    });
    const run = () => vt.run(callGeminiHedged({
        apiKey: KEY, body: { x: 1 }, fetchFn,
        accept: (data) => data.worth,
        sleepFn: (ms) => vt.sleep(ms),
        nowFn: () => vt.now,
        makeSignal: (ctrl, ms) => ({ ctrl, ms }),
        ...options,
    }));
    return { run, calls, vt };
}

describe('a good day: the first model answers in time', () => {
    test('34 s, good: returned at 34 s, the second model never started, no hedge', async () => {
        const r = rig({ [A]: [{ ms: 34000 }] });
        const { result, at } = await r.run();
        assert.equal(result.ok, true);
        assert.equal(result.model, A);
        assert.equal(result.hedged, false);
        assert.equal(at, 34000);
        assert.deepEqual(r.calls.map((c) => c.model), [A]);
    });
    test('an answer that is only "usable" from the FIRST model is taken at once: there is nothing better to wait for', async () => {
        const r = rig({ [A]: [{ ms: 20000, worth: 'usable' }] });
        const { result, at } = await r.run();
        assert.equal(result.model, A);
        assert.equal(at, 20000);
    });
});

describe('a slow day: the second model starts in parallel after 35 s and the first good answer wins', () => {
    test('the first model takes 95 s; the second starts at 35 s, answers 20 s later: done at 55 s, not 95 s', async () => {
        const r = rig({ [A]: [{ ms: 95000 }], [B]: [{ ms: 20000 }] });
        const { result, at } = await r.run();
        assert.equal(result.ok, true);
        assert.equal(result.model, B);
        assert.equal(result.hedged, true);
        assert.equal(at, 55000);
        const a = r.calls.find((c) => c.model === A);
        const b = r.calls.find((c) => c.model === B);
        assert.equal(b.startedAt, 35000);
        assert.equal(a.aborted, true);          // the slow call is stopped the moment there is a winner
    });
    test('the slow call is NOT cut off when the second starts: if it finishes first it wins', async () => {
        const r = rig({ [A]: [{ ms: 50000 }], [B]: [{ ms: 40000 }] });
        const { result, at } = await r.run();
        assert.equal(result.model, A);          // A answers at 50 s, B would have at 75 s
        assert.equal(at, 50000);
        assert.equal(r.calls.find((c) => c.model === B).aborted, true);
    });
    test('the hedge starts at 35 s and not before', async () => {
        const r = rig({ [A]: [{ ms: 34900 }], [B]: [{ ms: 5000 }] });
        const { result } = await r.run();
        assert.equal(result.model, A);
        assert.equal(r.calls.length, 1);
    });
});

describe('accuracy is kept: the quicker model\'s unchecked answer does not replace the accurate one at once', () => {
    test('B answers "usable" at 55 s, A answers good at 62 s (inside the 15 s grace): A wins', async () => {
        const r = rig({ [A]: [{ ms: 62000 }], [B]: [{ ms: 20000, worth: 'usable' }] });
        const { result, at } = await r.run();
        assert.equal(result.model, A);
        assert.equal(at, 62000);
    });
    test('B answers "usable" at 55 s, A is still silent at 70 s (the grace is over): B is used', async () => {
        const r = rig({ [A]: [{ ms: 95000 }], [B]: [{ ms: 20000, worth: 'usable' }] });
        const { result, at } = await r.run();
        assert.equal(result.model, B);
        assert.equal(at, 70000);
        assert.equal(r.calls.find((c) => c.model === A).aborted, true);
    });
    test('B answers "usable" and A then fails: B is used at once, not after the grace', async () => {
        const r = rig({ [A]: [{ ms: 60000, status: 400, text: 'bad request' }], [B]: [{ ms: 20000, worth: 'usable' }] });
        const { result } = await r.run();
        // a 400 would fail every model, so it ends the call: but the usable answer already in hand is returned
        assert.equal(result.ok, true);
        assert.equal(result.model, B);
    });
    test('a "bad" answer (empty, cut off) from the second model is a failure of that model: the first is still waited for', async () => {
        const r = rig({ [A]: [{ ms: 70000 }], [B]: [{ ms: 10000, worth: 'bad' }] });
        const { result, at } = await r.run();
        assert.equal(result.model, A);
        assert.equal(at, 70000);
    });
});

describe('a busy first model: the second starts at once, without waiting for the hedge', () => {
    test('A answers 503 twice (one quick retry) and is done at about 8 s: B starts then, not at 35 s', async () => {
        const r = rig({ [A]: [{ ms: 3000, status: 503 }], [B]: [{ ms: 25000 }] });
        const { result, at } = await r.run();
        assert.equal(result.model, B);
        const b = r.calls.find((c) => c.model === B);
        assert.ok(b.startedAt < 35000 && b.startedAt >= 7500, `B started at ${b.startedAt}`);
        assert.equal(result.hedged, false);               // a fallback, not a hedge
        assert.ok(at < 45000, `done at ${at}`);
    });
    test('the three models are tried in turn when each is busy, then it fails as busy', async () => {
        const r = rig({ [A]: [{ ms: 1000, status: 503 }], [B]: [{ ms: 1000, status: 503 }], [C]: [{ ms: 1000, status: 503 }] });
        const { result } = await r.run();
        assert.equal(result.ok, false);
        assert.equal(result.busy, true);
        assert.equal(result.status, 503);
        assert.deepEqual([...new Set(r.calls.map((c) => c.model))], [A, B, C]);
    });
    test('a model that is gone (404) is skipped without a retry', async () => {
        const r = rig({ [A]: [{ ms: 500, status: 404 }], [B]: [{ ms: 5000 }] });
        const { result } = await r.run();
        assert.equal(result.model, B);
        assert.equal(r.calls.filter((c) => c.model === A).length, 1);
    });
});

describe('one clock for everything', () => {
    test('two models that never answer: the call ends at 135 s as busy, and both are stopped', async () => {
        const r = rig({ [A]: [{ ms: Infinity }], [B]: [{ ms: Infinity }], [C]: [{ ms: Infinity }] });
        const { result, at } = await r.run();
        assert.equal(result.ok, false);
        assert.equal(result.busy, true);
        assert.ok(at <= 135000, `ended at ${at}`);
        assert.ok(at >= 134000, `gave up early at ${at}`);
        assert.ok(r.calls.every((c) => c.endedAt !== null && c.endedAt <= 135000));
    });
    test('no call is given more time than is left on the clock', async () => {
        const r = rig({ [A]: [{ ms: Infinity }], [B]: [{ ms: Infinity }], [C]: [{ ms: Infinity }] });
        await r.run();
        for (const c of r.calls) assert.ok(c.startedAt + c.limitMs <= 135000 + 1, `${c.model} may run to ${c.startedAt + c.limitMs}`);
    });
    test('the old failure (two 80 s calls, then 503 at 160 s) is gone: the worst case is 135 s', async () => {
        const r = rig({ [A]: [{ ms: 80000, status: 503 }], [B]: [{ ms: 80000, status: 503 }], [C]: [{ ms: 80000, status: 503 }] });
        const { at } = await r.run();
        assert.ok(at <= 135000, `ended at ${at}`);
    });
    test('a call that would answer after the deadline is not waited for', async () => {
        const r = rig({ [A]: [{ ms: 140000 }], [B]: [{ ms: 140000 }] });
        const { result, at } = await r.run();
        assert.equal(result.ok, false);
        assert.ok(at <= 135000);
    });
});

describe('what stops at once, and what never leaks', () => {
    test('a bad request or a refused key (400, 401, 403) would fail on every model: it ends the call, the other is not started', async () => {
        for (const status of [400, 401, 403]) {
            const r = rig({ [A]: [{ ms: 500, status, text: 'nope' }], [B]: [{ ms: 500 }] });
            const { result, at } = await r.run();
            assert.equal(result.ok, false, String(status));
            assert.equal(result.status, status);
            assert.equal(result.busy, false);
            assert.ok(at <= 1000, `ended at ${at}`);
            assert.deepEqual(r.calls.map((c) => c.model), [A]);
        }
    });
    test('the key is scrubbed from anything returned', async () => {
        const r = rig({ [A]: [{ ms: 500, status: 403, text: `denied for key ${KEY}` }] });
        const { result } = await r.run();
        assert.ok(!JSON.stringify(result).includes(KEY));
        assert.ok(result.detail.includes('***'));
    });
    test('an answer that is "good" by default (no accept given) wins at once', async () => {
        const vt = new VirtualTime();
        const out = await vt.run(callGeminiHedged({
            apiKey: KEY, body: {}, models: [A],
            fetchFn: () => Promise.resolve({ ok: true, status: 200, json: async () => ({ any: 1 }), text: async () => '' }),
            sleepFn: (ms) => vt.sleep(ms), nowFn: () => vt.now, makeSignal: (ctrl, ms) => ({ ctrl, ms }),
        }));
        assert.equal(out.result.ok, true);
        assert.deepEqual(out.result.data, { any: 1 });
    });
});
