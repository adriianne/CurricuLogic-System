// exactcopy.test.mjs
// The reader must copy codes and titles EXACTLY as printed, and the scan check must point at a code that disagrees with its own
// links (21 Nov 2026: the PDF prints "CS-DISCRET12"; a quicker model wrote the subject as "CC-DISCRET12" while its links said "CS-").
//
//   node --test tests/exactcopy.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const X = require('../shared/js/curriculum/extractioncheck.js');
const index = readFileSync(new URL('../supabase/functions/analyze-curriculum-document/index.ts', import.meta.url), 'utf8');
const prompt = index.slice(index.indexOf('const EXTRACTION_PROMPT = `'), index.indexOf('Do not invent subjects that are not clearly present in the document.`'));
const sub = (code, y, t, l = 3) => ({ code, title: code, year_level: y, term: t, lecture_units: l, laboratory_units: 0 });

describe('the prompt says to copy exactly and never to correct', () => {
    test('it has the rule, with the CS-/CC- example', () => {
        assert.ok(prompt.includes('IMPORTANT -- copy every code and title EXACTLY as printed:'));
        assert.ok(prompt.includes('"CS-DISCRET12" stays "CS-DISCRET12", never'));
        assert.ok(prompt.includes('"CC-DISCRET12" because other curricula use "CC-"'));
    });
    test('it forbids correcting, completing or normalising from what the model knows or from nearby codes', () => {
        assert.match(prompt, /Never correct, complete, normalise or "fix" a code or a title/);
        assert.match(prompt, /from what\s+you know of other curricula, from the pattern of nearby codes/);
    });
    test('it covers the subject\'s own code and the pre-requisites, and asks for a literal reading when unsure', () => {
        assert.match(prompt, /a subject's own code exactly as printed in its own row/);
        assert.match(prompt, /exactly as printed in that row's own pre-requisite cell/);
        assert.match(prompt, /best LITERAL reading of the printed characters/);
    });
    test('the rule sits before the unit-reading rules, near the top where it is read first', () => {
        assert.ok(prompt.indexOf('copy every code and title EXACTLY') < prompt.indexOf('reading lecture_units vs laboratory_units'));
        assert.ok(prompt.indexOf('copy every code and title EXACTLY') > prompt.indexOf('exhaustiveness is required'));
    });
    test('the prompt is still a template string with the JSON shape intact', () => {
        assert.ok(prompt.includes('Respond with ONLY valid JSON'));
        assert.ok(prompt.includes('"printed_totals"'));
        assert.equal((prompt.match(/`/g) || []).length, 1, 'a stray backtick would end the template early');
    });
});

describe('the scan check points at a code that disagrees with its own links', () => {
    const subs = [sub('CC-DISCRET12', 1, 2), sub('CS-DISCRET21', 2, 1), sub('CS-DIFFCAL21', 2, 1)];
    const link = (from, to) => `${from}: prerequisite "${to}" is not a subject in this document`;

    test('a link to "CS-DISCRET12" when the subject reads "CC-DISCRET12" says which codes to compare with the PDF', () => {
        const r = X.overview(subs, {}, { followUps: [link('CS-DISCRET21', 'CS-DISCRET12')] });
        const item = r.checks.find((c) => /not in this document/.test(c.title)).items[0];
        assert.match(item, /prerequisite "CS-DISCRET12" is not a subject in this document/);
        assert.match(item, /may print the subject as "CS-DISCRET12", not "CC-DISCRET12": compare that code with the PDF\./);
    });
    test('every link to it is explained the same way', () => {
        const r = X.overview(subs, {}, { followUps: [link('CS-DISCRET21', 'CS-DISCRET12'), link('CS-DIFFCAL21', 'CS-DISCRET12')] });
        const items = r.checks.find((c) => /not in this document/.test(c.title)).items;
        assert.equal(items.length, 2);
        assert.ok(items.every((t) => t.includes('compare that code with the PDF')));
    });
    test('a link to a code that matches no subject at all gets no guess', () => {
        const r = X.overview(subs, {}, { followUps: [link('CS-DISCRET21', 'ZZZ99')] });
        const item = r.checks.find((c) => /not in this document/.test(c.title)).items[0];
        assert.ok(!item.includes('compare that code'));
    });
    test('a link that already matches a subject is not flagged at all', () => {
        const r = X.overview(subs, {}, { prereqLinks: 2, followUps: [] });
        assert.ok(!r.checks.some((c) => /not in this document/.test(c.title)));
    });
    test('the text says "may" and "compare": it never claims which reading is right', () => {
        const r = X.overview(subs, {}, { followUps: [link('CS-DISCRET21', 'CS-DISCRET12')] });
        const item = r.checks.find((c) => /not in this document/.test(c.title)).items[0];
        assert.match(item, /may print/);
        assert.doesNotMatch(item, /is wrong|misread/);
    });
    test('codes that differ by more than the prefix are not paired', () => {
        const r = X.overview([sub('CC-DISCRET12', 1, 2)], {}, { followUps: [link('A', 'CS-DISCRET13')] });
        assert.ok(!r.checks.find((c) => /not in this document/.test(c.title)).items[0].includes('compare that code'));
    });
});
