// chatplan.test.mjs
// "Send this plan to my adviser" under a Cura answer: reading the table back.
//
//   node --test tests/chatplan.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { picksOf, pairUp, summary } = require('../shared/js/chatplan.js');

describe('picksOf', () => {
    test('reads the plan table when there is no schedule', () => {
        const table = [{ code: 'A', section: 'S1' }, { code: 'B', section: null }];
        assert.deepEqual(picksOf({ table }), [{ code: 'A', section: 'S1' }, { code: 'B', section: null }]);
    });

    test('the schedule wins over the table: it may be another version of the plan', () => {
        const table = [{ code: 'A', section: 'S1' }, { code: 'B', section: 'S1' }];
        const schedule = { rows: [{ code: 'A', section: 'S2' }], notInPlan: [{ code: 'B' }] };
        assert.deepEqual(picksOf({ table, schedule }), [{ code: 'A', section: 'S2' }]);
    });

    test('a schedule with no rows falls back to the table', () => {
        const table = [{ code: 'A', section: 'S1' }];
        assert.deepEqual(picksOf({ table, schedule: { rows: [], notInPlan: [{ code: 'Z' }] } }), [{ code: 'A', section: 'S1' }]);
    });

    test('a code is listed once, and rows without a code are skipped', () => {
        const table = [{ code: 'A', section: 'S1' }, { code: 'A', section: 'S2' }, { section: 'S9' }, null];
        assert.deepEqual(picksOf({ table }), [{ code: 'A', section: 'S1' }]);
    });

    test('nothing in, nothing out', () => {
        assert.deepEqual(picksOf(), []);
        assert.deepEqual(picksOf({ table: null, schedule: null }), []);
    });
});

describe('pairUp', () => {
    const open = [
        { subject: { id: 1, code: 'A' }, sections: [{ section: 'S1' }, { section: 'S2' }] },
        { subject: { id: 2, code: 'B' }, sections: [] },
    ];

    test('matches by code and keeps a section that still exists', () => {
        const r = pairUp([{ code: 'A', section: 'S2' }], open);
        assert.deepEqual(r.chosen, [{ subjectId: 1, section: 'S2' }]);
        assert.deepEqual(r.notOpen, []);
    });

    test('a section that no longer exists is dropped, so the default is used', () => {
        const r = pairUp([{ code: 'A', section: 'GONE' }, { code: 'B', section: 'S1' }], open);
        assert.deepEqual(r.chosen, [{ subjectId: 1, section: null }, { subjectId: 2, section: null }]);
    });

    test('a subject that is no longer open is reported, never sent', () => {
        const r = pairUp([{ code: 'A', section: 'S1' }, { code: 'LOCKED', section: 'S1' }], open);
        assert.deepEqual(r.chosen.map(c => c.subjectId), [1]);
        assert.deepEqual(r.notOpen, ['LOCKED']);
    });

    test('empty picks give an empty result', () => {
        assert.deepEqual(pairUp([], open), { chosen: [], notOpen: [] });
        assert.deepEqual(pairUp(undefined, undefined), { chosen: [], notOpen: [] });
    });
});

describe('summary', () => {
    test('says how many subjects and units', () => {
        assert.equal(summary(3, 9), 'Send 3 subjects (9 units) to your adviser?');
        assert.equal(summary(1, 1), 'Send 1 subject (1 unit) to your adviser?');
    });
});
