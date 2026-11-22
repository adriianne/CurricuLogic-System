// stopscan.test.mjs
// Stop: the Cancel button is Stop while the AI is reading (22 Nov 2026). The request is cut, the scan is told it is no longer current,
// whatever comes back later is never read, and the card, file and table are cleared. Esc does the same.
//
//   node --test tests/stopscan.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const builder = readFileSync(new URL('../features/department/curriculum-builder.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../features/department/curriculum-builder.css', import.meta.url), 'utf8');
const between = (a, b) => builder.slice(builder.indexOf(a), builder.indexOf(b, builder.indexOf(a)));

describe('stopScan', () => {
    const fn = between('function stopScan()', '/* Esc stops a scan');
    test('does nothing when no scan is running', () => assert.ok(fn.includes('if (!AI_BUSY) return;')));
    test('moves the scan number on first, so the running scan is stale before anything else happens', () => {
        assert.ok(fn.indexOf('SCAN_RUN++;') < fn.indexOf('LIVE_ABORT?.();'));
        assert.ok(fn.indexOf('SCAN_RUN++;') < fn.indexOf('discardUpload('));
    });
    test('cuts the request that is in flight, then forgets it', () => {
        assert.ok(fn.includes('LIVE_ABORT?.();'));
        assert.ok(fn.includes('LIVE_ABORT = null;'));
    });
    test('clears the file, the card, the bar and the table, and says nothing was saved', () => {
        assert.ok(fn.includes("discardUpload('Scan stopped. Nothing was saved.');"));
    });
    test('it never deletes from the database', () => {
        assert.ok(!/\.delete\(|\.rpc\(|\.insert\(/.test(fn));
    });
});

describe('the request can be cut', () => {
    const post = between('async function postDocument', 'const UPLOAD_STALL_MS');
    test('each try registers a way to abort itself, which aborts the request and answers "cancelled"', () => {
        assert.match(post, /LIVE_ABORT = \(\) => \{ stop\(\); try \{ x\.abort\(\); \} catch \(_\) \{[^}]*\} resolve\(\{ status: 0, data: null, cancelled: true, uploaded \}\); \};/);
    });
    test('a cancelled try is never retried', () => {
        assert.ok(post.includes('if (reply.cancelled || !reply.stalled || n === UPLOAD_TRIES) break;'));
    });
    test('the hook is cleared when the call ends', () => {
        assert.ok(post.includes('LIVE_ABORT = null;\n    return reply;') || /LIVE_ABORT = null;\s+return reply;/.test(post));
    });
});

describe('a scan that was stopped ends quietly', () => {
    const run = between('async function analyzeDocumentRun', 'async function analyzeDocumentSteps');
    const steps = between('async function analyzeDocumentSteps', 'const analyzeDocument = SingleFlight.guard');
    test('every scan takes a number, and an error in a stopped scan turns nothing red', () => {
        assert.ok(run.includes('const myRun = ++SCAN_RUN;'));
        assert.ok(run.includes('await analyzeDocumentSteps(file, myRun);'));
        assert.ok(run.includes('if (myRun !== SCAN_RUN) return;'));
        assert.ok(run.indexOf('if (myRun !== SCAN_RUN) return;') < run.indexOf("failScan(at, 'Something went wrong')"));
    });
    test('stale() means "Stop was pressed or a newer scan began"', () => {
        assert.ok(steps.includes('const stale = () => myRun !== SCAN_RUN;'));
    });
    test('it is checked after every wait: the file read, circle 1, the request, the AI circle, circles 3 to 6 and the final pause', () => {
        assert.ok((steps.match(/if \(stale\(\)\) return;/g) || []).length >= 9);
        assert.ok(steps.includes('if (stale() || reply.cancelled) return;'));
    });
    test('the answer of a stopped request is looked at before any error is shown: nothing turns red', () => {
        assert.ok(steps.indexOf('if (stale() || reply.cancelled) return;') < steps.indexOf("console.error('analyze-curriculum-document failed:'"));
    });
    test('nothing is written to the rows before the first check after the answer (a late answer cannot refill the table)', () => {
        const afterAnswer = steps.slice(steps.indexOf('await inAIStage;               // never leave'));
        assert.ok(afterAnswer.indexOf('if (stale()) return;') < afterAnswer.indexOf('ROWS = [];'));
    });
    test('progress and retry paints stop too, so a stopped scan cannot draw on the cleared card', () => {
        assert.match(steps, /onProgress: \(pct\) => \{\s+if \(stale\(\)\) return;/);
        assert.match(steps, /onRetry: \(n\) => \{\s+if \(stale\(\)\) return;/);
    });
    test('the wait for the AI circle is always released, or a stop in that moment would leave the page locked for good', () => {
        assert.ok(steps.includes('if (stale()) return entered3();'));
        assert.equal((steps.match(/if \(stale\(\)\) return entered3\(\);/g) || []).length, 2);
    });
});

describe('the lock is released however the scan ends', () => {
    test('the single-flight guard still unlocks on end, and a stopped scan returns normally (not by throwing)', () => {
        assert.match(builder, /const analyzeDocument = SingleFlight\.guard\(analyzeDocumentRun, \{\s+onStart: \(\) => setAiBusy\(true\),\s+onEnd: \(\) => setAiBusy\(false\),/);
    });
    test('the label returns to Cancel when the lock is released', () => {
        const fn = between('function setAiBusy(on)', 'function showAiStatus(');
        assert.ok(fn.includes("stop.textContent = on ? 'Stop' : 'Cancel';"));
        assert.ok(fn.includes("stop.classList.toggle('is-stop', on);"));
    });
});

describe('the Esc key', () => {
    const fn = between('let STOP_KEY_BOUND = false;', 'let PENDING_AI_FILE') || between('let STOP_KEY_BOUND = false;', '/* Locks or unlocks');
    test('stops a running scan, and only a running one', () => {
        assert.ok(fn.includes("if (e.key !== 'Escape' || !AI_BUSY) return;"));
        assert.ok(fn.includes('stopScan();'));
    });
    test('leaves Esc to a dialog that is open (it closes that first)', () => {
        assert.ok(fn.includes("if (document.querySelector('.cbp-overlay')) return;"));
    });
    test('is bound once, when the builder is mounted', () => {
        assert.ok(fn.includes('if (STOP_KEY_BOUND) return;'));
        assert.match(builder, /function mount\(supabase, opts\) \{\s+bindStopKey\(\);/);
    });
});

describe('the look', () => {
    test('Stop is red, so it reads as the way out', () => {
        assert.ok(css.includes('.cb-ai-cancel.is-stop { border-color: #DC2626; color: #DC2626; font-weight: 700; }'));
        assert.ok(css.includes('.cb-ai-cancel.is-stop:hover'));
    });
});

describe('the ordering that matters, as plain logic', () => {
    // The scan waits for a promise that the upload-finished callback releases. A stop between the answer and that callback must still release it.
    test('a stop that arrives before the upload finished still lets the scan end', async () => {
        let run = 1; const myRun = 1; const stale = () => myRun !== run;
        let release; const inAIStage = new Promise((r) => { release = r; });
        const onUploaded = () => { if (stale()) return release(); setTimeout(release, 5); };
        run = 2;                                  // Stop
        onUploaded();                             // the upload callback fires after the stop
        await Promise.race([inAIStage, new Promise((_, rej) => setTimeout(() => rej(new Error('hung')), 200))]);
    });
});
