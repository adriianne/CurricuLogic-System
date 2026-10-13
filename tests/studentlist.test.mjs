// studentlist.test.mjs
// The pure parts of the Registrar's Students pages.
//
//   node --test tests/studentlist.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const L = require('../shared/js/studentlist.js');

describe('searchTokens', () => {
    test('splits on spaces, drops empty words', () => {
        assert.deepEqual(L.searchTokens('  athena   po '), ['athena', 'po']);
        assert.deepEqual(L.searchTokens(''), []);
        assert.deepEqual(L.searchTokens(null), []);
    });

    test('characters that mean something to the filter cannot get through', () => {
        const t = L.searchTokens('a,b) or (c*%"' + String.fromCharCode(92));
        assert.ok(t.every(w => !/[,()*%"]/.test(w) && !w.includes(String.fromCharCode(92))), t.join('|'));
    });

    test('at most four words, each at most 60 characters', () => {
        assert.equal(L.searchTokens('a b c d e f').length, 4);
        assert.equal(L.searchTokens('x'.repeat(200))[0].length, 60);
    });

    test('an email keeps its dot and at-sign', () => {
        assert.deepEqual(L.searchTokens('juan.dela@uc.edu.ph'), ['juan.dela@uc.edu.ph']);
    });
});

describe('searchClause', () => {
    test('one word is looked for in name, ID and email', () => {
        assert.equal(L.searchClause('po'),
            'first_name.ilike.*po*,last_name.ilike.*po*,student_id.ilike.*po*,email.ilike.*po*');
    });
});

describe('rangeFor and pageCount', () => {
    test('pages are 1-based', () => {
        assert.deepEqual(L.rangeFor(1, 20), { from: 0, to: 19 });
        assert.deepEqual(L.rangeFor(3, 20), { from: 40, to: 59 });
    });
    test('a bad page falls back to the first', () => {
        assert.deepEqual(L.rangeFor(0, 20), { from: 0, to: 19 });
        assert.deepEqual(L.rangeFor('x', 20), { from: 0, to: 19 });
    });
    test('page count is at least one', () => {
        assert.equal(L.pageCount(0, 20), 1);
        assert.equal(L.pageCount(20, 20), 1);
        assert.equal(L.pageCount(21, 20), 2);
        assert.equal(L.pageCount(10000, 20), 500);
    });
});

describe('progress', () => {
    const rec = (subject_id, status, units) => ({ subject_id, status, units });

    test('only passed subjects count', () => {
        const p = L.progress([rec(1, 'PASSED', 3), rec(2, 'FAILED', 3), rec(3, 'ENROLLED', 3), rec(4, 'DROPPED', 3)], 161);
        assert.equal(p.units, 3);
    });

    test('a subject recorded twice counts once', () => {
        assert.equal(L.passedUnits([rec(1, 'PASSED', 3), rec(1, 'PASSED', 3), rec(2, 'PASSED', 2)]), 5);
    });

    test('units can sit on the subject', () => {
        assert.equal(L.passedUnits([{ subject_id: 1, status: 'PASSED', subject: { units: 4 } }]), 4);
    });

    test('percent is rounded and held between 0 and 100', () => {
        assert.equal(L.progress([rec(1, 'PASSED', 9)], 161).percent, 6);
        assert.equal(L.progress([rec(1, 'PASSED', 300)], 161).percent, 100);
        assert.equal(L.progress([], 161).percent, 0);
    });

    test('no curriculum total gives 0 percent, not NaN', () => {
        assert.equal(L.progress([rec(1, 'PASSED', 3)], 0).percent, 0);
        assert.equal(L.progress([rec(1, 'PASSED', 3)], null).percent, 0);
    });
});

describe('pickPlan', () => {
    const cfg = { term: 1, year: 2023 };
    const isFinal = (r) => r.status === 'approved';
    const req = (id, term, year, status, created) => ({ id, requested_term: term, requested_year: year, status, created_at: created });

    test('nothing gives null', () => {
        assert.equal(L.pickPlan([], cfg, isFinal), null);
        assert.equal(L.pickPlan(null, cfg, isFinal), null);
    });

    test('a plan for another term is not this term\'s plan', () => {
        assert.equal(L.pickPlan([req(1, 2, 2022, 'approved', '2026-01-01')], cfg, isFinal), null);
    });

    test('inside the current term an approved plan beats a newer waiting one', () => {
        const got = L.pickPlan([
            req(1, 1, 2023, 'approved', '2026-09-01'),
            req(2, 1, 2023, 'submitted', '2026-09-20'),
        ], cfg, isFinal);
        assert.equal(got.id, 1);
    });

    test('among equals the newer one wins', () => {
        const got = L.pickPlan([
            req(1, 1, 2023, 'submitted', '2026-09-01'),
            req(2, 1, 2023, 'submitted', '2026-09-20'),
        ], cfg, isFinal);
        assert.equal(got.id, 2);
    });

    test('with no current term known the newest request is used', () => {
        const got = L.pickPlan([req(1, 2, 2022, 'approved', '2026-01-01'), req(2, 1, 2021, 'submitted', '2026-05-01')], null, isFinal);
        assert.equal(got.id, 1);
    });
});

describe('initialsOf', () => {
    test('first letters of the names', () => {
        assert.equal(L.initialsOf('Athena', 'Po'), 'AP');
        assert.equal(L.initialsOf('Athena', ''), 'A');
    });
    test('falls back to the email, then a question mark', () => {
        assert.equal(L.initialsOf('', '', 'zed@x.ph'), 'Z');
        assert.equal(L.initialsOf('', '', ''), '?');
    });
});
