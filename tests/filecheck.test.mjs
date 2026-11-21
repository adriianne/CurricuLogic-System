// filecheck.test.mjs
// What the scanned FILE says about itself, against what was chosen (21 Nov 2026): the year it prints, the programme it names,
// whether it matches another programme's curriculum, and the 90 percent line for a near-duplicate.
//
//   node --test tests/filecheck.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const S = require('../shared/js/curriculum/samecurriculum.js');
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const builder = read('features/department/curriculum-builder.js');
const s = (code, year = 1, term = 1, lec = 3, lab = 0) => ({ code, year, term, lec, lab });
const set = (n) => Array.from({ length: n }, (_, i) => s(`SUBJ${100 + i}`, 1 + (i % 4), 1 + (i % 2)));

describe('printedYear and yearMismatch', () => {
    test('reads the first year in the ways a document prints it', () => {
        for (const [text, year] of [['2024-2025', 2024], ['A.Y. 2024–2025', 2024], ['SY 2024', 2024], ['2023 - 2024', 2023], [2024, 2024]]) {
            assert.equal(S.printedYear(text), year, String(text));
        }
    });
    test('no year, or a number that is not one, is null', () => {
        for (const text of [null, undefined, '', 'no year here', 'Batch 12024567', '1850', 'x2024y2025z']) {
            assert.equal(S.printedYear(text), text === 'x2024y2025z' ? 2024 : null, String(text));
        }
    });
    test('the file says 2024 and 2025 was chosen: a mismatch that names both', () => {
        assert.deepEqual(S.yearMismatch('2024-2025', 2025), { printed: 2024, selected: 2025 });
    });
    test('the same year, no printed year, or no choice: nothing to say', () => {
        assert.equal(S.yearMismatch('2024-2025', 2024), null);
        assert.equal(S.yearMismatch(null, 2024), null);
        assert.equal(S.yearMismatch('2024-2025', null), null);
        assert.equal(S.yearMismatch('2024-2025', 'x'), null);
    });
});

describe('programmeFit', () => {
    const progs = {
        ai:  { code: 'BSCSAI', name: 'Bachelor of Science in Computer Science (Artificial Intelligence)' },
        cs:  { code: 'BSCS', name: 'Bachelor of Science in Computer Science' },
        it:  { code: 'BSIT', name: 'Bachelor of Science in Information Technology' },
        act: { code: 'ACT', name: 'Associate in Computer Technology (Applications Development)' },
    };
    const file = 'Bachelor of Science in Computer Science (BSCS) with specialization in Artificial Intelligence';
    test('the AI file fits the AI programme, and not the plain CS, IT or ACT ones', () => {
        assert.equal(S.programmeFit(file, progs.ai).fits, true);
        assert.equal(S.programmeFit(file, progs.cs).fits, false);
        assert.equal(S.programmeFit(file, progs.it).fits, false);
        assert.equal(S.programmeFit(file, progs.act).fits, false);
    });
    test('a plain CS file fits CS, and not the AI specialization', () => {
        assert.equal(S.programmeFit('Bachelor of Science in Computer Science', progs.cs).fits, true);
        assert.equal(S.programmeFit('Bachelor of Science in Computer Science', progs.ai).fits, false);
    });
    test('wording differences that do not change the programme still fit', () => {
        assert.equal(S.programmeFit('Associate in Computer Technology', progs.act).fits, true);
        assert.equal(S.programmeFit('BS Information Technology', progs.it).fits, true);
        assert.equal(S.programmeFit('BACHELOR OF SCIENCE IN INFORMATION TECHNOLOGY', progs.it).fits, true);
    });
    test('the programme code in the printed name fits at once', () => {
        assert.equal(S.programmeFit('BSIT curriculum, effective 2024', progs.it).fits, true);
    });
    test('a bracketed acronym is a code, not words; a bracketed phrase stays', () => {
        assert.equal(S.programmeFit('Bachelor of Science in Information Technology (BSIT)', progs.it).score, 1);
        assert.ok(S.programmeFit('Associate in Computer Technology (Applications Development)', progs.act).score === 1);
    });
    test('nothing to compare says nothing: it fits', () => {
        assert.equal(S.programmeFit(null, progs.it).fits, true);
        assert.equal(S.programmeFit('', progs.it).fits, true);
        assert.equal(S.programmeFit('Bachelor of Science', progs.it).fits, true);
        assert.equal(S.programmeFit('Computer Science', null).fits, true);
    });
});

describe('the near-duplicate line is 90 percent', () => {
    const v = (year) => ({ id: year, academic_year: year, is_active: false });
    test('the constant, and the 94.5 percent case from 21 Nov 2026 (52 of 55 alike) is now reported', () => {
        assert.equal(S.NEAR, 0.9);
        const mine = set(55);
        const theirs = [...mine.slice(0, 52), s('X1'), s('X2'), s('X3')];
        const r = S.findSame(mine, [{ version: v(2024), subjects: theirs }]);
        assert.equal(r.length, 1);
        assert.equal(r[0].result.identical, false);
        assert.ok(r[0].result.similarity > 0.9 && r[0].result.similarity < 0.95);
    });
    test('85 percent alike is still not reported', () => {
        const mine = set(20);
        assert.equal(S.findSame(mine, [{ version: v(2024), subjects: [...mine.slice(0, 17), s('N1'), s('N2'), s('N3')] }]).length, 0);
    });
});

describe('the builder uses these as warnings, never blockers', () => {
    const pf = builder.slice(builder.indexOf('function preflight'), builder.indexOf('const years = [1, 2, 3, 4]'));
    test('the pre-flight takes the other programmes too, and Create reads all three in parallel', () => {
        assert.ok(builder.includes('function preflight(taken, others = [], elsewhere = []) {'));
        assert.ok(builder.includes('const [taken, others, elsewhere] = await Promise.all([existingCodes(), otherVersions(), otherProgrammes()]);'));
        assert.ok(builder.includes('confirmCreate(preflight(taken, others, elsewhere));'));
    });
    test('a different printed year is a warning that names both years', () => {
        assert.ok(pf.includes('SAME.yearMismatch(SCAN_DOC.year, picked)'));
        assert.match(pf, /warnings\.push\(`This file says \$\{yearOff\.printed\}/);
        assert.ok(pf.includes('Check that the right curriculum year is selected.'));
    });
    test('a different programme is a warning that names the file\'s programme and this one', () => {
        assert.ok(pf.includes('SAME.programmeFit(SCAN_DOC.name, { code: OPTS.programCode, name: OPTS.programName })'));
        assert.ok(pf.includes('Check that it is the right file.'));
    });
    test('a match with another programme is a warning', () => {
        assert.ok(pf.includes("a different programme's curriculum."));
        assert.ok(pf.includes('SAME.findSame(rows.map(SAME.fromBuilderRow), elsewhere ?? [])'));
    });
    test('none of the three file checks adds a blocker', () => {
        const block = pf.slice(pf.indexOf('The file\'s own claims'), pf.indexOf('const years') > 0 ? undefined : undefined);
        const region = pf.slice(pf.indexOf("The file's own claims"));
        assert.ok(region.length > 100);
        assert.ok(!region.includes('blockers.push'));
        assert.ok(block);
    });
    test('the other-programmes read never throws and gives [] on any failure (it only adds a warning)', () => {
        const fn = builder.slice(builder.indexOf('async function otherProgrammes'), builder.indexOf('function yearTaken'));
        assert.ok(fn.includes('try {'));
        assert.match(fn, /\} catch \(_\) \{\s+return \[\];/);
        assert.ok(fn.includes(".neq('program_id', OPTS.programId)"));
        assert.ok(fn.includes(".eq('is_active', true)"));
    });
    test('the file\'s claims are remembered when a scan finishes and forgotten on a new scan, a removed file, a save and a fresh mount', () => {
        assert.ok(builder.includes('SCAN_DOC = { year: data.academic_year ?? null, name: data.program_name ?? null };'));
        assert.ok(builder.split('SCAN_DOC = null;').length - 1 >= 4);
    });
    test('the dashboard tells the builder the programme\'s code and name', () => {
        const dash = read('features/department/departmentdashboard.js');
        assert.ok(dash.includes('programCode:  PROGRAM?.code ?? null,'));
        assert.ok(dash.includes('programName:  PROGRAM?.name ?? null,'));
    });
});

describe('how many subjects differ (21 Nov 2026: three codes read differently said "6 differ")', () => {
    test('three subjects that differ are three, not six', () => {
        const mine = set(55);
        const theirs = [...mine.slice(0, 52), s('X1'), s('X2'), s('X3')];
        assert.equal(S.compare(mine, theirs).differing, 3);
    });
    test('one extra subject is one, and a shorter list counts what it lacks', () => {
        const a = set(20);
        assert.equal(S.compare(a, [...a, s('EXTRA1')]).differing, 1);
        assert.equal(S.compare(a, a.slice(0, 17)).differing, 3);
    });
});
