// extractioncheck.test.mjs
// The check that compares the subjects the curriculum reader returned with the totals the document prints.
//   node --test tests/extractioncheck.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const X = require('../shared/js/curriculum/extractioncheck.js');

const sub = (code, y, t, lec, lab = 0, title = code) => ({ code, title, year_level: y, term: t, lecture_units: lec, laboratory_units: lab });

describe('a reading that matches what the document prints', () => {
    const subjects = [sub('A', 1, 1, 3), sub('B', 1, 1, 2, 1), sub('C', 1, 2, 3), sub('D', 3, 3, 3), sub('E', 3, 3, 3)];
    const printed = { grand_total_units: 15, blocks: [
        { year_level: 1, term: 1, total_units: 6 }, { year_level: 1, term: 2, total_units: 3 }, { year_level: 3, term: 3, total_units: 6 }] };
    test('gives no warning and says the totals were checked', () => {
        const r = X.check(subjects, printed);
        assert.deepEqual(r.warnings, []);
        assert.equal(r.checked, true);
        assert.equal(r.actualTotal, 15);
    });
});

describe('a missing block (the 17 Nov 2026 case: a summer term of 6 units)', () => {
    const subjects = [sub('A', 3, 1, 3), sub('B', 3, 2, 3)];
    const printed = { grand_total_units: 12, blocks: [
        { year_level: 3, term: 1, total_units: 3 }, { year_level: 3, term: 2, total_units: 3 }, { year_level: 3, term: 3, total_units: 6 }] };
    test('is flagged against the grand total and against the block itself', () => {
        const r = X.check(subjects, printed);
        assert.equal(r.warnings.length, 2);
        assert.match(r.warnings[0], /add up to 6 units, but the document's total is 12 \(6 units short\)/);
        assert.match(r.warnings[0], /summer term/);
        assert.match(r.warnings[1], /3rd year, summer.*no subjects were found there.*may be missing/);
    });
});

describe('a block that is off by a few units', () => {
    test('names the block and both numbers', () => {
        const r = X.check([sub('A', 2, 1, 3), sub('B', 2, 1, 3)], { grand_total_units: null, blocks: [{ year_level: 2, term: 1, total_units: 9 }] });
        assert.equal(r.warnings.length, 1);
        assert.match(r.warnings[0], /2nd year, 1st semester adds up to 6 units, but the document prints 9/);
    });
    test('too many units is said as "over"', () => {
        const r = X.check([sub('A', 1, 1, 3), sub('B', 1, 1, 3)], { grand_total_units: 3, blocks: [] });
        assert.match(r.warnings[0], /3 units over/);
    });
    test('one unit is singular', () => {
        const r = X.check([sub('A', 1, 1, 2)], { grand_total_units: 3, blocks: [] });
        assert.match(r.warnings[0], /1 unit short/);
    });
});

describe('lecture and laboratory units are both counted, and electives with no year are not', () => {
    test('2 lecture + 1 lab is 3; a catalogue elective adds nothing to the total', () => {
        const subjects = [sub('A', 1, 1, 2, 1), { code: 'EL1', title: 'PHP', year_level: null, term: null, lecture_units: 3, laboratory_units: 0 }];
        const r = X.check(subjects, { grand_total_units: 3, blocks: [] });
        assert.deepEqual(r.warnings, []);
        assert.equal(r.actualTotal, 3);
    });
    test('a lab-only practicum of 6 units counts as 6', () => {
        const r = X.check([sub('P', 4, 2, 0, 6)], { grand_total_units: 6, blocks: [] });
        assert.deepEqual(r.warnings, []);
    });
});

describe('a document that prints no totals', () => {
    test('is not checked, and says nothing wrong about the rows', () => {
        for (const p of [undefined, null, {}, { grand_total_units: null, blocks: [] }, 'nonsense', { grand_total_units: 'n/a', blocks: 'x' }]) {
            const r = X.check([sub('A', 1, 1, 3)], p);
            assert.equal(r.checked, false, JSON.stringify(p));
            assert.deepEqual(r.warnings, []);
        }
    });
    test('a total of 0 or a silly one is ignored, not compared', () => {
        for (const g of [0, -5, 99999]) assert.equal(X.check([sub('A', 1, 1, 3)], { grand_total_units: g, blocks: [] }).checked, false);
    });
});

describe('what the reader sends is never trusted blindly', () => {
    test('a block with a missing or non-numeric field is skipped', () => {
        const r = X.check([sub('A', 1, 1, 3)], { blocks: [{ year_level: 'x', term: 1, total_units: 3 }, { year_level: 1, term: 1 }, null, { year_level: 1, term: 1, total_units: 'many' }] });
        assert.equal(r.checked, false);
        assert.deepEqual(r.warnings, []);
    });
    test('the same block reported twice counts once', () => {
        const r = X.check([sub('A', 1, 1, 3)], { blocks: [{ year_level: 1, term: 1, total_units: 9 }, { year_level: 1, term: 1, total_units: 9 }] });
        assert.equal(r.warnings.length, 1);
    });
    test('numbers sent as strings are understood', () => {
        const r = X.check([sub('A', 1, 1, 3)], { grand_total_units: '3', blocks: [{ year_level: '1', term: '1', total_units: '3' }] });
        assert.deepEqual(r.warnings, []);
        assert.equal(r.checked, true);
    });
    test('no subjects at all does not crash', () => {
        assert.doesNotThrow(() => X.check(undefined, { grand_total_units: 10, blocks: [] }));
        assert.match(X.check([], { grand_total_units: 10, blocks: [] }).warnings[0], /add up to 0 units/);
    });
});

describe('repeated codes', () => {
    test('the same real code twice is flagged', () => {
        const r = X.check([sub('MATH 101', 1, 1, 3), sub('math  101', 1, 2, 3)], {});
        assert.equal(r.warnings.length, 1);
        assert.match(r.warnings[0], /MATH 101 appears 2 times/);
    });
    test('elective placeholders (IT Elective 1, Free Elective 2) may repeat their code', () => {
        const r = X.check([
            { code: 'IT-EL', title: 'IT Elective 1', year_level: 3, term: 1, lecture_units: 2, laboratory_units: 1 },
            { code: 'IT-EL', title: 'IT Elective 2', year_level: 3, term: 2, lecture_units: 2, laboratory_units: 1 },
            { code: 'IT-FRE', title: 'Free Elective 1', year_level: 3, term: 1, lecture_units: 3, laboratory_units: 0 },
            { code: 'IT-FRE', title: 'Free Elective 2', year_level: 3, term: 1, lecture_units: 3, laboratory_units: 0 }], {});
        assert.deepEqual(r.warnings, []);
    });
});

describe('labels', () => {
    test('read the way a person says them', () => {
        assert.equal(X.label(3, 3), '3rd year, summer');
        assert.equal(X.label(1, 2), '1st year, 2nd semester');
        assert.equal(X.label(7, 9), 'year 7, term 9');
    });
});

// ---- the pieces around it: the reader's instructions, the page and its styles ----
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

describe('the reader is asked for the printed totals', () => {
    const src = read('supabase/functions/analyze-curriculum-document/index.ts');
    const start = src.indexOf('const EXTRACTION_PROMPT = `');
    const prompt = src.slice(start, src.indexOf('`;', start));
    test('has an instruction that says to report them as printed and never to compute them', () => {
        assert.match(prompt, /IMPORTANT -- the totals the document prints/);
        assert.match(prompt, /NEVER add them up yourself/);
    });
    test('has the printed_totals object in the JSON shape, before the subjects', () => {
        const shape = prompt.slice(prompt.indexOf('Respond with ONLY valid JSON'));
        assert.ok(shape.indexOf('"printed_totals"') > 0 && shape.indexOf('"printed_totals"') < shape.indexOf('"subjects"'));
        for (const key of ['"grand_total_units"', '"blocks"', '"year_level"', '"term"', '"total_units"']) assert.ok(shape.includes(key), key);
    });
});

describe('the curriculum page shows the result', () => {
    const js = read('features/department/curriculum-builder.js');
    const html = read('features/department/departmentdashboard.html');
    const css = read('shared/css/dashboard.css');
    test('loads the check before the builder', () => {
        assert.ok(html.includes('shared/js/curriculum/extractioncheck.js'));
        assert.ok(html.indexOf('extractioncheck.js') < html.indexOf('curriculum-builder.js'));
    });
    test('runs it on the reader\u2019s raw answer and passes the printed totals', () => {
        assert.match(js, /CurriculogicExtractionCheck\?\.check\(extracted, data\.printed_totals\)/);
    });
    test('says so in three cases: a mismatch, a match, and no totals to compare', () => {
        assert.match(js, /The totals do not match the document/);
        assert.match(js, /units match the totals printed in the document/);
        assert.match(js, /The document prints no totals, so the units could not be checked/);
    });
    test('a mismatch uses a warning style, and the list of details accepts several boxes', () => {
        assert.match(js, /selfCheck\.warnings\.length \? 'warning' : 'success'/);
        assert.match(js, /for \(const d of \[\]\.concat\(details \?\? \[\]\)\)/);
        assert.match(css, /\.msg\.warning\s*\{[^}]*#fffbeb/);
        assert.match(css, /html\[data-theme="dark"\] \.msg\.warning/);
    });
    test('the check never blocks saving: it only warns', () => {
        const block = js.slice(js.indexOf('const selfCheck'), js.indexOf('showAiStatus(', js.indexOf('const selfCheck')));
        assert.doesNotMatch(block, /return;|throw|disabled/);
    });
});
