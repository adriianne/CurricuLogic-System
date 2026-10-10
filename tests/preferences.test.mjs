// preferences.test.mjs
// The preference step that sits on top of the engine's recommendation.
//
//   node --test tests/engine.test.mjs tests/preferences.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const E = require('../shared/engine/engine.js');
const P = require('../shared/engine/preferences.js');

let nextId = 1000;
const subj = (code, o = {}) => ({
    id: o.id ?? nextId++, code, title: code, units: o.units ?? 3,
    year_level: o.year ?? 1, term: o.term ?? 1, is_elective: false,
});
const student = (year = 1) => ({ id: 's1', year_level: year });
const kbOf = (subjects, offerings = []) => ({ subjects, rules: [], offerings });
const meet = (subject, section, days, start, end, type = 'LEC') => ({
    subject_id: subject.id, section, meeting_type: type,
    schedule_days: days, start_time: start, end_time: end,
});
const codes = (list) => list.map(e => e.subject.code);
const units = (list) => list.reduce((t, e) => t + e.subject.units, 0);
const rec = (subject, status) => ({ subject_id: subject.id, status });

const many = (n, o = {}) => Array.from({ length: n }, (_, i) => subj('S' + i, o));


describe('no preference', () => {
    test('leaves the engine\'s recommendation exactly as it was', () => {
        const subjects = many(6);
        const result = E.assess(student(), [], kbOf(subjects), { respectOfferings: false });
        const plan = P.apply(result, {});
        assert.deepEqual(codes(plan.recommended), codes(result.recommended));
        assert.equal(plan.recommendedUnits, result.recommendedUnits);
        assert.equal(plan.preference.ceiling, null);
        assert.deepEqual(plan.preference.deferred, []);
    });

    test('unrecognised values are ignored, not guessed at', () => {
        const result = E.assess(student(), [], kbOf(many(4)), { respectOfferings: false });
        const plan = P.apply(result, { timeOfDay: 'midnight', load: 'huge' });
        assert.equal(plan.preference.timeOfDay, null);
        assert.equal(plan.preference.load, null);
        assert.equal(codes(plan.recommended).length, codes(result.recommended).length);
    });

    test('does not change the assessment it is given', () => {
        const result = E.assess(student(), [], kbOf(many(8)), { respectOfferings: false });
        const before = JSON.stringify(result.recommended.map(e => e.subject.code));
        P.apply(result, { load: 'light' });
        assert.equal(JSON.stringify(result.recommended.map(e => e.subject.code)), before);
    });
});


describe('load', () => {
    // Ten 3-unit subjects, no rules: the engine fills the 24-unit cap with 8.
    const subjects = many(10);
    const result = E.assess(student(), [], kbOf(subjects), { respectOfferings: false });

    test('the engine fills the cap by itself', () => {
        assert.equal(result.recommendedUnits, 24);
    });

    test('light keeps to 15 units', () => {
        const plan = P.apply(result, { load: 'light' });
        assert.ok(plan.recommendedUnits <= 15);
        assert.equal(plan.recommendedUnits, 15);
        assert.equal(plan.preference.ceiling, 15);
    });

    test('regular keeps to 21 units', () => {
        const plan = P.apply(result, { load: 'regular' });
        assert.equal(plan.recommendedUnits, 21);
    });

    test('full is the engine\'s own list', () => {
        const plan = P.apply(result, { load: 'full' });
        assert.deepEqual(codes(plan.recommended), codes(result.recommended));
    });

    test('what is dropped is the least important, and is named', () => {
        const plan = P.apply(result, { load: 'light' });
        // The kept subjects are the front of the engine's priority order.
        assert.deepEqual(codes(plan.recommended), codes(result.recommended).slice(0, 5));
        assert.deepEqual(plan.preference.deferred, codes(result.recommended).slice(5));
    });

    test('never adds a subject the engine did not suggest', () => {
        const plan = P.apply(result, { load: 'light' });
        const allowed = new Set(codes(result.recommended));
        assert.ok(codes(plan.recommended).every(c => allowed.has(c)));
    });

    test('a load never exceeds the programme\'s own cap', () => {
        const capped = E.assess(student(), [], kbOf(many(10)), { respectOfferings: false, maxUnits: 12 });
        const plan = P.apply(capped, { load: 'regular' });   // would be 21, cap is 12
        assert.ok(plan.recommendedUnits <= 12);
        assert.equal(plan.preference.ceiling, 12);
    });

    test('units already being carried count against the ceiling', () => {
        const all = many(10);
        const r = E.assess(student(), [rec(all[0], 'ENROLLED')], kbOf(all), { respectOfferings: false });
        const plan = P.apply(r, { load: 'light' });
        assert.ok(plan.recommendedUnits + r.enrolledUnits <= 15);
    });

    test('a retake outranks everything, so a light load keeps it', () => {
        const all = many(10);
        const r = E.assess(student(), [rec(all[9], 'FAILED')], kbOf(all), { respectOfferings: false });
        const plan = P.apply(r, { load: 'light' });
        assert.ok(codes(plan.recommended).includes('S9'));
    });

    test('a student close to graduating is warned that a light load may add a term', () => {
        // 10 subjects, 2 passed -> 24 units left, which is "graduating".
        const all = many(10);
        const r = E.assess(student(), [rec(all[0], 'PASSED'), rec(all[1], 'PASSED')],
            kbOf(all), { respectOfferings: false });
        assert.equal(r.graduating, true);
        const plan = P.apply(r, { load: 'light' });
        assert.match(plan.preference.notes.join(' '), /add a term/);
    });
});


describe('time of day', () => {
    const a = subj('A'), b = subj('B');

    test('picks the section that matches the preferred time', () => {
        const offerings = [
            meet(a, '1-A', 'MW', '14:00', '15:30'),
            meet(a, '1-B', 'MW', '08:00', '09:30'),
        ];
        const r = E.assess(student(), [], kbOf([a], offerings));
        const plan = P.apply(r, { timeOfDay: 'morning' });
        const e = plan.recommended[0];
        assert.equal(e.chosenSection.section, '1-B');
        assert.equal(e.timeMatch, 'match');
        assert.match(e.preferenceReason, /morning/);
    });

    test('with an afternoon preference it picks the other section', () => {
        const offerings = [
            meet(a, '1-A', 'MW', '14:00', '15:30'),
            meet(a, '1-B', 'MW', '08:00', '09:30'),
        ];
        const r = E.assess(student(), [], kbOf([a], offerings));
        const plan = P.apply(r, { timeOfDay: 'afternoon' });
        assert.equal(plan.recommended[0].chosenSection.section, '1-A');
    });

    test('a clash-free section beats a matching one that clashes', () => {
        // A only has a morning section (MW 8:00). B has a morning section that
        // clashes with it and an afternoon one that does not.
        const offerings = [
            meet(a, '1-A', 'MW', '08:00', '09:30'),
            meet(b, '1-A', 'MW', '08:30', '10:00'),
            meet(b, '1-B', 'MW', '14:00', '15:30'),
        ];
        const r = E.assess(student(), [], kbOf([a, b], offerings));
        const plan = P.apply(r, { timeOfDay: 'morning' });
        const pickB = plan.recommended.find(e => e.subject.code === 'B');
        assert.equal(pickB.chosenSection.section, '1-B');
        assert.deepEqual(pickB.clashesWith, []);
    });

    test('says so when the only section is at the wrong time', () => {
        const offerings = [meet(a, '1-A', 'MW', '14:00', '15:30')];
        const r = E.assess(student(), [], kbOf([a], offerings));
        const plan = P.apply(r, { timeOfDay: 'morning' });
        assert.equal(plan.recommended[0].timeMatch, 'other');
        assert.match(plan.recommended[0].preferenceReason, /Only section/);
        assert.match(plan.preference.notes.join(' '), /A has no morning section/);
    });

    test('a subject that clashes in every section is left out and says why', () => {
        const offerings = [
            meet(a, '1-A', 'MW', '08:00', '09:30'),
            meet(b, '1-A', 'MW', '08:30', '10:00'),
        ];
        const r = E.assess(student(), [], kbOf([a, b], offerings));
        const plan = P.apply(r, {});
        assert.equal(plan.recommended.length, 1);
        assert.equal(plan.leftOutForClash.length, 1);
        assert.deepEqual(plan.leftOutForClash[0].blockedBy, [`${plan.recommended[0].subject.code} (1-A)`]);
        assert.match(plan.preference.notes.join(' '), /every section clashes/);
        assert.deepEqual(plan.preference.deferredForClash, [plan.leftOutForClash[0].subject.code]);
    });

    test('summarises how many subjects fit the preference', () => {
        const offerings = [
            meet(a, '1-A', 'MW', '08:00', '09:30'),
            meet(b, '1-A', 'TTH', '14:00', '15:30'),
        ];
        const r = E.assess(student(), [], kbOf([a, b], offerings));
        const plan = P.apply(r, { timeOfDay: 'morning' });
        assert.match(plan.preference.notes[0], /1 of 2/);
    });

    test('a subject with no schedule yet has no chosen section and says why', () => {
        // Nothing scheduled anywhere for year 2, so it is "pending".
        const x = subj('X', { year: 1, term: 1 });
        const y = subj('Y', { year: 2, term: 1 });
        const r = E.assess(student(), [], kbOf([x, y], [meet(y, '2-A', 'MW', '08:00', '09:30')]), { term: 1 });
        const plan = P.apply(r, { timeOfDay: 'morning' });
        const px = plan.recommended.find(e => e.subject.code === 'X');
        assert.equal(px.chosenSection, null);
        assert.equal(px.timeMatch, 'none');
        assert.match(px.preferenceReason, /No schedule has been published/);
    });

    test('a time preference changes sections only, never which subjects are suggested', () => {
        const offerings = [meet(a, '1-A', 'MW', '14:00', '15:30'), meet(b, '1-A', 'MW', '08:00', '09:30')];
        const r = E.assess(student(), [], kbOf([a, b], offerings));
        const plan = P.apply(r, { timeOfDay: 'morning' });
        assert.deepEqual(codes(plan.recommended).sort(), codes(r.recommended).sort());
    });
});


describe('both together', () => {
    test('a light load and a time preference apply in one pass', () => {
        const subjects = many(10);
        const hh = (n) => String(n).padStart(2, '0') + ':00';
        // each subject has its own hour, so nothing clashes: A on MW, B on TTH
        const offerings = subjects.flatMap((s, i) => [
            meet(s, 'A', 'MW', hh(7 + i), hh(8 + i)),
            meet(s, 'B', 'TTH', hh(7 + i), hh(8 + i)),
        ]);
        const r = E.assess(student(), [], kbOf(subjects, offerings));
        const plan = P.apply(r, { load: 'light', timeOfDay: 'afternoon' });
        assert.equal(plan.recommendedUnits, 15);
        assert.ok(plan.recommended.every(e => e.chosenSection));
        assert.ok(plan.preference.notes.length >= 1);
    });
});


describe('section planner', () => {
    const x = subj('X'), y = subj('Y'), z = subj('Z');
    const slot = (s, section, days, start, end, type = 'LEC') => meet(s, section, days, start, end, type);
    const hh = (n) => String(n).padStart(2, '0') + ':00';

    test('mixes sections so everything fits when a one-at-a-time pick would not', () => {
        // X is in 1-A (MW 8-9:30) and 1-B (TTH 8-9:30). Y is only in 1-A (MW 8:30-10).
        // Putting X in 1-A first would block Y; putting X in 1-B fits both.
        const offerings = [
            slot(x, '1-A', 'MW', '08:00', '09:30'), slot(x, '1-B', 'TTH', '08:00', '09:30'),
            slot(y, '1-A', 'MW', '08:30', '10:00'),
        ];
        const plan = P.apply(E.assess(student(), [], kbOf([x, y], offerings)), {});
        assert.equal(plan.recommended.length, 2);
        assert.deepEqual(plan.leftOutForClash, []);
        const sectionOf = (c) => plan.recommended.find(e => e.subject.code === c).chosenSection.section;
        assert.equal(sectionOf('X'), '1-B');
        assert.equal(sectionOf('Y'), '1-A');
    });

    test('five subjects whose labs share two slots: only two can be taken, the rest are named', () => {
        const five = ['L1', 'L2', 'L3', 'L4', 'L5'].map(c => subj(c));
        const offerings = five.flatMap((s, i) => [
            slot(s, '2A', 'F', '13:00', '16:00', 'LAB'), slot(s, '2A', 'MW', hh(7 + i), hh(8 + i)),
            slot(s, '2B', 'S', '08:00', '11:00', 'LAB'), slot(s, '2B', 'TTH', hh(7 + i), hh(8 + i)),
        ]);
        const plan = P.apply(E.assess(student(), [], kbOf(five, offerings)), {});
        assert.equal(plan.recommended.length, 2);
        assert.equal(plan.leftOutForClash.length, 3);
        const sections = plan.recommended.map(e => e.chosenSection.section).sort();
        assert.deepEqual(sections, ['2A', '2B'], 'one subject in each lab slot');
        assert.equal(plan.recommendedUnits, 6);
    });

    test('a left-out subject names what blocks it and the one subject that would have to give way', () => {
        // X is fixed on MW. Y fits in 1-A (MW 8:30, clashes X) or 1-B (TTH 8-9:30).
        // Z is only TTH 8:30-9. Y and Z cannot both be taken: one waits.
        const offerings = [
            slot(x, '1-A', 'MW', '08:00', '09:30'),
            slot(y, '1-A', 'MW', '08:30', '10:00'), slot(y, '1-B', 'TTH', '08:00', '09:30'),
            slot(z, '1-A', 'TTH', '08:30', '09:00'),
        ];
        const plan = P.apply(E.assess(student(), [], kbOf([x, y, z], offerings)), {});
        const left = plan.leftOutForClash;
        assert.equal(left.length, 1, 'one of Y and Z has to wait');
        assert.ok(left[0].blockedBy.length >= 1);
        assert.ok(left[0].swaps.length >= 1, 'a single swap would make room');
        assert.ok(left[0].swaps.every(s => s.instead && s.section));
    });

    test('a retake is kept before a regular subject in the same slot', () => {
        const retake = subj('RT'), regular = subj('RG');
        const records = [rec(retake, 'FAILED')];
        const offerings = [slot(retake, '1-A', 'MW', '08:00', '09:30'), slot(regular, '1-A', 'MW', '08:00', '09:30')];
        const plan = P.apply(E.assess(student(), records, kbOf([retake, regular], offerings)), {});
        assert.deepEqual(codes(plan.recommended), ['RT']);
        assert.deepEqual(codes(plan.leftOutForClash), ['RG']);
    });

    test('a subject with no schedule is never left out for a clash', () => {
        const noSched = subj('NS', { year: 2, term: 1 });
        const offerings = [slot(x, '1-A', 'MW', '08:00', '09:30')];
        const plan = P.apply(E.assess(student(), [], kbOf([x, noSched], offerings), { term: 1 }), {});
        assert.deepEqual(plan.leftOutForClash, []);
    });

    test('among clash-free plans the preferred time still decides', () => {
        const offerings = [
            slot(x, '1-A', 'MW', '14:00', '15:30'), slot(x, '1-B', 'MW', '08:00', '09:30'),
            slot(y, '1-A', 'TTH', '14:00', '15:30'), slot(y, '1-B', 'TTH', '08:00', '09:30'),
        ];
        const plan = P.apply(E.assess(student(), [], kbOf([x, y], offerings)), { timeOfDay: 'morning' });
        assert.ok(plan.recommended.every(e => e.timeMatch === 'match'));
        assert.deepEqual(plan.leftOutForClash, []);
    });

    test('the planner never adds a subject the engine did not recommend', () => {
        const offerings = [slot(x, '1-A', 'MW', '08:00', '09:30'), slot(y, '1-A', 'MW', '08:00', '09:30')];
        const r = E.assess(student(), [], kbOf([x, y], offerings));
        const plan = P.apply(r, {});
        const all = [...codes(plan.recommended), ...codes(plan.leftOutForClash)].sort();
        assert.deepEqual(all, codes(r.recommended).sort());
    });

    test('a twelve-subject term is planned at once', () => {
        const dozen = Array.from({ length: 12 }, (_, i) => subj('D' + i));
        const offerings = dozen.flatMap(s => [
            slot(s, 'A', 'MW', '08:00', '09:30'), slot(s, 'B', 'TTH', '08:00', '09:30'), slot(s, 'C', 'F', '08:00', '09:30'),
        ]);
        const t0 = Date.now();
        const plan = P.apply(E.assess(student(), [], kbOf(dozen, offerings), { maxUnits: 99 }), {});
        assert.ok(Date.now() - t0 < 2000, 'finishes quickly');
        assert.equal(plan.recommended.length, 3, 'three slots, three subjects');
    });
});


describe('can two subjects be taken together', () => {
    const x = subj('PX'), y = subj('PY'), z = subj('PZ');
    const slot = (s, section, days, start, end) => meet(s, section, days, start, end);

    test('a left-out subject reports, for each suggested one, whether it fits beside it and what must go', () => {
        // X: only MW 8-9:30. Y: 1-A MW 8:30-10 (clashes X) and 1-B TTH 8-9:30.
        // Z: 1-A MW 9-10 (clashes X) and 1-B TTH 8:30-9 (clashes Y's 1-B).
        const offerings = [
            slot(x, '1-A', 'MW', '08:00', '09:30'),
            slot(y, '1-A', 'MW', '08:30', '10:00'), slot(y, '1-B', 'TTH', '08:00', '09:30'),
            slot(z, '1-A', 'MW', '09:00', '10:00'), slot(z, '1-B', 'TTH', '08:30', '09:00'),
        ];
        const plan = P.apply(E.assess(student(), [], kbOf([x, y, z], offerings)), {});
        assert.equal(plan.leftOutForClash.length, 1);
        const left = plan.leftOutForClash[0];
        assert.equal(left.together.length, 2, 'one answer per suggested subject');
        for (const t of left.together) {
            assert.equal(typeof t.possible, 'boolean');
            if (t.possible) assert.ok(t.takeSection, 'names the section to take');
            else assert.equal(t.takeSection, null);
        }
        // together with X: Z in 1-B (TTH) does not clash with X, but it clashes with Y's 1-B
        const withX = left.together.find(t => t.with === 'PX');
        assert.equal(withX.possible, true);
        assert.deepEqual(withX.dropFirst, ['PY']);
    });

    test('it is "no" when every section of the left-out subject clashes with that one', () => {
        const offerings = [slot(x, '1-A', 'MW', '08:00', '09:30'), slot(y, '1-A', 'MW', '08:30', '10:00')];
        const plan = P.apply(E.assess(student(), [], kbOf([x, y], offerings)), {});
        const t = plan.leftOutForClash[0].together[0];
        assert.equal(t.possible, false);
        assert.deepEqual(t.dropFirst, []);
    });
});


describe('alternative plans', () => {
    const x = subj('AX'), y = subj('AY'), z = subj('AZ');
    const slot = (s, section, days, start, end) => meet(s, section, days, start, end);

    test('a time-of-day alternative keeps the subjects and moves sections', () => {
        const offerings = [
            slot(x, '1A', 'MW', '08:00', '09:30'), slot(x, '1B', 'MW', '14:00', '15:30'),
            slot(y, '1A', 'TTH', '08:00', '09:30'), slot(y, '1B', 'TTH', '14:00', '15:30'),
        ];
        const plan = P.apply(E.assess(student(), [], kbOf([x, y], offerings)), { timeOfDay: 'morning' });
        const afternoon = plan.alternatives.find(a => a.label === 'Afternoon classes');
        assert.ok(afternoon, 'an afternoon version is offered');
        assert.deepEqual(afternoon.placed.map(p => p.section).sort(), ['1B', '1B']);
        assert.deepEqual(afternoon.notIncluded, []);
        assert.equal(afternoon.changes.length, 2);
        assert.match(afternoon.note, /2 of 2 scheduled subjects in afternoon sections/);
        assert.ok(!plan.alternatives.some(a => a.label === 'Morning classes'), 'the current preference is not offered again');
    });

    test('an alternative that takes a left-out subject names what it displaces', () => {
        const offerings = [slot(x, '1A', 'MW', '08:00', '09:30'), slot(y, '1A', 'MW', '08:30', '10:00')];
        const plan = P.apply(E.assess(student(), [], kbOf([x, y], offerings)), {});
        const left = plan.leftOutForClash[0].subject.code;
        const inc = plan.alternatives.find(a => a.label === `Include ${left}`);
        assert.ok(inc, 'a plan that includes the subject that did not fit');
        assert.ok(inc.placed.some(p => p.code === left));
        assert.ok(inc.changes.includes(`${left} is added`));
        assert.ok(inc.changes.some(c => /is left out$/.test(c)));
        assert.equal(inc.notIncluded.length, 1);
    });

    test('an alternative is never the current plan again and never a repeat', () => {
        const offerings = [slot(x, '1A', 'MW', '08:00', '09:30'), slot(y, '1A', 'TTH', '08:00', '09:30')];
        const plan = P.apply(E.assess(student(), [], kbOf([x, y], offerings)), {});
        assert.deepEqual(plan.alternatives, [], 'single sections leave nothing to vary');
    });

    test('at most four alternatives, each clash-free', () => {
        const many = Array.from({ length: 6 }, (_, i) => subj('M' + i));
        const hh = (n) => String(n).padStart(2, '0') + ':00';
        const offerings = many.flatMap((s, i) => [
            slot(s, 'A', 'MW', hh(7 + i), hh(8 + i)), slot(s, 'B', 'TTH', hh(7 + i), hh(8 + i)), slot(s, 'C', 'F', hh(7 + i), hh(8 + i)),
        ]);
        const plan = P.apply(E.assess(student(), [], kbOf(many, offerings), { maxUnits: 99 }), {});
        assert.ok(plan.alternatives.length <= 4);
        for (const a of plan.alternatives) {
            const byDay = new Map();
            for (const p of a.placed) {
                const i = Number(p.code.slice(1));
                const key = `${p.section}-${i}`;
                assert.ok(!byDay.has(key), 'no two subjects share a slot');
                byDay.set(key, true);
            }
        }
    });
});


describe('summarize (the short version shown to the student)', () => {
    const a = subj('A'), b = subj('B'), c = subj('C');
    const run = (offerings, prefs, subjects = [a, b, c]) =>
        P.summarize(P.apply(E.assess(student(), [], kbOf(subjects, offerings)), prefs));

    test('says so once when no subject has the wanted time, instead of one line each', () => {
        const s = run([
            meet(a, '1-A', 'MW', '14:00', '15:30'),
            meet(b, '1-A', 'TTH', '14:00', '15:30'),
            meet(c, '1-A', 'F', '08:00', '09:30'),
        ], { timeOfDay: 'evening' });
        assert.equal(s.headline, 'No evening classes could be fitted this term.');
        assert.match(s.body, /^None of your 3 subjects has an evening section that works/);
        assert.match(s.body, /afternoon for the rest|morning for C/);
        assert.equal(s.details.length, 1);
        for (const code of ["A", "B", "C"]) assert.ok(s.details[0].includes(`${code} (`));
    });

    test('reports the share that fit when only some do', () => {
        const s = run([
            meet(a, '1-A', 'MW', '08:00', '09:30'),
            meet(b, '1-A', 'TTH', '14:00', '15:30'),
        ], { timeOfDay: 'morning' }, [a, b]);
        assert.equal(s.headline, '1 of 2 scheduled subjects fit your morning preference.');
        assert.match(s.body, /^For the others, the closest time was used: afternoon\.$/);
    });

    test('says all of them fit when they do', () => {
        const s = run([
            meet(a, '1-A', 'MW', '08:00', '09:30'),
            meet(b, '1-A', 'TTH', '08:00', '09:30'),
        ], { timeOfDay: 'morning' }, [a, b]);
        assert.match(s.headline, /^All 2 of your scheduled subjects fit your morning preference\.$/);
        assert.equal(s.body, '');
        assert.deepEqual(s.details, []);
    });

    test('a left-out subject is named without its section codes', () => {
        const s = run([
            meet(a, '1-A', 'MW', '08:00', '09:30'),
            meet(b, '1-A', 'MW', '08:30', '10:00'),
        ], {}, [a, b]);
        assert.match(s.leftOut, /^Left out: [AB] clashes with the rest of your plan\.$/);
        assert.equal(s.details.length, 1);
        assert.doesNotMatch(s.details[0], /\(1-A\)/);
    });

    test('with no preference there is no headline and nothing to expand', () => {
        const s = run([meet(a, '1-A', 'MW', '08:00', '09:30')], {}, [a]);
        assert.equal(s.headline, '');
        assert.equal(s.leftOut, '');
        assert.deepEqual(s.details, []);
    });

    test('the engine\'s own notes are left as they were', () => {
        const r = E.assess(student(), [], kbOf([a], [meet(a, '1-A', 'MW', '14:00', '15:30')]));
        const plan = P.apply(r, { timeOfDay: 'morning' });
        assert.match(plan.preference.notes.join(' '), /A has no morning section/);
    });
});
