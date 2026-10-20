import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sc = require('../shared/js/scheduleconflicts.js');
const { plan, needFor } = require('../shared/js/schedulesuggest.js');

const SUBJECTS = {
    1: { units: 3, lab_units: 0 }, 2: { units: 3, lab_units: 1 }, 3: { units: 2, lab_units: 0 },
    4: { units: 1, lab_units: 0 }, 5: { units: 3, lab_units: 0 }, 6: { units: 3, lab_units: 1 },
};
const subjectOf = (id) => SUBJECTS[id];
const run = (rows, fixed = [], options) => plan({ rows, fixed, subjectOf, sc, options });
const lec = (key, subject_id) => ({ key, subject_id, meeting_type: 'LEC' });
const lab = (key, subject_id) => ({ key, subject_id, meeting_type: 'LAB' });

const asMeetings = (placements) => placements.map(p => ({
    schedule_days: p.days, start_time: p.start, end_time: p.end }));

test('a 3-unit lecture is 1.5 hours on MW or TTH', () => {
    const { placements } = run([lec('a', 1)]);
    assert.equal(placements.length, 1);
    assert.ok(['MW', 'TTH'].includes(placements[0].days));
    assert.equal(sc.minutesOf(placements[0].end) - sc.minutesOf(placements[0].start), 90);
});

test('a laboratory is 3 hours on Friday or Saturday', () => {
    const { placements } = run([lab('a', 2)]);
    assert.ok(['F', 'S'].includes(placements[0].days));
    assert.equal(sc.minutesOf(placements[0].end) - sc.minutesOf(placements[0].start), 180);
});

test('2-unit and 1-unit lectures are shorter', () => {
    assert.equal(needFor(SUBJECTS[3], 'LEC').length, 60);
    assert.deepEqual(needFor(SUBJECTS[3], 'LEC').patterns[0], ['M', 'W']);
    assert.equal(needFor(SUBJECTS[4], 'LEC').length, 60);
    assert.equal(needFor(SUBJECTS[4], 'LEC').patterns[0].length, 1);
});

test('nothing placed overlaps anything else in the section', () => {
    const rows = [lec('a', 1), lec('b', 2), lec('c', 3), lec('d', 5), lec('e', 6), lab('f', 2), lab('g', 6)];
    const { placements, unplaced } = run(rows);
    assert.equal(unplaced.length, 0);
    const m = asMeetings(placements);
    for (let i = 0; i < m.length; i++) {
        for (let j = i + 1; j < m.length; j++) {
            assert.equal(sc.meetingsClash(m[i], m[j]), false, `${JSON.stringify(m[i])} vs ${JSON.stringify(m[j])}`);
        }
    }
});

test('it keeps clear of rows already timed in the section', () => {
    const fixed = [{ schedule_days: 'MW', start_time: '07:30', end_time: '09:00' },
                   { schedule_days: 'TTH', start_time: '07:30', end_time: '09:00' }];
    const { placements } = run([lec('a', 1), lec('b', 5)], fixed);
    for (const p of asMeetings(placements)) {
        for (const f of fixed) assert.equal(sc.meetingsClash(p, f), false);
    }
});

test('lunch (12:00-1:00) is never used', () => {
    const rows = Array.from({ length: 10 }, (_, i) => lec('r' + i, 1));
    const { placements } = run(rows);
    for (const p of placements) {
        const a = sc.minutesOf(p.start), b = sc.minutesOf(p.end);
        assert.equal(a < 13 * 60 && b > 12 * 60, false, `${p.days} ${p.start}-${p.end} touches lunch`);
    }
});

test('no day goes over the daily limit', () => {
    const rows = Array.from({ length: 12 }, (_, i) => lec('r' + i, 1));
    const { placements } = run(rows, [], { maxHoursPerDay: 4 });
    const hours = {};
    for (const p of placements) {
        for (const d of sc.parseDays(p.days)) {
            hours[d] = (hours[d] ?? 0) + (sc.minutesOf(p.end) - sc.minutesOf(p.start)) / 60;
        }
    }
    for (const [d, h] of Object.entries(hours)) assert.ok(h <= 4, `${d} has ${h} hours`);
});

test('everything stays inside the class day', () => {
    const rows = Array.from({ length: 8 }, (_, i) => lec('r' + i, 1)).concat([lab('l', 2)]);
    for (const p of run(rows).placements) {
        assert.ok(sc.minutesOf(p.start) >= 7 * 60 + 30);
        assert.ok(sc.minutesOf(p.end) <= 18 * 60 + 30);
    }
});

test('sections stay balanced between MW and TTH', () => {
    const { placements } = run([lec('a', 1), lec('b', 5), lec('c', 1), lec('d', 5)]);
    const mw = placements.filter(p => p.days === 'MW').length;
    const tth = placements.filter(p => p.days === 'TTH').length;
    assert.equal(mw, 2);
    assert.equal(tth, 2);
});

test('a subject with no free time is reported, never forced in', () => {
    // Fill Friday and Saturday completely so a lab has nowhere to go.
    const fixed = ['F', 'S'].map(d => ({ schedule_days: d, start_time: '07:30', end_time: '18:30' }));
    const { placements, unplaced } = run([lab('a', 2)], fixed);
    assert.equal(placements.length, 0);
    assert.equal(unplaced.length, 1);
    assert.equal(unplaced[0].key, 'a');
    assert.match(unplaced[0].reason, /No free time/);
});

test('the same input always gives the same answer', () => {
    const rows = [lec('a', 1), lec('b', 2), lab('c', 2), lec('d', 3)];
    assert.deepEqual(run(rows), run(rows));
});

test('it does not change what it was given', () => {
    const rows = [lec('a', 1)];
    const fixed = [{ schedule_days: 'MW', start_time: '08:00', end_time: '09:30' }];
    const before = JSON.stringify({ rows, fixed });
    run(rows, fixed);
    assert.equal(JSON.stringify({ rows, fixed }), before);
});

test('nothing to place gives nothing back', () => {
    assert.deepEqual(run([]), { placements: [], unplaced: [] });
});

test('days come back in the form the table already uses', () => {
    const days = new Set(run([lec('a', 1), lec('b', 1), lab('c', 2), lec('d', 4)]).placements.map(p => p.days));
    for (const d of days) assert.match(d, /^(MW|TTH|F|S|M|T|W|TH)$/);
});
