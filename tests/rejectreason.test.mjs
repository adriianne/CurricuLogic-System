// rejectreason.test.mjs
// The reason a faculty adviser must give when rejecting a subject or a plan (shared/js/enrolment/rejectreason.js).
//
//   node --test tests/rejectreason.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const RR = require('../shared/js/enrolment/rejectreason.js');
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

describe('validate: a reason is required', () => {
    test('empty or blank is refused, with a message that says why', () => {
        for (const v of ['', '   ', null, undefined, '\n\t']) {
            const r = RR.validate(v);
            assert.equal(r.ok, false);
            assert.match(r.error, /student needs to know what to fix/);
        }
    });
    test('trimmed text is accepted', () => {
        assert.deepEqual(RR.validate('  Take PE 1 first.  '), { ok: true, text: 'Take PE 1 first.', error: null });
    });
    test('500 characters is the limit the database allows (db/050)', () => {
        assert.equal(RR.MAX, 500);
        assert.equal(RR.validate('x'.repeat(500)).ok, true);
        const long = RR.validate('x'.repeat(501));
        assert.equal(long.ok, false);
        assert.match(long.error, /501 characters.*under 500/);
    });
});

describe('quick picks', () => {
    test('each reason has a label and a starter sentence, and "Other" starts empty', () => {
        assert.deepEqual(RR.REASONS.map(r => r.key), ['prereq', 'clash', 'full', 'load', 'term', 'other']);
        for (const r of RR.REASONS.filter(r => r.key !== 'other')) {
            assert.ok(r.label.length > 3);
            assert.ok(r.text.length > 20, r.key + ' needs a real sentence');
            assert.ok(r.text.length <= RR.MAX);
        }
        assert.equal(RR.starter('other'), '');
        assert.equal(RR.starter('nope'), '');
    });
    test('every starter sentence tells the student what to do next, not just what went wrong', () => {
        for (const key of ['clash', 'full', 'load']) assert.match(RR.starter(key), /Please/);
        assert.match(RR.starter('prereq'), /prerequisite/i);
    });
    test('every starter passes validation by itself', () => {
        for (const r of RR.REASONS.filter(r => r.key !== 'other')) assert.equal(RR.validate(r.text).ok, true);
    });
});

describe('merge: a pick never throws away what the adviser wrote', () => {
    test('an empty box takes the sentence', () => {
        assert.equal(RR.merge('', null, 'clash'), RR.starter('clash'));
    });
    test('a box still holding the previous pick unedited is replaced', () => {
        assert.equal(RR.merge(RR.starter('clash'), 'clash', 'full'), RR.starter('full'));
    });
    test('text the adviser typed is kept and the sentence is added after it', () => {
        const merged = RR.merge('MATH 101 needs MATH 100.', null, 'prereq');
        assert.ok(merged.startsWith('MATH 101 needs MATH 100.'));
        assert.ok(merged.endsWith(RR.starter('prereq')));
    });
    test('the same sentence is not added twice', () => {
        const once = RR.merge('Note. ', null, 'full');
        assert.equal(RR.merge(once, 'full', 'full'), once);
    });
    test('"Other" leaves typed text alone and clears an unedited sentence', () => {
        assert.equal(RR.merge('My own words.', 'clash', 'other'), 'My own words.');
        assert.equal(RR.merge(RR.starter('clash'), 'clash', 'other'), '');
    });
});

describe('the Faculty page', () => {
    const js = read('features/faculty/facultydashboard.js');
    test('rejecting one subject asks for the reason in the dialog, and a cancel changes nothing', () => {
        assert.match(js, /await window\.CurriculogicRejectReason\.ask\(\{\s*title: 'Reject this subject'/);
        assert.match(js, /if \(reason === null\) return;\s*return reviewRequestItem\(itemId, 'rejected', reason\)/);
    });
    test('all three rejections open filled in from what the system found for that subject or plan', () => {
        assert.match(js, /initial: await warnedNoteForItem\(itemId\)/);
        assert.match(js, /initial: window\.CurriculogicSystemCheck\.rejectNote\(found, window\.ScheduleConflicts\?\.meetingsClash\)/);
        assert.match(js, /initial: starts\.get\(item\.id\)/);
    });
    test('the plan is read before the dialog opens, so the note can be built from it', () => {
        const bulk = js.slice(js.indexOf('async function reviewRequestBulk'));
        assert.ok(bulk.indexOf(".from('request_item')") < bulk.indexOf('CurriculogicRejectReason.ask'));
    });
    test('rejecting a whole plan uses the same dialog', () => {
        assert.match(js, /await window\.CurriculogicRejectReason\.ask\(\{\s*title: 'Reject this plan'/);
    });
    test('no plain browser prompt is left for a rejection', () => {
        const prompts = js.match(/window\.prompt\([^)]*\)/g) || [];
        assert.equal(prompts.length, 1);                              // the optional "approve with a note" box
        assert.match(prompts[0], /Note for the student and the Registrar/);
    });
    test('the script is loaded by the page', () => {
        assert.match(read('features/faculty/facultydashboard.html'), /rejectreason\.js/);
    });
});

describe('ask: the dialog opens and the confirm button follows the text box', () => {
    // A tiny stand-in for the page: just enough for ask() to build, open and read the dialog.
    // ask() keeps its dialog between calls, so the stand-in is built once and reused.
    let shared = null;
    function fakePage() {
        if (shared) { shared.parts['#rej-text'].value = ''; return shared; }
        const listeners = {};
        const el = (extra) => Object.assign({
            value: '', textContent: '', disabled: true, focus() {}, setSelectionRange() {},
            addEventListener(type, fn) { (listeners[this.name + ':' + type] ||= []).push(fn); },
            setAttribute() {}, querySelectorAll() { return []; },
        }, extra);
        const parts = {
            '#rej-text': el({ name: 'text' }), '#rej-count': el({ name: 'count' }),
            '#rej-err': el({ name: 'err' }), '#rej-ok': el({ name: 'ok' }),
            '.rej-chips': el({ name: 'chips' }), form: el({ name: 'form' }),
        };
        const dlg = el({
            name: 'dlg', open: false, className: '', innerHTML: '',
            querySelector(s) { return parts[s] || el({ name: s }); },
            querySelectorAll() { return []; },
            showModal() { this.open = true; }, close() { this.open = false; },
        });
        globalThis.document = { createElement: () => dlg, body: { appendChild() {} } };
        shared = { dlg, parts, fire: (name, type, ev) => (listeners[name + ':' + type] || []).forEach(f => f(ev || {})) };
        return shared;
    }

    test('it opens the dialog, with the confirm button off while the box is empty', async () => {
        const page = fakePage();
        const pending = RR.ask({ title: 'Reject this plan', confirm: 'Reject plan' });
        assert.equal(page.dlg.open, true);
        assert.equal(page.parts['#rej-ok'].disabled, true);
        page.parts['#rej-text'].value = 'Pick another section.';
        page.fire('text', 'input');
        assert.equal(page.parts['#rej-ok'].disabled, false);
        assert.equal(page.parts['#rej-count'].textContent, '21 / ' + RR.MAX);
        page.fire('ok', 'click');
        assert.equal(await pending, 'Pick another section.');
    });

    test('a reason over the limit turns the button off and shows the message', async () => {
        const page = fakePage();
        const pending = RR.ask({});
        page.parts['#rej-text'].value = 'x'.repeat(RR.MAX + 1);
        page.fire('text', 'input');
        assert.equal(page.parts['#rej-ok'].disabled, true);
        assert.match(page.parts['#rej-err'].textContent, /characters/);
        page.fire('dlg', 'cancel', { preventDefault() {} });
        assert.equal(await pending, null);
    });
});

describe('ask: opening with a note already filled in', () => {
    // Same stand-in as above, built fresh (the dialog is kept between calls, so this file's first block already made it).
    test('the box starts with the note and the button is on; the next dialog without one starts empty', async () => {
        const doc = globalThis.document;
        assert.ok(doc, 'the block above leaves its stand-in page in place');
        const dlg = doc.createElement('dialog');
        const text = dlg.querySelector('#rej-text');
        const ok = dlg.querySelector('#rej-ok');

        const first = RR.ask({ initial: 'IT-WEBDEV11: CC-INTCOM11 must be passed first.' });
        assert.equal(text.value, 'IT-WEBDEV11: CC-INTCOM11 must be passed first.');
        assert.equal(ok.disabled, false);
        assert.match(dlg.innerHTML, /Filled in from what the system found/);
        dlg.querySelector('form'); // (the dialog is closed by its cancel button in the page; here it is simply replaced)

        RR.ask({});
        assert.equal(text.value, '');
        assert.equal(ok.disabled, true);
        assert.doesNotMatch(dlg.innerHTML, /Filled in from what the system found/);
        void first;
    });
});
