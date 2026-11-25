// sentplan.test.mjs
// The "you already sent a plan this term" question before a second request (shared/js/enrolment/sentplan.js).
//
//   node --test tests/sentplan.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { countThisTerm, secondRequestNote } = require('../shared/js/enrolment/sentplan.js');

const req = (term, year, ...statuses) => ({ requested_term: term, requested_year: year, request_item: statuses.map((status) => ({ status })) });

describe('countThisTerm', () => {
    test('nothing sent this term counts as nothing', () => {
        assert.deepEqual(countThisTerm([], 2, 2024), { requests: 0, subjects: 0 });
        assert.deepEqual(countThisTerm(undefined, 2, 2024), { requests: 0, subjects: 0 });
    });
    test('waiting and approved subjects of this term count', () => {
        const r = countThisTerm([req(2, 2024, 'approved', 'approved', 'valid', 'flagged', 'approved')], 2, 2024);
        assert.deepEqual(r, { requests: 1, subjects: 5 });
    });
    test('a subject sent back does not count, so resending it is not a second request', () => {
        assert.deepEqual(countThisTerm([req(2, 2024, 'rejected', 'rejected')], 2, 2024), { requests: 0, subjects: 0 });
        assert.deepEqual(countThisTerm([req(2, 2024, 'approved', 'rejected')], 2, 2024), { requests: 1, subjects: 1 });
    });
    test('another term or another school year does not count', () => {
        assert.equal(countThisTerm([req(1, 2024, 'approved')], 2, 2024).subjects, 0);
        assert.equal(countThisTerm([req(2, 2023, 'approved')], 2, 2024).subjects, 0);
    });
    test('two requests in the term add up', () => {
        assert.deepEqual(countThisTerm([req(2, 2024, 'approved', 'approved'), req(2, 2024, 'valid')], 2, 2024), { requests: 2, subjects: 3 });
    });
    test('the term and year may arrive as text', () => {
        assert.equal(countThisTerm([req('2', '2024', 'approved')], 2, 2024).subjects, 1);
    });
});

describe('secondRequestNote', () => {
    test('says how many subjects were sent, and that a second request has its own form', () => {
        const t = secondRequestNote(5);
        assert.match(t, /already sent 5 subjects/);
        assert.match(t, /second request/);
        assert.match(t, /its own enrolment form/);
        assert.match(t, /Send them anyway\?$/);
    });
    test('one subject is singular', () => {
        assert.match(secondRequestNote(1), /already sent 1 subject to/);
    });
});

describe('the Build your plan page asks before a second request', () => {
    const page = readFileSync(new URL('../features/student/studentdashboard.js', import.meta.url), 'utf8');
    const html = readFileSync(new URL('../features/student/studentdashboard.html', import.meta.url), 'utf8');
    test('the Submit button goes through the question, not straight to the send', () => {
        assert.match(page, /\$\('req-submit'\)\?\.addEventListener\('click', onSubmitClick\)/);
        assert.match(page, /async function onSubmitClick\(\)/);
        assert.match(page, /CurriculogicSentPlan\?\.countThisTerm\(MY_REQUESTS, CURRENT_TERM, CURRENT_YEAR\)/);
        assert.match(page, /window\.confirm\(window\.CurriculogicSentPlan\.secondRequestNote\(sent\.subjects\)\)/);
    });
    test('the helper is loaded by the page', () => {
        assert.match(html, /shared\/js\/enrolment\/sentplan\.js/);
    });
});
