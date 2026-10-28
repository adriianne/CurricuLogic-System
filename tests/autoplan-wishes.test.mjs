// autoplan-wishes.test.mjs
// "Auto-select my plan" with the wishes a student told Cura (shared/js/enrolment/autoplan.js).
//
//   node --test tests/autoplan-wishes.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildAutoPlan, summarize, describeWishes } = require('../shared/js/enrolment/autoplan.js');
const conflicts = require('../shared/js/schedule/scheduleconflicts.js');

/* A subject with sections. Each section: [name, days, start, end] (one lecture). */
let nextId = 1;
function subject(code, units, sections, extra = {}) {
    const id = nextId++;
    const rows = sections.map(([name, days, start, end]) => (
        { id: id * 100 + name.charCodeAt(name.length - 1), section: name, meeting_type: 'LEC', schedule_days: days, start_time: start, end_time: end }));
    return { subject: { id, code, title: code + ' title', units }, sections: rows, scheduleState: 'offered', ...extra };
}

const wplan = (entries, wishes, extra = {}) => buildAutoPlan({
    entries,
    suggestedIds: extra.suggested ?? new Set(entries.map(e => e.subject.id)),
    cap: extra.cap ?? 24,
    conflicts,
    wishes,
});
const W = (o) => ({ earliestStart: null, latestEnd: null, avoidDays: [], maxUnits: null, keepSubjects: [], ...o });

describe('wishes (what the student told Cura)', () => {
    test('no wishes, or an empty wish, changes nothing', () => {
        const a = subject('AAA 101', 3, [['A1', 'MW', '13:00', '14:30'], ['A2', 'MW', '08:00', '09:30']], { chosenSection: { section: 'A1' } });
        assert.equal(wplan([a], null).picks[0].section, 'A1');
        assert.equal(wplan([a], W({})).picks[0].section, 'A1');
        assert.deepEqual(wplan([a], W({})).picks[0].misses, []);
    });

    test('an earliest start moves a subject to a section that begins late enough', () => {
        const a = subject('AAA 101', 3, [['A1', 'MW', '07:30', '09:00'], ['A2', 'MW', '10:00', '11:30']], { chosenSection: { section: 'A1' } });
        const r = wplan([a], W({ earliestStart: '09:00' }));
        assert.equal(r.picks[0].section, 'A2');
        assert.deepEqual(r.picks[0].misses, []);
    });

    test('a latest end and an avoided day are both respected', () => {
        const a = subject('AAA 101', 3, [['A1', 'MWF', '13:00', '16:00'], ['A2', 'TTH', '13:00', '14:30'], ['A3', 'TTH', '15:00', '17:00']]);
        assert.equal(wplan([a], W({ latestEnd: '15:00', avoidDays: ['FRI'] })).picks[0].section, 'A2');
    });

    test('avoided days use the same day names as the schedule, including Thursday and Saturday', () => {
        const a = subject('AAA 101', 3, [['A1', 'THU', '08:00', '09:30'], ['A2', 'SAT', '08:00', '09:30'], ['A3', 'MW', '08:00', '09:30']]);
        assert.equal(wplan([a], W({ avoidDays: ['THU', 'SAT'] })).picks[0].section, 'A3');
        assert.equal(wplan([a], W({ avoidDays: ['MON'] })).picks[0].section, 'A1'); // THU is not Monday
    });

    test('when no section meets the wish, the closest real one is used and the miss is named', () => {
        const a = subject('AAA 101', 3, [['A1', 'MW', '13:00', '14:30']]);
        const r = wplan([a], W({ earliestStart: '07:00', latestEnd: '12:00' }));
        assert.equal(r.picks.length, 1);
        assert.equal(r.picks[0].section, 'A1');
        assert.deepEqual(r.picks[0].misses, ['ends after 12:00 PM']);
        assert.match(summarize(r), /Closest real sections, not a full match: AAA 101 ends after 12:00 PM/);
    });

    test('a wish never creates an overlap: the clash-free rule still wins', () => {
        const a = subject('AAA 101', 3, [['A1', 'MW', '08:00', '09:30']]);
        const b = subject('BBB 101', 3, [['B1', 'MW', '08:30', '10:00'], ['B2', 'TTH', '14:00', '15:30']]);
        const r = wplan([a, b], W({ latestEnd: '12:00' }));
        const bPick = r.picks.find(p => p.code === 'BBB 101');
        assert.equal(bPick.section, 'B2');                       // B1 would overlap A1
        assert.deepEqual(bPick.misses, ['ends after 12:00 PM']);
    });

    test('where every wish can be met, it is met even if an earlier subject has to move', () => {
        const a = subject('AAA 101', 3, [['A1', 'MW', '08:00', '09:30'], ['A2', 'TTH', '08:00', '09:30']], { chosenSection: { section: 'A1' } });
        const b = subject('BBB 101', 3, [['B1', 'MW', '08:00', '09:30']]);
        const r = wplan([a, b], W({ latestEnd: '12:00' }));
        assert.equal(r.picks.find(p => p.code === 'AAA 101').section, 'A2');
        assert.deepEqual(r.picks.flatMap(p => p.misses), []);
    });

    test('a subject with no section posted cannot break a time wish, and is still reported as unchecked', () => {
        const a = subject('AAA 101', 3, [], { scheduleState: 'pending' });
        const r = wplan([a], W({ earliestStart: '09:00', avoidDays: ['FRI'] }));
        assert.equal(r.picks.length, 1);
        assert.equal(r.picks[0].scheduled, false);
        assert.deepEqual(r.picks[0].misses, []);
        assert.match(summarize(r), /No section is posted/);
        assert.match(summarize(r), /wishes could not be checked/);
        assert.doesNotMatch(summarize(wplan([a], W({ maxUnits: 12 }))), /wishes could not be checked/);
    });

    test('a units wish lowers the limit, never raises it, and the reason names the wish', () => {
        const a = subject('AAA 101', 3, [['A1', 'MW', '08:00', '09:30']]);
        const b = subject('BBB 101', 3, [['B1', 'TTH', '08:00', '09:30']]);
        const c = subject('CCC 101', 3, [['C1', 'F', '08:00', '09:30']]);
        const low = wplan([a, b, c], W({ maxUnits: 6 }));
        assert.equal(low.units, 6);
        assert.equal(low.cap, 6);
        assert.match(low.skipped[0].reason, /6-unit wish/);
        const high = wplan([a, b, c], W({ maxUnits: 99 }), { cap: 6 });
        assert.equal(high.cap, 6);
        assert.match(high.skipped[0].reason, /6-unit limit/);
    });

    test('a kept subject is added even when the engine did not suggest it', () => {
        const a = subject('AAA 101', 3, [['A1', 'MW', '08:00', '09:30']]);
        const b = subject('BBB 101', 3, [['B1', 'TTH', '08:00', '09:30']]);
        const r = wplan([a, b], W({ keepSubjects: ['bbb-101'] }), { suggested: new Set([a.subject.id]) });
        assert.deepEqual(r.picks.map(p => p.code).sort(), ['AAA 101', 'BBB 101']);
    });

    test('a kept subject wins a clash against a subject the engine ranked higher', () => {
        const a = subject('AAA 101', 3, [['A1', 'MW', '08:00', '09:30']]);
        const b = subject('BBB 101', 3, [['B1', 'MW', '09:00', '10:30']]);
        const r = wplan([a, b], W({ keepSubjects: ['BBB 101'] }));
        assert.deepEqual(r.picks.map(p => p.code), ['BBB 101']);
        assert.equal(r.skipped[0].code, 'AAA 101');
        assert.equal(r.skipped[0].kept, false);
    });

    test('a kept subject that cannot fit is reported as kept, never silently dropped', () => {
        const a = subject('AAA 101', 3, [['A1', 'MW', '08:00', '09:30']]);
        const b = subject('BBB 101', 3, [['B1', 'MW', '09:00', '10:30']]);
        const r = wplan([a, b], W({ keepSubjects: ['AAA 101', 'BBB 101'] }));
        assert.deepEqual(r.picks.map(p => p.code), ['AAA 101']);
        assert.equal(r.skipped.length, 1);
        assert.equal(r.skipped[0].kept, true);
        assert.match(r.skipped[0].reason, /^You asked to keep it, but: /);
    });

    test('a kept subject that is not among the candidates is reported', () => {
        const a = subject('AAA 101', 3, [['A1', 'MW', '08:00', '09:30']]);
        const r = wplan([a], W({ keepSubjects: ['ZZZ 999'] }));
        assert.equal(r.picks.length, 1);
        assert.equal(r.skipped[0].code, 'ZZZ 999');
        assert.equal(r.skipped[0].kept, true);
    });

    test('a subject the department is not running stays out even if the student wants it kept', () => {
        const a = subject('AAA 101', 3, [['A1', 'MW', '08:00', '09:30']], { scheduleState: 'not-run' });
        const r = wplan([a], W({ keepSubjects: ['AAA 101'] }));
        assert.equal(r.picks.length, 0);
        assert.match(r.skipped[0].reason, /not running it this term/);
    });

    test('with wishes, 300 random terms never overlap and never pass the limit', () => {
        let seed = 12345;
        const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
        const days = ['MW', 'TTH', 'F', 'MWF', 'S', 'THU'];
        for (let n = 0; n < 300; n++) {
            const entries = Array.from({ length: 2 + Math.floor(rnd() * 6) }, (_, i) =>
                subject(`R${n}-${i}`, 3, Array.from({ length: 1 + Math.floor(rnd() * 4) }, (_, k) => {
                    const h = 7 + Math.floor(rnd() * 10);
                    return [`S${k}`, days[Math.floor(rnd() * days.length)], `${String(h).padStart(2, '0')}:00`, `${String(h + 1).padStart(2, '0')}:30`];
                })));
            const wishes = W({
                earliestStart: rnd() < 0.5 ? '09:00' : null, latestEnd: rnd() < 0.5 ? '15:00' : null,
                avoidDays: rnd() < 0.5 ? ['FRI'] : [], maxUnits: rnd() < 0.5 ? 9 : null,
                keepSubjects: rnd() < 0.3 ? [entries[0].subject.code] : [],
            });
            const r = wplan(entries, wishes);
            assert.ok(r.units <= r.cap, `units ${r.units} > ${r.cap}`);
            const chosen = r.picks.map(p => entries.find(e => e.subject.id === p.subjectId).sections.filter(m => m.section === p.section));
            for (let i = 0; i < chosen.length; i++) {
                for (let j = i + 1; j < chosen.length; j++) {
                    assert.ok(!chosen[i].some(x => chosen[j].some(y => conflicts.meetingsClash(x, y))), 'overlap');
                }
            }
        }
    });
});

describe('describing wishes in plain words', () => {
    test('nothing asked gives no phrases', () => {
        assert.deepEqual(describeWishes(null), []);
        assert.deepEqual(describeWishes(W({})), []);
    });

    test('each wish becomes a short phrase', () => {
        assert.deepEqual(describeWishes(W({ earliestStart: '09:00', latestEnd: '15:30', avoidDays: ['FRI', 'SAT'], maxUnits: 15, keepSubjects: ['MATH 101'] })), [
            'no classes before 9:00 AM', 'classes done by 3:30 PM', 'no classes on Friday, Saturday', 'up to 15 units', 'keep MATH 101']);
    });

    test('noon and midnight read correctly', () => {
        assert.deepEqual(describeWishes(W({ earliestStart: '12:00', latestEnd: '00:30' })), ['no classes before 12:00 PM', 'classes done by 12:30 AM']);
    });
});
