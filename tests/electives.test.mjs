// electives.test.mjs
// What counts as an elective slot, and how the engine treats one.
//
//   node --test tests/electives.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const EL = require('../shared/js/electives.js');
const E = require('../shared/engine/engine.js');

describe('placeholderOf', () => {
    test('BSIT\'s own codes still read as slots', () => {
        assert.deepEqual(EL.placeholderOf('IT-EL'),   { base: 'IT-EL',  num: null, type: 'IT' });
        assert.deepEqual(EL.placeholderOf('IT-EL3'),  { base: 'IT-EL',  num: 3,    type: 'IT' });
        assert.deepEqual(EL.placeholderOf('IT-FRE'),  { base: 'IT-FRE', num: null, type: 'FREE' });
        assert.deepEqual(EL.placeholderOf('IT-FRE2'), { base: 'IT-FRE', num: 2,    type: 'FREE' });
    });

    test('other programmes\' prefixes and spellings work too', () => {
        assert.equal(EL.placeholderOf('BSN-ELEC').type, 'IT');
        assert.equal(EL.placeholderOf('NCM-ELECTIVE2').num, 2);
        assert.equal(EL.placeholderOf('CRIM-FREE1').type, 'FREE');
        assert.equal(EL.placeholderOf('EL').type, 'IT');
        assert.equal(EL.placeholderOf('FRE3').type, 'FREE');
        assert.deepEqual(EL.placeholderOf(' bscrim-elec '), EL.placeholderOf('BSCRIM-ELEC'));
    });

    test('real subjects are not mistaken for slots', () => {
        for (const code of ['CC-ELECTRO11', 'ELPHP1', 'ENGL 101', 'NCM 106', 'PE 101', 'RIZAL 101',
                            'CRIM 111', 'IT-ELEVATE1', 'FREEZE 101', 'HUM - REP 101', '']) {
            assert.equal(EL.placeholderOf(code), null, code);
        }
    });
});

describe('builder rows', () => {
    const row = (o) => ({ code: '', year: 3, electiveType: null, ...o });

    test('a semester row is a slot when its code says so', () => {
        assert.equal(EL.isElectiveRow(row({ code: 'BSN-ELEC' })), true);
        assert.equal(EL.electiveTypeOf(row({ code: 'BSN-ELEC' })), 'IT');
    });

    test('a semester row is a slot when it carries a type, whatever its code', () => {
        assert.equal(EL.isElectiveRow(row({ code: 'PROF-SEM1', electiveType: 'FREE' })), true);
        assert.equal(EL.electiveTypeOf(row({ code: 'PROF-SEM1', electiveType: 'FREE' })), 'FREE');
    });

    test('a catalogue entry (no year) is always an elective', () => {
        assert.equal(EL.isElectiveRow(row({ code: 'ELPHP1', year: null })), true);
    });

    test('an ordinary subject is not', () => {
        assert.equal(EL.isElectiveRow(row({ code: 'CRIM 111' })), false);
        assert.equal(EL.electiveTypeOf(row({ code: 'CRIM 111' })), null);
    });

    test('an explicit type wins over the code', () => {
        assert.equal(EL.electiveTypeOf(row({ code: 'IT-EL1', electiveType: 'FREE' })), 'FREE');
    });
});

describe('stored subjects', () => {
    test('an elective type marks a slot even when is_elective was saved false', () => {
        // The exact shape of BSIT's IT-EL1..3 / IT-FRE1..3 rows.
        assert.equal(EL.isElectiveSubject({ is_elective: false, elective_type: 'IT' }), true);
        assert.equal(EL.isElectiveSubject({ is_elective: true,  elective_type: null }), true);
        assert.equal(EL.isElectiveSubject({ is_elective: false, elective_type: null }), false);
    });
});

describe('the engine and elective slots', () => {
    let id = 1;
    const subj = (code, o = {}) => ({
        id: id++, code, title: code, units: 3,
        year_level: o.year ?? 1, term: o.term ?? 1,
        is_elective: o.is_elective ?? false, elective_type: o.type ?? null,
    });
    const student = (y = 4) => ({ id: 's', year_level: y });
    const PASSED = 'PASSED';
    const rec = (s) => ({ subject_id: s.id, status: PASSED });
    const opts = { respectOfferings: false };

    test('an elective-typed slot saved with is_elective=false does not hold up the year gate', () => {
        // Year 3 has one real subject and one elective slot. The student has
        // passed everything real in years 1-3 but cannot "pass" the slot.
        const y1 = subj('Y1', { year: 1, term: 1 });
        const y2 = subj('Y2', { year: 2, term: 1 });
        const y3 = subj('Y3', { year: 3, term: 1 });
        const slot = subj('IT-EL1', { year: 3, term: 1, type: 'IT' });   // is_elective false
        const y4 = subj('Y4', { year: 4, term: 1 });

        const out = E.assess(student(), [y1, y2, y3].map(rec),
            { subjects: [y1, y2, y3, slot, y4], rules: [], offerings: [] }, opts);

        assert.ok(out.eligible.some(e => e.subject.code === 'Y4'),
            'year 4 opens once every real subject is done');
    });

    test('the same slot flagged is_elective=true behaves identically', () => {
        const y1 = subj('Y1', { year: 1, term: 1 });
        const y2 = subj('Y2', { year: 2, term: 1 });
        const y3 = subj('Y3', { year: 3, term: 1 });
        const slot = subj('IT-EL1', { year: 3, term: 1, type: 'IT', is_elective: true });
        const y4 = subj('Y4', { year: 4, term: 1 });

        const out = E.assess(student(), [y1, y2, y3].map(rec),
            { subjects: [y1, y2, y3, slot, y4], rules: [], offerings: [] }, opts);
        assert.ok(out.eligible.some(e => e.subject.code === 'Y4'));
    });

    test('a required subject left unpassed still holds the gate closed', () => {
        const y1 = subj('Y1', { year: 1, term: 1 });
        const y3 = subj('Y3', { year: 3, term: 1 });
        const y4 = subj('Y4', { year: 4, term: 1 });
        const out = E.assess(student(), [rec(y1)], { subjects: [y1, y3, y4], rules: [], offerings: [] }, opts);
        assert.ok(!out.eligible.some(e => e.subject.code === 'Y4'));
    });

    test('a slot ranks below a required subject', () => {
        const req = subj('REQ', { year: 1, term: 1 });
        const slot = subj('BSN-ELEC1', { year: 1, term: 1, type: 'IT' });
        const out = E.assess(student(1), [], { subjects: [slot, req], rules: [], offerings: [] }, opts);
        const p = (c) => out.eligible.find(e => e.subject.code === c).priority;
        assert.ok(p('REQ') > p('BSN-ELEC1'));
    });

    test('isElective is exported and agrees with the shared helper', () => {
        const cases = [{ is_elective: false, elective_type: 'FREE' }, { is_elective: true }, { is_elective: false }];
        for (const c of cases) assert.equal(E.isElective(c), EL.isElectiveSubject(c));
    });
});


/* ---- a passed catalogue elective fills a slot ---- */

describe('filling elective slots', () => {
    let n = 5000;
    const base = (code, o = {}) => ({
        id: n++, code, title: code, units: o.units ?? 3,
        year_level: o.year ?? null, term: o.term ?? null,
        is_elective: o.elective ?? false, elective_type: o.type ?? null,
    });
    const slot = (code, year, term, type = 'IT') => base(code, { year, term, elective: true, type });
    const cat  = (code, type = 'IT', units = 3) => base(code, { elective: true, type, units });
    const req  = (code, year = 1, term = 1) => base(code, { year, term });

    const student = () => ({ id: 's', year_level: 3 });
    const opts = { respectOfferings: false, yearGate: false };
    const rec = (s, status = 'PASSED') => ({ subject_id: s.id, status });
    const run = (subjects, records) => E.assess(student(), records, { subjects, rules: [], offerings: [] }, opts);
    const codes = (list) => list.map(e => e.subject.code);

    // Two IT slots (3-1, 3-2), one FREE slot (3-1), three IT options, one FREE option.
    const IT1 = slot('IT-EL1', 3, 1), IT2 = slot('IT-EL2', 3, 2), FR1 = slot('IT-FRE1', 3, 1, 'FREE');
    const A = cat('ELA'), B = cat('ELB'), C = cat('ELC'), F = cat('FRA', 'FREE');
    const R1 = req('R1');
    const all = [R1, IT1, IT2, FR1, A, B, C, F];

    test('passing an IT catalogue subject fills the earliest open IT slot', () => {
        const out = run(all, [rec(A)]);
        const done = out.completed.find(s => s.code === 'IT-EL1');
        assert.ok(done, 'the 3-1 slot is done');
        assert.equal(done.filledBy.code, 'ELA');
        assert.deepEqual(out.electives.IT, { slots: 2, filled: 1, remaining: 1, options: out.electives.IT.options });
        assert.ok(codes(out.eligible).includes('IT-EL2'), 'the second slot is still open');
    });

    test('a filled slot is not offered again', () => {
        const out = run(all, [rec(A)]);
        assert.ok(![...out.eligible, ...out.locked].some(e => e.subject.code === 'IT-EL1'));
        assert.ok(!out.recommended.some(r => r.subject.code === 'IT-EL1'));
    });

    test('a free elective does not fill a programme-elective slot', () => {
        const out = run(all, [rec(F)]);
        assert.ok(!out.completed.some(s => s.code === 'IT-EL1' || s.code === 'IT-EL2'));
        assert.ok(out.completed.some(s => s.code === 'IT-FRE1' && s.filledBy.code === 'FRA'));
        assert.equal(out.electives.IT.filled, 0);
        assert.equal(out.electives.FREE.filled, 1);
    });

    test('slots fill earliest semester first, one catalogue subject each', () => {
        const out = run(all, [rec(A), rec(B)]);
        assert.deepEqual(out.completed.filter(s => s.filledBy).map(s => [s.code, s.filledBy.code]),
            [['IT-EL1', 'ELA'], ['IT-EL2', 'ELB']]);
        assert.equal(out.electives.IT.remaining, 0);
    });

    test('a slot passed directly counts, and a catalogue subject fills the next one', () => {
        const out = run(all, [rec(IT1), rec(A)]);
        assert.equal(out.electives.IT.filled, 2);
        assert.equal(out.electives.IT.remaining, 0);
        assert.ok(out.completed.some(s => s.code === 'IT-EL2' && s.filledBy?.code === 'ELA'));
    });

    test('once every IT slot is filled, the rest of the IT catalogue is no longer offered', () => {
        const out = run(all, [rec(A), rec(B)]);
        const shown = [...out.eligible, ...out.locked].map(e => e.subject.code);
        assert.ok(!shown.includes('ELC'), 'nothing left for ELC to fill');
        assert.ok(shown.includes('FRA'), 'the free catalogue is unaffected');
    });

    test('catalogue subjects beyond the number of slots earn no degree units', () => {
        const out = run(all, [rec(A), rec(B), rec(C)]);   // 3 passed, 2 slots
        assert.equal(out.facts.unitsEarned, 6);
    });

    test('a catalogue subject that fills a slot does count as earned', () => {
        assert.equal(run(all, [rec(A)]).facts.unitsEarned, 3);
    });

    test('the degree total never includes the catalogue', () => {
        // R1 + three slots, 3 units each.
        assert.equal(run(all, []).totalUnits, 12);
    });

    test('catalogue options are choices, never recommended load; the open slots are', () => {
        const out = run(all, []);
        const rc = codes(out.recommended);
        assert.ok(!rc.some(c => ['ELA', 'ELB', 'ELC', 'FRA'].includes(c)));
        assert.ok(rc.includes('IT-EL1') && rc.includes('IT-EL2') && rc.includes('IT-FRE1'));
    });

    test('an open slot says how many options it can be filled with', () => {
        const out = run(all, []);
        const e = out.recommended.find(r => r.subject.code === 'IT-EL1');
        assert.equal(e.slotOptions.length, 3);
        assert.match(e.reason, /choose one of 3 programme electives/);
        const f = out.recommended.find(r => r.subject.code === 'IT-FRE1');
        assert.match(f.reason, /choose one of 1 free elective\./);
    });

    test('a slot with no catalogue behind it says so', () => {
        const out = run([R1, IT1], []);
        const e = out.recommended.find(r => r.subject.code === 'IT-EL1');
        assert.match(e.reason, /no electives are listed/);
    });

    test('a catalogue subject being taken (not passed) does not fill a slot yet', () => {
        const out = run(all, [rec(A, 'ENROLLED')]);
        assert.equal(out.electives.IT.filled, 0);
        assert.ok(!out.completed.some(s => s.filledBy));
    });

    test('a program with a catalogue but no slots keeps its catalogue visible', () => {
        const out = run([R1, A, B], []);
        assert.ok(codes(out.eligible).includes('ELA'));
        assert.equal(out.electives.IT.slots, 0);
    });

    test('a program with no electives at all has an empty summary', () => {
        assert.deepEqual(run([R1, req('R2', 1, 2)], []).electives, {});
    });
});
