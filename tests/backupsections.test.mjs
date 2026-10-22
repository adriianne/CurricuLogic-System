// backupsections.test.mjs
// Backup sections: other sections of the same subject that do not clash with the rest of the plan.
//
//   node --test tests/backupsections.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SC = require('../shared/js/schedule/scheduleconflicts.js');
const B = require('../shared/js/schedule/backupsections.js');

let id = 1;
const row = (section, days, start, end, extra = {}) => ({
    id: id++, section, schedule_days: days, start_time: start, end_time: end,
    meeting_type: 'LEC', edp_code: String(1000 + id), ...extra,
});
const sections = (...rows) => SC.groupSections(rows);

describe('backupsFor', () => {
    test('offers another section of the same subject, never the one in the plan', () => {
        const plan = [{ code: 'A', chosen: 'A-1', sections: sections(
            row('A-1', 'MW', '08:00', '09:30'), row('A-2', 'MW', '10:00', '11:30'), row('A-3', 'TTH', '13:00', '14:30')) }];
        const out = B.backupsFor(plan).get('A');
        assert.deepEqual(out.map(g => g.section).sort(), ['A-2', 'A-3']);
        assert.ok(!out.some(g => g.section === 'A-1'));
    });

    test('leaves out a section that clashes with another subject in the plan', () => {
        const plan = [
            { code: 'A', chosen: 'A-1', sections: sections(row('A-1', 'MW', '08:00', '09:30'), row('A-2', 'TTH', '10:00', '11:30'), row('A-3', 'F', '13:00', '16:00')) },
            { code: 'B', chosen: 'B-1', sections: sections(row('B-1', 'TTH', '10:00', '11:30')) },
        ];
        // A-2 meets with B-1 on Tue/Thu at 10:00, so only A-3 is a safe backup.
        assert.deepEqual(B.backupsFor(plan).get('A').map(g => g.section), ['A-3']);
    });

    test('a subject with no other fitting section has an empty list', () => {
        const plan = [{ code: 'A', chosen: 'A-1', sections: sections(row('A-1', 'MW', '08:00', '09:30')) }];
        assert.deepEqual(B.backupsFor(plan).get('A'), []);
    });

    test('gives at most two by default and the number asked for otherwise', () => {
        const rows = ['A-1', 'A-2', 'A-3', 'A-4', 'A-5'].map((s, i) => row(s, 'MW', `${8 + i}:00`, `${9 + i}:00`));
        const plan = [{ code: 'A', chosen: 'A-1', sections: sections(...rows) }];
        assert.equal(B.backupsFor(plan).get('A').length, 2);
        assert.equal(B.backupsFor(plan, { max: 3 }).get('A').length, 3);
    });

    test('puts a backup at the same time of day as the plan first', () => {
        const plan = [{ code: 'A', chosen: 'A-1', sections: sections(
            row('A-1', 'MW', '08:00', '09:30'),       // morning, in the plan
            row('A-2', 'MW', '18:00', '19:30'),       // evening
            row('A-3', 'TTH', '10:00', '11:30')) }];  // morning
        assert.deepEqual(B.backupsFor(plan).get('A').map(g => g.section), ['A-3', 'A-2']);
    });

    test('the student\'s class-time preference decides the order when there is one', () => {
        const plan = [{ code: 'A', chosen: 'A-1', sections: sections(
            row('A-1', 'MW', '08:00', '09:30'),
            row('A-2', 'MW', '13:00', '14:30'),       // afternoon
            row('A-3', 'TTH', '10:00', '11:30')) }];  // morning
        assert.deepEqual(B.backupsFor(plan, { timeOfDay: 'afternoon' }).get('A').map(g => g.section), ['A-2', 'A-3']);
    });

    test('sections the school has closed are never offered', () => {
        const plan = [{ code: 'A', chosen: 'A-1', sections: sections(
            row('A-1', 'MW', '08:00', '09:30'), row('A-2', 'MW', '10:00', '11:30'), row('A-3', 'TTH', '10:00', '11:30')) }];
        const closed = (g) => g.section === 'A-2';
        assert.deepEqual(B.backupsFor(plan, { isClosed: closed }).get('A').map(g => g.section), ['A-3']);
    });

    test('a section with no posted time comes last, since it cannot be checked for clashes', () => {
        const plan = [{ code: 'A', chosen: 'A-1', sections: sections(
            row('A-1', 'MW', '08:00', '09:30'), row('A-2', 'TTH', null, null), row('A-3', 'F', '13:00', '16:00')) }];
        assert.deepEqual(B.backupsFor(plan).get('A').map(g => g.section), ['A-3', 'A-2']);
    });

    test('a lecture-and-lab section is judged on both meetings', () => {
        const plan = [
            { code: 'A', chosen: 'A-1', sections: sections(
                row('A-1', 'MW', '08:00', '09:30'),
                row('A-2', 'MW', '10:00', '11:30'), row('A-2', 'F', '13:00', '16:00', { meeting_type: 'LAB' })) },
            { code: 'B', chosen: 'B-1', sections: sections(row('B-1', 'F', '14:00', '15:00')) },
        ];
        // A-2's lab (Fri 1-4) overlaps B-1 (Fri 2-3): not a safe backup.
        assert.deepEqual(B.backupsFor(plan).get('A'), []);
    });

    test('a subject whose plan section is unknown still gets backups, checked against the others', () => {
        const plan = [
            { code: 'A', chosen: null, sections: sections(row('A-1', 'MW', '08:00', '09:30'), row('A-2', 'TTH', '10:00', '11:30')) },
            { code: 'B', chosen: 'B-1', sections: sections(row('B-1', 'MW', '08:00', '09:30')) },
        ];
        assert.deepEqual(B.backupsFor(plan).get('A').map(g => g.section), ['A-2']);
    });

    test('an empty plan gives an empty map', () => {
        assert.equal(B.backupsFor([]).size, 0);
        assert.equal(B.backupsFor(undefined).size, 0);
    });
});
