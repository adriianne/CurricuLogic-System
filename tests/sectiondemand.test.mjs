// sectiondemand.test.mjs
// How crowded a section is: the rules the Department's demand card follows.
//
//   node --test tests/sectiondemand.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SD = require('../shared/js/sectiondemand.js');

const row = (over = {}) => ({
    subject_id: 1, subject_code: 'MATH 101', subject_title: 'Math', section: 'BSIT-1A',
    edp_codes: ['4101'], capacity: null, is_open: true, selected: 0, awaiting: 0, approved: 0, ...over,
});

describe('classify', () => {
    test('with no capacity set, 45 is used and said to be a default', () => {
        const s = SD.classify(row({ selected: 10 }));
        assert.equal(s.capacity, 45);
        assert.equal(s.capacityIsDefault, true);
        assert.equal(s.left, 35);
    });

    test('a capacity the Department set is used and not called a default', () => {
        const s = SD.classify(row({ capacity: 30, selected: 10 }));
        assert.equal(s.capacity, 30);
        assert.equal(s.capacityIsDefault, false);
    });

    test('39 of 45 is fine, 40 is near full, 44 is near full, 45 is full', () => {
        const level = (n) => SD.classify(row({ selected: n })).level;
        assert.equal(level(0), 'ok');
        assert.equal(level(39), 'ok');
        assert.equal(level(40), 'near');
        assert.equal(level(44), 'near');
        assert.equal(level(45), 'full');
        assert.equal(level(60), 'full');
    });

    test('the warning is five seats before the capacity, whatever the capacity is', () => {
        const level = (cap, n) => SD.classify(row({ capacity: cap, selected: n })).level;
        assert.equal(level(30, 24), 'ok');
        assert.equal(level(30, 25), 'near');
        assert.equal(level(30, 30), 'full');
    });

    test('a closed section is "closed" even when crowded', () => {
        assert.equal(SD.classify(row({ is_open: false, selected: 80 })).level, 'closed');
    });

    test('a zero, negative or text capacity falls back to 45', () => {
        for (const capacity of [0, -3, 'abc', null, undefined, NaN]) {
            assert.equal(SD.classify(row({ capacity })).capacity, 45, String(capacity));
        }
    });

    test('a capacity given as a number in text is read', () => {
        assert.equal(SD.classify(row({ capacity: '40' })).capacity, 40);
    });

    test('a missing or odd selected count is zero, not a crash', () => {
        for (const selected of [undefined, null, 'x', -5]) {
            assert.equal(SD.classify(row({ selected })).level, 'ok');
        }
    });

    test('the share never goes over 1, and left can go below zero', () => {
        const s = SD.classify(row({ selected: 50 }));
        assert.equal(s.share, 1);
        assert.equal(s.left, -5);
    });
});

describe('prepare and summarize', () => {
    const rows = [
        row({ section: 'BSIT-1C', selected: 5 }),
        row({ section: 'BSIT-1A', selected: 47 }),
        row({ section: 'BSIT-1B', selected: 41 }),
        row({ section: 'BSIT-1D', selected: 12, is_open: false }),
        row({ subject_code: 'ENGL 101', section: 'BSIT-1A', selected: 45 }),
    ];

    test('the most crowded come first: full (a tie goes by subject code), then near, then the rest, closed last', () => {
        const p = SD.prepare(rows);
        assert.deepEqual(p.map(r => `${r.subject_code}/${r.section}`), [
            'ENGL 101/BSIT-1A', 'MATH 101/BSIT-1A', 'MATH 101/BSIT-1B', 'MATH 101/BSIT-1C', 'MATH 101/BSIT-1D',
        ]);
    });

    test('among sections that are equally urgent, the fuller one is first', () => {
        const p = SD.prepare([row({ section: 'A', selected: 10 }), row({ section: 'B', selected: 30 })]);
        assert.deepEqual(p.map(r => r.section), ['B', 'A']);
    });

    test('the input list is not changed', () => {
        const copy = JSON.stringify(rows);
        SD.prepare(rows);
        assert.equal(JSON.stringify(rows), copy);
    });

    test('summarize counts each level, the sections and the students', () => {
        const sum = SD.summarize(SD.prepare(rows));
        assert.deepEqual(sum, { full: 2, near: 1, ok: 1, closed: 1, sections: 5, students: 150 });
    });

    test('nothing in, nothing out', () => {
        assert.deepEqual(SD.prepare(null), []);
        assert.equal(SD.summarize([]).sections, 0);
    });
});

describe('words for the Department', () => {
    test('the headline names what needs attention', () => {
        const mk = (sel) => SD.summarize(SD.prepare(sel.map((n, i) => row({ section: `S${i}`, selected: n }))));
        assert.equal(SD.headline(mk([46, 41, 3])), '1 full and 1 near full: students may need another section.');
        assert.equal(SD.headline(mk([46, 50])), '2 full: students may need another section.');
        assert.equal(SD.headline(mk([3, 4])), 'No section is near its limit. 2 sections checked.');
        assert.equal(SD.headline(mk([])), 'No sections are scheduled for this term yet.');
        assert.equal(SD.headline(mk([3])), 'No section is near its limit. 1 section checked.');
    });

    test('advice says how far over, or how many seats are left', () => {
        const prep = (o) => SD.prepare([row(o)])[0];
        assert.match(SD.advice(prep({ selected: 48 })), /48 students chose it, 3 over the 45 limit/);
        assert.match(SD.advice(prep({ selected: 45 })), /reached the 45 limit/);
        assert.match(SD.advice(prep({ selected: 44 })), /1 seat left of 45/);
        assert.match(SD.advice(prep({ selected: 41 })), /4 seats left of 45/);
        assert.match(SD.advice(prep({ selected: 5 })), /40 seats left of 45 by student choices/);
        assert.match(SD.advice(prep({ selected: 5, is_open: false })), /Closed/);
    });

    test('the card never calls the number a seat count of the EDP office', () => {
        const text = [1, 41, 45, 60].map(n => SD.advice(SD.prepare([row({ selected: n })])[0])).join(' ');
        assert.ok(!/EDP/.test(text));
        assert.match(text, /student/);
    });
});

describe('grouped by section', () => {
    const mk = (section, code, selected, over = {}) => row({ section, subject_code: code, subject_id: code.length * 100 + selected, selected, ...over });
    const rows = [
        mk('BSIT-3C', 'IT 301', 12), mk('BSIT-1A', 'MATH 101', 47), mk('BSIT-1A', 'ENGL 101', 41), mk('BSIT-1A', 'PE 101', 5),
        mk('BSIT-10A', 'IT 901', 2), mk('BSIT-2B', 'IT 201', 8, { is_open: false }), mk('BSIT-2B', 'IT 202', 9, { is_open: false }),
        mk('BSIT-1B', 'MATH 101', 44),
    ];
    const groups = SD.groupBySection(SD.prepare(rows));

    test('one group per section, in name order with numbers read as numbers', () => {
        assert.deepEqual(groups.map(g => g.section), ['BSIT-1A', 'BSIT-1B', 'BSIT-2B', 'BSIT-3C', 'BSIT-10A']);
    });

    test('a group lists its own subjects, the most crowded first', () => {
        const a = groups.find(g => g.section === 'BSIT-1A');
        assert.deepEqual(a.rows.map(r => r.subject_code), ['MATH 101', 'ENGL 101', 'PE 101']);
        assert.equal(a.subjects, 3);
    });

    test('a group counts its subjects by level', () => {
        assert.deepEqual(groups.find(g => g.section === 'BSIT-1A').counts, { full: 1, near: 1, ok: 1, closed: 0 });
    });

    test('a group takes its most urgent subject as its level', () => {
        const level = (name) => groups.find(g => g.section === name).level;
        assert.equal(level('BSIT-1A'), 'full');
        assert.equal(level('BSIT-1B'), 'near');
        assert.equal(level('BSIT-3C'), 'ok');
        assert.equal(level('BSIT-2B'), 'closed');
    });

    test('a group adds up the students who chose its subjects', () => {
        assert.equal(groups.find(g => g.section === 'BSIT-1A').students, 93);
    });

    test('a section with one closed subject and others fine is fine, not closed', () => {
        const g = SD.groupBySection(SD.prepare([mk('S-1', 'A', 5), mk('S-1', 'B', 5, { is_open: false })]))[0];
        assert.equal(g.level, 'ok');
    });

    test('nothing in, nothing out; the input is not changed', () => {
        assert.deepEqual(SD.groupBySection(null), []);
        const prepared = SD.prepare(rows);
        const before = JSON.stringify(prepared);
        SD.groupBySection(prepared);
        assert.equal(JSON.stringify(prepared), before);
    });

    test('the headline names the sections that need attention, the fullest first', () => {
        assert.equal(SD.headlineBySection(groups), '2 sections need attention: BSIT-1A (1 full, 1 near full), BSIT-1B (1 near full).');
    });

    test('the headline copes with one section, many sections, and none', () => {
        assert.equal(SD.headlineBySection(SD.groupBySection(SD.prepare([mk('S-1', 'A', 46)]))), '1 section needs attention: S-1 (1 full).');
        const many = SD.groupBySection(SD.prepare(['A', 'B', 'C', 'D', 'E'].map(n => mk('S-' + n, 'X', 46))));
        assert.match(SD.headlineBySection(many), /^5 sections need attention: .*, .*, .* and 2 more.$/);
        assert.equal(SD.headlineBySection(SD.groupBySection(SD.prepare([mk('S-1', 'A', 5)]))), 'No section is near its limit. 1 section checked.');
        assert.equal(SD.headlineBySection([]), 'No sections are scheduled for this term yet.');
    });
});

describe('year levels', () => {
    test('the year is the first digit after the dash', () => {
        assert.equal(SD.yearOf('BSIT-1A'), 1);
        assert.equal(SD.yearOf('BSN-3C'), 3);
        assert.equal(SD.yearOf('BSIT-4B'), 4);
        assert.equal(SD.yearOf('BSIT-2-B'), 2);
        assert.equal(SD.yearOf('BSCRIM - 2A'), 2);
        assert.equal(SD.yearOf('BSIT-10A'), 1);
    });

    test('a name that does not follow the pattern has no year', () => {
        for (const bad of ['IRREGULAR', 'BSIT-A', '', null, undefined, '1A']) assert.equal(SD.yearOf(bad), null, String(bad));
    });

    test('the label reads 1st, 2nd, 3rd, 4th Year', () => {
        assert.deepEqual([1, 2, 3, 4, 5].map(SD.yearLabel), ['1st Year', '2nd Year', '3rd Year', '4th Year', '5th Year']);
        assert.equal(SD.yearLabel(null), 'Other sections');
    });

    const mk = (section, selected) => row({ section, subject_code: 'X ' + section, subject_id: selected, selected });
    const groups = SD.groupBySection(SD.prepare([
        mk('BSIT-3C', 5), mk('BSIT-1A', 46), mk('BSIT-1B', 41), mk('BSIT-4A', 2), mk('BSIT-2A', 9), mk('SPECIAL', 3), mk('BSIT-1C', 7),
    ]));
    const years = SD.groupByYear(groups);

    test('sections are gathered under their year, 1st year first and the odd ones last', () => {
        assert.deepEqual(years.map(y => y.label), ['1st Year', '2nd Year', '3rd Year', '4th Year', 'Other sections']);
        assert.deepEqual(years[0].groups.map(g => g.section), ['BSIT-1A', 'BSIT-1B', 'BSIT-1C']);
    });

    test('a year says how many sections it has and how many need attention', () => {
        assert.deepEqual([years[0].sections, years[0].attention], [3, 2]);
        assert.deepEqual([years[1].sections, years[1].attention], [1, 0]);
    });

    test('a year with no sections is not listed', () => {
        const only = SD.groupByYear(SD.groupBySection(SD.prepare([mk('BSIT-2A', 1), mk('BSIT-4A', 1)])));
        assert.deepEqual(only.map(y => y.year), [2, 4]);
    });

    test('nothing in, nothing out', () => {
        assert.deepEqual(SD.groupByYear(null), []);
        assert.deepEqual(SD.groupByYear([]), []);
    });
});

describe('stress: odd data never breaks the totals or the sentences', () => {
    // a small seeded generator, so a failure can be repeated
    let seed = 20261014;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    const pick = (list) => list[Math.floor(rnd() * list.length)];

    const NAMES = ['BSIT-1A', 'BSIT-1B', 'BSIT-2A', 'BSN-3C', 'BSCRIM-4B', 'BSIT-10A', 'IRREGULAR', '', null, 'BSIT-A', 'X-9Z', '<b>BSIT-1A</b>'];
    const NUMS = [0, 1, 5, 39, 40, 44, 45, 46, 200, -3, 'abc', null, undefined, NaN, '12', 4.7];
    const make = () => Array.from({ length: Math.floor(rnd() * 40), }, (_, i) => ({
        subject_id: i, subject_code: pick(['MATH 101', 'IT 201', '', null, 'A&B']), subject_title: pick(['t', '', null]),
        section: pick(NAMES), edp_codes: pick([['1'], [], null, undefined]), capacity: pick(NUMS), is_open: pick([true, false, undefined, null]),
        selected: pick(NUMS), awaiting: 0, approved: 0,
    }));

    test('300 random lists: nothing throws and everything adds up', () => {
        for (let round = 0; round < 300; round++) {
            const rows = make();
            const prepared = SD.prepare(rows);
            const groups = SD.groupBySection(prepared);
            const years = SD.groupByYear(groups);
            const sum = SD.summarize(prepared);

            assert.equal(prepared.length, rows.length, 'prepare keeps every row');
            assert.equal(groups.reduce((t, g) => t + g.subjects, 0), rows.length, 'every row is in exactly one section');
            assert.equal(years.reduce((t, y) => t + y.sections, 0), groups.length, 'every section is under exactly one year');
            for (const g of groups) {
                assert.equal(Object.values(g.counts).reduce((a, b) => a + b, 0), g.subjects, 'a section\'s levels add up to its subjects');
                assert.ok(['full', 'near', 'ok', 'closed'].includes(g.level));
                assert.ok(Number.isFinite(g.students) && g.students >= 0, 'student total is a number: ' + g.students);
            }
            assert.equal(sum.sections, rows.length);

            const text = [SD.headline(sum), SD.headlineBySection(groups), ...prepared.map(r => SD.advice(r)), ...years.map(y => y.label)].join(' | ');
            assert.ok(!/undefined|NaN|null|\[object/.test(text), 'a sentence is broken: ' + text.match(/.{0,40}(undefined|NaN|null|\[object).{0,20}/)?.[0]);
        }
    });

    test('a count never shows as negative or fractional in the advice', () => {
        for (const selected of [-5, 4.7, '12', 'abc', NaN]) {
            const s = SD.classify(row({ selected }));
            assert.ok(Number.isFinite(s.share) && s.share >= 0 && s.share <= 1, String(selected));
        }
    });
});
