// dashboardsummary.test.mjs
// The status sentence and the "Needs attention" list of the Registrar and Faculty dashboards.
//
//   node --test tests/dashboardsummary.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const DS = require('../shared/js/dashboardsummary.js');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

describe('the sentence', () => {
    test('joins what there is to say and ends with a full stop', () => {
        assert.equal(DS.sentence(['3 requests waiting', 'the oldest has waited 5 days'], 'x'),
            '3 requests waiting · the oldest has waited 5 days.');
    });

    test('the first word is capitalised, the rest is left alone', () => {
        assert.equal(DS.sentence(['the schedule is not published yet'], 'x'), 'The schedule is not published yet.');
    });

    test('nothing to say gives the fallback, as given', () => {
        assert.equal(DS.sentence([], 'Nothing is waiting.'), 'Nothing is waiting.');
        assert.equal(DS.sentence(['', null, undefined, false], 'Nothing is waiting.'), 'Nothing is waiting.');
        assert.equal(DS.sentence(null, 'Nothing is waiting.'), 'Nothing is waiting.');
    });
});

describe('small helpers', () => {
    test('count says one or many', () => {
        assert.equal(DS.count(1, 'request'), '1 request');
        assert.equal(DS.count(3, 'request'), '3 requests');
        assert.equal(DS.count(0, 'request'), '0 requests');
        assert.equal(DS.count(2, 'person', 'people'), '2 people');
        assert.equal(DS.count(1, 'person', 'people'), '1 person');
    });

    test('ageDays counts whole days and never goes below zero', () => {
        const now = Date.parse('2026-10-14T12:00:00Z');
        assert.equal(DS.ageDays('2026-10-14T01:00:00Z', now), 0);
        assert.equal(DS.ageDays('2026-10-13T11:00:00Z', now), 1);
        assert.equal(DS.ageDays('2026-10-07T12:00:00Z', now), 7);
        assert.equal(DS.ageDays('2026-10-20T12:00:00Z', now), 0);
        assert.equal(DS.ageDays('not a date', now), 0);
        assert.equal(DS.ageDays(null, now), 0);
    });

    test('the urgent items come first and keep their own order within a colour', () => {
        const items = [
            { level: 'info', title: 'a' }, { level: 'near', title: 'b' }, { level: 'full', title: 'c' },
            { level: 'near', title: 'd' }, { level: 'weird', title: 'e' },
        ];
        assert.deepEqual(DS.ordered(items).map(i => i.title), ['c', 'b', 'd', 'a', 'e']);
    });
});

describe('the list', () => {
    test('with nothing to show it says so, in the "ok" style', () => {
        const html = DS.itemsHtml([], esc);
        assert.match(html, /level-ok/);
        assert.match(html, /Nothing needs your attention right now\./);
        assert.match(DS.itemsHtml([], esc, { okText: 'All clear.' }), /All clear\./);
    });

    test('each item shows its colour, title, detail and a button that names where it goes', () => {
        const html = DS.itemsHtml([{ level: 'near', title: '3 requests', detail: 'oldest 5 days', go: '#requests', label: 'Review' }], esc);
        assert.match(html, /level-near/);
        assert.match(html, /<strong>3 requests<\/strong>/);
        assert.match(html, /oldest 5 days/);
        assert.match(html, /data-attn-go="#requests">Review</);
    });

    test('an item with nowhere to go has no button', () => {
        assert.ok(!/data-attn-go/.test(DS.itemsHtml([{ level: 'info', title: 'x' }], esc)));
    });

    test('items arrive in turn: each carries its position', () => {
        const html = DS.itemsHtml([{ level: 'full', title: 'a' }, { level: 'near', title: 'b' }], esc);
        assert.match(html, /--i:0/);
        assert.match(html, /--i:1/);
    });

    test('only the first few are shown, and it says how many more', () => {
        const items = Array.from({ length: 8 }, (_, i) => ({ level: 'near', title: 't' + i }));
        const html = DS.itemsHtml(items, esc, { max: 5 });
        assert.equal((html.match(/attention-item level-/g) ?? []).length, 5);
        assert.match(html, /and 3 more\./);
    });

    test('text is escaped, in every place it goes', () => {
        const html = DS.itemsHtml([{ level: 'near', title: '<b>x</b>', detail: '"y"', go: '#a"b', label: '<i>' }], esc);
        assert.ok(!html.includes('<b>x</b>'));
        assert.ok(!html.includes('<i>'));
        assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/);
        assert.match(html, /&quot;y&quot;/);
        assert.match(html, /data-attn-go="#a&quot;b"/);
    });

    test('an unknown colour is treated as information', () => {
        assert.match(DS.itemsHtml([{ level: 'weird', title: 'x' }], esc), /level-info/);
    });
});

describe('drawing it', () => {
    const fakeContainer = () => ({ dataset: {}, innerHTML: '', draws: 0, querySelectorAll() { return []; } });

    test('a changed list is drawn', () => {
        const c = fakeContainer();
        Object.defineProperty(c, 'innerHTML', { set(v) { this._h = v; this.draws++; }, get() { return this._h ?? ''; } });
        DS.render(c, [{ level: 'near', title: 'a' }], esc);
        assert.equal(c.draws, 1);
        assert.match(c.innerHTML, /level-near/);
    });

    test('the same list again is left alone, so its entrance does not replay', () => {
        const c = fakeContainer();
        Object.defineProperty(c, 'innerHTML', { set(v) { this._h = v; this.draws++; }, get() { return this._h ?? ''; } });
        DS.render(c, [{ level: 'near', title: 'a' }], esc);
        DS.render(c, [{ level: 'near', title: 'a' }], esc);
        assert.equal(c.draws, 1);
        DS.render(c, [{ level: 'near', title: 'b' }], esc);
        assert.equal(c.draws, 2);
    });

    test('no container, no crash', () => {
        assert.doesNotThrow(() => DS.render(null, [], esc));
    });
});
