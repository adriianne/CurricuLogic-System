// alternativetotals.test.mjs
// 23 Nov 2026: the BSHM prospectus prints TWO programme totals: "Total Units for ABM Track: 165" and "Total Units for non-ABM Academic
// Track (15 units): 180". The reader kept one (180), and the check card said "15 units short" about a reading that is exactly right for
// the ABM track. The reader now reports every printed programme total, and the check and the server-side judge accept a match with ANY one.
//
//   node --test tests/alternativetotals.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { judge, totalsMatch, linksResolve, grandTotalsOf } from '../supabase/functions/_shared/curriculumjudge.mjs';

const require = createRequire(import.meta.url);
const EC = require('../shared/js/curriculum/extractioncheck.js');
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

/* subjects adding up to `total` units in one block (1st year, 1st semester) */
const subjectsOf = (total) => Array.from({ length: total / 3 }, (_, i) => ({
    year_level: 1, term: 1, code: `S${i}`, title: `Subject ${i}`, lecture_units: 3, laboratory_units: 0, prerequisites: [], corequisites: [],
}));
const BOTH = { grand_total_units: 180, other_grand_totals: [{ label: 'ABM Track', total_units: 165 }], blocks: [] };

describe('the check card', () => {
    test('165 units against "180 and ABM Track 165": it matches, and the card says which and by how much the other differs', () => {
        const o = EC.overview(subjectsOf(165), BOTH, {});
        const c = o.checks.find((x) => x.title === 'Units match the document');
        assert.ok(c, 'expected a match');
        assert.equal(c.status, 'ok');
        assert.match(c.detail, /add up to 165 units, the ABM Track total/);
        assert.match(c.detail, /180, 15 units more/);
    });
    test('the main total can be the one that matches, the label belongs to the other', () => {
        const o = EC.overview(subjectsOf(180), BOTH, {});
        const c = o.checks.find((x) => x.title === 'Units match the document');
        assert.equal(c.status, 'ok');
        assert.match(c.detail, /165 \(ABM Track\), 15 units fewer/);
    });
    test('a reading that matches NEITHER is still a warning, and names both totals', () => {
        const o = EC.overview(subjectsOf(171), BOTH, {});
        const c = o.checks.find((x) => x.title === 'Units do not match the document');
        assert.equal(c.status, 'warn');
        assert.match(c.detail, /document prints 180/);
        assert.match(c.detail, /it also prints 165/);
    });
    test('one printed total behaves exactly as before', () => {
        const one = { grand_total_units: 165, blocks: [] };
        const ok = EC.overview(subjectsOf(165), one, {}).checks.find((x) => x.title === 'Units match the document');
        assert.equal(ok.detail, 'The subjects add up to 165 of the 165 units the document prints.');
        const bad = EC.overview(subjectsOf(150), one, {}).checks.find((x) => x.title === 'Units do not match the document');
        assert.equal(bad.detail, 'The subjects add up to 150 units; the document prints 165 (15 units short).');
    });
    test('the same total printed twice counts once, and junk entries are ignored', () => {
        const odd = { grand_total_units: 165, other_grand_totals: [{ label: 'again', total_units: 165 }, { label: 'x', total_units: 'abc' }, null, {}], blocks: [] };
        const c = EC.overview(subjectsOf(165), odd, {}).checks.find((x) => x.title === 'Units match the document');
        assert.equal(c.detail, 'The subjects add up to 165 of the 165 units the document prints.');
    });
    test('check() (the warnings under the upload) accepts either total, and a miss names the other', () => {
        assert.deepEqual(EC.check(subjectsOf(165), BOTH).warnings, []);
        const miss = EC.check(subjectsOf(171), BOTH).warnings.join(' ');
        assert.match(miss, /document's total is 180/);
        assert.match(miss, /it also prints 165/);
    });
});

describe('the server-side judge', () => {
    const answer = (subjects, printed) => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ is_curriculum_document: true, printed_totals: printed, subjects }) }] } }] });
    test('grandTotalsOf lists the main total and the others, once each', () => {
        assert.deepEqual(grandTotalsOf(BOTH), [180, 165]);
        assert.deepEqual(grandTotalsOf({ grand_total_units: 165 }), [165]);
        assert.deepEqual(grandTotalsOf({ other_grand_totals: [{ total_units: 165 }, { total_units: 165 }] }), [165]);
        assert.deepEqual(grandTotalsOf(null), []);
    });
    test('an answer that adds up to the OTHER printed total is "good"', () => {
        assert.equal(totalsMatch({ printed_totals: BOTH, subjects: subjectsOf(165) }), true);
        assert.equal(judge(answer(subjectsOf(165), BOTH)), 'good');
    });
    test('an answer that adds up to neither is only "usable"', () => {
        assert.equal(totalsMatch({ printed_totals: BOTH, subjects: subjectsOf(171) }), false);
        assert.equal(judge(answer(subjectsOf(171), BOTH)), 'usable');
    });
    test('a document with one total is judged as before', () => {
        assert.equal(judge(answer(subjectsOf(165), { grand_total_units: 165, blocks: [] })), 'good');
        assert.equal(judge(answer(subjectsOf(150), { grand_total_units: 165, blocks: [] })), 'usable');
    });
});

describe('shorthand prerequisites are not broken links for the judge', () => {
    const subs = [
        { code: 'HM 111' }, { code: 'HM 112' }, { code: 'HM 113' },
        { code: 'HM 114', prerequisites: ['HM 111', '112', '113'] },
    ];
    test('"HM 111, 112, 113" resolves', () => {
        assert.equal(linksResolve({ subjects: subs }), true);
    });
    test('a bare number with no such subject is still a broken link', () => {
        assert.equal(linksResolve({ subjects: [...subs.slice(0, 3), { code: 'X 1', prerequisites: ['HM 111', '999'] }] }), false);
    });
    test('a bare number with nothing before it is still a broken link', () => {
        assert.equal(linksResolve({ subjects: [...subs.slice(0, 3), { code: 'X 1', prerequisites: ['112'] }] }), false);
    });
    test('other codes are judged as before', () => {
        assert.equal(linksResolve({ subjects: [{ code: 'A 1' }, { code: 'B 1', prerequisites: ['A 1'] }] }), true);
        assert.equal(linksResolve({ subjects: [{ code: 'B 1', prerequisites: ['A 1'] }] }), false);
    });
});

describe('the reader\'s instructions', () => {
    const src = read('supabase/functions/analyze-curriculum-document/index.ts');
    test('ask for every printed programme total, with its label', () => {
        assert.ok(src.includes('"other_grand_totals": [ { "label": "string as printed'));
        assert.ok(src.includes('Report every programme total that is printed'));
        assert.ok(src.includes('When\nthe document prints only one programme total, "other_grand_totals" is an empty array.')
            || src.includes('prints only one programme total, "other_grand_totals" is an empty array.'));
    });
    test('the field is optional: an answer without it is read as before', () => {
        assert.deepEqual(grandTotalsOf({ grand_total_units: 176, blocks: [] }), [176]);
    });
});
