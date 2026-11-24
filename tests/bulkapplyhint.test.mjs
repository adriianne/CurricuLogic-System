// bulkapplyhint.test.mjs
// 24 Nov 2026: in Admin -> Staff management -> "Set programmes", Apply stays greyed until the choice has been previewed and the preview found a
// change. With no reason shown it looked broken ("assigning several programmes cannot be applied"). The footer now says what to do next.
//
//   node --test tests/bulkapplyhint.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const H = require('../shared/js/accounts/bulkapplyhint.js');
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

const state = (o) => ({ chosen: 1, busy: false, done: false, previewKey: null, key: 'add|22|1,2', previewChanged: 0, ...o });

describe('nextStep', () => {
    test('programmes chosen but not previewed: press Preview first', () => {
        assert.equal(H.nextStep(state({})), 'press Preview first, then Apply');
    });
    test('the choice changed after a preview (another programme ticked): preview again', () => {
        assert.equal(H.nextStep(state({ previewKey: 'add|22|1', key: 'add|22|1,2', previewChanged: 7 })), 'press Preview first, then Apply');
    });
    test('previewed, and it would change something: ready to apply', () => {
        assert.equal(H.nextStep(state({ previewKey: 'add|22|1,2', previewChanged: 7 })), 'ready: press Apply');
    });
    test('previewed, nothing would change: says so, since Apply stays off', () => {
        assert.equal(H.nextStep(state({ previewKey: 'add|22|1,2', previewChanged: 0 })), 'nothing would change, so there is nothing to apply');
    });
    test('nothing ticked: the footer already says "Choose at least one programme", so no extra phrase', () => {
        assert.equal(H.nextStep(state({ chosen: 0 })), '');
    });
    test('while a preview or an apply is running, and after it is applied: no phrase', () => {
        assert.equal(H.nextStep(state({ busy: true })), '');
        assert.equal(H.nextStep(state({ done: true, previewKey: 'add|22|1,2', previewChanged: 7 })), '');
    });
    test('no arguments does not throw', () => {
        assert.equal(H.nextStep(), '');
    });
});

describe('wiring on the Staff management page', () => {
    const js = read('features/admin/admindashboard.js');
    const html = read('features/admin/admindashboard.html');
    test('the module loads before the page script', () => {
        assert.ok(html.indexOf('shared/js/accounts/bulkapplyhint.js') > 0);
        assert.ok(html.indexOf('shared/js/accounts/bulkapplyhint.js') < html.indexOf('src="admindashboard.js"'));
    });
    test('the footer count carries the phrase, and the greyed Apply button carries it as its tooltip', () => {
        const fn = js.slice(js.indexOf('function bdRender()'), js.indexOf('/* The answer of bulk_set_staff_programs'));
        assert.ok(fn.includes('CurriculogicBulkApplyHint?.nextStep('));
        assert.ok(fn.includes("chosen${next ? ' · ' + next : ''}"));
        assert.ok(fn.includes("$('bulk-dlg-apply').title = $('bulk-dlg-apply').disabled && next"));
    });
    test('the rule for enabling Apply is unchanged (a current preview that found a change)', () => {
        assert.ok(js.includes("$('bulk-dlg-apply').disabled = BD.busy || BD.done || BD.previewKey !== bdKey() || BD.previewChanged === 0;"));
    });
    test('the page still works if the module is missing (the phrase is just empty)', () => {
        assert.ok(js.includes("}) ?? '';"));
    });
});
