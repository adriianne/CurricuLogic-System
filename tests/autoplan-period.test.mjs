// autoplan-period.test.mjs
// The buttons "Morning / Afternoon / Evening schedules" on Build your plan
// (periodWishes in shared/js/enrolment/autoplan.js).
//
//   node --test tests/autoplan-period.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { buildAutoPlan, summarize, describeWishes, periodWishes } = require('../shared/js/enrolment/autoplan.js');
const conflicts = require('../shared/js/schedule/scheduleconflicts.js');

let nextId = 1;
function subject(code, units, sections) {
    const id = nextId++;
    const rows = sections.map(([name, days, start, end]) => (
        { id: id * 100 + name.charCodeAt(name.length - 1), section: name, meeting_type: 'LEC', schedule_days: days, start_time: start, end_time: end }));
    return { subject: { id, code, title: code + ' title', units }, sections: rows, scheduleState: 'offered' };
}
const plan = (entries, period) => buildAutoPlan({
    entries, suggestedIds: new Set(entries.map(e => e.subject.id)), cap: 24, conflicts, wishes: periodWishes(period),
});

describe('periodWishes', () => {
    test('morning ends by noon, afternoon is noon to 5 pm, evening starts at 5 pm', () => {
        assert.deepEqual(periodWishes('morning'),   { earliestStart: null,    latestEnd: '12:00', avoidDays: [], maxUnits: null, keepSubjects: [], period: 'morning' });
        assert.deepEqual(periodWishes('afternoon'), { earliestStart: '12:00', latestEnd: '17:00', avoidDays: [], maxUnits: null, keepSubjects: [], period: 'afternoon' });
        assert.deepEqual(periodWishes('evening'),   { earliestStart: '17:00', latestEnd: null,    avoidDays: [], maxUnits: null, keepSubjects: [], period: 'evening' });
    });

    test('anything else is no wish at all, never a guess', () => {
        for (const bad of [undefined, null, '', 'night', 'MORNING', 7]) assert.equal(periodWishes(bad), null);
    });

    test('each call gives its own object, so one press cannot change the next', () => {
        const a = periodWishes('morning');
        a.avoidDays.push('MON');
        assert.deepEqual(periodWishes('morning').avoidDays, []);
    });

    test('the wishes read back in plain words', () => {
        assert.deepEqual(describeWishes(periodWishes('morning')), ['classes done by 12:00 PM']);
        assert.deepEqual(describeWishes(periodWishes('afternoon')), ['no classes before 12:00 PM', 'classes done by 5:00 PM']);
        assert.deepEqual(describeWishes(periodWishes('evening')), ['no classes before 5:00 PM']);
    });
});

describe('the plan each button gives', () => {
    // Listed with the afternoon first and the morning last, so no period wins just by being first.
    const make = () => [subject('AAA 101', 3, [['A2', 'MW', '13:00', '14:30'], ['A3', 'MW', '18:00', '19:30'], ['A1', 'MW', '08:00', '09:30']])];

    test('morning picks the morning section', () => {
        assert.equal(plan(make(), 'morning').picks[0].section, 'A1');
    });
    test('afternoon picks the afternoon section', () => {
        assert.equal(plan(make(), 'afternoon').picks[0].section, 'A2');
    });
    test('evening picks the evening section', () => {
        assert.equal(plan(make(), 'evening').picks[0].section, 'A3');
    });

    test('a subject with no section in that part of the day is still offered, and the miss is named', () => {
        const only = [subject('BBB 101', 3, [['B1', 'MW', '13:00', '14:30']])];
        const r = plan(only, 'morning');
        assert.equal(r.picks.length, 1);
        assert.deepEqual(r.picks[0].misses, ['ends after the morning']);
        assert.match(summarize(r), /Closest real sections, not a full match: BBB 101 ends after the morning/);
    });

    test('a button never makes two subjects overlap', () => {
        const a = subject('AAA 101', 3, [['A1', 'MW', '08:00', '09:30']]);
        const b = subject('BBB 101', 3, [['B1', 'MW', '08:30', '10:00'], ['B2', 'TTH', '08:30', '10:00']]);
        const r = plan([a, b], 'morning');
        assert.equal(r.picks.find(p => p.code === 'BBB 101').section, 'B2');
    });

    test('with nothing to choose from it says so, without failing', () => {
        const r = plan([], 'evening');
        assert.equal(r.picks.length, 0);
        assert.match(summarize(r), /Nothing could be selected automatically/);
    });
});

describe('a student with nothing suggested (every subject is optional)', () => {
    // Lecture in the afternoon, lab on Saturday morning: the case seen on a real account.
    const lecLab = () => {
        const id = nextId++;
        return {
            subject: { id, code: 'CCC 101', title: 'CCC 101 title', units: 3 },
            scheduleState: 'offered',
            sections: [
                { id: id * 100 + 1, section: 'C1', meeting_type: 'LEC', schedule_days: 'MW', start_time: '13:00', end_time: '14:30' },
                { id: id * 100 + 2, section: 'C1', meeting_type: 'LAB', schedule_days: 'S', start_time: '08:00', end_time: '11:00' },
            ],
        };
    };
    const run = (period, bestEffort) => {
        const e = [lecLab()];
        return buildAutoPlan({ entries: e, suggestedIds: new Set(), cap: 24, conflicts, wishes: periodWishes(period), bestEffort });
    };

    test('without best effort, an optional subject must fit the wish completely (so nothing here)', () => {
        assert.equal(run('afternoon', false).picks.length, 0);
    });

    test('with best effort, the closest section is chosen and the miss is named', () => {
        const r = run('afternoon', true);
        assert.equal(r.picks.length, 1);
        assert.deepEqual(r.picks[0].misses, ['starts before the afternoon']);
        assert.match(summarize(r), /Closest real sections, not a full match: CCC 101 starts before the afternoon/);
    });

    test('best effort still never puts two subjects on top of each other', () => {
        const a = lecLab();
        const b = { ...lecLab(), sections: lecLab().sections.map(s => ({ ...s, id: s.id + 7 })) };
        const e = [a, { ...b, subject: { ...b.subject, id: a.subject.id + 1000, code: 'DDD 101' } }];
        const r = buildAutoPlan({ entries: e, suggestedIds: new Set(), cap: 24, conflicts, wishes: periodWishes('afternoon'), bestEffort: true });
        assert.equal(r.picks.length, 1);            // both want the same MW 1:00 and Saturday slots
    });

    test('the page asks for best effort only when a time-of-day button was pressed', () => {
        const js = readFileSync(new URL('../features/student/studentdashboard.js', import.meta.url), 'utf8');
        assert.match(js, /bestEffort: !!period/);
    });
});

describe('no clock time is shown for the buttons', () => {
    test('what a miss says never contains a time of day', () => {
        const e = [subject('EEE 101', 3, [['E1', 'MW', '13:00', '14:30']])];
        for (const p of ['morning', 'afternoon', 'evening']) {
            const r = buildAutoPlan({ entries: e, suggestedIds: new Set([e[0].subject.id]), cap: 24, conflicts, wishes: periodWishes(p), bestEffort: true });
            assert.doesNotMatch(summarize(r), /d{1,2}:d{2}|(AM|PM)/);
        }
    });

    test('a class that runs until 8:30 PM is fine for the evening button', () => {
        const e = [subject('FFF 101', 3, [['F1', 'MW', '17:30', '20:30']])];
        const r = buildAutoPlan({ entries: e, suggestedIds: new Set([e[0].subject.id]), cap: 24, conflicts, wishes: periodWishes('evening'), bestEffort: true });
        assert.equal(r.picks[0].section, 'F1');
        assert.deepEqual(r.picks[0].misses, []);
    });

    test('the page prints the period and no hours for a button', () => {
        const js = readFileSync(new URL('../features/student/studentdashboard.js', import.meta.url), 'utf8');
        assert.ok(js.includes('Using the ${escapeHtml(period)} schedules you chose.'));
    });
});

describe('the page', () => {
    const html = readFileSync(new URL('../features/student/studentdashboard.html', import.meta.url), 'utf8');
    const js = readFileSync(new URL('../features/student/studentdashboard.js', import.meta.url), 'utf8');

    test('the Auto-select card is on the page from the start, with the three time-of-day buttons', () => {
        assert.match(html, /<section class="auto-plan" id="auto-plan"[^>]*>/);
        assert.doesNotMatch(html.match(/<section class="auto-plan" id="auto-plan"[^>]*>/)[0], /hidden/);
        for (const p of ['morning', 'afternoon', 'evening']) assert.match(html, new RegExp(`data-auto-period="${p}"`));
    });

    test('the page no longer hides the card when nothing is suggested', () => {
        assert.doesNotMatch(js, /\$\('auto-plan'\)\.hidden/);
    });

    test('a button press runs the same Auto-select, with that period', () => {
        assert.match(js, /runAutoPlan\(window\.CurriculogicAutoPlan\?\.periodWishes\(period\) \?\? null, period\)/);
    });
});
