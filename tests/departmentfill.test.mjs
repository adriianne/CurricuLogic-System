// departmentfill.test.mjs
// 24 Nov 2026: on the Admin's Create account form, "Department / college" follows the chosen programme. A faculty member or a department head is
// linked to programmes through the college name, so a hand-typed college that differs from the programme's put accounts under the wrong programmes.
//
//   node --test tests/departmentfill.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const DF = require('../shared/js/accounts/departmentfill.js');
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

// the colleges as saved on 24 Nov 2026 (Admin -> Programs)
const PROGRAMMES = [
    { code: 'ACT', college: 'College of Computer Studies' },
    { code: 'BSCS', college: 'College of Computer Studies' },
    { code: 'BSCRIM', college: 'Bachelor of Science in Criminology' },
    { code: 'BSHM', college: 'College of Science in Hospital Management' },
    { code: 'NEW', college: '' },
    { code: 'NONE', college: null },
];
const pick = (o) => DF.pick({ programmes: PROGRAMMES, role: 'faculty', current: '', onlyIfEmpty: false, ...o });

describe('a programme change (always follows the programme)', () => {
    test('picking BSCRIM fills its college, for faculty and for department staff', () => {
        assert.equal(pick({ code: 'BSCRIM' }), 'Bachelor of Science in Criminology');
        assert.equal(pick({ code: 'BSCRIM', role: 'department' }), 'Bachelor of Science in Criminology');
    });
    test('it replaces what the box held: the old college of another programme', () => {
        assert.equal(pick({ code: 'BSHM', current: 'College of Computer Studies' }), 'College of Science in Hospital Management');
    });
    test('the match on the code ignores case and spaces', () => {
        assert.equal(pick({ code: ' bscs ' }), 'College of Computer Studies');
    });
    test('already right: nothing to change', () => {
        assert.equal(pick({ code: 'BSCS', current: 'College of Computer Studies' }), null);
        assert.equal(pick({ code: 'BSCS', current: '  College of Computer Studies  ' }), null);
    });
});

describe('a role change (fills a blank box, never overwrites)', () => {
    test('a blank box is filled', () => {
        assert.equal(pick({ code: 'BSCS', onlyIfEmpty: true }), 'College of Computer Studies');
        assert.equal(pick({ code: 'BSCS', onlyIfEmpty: true, current: '   ' }), 'College of Computer Studies');
    });
    test('a box that already holds something is left alone', () => {
        assert.equal(pick({ code: 'BSCS', onlyIfEmpty: true, current: 'College of Business' }), null);
    });
});

describe('what is never filled', () => {
    test('a student has no department box', () => assert.equal(pick({ code: 'BSCS', role: 'student' }), null));
    test('a Registrar\'s department is the Registrar\'s office, not a college', () => assert.equal(pick({ code: 'BSCS', role: 'registrar' }), null));
    test('no programme chosen yet', () => {
        assert.equal(pick({ code: '' }), null);
        assert.equal(pick({ code: undefined }), null);
        assert.equal(pick({ code: null }), null);
    });
    test('a programme with no college set, or one that is not in the list', () => {
        assert.equal(pick({ code: 'NEW' }), null);
        assert.equal(pick({ code: 'NONE' }), null);
        assert.equal(pick({ code: 'XYZ' }), null);
    });
    test('no list of programmes, or nothing at all', () => {
        assert.equal(DF.pick({ role: 'faculty', programmes: null, code: 'BSCS' }), null);
        assert.equal(DF.pick({ role: 'faculty', programmes: [], code: 'BSCS' }), null);
        assert.equal(DF.pick(), null);
    });
});

describe('wiring on the Create account page', () => {
    const js = read('features/admin/admindashboard.js');
    const html = read('features/admin/admindashboard.html');
    test('the module loads before the page script', () => {
        const mod = html.indexOf('shared/js/accounts/departmentfill.js');
        assert.ok(mod > 0);
        assert.ok(mod < html.indexOf('src="admindashboard.js"'));
    });
    test('choosing a programme refills the box, always (option A)', () => {
        assert.ok(js.includes("$('a-program')?.addEventListener('change', () => fillDepartmentFromProgramme(false));"));
    });
    test('changing the role fills a blank box only', () => {
        assert.ok(js.includes('fillDepartmentFromProgramme(true);'));
        const upd = js.slice(js.indexOf('function updateRoleFields()'), js.indexOf('/* The programme code to send for a student'));
        assert.ok(upd.includes('fillDepartmentFromProgramme(true);'));
    });
    test('it asks the module with the role, the programmes, the chosen code and what the box holds', () => {
        const fn = js.slice(js.indexOf('function fillDepartmentFromProgramme('), js.indexOf("$('a-program')?.addEventListener('change', () => fillDepartmentFromProgramme(false));"));
        for (const part of ["role: $('a-role')?.value", 'programmes: PROGRAMS', "resolveProgramCode($('a-program')?.value ?? '').value", 'current: box.value', 'onlyIfEmpty']) {
            assert.ok(fn.includes(part), part);
        }
        assert.ok(fn.includes('if (next) box.value = next;'));
    });
    test('the programme list the page loads carries the college', () => {
        assert.ok(/from\('program'\)\.select\('id, code, name, college,/.test(js));
    });
    test('creating an account still reads the box as before (a blank registrar box is still the Registrar\'s office)', () => {
        assert.ok(js.includes("if (role === 'registrar') return { value: 'Office of the Registrar' };"));
    });
});
