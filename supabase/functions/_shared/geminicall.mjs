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
