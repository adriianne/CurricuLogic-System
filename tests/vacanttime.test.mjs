// vacanttime.test.mjs
// Vacant time in a plan, and swap suggestions (shared/js/enrolment/vacanttime.js).
//
//   node --test tests/vacanttime.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { vacantTime, suggestSwaps } = require('../shared/js/enrolment/vacanttime.js');
const sc = require('../shared/js/schedule/scheduleconflicts.js');

let id = 1;
const row = (section, type, days, start, end) => ({ id: id++, section, meeting_type: type, schedule_days: days, start_time: start, end_time: end });
const pick = (code, section, rows) => ({ subjectId: code, code, section, sections: rows });

describe('vacantTime', () => {
    test('counts the gap between two classes on the same day', () => {
        const r = vacantTime([row('A', 'LEC', 'M', '07:30', '09:00'), row('A', 'LEC', 'M', '10:30', '12:00')], sc);
        assert.equal(r.hours, 1.5);
        assert.equal(r.gaps.length, 1);
    });
    test('the lunch hour is not counted', () => {
        const r = vacantTime([row('A', 'LEC', 'M', '10:30', '12:00'), row('A', 'LEC', 'M', '13:00', '14:30')], sc);
        assert.equal(r.hours, 0);
    });
    test('a gap that includes lunch counts only the rest', () => {
        const r = vacantTime([row('A', 'LEC', 'M', '09:00', '10:30'), row('A', 'LEC', 'M', '14:00', '15:30')], sc);
        assert.equal(r.hours, 2.5);          // 10:30 to 14:00 is 3.5 h, minus the 1 h lunch
    });
    test('waiting before the first class or after the last is not vacant time', () => {
        assert.equal(vacantTime([row('A', 'LEC', 'M', '15:00', '16:30')], sc).hours, 0);
    });
    test('different days do not make a gap, and MW counts as two days', () => {
        const r = vacantTime([row('A', 'LEC', 'MW', '07:30', '09:00'), row('A', 'LEC', 'W', '10:00', '11:00')], sc);
        assert.equal(r.hours, 1);            // only Wednesday has two classes
    });
    test('a class inside another one adds no gap', () => {
        const r = vacantTime([row('A', 'LEC', 'M', '07:30', '11:30'), row('A', 'LEC', 'M', '08:00', '09:00'), row('A', 'LEC', 'M', '11:30', '12:00')], sc);
        assert.equal(r.hours, 0);
    });
    test('rows without a time are ignored', () => {
        assert.equal(vacantTime([row('A', 'LEC', null, null, null), row('A', 'LEC', 'M', '08:00', '09:00')], sc).hours, 0);
    });
});

describe('suggestSwaps', () => {
    // Home plan: HIST in A on Monday morning, MATH in A on Monday after lunch -> a 2.5 h gap.
    const hist = [row('A', 'LEC', 'M', '07:30', '09:00'), row('B', 'LEC', 'M', '13:00', '14:30')];
    const math = [row('A', 'LEC', 'M', '13:30', '15:00'), row('B', 'LEC', 'M', '09:00', '10:30')];

    test('moves a subject to the section that closes the gap', () => {
        const r = suggestSwaps({ picks: [pick('HIST', 'A', hist), pick('MATH', 'A', math)], sc });
        assert.equal(r.before, 3.5);         // 09:00 to 13:30 is 4.5 h, minus the lunch hour
        assert.ok(r.after < r.before);
        assert.equal(r.swaps.length, 1);
        assert.deepEqual(r.swaps.map(s => [s.code, s.from, s.to]), [['MATH', 'A', 'B']]);
        assert.equal(r.after, 0);
    });

    test('never suggests a plan with an overlap', () => {
        const eng = [row('A', 'LEC', 'M', '13:30', '15:00'), row('B', 'LEC', 'M', '07:30', '09:00')];   // ENG B clashes with HIST A
        const picks = [pick('HIST', 'A', hist), pick('ENG', 'A', eng)];
        const r = suggestSwaps({ picks, sc });
        const sectionOf = (p) => r.swaps.find(s => s.code === p.code)?.to ?? p.section;
        const meetings = picks.flatMap(p => p.sections.filter(m => m.section === sectionOf(p)));
        for (let i = 0; i < meetings.length; i++) for (let j = i + 1; j < meetings.length; j++) assert.equal(sc.meetingsClash(meetings[i], meetings[j]), false);
    });

    test('lecture and lab of a subject move together', () => {
        const sci = [row('A', 'LEC', 'M', '13:30', '15:00'), row('A', 'LAB', 'F', '13:00', '16:00'),
                     row('B', 'LEC', 'M', '09:00', '10:30'), row('B', 'LAB', 'S', '13:00', '16:00')];
        const r = suggestSwaps({ picks: [pick('HIST', 'A', hist), pick('SCI', 'A', sci)], sc });
        assert.equal(r.swaps.length, 1);
        assert.equal(r.swaps[0].meetings.length, 2);
        assert.deepEqual(r.swaps[0].meetings.map(m => m.meeting_type).sort(), ['LAB', 'LEC']);
    });

    test('a subject appears at most once in the suggested swaps', () => {
        const r = suggestSwaps({ picks: [pick('HIST', 'A', hist), pick('MATH', 'A', math)], sc, maxSwaps: 2 });
        const codes = r.swaps.map(s => s.code);
        assert.equal(new Set(codes).size, codes.length);
    });

    test('a plan with no vacant time gets no suggestion and says so', () => {
        const r = suggestSwaps({ picks: [pick('HIST', 'A', [row('A', 'LEC', 'M', '07:30', '09:00')])], sc });
        assert.deepEqual(r.swaps, []);
        assert.equal(r.status, 'no-gap');
        assert.match(r.reason, /no vacant time/);
    });

    test('subjects with only one section cannot be swapped', () => {
        const only = [row('A', 'LEC', 'M', '07:30', '09:00')];
        const only2 = [row('A', 'LEC', 'M', '13:30', '15:00')];
        const r = suggestSwaps({ picks: [pick('HIST', 'A', only), pick('MATH', 'A', only2)], sc });
        assert.deepEqual(r.swaps, []);
        assert.match(r.reason, /only one section/);
    });

    test('says so when every swap overlaps or does not help', () => {
        const a = [row('A', 'LEC', 'M', '07:30', '09:00'), row('B', 'LEC', 'M', '07:30', '09:00')];
        const b = [row('A', 'LEC', 'M', '13:30', '15:00'), row('B', 'LEC', 'M', '13:30', '15:00')];
        const r = suggestSwaps({ picks: [pick('X', 'A', a), pick('Y', 'A', b)], sc });
        assert.deepEqual(r.swaps, []);
        assert.match(r.reason, /overlap|not reduce/);
    });

    test('two swaps are found when one is not enough', () => {
        const x = [row('A', 'LEC', 'M', '07:30', '09:00'), row('B', 'LEC', 'M', '13:00', '14:30')];
        const y = [row('A', 'LEC', 'M', '14:30', '16:00'), row('B', 'LEC', 'M', '09:00', '10:30')];
        const z = [row('A', 'LEC', 'M', '10:30', '12:00'), row('B', 'LEC', 'M', '16:00', '17:30')];
        const r = suggestSwaps({ picks: [pick('X', 'A', x), pick('Y', 'A', y), pick('Z', 'A', z)], sc });
        assert.ok(r.after < r.before);
    });

    test('a subject without posted times is ignored, not an error', () => {
        const r = suggestSwaps({ picks: [pick('HIST', 'A', hist), pick('NONE', 'A', [])], sc });
        assert.ok(Array.isArray(r.swaps));
    });
});
