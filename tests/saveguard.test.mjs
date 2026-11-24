// saveguard.test.mjs
// 24 Nov 2026: the Criminology prospectus was saved into BSHM twice in one morning (the second time published and active, replacing the
// hospitality curriculum), and a version was saved with no year at all. The page only warned about a file for another programme, and a click
// went through. Now a file with NOTHING in common with the programme, and a curriculum with no year, are refused, at the pre-flight and again at
// the moment of saving, for both Create and Save (unpublished).
//
//   node --test tests/saveguard.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const S = require('../shared/js/curriculum/samecurriculum.js');
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

// the programmes as saved on 24 Nov 2026, and the name each prospectus prints for itself
const PROGRAMMES = {
    ACT:    { code: 'ACT',    name: 'Associate in Computer Technology (Applications Development)', printed: 'Associate in Computer Technology' },
    BSA:    { code: 'BSA',    name: 'Bachelor of Science in Accountancy', printed: 'Bachelor of Science in Accountancy' },
    BSBA:   { code: 'BSBA',   name: 'Bachelor of Science in Business Administration', printed: 'Bachelor of Science in Business Administration' },
    BSCRIM: { code: 'BSCRIM', name: 'Bachelor of Science in Criminology', printed: 'Bachelor of Science in Criminology (BSCRIM)' },
    BSCS:   { code: 'BSCS',   name: 'Bachelor of Science in Computer Science', printed: 'Bachelor of Science in Computer Science' },
    BSCSAI: { code: 'BSCSAI', name: 'Bachelor of Science in Computer Science (Artificial Intelligence)', printed: 'Bachelor of Science in Computer Science (Artificial Intelligence)' },
    BSHM:   { code: 'BSHM',   name: 'Bachelor of Science in Hospitality Management', printed: 'Bachelor of Science in Hospitality Management (BSHM)' },
    BSIT:   { code: 'BSIT',   name: 'Bachelor of Science in Information Technology', printed: 'BS Information Technology' },
};
const prog = (k) => ({ code: PROGRAMMES[k].code, name: PROGRAMMES[k].name });

describe('programmeClash: a file for another programme', () => {
    test('the 24 Nov case: Criminology read into BSHM is a clash', () => {
        assert.equal(S.programmeClash(PROGRAMMES.BSCRIM.printed, prog('BSHM')), true);
    });
    test('and the other way round: hospitality into Criminology', () => {
        assert.equal(S.programmeClash(PROGRAMMES.BSHM.printed, prog('BSCRIM')), true);
    });
    test('every programme\'s own file is NEVER a clash with its own programme (a false stop would block a real save)', () => {
        for (const [k, p] of Object.entries(PROGRAMMES)) {
            assert.equal(S.programmeClash(p.printed, prog(k)), false, `${k} against its own prospectus`);
        }
    });
    test('the same, in capitals and with the code only', () => {
        assert.equal(S.programmeClash('BACHELOR OF SCIENCE IN CRIMINOLOGY', prog('BSCRIM')), false);
        assert.equal(S.programmeClash('BSCRIM curriculum, effective 2018', prog('BSCRIM')), false);
    });
    test('files of different programmes with nothing in common clash across the board', () => {
        const pairs = [['BSIT', 'BSCRIM'], ['BSHM', 'BSA'], ['BSCRIM', 'BSBA'], ['BSIT', 'BSHM'], ['ACT', 'BSHM']];
        for (const [file, into] of pairs) {
            assert.equal(S.programmeClash(PROGRAMMES[file].printed, prog(into)), true, `${file} file into ${into}`);
        }
    });
    test('names that share some words (Computer Science, with and without AI) are NOT a clash: they stay a warning', () => {
        assert.equal(S.programmeClash(PROGRAMMES.BSCS.printed, prog('BSCSAI')), false);
        assert.equal(S.programmeClash(PROGRAMMES.BSCSAI.printed, prog('BSCS')), false);
        assert.equal(S.programmeFit(PROGRAMMES.BSCS.printed, prog('BSCSAI')).fits, false);   // still reported, as a warning
    });
    test('a file that prints only an abbreviation is not judged (it shares no word with the full name by nature)', () => {
        assert.equal(S.programmeClash('BSCS-AI', prog('BSCSAI')), false);
        assert.equal(S.programmeClash('BS IT', prog('BSIT')), false);
        assert.equal(S.programmeClash('BSHM', prog('BSCRIM')), false);         // too little to call it: the row checks still run
    });
    test('nothing to compare, nothing said: no printed name, or no programme name', () => {
        assert.equal(S.programmeClash('', prog('BSHM')), false);
        assert.equal(S.programmeClash(null, prog('BSHM')), false);
        assert.equal(S.programmeClash('Bachelor of Science in Criminology', {}), false);
        assert.equal(S.programmeClash('Bachelor of Science in Criminology', null), false);
    });
});

describe('saveGuard', () => {
    test('a file for another programme is refused, and the sentence says why and what to do', () => {
        const out = S.saveGuard({ hasVersion: true, year: 2019, printedName: PROGRAMMES.BSCRIM.printed, program: prog('BSHM') });
        assert.equal(out.length, 1);
        assert.match(out[0], /This file is for “Bachelor of Science in Criminology \(BSCRIM\)”/);
        assert.match(out[0], /nothing in common with BSHM Bachelor of Science in Hospitality Management/);
        assert.match(out[0], /sign in with that programme’s Department account/);
        assert.match(out[0], /Nothing was saved\.$/);
    });
    test('no curriculum year (and no version open yet) is refused', () => {
        const out = S.saveGuard({ hasVersion: false, year: null, printedName: '', program: prog('BSHM') });
        assert.deepEqual(out, ['Choose the curriculum year first. A curriculum cannot be saved without a year.']);
    });
    test('an open version already has its year, so the year is not asked again', () => {
        assert.deepEqual(S.saveGuard({ hasVersion: true, year: null, printedName: '', program: prog('BSHM') }), []);
    });
    test('a chosen year with no version yet is fine', () => {
        assert.deepEqual(S.saveGuard({ hasVersion: false, year: 2019, printedName: PROGRAMMES.BSHM.printed, program: prog('BSHM') }), []);
        assert.deepEqual(S.saveGuard({ hasVersion: false, year: '2019', printedName: '', program: prog('BSHM') }), []);
    });
    test('a nonsense year is no year', () => {
        for (const year of [0, '', 'abc', NaN, 12, undefined]) {
            assert.equal(S.saveGuard({ hasVersion: false, year, program: prog('BSHM') }).length, 1, String(year));
        }
    });
    test('both problems at once give both sentences', () => {
        const out = S.saveGuard({ hasVersion: false, year: null, printedName: PROGRAMMES.BSCRIM.printed, program: prog('BSHM') });
        assert.equal(out.length, 2);
    });
    test('a matching file with a year passes, for every programme', () => {
        for (const [k, p] of Object.entries(PROGRAMMES)) {
            assert.deepEqual(S.saveGuard({ hasVersion: false, year: 2024, printedName: p.printed, program: prog(k) }), [], k);
        }
    });
    test('no arguments at all does not throw', () => {
        assert.doesNotThrow(() => S.saveGuard());
        assert.equal(S.saveGuard().length, 1);        // no year
    });
});

describe('wiring in the builder', () => {
    const js = read('features/department/curriculum-builder.js');
    const between = (a, b) => js.slice(js.indexOf(a), js.indexOf(b, js.indexOf(a)));

    test('saveProblems asks the guard with the page\'s own state', () => {
        const fn = between('function saveProblems() {', 'function preflight(');
        for (const part of ['hasVersion: !!OPTS.prospectusId', 'year: SELECTED_YEAR', "printedName: SCAN_DOC?.name ?? ''", 'program: { code: OPTS.programCode, name: OPTS.programName }']) {
            assert.ok(fn.includes(part), part);
        }
    });
    test('the pre-flight turns them into blockers, so the dialog has no Create button', () => {
        const pre = between('function preflight(', 'function confirmCreate(');
        assert.ok(pre.includes('blockers.push(...saveProblems());'));
        assert.ok(pre.indexOf('blockers.push(...saveProblems());') < pre.indexOf('const years = [1, 2, 3, 4]'));
    });
    test('the old warning remains for close names only, so there is no double message', () => {
        const pre = between('function preflight(', 'function confirmCreate(');
        assert.ok(pre.includes('!SAME.programmeClash(SCAN_DOC.name'));
    });
    test('the moment of saving checks again, for Create and for Save (unpublished)', () => {
        const commit = between('async function commitRows() {', 'const btn = MOUNT.querySelector');
        assert.ok(commit.includes('const stopped = saveProblems();'));
        assert.ok(commit.includes("setSaveNote('warn', stopped[0], 30000); return;"));
        const draft = between('async function saveDraft() {', 'const rowsToSave');
        assert.ok(draft.length > 0);
        const draftFull = between('async function saveDraft() {', 'STEP 1');
        assert.ok(draftFull.includes('const stopped = saveProblems();'));
        assert.ok(draftFull.includes('return OPTS.onError?.(stopped[0]);'));
    });
    test('the guard runs before anything is inserted', () => {
        const commit = between('async function commitRows() {', "from('prospectus')");
        assert.ok(commit.includes('saveProblems()'));
        const draftFull = between('async function saveDraft() {', "from('prospectus')");
        assert.ok(draftFull.includes('saveProblems()'));
    });
    test('the page still loads the module that holds the guard before the builder', () => {
        const html = read('features/department/departmentdashboard.html');
        assert.ok(html.indexOf('shared/js/curriculum/samecurriculum.js') > 0);
        assert.ok(html.indexOf('shared/js/curriculum/samecurriculum.js') < html.search(/curriculum-builder\.js/));
    });
});
