// termorder.test.mjs
// The "same time or later" rule of the Department's integrity check. Elective-list courses have no year or semester,
// so they are never compared (13 false alarms on the 2020-2021 curriculum on 17 Nov 2026).
//   node --test tests/termorder.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const T = require('../shared/js/curriculum/termorder.js');
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

const at = (y, t) => ({ year_level: y, term: t });
const elective = () => ({ year_level: null, term: null });

describe('subjects that have a year and a semester', () => {
    test('a prerequisite in an earlier semester is fine', () => {
        assert.equal(T.isOutOfOrder(at(2, 1), at(1, 2), 'prerequisite'), false);
        assert.equal(T.isOutOfOrder(at(3, 1), at(2, 2), undefined), false);
    });
    test('a prerequisite in the same semester is wrong', () => {
        assert.equal(T.isOutOfOrder(at(2, 1), at(2, 1), 'prerequisite'), true);
    });
    test('a prerequisite in a later semester is wrong', () => {
        assert.equal(T.isOutOfOrder(at(1, 2), at(2, 1), 'prerequisite'), true);
        assert.equal(T.isOutOfOrder(at(1, 1), at(1, 2), 'prerequisite'), true);
    });
    test('a summer term sits between its second semester and the next year', () => {
        assert.equal(T.isOutOfOrder(at(4, 1), at(3, 3), 'prerequisite'), false);
        assert.equal(T.isOutOfOrder(at(3, 3), at(3, 2), 'prerequisite'), false);
        assert.equal(T.isOutOfOrder(at(3, 2), at(3, 3), 'prerequisite'), true);
    });
    test('a "taken alongside" condition may share a semester, but not point at a later one', () => {
        assert.equal(T.isOutOfOrder(at(2, 1), at(2, 1), 'co_requisite'), false);
        assert.equal(T.isOutOfOrder(at(2, 1), at(2, 2), 'co_requisite'), true);
    });
});

describe('elective-list courses (no year, no semester)', () => {
    test('an elective requiring a scheduled subject is not reported', () => {
        assert.equal(T.isOutOfOrder(elective(), at(3, 1), 'prerequisite'), false);   // ELPHP1 requires IT-IMDBSYS31
    });
    test('an elective requiring another elective is not reported', () => {
        assert.equal(T.isOutOfOrder(elective(), elective(), 'prerequisite'), false); // ELIBM2 requires ELIBM1
    });
    test('a scheduled subject requiring an elective is not reported either: the order cannot be judged', () => {
        assert.equal(T.isOutOfOrder(at(2, 1), elective(), 'prerequisite'), false);
    });
    test('the old behaviour is gone: a missing term is no longer read as 0', () => {
        // year_level * 10 + term was 0 for an elective, so pos(prereq) >= 0 was always true.
        assert.equal(T.isOutOfOrder(elective(), at(1, 1), 'prerequisite'), false);
    });
});

describe('bad data does not crash or report', () => {
    test('missing or odd values are treated as "not placed"', () => {
        for (const s of [undefined, null, {}, { year_level: 'x', term: 1 }, { year_level: 1 }, { term: 1 }, { year_level: 1.5, term: 1 }]) {
            assert.equal(T.isOutOfOrder(s, at(1, 1), 'prerequisite'), false);
            assert.equal(T.isOutOfOrder(at(1, 1), s, 'prerequisite'), false);
        }
    });
});

describe('the Department page uses it in both places', () => {
    const js = read('features/department/departmentdashboard.js');
    const html = read('features/department/departmentdashboard.html');
    test('is loaded before the dashboard script', () => {
        assert.ok(html.includes('shared/js/curriculum/termorder.js'));
        assert.ok(html.indexOf('termorder.js') < html.indexOf('<script src="departmentdashboard.js">'));
    });
    test('the issue count and the issue table both ask it', () => {
        assert.equal((js.match(/CurriculogicTermOrder\.isOutOfOrder\(g, q, r\.requirement_type\)/g) || []).length, 2);
    });
    test('the old comparison that read a missing term as 0 is gone from the integrity check', () => {
        const start = js.indexOf('function renderIntegrity()');
        const end = js.indexOf('\nfunction ', start + 10);
        const block = js.slice(start, end > 0 ? end : undefined);
        assert.doesNotMatch(block, /year_level \* 10 \+ s\.term/);
        assert.doesNotMatch(block, /pos\(q\) >= pos\(g\)/);
        assert.match(block, /CurriculogicTermOrder\.isOutOfOrder/);
    });
    test('cycles and a subject requiring itself are still checked', () => {
        assert.match(js, /requires itself/);
        assert.match(js, /Cycle: /);
    });
});
