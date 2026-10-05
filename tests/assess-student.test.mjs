// assess-student.test.mjs
// The shaping step of the assess-student function (used by the Android app).
// The engine itself is tested elsewhere; this checks that the function calls
// the same code the website does, and hands the client a correct, complete,
// plain-JSON answer.
//
//   node --test tests/assess-student.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { assessStudent } = require('../supabase/functions/assess-student/core.js');
const engine = require('../shared/engine/engine.js');
const preferences = require('../shared/engine/preferences.js');
const explain = require('../ai-assist/eligibility-explanation.js');
const SC = require('../shared/js/scheduleconflicts.js');

const deps = { engine, preferences, explain, SC };

let id = 100;
const subj = (code, o = {}) => ({
    id: id++, code, title: `${code} title`, units: '3.00',
    year_level: o.y ?? null, term: o.t ?? null,
    is_elective: !!o.e, elective_type: o.type ?? null,
});
const A = subj('A', { y: 1, t: 1 }), B = subj('B', { y: 1, t: 1 }), C = subj('C', { y: 1, t: 2 });
const D = subj('D', { y: 2, t: 1 });
const SLOT = subj('IT-EL1', { y: 3, t: 1, e: true, type: 'IT' });
const CAT = subj('ELX', { e: true, type: 'IT' });
const subjects = [A, B, C, D, SLOT, CAT];
const rules = [{ subject_id: C.id, prerequisite_subject_id: A.id, requirement_type: 'prerequisite', rule_type: 'and', rule_group: 1, threshold_value: null }];

const student = { id: 'stu-1', student_id: '2401187', first_name: 'Athena', last_name: 'Po', year_level: 1 };
const program = { code: 'BSIT', name: 'BS Information Technology', max_units: 24, max_units_graduating: 27 };
const records = [{ subject_id: A.id, status: 'PASSED', grade: '1.50' }];
const meet = (s, section, start, end) => ({ subject_id: s.id, section, meeting_type: 'LEC', schedule_days: 'MW', start_time: start, end_time: end, room: 'R1' });

const base = () => ({ student, program, records, subjects, rules, offerings: [], term: 1, year: 2024, prefs: null });
const run = (over = {}) => assessStudent(deps, { ...base(), ...over });
const codes = (list) => list.map(x => x.code ?? x.subject?.code);

describe('the answer', () => {
    const out = run();

    test('says who and when', () => {
        assert.equal(out.assessed, true);
        assert.deepEqual(out.student, {
            id: 'stu-1', studentId: '2401187', name: 'Athena Po', firstName: 'Athena',
            yearLevel: 1, programCode: 'BSIT', programName: 'BS Information Technology',
        });
        assert.deepEqual(out.term, { term: 1, year: 2024 });
    });

    test('progress counts the degree, not the catalogue', () => {
        // A, B, C, D and the slot are 3 units each; the catalogue entry is not part of the degree.
        assert.equal(out.progress.totalUnits, 15);
        assert.equal(out.progress.unitsEarned, 3);
        assert.equal(out.progress.percent, 20);
        assert.equal(out.progress.passed, 1);
    });

    test('is plain JSON a phone can parse', () => {
        const round = JSON.parse(JSON.stringify(out));
        assert.deepEqual(round, JSON.parse(JSON.stringify(round)));
        assert.equal(typeof round.summary, 'object');
    });
});

describe('same engine as the website', () => {
    test('the recommendation is exactly what engine + preferences produce', () => {
        const kb = { subjects, rules, offerings: [] };
        const direct = preferences.apply(
            engine.assess({ id: student.id, year_level: 1 }, records, kb,
                { maxUnits: 24, maxUnitsGraduating: 27, term: 1, respectOfferings: false }), null);
        assert.deepEqual(codes(run().recommended), codes(direct.recommended));
        assert.equal(run().load.recommendedUnits, direct.recommendedUnits);
    });

    test('the Cura summary is the website summary', () => {
        const out = run();
        assert.equal(out.summary.studentName, 'Athena');
        assert.equal(out.summary.unitsEarned, 3);
        assert.equal(out.summary.recommended.length, out.recommended.length);
    });
});

describe('the curriculum', () => {
    const rows = run().curriculum;
    const get = (code) => rows.find(r => r.code === code);

    test('every subject appears once with a status', () => {
        assert.deepEqual([...new Set(rows.map(r => r.code))].length, rows.length);
        assert.equal(get('A').status, 'passed');
        assert.equal(get('A').detail, 'Grade 1.50');
        assert.equal(get('B').status, 'eligible');
        assert.equal(get('C').status, 'eligible', 'its prerequisite A is passed');
    });

    test('a 3rd-year slot is locked by the year gate, with the reason', () => {
        assert.equal(get('IT-EL1').status, 'blocked');
        assert.match(get('IT-EL1').detail, /2nd Year/);
    });

    test('rows are in curriculum order, catalogue last', () => {
        assert.deepEqual(rows.map(r => r.code), ['A', 'B', 'C', 'D', 'IT-EL1', 'ELX']);
    });

    test('locked subjects carry their reasons', () => {
        const l = run().locked.find(x => x.code === 'IT-EL1');
        assert.ok(l.reasons.length >= 1);
    });
});

describe('preferences', () => {
    const many = Array.from({ length: 9 }, (_, i) => subj('M' + i, { y: 1, t: 1 }));

    test('a light load trims the list and says why', () => {
        const out = run({ subjects: many, rules: [], records: [], prefs: { load: 'light' } });
        assert.equal(out.load.recommendedUnits, 15);
        assert.equal(out.preferences.load, 'light');
        assert.equal(out.preferences.ceiling, 15);
        assert.ok(out.preferences.movedToLaterTerm.length > 0);
        assert.match(out.preferences.notes.join(' '), /Kept to about 15 units/);
        assert.ok(out.alsoOpen.length >= out.preferences.movedToLaterTerm.length);
    });

    test('a time preference picks a section and gives the meetings', () => {
        const offerings = [{ ...meet(B, '1-A', '14:00', '15:30'), id: 71 }, { ...meet(B, '1-B', '08:00', '09:30'), id: 72 }];
        const out = run({ offerings, prefs: { timeOfDay: 'morning' } });
        const b = out.recommended.find(r => r.code === 'B');
        assert.equal(b.section.section, '1-B');
        assert.equal(b.section.timeOfDay, 'morning');
        assert.deepEqual(b.section.meetings[0], { type: 'LEC', days: 'MW', start: '08:00', end: '09:30', room: 'R1' });
        assert.equal(b.sections.length, 2);
        assert.equal(b.section.offeringId, 72, 'the request names the section by this id');
        assert.deepEqual(b.sections.map(s => s.offeringId), [71, 72]);
        assert.equal(b.timeMatch, 'match');
        assert.match(b.sectionReason, /morning/);
    });

    test('no preference gives no chosen section but still lists the sections', () => {
        const offerings = [meet(B, '1-A', '14:00', '15:30')];
        const out = run({ offerings });
        const b = out.recommended.find(r => r.code === 'B');
        assert.equal(b.sections.length, 1);
        assert.equal(out.preferences.timeOfDay, null);
    });

    test('a subject with no schedule yet says so', () => {
        // Only D is scheduled, so A-C's semester has no schedule: "pending".
        const out = run({ offerings: [meet(D, '2-A', '08:00', '09:30')] });
        const b = out.recommended.find(r => r.code === 'B');
        assert.equal(b.scheduleState, 'pending');
    });
});

describe('electives', () => {
    test('a passed catalogue subject fills the slot and shows in the curriculum', () => {
        const passedCat = [...records, { subject_id: CAT.id, status: 'PASSED', grade: '2.00' }];
        const out = assessStudent(deps, { ...base(), records: passedCat });
        const slot = out.curriculum.find(r => r.code === 'IT-EL1');
        assert.equal(slot.status, 'passed');
        assert.deepEqual(slot.filledBy, { code: 'ELX', title: 'ELX title' });
        assert.equal(out.electives.IT.filled, 1);
    });
});

describe('subjects open but not suggested', () => {
    test('carry their sections and ids, so the plan builder can offer them', () => {
        const many = Array.from({ length: 9 }, (_, i) => subj(`M${i}`, { y: 1, t: 1 }));
        const offerings = many.map((s, i) => ({ ...meet(s, `${i}-A`, '08:00', '09:30'), id: 800 + i }));
        const out = run({ subjects: many, rules: [], records: [], offerings, prefs: { load: 'light' } });
        assert.ok(out.alsoOpen.length > 0, 'a light load leaves some subjects for later');
        for (const o of out.alsoOpen) {
            assert.equal(o.sections.length, 1);
            assert.equal(o.sections[0].offeringId, 800 + Number(o.code.slice(1)));
        }
    });
});
