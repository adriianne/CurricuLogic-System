// geminicall.mjs
//
// One careful call to Google's Gemini API, used by the document readers
// (analyze-curriculum-document and analyze-schedule-document).
//
// WHY: a reader that makes one attempt stops dead at the first hiccup. A real
// try on 17 Oct 2026 got HTTP 503 from Google three times in a row, and the
// schedule reader never retried at all. This helper:
//
//   * retries a busy answer (429, 500, 502, 503, 504, 408, 425) or a network
//     failure a few times, waiting a little longer each time;
//   * moves on to the NEXT model when one is not found (404) or still busy
//     after its retries, because models are retired and overloaded on their own;
//   * stops at once on an answer that another model would repeat: a bad request
//     (400) or a refused key (401, 403);
//   * gives up cleanly when the time budget is used, so the function itself is
//     not killed by the platform half-way;
//   * puts a time limit on EACH call. On 16 Nov 2026 a call that Google never answered ran until the platform
//     killed the whole function after 150 s (status 546), twice in a row, and the person saw nothing but a
//     bar stuck at 95%. A call that is not answered in time is cut off and the next model is tried at once
//     (a hang is not a busy answer: waiting and asking the same model again would only hang again).
//
// It never puts the API key into anything it returns or logs.
//
// Plain JavaScript with nothing from Deno: fetch, sleep and the clock are
// passed in, so it is tested in Node (tests/geminicall.test.mjs).
//
//   const r = await callGemini({ apiKey, body: { contents: [...], generationConfig: {...} } });
//   r.ok  -> { ok: true, data, model, attempts, tried }
//   !r.ok -> { ok: false, status, detail, busy, attempts, tried }

export const RETRY_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

/* The first model is the one in use today. The "-latest" names are Google's own aliases that follow the
   current model, so they keep working after a specific model is retired. A name that does not exist just
   answers 404 and the next one is tried. */
export const DEFAULT_MODELS = ['gemini-3.1-flash-lite', 'gemini-flash-lite-latest', 'gemini-flash-latest'];

const urlFor = (model, apiKey) =>
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

export async function callGemini({
    apiKey,
    body,
    models = DEFAULT_MODELS,
    fetchFn = fetch,
    sleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    nowFn = () => Date.now(),
    attemptsPerModel = 3,
    backoffMs = [1500, 4000],
    budgetMs = 110000,
    callTimeoutMs = 80000,   // one call to Google may take this long at most (a four-year curriculum is a long answer)
    hardLimitMs = 140000,    // no call may run past this, counted from the start (the platform stops at 150 s)
    signalFn = (ms) => AbortSignal.timeout(ms),
} = {}) {
    const started = nowFn();
    const tried = [];
    let attempts = 0;
    let last = { status: 0, detail: 'no attempt was made' };

    // Anything that echoes the key back is scrubbed before it can reach a log.
    const scrub = (text) => String(text ?? '').split(apiKey).join('***').slice(0, 300);
    const done = (extra) => ({ ok: false, attempts, tried, ...last, busy: isBusy(last.status), ...extra });

    for (const model of models) {
        for (let attempt = 1; attempt <= attemptsPerModel; attempt++) {
            if (nowFn() - started > budgetMs) {
                last = { status: last.status, detail: `time budget used (${last.detail})` };
                return done({});
            }
            attempts++;

            // This call gets the usual limit, or what is left before the hard limit, whichever is shorter.
            const timeoutMs = Math.max(1000, Math.min(callTimeoutMs, hardLimitMs - (nowFn() - started)));

            let res;
            try {
                res = await fetchFn(urlFor(model, apiKey), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                    signal: signalFn(timeoutMs),
                });
            } catch (err) {
                if (isTimeout(err)) {
                    // Not answered in time: do not wait and ask this model again, move on to the next one.
                    last = { status: 0, detail: `no answer from ${model} within ${Math.round(timeoutMs / 1000)} s` };
                    tried.push({ model, status: 0, timedOut: true });
                    break;
                }
                last = { status: 0, detail: `network error on ${model}` };
                tried.push({ model, status: 0 });
                if (attempt < attemptsPerModel) await sleepFn(backoffMs[Math.min(attempt - 1, backoffMs.length - 1)]);
                continue;
            }

            if (res.ok) {
                let data;
                try {
                    data = await res.json();
                } catch (err) {
                    if (isTimeout(err)) {
                        // The answer started but did not finish in time.
                        last = { status: 0, detail: `answer from ${model} not finished within ${Math.round(timeoutMs / 1000)} s` };
                        tried.push({ model, status: 0, timedOut: true });
                        break;
                    }
                    last = { status: res.status, detail: `unreadable answer from ${model}` };
                    tried.push({ model, status: res.status });
                    if (attempt < attemptsPerModel) await sleepFn(backoffMs[Math.min(attempt - 1, backoffMs.length - 1)]);
                    continue;
                }
                tried.push({ model, status: res.status });
                return { ok: true, data, model, attempts, tried };
            }

            const text = scrub(await res.text().catch(() => ''));
            last = { status: res.status, detail: `HTTP ${res.status} from ${model}: ${text}` };
            tried.push({ model, status: res.status });

            // A model that is gone: no point retrying it, try the next one.
            if (res.status === 404) break;
            // The same request would fail on every model: stop now.
            if (res.status === 400 || res.status === 401 || res.status === 403) return done({});
            // Busy: wait and try again, then move on to the next model.
            if (RETRY_STATUSES.has(res.status)) {
                if (attempt < attemptsPerModel) await sleepFn(backoffMs[Math.min(attempt - 1, backoffMs.length - 1)]);
                continue;
            }
            // Any other answer is not one we know how to get past.
            return done({});
        }
    }
    return done({});
}

/* ------------------------------------------------------------------------------------------------------------
   callGeminiHedged: the call the CURRICULUM reader uses (21 Nov 2026).

   WHY: callGemini asks one model at a time. When a model is slow, it waits 80 s, cuts it off, and starts the next model
   FROM ZERO, so a slow day cost 160 s and then a 503; and the reader's own retry started a second round on a fresh clock,
   past the platform's 150 s stop (status 546). The same PDF took 34 s one day and 95 s to 160 s the next.

   THIS asks like a person who is in a hurry but wants the good answer:
     * the first (most accurate) model starts alone;
     * if it has not answered after hedgeAfterMs, the NEXT model starts too, in parallel, and the first GOOD answer wins
       (the slow call is not cut off: it may still be the one that finishes first);
     * a model that answers busy (503...) is retried once quickly, then the next model starts at once;
     * ONE clock for everything: nothing runs past deadlineMs, counted from the start;
     * the loser is aborted the moment there is a winner.

   accept(data, model) decides what an answer is worth:
     'good'    use it now
     'usable'  an answer, but not checked: the first model's is taken at once; another model's waits up to graceMs for the
               first model (so a quicker model does not replace the accurate one without a check), then it is used
     'bad'     empty, cut off or not JSON: the same as a failure of that model
   Returns the shape of callGemini: { ok: true, data, model, attempts, tried, hedged } or { ok: false, status, detail, busy, ... }.
   ------------------------------------------------------------------------------------------------------------ */
export async function callGeminiHedged({
    apiKey,
    body,
    models = DEFAULT_MODELS,
    accept = () => 'good',
    fetchFn = fetch,
    sleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    nowFn = () => Date.now(),
    hedgeAfterMs = 35000,
    graceMs = 15000,
    deadlineMs = 135000,       // the platform stops a function at 150 s
    quickRetries = 1,
    retryWaitMs = 1500,
    makeSignal = (ctrl, ms) => AbortSignal.any([ctrl.signal, AbortSignal.timeout(ms)]),
} = {}) {
    const started = nowFn();
    const remaining = () => deadlineMs - (nowFn() - started);
    const tried = [];
    let attempts = 0;
    let last = { status: 0, detail: 'no attempt was made' };
    const scrub = (text) => String(text ?? '').split(apiKey).join('***').slice(0, 300);

    let settle;
    const settled = new Promise((resolve) => { settle = resolve; });
    let finished = false;
    let hedged = false;
    let nextModel = 0;
    let running = 0;
    let fallback = null;                 // a usable answer from a model other than the first, waiting for the first
    let firstModelDone = false;
    const controllers = new Map();

    const finish = (result) => {
        if (finished) return;
        finished = true;
        for (const ctrl of controllers.values()) ctrl.abort();
        settle(result);
    };
    const win = (data, model) => finish({ ok: true, data, model, attempts, tried, hedged });
    const fail = () => finish(fallback
        ? { ok: true, data: fallback.data, model: fallback.model, attempts, tried, hedged }
        : { ok: false, attempts, tried, ...last, busy: isBusy(last.status) });

    const answered = (data, model, index) => {
        const worth = accept(data, model);
        tried.push({ model, status: 200, worth });
        if (worth === 'good') return win(data, model);
        if (worth === 'usable') {
            if (index === 0) return win(data, model);        // nothing better to wait for
            if (!fallback) {
                fallback = { data, model };
                if (firstModelDone) return fail();            // the first model has already given up
                // wait a little for the first model, then use this one
                sleepFn(Math.min(graceMs, Math.max(0, remaining()))).then(() => { if (!finished) win(fallback.data, fallback.model); });
            }
            return;
        }
        last = { status: 200, detail: `unusable answer from ${model}` };       // 'bad'
    };

    const runModel = async (model, index) => {
        running++;
        try {
            for (let attempt = 1; attempt <= 1 + quickRetries; attempt++) {
                if (finished || remaining() < 2000) return;
                attempts++;
                const ctrl = new AbortController();
                controllers.set(`${model}#${attempt}`, ctrl);
                let res;
                try {
                    res = await fetchFn(urlFor(model, apiKey), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(body),
                        signal: makeSignal(ctrl, Math.max(1000, remaining())),
                    });
                } catch (err) {
                    if (finished) return;
                    if (isTimeout(err)) { last = { status: 0, detail: `no answer from ${model} in time` }; tried.push({ model, status: 0, timedOut: true }); return; }
                    last = { status: 0, detail: `network error on ${model}` };
                    tried.push({ model, status: 0 });
                    if (attempt <= quickRetries) await sleepFn(retryWaitMs);
                    continue;
                }
                if (finished) return;

                if (res.ok) {
                    let data;
                    try { data = await res.json(); } catch (err) {
                        if (finished) return;
                        last = { status: isTimeout(err) ? 0 : res.status, detail: `unreadable answer from ${model}` };
                        tried.push({ model, status: res.status });
                        return;
                    }
                    if (finished) return;
                    return answered(data, model, index);
                }

                const text = scrub(await res.text().catch(() => ''));
                last = { status: res.status, detail: `HTTP ${res.status} from ${model}: ${text}` };
                tried.push({ model, status: res.status });
                if (res.status === 404) return;                                          // a model that is gone
                if (res.status === 400 || res.status === 401 || res.status === 403) {    // every model would fail the same way
                    return fail();
                }
                if (RETRY_STATUSES.has(res.status)) {
                    if (attempt <= quickRetries) await sleepFn(retryWaitMs);
                    continue;
                }
                return fail();
            }
        } finally {
            running--;
            if (index === 0) firstModelDone = true;
            afterModel();
        }
    };

    const startNext = () => {
        if (finished || nextModel >= models.length || remaining() < 5000) return false;
        const index = nextModel++;
        runModel(models[index], index);
        return true;
    };

    // When a model ends without a winner: if the first model is done and an unverified answer is waiting, use it;
    // else if nothing is running, start the next model; if there is none left, the call has failed.
    const afterModel = () => {
        if (finished) return;
        if (fallback && firstModelDone) return fail();
        if (running === 0 && !startNext()) fail();
    };

    // The hedge: the next model starts too if the first has not answered in time.
    sleepFn(hedgeAfterMs).then(() => { if (!finished && running > 0 && startNext()) hedged = true; });
    // The one clock: whatever is running is stopped here.
    sleepFn(deadlineMs).then(() => {
        if (finished) return;
        last = { status: last.status, detail: `time budget used (${last.detail})` };
        fail();
    });

    startNext();
    return settled;
}

/* The error a fetch throws when its time limit (AbortSignal.timeout) runs out, or when it is aborted. */
export function isTimeout(err) {
    return err?.name === 'TimeoutError' || err?.name === 'AbortError';
}

/* True when the failure is Google being busy or unreachable, as opposed to a request that is wrong. */
export function isBusy(status) {
    return status === 0 || RETRY_STATUSES.has(status);
}

/* What to tell the person. */
export const BUSY_MESSAGE = 'The AI service is busy right now. Please try again in a few minutes.';
