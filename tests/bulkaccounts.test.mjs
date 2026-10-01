// bulkaccounts.test.mjs
// The programme rules of the admin's bulk account upload.
//
//   node --test tests/bulkaccounts.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const B = require('../shared/js/bulkaccounts.js');

const PROGRAMS = [
    { code: 'BSCRIM', college: 'College of Criminology' },
    { code: 'BSIT',   college: 'College of Computer Studies' },
    { code: 'BSN',    college: 'College of Nursing' },
];

describe('templateProgram', () => {
    test('a chosen programme is the one the template uses', () => {
        assert.equal(B.templateProgram(PROGRAMS, 'BSIT').college, 'College of Computer Studies');
        assert.equal(B.templateProgram(PROGRAMS, 'BSN').code, 'BSN');
    });
    test('the choice ignores case', () => {
        assert.equal(B.templateProgram(PROGRAMS, 'bsit').code, 'BSIT');
    });
    test('"all" or nothing chosen falls back to the first programme', () => {
        assert.equal(B.templateProgram(PROGRAMS, 'all').code, 'BSCRIM');
        assert.equal(B.templateProgram(PROGRAMS, ''), PROGRAMS[0]);
        assert.equal(B.templateProgram(PROGRAMS, undefined), PROGRAMS[0]);
    });
    test('a programme that no longer exists, or none at all, gives null', () => {
        assert.equal(B.templateProgram(PROGRAMS, 'XYZ'), null);
        assert.equal(B.templateProgram([], 'all'), null);
    });
});

describe('templateFileName', () => {
    test('names the programme when one is chosen', () => {
        assert.equal(B.templateFileName('BSIT'), 'accounts-template-BSIT.xlsx');
        assert.equal(B.templateFileName('bsn'), 'accounts-template-BSN.xlsx');
    });
    test('stays plain for all programmes', () => {
        assert.equal(B.templateFileName('all'), 'accounts-template.xlsx');
        assert.equal(B.templateFileName(''), 'accounts-template.xlsx');
    });
});

describe('programmeGate', () => {
    test('no programme chosen: nothing is constrained', () => {
        assert.deepEqual(B.programmeGate('all', 'student', 'BSN'), {});
        assert.deepEqual(B.programmeGate('', 'faculty', 'BSIT'), {});
        assert.deepEqual(B.programmeGate('all', 'admin', ''), {});
    });

    test('a row for the chosen programme goes through, whatever its case', () => {
        assert.deepEqual(B.programmeGate('BSIT', 'student', 'BSIT'), {});
        assert.deepEqual(B.programmeGate('BSIT', 'faculty', 'bsit'), {});
    });

    test('a row for another programme is rejected and says which', () => {
        const r = B.programmeGate('BSIT', 'student', 'BSN');
        assert.match(r.error, /This row is for BSN, but you selected BSIT/);
    });

    test('the same holds for every other programme', () => {
        for (const [pick, row] of [['BSN', 'BSIT'], ['BSCRIM', 'BSN'], ['BSIT', 'BSCRIM']]) {
            assert.match(B.programmeGate(pick, 'registrar', row).error, new RegExp(`for ${row}, but you selected ${pick}`));
        }
    });

    test('a blank programme takes the chosen one', () => {
        assert.deepEqual(B.programmeGate('BSIT', 'student', ''), { value: 'BSIT' });
        assert.deepEqual(B.programmeGate('BSIT', 'faculty', '   '), { value: 'BSIT' });
        assert.deepEqual(B.programmeGate('BSIT', 'student', undefined), { value: 'BSIT' });
    });

    test('an admin row cannot join a single-programme batch', () => {
        assert.match(B.programmeGate('BSIT', 'admin', '').error, /Choose "All programmes"/);
    });

    test('a typo in the row is a mismatch, not silently accepted', () => {
        assert.match(B.programmeGate('BSIT', 'student', 'BSITT').error, /for BSITT, but you selected BSIT/);
    });
});

describe('sampleRoles', () => {
    test('with no role chosen the template shows every non-admin role', () => {
        assert.deepEqual(B.sampleRoles('all'), ['faculty', 'registrar', 'department', 'student']);
        assert.deepEqual(B.sampleRoles(''), ['faculty', 'registrar', 'department', 'student']);
    });
    test('a chosen role gives only that role', () => {
        assert.deepEqual(B.sampleRoles('student'), ['student']);
        assert.deepEqual(B.sampleRoles('Registrar'), ['registrar']);
    });
    test('an admin sample appears only when admin is chosen on purpose', () => {
        assert.ok(!B.sampleRoles('all').includes('admin'));
        assert.deepEqual(B.sampleRoles('admin'), ['admin']);
    });
    test('an unknown role gives no sample rows', () => {
        assert.deepEqual(B.sampleRoles('janitor'), []);
    });
});

describe('templateFileName with a role', () => {
    test('names the role, and the programme when both are chosen', () => {
        assert.equal(B.templateFileName('all', 'student'), 'accounts-template-student.xlsx');
        assert.equal(B.templateFileName('BSIT', 'student'), 'accounts-template-BSIT-student.xlsx');
        assert.equal(B.templateFileName('all', 'all'), 'accounts-template.xlsx');
    });
    test('an admin template never names a programme', () => {
        assert.equal(B.templateFileName('BSIT', 'admin'), 'accounts-template-admin.xlsx');
    });
});

describe('roleGate', () => {
    test('no role chosen: nothing is constrained', () => {
        assert.deepEqual(B.roleGate('all', 'student'), {});
        assert.deepEqual(B.roleGate('', 'admin'), {});
    });
    test('a row of the chosen role goes through', () => {
        assert.deepEqual(B.roleGate('student', 'student'), {});
        assert.deepEqual(B.roleGate('faculty', 'FACULTY'), {});
    });
    test('a row of another role is rejected and says which', () => {
        assert.match(B.roleGate('student', 'faculty').error, /This row is a faculty account, but you selected student/);
        assert.match(B.roleGate('registrar', 'admin').error, /This row is an admin account, but you selected registrar/);
    });
    test('a blank role is rejected too', () => {
        assert.match(B.roleGate('student', '').error, /blank account/);
    });
});
