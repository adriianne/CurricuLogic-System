// subjectgroups.test.mjs
// The Department's Subjects list, grouped by year and semester.
//
//   node --test tests/subjectgroups.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const G = require('../shared/js/subjectgroups.js');

let id = 1;
const s = (code, year, term, units = 3, o = {}) => ({ id: id++, code, title: code, units, year_level: year, term, is_elective: false, is_active: true, ...o });

const subjects = [
    s('A', 1, 1), s('B', 1, 1, 2), s('C', 1, 2),
    s('D', 2, 1), s('E', 3, 3, 3),
    s('IT-1', null, null, 3, { is_elective: true, elective_type: 'IT' }),
    s('FR-1', null, null, 3, { is_elective: true, elective_type: 'FREE' }),
];

describe('group', () => {
    const g = G.group(subjects);

    test('one tab per year that has subjects, in order', () => {
        assert.deepEqual(g.years.map(y => y.year), [1, 2, 3]);
        assert.equal(g.years[0].label, 'I — First Year');
    });

    test('each year has its 1st and 2nd semester, with their own totals', () => {
        const y1 = g.years[0];
        assert.deepEqual(y1.semesters.map(p => p.key), ['1', '2']);
        assert.equal(y1.semesters[0].subjects, 2);
        assert.equal(y1.semesters[0].units, 5);
        assert.equal(y1.semesters[1].subjects, 1);
        assert.equal(y1.subjects, 3);
        assert.equal(y1.units, 8);
    });

    test('a year with nothing in a semester still shows that semester, empty', () => {
        const y2 = g.years[1];
        assert.equal(y2.semesters[1].subjects, 0);
        assert.deepEqual(y2.semesters[1].rows, []);
    });

    test('summer appears only when a year has summer subjects', () => {
        assert.deepEqual(g.years[0].semesters.map(p => p.key), ['1', '2']);
        assert.deepEqual(g.years[2].semesters.map(p => p.key), ['1', '2', '3']);
        assert.equal(g.years[2].semesters[2].label, 'Summer');
    });

    test('electives with no year are grouped as programme and free', () => {
        assert.deepEqual(g.electives.groups.map(p => p.key), ['it', 'free']);
        assert.equal(g.electives.subjects, 2);
    });

    test('a subject with a year but no semester is not lost', () => {
        const odd = G.group([s('X', 1, null)]);
        const keys = odd.years[0].semesters.map(p => p.key);
        assert.ok(keys.includes('none'));
        assert.equal(odd.years[0].semesters.find(p => p.key === 'none').rows.length, 1);
    });

    test('a retired subject stays listed but is not counted', () => {
        const withRetired = G.group([s('A', 1, 1), s('R', 1, 1, 3, { is_active: false })]);
        const first = withRetired.years[0].semesters[0];
        assert.equal(first.rows.length, 2);
        assert.equal(first.subjects, 1);
        assert.equal(first.units, 3);
    });

    test('an empty curriculum gives no tabs', () => {
        const none = G.group([]);
        assert.deepEqual(none.years, []);
        assert.deepEqual(none.electives.groups, []);
        assert.equal(G.group(null).years.length, 0);
    });
});
