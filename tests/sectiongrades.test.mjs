// sectiongrades.test.mjs
// Grade upload by section (EDP code), 6 Nov 2026. These tests read the files; the page was driven in a browser.
//
//   node --test tests/sectiongrades.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const js = read('features/department/departmentdashboard.js');
const html = read('features/department/departmentdashboard.html');

describe('the page', () => {
    test('there is a Section (EDP code) choice, optional, beside the subject, and it says what it does', () => {
        assert.match(html, /<select id="g-section">/);
        assert.match(html, /Any section: my file names its students/);
        assert.match(html, /<strong>By section:<\/strong>/);
    });
});

describe('choosing a section', () => {
    test('the sections are those posted for the chosen term, and only ones that have an EDP code', () => {
        assert.match(js, /\.from\('subject_offering'\)[\s\S]{0,200}\.eq\('academic_year', year\)\.eq\('term', term\)/);
        assert.match(js, /filter\(o => o\.edp_code && o\.subject\)/);
    });
    test('they are loaded again when the term changes, and once when the page opens', () => {
        assert.match(js, /\$\('g-period'\)\?\.addEventListener\('change', \(\) => \{\s*\n\s*loadSectionOptions\(\);/);
        assert.match(js, /renderSubjectOptions\(\);\s*\n\s*loadSectionOptions\(\);/);
    });
    test('choosing one fills in the subject and locks it; clearing it unlocks it', () => {
        assert.match(js, /subSel\.value = o\.subject\.code;\s*\n\s*subSel\.disabled = true;/);
        assert.match(js, /subSel\.disabled = false; subSel\.value = '';/);
    });
    test('the class list is the students approved for THAT section, from plans the adviser approved', () => {
        const fn = js.slice(js.indexOf('async function fetchSectionClassList'), js.indexOf('async function loadSectionStudents'));
        assert.match(fn, /\.eq\('offering_id', offeringId\)/);
        assert.match(fn, /\.neq\('status', 'rejected'\)/);
        assert.match(fn, /in\('request\.status', \['approved', 'partially_approved'\]\)/);
        assert.match(fn, /CurriculogicRequestStatus\.finalApproved/);
    });
    test('the download uses it, and the file is named with the EDP code', () => {
        assert.match(js, /section \? await fetchSectionClassList\(section\.id\) : await fetchClassList\(subject, year, term\)/);
        assert.match(js, /class-list-EDP\$\{section\.edp\}-\$\{subject\.code\}-\$\{year\}-\$\{term\}\.xlsx/);
    });
});

describe('checking a file', () => {
    test('a student who is not in the section is rejected, with the section named, before any other check of the row', () => {
        assert.match(js, /if \(sectionIds && !sectionIds\.has\(cleanId\)\) \{/);
        assert.match(js, /Not in section EDP \$\{section\.edp\} \(\$\{section\.label\}\): no approved enrollment/);
        const reject = js.indexOf('Not in section EDP');
        const subjectCheck = js.indexOf("not in this student's prospectus");
        assert.ok(reject > 0 && reject < subjectCheck);
    });
    test('with no section chosen nothing is limited (the universal upload is unchanged)', () => {
        assert.match(js, /const sectionIds = section \? await loadSectionStudents\(\) : null;/);
    });
    test('the subject rule still applies: a row for another subject is rejected', () => {
        assert.match(js, /but you selected \$\{chosenSubject\}/);
    });
});
