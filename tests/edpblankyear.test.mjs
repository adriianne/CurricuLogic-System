// edpblankyear.test.mjs
// EDP student list: a student above Year 1 with no curriculum year gets a warning (18 Nov 2026), because self-registration would
// place them on the ACTIVE curriculum.
//   node --test tests/edpblankyear.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const ES = createRequire(import.meta.url)('../shared/js/accounts/expectedstudents.js');
const adm = readFileSync(new URL('../features/admin/admindashboard.js', import.meta.url), 'utf8');

describe('blankCurriculumWarning', () => {
    test('Year 2 or higher with a blank curriculum year is warned', () => {
        for (const y of [2, 3, 4]) assert.equal(ES.blankCurriculumWarning(y, null), ES.BLANK_YEAR_WARNING);
        assert.match(ES.BLANK_YEAR_WARNING, /placed on the active curriculum/);
        assert.match(ES.BLANK_YEAR_WARNING, /add the year they started/);
    });
    test('a first-year with no curriculum year is fine: the active curriculum is right for them', () => {
        assert.equal(ES.blankCurriculumWarning(1, null), '');
    });
    test('a year level that is unknown or blank is not guessed at', () => {
        assert.equal(ES.blankCurriculumWarning(null, null), '');
        assert.equal(ES.blankCurriculumWarning(undefined, null), '');
    });
    test('a curriculum year that is given means nothing to warn about', () => {
        assert.equal(ES.blankCurriculumWarning(3, 2020), '');
    });
    test('a file with no curriculum_year column: a new row is warned, an update keeps its saved year', () => {
        assert.equal(ES.blankCurriculumWarning(3, undefined, false), ES.BLANK_YEAR_WARNING);
        assert.equal(ES.blankCurriculumWarning(3, undefined, true), '');
    });
});

describe('the checked rows carry what the warning needs', () => {
    const progs = [{ id: 1, code: 'BSIT' }];
    const row = (extra) => ({ __line: 2, student_id: '24001500', first_name: 'Ana', last_name: 'Cruz', email: 'ana@example.com', program_code: 'BSIT', ...extra });
    test('a blank cell gives curriculumYear null and the warning for Year 3', () => {
        const { ok } = ES.checkRows([row({ year_level: '3', curriculum_year: '' })], progs, new Set(), new Map(), new Map([[1, new Set([2024])]]));
        assert.equal(ok[0].curriculumYear, null);
        assert.equal(ok[0].yearLevel, 3);
        assert.ok(ES.blankCurriculumWarning(ok[0].yearLevel, ok[0].curriculumYear, ok[0].isUpdate));
    });
    test('a listed year gives no warning', () => {
        const { ok } = ES.checkRows([row({ year_level: '3', curriculum_year: '2024' })], progs, new Set(), new Map(), new Map([[1, new Set([2024])]]));
        assert.equal(ok[0].curriculumYear, 2024);
        assert.equal(ES.blankCurriculumWarning(ok[0].yearLevel, ok[0].curriculumYear, ok[0].isUpdate), '');
    });
});

describe('the Admin page', () => {
    test('the preview shows a summary notice, and Year and Curriculum columns', () => {
        assert.match(adm, /above Year 1 \$\{noYear === 1 \? 'has' : 'have'\} no curriculum year/);
        assert.match(adm, /<th>Programme<\/th><th>Year<\/th><th>Curriculum<\/th><th>Email<\/th>/);
        assert.match(adm, /You can still save as it is/);
    });
    test('the preview and the list use the same Curriculum cell, with a warning mark', () => {
        assert.match(adm, /\$\{edpCurriculumCell\(r\.yearLevel, r\.curriculumYear, r\.isUpdate\)\}/);
        assert.match(adm, /\$\{edpCurriculumCell\(s\.year_level, s\.curriculum_year \?\? null\)\}/);
        assert.match(adm, /class="edp-year-warn" title=/);
    });
    test('the warning never blocks saving', () => {
        const preview = adm.slice(adm.indexOf('function renderEdpPreview'), adm.indexOf('async function commitEdpList'));
        assert.match(preview, /id="edp-commit"/);
        assert.doesNotMatch(preview.slice(preview.indexOf('if (noYear)'), preview.indexOf('if (bad.length)')), /disabled/);
    });
});
