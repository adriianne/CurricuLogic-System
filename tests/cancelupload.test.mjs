// cancelupload.test.mjs
// A Cancel button on the AI upload card (21 Nov 2026): it removes the file, the scan card and the unsaved table, and shows what
// the database holds for the selected year. It asks first when subjects are unsaved, and never deletes anything saved.
//
//   node --test tests/cancelupload.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const builder = readFileSync(new URL('../features/department/curriculum-builder.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../features/department/curriculum-builder.css', import.meta.url), 'utf8');
const between = (a, b) => builder.slice(builder.indexOf(a), builder.indexOf(b, builder.indexOf(a)));

describe('the button', () => {
    const card = between('function aiUploadHtml()', '/* ---- the circles while the scan runs ---- */');
    test('shows while there is a file or a scan result, and is disabled while a scan is being read', () => {
        assert.match(card, /\$\{hasFile \|\| SCAN_REPORT \? `/);
        assert.ok(card.includes('id="ai-cancel"'));
        assert.match(card, /id="ai-cancel" title="Remove the file and clear the table"\$\{AI_BUSY \? ' disabled' : ''\}>Cancel<\/button>/);
    });
    test('Extract Subjects is still there with a file, and not without one', () => {
        assert.match(card, /\$\{hasFile \? `<button class="btn-primary" id="ai-extract"/);
    });
    test('it is locked and unlocked together with the other upload buttons', () => {
        assert.ok(builder.includes("for (const id of ['ai-trash', 'ai-close', 'ai-cancel']) {"));
    });
    test('a click on it calls cancelUpload', () => {
        assert.match(builder, /if \(e\.target\.closest\('#ai-cancel'\)\) \{\s+return cancelUpload\(\);/);
    });
});

describe('what Cancel does', () => {
    const fn = between('function discardUpload()', 'function cancelUpload()');
    test('forgets the file, what the file said, the scan card and the circles, and stops the bar', () => {
        for (const part of ['PENDING_AI_FILE = null;', 'SCAN_DOC = null;', 'SCAN_REPORT = null;', 'SCAN_STAGE = null;', 'stopProgress();']) {
            assert.ok(fn.includes(part), part);
        }
    });
    test('clears the table to blank rows, marks it clean and redraws', () => {
        assert.match(fn, /ROWS = \[\];\s+for \(let i = 0; i < 3; i\+\+\) ROWS\.push\(blank\(1, 1\)\);/);
        assert.ok(fn.includes('markClean();'));
        assert.ok(fn.indexOf('markClean();') < fn.indexOf('render();'));
    });
    test('then shows what the database holds for the selected year, and only if the person has not moved on', () => {
        assert.match(fn, /if \(SELECTED_YEAR !== null && OPTS\.prospectusId\) \{/);
        assert.ok(fn.includes('loadExisting(OPTS.prospectusId)'));
        assert.ok(fn.includes('if (data && ROWS === mine) applyExisting(data);'));
    });
    test('says what happened', () => {
        assert.ok(fn.includes("showAiStatus('Cancelled. The file was removed and the table cleared.', 'success');"));
    });
    test('never deletes from the database', () => {
        assert.ok(!/\.delete\(\)|\.from\('subject'\)\.delete|\.rpc\(/.test(fn));
    });
});

describe('the question before it', () => {
    const fn = between('function cancelUpload()', 'Locks or unlocks the card in place');
    test('does nothing while a scan is being read', () => {
        assert.match(fn, /if \(AI_BUSY\) return;/);
    });
    test('with nothing unsaved it clears at once; with unsaved subjects it asks', () => {
        assert.match(fn, /const unsaved = filled\(\)\.filter\(r => !r\.dbId\)\.length;/);
        assert.match(fn, /if \(!unsaved && !isDirty\(\)\) return discardUpload\(\);/);
        assert.ok(fn.includes('Cancel this upload?'));
        assert.ok(fn.includes('not saved yet'));
    });
    test('the dialog says nothing saved is deleted, and has a safe way out (Keep working, Escape, the close mark)', () => {
        assert.ok(fn.includes('Nothing that is already saved in the database is deleted.'));
        assert.ok(fn.includes('Keep working'));
        assert.ok(fn.includes("e.key === 'Escape'"));
        assert.ok(fn.includes("e.target.closest('.cbp-close')"));
    });
    test('only the confirm button clears, and only one such dialog is ever open', () => {
        assert.match(fn, /if \(e\.target\.closest\('\.cb-cf-yes'\)\) \{ close\(\); discardUpload\(\); \}/);
        assert.ok(fn.includes(".forEach(o => { if (o.querySelector('.cb-cancel')) o.remove(); });"));
    });
    test('its dialog is not mistaken for the Create check (that one removes dialogs marked cb-confirm)', () => {
        assert.ok(!fn.includes('cb-confirm'));
    });
});

describe('the look', () => {
    test('the button, its hover and disabled states, and a red confirm button exist in the stylesheet', () => {
        for (const part of ['.cb-ai-cancel {', '.cb-ai-cancel:hover:not(:disabled)', '.cb-ai-cancel:disabled', '.cb-cf-foot .cb-cf-danger']) {
            assert.ok(css.includes(part), part);
        }
    });
    test('the two buttons sit side by side with a gap', () => {
        assert.match(css, /\.cb-ai-actions \{[^}]*gap: 0\.5rem;/);
    });
});
