// autoplan-fill.test.mjs
// With wishes, "Auto-select my plan" may fill the rest of the load from the other eligible subjects
// (shared/js/enrolment/autoplan.js). Without wishes it still uses only what the engine suggested.
//
//   node --test tests/autoplan-fill.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildAutoPlan, summarize } = require('../shared/js/enrolment/autoplan.js');
const conflicts = require('../shared/js/schedule/scheduleconflicts.js');

let nextId = 1000;
function subject(code, units, sections, extra = {}) {
    const id = nextId++;
    const rows = sections.map(([name, days, start, end]) => (
        { id: id * 100 + name.charCodeAt(name.length - 1), section: name, meeting_type: 'LEC', schedule_days: days, start_time: start, end_time: end }));
    return { subject: { id, code, title: code + ' title', units }, sections: rows, scheduleState: 'offered', ...extra };
}

const W = (o) => ({ earliestStart: null, latestEnd: null, avoidDays: [], maxUnits: null, keepSubjects: [], ...o });
const run = (entries, { suggested = [], wishes = null, cap = 24, fillCap = null } = {}) => buildAutoPlan({
    entries, suggestedIds: new Set(suggested.map(e => e.subject.id)), cap, conflicts, wishes, fillCap,
});

describe('filling from the other eligible subjects', () => {
    test('without wishes the other eligible subjects are never used', () => {
        const a = subject('AAA 101', 3, [['A1', 'MW', '08:00', '09:30']]);
        const r = run([a], { suggested: [] });
        assert.equal(r.picks.length, 0);
        assert.deepEqual(r.skipped, []);
    });

    test('with wishes and nothing suggested, eligible subjects make the plan (the Athena case)', () => {
        const a = subject('AAA 101', 3, [['A1', 'MW', '08:00', '09:30']]);
        const b = subject('BBB 101', 3, [['B1', 'TTH', '08:00', '09:30']]);
        const r = run([a, b], { suggested: [], wishes: W({ latestEnd: '12:00' }) });
        assert.deepEqual(r.picks.map(p => p.code), ['AAA 101', 'BBB 101']);
        assert.ok(r.picks.every(p => p.extra));
        assert.match(summarize(r), /2 came from your other eligible subjects/);
    });

    test('suggested subjects come first and are not marked as extras', () => {
        const a = subject('AAA 101', 3, [['A1', 'MW', '08:00', '09:30']]);
        const b = subject('BBB 101', 3, [['B1', 'TTH', '08:00', '09:30']]);
        const r = run([b, a], { suggested: [a], wishes: W({}) });
        assert.deepEqual(r.picks.map(p => [p.code, p.extra]), [['AAA 101', false], ['BBB 101', true]]);
    });

    test('a suggested subject wins a clash against an extra', () => {
        const a = subject('AAA 101', 3, [['A1', 'MW', '08:00', '09:30']]);
        const b = subject('BBB 101', 3, [['B1', 'MW', '09:00', '10:30']]);
        const r = run([b, a], { suggested: [a], wishes: W({}) });
        assert.deepEqual(r.picks.map(p => p.code), ['AAA 101']);
        assert.deepEqual(r.skipped, []);           // an extra that does not fit was never asked for
    });

    test('extras stop at the load size the student saved, and at the units wish', () => {
        const mk = (n, d) => subject(`S${n} 101`, 3, [[`S${n}A`, d, '08:00', '09:30']]);
        const entries = [mk(1, 'M'), mk(2, 'T'), mk(3, 'W'), mk(4, 'TH'), mk(5, 'F')];
        assert.equal(run(entries, { wishes: W({}), fillCap: 9 }).units, 9);
        assert.equal(run(entries, { wishes: W({ maxUnits: 6 }) }).units, 6);
        assert.equal(run(entries, { wishes: W({}), cap: 24 }).units, 15);    // no saved size: the plain limit, all five fit
        assert.equal(run(entries, { wishes: W({}), cap: 12 }).units, 12);
    });

    test('an extra never costs a wish: it only joins in a section that meets them', () => {
        const a = subject('AAA 101', 3, [['A1', 'MW', '08:00', '09:30']]);
        const b = subject('BBB 101', 3, [['B1', 'TTH', '14:00', '15:30']]);         // only afternoon
        const c = subject('CCC 101', 3, [['C1', 'TTH', '14:00', '15:30'], ['C2', 'F', '09:00', '10:30']]);
        const r = run([a, b, c], { suggested: [a], wishes: W({ latestEnd: '12:00' }) });
        assert.deepEqual(r.picks.map(p => p.code), ['AAA 101', 'CCC 101']);
        assert.equal(r.picks.find(p => p.code === 'CCC 101').section, 'C2');
        assert.deepEqual(r.picks.flatMap(p => p.misses), []);
        assert.deepEqual(r.skipped, []);
    });

    test('a suggested subject can still be placed in a compromise section, but an extra cannot', () => {
        const a = subject('AAA 101', 3, [['A1', 'MW', '14:00', '15:30']]);
        const b = subject('BBB 101', 3, [['B1', 'TTH', '14:00', '15:30']]);
        const r = run([a, b], { suggested: [a], wishes: W({ latestEnd: '12:00' }) });
        assert.deepEqual(r.picks.map(p => p.code), ['AAA 101']);
        assert.deepEqual(r.picks[0].misses, ['ends after 12:00 PM']);
    });

    test('an extra never moves a suggested subject out of a section that met the wishes', () => {
        const a = subject('AAA 101', 3, [['A1', 'MW', '08:00', '09:30'], ['A2', 'MW', '14:00', '15:30']], { chosenSection: { section: 'A1' } });
        const b = subject('BBB 101', 3, [['B1', 'MW', '08:00', '09:30']]);
        const r = run([a, b], { suggested: [a], wishes: W({ latestEnd: '12:00' }) });
        // B would need A to move to its afternoon section, which breaks the wish, so B stays out.
        assert.deepEqual(r.picks.map(p => [p.code, p.section]), [['AAA 101', 'A1']]);
    });

    test('a subject the department is not running is never filled in', () => {
        const a = subject('AAA 101', 3, [['A1', 'MW', '08:00', '09:30']], { scheduleState: 'not-run' });
        const r = run([a], { wishes: W({}) });
        assert.equal(r.picks.length, 0);
        assert.deepEqual(r.skipped, []);
    });

    test('a kept subject still comes before suggested ones and extras', () => {
        const a = subject('AAA 101', 3, [['A1', 'MW', '08:00', '09:30']]);
        const b = subject('BBB 101', 3, [['B1', 'MW', '09:00', '10:30']]);
        const c = subject('CCC 101', 3, [['C1', 'MW', '09:00', '10:30']]);
        const r = run([a, b, c], { suggested: [a], wishes: W({ keepSubjects: ['CCC 101'] }) });
        assert.deepEqual(r.picks.map(p => p.code), ['CCC 101']);
        assert.equal(r.picks[0].extra, false);
    });

    test('with wishes and fill, 300 random terms never overlap and never pass a limit', () => {
        let seed = 777;
        const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
        const days = ['MW', 'TTH', 'F', 'MWF', 'S', 'THU'];
        for (let n = 0; n < 300; n++) {
            const entries = Array.from({ length: 3 + Math.floor(rnd() * 8) }, (_, i) =>
                subject(`F${n}-${i}`, 3, Array.from({ length: 1 + Math.floor(rnd() * 4) }, (_, k) => {
                    const h = 7 + Math.floor(rnd() * 10);
                    return [`S${k}`, days[Math.floor(rnd() * days.length)], `${String(h).padStart(2, '0')}:00`, `${String(h + 1).padStart(2, '0')}:30`];
                })));
            const suggested = entries.filter(() => rnd() < 0.3);
            const wishes = W({
                earliestStart: rnd() < 0.5 ? '09:00' : null, latestEnd: rnd() < 0.5 ? '15:00' : null,
                avoidDays: rnd() < 0.5 ? ['FRI'] : [], maxUnits: rnd() < 0.5 ? 9 : null,
            });
            const fillCap = rnd() < 0.5 ? 12 : null;
            const r = run(entries, { suggested, wishes, fillCap });
            assert.ok(r.units <= r.cap, 'over the limit');
            const extraUnits = r.picks.filter(p => p.extra).reduce((t, p) => t + p.units, 0);
            if (fillCap !== null) assert.ok(r.units - extraUnits >= 0 && (extraUnits === 0 || r.units <= Math.max(fillCap, r.units - extraUnits)), 'extras past the load size');
            const chosen = r.picks.map(p => entries.find(e => e.subject.id === p.subjectId).sections.filter(m => m.section === p.section));
            for (let i = 0; i < chosen.length; i++) {
                for (let j = i + 1; j < chosen.length; j++) {
                    assert.ok(!chosen[i].some(x => chosen[j].some(y => conflicts.meetingsClash(x, y))), 'overlap');
                }
            }
            for (const p of r.picks.filter(x => x.extra)) assert.deepEqual(p.misses, [], 'an extra broke a wish');
        }
    });
});

describe('telling the student what was not added', () => {
    test('optional subjects that do not fit are counted and explained in one sentence', () => {
        const a = subject('AAA 101', 3, [['A1', 'MW', '08:00', '09:30']]);
        const b = subject('BBB 101', 3, [['B1', 'TTH', '14:00', '15:30']]);   // only an afternoon section
        const c = subject('CCC 101', 3, [['C1', 'F', '09:00', '10:30']]);     // Friday
        const r = run([a, b, c], { suggested: [a], wishes: W({ latestEnd: '12:00', avoidDays: ['FRI'] }) });
        assert.deepEqual(r.picks.map(p => p.code), ['AAA 101']);
        assert.equal(r.extrasLeft, 2);
        assert.match(summarize(r), /2 other eligible subjects were not added: they would not fit your wishes/);
    });

    test('one left out reads in the singular', () => {
        const a = subject('AAA 101', 3, [['A1', 'MW', '08:00', '09:30']]);
        const b = subject('BBB 101', 3, [['B1', 'TTH', '14:00', '15:30']]);
        const r = run([a, b], { suggested: [a], wishes: W({ latestEnd: '12:00' }) });
        assert.match(summarize(r), /1 other eligible subject was not added: it would not fit/);
    });

    test('a subject the department is not running is not counted as left out', () => {
        const a = subject('AAA 101', 3, [['A1', 'MW', '08:00', '09:30']], { scheduleState: 'not-run' });
        const r = run([a], { wishes: W({}) });
        assert.equal(r.extrasLeft, 0);
        assert.doesNotMatch(summarize(r), /not added/);
    });

    test('with no wishes nothing is counted', () => {
        const a = subject('AAA 101', 3, [['A1', 'MW', '08:00', '09:30']]);
        assert.equal(run([a], {}).extrasLeft, 0);
    });
});

describe('when nothing fits what was asked', () => {
    test('with wishes the message says why, and offers what to do', () => {
        const a = subject('AAA 101', 3, [['A1', 'MW', '08:00', '09:30']]);
        const r = run([a], { wishes: W({ earliestStart: '17:00' }) });
        assert.equal(r.picks.length, 0);
        assert.match(summarize(r), /None of your eligible subjects has a section that fits what you asked for/);
        assert.match(summarize(r), /choose subjects yourself/);
    });

    test('with no subjects at all, or no wishes, the plain sentence stays', () => {
        assert.match(summarize(run([], { wishes: W({ latestEnd: '12:00' }) })), /Nothing could be selected automatically/);
        const a = subject('AAA 101', 3, [['A1', 'MW', '08:00', '09:30']]);
        assert.match(summarize(run([a], {})), /Nothing could be selected automatically/);
    });
});

describe('wishes that limit nothing are not shown', () => {
    const { describeWishes } = require('../shared/js/enrolment/autoplan.js');
    test('a start at midnight and an end at the end of the day are left out of the words', () => {
        assert.deepEqual(describeWishes(W({ earliestStart: '00:00', latestEnd: '12:00' })), ['classes done by 12:00 PM']);
        assert.deepEqual(describeWishes(W({ earliestStart: '09:00', latestEnd: '23:59' })), ['no classes before 9:00 AM']);
        assert.deepEqual(describeWishes(W({ earliestStart: '00:00', latestEnd: '23:59' })), []);
    });
});
