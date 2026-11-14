// programswitch.test.mjs
// The header "Programme" switch for a Faculty member or Registrar who covers several programmes
// (shared/js/app/programswitch.js) and how the two pages use it.
//
//   node --test tests/programswitch.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const PS = require('../shared/js/app/programswitch.js');
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

const options = [{ id: 7, code: 'BSIT', name: 'BS Information Technology' }, { id: 14, code: 'BSN', name: 'BS Nursing' }];

describe('the choice', () => {
    test('nothing remembered means every programme', () => {
        for (const v of [undefined, null, '', 'all']) assert.equal(PS.resolveChoice(v, options), 'all');
    });
    test('a remembered programme is kept while it is still on offer, as a number', () => {
        assert.equal(PS.resolveChoice('14', options), 14);
    });
    test('a remembered programme the person no longer covers falls back to every programme', () => {
        assert.equal(PS.resolveChoice('99', options), 'all');
        assert.equal(PS.resolveChoice('7', []), 'all');
    });
    test('the button says what is chosen', () => {
        assert.equal(PS.labelFor('all', options), 'All programmes (2)');
        assert.equal(PS.labelFor(7, options), 'BSIT');
        assert.equal(PS.labelFor(99, options), 'All programmes (2)');
    });
});

describe('the control', () => {
    const src = read('shared/js/app/programswitch.js');
    test('shows only with two or more programmes, and then hides the plain label', () => {
        assert.match(src, /const many = options\.length > 1/);
        assert.match(src, /host\.hidden = !many/);
        assert.match(src, /cfg\.wrap\.hidden = many/);
    });
    test('is a listbox that closes on Escape or an outside click and works from the keyboard', () => {
        assert.match(src, /role="listbox"/);
        assert.match(src, /aria-haspopup="listbox"/);
        assert.match(src, /e\.key === 'Escape'/);
        assert.match(src, /!host\.contains\(e\.target\)/);
        assert.match(src, /ArrowDown/);
    });
    test('remembers the choice for the browser tab only, and never fails without storage', () => {
        assert.match(src, /sessionStorage/);
        assert.match(src, /catch \(e\)/);
    });
    test('touches no database', () => {
        assert.doesNotMatch(src, /supabase/);
    });
});

describe('the pages', () => {
    for (const page of ['faculty', 'registrar']) {
        const js = read(`features/${page}/${page}dashboard.js`);
        const html = read(`features/${page}/${page}dashboard.html`);
        test(`${page}: loads the switch and creates it on the header label`, () => {
            assert.match(html, /programswitch\.js/);
            assert.match(js, /CurriculogicProgramSwitch\.create\(\{\s*wrap: document\.getElementById\('topbar-program-wrap'\)/);
        });
        test(`${page}: the choice filters student counts, the list and recent students`, () => {
            assert.match(js, /const scopeStudents = \(q\) => \(PROGRAM_SCOPE === 'all' \? q : q\.eq\('program_id', PROGRAM_SCOPE\)\)/);
            assert.match(js, /scopeStudents\(supabase\.from\('university_student'\)\.select\('id', \{ count: 'exact', head: true \}\)\)/);
            assert.match(js, /let q = scopeStudents\(supabase\.from\('university_student'\)\.select\((STUDENT_COLS|SELECT_COLS), \{ count: 'exact' \}\)\)/);
        });
        test(`${page}: the plan count joins the student only when one programme is chosen`, () => {
            assert.match(js, /PROGRAM_SCOPE === 'all' \? 'id' : 'id, student:student_id!inner\(program_id\)'/);
            assert.match(js, /countQuery\.eq\('student\.program_id', PROGRAM_SCOPE\)/);
        });
        test(`${page}: choosing a programme starts again from page 1`, () => {
            assert.match(js, /async function applyProgramScope\(\)/);
            assert.match(js, /LIST\.page = 1; loadStudentList\(\)/);
        });
    }
    test('faculty: requests and approved plans are filtered by the chosen programme', () => {
        const js = read('features/faculty/facultydashboard.js');
        assert.match(js, /REQ_PENDING = \(requests \?\? \[\]\)\.filter\(inScope\)/);
        assert.match(js, /\.filter\(inScope\);/);
        assert.match(js, /student:student_id \(id, first_name, last_name, student_id, year_level, program_id\)/);
    });
    test('registrar: the approved plans list is filtered by the chosen programme', () => {
        const js = read('features/registrar/registrardashboard.js');
        assert.match(js, /PROGRAM_SCOPE !== 'all' && Number\(r\.student\?\.program_id\) !== PROGRAM_SCOPE\) return false/);
    });
    test('the old in-page programme filter is gone', () => {
        assert.doesNotMatch(read('features/registrar/registrardashboard.html'), /id="adv-program"/);
    });
});
