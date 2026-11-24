// prereqshorthand.test.mjs
// The BSHM prospectus (23 Nov 2026) prints "HM 111, 112, 113" in its Pre / Co-requisite column. The reader returned "HM 111", "112", "113";
// the bare numbers matched no subject and were dropped, so 6 prerequisite links were lost on 5 subjects. A bare number now takes the
// letters of the code before it, when that is a subject of the document. The same document lists HM 111 (same semester) beside HM 113 and
// HM ELECT 1: a link inside one semester can only mean "taken together", so it becomes a "goes with" link, listed on the check card.
//
//   node --test tests/prereqshorthand.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const PS = require('../shared/js/curriculum/prereqshorthand.js');
const SC = require('../shared/js/curriculum/subjectcode.js');
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

const CODES = ['HM 111', 'HM 112', 'HM 113', 'HM ELECT 1', 'HM 114', 'HM 311', 'HM 312', 'HM 314', 'CC-COMPROG11', 'CC-COMPROG12'];
const exists = (c) => CODES.some(x => SC.key(x) === SC.key(c));

describe('expand', () => {
    test('the BSHM case: HM 111, 112, 113 is three subjects', () => {
        const r = PS.expand(['HM 111', '112', '113'], exists);
        assert.deepEqual(r.codes, ['HM 111', 'HM 112', 'HM 113']);
        assert.deepEqual(r.expanded, [{ from: '112', to: 'HM 112' }, { from: '113', to: 'HM 113' }]);
    });
    test('HM 311, 312 and a single code with nothing to expand', () => {
        assert.deepEqual(PS.expand(['HM 311', '312'], exists).codes, ['HM 311', 'HM 312']);
        const same = PS.expand(['HM 111'], exists);
        assert.deepEqual(same.codes, ['HM 111']);
        assert.deepEqual(same.expanded, []);
    });
    test('a number is expanded only when that subject exists: nothing is guessed', () => {
        const r = PS.expand(['HM 111', '999'], exists);
        assert.deepEqual(r.codes, ['HM 111', '999']);
        assert.deepEqual(r.expanded, []);
    });
    test('a bare number with no code before it stays as it is', () => {
        assert.deepEqual(PS.expand(['112', 'HM 111'], exists).codes, ['112', 'HM 111']);
    });
    test('the prefix comes from the nearest full code, so two families in one list stay apart', () => {
        const rows = [...CODES, 'PE 101', 'PE 102'];
        const has = (c) => rows.some(x => SC.key(x) === SC.key(c));
        assert.deepEqual(PS.expand(['HM 111', '112', 'PE 101', '102'], has).codes, ['HM 111', 'HM 112', 'PE 101', 'PE 102']);
    });
    test('codes with a dash or a longer family name', () => {
        assert.deepEqual(PS.expand(['CC-COMPROG11', '12'], exists).codes, ['CC-COMPROG11', 'CC-COMPROG12']);
    });
    test('empty and odd input', () => {
        assert.deepEqual(PS.expand([], exists), { codes: [], expanded: [] });
        assert.deepEqual(PS.expand(null, exists), { codes: [], expanded: [] });
        assert.deepEqual(PS.expand(['', '  ', 'HM 111'], exists).codes, ['HM 111']);
        assert.deepEqual(PS.expand(['HM 111', '112'], undefined).codes, ['HM 111', '112']);   // no way to check: left alone
    });
});

describe('the scan, on the BSHM first-year rows (the rule the builder applies)', () => {
    const rows = [
        { code: 'HM 111', year: 1, term: 1, ai: [] },
        { code: 'HM 112', year: 1, term: 1, ai: [] },
        { code: 'HM 113', year: 1, term: 1, ai: ['HM 111'] },
        { code: 'HM ELECT 1', year: 1, term: 1, ai: ['HM 111'] },
        { code: 'HM 114', year: 1, term: 2, ai: ['HM 111', '112', '113'] },
    ];
    const byCode = new Map(rows.map(r => [SC.key(r.code), r]));
    const sameTerm = (a, b) => a.year != null && a.term != null && a.year === b.year && a.term === b.term;
    const links = (row) => {
        const out = [];
        for (const code of PS.expand(row.ai, (c) => byCode.has(SC.key(c))).codes) {
            const t = byCode.get(SC.key(code));
            if (t) out.push({ code: t.code, co: sameTerm(row, t) });
        }
        return out;
    };
    test('HM 114 keeps all three prerequisites, none of them a goes-with link', () => {
        assert.deepEqual(links(rows[4]), [
            { code: 'HM 111', co: false }, { code: 'HM 112', co: false }, { code: 'HM 113', co: false }]);
    });
    test('HM 113 and HM ELECT 1 take HM 111 as a goes-with link, not a prerequisite', () => {
        assert.deepEqual(links(rows[2]), [{ code: 'HM 111', co: true }]);
        assert.deepEqual(links(rows[3]), [{ code: 'HM 111', co: true }]);
    });
    test('a link to an EARLIER semester stays a prerequisite', () => {
        assert.equal(links(rows[4]).some(l => l.co), false);
    });
    test('a catalogue elective (no year, no term) never counts as the same semester', () => {
        assert.equal(sameTerm({ year: null, term: null }, { year: null, term: null }), false);
    });
});

describe('wiring in the builder', () => {
    const js = read('features/department/curriculum-builder.js');
    const html = read('features/department/departmentdashboard.html');
    test('the module loads before the builder', () => {
        const mod = html.indexOf('shared/js/curriculum/prereqshorthand.js');
        assert.ok(mod > 0);
        assert.ok(mod < html.indexOf('features/department/curriculum-builder.js') || mod < html.search(/curriculum-builder\.js/));
    });
    test('each row\'s prerequisite list is expanded before its codes are looked up', () => {
        assert.ok(js.includes('window.CurriculogicPrereqShorthand?.expand(row._aiPrereqCodes'));
        assert.ok(js.indexOf('CurriculogicPrereqShorthand?.expand') < js.indexOf('for (const prereqCode of row._aiPrereqCodes)'));
    });
    test('an expansion is listed on the check card, so it can be checked against the document', () => {
        assert.ok(js.includes('read as ${shorthand.expanded.map(e => e.to).join'));
    });
    test('a same-semester link becomes a goes-with link and is listed', () => {
        assert.ok(js.includes('const sameTerm = (a, b) => a.year != null && a.term != null && a.year === b.year && a.term === b.term;'));
        assert.ok(js.includes('row.prereqs.push({ uid: target.uid, co: true });'));
        assert.ok(js.includes('so it was read as a goes-with (co-requisite) link with'));
    });
    test('both places that add a link use it (the codes and the notes the reader kept apart)', () => {
        assert.ok(js.includes('linkTo(row, target, `"${prereqCode}"`)'));
        assert.ok(js.includes('for (const target of matched) linkTo(row, target'));
    });
    test('a link picked by hand in the same semester is still refused (the earlier-semester check is unchanged)', () => {
        assert.ok(js.includes('is not in an earlier semester, so it cannot be a prerequisite. Untick it in the prerequisite list.'));
        assert.ok(js.includes('if (!p.uid || p.co) continue;'));
    });
});
