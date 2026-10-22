// closedsections.test.mjs
// A section the Department closed (subject_offering.is_open = false, db/078_set_section_open.sql):
// the planner does not offer it, a plan cannot choose it, and it is never a backup. A plan that already holds
// it keeps showing it.
//
//   node --test tests/closedsections.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ER = require('../shared/js/enrolment/edpresult.js');
const BS = require('../shared/js/schedule/backupsections.js');
const SC = require('../shared/js/schedule/scheduleconflicts.js');
const E = require('../shared/engine/engine.js');
const P = require('../shared/engine/preferences.js');
const explain = require('../cura/eligibility-explanation.js');
const { assessStudent } = require('../supabase/functions/assess-student/core.js');
const { evaluateSelections } = require('../supabase/functions/submit-advising-request/core.js');

let nextId = 1;
const subj = (code, over = {}) => ({ id: nextId++, code, title: `${code} t`, units: 3, year_level: 1, term: 1, is_elective: false, elective_type: null, ...over });
const meet = (subject, section, days, start, end, over = {}) =>
    ({ id: nextId++, subject_id: subject.id, section, meeting_type: 'LEC', schedule_days: days, start_time: start, end_time: end, room: null, edp_code: null, is_open: true, ...over });

describe('openRows', () => {
    const rows = [
        meet({ id: 1 }, 'A', 'MW', '08:00', '09:30'),
        meet({ id: 1 }, 'B', 'MW', '10:00', '11:30', { is_open: false }),
        meet({ id: 1 }, 'B', 'F', '13:00', '16:00', { is_open: false, meeting_type: 'LAB' }),
        meet({ id: 1 }, 'C', 'TTH', '08:00', '09:30', { is_open: null }),
    ];

    test('a closed section goes, every meeting of it', () => {
        assert.deepEqual(ER.openRows(rows).map(r => r.section), ['A', 'C']);
    });

    test('the section the plan already holds stays, closed or not', () => {
        assert.deepEqual(ER.openRows(rows, 'B').map(r => r.section), ['A', 'B', 'B', 'C']);
    });

    test('a row with no is_open value counts as open', () => {
        assert.ok(ER.openRows(rows).some(r => r.section === 'C'));
        assert.equal(ER.openRows(null).length, 0);
    });

    test('nothing closed, nothing removed', () => {
        const all = rows.filter(r => r.is_open !== false);
        assert.equal(ER.openRows(all).length, all.length);
    });
});

describe('a closed section is never a backup', () => {
    test('backups and alternatives are built from the open sections only', () => {
        const a = subj('A');
        const rows = [meet(a, 'A1', 'MW', '08:00', '09:30'), meet(a, 'A2', 'MW', '10:00', '11:30', { is_open: false }), meet(a, 'A3', 'TTH', '08:00', '09:30')];
        const open = SC.groupSections(ER.openRows(rows, 'A1'));
        const backups = BS.backupsFor([{ code: 'A', chosen: 'A1', sections: open }]);
        assert.deepEqual(backups.get('A').map(g => g.section), ['A3']);
    });
});

describe('the answer for the phone', () => {
    const A = subj('A'), B = subj('B');
    const student = { id: 's1', student_id: '1', first_name: 'A', last_name: 'B', year_level: 1 };
    const program = { code: 'X', name: 'X', max_units: 24, max_units_graduating: 27 };
    const a1 = meet(A, 'A1', 'MW', '08:00', '09:30'), a2 = meet(A, 'A2', 'TTH', '08:00', '09:30');
    const b1 = meet(B, 'B1', 'MW', '10:00', '11:30');
    const go = (offerings) => assessStudent({ engine: E, preferences: P, explain, SC },
        { student, program, records: [], subjects: [A, B], rules: [], offerings, term: 1, year: 2024, prefs: null });
    const sectionsOf = (out, code) => out.recommended.find(r => r.code === code).sections.map(s => s.section);

    test('a section the Department closed is not offered', () => {
        assert.deepEqual(sectionsOf(go([a1, { ...a2, is_open: false }, b1]), 'A'), ['A1']);
    });

    test('all sections open: both are offered', () => {
        assert.deepEqual(sectionsOf(go([a1, a2, b1]), 'A'), ['A1', 'A2']);
    });

    test('a row with no is_open value (an older server) is treated as open', () => {
        const bare = (m) => { const { is_open, ...rest } = m; return rest; };
        assert.deepEqual(sectionsOf(go([bare(a1), bare(a2), bare(b1)]), 'A'), ['A1', 'A2']);
    });

    test('closing one section does not change what another subject shows', () => {
        assert.deepEqual(sectionsOf(go([{ ...a1, is_open: false }, a2, b1]), 'B'), ['B1']);
    });
});

describe('choosing a section when submitting a plan', () => {
    const A = subj('A');
    const student = { id: 's1', year_level: 1 };
    const program = { max_units: 24, max_units_graduating: 27 };
    const open1 = meet(A, 'A1', 'MW', '08:00', '09:30'), closed2 = meet(A, 'A2', 'TTH', '08:00', '09:30', { is_open: false });
    const submit = (offeringId) => evaluateSelections({ engine: E }, {
        student, program, records: [], subjects: [A], rules: [], offerings: [open1, closed2], term: 1,
        selections: [{ subjectId: A.id, offeringId }],
    })[0];

    test('an open section can be chosen', () => {
        assert.equal(submit(open1.id).valid, true);
    });

    test('a closed section is flagged, with a reason the adviser can read', () => {
        const r = submit(closed2.id);
        assert.equal(r.valid, false);
        assert.match(r.reason, /not offered/);
    });

    test('a subject with no offering named is still accepted when it has an open section', () => {
        assert.equal(submit(null).valid, true);
    });
});
