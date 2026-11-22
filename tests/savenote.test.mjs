// savenote.test.mjs
// What Create did is said by the buttons, where the person is looking (22 Nov 2026). It used to say it in a green line at the top of the
// page; after a save the table blanked and refilled, nothing visible said it worked, people pressed Create again and read "0 subjects and
// 0 rules created", which sounds like a failure and means "already saved".
//
//   node --test tests/savenote.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const builder = readFileSync(new URL('../features/department/curriculum-builder.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../features/department/curriculum-builder.css', import.meta.url), 'utf8');
const between = (a, b) => builder.slice(builder.indexOf(a), builder.indexOf(b, builder.indexOf(a)));

describe('the note', () => {
    const helpers = between('let SAVE_NOTE = null;', 'function actionsHtml()');
    test('has four kinds: saving, saved, nothing new, and a warning', () => {
        const bar = between('function actionsHtml()', '/* Sits above the manual editing area.');
        for (const k of ['saving', 'saved', 'nothing', 'warn']) assert.ok(bar.includes(`${k}:`), k);
    });
    test('goes away by itself: a short while for the results, longer while saving', () => {
        assert.ok(helpers.includes('SAVE_NOTE_TIMER = setTimeout(clearSaveNote, kind === \'saving\' ? 90000 : ms);'));
        assert.ok(helpers.includes('function setSaveNote(kind, text, ms = 20000)'));
    });
    test('remembers which programme and year it is about', () => {
        assert.ok(helpers.includes('SAVE_NOTE = { kind, text, programId: OPTS?.programId ?? null, prospectusId: OPTS?.prospectusId ?? null };'));
    });
    test('is shown only for that year, so switching year never shows another year\'s "Saved"', () => {
        const bar = between('function actionsHtml()', '/* Sits above the manual editing area.');
        assert.ok(bar.includes('SAVE_NOTE.prospectusId === (OPTS?.prospectusId ?? null) && SAVE_NOTE.programId === (OPTS?.programId ?? null)'));
    });
    test('replaces the hint beside the buttons, and is announced to screen readers', () => {
        const bar = between('function actionsHtml()', '/* Sits above the manual editing area.');
        assert.ok(bar.includes('role="status"'));
        assert.ok(bar.includes('${note || `<span class="cb-hint">'));
    });
    test('its text is escaped', () => {
        assert.ok(between('function actionsHtml()', '/* Sits above').includes('${esc(SAVE_NOTE.text)}'));
    });
});

describe('the Create button says when there is nothing to create', () => {
    const bar = between('function actionsHtml()', '/* Sits above the manual editing area.');
    test('"Saved ✓" only when every row is in the database, no prerequisite is edited and nothing is dirty', () => {
        assert.ok(bar.includes('const settled = n > 0 && !unsaved && !edited && !isDirty();'));
        assert.ok(bar.includes("${settled ? 'Saved \\u2713' : 'Create curriculum'}"));
        assert.ok(bar.includes("${settled ? ' is-saved' : ''}"));
    });
    test('it stays pressable (a press explains), and is still disabled by issues or an empty table', () => {
        assert.ok(bar.includes("id=\"cb-create\" ${bad || !n ? 'disabled' : ''}"));
    });
});

describe('pressing Create with nothing new', () => {
    const fn = between('async function create() {', 'async function createCheck()');
    test('no dialog: it answers by the buttons and scrolls there', () => {
        assert.ok(fn.includes('if (rows.length && !unsaved && !ruleEdits) {'));
        assert.ok(fn.includes('focusActions();\n        return;') || /focusActions\(\);\s+return;/.test(fn));
        assert.ok(fn.indexOf('return;') < fn.indexOf('CREATE_BUSY = true;'));
    });
    test('everything saved: says so plainly, with the count', () => {
        assert.ok(fn.includes("setSaveNote('nothing', `Everything is already saved (${rows.length} subject${rows.length === 1 ? '' : 's'}). Nothing new to create.`);"));
    });
    test('an edit to a saved subject is NOT passed off as saved: it warns, because Create and Save do not store those', () => {
        assert.ok(fn.includes('if (!isDirty()) {'));
        assert.ok(fn.includes("setSaveNote('warn', 'You changed subjects that are already saved."));
        assert.ok(fn.includes('a changed code, title, units or semester is not stored from this table.'));
    });
    test('a prerequisite change on a saved subject still goes through the normal Create', () => {
        assert.ok(fn.includes('const ruleEdits = rows.length ? window.CurriculogicRuleSync.changedRows(rows, RULE_DEPS).length : 0;'));
        assert.ok(fn.includes('!unsaved && !ruleEdits'));
    });
});

describe('saving', () => {
    test('a note says "Saving…" for as long as the save runs, and is cleared if it did not finish', () => {
        const fn = between('async function commit() {', 'async function commitRows()');
        assert.match(fn, /setSaveNote\('saving', 'Saving(…|\\u2026) the table will refresh when it is done\.'\);/);
        assert.ok(fn.includes("if (SAVE_NOTE?.kind === 'saving') clearSaveNote();"));
    });
    test('after a save it says what was saved, scrolls to it, and scrolls again once the saved table is back', () => {
        const tail = builder.slice(builder.indexOf('const n = data.length;'), builder.indexOf('/* ---- entry point ---- */'));
        assert.ok(tail.includes("setSaveNote('saved', `Saved: ${n} subject${n === 1 ? '' : 's'} and ${rules.length} rule${rules.length === 1 ? '' : 's'}.`);"));
        assert.ok(tail.includes('focusActions();\n    setTimeout(focusActions, 900);') || /focusActions\(\);\s+setTimeout\(focusActions, 900\);/.test(tail));
        assert.ok(tail.indexOf("setSaveNote('saved'") < tail.indexOf('OPTS.onDone?.('));
    });
    test('the page\'s own message at the top is still sent', () => {
        assert.ok(builder.includes('OPTS.onDone?.(`${n} subjects and ${rules.length} rules created.`'));
    });
});

describe('when the note goes away', () => {
    test('on the next edit, but never while it is still saving', () => {
        assert.match(builder, /MOUNT\.addEventListener\('input',  \(\) => \{\s+if \(SAVE_NOTE && SAVE_NOTE\.kind !== 'saving'\) clearSaveNote\(\);/);
    });
    test('with a new scan and a cancelled upload', () => {
        assert.ok(builder.includes("if (SAVE_NOTE && SAVE_NOTE.kind !== 'saving') clearSaveNote();      // a new scan: what the last save said is old news"));
        const discard = between('function discardUpload(', 'function stopScan()');
        assert.ok(discard.includes("if (SAVE_NOTE && SAVE_NOTE.kind !== 'saving') clearSaveNote();"));
    });
    test('on a move to another year or programme, but it survives the re-mount that follows a save', () => {
        const mount = between('function mount(supabase, opts) {', 'SB    = supabase;');
        assert.ok(builder.includes('SAVE_NOTE.programId !== (opts.programId ?? null) || SAVE_NOTE.prospectusId !== (opts.prospectusId ?? null)'));
        assert.ok(mount.length > 0);
    });
});

describe('the look', () => {
    test('each kind has its own colour, and the note slides in unless motion is reduced', () => {
        for (const k of ['is-saved', 'is-nothing', 'is-warn', 'is-saving']) assert.ok(css.includes(`.cb-note.${k}`), k);
        assert.ok(css.includes('@keyframes cb-note-in'));
        assert.match(css, /prefers-reduced-motion: reduce\) \{ \.cb-note \{ animation: none !important; \} \}/);
    });
    test('the settled Create button is quiet, not a loud call to action', () => {
        assert.ok(css.includes('.cb .cb-actions .btn-primary.is-saved,') && css.includes('background: transparent; color: #047857;'));
    });
});
