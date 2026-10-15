// chatlist.test.mjs
// The day headings and titles in the list of Cura chats.
//
//   node --test tests/chatlist.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const L = require('../ai-assist/chatlist.js');

const NOW = new Date(2026, 9, 14, 15, 0, 0);          // 14 Oct 2026, 3 pm local
const at = (d, h = 9) => new Date(2026, 9, d, h, 0, 0).toISOString();
const chat = (id, d, h) => ({ id, title: 't' + id, updated_at: at(d, h) });

describe('groupByDay', () => {
    test('names today and yesterday, then the date', () => {
        const g = L.groupByDay([chat(1, 14, 10), chat(2, 13, 10), chat(3, 9, 10)], NOW);
        assert.deepEqual(g.map(x => x.label), ['Today', 'Yesterday', '9 Oct 2026']);
    });

    test('puts chats from the same day under one heading, in the order given', () => {
        const g = L.groupByDay([chat(1, 14, 12), chat(2, 14, 8), chat(3, 12, 8)], NOW);
        assert.equal(g.length, 2);
        assert.deepEqual(g[0].items.map(c => c.id), [1, 2]);
    });

    test('a chat just after midnight is still today, one just before is yesterday', () => {
        const g = L.groupByDay([
            { id: 1, updated_at: new Date(2026, 9, 14, 0, 5).toISOString() },
            { id: 2, updated_at: new Date(2026, 9, 13, 23, 55).toISOString() },
        ], NOW);
        assert.deepEqual(g.map(x => x.label), ['Today', 'Yesterday']);
    });

    test('works across a month and a year', () => {
        const now = new Date(2027, 0, 1, 10, 0);
        const g = L.groupByDay([
            { id: 1, updated_at: new Date(2026, 11, 31, 20, 0).toISOString() },
            { id: 2, updated_at: new Date(2026, 11, 30, 20, 0).toISOString() },
        ], now);
        assert.deepEqual(g.map(x => x.label), ['Yesterday', '30 Dec 2026']);
    });

    test('empty, missing and unreadable dates give no groups', () => {
        assert.deepEqual(L.groupByDay([], NOW), []);
        assert.deepEqual(L.groupByDay(null, NOW), []);
        assert.deepEqual(L.groupByDay([{ id: 1, updated_at: 'nonsense' }], NOW), []);
    });
});

describe('titleOf', () => {
    test('uses the title, trimmed', () => {
        assert.equal(L.titleOf({ title: '  Plan for next term ' }), 'Plan for next term');
    });
    test('falls back to "New chat" when there is none', () => {
        assert.equal(L.titleOf({ title: null }), 'New chat');
        assert.equal(L.titleOf({ title: '   ' }), 'New chat');
        assert.equal(L.titleOf(undefined), 'New chat');
    });
});
