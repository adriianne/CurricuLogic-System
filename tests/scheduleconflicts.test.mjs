// scheduleconflicts.test.mjs
// Tests for the deterministic schedule-overlap logic Cura and the
// "Build your plan" picker both rely on.
//
//   node --test tests/

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SC = require('../shared/js/scheduleconflicts.js');

const { parseDays, minutesOf, meetingsClash, groupSections,
        timeOfDay, sectionTimeOfDay, formatClock, availableStartTimes,
        findClashes } = SC;

const meeting = (opts = {}) => ({
    section: opts.section ?? 'BSIT-1A',
    meeting_type: opts.type ?? 'LEC',
    schedule_days: opts.days ?? 'MW',
    start_time: opts.start ?? '10:00',
    end_time: opts.end ?? '11:00',
});

describe('parseDays', () => {
    test('splits a compact day string into tokens', () => {
        assert.deepEqual(parseDays('MW'), ['M', 'W']);
    });

    test('reads TH before T so Thursday is not split into T + H', () => {
        assert.deepEqual(parseDays('TTH'), ['T', 'TH']);
    });

    test('handles Saturday and Sunday without colliding with S', () => {
        assert.deepEqual(parseDays('SU'), ['SU']);
        assert.deepEqual(parseDays('S'), ['S']);
    });

    test('empty or missing input yields no days', () => {
        assert.deepEqual(parseDays(null), []);
        assert.deepEqual(parseDays(''), []);
    });

    test('long day names already in the data mean the same day', () => {
        // "SAT" used to read as Saturday plus Tuesday.
        assert.deepEqual(parseDays('SAT'), ['S']);
        assert.deepEqual(parseDays('THU'), ['TH']);
        assert.deepEqual(parseDays('SUN'), ['SU']);
        assert.deepEqual(parseDays('Mon/Wed/Fri'), ['M', 'W', 'F']);
        assert.deepEqual(parseDays('Tue Thurs'), ['T', 'TH']);
        assert.deepEqual(parseDays('TTHS'), ['T', 'TH', 'S']);
    });
});

describe('a Saturday class and a Tuesday class', () => {
    test('do not clash just because of how Saturday is spelled', () => {
        const sat = { schedule_days: 'SAT', start_time: '08:30', end_time: '10:30' };
        const tue = { schedule_days: 'TTH', start_time: '08:30', end_time: '10:30' };
        assert.equal(meetingsClash(sat, tue), false);
        assert.equal(meetingsClash(sat, { ...sat, schedule_days: 'S' }), true);
    });
});

describe('minutesOf', () => {
    test('converts HH:MM to minutes since midnight', () => {
        assert.equal(minutesOf('10:30'), 630);
        assert.equal(minutesOf('00:00'), 0);
    });

    // null/'' coerce to the empty string, and Number('') is 0 -- so a
    // missing time reads as midnight, not "no time". Only a genuinely
    // unparseable string (never produced by the schema) yields null.
    test('null, undefined, or empty input coerce to midnight (0)', () => {
        assert.equal(minutesOf(null), 0);
        assert.equal(minutesOf(undefined), 0);
        assert.equal(minutesOf(''), 0);
    });

    test('an unparseable time yields null', () => {
        assert.equal(minutesOf('not-a-time'), null);
    });
});

describe('meetingsClash', () => {
    test('same day, overlapping time -> clash', () => {
        const a = meeting({ days: 'MW', start: '10:00', end: '11:30' });
        const b = meeting({ days: 'MW', start: '11:00', end: '12:00' });
        assert.equal(meetingsClash(a, b), true);
    });

    test('same day, back-to-back with no overlap -> no clash', () => {
        const a = meeting({ days: 'MW', start: '10:00', end: '11:00' });
        const b = meeting({ days: 'MW', start: '11:00', end: '12:00' });
        assert.equal(meetingsClash(a, b), false);
    });

    test('overlapping time but no shared day -> no clash', () => {
        const a = meeting({ days: 'MW', start: '10:00', end: '11:00' });
        const b = meeting({ days: 'TTH', start: '10:00', end: '11:00' });
        assert.equal(meetingsClash(a, b), false);
    });

    test('TTH and MWF share no day even though both contain T', () => {
        const a = meeting({ days: 'TTH', start: '9:00', end: '10:00' });
        const b = meeting({ days: 'MWF', start: '9:00', end: '10:00' });
        assert.equal(meetingsClash(a, b), false);
    });

    test('one meeting sharing a day with an overlapping window clashes', () => {
        const a = meeting({ days: 'MWF', start: '9:00', end: '10:00' });
        const b = meeting({ days: 'TF', start: '9:30', end: '10:30' });
        assert.equal(meetingsClash(a, b), true); // both meet Friday
    });

    test('an unparseable time on either side -> no clash (cannot compare)', () => {
        const a = { section: 'A', meeting_type: 'LEC', schedule_days: 'MW', start_time: 'bad', end_time: 'bad' };
        const b = meeting({ days: 'MW', start: '10:00', end: '11:00' });
        assert.equal(meetingsClash(a, b), false);
    });
});

describe('groupSections', () => {
    test('groups flat offering rows by section label', () => {
        const rows = [
            meeting({ section: 'A', type: 'LAB', start: '13:00', end: '15:00' }),
            meeting({ section: 'A', type: 'LEC', start: '10:00', end: '11:00' }),
            meeting({ section: 'B', type: 'LEC', start: '8:00', end: '9:00' }),
        ];
        const groups = groupSections(rows);
        assert.equal(groups.length, 2);

        const a = groups.find(g => g.section === 'A');
        assert.equal(a.meetings.length, 2);
        // LEC sorts before LAB regardless of input order.
        assert.equal(a.meetings[0].meeting_type, 'LEC');
        assert.equal(a.meetings[1].meeting_type, 'LAB');
    });

    test('no offerings yields no groups', () => {
        assert.deepEqual(groupSections([]), []);
        assert.deepEqual(groupSections(undefined), []);
    });
});

describe('timeOfDay / sectionTimeOfDay', () => {
    test('buckets by minutes since midnight', () => {
        assert.equal(timeOfDay(9 * 60), 'morning');
        assert.equal(timeOfDay(13 * 60), 'afternoon');
        assert.equal(timeOfDay(18 * 60), 'evening');
        assert.equal(timeOfDay(null), null);
    });

    test('boundary minutes land in the later bucket', () => {
        assert.equal(timeOfDay(12 * 60), 'afternoon'); // noon
        assert.equal(timeOfDay(17 * 60), 'evening');    // 5pm
    });

    test('a single-meeting section reports that meeting\'s bucket', () => {
        const meetings = [meeting({ start: '9:00', end: '10:00' })];
        assert.equal(sectionTimeOfDay(meetings), 'morning');
    });

    test('a section spanning two buckets is reported as mixed', () => {
        const meetings = [
            meeting({ type: 'LEC', start: '9:00', end: '10:00' }),
            meeting({ type: 'LAB', start: '14:00', end: '16:00' }),
        ];
        assert.equal(sectionTimeOfDay(meetings), 'mixed');
    });

    test('no meetings reports no bucket', () => {
        assert.equal(sectionTimeOfDay([]), null);
    });
});

describe('formatClock', () => {
    test('formats HH:MM as a 12-hour clock', () => {
        assert.equal(formatClock('07:30'), '7:30 AM');
        assert.equal(formatClock('13:00'), '1:00 PM');
        assert.equal(formatClock('00:00'), '12:00 AM');
        assert.equal(formatClock('12:00'), '12:00 PM');
    });

    test('missing or unparseable input yields empty string', () => {
        assert.equal(formatClock(null), '');
        assert.equal(formatClock(''), '');
        assert.equal(formatClock('not-a-time'), '');
    });
});

describe('availableStartTimes', () => {
    test('collects every distinct start time across subjects, sorted earliest-first', () => {
        const subjects = [
            { sections: [meeting({ section: 'A', start: '13:00', end: '14:00' })] },
            { sections: [
                meeting({ section: 'B', type: 'LEC', start: '07:30', end: '09:00' }),
                meeting({ section: 'B', type: 'LAB', start: '09:00', end: '10:00' }),
            ] },
        ];
        const times = availableStartTimes(subjects);
        assert.deepEqual(times.map(t => t.time), ['07:30', '09:00', '13:00']);
        assert.deepEqual(times.map(t => t.label), ['7:30 AM', '9:00 AM', '1:00 PM']);
    });

    test('a start time shared by two subjects is listed once', () => {
        const subjects = [
            { sections: [meeting({ section: 'A', start: '10:00' })] },
            { sections: [meeting({ section: 'B', start: '10:00' })] },
        ];
        assert.equal(availableStartTimes(subjects).length, 1);
    });

    test('no subjects yields no times', () => {
        assert.deepEqual(availableStartTimes([]), []);
    });
});

describe('findClashes', () => {
    test('reports every overlapping pair by label, not the non-overlapping ones', () => {
        const labeled = [
            { label: 'SUBJ-A (1A)', meetings: [meeting({ days: 'MW', start: '10:00', end: '11:00' })] },
            { label: 'SUBJ-B (1A)', meetings: [meeting({ days: 'MW', start: '10:30', end: '11:30' })] },
            { label: 'SUBJ-C (1A)', meetings: [meeting({ days: 'TTH', start: '10:00', end: '11:00' })] },
        ];
        const clashes = findClashes(labeled);
        assert.equal(clashes.length, 1);
        assert.equal(clashes[0].a, 'SUBJ-A (1A)');
        assert.equal(clashes[0].b, 'SUBJ-B (1A)');
    });

    test('no sections yields no clashes', () => {
        assert.deepEqual(findClashes([]), []);
    });
});
