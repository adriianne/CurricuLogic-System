// scanprogress.test.mjs
// The circles while a scan runs (extractioncheck.js progress() / progressItems(), and how curriculum-builder.js drives them).
//
//   node --test tests/scanprogress.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const X = require('../shared/js/curriculum/extractioncheck.js');
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const builder = read('features/department/curriculum-builder.js');
const css = read('features/department/curriculum-builder.css');

const status = (state) => X.progress(state).map((s) => s.status).join(' ');

describe('progress(): which circle is where', () => {
    test('there are six, named for what the scan really does', () => {
        assert.deepEqual(X.progress({ stage: 1 }).map((s) => s.title),
            ['PDF read', 'Sent', 'AI reading', 'Table built', 'Totals checked', 'Ready']);
    });
    test('the first circle pulses at the start and the rest wait', () => {
        assert.equal(status({ stage: 1 }), 'run wait wait wait wait wait');
    });
    test('while the AI reads, 1 and 2 are done, 3 pulses, the rest wait', () => {
        assert.equal(status({ stage: 3, seconds: 12 }), 'ok ok run wait wait wait');
    });
    test('the answer ticks 4, 5 and 6 off one after another, then all six are done', () => {
        assert.equal(status({ stage: 4 }), 'ok ok ok run wait wait');
        assert.equal(status({ stage: 5 }), 'ok ok ok ok run wait');
        assert.equal(status({ stage: 6 }), 'ok ok ok ok ok run');
        assert.equal(status({ stage: 7 }), 'ok ok ok ok ok ok');
    });
    test('a failure turns that circle red, keeps the ones before it done and leaves the rest waiting', () => {
        assert.equal(status({ stage: 3, failedAt: 3, message: 'The AI was busy' }), 'ok ok fail wait wait wait');
        assert.equal(status({ stage: 1, failedAt: 1 }), 'fail wait wait wait wait wait');
        assert.equal(status({ stage: 4, failedAt: 4 }), 'ok ok ok fail wait wait');
    });
    test('a failed circle says why, in the words it was given, or a plain default', () => {
        assert.equal(X.progress({ stage: 3, failedAt: 3, message: 'The AI was busy' })[2].detail, 'The AI was busy');
        assert.equal(X.progress({ stage: 3, failedAt: 3 })[2].detail, 'Did not finish');
    });
    test('the marks: a tick when done, a cross when stopped, the number while waiting, nothing in the one pulsing', () => {
        const s = X.progress({ stage: 3 });
        assert.deepEqual(s.map((x) => x.mark), ['✓', '✓', '', '4', '5', '6']);
        assert.equal(X.progress({ stage: 2, failedAt: 2 })[1].mark, '✕');
    });
});

describe('progress(): the seconds, and the long wait', () => {
    test('the AI circle counts whole seconds', () => {
        assert.equal(X.progress({ stage: 3, seconds: 0 })[2].detail, 'Reading… 0 s');
        assert.equal(X.progress({ stage: 3, seconds: 42.9 })[2].detail, 'Reading… 42 s');
    });
    test('after a minute it says so in words instead of looking stuck', () => {
        assert.equal(X.SLOW_AFTER, 60);
        assert.equal(X.progress({ stage: 3, seconds: 59 })[2].detail, 'Reading… 59 s');
        assert.equal(X.progress({ stage: 3, seconds: 60 })[2].detail, 'Still reading. Long documents can take a minute and a half.');
        assert.equal(X.progress({ stage: 3, seconds: 95 })[2].detail, 'Still reading. Long documents can take a minute and a half.');
    });
    test('seconds are shown only on the circle that is reading, and never negative', () => {
        assert.ok(!X.progress({ stage: 4, seconds: 30 })[2].detail.includes('Reading…'));
        assert.equal(X.progress({ stage: 3, seconds: -5 })[2].detail, 'Reading… 0 s');
    });
    test('nonsense in does not throw and starts at the first circle', () => {
        assert.doesNotThrow(() => X.progress(null));
        assert.doesNotThrow(() => X.progress('x'));
        assert.equal(status(null), 'run wait wait wait wait wait');
        assert.equal(status({ stage: 99 }), 'ok ok ok ok ok ok');
        assert.equal(status({ stage: -4 }), 'run wait wait wait wait wait');
    });
});

describe('progressItems(): the markup', () => {
    test('one item per circle with its class, mark, title and words', () => {
        const h = X.progressItems({ stage: 3, seconds: 7 });
        assert.equal((h.match(/class="cb-step is-/g) || []).length, 6);
        assert.ok(h.includes('class="cb-step is-run"'));
        assert.ok(h.includes('<strong>AI reading</strong><span>Reading… 7 s</span>'));
        assert.ok(h.includes('class="cb-step-dot" aria-hidden="true">✓'));
    });
    test('a screen reader hears each circle\'s state', () => {
        const h = X.progressItems({ stage: 3, failedAt: 0 });
        assert.ok(h.includes('Done.') && h.includes('In progress.') && h.includes('Waiting.'));
        assert.ok(X.progressItems({ stage: 3, failedAt: 3 }).includes('Stopped.'));
    });
    test('the failure message is escaped', () => {
        const h = X.progressItems({ stage: 3, failedAt: 3, message: '<img src=x onerror=alert(1)>' });
        assert.ok(!h.includes('<img'));
        assert.ok(h.includes('&lt;img'));
    });
});

describe('the builder drives the circles from real events', () => {
    const run = builder.slice(builder.indexOf('async function analyzeDocumentRun'), builder.indexOf('const analyzeDocument = SingleFlight.guard'));

    test('a scan starts at circle 1 (PDF read), and circle 1 is finished and seen before circle 2 begins', () => {
        assert.ok(/SCAN_STAGE = null;[\s\S]{0,200}\/\/ 1 PDF read[^\n]*\n\s+setScanStage\(1\);/.test(run));
        assert.ok(run.includes('await finishStage(1, began);'));
        assert.ok(run.indexOf('await finishStage(1, began);') < run.indexOf('postDocument(base64'));
    });
    test('circle 2 (Sent) is the real upload: its percentage is the upload\'s, and it ends when the last byte is sent', () => {
        assert.ok(run.includes('SCAN_STAGE.uploadPct = pct;'));
        assert.ok(builder.includes('x.upload.onprogress'));
        assert.ok(/x\.upload\.onload = \(\) => \{ uploaded = true; stop\(\); onUploaded\(\); \};/.test(builder));
        const up = run.slice(run.indexOf('onUploaded: () => {'), run.indexOf('if (reply.status === 0'));
        assert.ok(up.includes('finishStage(2, uploadStarted)'));
        assert.ok(up.includes('SCAN_STAGE = { ...SCAN_STAGE, t3: Date.now() };'));     // the AI circle counts from here
    });
    test('the stages are entered one at a time, in order, with nothing skipped', () => {
        const order = ['setScanStage(1);', 'await finishStage(1, began);', 'finishStage(2, uploadStarted)', 'await finishStage(3, began);',
                       'await finishStage(4, began);', 'await finishStage(5, began);', 'await finishStage(6, began);'];
        let at = -1;
        for (const marker of order) {
            const i = run.indexOf(marker);
            assert.ok(i > at, `${marker} is out of order or missing`);
            at = i;
        }
    });
    test('every stage is held on screen at least MIN_STEP_MS, so a fast one is seen and never skipped', () => {
        assert.ok(builder.includes('const MIN_STEP_MS = 450;'));
        const fin = builder.slice(builder.indexOf('async function finishStage'), builder.indexOf('/* Sends the PDF to the reader'));
        assert.ok(fin.includes('MIN_STEP_MS - (Date.now() - startedAt)'));
        assert.ok(fin.includes('setScanStage(n + 1);'));
    });
    test('the work of stages 4, 5 and 6 happens inside them, not after a timer', () => {
        const s4 = run.slice(run.indexOf('TAB = ROWS.find'), run.indexOf('await finishStage(4, began);'));
        assert.ok(s4.includes('validate();'));
        const s5 = run.slice(run.indexOf('await finishStage(4, began);'), run.indexOf('await finishStage(5, began);'));
        assert.ok(s5.includes('CurriculogicExtractionCheck?.check(') && s5.includes('CurriculogicExtractionCheck?.overview('));
        const s6 = run.slice(run.indexOf('await finishStage(5, began);'), run.indexOf('await finishStage(6, began);'));
        assert.ok(s6.includes('const needsLook') && s6.includes('const needFixing'));
        assert.ok(!run.includes('for (const stage of [4, 5, 6])'));
    });
    test('a network failure before the last byte is sent turns circle 2 red; after it, circle 3', () => {
        assert.ok(run.includes("failScan(uploaded ? 3 : 2, uploaded ? 'Connection lost' : 'Could not send the file')"));
    });
    test('anything unexpected turns the circle that was running red, instead of a card that just stops', () => {
        const wrap = builder.slice(builder.indexOf('async function analyzeDocumentRun'), builder.indexOf('async function analyzeDocumentSteps'));
        assert.ok(wrap.includes('await analyzeDocumentSteps(file, myRun);'));
        assert.ok(wrap.includes('failScan(at, \'Something went wrong\')'));
        assert.ok(wrap.includes('SCAN_STAGE.stage >= 1 && SCAN_STAGE.stage <= 6'));
    });
    test('without a session it falls back to the client\'s own call (the file counts as sent when that starts)', () => {
        const post = builder.slice(builder.indexOf('async function postDocument'), builder.indexOf('async function analyzeDocumentRun'));
        assert.ok(post.includes("SB.functions.invoke('analyze-curriculum-document'"));
        assert.ok(post.includes('!token || !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY'));
    });
    test('each way a scan can stop turns the right circle red, and only after the timer is stopped', () => {
        assert.ok(run.includes("failScan(1, 'Could not read the file')"));
        assert.ok(run.includes('failScan(3, why)'));
        assert.ok(run.includes("failScan(3, 'This does not look like a curriculum')"));
        assert.ok(run.includes("failScan(4, 'No subjects could be read')"));
        for (const m of run.matchAll(/stopProgress\(\);\s+(?:const why[\s\S]{0,200}?)?failScan\(/g)) assert.ok(m[0].includes('failScan('));
    });
    test('after stage 6 all six are green and the bar is 100%, held for a beat, before the result takes over', () => {
        const end = run.slice(run.indexOf('await finishStage(6, began);'));
        assert.ok(end.indexOf('finishProgress();') > 0);
        assert.ok(end.indexOf('finishProgress();') < end.indexOf('setTimeout(r, 700)'));
        assert.ok(end.indexOf('setTimeout(r, 700)') < end.indexOf('SCAN_STAGE = null;'));
        assert.ok(end.indexOf('SCAN_STAGE = null;') < end.indexOf('render();'));
    });
    test('the live circles are cleared when the result\'s circles appear, so only one row shows', () => {
        const end = run.slice(run.indexOf('await finishStage(6, began);'));
        assert.ok(end.includes('SCAN_STAGE = null;'));
        assert.ok(end.includes('render();'));
    });
    test('the circles are part of the card, so a redraw keeps them, and they sit under the status line', () => {
        const card = builder.slice(builder.indexOf('function aiUploadHtml'), builder.indexOf('/* ---- the circles while the scan runs ---- */'));
        assert.ok(card.indexOf('id="ai-analyze-status"') < card.indexOf('${scanStepsHtml()}'));
        assert.ok(card.indexOf('${scanStepsHtml()}') < card.indexOf('${scanReportHtml()}'));
    });
    test('the seconds repaint once a second, only while the AI circle is running', () => {
        const tick = builder.slice(builder.indexOf('PROGRESS_TIMER = setInterval('), builder.indexOf('function finishProgress'));
        assert.ok(tick.includes('SCAN_STAGE.stage === 3'));
        assert.ok(tick.includes('!SCAN_STAGE.failedAt'));
        assert.ok(tick.includes('sec !== SCAN_LAST_SEC'));
    });
    test('the percentage bar follows the circles: each stage owns a stretch, it never goes back and never reaches 100 early', () => {
        const tick = builder.slice(builder.indexOf('PROGRESS_TIMER = setInterval('), builder.indexOf('function finishProgress'));
        assert.ok(tick.includes('const st = SCAN_STAGE;'));
        assert.ok(tick.includes('st.stage === 1') && tick.includes('st.stage === 2') && tick.includes('st.stage === 3'));
        assert.ok(tick.includes('8 + 0.12 * (st.uploadPct ?? 0)'));                  // the real upload fills 8 to 20
        assert.ok(tick.includes('Math.min(Math.max(PROGRESS_VALUE, next), 99)'));      // monotonic, below 100
        assert.ok(!tick.includes('elapsed < 2'));                                      // the old clock is gone
    });
    test('the bar\'s estimate (the AI\'s reading, which cannot be measured) never passes the start of stage 4', () => {
        // 20 + 68 * (1 - e^(-t/40)) tends to 88; stage 4 starts at 92
        const limit = 20 + 68;
        assert.ok(limit < 92);
        assert.ok(builder.includes('20 + 68 * (1 - Math.exp(-sec / 40))'));
    });
    test('removing the file or choosing another clears the circles of an earlier scan', () => {
        assert.ok(builder.slice(builder.indexOf('function clearAiFile'), builder.indexOf('function clearAiFile') + 400).includes('SCAN_STAGE = null;'));
        assert.ok(builder.includes('SCAN_STAGE = null;     // a new file'));
    });
    test('paintScanSteps looks the list up each time and adds it under the status line if the card has not drawn it', () => {
        const p = builder.slice(builder.indexOf('function paintScanSteps'), builder.indexOf('function setScanStage'));
        assert.ok(p.includes("document.getElementById('ai-steps')"));
        assert.ok(p.includes("insertAdjacentHTML('afterend', scanStepsHtml())"));
    });
    test('the pick-a-file box is not on screen while a scan runs, and Extract and Remove are locked (already true, kept true)', () => {
        const card = builder.slice(builder.indexOf('function aiUploadHtml'), builder.indexOf('/* ---- the circles while the scan runs ---- */'));
        assert.ok(card.includes("id=\"ai-trash\" aria-label=\"Remove file\"${AI_BUSY ? ' disabled' : ''}"));
        assert.ok(card.includes("id=\"ai-extract\"${AI_BUSY ? ' disabled' : ''}"));
    });
});

describe('the styles for the live circles', () => {
    test('pulsing, waiting and stopped states exist, with a still ring for reduced motion', () => {
        for (const c of ['.cb-step.is-wait .cb-step-dot', '.cb-step.is-fail .cb-step-dot', '.cb-step.is-run .cb-step-dot',
                         '@keyframes cb-pulse', '@media (prefers-reduced-motion: reduce)', '.cb-steps-live']) {
            assert.ok(css.includes(c), c);
        }
        const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
        assert.ok(reduced.includes('animation: none'));
    });
});

describe('what the circle in progress says (the words follow the work)', () => {
    test('each running circle says what it is doing now', () => {
        const words = [1, 2, 3, 4, 5, 6].map((n) => X.progress({ stage: n, seconds: 5 })[n - 1].detail);
        assert.deepEqual(words, ['Reading the file\u2026', 'Uploading\u2026', 'Reading\u2026 5 s', 'Building the table\u2026', 'Comparing with the totals\u2026', 'Getting the rows ready\u2026']);
    });
    test('the upload shows its real percentage, kept between 0 and 100', () => {
        assert.equal(X.progress({ stage: 2, uploadPct: 63 })[1].detail, 'Uploading\u2026 63%');
        assert.equal(X.progress({ stage: 2, uploadPct: 140 })[1].detail, 'Uploading\u2026 100%');
        assert.equal(X.progress({ stage: 2, uploadPct: -5 })[1].detail, 'Uploading\u2026 0%');
        assert.equal(X.progress({ stage: 2, uploadPct: 'x' })[1].detail, 'Uploading\u2026');
    });
    test('a finished circle goes back to its result words, so the row reads as a record of what happened', () => {
        const done = X.progress({ stage: 5, uploadPct: 100, seconds: 41 });
        assert.deepEqual(done.slice(0, 4).map((s) => s.detail), ['In your browser', 'To the server', 'Reading the document', 'Subjects and prerequisites']);
    });
});

describe('a scan that gets no answer: a timeout is not a lost connection', () => {
    const post = builder.slice(builder.indexOf('async function postDocument'), builder.indexOf('async function analyzeDocumentRun'));
    const steps = builder.slice(builder.indexOf('async function analyzeDocumentSteps'), builder.indexOf('const analyzeDocument = SingleFlight.guard'));
    test('the net is longer than the server\'s own limit plus a slow upload, so the server answers first', () => {
        const ms = Number(post.match(/x\.timeout = (\d+);/)[1]);
        const serverLimit = 160, slowUpload = 30;           // seconds, as seen on 21 Nov 2026 (160 s runs, 25 s uploads)
        assert.ok(ms >= (serverLimit + slowUpload + 30) * 1000, `${ms} ms is too short`);
    });
    test('a timeout is reported on its own, with its own words, on the AI circle', () => {
        assert.ok(/x\.ontimeout = \(\) => \{ stop\(\); resolve\(\{ status: 0, data: null, networkError: true, timedOut: true, uploaded \}\); \};/.test(post));
        assert.ok(steps.includes('if (reply.timedOut) {'));
        assert.ok(steps.includes("failScan(3, 'The AI took too long to answer')"));
        assert.ok(steps.includes('The AI took too long to answer. Please try again in a few minutes.'));
    });
    test('the timeout is handled before the lost-connection case, and a lost connection keeps its own words', () => {
        assert.ok(steps.indexOf('if (reply.timedOut) {') < steps.indexOf('if (reply.networkError) {'));
        assert.ok(steps.includes('The connection was lost while the AI was reading. Please try again.'));
    });
});

describe('an upload that stalls is retried instead of waited for (21 Nov 2026: 96% for over two minutes, nothing reached the server)', () => {
    const post = builder.slice(builder.indexOf('async function postDocument'), builder.indexOf('async function analyzeDocumentRun'));
    const steps = builder.slice(builder.indexOf('async function analyzeDocumentSteps'), builder.indexOf('const analyzeDocument = SingleFlight.guard'));
    test('a watchdog cancels an upload that has made no progress for 30 s before the last byte, and says it stalled', () => {
        assert.ok(post.includes('const UPLOAD_STALL_MS = 30000;'));
        assert.ok(post.includes('Date.now() - lastMoved > UPLOAD_STALL_MS'));
        assert.ok(post.includes('x.abort();'));
        assert.ok(post.includes('stalled: true'));
    });
    test('the stall limit is above the normal pause near the end of an upload (10 to 20 s) and well below the 300 s net', () => {
        const ms = Number(post.match(/const UPLOAD_STALL_MS = (\d+);/)[1]);
        assert.ok(ms >= 25000 && ms <= 60000, String(ms));
    });
    test('progress moves the watchdog; the last byte stops it (a slow AI is not a stall)', () => {
        assert.ok(post.includes('x.upload.onprogress = (e) => {\n            lastMoved = Date.now();') || /onprogress = \(e\) => \{\s+lastMoved = Date\.now\(\);/.test(post));
        assert.ok(/x\.upload\.onload = \(\) => \{ uploaded = true; stop\(\); onUploaded\(\); \};/.test(post));
        assert.ok(post.includes('if (!uploaded && Date.now() - lastMoved'));
    });
    test('only a stalled upload is retried, each time on a new connection, at most three tries', () => {
        assert.ok(post.includes('const UPLOAD_TRIES = 3;'));
        assert.ok(post.includes('for (let n = 1; n <= UPLOAD_TRIES; n++) {'));
        assert.ok(post.includes('if (reply.cancelled || !reply.stalled || n === UPLOAD_TRIES) break;'));
        assert.ok(post.includes('onRetry(n + 1);'));
        assert.equal((post.match(/new XMLHttpRequest\(\)/g) || []).length, 1);        // made inside attempt(), so once per try
    });
    test('the page tells the person, and circle 2 starts again from 0% saying so', () => {
        assert.ok(steps.includes('SCAN_STAGE.uploadPct = 0; SCAN_STAGE.retry = n;'));
        assert.ok(steps.includes('The upload stalled. Trying again (${n} of ${UPLOAD_TRIES})'));
        assert.equal(X.progress({ stage: 2, uploadPct: 0, retry: 2 })[1].detail, 'Stalled. Trying again (2 of 3)\u2026');
        assert.equal(X.progress({ stage: 2, uploadPct: 40, retry: 3 })[1].detail, 'Trying again\u2026 40%');
        assert.equal(X.progress({ stage: 2, uploadPct: 40 })[1].detail, 'Uploading\u2026 40%');
    });
    test('three stalls turn circle 2 red with its own words; the AI is never blamed for an upload that did not arrive', () => {
        assert.ok(steps.includes("failScan(2, 'The upload kept stalling')"));
        assert.ok(steps.includes("failScan(2, 'The upload took too long')"));
        assert.ok(steps.indexOf('if (reply.stalled) {') < steps.indexOf('if (reply.timedOut) {'));
        assert.ok(steps.includes('if (reply.timedOut && !reply.uploaded) {'));
    });
    test('the previous scan\'s result card is removed from the page the moment a new scan starts', () => {
        assert.ok(steps.includes("document.querySelector('.cb-scan')?.remove();"));
        assert.ok(steps.indexOf("document.querySelector('.cb-scan')?.remove();") < steps.indexOf('setScanStage(1);'));
    });
});
