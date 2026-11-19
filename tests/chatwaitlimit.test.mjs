// chatwaitlimit.test.mjs
// How long a student waits for Cura's answer (supabase/functions/eligibility-chat, CALL_LIMITS in core.js).
// On 19 Nov 2026 Google answered "high demand" only after about 70 s and the student watched typing dots all that time.
//
//   node --test tests/chatwaitlimit.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { callGemini, DEFAULT_MODELS } from '../supabase/functions/_shared/geminicall.mjs';

const require = createRequire(import.meta.url);
const core = require('../supabase/functions/eligibility-chat/core.js');
const L = core.CALL_LIMITS;
const KEY = 'SECRET-KEY-123';

const timeoutError = () => Object.assign(new Error('aborted due to timeout'), { name: 'TimeoutError' });

/* A fetch whose answer takes `ms` of (fake) time. If the call is not answered within the limit it was given, it is cut off. */
function slowRig(plan) {
    let clock = 0;
    const calls = [];
    const limits = [];
    const fetchFn = async (url, init) => {
        const model = url.match(/models\/([^:]+):/)[1];
        const step = plan[Math.min(calls.length, plan.length - 1)];
        calls.push(model);
        if (step.ms > init.signal.limit) { clock += init.signal.limit; throw timeoutError(); }
        clock += step.ms;
        if (step.status >= 200 && step.status < 300) return { ok: true, status: step.status, json: async () => ({ candidates: [{}] }), text: async () => '' };
        return { ok: false, status: step.status, text: async () => 'high demand' };
    };
    const run = () => callGemini({
        apiKey: KEY, body: { x: 1 }, fetchFn, ...L,
        sleepFn: async (ms) => { clock += ms; },
        nowFn: () => clock,
        signalFn: (ms) => { limits.push(ms); return { limit: ms }; },
    });
    return { run, calls, limits, clock: () => clock };
}

describe('the limits', () => {
    test('a call is cut off after 15 s, no new call starts after 29 s, nothing runs past 40 s', () => {
        assert.equal(L.callTimeoutMs, 15000);
        assert.equal(L.budgetMs, 29000);
        assert.equal(L.hardLimitMs, 40000);
        assert.deepEqual(L.backoffMs, [1200]);
        assert.equal(L.attemptsPerModel, 2);
    });
    test('the chat function uses them, and not the readers\' long defaults', () => {
        const src = readFileSync(new URL('../supabase/functions/eligibility-chat/index.ts', import.meta.url), 'utf8');
        assert.ok(src.includes('...core.CALL_LIMITS,'));
        assert.ok(!/budgetMs:\s*\d/.test(src), 'a number written in index.ts would override the shared limits');
    });
    test('a chat is much stricter than the document readers', () => {
        // the readers: 80 s per call inside a 110 s budget (a four-year curriculum is a long answer)
        assert.ok(L.callTimeoutMs < 80000 / 4);
        assert.ok(L.budgetMs < 110000 / 3);
    });
});

describe('what a student waits (the 19 Nov 2026 case and its neighbours)', () => {
    test('Google answers "busy" after 70 s: cut off at 15 s, the next model answers, total under 20 s', async () => {
        const r = slowRig([{ ms: 70000, status: 503 }, { ms: 4000, status: 200 }]);
        const out = await r.run();
        assert.equal(out.ok, true);
        assert.equal(out.model, DEFAULT_MODELS[1]);
        assert.ok(r.clock() <= 19500, `waited ${r.clock()} ms`);
        assert.deepEqual(out.tried[0], { model: DEFAULT_MODELS[0], status: 0, timedOut: true });
    });
    test('a normal answer (4 s) is untouched', async () => {
        const r = slowRig([{ ms: 4000, status: 200 }]);
        const out = await r.run();
        assert.equal(out.ok, true);
        assert.equal(out.model, DEFAULT_MODELS[0]);
        assert.equal(r.clock(), 4000);
        assert.deepEqual(r.limits, [15000]);
    });
    test('a slow but healthy answer (12 s) still counts', async () => {
        const r = slowRig([{ ms: 12000, status: 200 }]);
        assert.equal((await r.run()).ok, true);
    });
    test('every model is slow: a clean "busy" failure after at most about 31 s (it was 70 s)', async () => {
        const r = slowRig([{ ms: 70000, status: 503 }]);
        const out = await r.run();
        assert.equal(out.ok, false);
        assert.equal(out.busy, true);
        assert.ok(r.clock() <= 31000, `waited ${r.clock()} ms`);
        assert.ok(r.clock() >= 29000, `gave up too early: ${r.clock()} ms`);
        assert.equal(r.calls.length, 2);                 // two models tried, each cut at 15 s
    });
    test('quick "busy" answers (503 in 1 s) are retried on the model, then the next one, within the budget', async () => {
        const r = slowRig([{ ms: 1000, status: 503 }, { ms: 1000, status: 503 }, { ms: 3000, status: 200 }]);
        const out = await r.run();
        assert.equal(out.ok, true);
        assert.equal(out.model, DEFAULT_MODELS[1]);
        assert.ok(r.clock() < 10000);
    });
    test('the worst case never reaches the 40 s hard limit', async () => {
        for (const plan of [[{ ms: 70000, status: 503 }], [{ ms: 15000, status: 503 }], [{ ms: 29000, status: 503 }, { ms: 70000, status: 503 }]]) {
            const r = slowRig(plan);
            await r.run();
            assert.ok(r.clock() <= 40000, `waited ${r.clock()} ms for ${JSON.stringify(plan)}`);
        }
    });
});
