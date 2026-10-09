// autoplan.test.mjs
// "Auto-select my plan": a plan the student can submit as it stands.
//
//   node --test tests/autoplan.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildAutoPlan, summarize } = require('../shared/js/autoplan.js');
const conflicts = require('../shared/js/scheduleconflicts.js');

/* A subject with sections. Each section: [name, days, start, end] (one lecture),
   or [name, days, start, end, labDays, labStart, labEnd]. */
let nextId = 1;
function subject(code, units, sections, extra = {}) {
    const id = nextId++;
    const rows = sections.flatMap(([name, days, start, end, labDays, labStart, labEnd]) => [
        { id: id * 100 + rows0(name), section: name, meeting_type: 'LEC', schedule_days: days, start_time: start, end_time: end },
        ...(labDays ? [{ id: id * 100 + rows0(name), section: name, meeting_type: 'LAB', schedule_days: labDays, start_time: labStart, end_time: labEnd }] : []),
    ]);
    return { subject: { id, code, title: code + ' title', units }, sections: rows, scheduleState: 'offered', ...extra };
}
const rows0 = (name) => name.charCodeAt(name.length - 1);

const plan = (entries, { cap = 24, suggested } = {}) => buildAutoPlan({
    entries,
    suggestedIds: suggested ?? new Set(entries.map(e => e.subject.id)),
    cap,
    conflicts,
});

describe('choosing sections', () => {
    test('picks every suggested subject when nothing overlaps', () => {
        const a = subject('AAA 101', 3, [['A1', 'MW', '08:00', '09:30']]);
        const b = subject('BBB 101', 3, [['B1', 'MW', '10:00', '11:30']]);
        const r = plan([a, b]);
        assert.deepEqual(r.picks.map(p => p.code), ['AAA 101', 'BBB 101']);
        assert.equal(r.units, 6);
        assert.deepEqual(r.skipped, []);
    });

    test('moves a subject to another section when its first one overlaps', () => {
        const a = subject('AAA 101', 3, [['A1', 'MW', '08:00', '09:30']]);
        const b = subject('BBB 101', 3, [['B1', 'MW', '08:30', '10:00'], ['B2', 'TTH', '08:30', '10:00']]);
        const r = plan([a, b]);
        assert.equal(r.picks.length, 2);
        assert.equal(r.picks.find(p => p.code === 'BBB 101').section, 'B2');
    });

    test("tries the engine's own section first", () => {
        const a = subject('AAA 101', 3, [['A1', 'MW', '08:00', '09:30'], ['A2', 'TTH', '08:00', '09:30']],
            { chosenSection: { section: 'A2' } });
        assert.equal(plan([a]).picks[0].section, 'A2');
    });

    test('a lab that overlaps counts: the whole section is checked', () => {
        const a = subject('AAA 101', 3, [['A1', 'MW', '08:00', '09:30']]);
        // B1's lecture is free, but its lab sits on top of A1
        const b = subject('BBB 101', 3, [['B1', 'TTH', '08:00', '09:30', 'MW', '09:00', '11:00'], ['B2', 'F', '13:00', '16:00']]);
        const r = plan([a, b]);
        assert.equal(r.picks.find(p => p.code === 'BBB 101').section, 'B2');
    });

    test('leaves a subject out, naming what it overlaps, when no section fits', () => {
        const a = subject('AAA 101', 3, [['A1', 'MW', '08:00', '09:30']]);
        const b = subject('BBB 101', 3, [['B1', 'MW', '09:00', '10:30']]);
        const r = plan([a, b]);
        assert.deepEqual(r.picks.map(p => p.code), ['AAA 101']);
        assert.match(r.skipped[0].reason, /only section overlaps with AAA 101/);
    });

    test('meetings that merely touch do not overlap', () => {
        const a = subject('AAA 101', 3, [['A1', 'MW', '08:00', '09:30']]);
        const b = subject('BBB 101', 3, [['B1', 'MW', '09:30', '11:00']]);
        assert.equal(plan([a, b]).picks.length, 2);
    });
});

describe('many sections', () => {
    test('an earlier subject moves to another section to make room for a later one', () => {
        // A's first choice (the engine's) would block B's only section; A has another.
        const a = subject('AAA 101', 3, [['A1', 'MW', '08:00', '09:30'], ['A2', 'TTH', '08:00', '09:30']],
            { chosenSection: { section: 'A1' } });
        const b = subject('BBB 101', 3, [['B1', 'MW', '08:30', '10:00']]);
        const r = plan([a, b]);
        assert.deepEqual(r.picks.map(p => p.code), ['AAA 101', 'BBB 101']);
        assert.equal(r.picks.find(p => p.code === 'AAA 101').section, 'A2');
        assert.deepEqual(r.skipped, []);
    });

    test('keeps the engine\'s sections wherever nothing has to move', () => {
        const a = subject('AAA 101', 3, [['A1', 'MW', '08:00', '09:30'], ['A2', 'TTH', '08:00', '09:30']],
            { chosenSection: { section: 'A2' } });
        const b = subject('BBB 101', 3, [['B1', 'MW', '10:00', '11:30'], ['B2', 'TTH', '10:00', '11:30']],
            { chosenSection: { section: 'B2' } });
        const r = plan([a, b]);
        assert.deepEqual(r.picks.map(p => p.section), ['A2', 'B2']);
    });

    test('a chain: two earlier subjects both have to move', () => {
        const a = subject('AAA 101', 3, [['A1', 'MW', '08:00', '09:30'], ['A2', 'F', '08:00', '11:00']]);
        const b = subject('BBB 101', 3, [['B1', 'MW', '10:00', '11:30'], ['B2', 'TTH', '10:00', '11:30']]);
        // C's only section sits across both A1 and B1 (MW 08:30-11:00)
        const c = subject('CCC 101', 3, [['C1', 'MW', '08:30', '11:00']]);
        const r = plan([a, b, c]);
        assert.deepEqual(r.picks.map(p => p.code), ['AAA 101', 'BBB 101', 'CCC 101']);
        assert.equal(r.picks.find(p => p.code === 'AAA 101').section, 'A2');
        assert.equal(r.picks.find(p => p.code === 'BBB 101').section, 'B2');
    });

    test('when it truly cannot fit, the higher-priority subject keeps its place', () => {
        const a = subject('AAA 101', 3, [['A1', 'MW', '08:00', '09:30']]);   // first = highest priority
        const b = subject('BBB 101', 3, [['B1', 'MW', '09:00', '10:30'], ['B2', 'MW', '08:30', '10:00']]);
        const r = plan([a, b]);
        assert.deepEqual(r.picks.map(p => p.code), ['AAA 101']);
        assert.match(r.skipped[0].reason, /Every section overlaps with AAA 101/);
    });

    test('twelve subjects with eight sections each: fast, and no overlap', () => {
        const days = ['MW', 'TTH', 'F', 'S'];
        const hours = ['07:30', '09:00', '10:30', '13:00', '14:30', '16:00'];
        const entries = Array.from({ length: 12 }, (_, i) => subject(`MANY ${100 + i}`, 3,
            Array.from({ length: 8 }, (_, s) => [`M${i}-${s}`, days[(i + s) % 4], hours[(i * 2 + s) % 6],
                hours[(i * 2 + s) % 6].replace(/^(\d\d):(\d\d)$/, (m, h, mm) => `${String(Number(h) + 1).padStart(2, '0')}:${mm}`)])));
        const started = Date.now();
        const r = plan(entries, { cap: 36 });
        assert.ok(Date.now() - started < 2000, 'took too long');
        assert.ok(r.picks.length >= 6, `only ${r.picks.length} picked`);
        const groups = r.picks.map(p => conflicts.groupSections(entries.find(e => e.subject.id === p.subjectId).sections)
            .find(g => g.section === p.section));
        for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) {
            assert.equal(groups[i].meetings.some(a => groups[j].meetings.some(b => conflicts.meetingsClash(a, b))), false);
        }
    });

    test('a hopeless timetable gives up in time, and never returns an overlap', () => {
        // Eight subjects with six free sections each fit together; the ninth overlaps
        // every one of them everywhere, so the search has a huge space to rule out.
        const free = Array.from({ length: 8 }, (_, i) => subject(`FREE ${i}`, 1,
            Array.from({ length: 6 }, (_, s) => [`F${i}-${s}`, ['M', 'T', 'W', 'TH', 'F', 'S'][s], `${String(7 + i).padStart(2, '0')}:00`, `${String(7 + i).padStart(2, '0')}:50`])));
        const wall = subject('WALL 101', 1, [['W1', 'MTWTHFS', '07:00', '16:00']]);
        const started = Date.now();
        const r = plan([...free, wall], { cap: 24 });
        assert.ok(Date.now() - started < 3000, 'took too long');
        assert.equal(r.picks.some(p => p.code === 'WALL 101'), false);
        assert.ok(r.skipped.some(s => s.code === 'WALL 101'));
    });
});

describe('subjects that cannot be taken this term', () => {
    test('a subject the department is not running is left out', () => {
        const a = subject('AAA 101', 3, [['A1', 'MW', '08:00', '09:30']], { scheduleState: 'not-run' });
        const r = plan([a]);
        assert.equal(r.picks.length, 0);
        assert.match(r.skipped[0].reason, /not running it this term/);
    });

    test('a subject with no section posted yet is kept, marked as not time-checked', () => {
        const a = subject('AAA 101', 3, [], { scheduleState: 'pending' });
        const r = plan([a]);
        assert.equal(r.picks.length, 1);
        assert.equal(r.picks[0].scheduled, false);
        assert.equal(r.picks[0].section, null);
        assert.equal(r.picks[0].offeringId, null);
        assert.deepEqual(r.skipped, []);
    });

    test('an unscheduled subject still counts toward the unit limit', () => {
        const a = subject('AAA 101', 3, [['A1', 'MW', '08:00', '09:30']]);
        const b = subject('BBB 101', 3, [], { scheduleState: 'pending' });
        const r = plan([a, b], { cap: 3 });
        assert.deepEqual(r.picks.map(p => p.code), ['AAA 101']);
        assert.match(r.skipped[0].reason, /3-unit limit/);
    });

    test('an unscheduled subject does not block a scheduled one', () => {
        const a = subject('AAA 101', 3, [], { scheduleState: 'pending' });
        const b = subject('BBB 101', 3, [['B1', 'MW', '08:00', '09:30']]);
        assert.equal(plan([a, b]).picks.length, 2);
    });

    test('a subject the engine did not suggest is never picked', () => {
        const a = subject('AAA 101', 3, [['A1', 'MW', '08:00', '09:30']]);
        const b = subject('BBB 101', 3, [['B1', 'TTH', '08:00', '09:30']]);
        const r = plan([a, b], { suggested: new Set([a.subject.id]) });
        assert.deepEqual(r.picks.map(p => p.code), ['AAA 101']);
        assert.deepEqual(r.skipped, []);
    });
});

describe('subject conflicts and the unit limit', () => {
    test('the same subject is never picked twice', () => {
        const a = subject('AAA 101', 3, [['A1', 'MW', '08:00', '09:30'], ['A2', 'TTH', '08:00', '09:30']]);
        const r = plan([a, a]);
        assert.equal(r.picks.length, 1);
        assert.match(r.skipped[0].reason, /Already in the plan/);
    });

    test('stops at the unit limit and says so', () => {
        const a = subject('AAA 101', 3, [['A1', 'MW', '08:00', '09:30']]);
        const b = subject('BBB 101', 3, [['B1', 'TTH', '08:00', '09:30']]);
        const c = subject('CCC 101', 3, [['C1', 'F', '08:00', '11:00']]);
        const r = plan([a, b, c], { cap: 6 });
        assert.equal(r.units, 6);
        assert.deepEqual(r.picks.map(p => p.code), ['AAA 101', 'BBB 101']);
        assert.match(r.skipped[0].reason, /6-unit limit/);
    });

    test('a smaller subject can still fit after a bigger one was left out', () => {
        const big = subject('BIG 101', 6, [['X1', 'MW', '08:00', '09:30']]);
        const small = subject('SML 101', 2, [['S1', 'TTH', '08:00', '09:30']]);
        const r = plan([big, small], { cap: 4 });
        assert.deepEqual(r.picks.map(p => p.code), ['SML 101']);
    });

    test('a cap of 0, or none, selects nothing', () => {
        const a = subject('AAA 101', 3, [['A1', 'MW', '08:00', '09:30']]);
        assert.equal(plan([a], { cap: 0 }).picks.length, 0);
        assert.equal(plan([a], { cap: null }).picks.length, 0);
        assert.equal(buildAutoPlan({ entries: [a], suggestedIds: new Set([a.subject.id]), cap: undefined, conflicts }).picks.length, 0);
    });
});

describe('what the page gets back', () => {
    test('each pick carries the section and the offering to send', () => {
        const a = subject('AAA 101', 3, [['A1', 'MW', '08:00', '09:30']]);
        const [p] = plan([a]).picks;
        assert.equal(p.subjectId, a.subject.id);
        assert.equal(p.section, 'A1');
        assert.ok(Number.isInteger(p.offeringId));
        assert.equal(p.group, undefined);          // the internal helper is not leaked
    });

    test('nothing in, nothing out', () => {
        assert.deepEqual(plan([]).picks, []);
        assert.deepEqual(buildAutoPlan({ entries: null, suggestedIds: new Set(), cap: 24, conflicts }).picks, []);
    });
});

describe('summarize', () => {
    test('says how many subjects and units, and what was checked', () => {
        const a = subject('AAA 101', 3, [['A1', 'MW', '08:00', '09:30']]);
        const b = subject('BBB 101', 3, [['B1', 'TTH', '08:00', '09:30']]);
        const text = summarize(plan([a, b]));
        assert.match(text, /Selected 2 subjects, 6 of 24 units/);
        assert.match(text, /No two overlap/);
        assert.match(text, /Submit for review/);
    });

    test('says so when some subjects were added without a time check', () => {
        const a = subject('AAA 101', 3, [['A1', 'MW', '08:00', '09:30']]);
        const b = subject('BBB 101', 3, [], { scheduleState: 'pending' });
        const text = summarize(plan([a, b]));
        assert.match(text, /1 has no section posted yet, so it was added without a time check/);
        assert.match(text, /The others do not overlap/);
    });

    test('says so when nothing has a schedule yet', () => {
        const a = subject('AAA 101', 3, [], { scheduleState: 'pending' });
        const b = subject('BBB 101', 3, [], { scheduleState: 'pending' });
        assert.match(summarize(plan([a, b])), /No section is posted for them yet, so there is nothing to check/);
        assert.match(summarize(plan([a])), /No section is posted for it yet/);
    });

    test('singular for one subject', () => {
        const a = subject('AAA 101', 3, [['A1', 'MW', '08:00', '09:30']]);
        assert.match(summarize(plan([a])), /Selected 1 subject,/);
    });

    test('says plainly when nothing could be selected', () => {
        assert.match(summarize(plan([])), /Nothing could be selected automatically/);
    });
});

describe('whatever it is given, a plan never has an overlap', () => {
    // A small deterministic generator, so a failure can be reproduced.
    let seed = 20261007;
    const rand = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    const pick = (list) => list[Math.floor(rand() * list.length)];
    const DAYS = ['MW', 'TTH', 'F', 'S', 'MWF', 'TTHS'];
    const STARTS = ['07:30', '08:00', '09:00', '10:30', '12:00', '13:30', '15:00', '17:30'];
    const minutes = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
    const addMinutes = (t, m) => { const x = minutes(t) + m; return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`; };

    test('300 random terms: no two picked sections overlap, units stay within the cap', () => {
        for (let run = 0; run < 300; run++) {
            const entries = Array.from({ length: 4 + Math.floor(rand() * 8) }, (_, i) => {
                const sections = Array.from({ length: 1 + Math.floor(rand() * 3) }, (_, s) => {
                    const start = pick(STARTS);
                    const lab = rand() < 0.4 ? [pick(DAYS), pick(STARTS)] : [];
                    return [`S${i}${s}`, pick(DAYS), start, addMinutes(start, pick([60, 90, 120, 180])),
                            ...(lab.length ? [lab[0], lab[1], addMinutes(lab[1], 180)] : [])];
                });
                return subject(`R${run}-${i}`, pick([1, 2, 3, 3, 3, 6]), sections);
            });
            const cap = pick([6, 12, 18, 24]);
            const r = plan(entries, { cap });

            assert.ok(r.units <= cap, `run ${run}: ${r.units} units over ${cap}`);
            const groups = r.picks.map(p => {
                const entry = entries.find(e => e.subject.id === p.subjectId);
                return conflicts.groupSections(entry.sections).find(g => g.section === p.section);
            });
            for (let i = 0; i < groups.length; i++) {
                for (let j = i + 1; j < groups.length; j++) {
                    const overlap = groups[i].meetings.some(a => groups[j].meetings.some(b => conflicts.meetingsClash(a, b)));
                    assert.equal(overlap, false, `run ${run}: ${r.picks[i].code} overlaps ${r.picks[j].code}`);
                }
            }
            assert.equal(new Set(r.picks.map(p => p.subjectId)).size, r.picks.length);
        }
    });
});
