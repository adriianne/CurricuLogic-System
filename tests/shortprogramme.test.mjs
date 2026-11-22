// shortprogramme.test.mjs
// A programme that is shorter than four years can be created (22 Nov 2026). The pre-flight demanded subjects in all four years, so the
// two-year ACT associate curriculum was refused: "III - Third Year has no subjects", "IV - Fourth Year has no subjects".
//
//   node --test tests/shortprogramme.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const builder = readFileSync(new URL('../features/department/curriculum-builder.js', import.meta.url), 'utf8');
const start = builder.indexOf('const lastYear = years.length');
const pf = builder.slice(start, builder.indexOf('for (const y of years) {', start));

describe('the check in the builder', () => {
    test('only the years the curriculum reaches are required', () => {
        assert.ok(pf.includes('const lastYear = years.length ? Math.max(...years) : 0;'));
        assert.ok(pf.includes('for (const y of [1, 2, 3, 4].filter(n => n <= lastYear)) {'));
        assert.ok(!builder.includes('    for (const y of [1, 2, 3, 4]) {\n        const missing'));
    });
    test('a missing year or semester inside the range is still a blocker, with the same words as before', () => {
        assert.ok(pf.includes('blockers.push(`${YEARS[y]} has no subjects.`);'));
        assert.ok(pf.includes('blockers.push(`${YEARS[y]} has no ${TERMS[missing[0]].toLowerCase()} subjects.`);'));
    });
    test('stopping short of four years is a warning, never a blocker, and reads in plain words', () => {
        const warn = pf.slice(pf.indexOf('if (lastYear >= 1 && lastYear < 4) {'));
        assert.ok(warn.includes('warnings.push('));
        assert.ok(!warn.includes('blockers.push'));
        assert.ok(warn.includes("const ordinal = { 2: '2nd', 3: '3rd' }[lastYear];"));
        assert.ok(warn.includes('If the programme runs longer, the later years are missing.'));
    });
});

describe('the rule, on plain data', () => {
    const check = (cells) => {
        const years = [1, 2, 3, 4].filter((y) => cells.some((c) => c.startsWith(`${y}.`)));
        const lastYear = years.length ? Math.max(...years) : 0;
        const blockers = []; const warnings = [];
        for (const y of [1, 2, 3, 4].filter((n) => n <= lastYear)) {
            const missing = [1, 2].filter((t) => !cells.includes(`${y}.${t}`));
            if (missing.length === 2) blockers.push(`year ${y} has no subjects`);
            else if (missing.length === 1) blockers.push(`year ${y} has no semester ${missing[0]}`);
        }
        if (lastYear >= 1 && lastYear < 4) warnings.push(`covers ${lastYear} year(s)`);
        return { blockers, warnings };
    };
    test('ACT: two years with both semesters each is fine, with one word about the length', () => {
        const r = check(['1.1', '1.2', '1.3', '2.1', '2.2']);
        assert.deepEqual(r.blockers, []);
        assert.equal(r.warnings.length, 1);
    });
    test('a four-year programme is unchanged: nothing to say when all four are there', () => {
        const all = [1, 2, 3, 4].flatMap((y) => [`${y}.1`, `${y}.2`]);
        assert.deepEqual(check(all), { blockers: [], warnings: [] });
    });
    test('a four-year programme missing its 4th year is not refused, but is warned about', () => {
        const r = check([1, 2, 3].flatMap((y) => [`${y}.1`, `${y}.2`]));
        assert.deepEqual(r.blockers, []);
        assert.equal(r.warnings.length, 1);
    });
    test('a gap before the last year is still refused', () => {
        assert.deepEqual(check(['1.1', '1.2', '3.1', '3.2']).blockers, ['year 2 has no subjects']);
    });
    test('a missing semester inside the range is still refused', () => {
        assert.deepEqual(check(['1.1', '1.2', '2.1']).blockers, ['year 2 has no semester 2']);
    });
    test('nothing at all adds no year errors (the "no subjects to save" error covers it)', () => {
        assert.deepEqual(check([]), { blockers: [], warnings: [] });
    });
});
