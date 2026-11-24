// chainanalysis.test.mjs
// 23 Nov 2026: "instead of relying on the PDF layout, make sense of the chains: to take B you must take A first". The scan now reads the
// subjects themselves: a later part of a sequence (Research 2, Fitness II) that leads nowhere back to its first part, a later part that
// comes too early, and the longest chain. It only reports; the check card lists what it finds.
//
//   node --test tests/chainanalysis.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const CA = require('../shared/js/curriculum/chainanalysis.js');
const EC = require('../shared/js/curriculum/extractioncheck.js');
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

let n = 0;
const mk = (code, title, year, term, needs = [], extra = {}) => ({ uid: ++n, code, title, year, term, needs, prereqs: [], ...extra });
const link = (rows) => {
    const by = new Map(rows.map((r) => [r.code, r]));
    for (const r of rows) r.prereqs = [...(r.gates ?? []), ...r.needs.map((c) => ({ uid: by.get(c).uid }))];
    return rows;
};

/* The BSHM subjects that matter (titles, terms and links as the document prints them). */
const bshm = () => link([
    mk('PE 101', 'Movement Enhancement', 1, 1),
    mk('PE 102', 'Fitness Exercise', 1, 2, ['PE 101']),
    mk('PE 103', 'Physical Activity Towards Health and Fitness I', 1, 3, ['PE 102']),
    mk('PE 104', 'Physical Activity Towards Health and Fitness II', 2, 1, ['PE 103']),
    mk('HM 213', 'Foreign Language 1', 2, 1),
    mk('HM 318', 'Foreign Language 2', 3, 2, ['HM 213']),
    mk('HM 319', 'Research in Hospitality 1', 3, 2),
    mk('HM 415', 'Research in Hospitality 2', 4, 1),
    mk('HM 214', 'PRACTICUM 1 (600 hours) with Conference and Seminar', 2, 2),
]);

describe('parts of a sequence', () => {
    test('the BSHM case: Research in Hospitality 2 has no chain back to part 1, and is reported', () => {
        const r = CA.analyze(bshm());
        assert.equal(r.sequels.length, 1);
        assert.match(r.sequels[0], /^HM 415: HM 415 Research in Hospitality 2 has no prerequisite chain back to HM 319 Research in Hospitality 1$/);
    });
    test('parts that ARE linked are not reported (Foreign Language 1 and 2, Fitness I and II)', () => {
        const r = CA.analyze(bshm());
        assert.equal(r.sequels.some((t) => /HM 318|PE 104/.test(t)), false);
    });
    test('a chain counts, not only a direct link: part 3 needing part 2 needing part 1', () => {
        const rows = link([
            mk('A1', 'Calculus 1', 1, 1), mk('A2', 'Calculus 2', 1, 2, ['A1']), mk('A3', 'Calculus 3', 2, 1, ['A2']),
        ]);
        assert.deepEqual(CA.analyze(rows).sequels, []);
    });
    test('a year-standing gate that covers part 1 counts as the link (the practicum rule)', () => {
        const rows = link([
            mk('P1', 'Practicum 1', 2, 2), mk('P2', 'Practicum 2', 4, 2, [], { gates: [{ standing: 4, pos: 41 }] }),
        ]);
        assert.deepEqual(CA.analyze(rows).sequels, []);
        const low = link([
            mk('Q1', 'Practicum 1', 3, 2), mk('Q2', 'Practicum 2', 4, 2, [], { gates: [{ standing: 2, pos: 22 }] }),
        ]);
        assert.equal(CA.analyze(low).sequels.length, 1);        // a gate through year 2 does not cover a year-3 subject
    });
    test('roman numerals and a number glued to the word', () => {
        assert.equal(CA.parts('Physical Activity Towards Health and Fitness II').n, 2);
        assert.equal(CA.parts('Programming2').n, 2);
        assert.equal(CA.parts('Fitness III').base, 'fitness');
    });
    test('titles that only look like parts: nothing is read from them', () => {
        assert.equal(CA.parts('Vitamin C'), null);
        assert.equal(CA.parts('Understanding the Self'), null);
        assert.equal(CA.parts(''), null);
        assert.equal(CA.parts(null), null);
        assert.equal(CA.parts('IT 1'), null);                   // too little of a name to be a family
    });
});

describe('order', () => {
    test('part 2 in the same or an earlier semester than part 1 is a warning', () => {
        const rows = link([mk('R1', 'Research 1', 3, 2), mk('R2', 'Research 2', 3, 2, ['R1'])]);
        const r = CA.analyze(rows);
        assert.equal(r.outOfOrder.length, 1);
        assert.match(r.outOfOrder[0], /^R2: R2 Research 2 is in year 3 semester 2, not after R1 Research 1 in year 3 semester 2$/);
        const early = link([mk('S1', 'Seminar 1', 3, 1), mk('S2', 'Seminar 2', 2, 2)]);
        assert.equal(CA.analyze(early).outOfOrder.length, 1);
    });
    test('a summer counts as after the 2nd semester of its year and before the next year', () => {
        const rows = link([mk('H1', 'Hours 1', 1, 2), mk('H2', 'Hours 2', 1, 3, ['H1']), mk('H3', 'Hours 3', 2, 1, ['H2'])]);
        const r = CA.analyze(rows);
        assert.deepEqual([r.outOfOrder, r.sequels], [[], []]);
    });
});

describe('what is left alone', () => {
    test('numbered elective slots are not sequels, whatever their order (saved BSCS and BSIT curricula have Free Elective 2 before 1)', () => {
        const rows = link([
            mk('CS-FRE1', 'Free Elective 2', 3, 1), mk('CS-FRE2', 'Free Elective 1', 3, 2), mk('IT-EL1', 'IT Elective 1', 3, 1),
            mk('IT-EL2', 'IT Elective 2', 3, 1), mk('X-EL3', 'Anything 3', 4, 1, [], { electiveType: 'IT' }),
        ]);
        const r = CA.analyze(rows);
        assert.deepEqual([r.sequels, r.outOfOrder], [[], []]);
    });
    test('two "part 2" subjects are not a clean sequence: nothing is judged', () => {
        const rows = link([mk('A', 'Seminar 1', 1, 1), mk('B', 'Seminar 2', 2, 1), mk('C', 'Seminar 2', 3, 1)]);
        assert.deepEqual(CA.analyze(rows).sequels, []);
    });
    test('parts 1 and 3 with no part 2 are not a pair', () => {
        const rows = link([mk('A', 'Seminar 1', 1, 1), mk('C', 'Seminar 3', 3, 1)]);
        assert.deepEqual(CA.analyze(rows).sequels, []);
    });
    test('unscheduled rows (catalogue electives) and empty input', () => {
        const rows = link([mk('A', 'Theory 1', null, null), mk('B', 'Theory 2', null, null)]);
        assert.deepEqual(CA.analyze(rows), { sequels: [], outOfOrder: [], longest: null });
        assert.deepEqual(CA.analyze([]), { sequels: [], outOfOrder: [], longest: null });
        assert.deepEqual(CA.analyze(null), { sequels: [], outOfOrder: [], longest: null });
    });
    test('nothing is changed in the rows', () => {
        const rows = bshm();
        const before = JSON.stringify(rows);
        CA.analyze(rows);
        assert.equal(JSON.stringify(rows), before);
    });
});

describe('the longest chain', () => {
    test('BSHM: PE 101 > PE 102 > PE 103 > PE 104, first to take first', () => {
        const r = CA.analyze(bshm());
        assert.deepEqual(r.longest, { length: 4, codes: ['PE 101', 'PE 102', 'PE 103', 'PE 104'] });
    });
    test('a chain of two is not worth a line', () => {
        const rows = link([mk('A', 'Alpha Studies', 1, 1), mk('B', 'Beta Studies', 1, 2, ['A'])]);
        assert.equal(CA.analyze(rows).longest, null);
    });
    test('a loop does not hang it', () => {
        const a = mk('A', 'Alpha Studies', null, null), b = mk('B', 'Beta Studies', null, null);
        a.prereqs = [{ uid: b.uid }]; b.prereqs = [{ uid: a.uid }];
        assert.doesNotThrow(() => CA.analyze([a, b]));
    });
    test('goes-with links are not part of a chain', () => {
        const a = mk('A', 'Alpha Studies', 1, 1), b = mk('B', 'Beta Studies', 1, 1), c = mk('C', 'Gamma Studies', 1, 1);
        b.prereqs = [{ uid: a.uid, co: true }]; c.prereqs = [{ uid: b.uid, co: true }];
        assert.equal(CA.analyze([a, b, c]).longest, null);
    });
});

describe('the check card', () => {
    const subs = [{ code: 'A', year_level: 1, term: 1, lecture_units: 3, laboratory_units: 0 }];
    const chain = {
        sequels: ['HM 415: HM 415 Research in Hospitality 2 has no prerequisite chain back to HM 319 Research in Hospitality 1'],
        outOfOrder: ['R2: R2 Research 2 is in year 3 semester 2, not after R1 Research 1 in year 3 semester 2'],
        longest: { length: 4, codes: ['PE 101', 'PE 102', 'PE 103', 'PE 104'] },
    };
    const o = EC.overview(subs, null, { chain });
    test('a missing link is a note to check, with a jump to its row', () => {
        const c = o.checks.find((x) => /no link back to the earlier part/.test(x.title));
        assert.equal(c.status, 'info');
        assert.deepEqual(c.jump, { kind: 'codes', codes: ['HM 415'] });
    });
    test('a part that comes too early is a warning', () => {
        const c = o.checks.find((x) => /too early/.test(x.title));
        assert.equal(c.status, 'warn');
        assert.deepEqual(c.jump, { kind: 'codes', codes: ['R2'] });
    });
    test('the longest chain is a line of its own, written as a path', () => {
        const c = o.checks.find((x) => /Longest chain/.test(x.title));
        assert.equal(c.title, 'Longest chain of prerequisites: 4 subjects');
        assert.equal(c.detail, 'PE 101 → PE 102 → PE 103 → PE 104');
    });
    test('with nothing to say, none of the three lines is there', () => {
        const q = EC.overview(subs, null, { chain: { sequels: [], outOfOrder: [], longest: null } });
        assert.equal(q.checks.some((x) => /no link back|too early|Longest chain/.test(x.title)), false);
        const none = EC.overview(subs, null, {});
        assert.equal(none.checks.some((x) => /no link back|too early|Longest chain/.test(x.title)), false);
    });
});

describe('wiring in the builder', () => {
    const js = read('features/department/curriculum-builder.js');
    const html = read('features/department/departmentdashboard.html');
    test('the module loads before the builder', () => {
        assert.ok(html.indexOf('shared/js/curriculum/chainanalysis.js') > 0);
        assert.ok(html.indexOf('shared/js/curriculum/chainanalysis.js') < html.search(/curriculum-builder\.js/));
    });
    test('it runs on the finished rows (after the summer move) and its result goes to the card', () => {
        const run = js.indexOf('CurriculogicChainAnalysis?.analyze(ROWS)');
        assert.ok(run > js.indexOf('CurriculogicSummerPlacement?.analyze(ROWS)'));
        assert.ok(run < js.indexOf('TAB = ROWS.find(r => r.year)?.year ?? 1;'));
        assert.ok(/moved,\s*chain,/.test(js));
    });
    test('it never changes a row', () => {
        const mod = read('shared/js/curriculum/chainanalysis.js');
        assert.equal(/\.prereqs\.push|\.year\s*=[^=]|\.term\s*=[^=]|delete /.test(mod), false);
    });
});
