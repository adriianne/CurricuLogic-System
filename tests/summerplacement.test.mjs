// summerplacement.test.mjs
// 23 Nov 2026: the BSHM prospectus prints its Summer block under SECOND YEAR, above the 2nd year's 1st semester. The scan placed it after the
// 2nd semester of year 2, so PE 103 (needed by PE 104 in the 1st semester of year 2) came AFTER PE 104. The block is the summer between
// years 1 and 2. The page now decides the year from the prerequisites, and moves a block only when that is what makes them hold.
//
//   node --test tests/summerplacement.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SP = require('../shared/js/curriculum/summerplacement.js');
const EC = require('../shared/js/curriculum/extractioncheck.js');
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

let n = 0;
const mk = (code, year, term, needs = [], co = []) => ({ uid: ++n, code, year, term, needs, co, prereqs: [] });
const link = (rows) => {
    const by = new Map(rows.map((r) => [r.code, r]));
    for (const r of rows) {
        r.prereqs = [...r.needs.map((c) => ({ uid: by.get(c).uid })), ...r.co.map((c) => ({ uid: by.get(c).uid, co: true }))];
    }
    return rows;
};

/* The BSHM rows that matter (codes, years, terms and links as the document prints them, summer as the scan placed it). */
const bshm = () => link([
    mk('HM 111', 1, 1), mk('HM 112', 1, 1), mk('HM 113', 1, 1, [], ['HM 111']),
    mk('PE 101', 1, 1), mk('PE 102', 1, 2, ['PE 101']),
    mk('HM 114', 1, 2, ['HM 111', 'HM 112', 'HM 113']),
    mk('HM ELECT 4', 2, 3, ['HM 111']), mk('HM ELECT 5', 2, 3, ['HM 111', 'HM 112']), mk('PE 103', 2, 3, ['PE 102']),
    mk('PE 104', 2, 1, ['PE 103']), mk('HM 212', 2, 1, ['HM 111']),
    mk('HM 214', 2, 2),
]);

describe('the BSHM case', () => {
    test('the summer block under year 2 is moved to year 1, all three subjects together', () => {
        const rows = bshm();
        const { moves } = SP.analyze(rows);
        assert.deepEqual(moves.map((m) => m.row.code).sort(), ['HM ELECT 4', 'HM ELECT 5', 'PE 103']);
        for (const m of moves) { assert.equal(m.from, 2); assert.equal(m.to, 1); }
    });
    test('it says why, in the subjects\' own words', () => {
        const [m] = SP.analyze(bshm()).moves;
        assert.equal(m.because, 'PE 104 needs PE 103');
    });
    test('after the move no link is broken', () => {
        const rows = bshm();
        const { moves } = SP.analyze(rows);
        for (const m of moves) m.row.year = m.to;
        const summer = rows.filter((r) => r.term === 3);
        assert.deepEqual(SP.broken(rows, summer, 1), []);
        assert.deepEqual(SP.analyze(rows).moves, []);          // and running it again changes nothing
    });
    test('the rows are not changed by analyze() itself (the builder applies the move)', () => {
        const rows = bshm();
        SP.analyze(rows);
        assert.equal(rows.find((r) => r.code === 'PE 103').year, 2);
    });
});

describe('when nothing is moved', () => {
    test('a summer that already holds where it is printed (BSIT: after 3rd year) stays', () => {
        const rows = link([
            mk('A', 3, 1), mk('B', 3, 2, ['A']), mk('SUM1', 3, 3, ['B']), mk('C', 4, 1, ['SUM1']),
        ]);
        assert.deepEqual(SP.analyze(rows).moves, []);
    });
    test('a summer with no links at all stays: nothing says it is wrong', () => {
        const rows = link([mk('A', 1, 1), mk('B', 2, 1), mk('S', 2, 3)]);
        assert.deepEqual(SP.analyze(rows).moves, []);
    });
    test('no other year fits either: it stays, and the row errors will say so', () => {
        // S needs a year-2 subject AND is needed by a year-1 subject: no placement can hold
        const rows = link([mk('Y1', 1, 2, ['S']), mk('S', 2, 3, ['Y2']), mk('Y2', 2, 1)]);
        assert.deepEqual(SP.analyze(rows).moves, []);
    });
    test('the other year already has a summer block: two summers are not merged on a guess', () => {
        const rows = bshm();
        rows.push(Object.assign(mk('SUM-Y1', 1, 3), { prereqs: [] }));
        assert.deepEqual(SP.analyze(rows).moves, []);
    });
    test('a goes-with link may share a term, so it is not a reason to move', () => {
        const rows = link([mk('LEC', 2, 3), mk('LAB', 2, 3, [], ['LEC'])]);
        assert.deepEqual(SP.analyze(rows).moves, []);
    });
    test('links inside the block do not decide where the block goes', () => {
        const rows = link([mk('S1', 2, 3), mk('S2', 2, 3, ['S1'])]);
        assert.deepEqual(SP.analyze(rows).moves, []);
    });
    test('catalogue electives (no year, no term) and empty input are ignored', () => {
        const rows = link([mk('E1', null, null), mk('E2', null, null, ['E1'])]);
        assert.deepEqual(SP.analyze(rows).moves, []);
        assert.deepEqual(SP.analyze([]).moves, []);
        assert.deepEqual(SP.analyze(null).moves, []);
    });
});

describe('the other direction and limits', () => {
    test('a summer printed under year 1 that only works after year 2 moves to year 2', () => {
        const rows = link([mk('A', 1, 1), mk('S', 1, 3, ['T']), mk('T', 2, 2)]);
        const { moves } = SP.analyze(rows);
        assert.deepEqual(moves.map((m) => [m.row.code, m.from, m.to]), [['S', 1, 2]]);
    });
    test('year 1 never moves to year 0, year 4 never to year 5', () => {
        const rows = link([mk('S', 1, 3, ['X']), mk('X', 1, 3)]);
        for (const m of SP.analyze(rows).moves) assert.ok(m.to >= 1 && m.to <= 4);
    });
});

describe('the check card', () => {
    const subs = [
        { code: 'A', year_level: 1, term: 1, lecture_units: 3, laboratory_units: 0 },
    ];
    test('a move is listed as a note to check, with the rows it concerns', () => {
        const moved = ['PE 103: printed under year 2 summer, placed in year 1 summer because PE 104 needs PE 103'];
        const o = EC.overview(subs, null, { moved });
        const c = o.checks.find((x) => /placed by the prerequisites/.test(x.title));
        assert.ok(c, 'no check for the moved subjects');
        assert.equal(c.status, 'info');
        assert.match(c.title, /^1 summer subject was placed/);
        assert.deepEqual(c.jump, { kind: 'codes', codes: ['PE 103'] });
    });
    test('without a move there is no such line', () => {
        const o = EC.overview(subs, null, { moved: [] });
        assert.equal(o.checks.some((x) => /placed by the prerequisites/.test(x.title)), false);
    });
});

describe('wiring in the builder', () => {
    const js = read('features/department/curriculum-builder.js');
    const html = read('features/department/departmentdashboard.html');
    test('the module loads before the builder', () => {
        assert.ok(html.indexOf('shared/js/curriculum/summerplacement.js') > 0);
        assert.ok(html.indexOf('shared/js/curriculum/summerplacement.js') < html.search(/curriculum-builder\.js/));
    });
    test('it runs after every link is built and before the rows are checked and drawn', () => {
        const run = js.indexOf('CurriculogicSummerPlacement?.analyze(ROWS)');
        assert.ok(run > js.indexOf('for (const row of ROWS) {'));
        assert.ok(run < js.indexOf('TAB = ROWS.find(r => r.year)?.year ?? 1;'));
        assert.ok(js.indexOf('TAB = ROWS.find(r => r.year)?.year ?? 1;') < js.indexOf('    validate();                    // the new rows'));
    });
    test('each move is applied to the row and reported to the card', () => {
        assert.ok(js.includes('m.row.year = m.to;'));
        assert.ok(js.includes('placed in year ${m.to} summer because ${m.because}'));
        assert.ok(/followUps,\s*interpreted,\s*moved,/.test(js));
    });
});
