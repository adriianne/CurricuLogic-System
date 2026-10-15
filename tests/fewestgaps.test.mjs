// fewestgaps.test.mjs
// "Free time between classes: fewest gaps" (shared/engine/preferences.js).
//
//   node --test tests/fewestgaps.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const E = require('../shared/engine/engine.js');
const P = require('../shared/engine/preferences.js');
const SC = require('../shared/js/scheduleconflicts.js');

let nextId = 5000;
const subj = (code) => ({ id: nextId++, code, title: code, units: 3, year_level: 1, term: 1, is_elective: false });
const meet = (subject, section, days, start, end, type = 'LEC') => ({
    id: nextId++, subject_id: subject.id, section, meeting_type: type,
    schedule_days: days, start_time: start, end_time: end,
});
const at = (h, m = 0) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;

function plan(subjects, offerings, prefs) {
    const result = E.assess({ id: 's', year_level: 1 }, [], { subjects, rules: [], offerings }, { term: 1 });
    return P.apply(result, prefs);
}
const sectionOf = (p, code) => p.recommended.find(e => e.subject.code === code)?.chosenSection?.section ?? null;

/* A is only offered Mon/Wed 8:00-9:30. B has a section far later in the day (B1) and one straight after A (B2). */
function twoSubjects() {
    const A = subj('A'), B = subj('B');
    return {
        subjects: [A, B],
        offerings: [
            meet(A, 'A1', 'MW', at(8), at(9, 30)),
            meet(B, 'B1', 'MW', at(12), at(13, 30)),
            meet(B, 'B2', 'MW', at(9, 30), at(11)),
        ],
    };
}

describe('measuring free time', () => {
    const m = (days, s, e) => ({ schedule_days: days, start_time: s, end_time: e });

    test('classes back to back leave none', () => {
        assert.equal(P.gapMinutes([[m('M', at(8), at(9, 30))], [m('M', at(9, 30), at(11))]]), 0);
    });

    test('a wait of 30 minutes counts, one of 20 does not', () => {
        assert.equal(P.gapMinutes([[m('M', at(8), at(9))], [m('M', at(9, 30), at(10, 30))]]), 30);
        assert.equal(P.gapMinutes([[m('M', at(8), at(9))], [m('M', at(9, 20), at(10, 30))]]), 0);
    });

    test('each day is counted on its own, and MW means two days', () => {
        const a = m('MW', at(8), at(9, 30));
        const b = m('MW', at(12), at(13, 30));
        assert.equal(P.gapMinutes([[a], [b]]), 150 * 2);
        // different days never make a gap
        assert.equal(P.gapMinutes([[m('M', at(8), at(9))], [m('T', at(15), at(16))]]), 0);
    });

    test('order does not matter and a lab on the same day is included', () => {
        const lec = m('M', at(8), at(9, 30));
        const lab = m('M', at(13), at(16));
        assert.equal(P.gapMinutes([[lab], [lec]]), 210);
        assert.equal(P.gapMinutes([[lec, lab]]), 210);
    });

    test('meetings with no day or time are ignored', () => {
        assert.equal(P.gapMinutes([[m(null, at(8), at(9))], [m('M', null, null)], [m('M', at(8), at(9))]]), 0);
        assert.equal(P.gapMinutes([]), 0);
    });

    test('words for the amount', () => {
        assert.equal(P.gapWords(0), 'none');
        assert.equal(P.gapWords(45), '45 min');
        assert.equal(P.gapWords(120), '2 h');
        assert.equal(P.gapWords(210), '3 h 30 min');
    });
});

describe('the preference itself', () => {
    test('is on only when exactly true', () => {
        assert.equal(P.clean({ compact: true }).compact, true);
        for (const v of [false, 'yes', 1, null, undefined, 'true']) assert.equal(P.clean({ compact: v }).compact, false);
        assert.equal(P.clean().compact, false);
    });

    test('off: the plan is exactly what it was, and says nothing about free time', () => {
        const { subjects, offerings } = twoSubjects();
        const off = plan(subjects, offerings, {});
        const explicit = plan(subjects, offerings, { compact: false });
        assert.equal(sectionOf(off, 'B'), 'B1');
        assert.deepEqual(explicit.recommended.map(e => e.chosenSection?.section), off.recommended.map(e => e.chosenSection?.section));
        assert.equal(off.preference.compact, false);
        assert.equal(off.preference.freeMinutes, null);
        assert.ok(!off.preference.notes.some(n => /Free time between classes/.test(n)));
    });
});

describe('fewest gaps on', () => {
    test('moves a subject to the section that sits next to the others', () => {
        const { subjects, offerings } = twoSubjects();
        const p = plan(subjects, offerings, { compact: true });
        assert.equal(sectionOf(p, 'B'), 'B2');
        assert.equal(sectionOf(p, 'A'), 'A1');
        assert.equal(p.preference.compact, true);
        assert.equal(p.preference.freeMinutes, 0);
        assert.equal(p.preference.freeMinutesBefore, 300);
    });

    test('says so in the notes and in the subject\'s own reason', () => {
        const { subjects, offerings } = twoSubjects();
        const p = plan(subjects, offerings, { compact: true });
        assert.ok(p.preference.notes[0].startsWith('Free time between classes: none a week'));
        assert.match(p.preference.notes[0], /would be 5 h without this preference/);
        const b = p.recommended.find(e => e.subject.code === 'B');
        assert.match(b.preferenceReason, /keeps your classes closer together/);
        const a = p.recommended.find(e => e.subject.code === 'A');
        assert.doesNotMatch(a.preferenceReason, /closer together/);
    });

    test('when nothing can be improved the plan stays and the note is short', () => {
        const A = subj('A');
        const p = plan([A], [meet(A, 'A1', 'MW', at(8), at(9, 30))], { compact: true });
        assert.equal(sectionOf(p, 'A'), 'A1');
        assert.equal(p.preference.freeMinutes, 0);
        assert.equal(p.preference.notes[0], 'Free time between classes: none a week.');
    });

    test('never drops a subject and never creates a clash', () => {
        const A = subj('A'), B = subj('B'), C = subj('C');
        const offerings = [
            meet(A, 'A1', 'MW', at(8), at(9, 30)),
            meet(B, 'B1', 'MW', at(12), at(13, 30)),
            meet(B, 'B2', 'MW', at(9, 30), at(11)),   // would sit right after A, but C is there
            meet(C, 'C1', 'MW', at(9, 30), at(11)),
        ];
        const p = plan([A, B, C], offerings, { compact: true });
        assert.deepEqual(p.recommended.map(e => e.subject.code).sort(), ['A', 'B', 'C']);
        assert.equal(sectionOf(p, 'B'), 'B1');
        const chosen = p.recommended.map(e => e.chosenSection.meetings);
        for (let i = 0; i < chosen.length; i++) for (let j = i + 1; j < chosen.length; j++) {
            assert.ok(!chosen[i].some(x => chosen[j].some(y => SC.meetingsClash(x, y))), 'no two chosen sections clash');
        }
    });

    test('does not worsen the preferred time of day, even to save free time', () => {
        const A = subj('A'), B = subj('B');
        const offerings = [
            meet(A, 'A1', 'MW', at(13), at(14, 30)),          // afternoon only
            meet(B, 'B1', 'MW', at(8), at(9, 30)),            // morning: far from A
            meet(B, 'B2', 'MW', at(14, 30), at(16)),          // afternoon: right after A
        ];
        const morning = plan([A, B], offerings, { timeOfDay: 'morning', compact: true });
        assert.equal(sectionOf(morning, 'B'), 'B1');
        // with no time preference the compact one is free to take the afternoon section
        const anytime = plan([A, B], offerings, { compact: true });
        assert.equal(sectionOf(anytime, 'B'), 'B2');
    });

    test('with no schedule published at all, subjects stay and there is no free time to count', () => {
        const A = subj('A'), B = subj('B');
        const p = plan([A, B], [], { compact: true });
        assert.equal(p.recommended.length, 2);
        assert.equal(p.preference.freeMinutes, 0);
        assert.equal(p.preference.freeMinutesBefore, 0);
    });

    test('gives the same answer every time', () => {
        const { subjects, offerings } = twoSubjects();
        const one = plan(subjects, offerings, { compact: true });
        const two = plan(subjects, offerings, { compact: true });
        assert.deepEqual(one.recommended.map(e => e.chosenSection.section), two.recommended.map(e => e.chosenSection.section));
        assert.deepEqual(one.preference.notes, two.preference.notes);
    });

    test('the other plans offered follow the same rules: closer together unless that worsens their time of day', () => {
        const { subjects, offerings } = twoSubjects();
        const p = plan(subjects, offerings, { compact: true });
        const sectionB = (label) => p.alternatives.find(a => a.label === label)?.placed.find(x => x.code === 'B')?.section;
        // The main plan already puts B right after A (9:30), so a "Morning classes" plan would be the same
        // plan and is not offered again.
        assert.equal(sectionB('Morning classes'), undefined);
        assert.equal(sectionOf(p, 'B'), 'B2');
        // an afternoon plan keeps B in the afternoon (12:00), because moving it would lose the match
        assert.equal(sectionB('Afternoon classes'), 'B1');
    });
});

describe('what Cura and the phone are told', () => {
    const explain = require('../ai-assist/eligibility-explanation.js');
    const { assessStudent } = require('../supabase/functions/assess-student/core.js');
    const SCx = require('../shared/js/scheduleconflicts.js');

    test('the Cura summary carries the preference and the free time, and nothing when it is off', () => {
        const { subjects, offerings } = twoSubjects();
        const on = explain.summarizeForExplanation(plan(subjects, offerings, { compact: true }), 'Ann');
        assert.equal(on.preferences.fewestGaps, true);
        assert.equal(on.preferences.freeMinutesPerWeek, 0);
        assert.equal(on.preferences.freeMinutesWithoutIt, 300);

        const off = explain.summarizeForExplanation(plan(subjects, offerings, {}), 'Ann');
        assert.equal(off.preferences, null);

        // time of day alone: the summary exists but says fewest gaps is off
        const tod = explain.summarizeForExplanation(plan(subjects, offerings, { timeOfDay: 'morning' }), 'Ann');
        assert.equal(tod.preferences.fewestGaps, false);
        assert.equal(tod.preferences.freeMinutesPerWeek, null);
    });

    test('the phone\'s answer reports it', () => {
        const { subjects, offerings } = twoSubjects();
        const out = assessStudent({ engine: E, preferences: P, explain, SC: SCx }, {
            student: { id: 'stu-1', student_id: '2401187', first_name: 'Athena', last_name: 'Po', year_level: 1 },
            program: { code: 'BSIT', name: 'BSIT', max_units: 24, max_units_graduating: 27 },
            records: [], subjects, rules: [], offerings, term: 1, year: 2024,
            prefs: { timeOfDay: null, load: null, compact: true },
        });
        assert.equal(out.preferences.compact, true);
        assert.equal(out.preferences.freeMinutes, 0);
        assert.equal(out.preferences.freeMinutesBefore, 300);
        const b = out.recommended.find(r => r.code === 'B');
        assert.equal(b.section.section, 'B2');

        const plain = assessStudent({ engine: E, preferences: P, explain, SC: SCx }, {
            student: { id: 'stu-1', student_id: '2401187', first_name: 'Athena', last_name: 'Po', year_level: 1 },
            program: { code: 'BSIT', name: 'BSIT', max_units: 24, max_units_graduating: 27 },
            records: [], subjects, rules: [], offerings, term: 1, year: 2024, prefs: null,
        });
        assert.equal(plain.preferences.compact, false);
        assert.equal(plain.preferences.freeMinutes, null);
    });
});

describe('the panel summary', () => {
    test('says the free time once, only when the preference is on', () => {
        const { subjects, offerings } = twoSubjects();
        const on = P.summarize(plan(subjects, offerings, { compact: true }));
        assert.equal(on.freeTime, 'Free time between classes: none a week (it would be 5 h without this preference).');
        const off = P.summarize(plan(subjects, offerings, {}));
        assert.equal(off.freeTime, '');
    });
});
