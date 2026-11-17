// curriculumreader-prompt.test.mjs
// The instructions the curriculum reader sends to the AI (supabase/functions/analyze-curriculum-document/index.ts).
// A live test on 16 Nov 2026 showed the two elective boxes printed side by side being mixed up: 9 of 25 elective
// rows came back with a pre-requisite taken from the wrong row or the wrong box. The prompt now says how to read them.
//   node --test tests/curriculumreader-prompt.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../supabase/functions/analyze-curriculum-document/index.ts', import.meta.url), 'utf8');
const start = src.indexOf('const EXTRACTION_PROMPT = `');
const prompt = src.slice(start, src.indexOf('`;', start));

describe('the elective boxes are read row by row', () => {
    test('says the two lists sit side by side and are read on their own', () => {
        assert.match(prompt, /SIDE BY SIDE/);
        assert.match(prompt, /Read each list on\s+its own, one row at a time/);
    });
    test("a row's pre-requisite is its own cell, never a neighbour's", () => {
        assert.match(prompt, /only the text in that row's OWN pre-requisite cell/);
        assert.match(prompt, /Never take a pre-requisite from the list beside it/);
    });
    test('a footnote mark is not a code: it goes in footnote_marker and leaves prerequisites empty', () => {
        assert.match(prompt, /only a footnote\s+mark such as \*\* or \*\*\*: then "prerequisites" is an empty array/);
        assert.match(prompt, /"footnote_marker" holds that mark/);
    });
    test('an elective that names another elective keeps it as a code', () => {
        assert.match(prompt, /names another elective \(for example ELPHP1\)/);
    });
    test('asks for a second pass over the rows', () => {
        assert.match(prompt, /go through the elective rows once more/);
    });
});

describe('summer terms are not skipped', () => {
    test('describes the SUMMER block and says it is term 3 of the year it follows', () => {
        assert.match(prompt, /IMPORTANT -- summer terms/);
        assert.match(prompt, /"term": 3/);
        assert.match(prompt, /summer printed after THIRD YEAR and\s+before FOURTH YEAR has "year_level": 3/);
    });
    test('forbids skipping it, merging it into the second semester or moving it to the next year', () => {
        assert.match(prompt, /Do not skip it, do not merge it into the second semester and do not move\s+it into the following year/);
    });
    test('asks for the printed totals to be added up against the rows', () => {
        assert.match(prompt, /add up the printed "Total" line of every block/);
    });
});

describe('nothing else in the prompt was lost', () => {
    test('the earlier rules are all still there', () => {
        for (const part of ['exhaustiveness is required', 'reading lecture_units vs laboratory_units', 'footnote marks',
            'pre-requisites that are not subject codes', 'co-requisites', 'kind of course', 'elective course lists', 'summer terms',
            'Respond with ONLY valid JSON']) {
            assert.ok(prompt.includes(part), part);
        }
    });
    test('the JSON shape is unchanged', () => {
        for (const key of ['is_curriculum_document', 'rejection_reason', 'program_name', 'academic_year', 'footnotes', 'subjects',
            'year_level', 'term', 'lecture_units', 'laboratory_units', 'prerequisites', 'prerequisite_notes', 'corequisites',
            'footnote_marker', 'category', 'elective_type']) {
            assert.ok(prompt.includes(`"${key}"`), key);
        }
    });
    test('has no template-literal hole that would break the string', () => {
        assert.ok(!prompt.slice('const EXTRACTION_PROMPT = `'.length).includes('${'));
    });
});
