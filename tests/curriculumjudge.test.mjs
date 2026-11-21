// curriculumjudge.test.mjs
// What an AI answer is worth to the curriculum reader (supabase/functions/_shared/curriculumjudge.mjs), and how the reader
// is wired to use it with the hedged call. 21 Nov 2026.
//
//   node --test tests/curriculumjudge.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { judge, totalsMatch, unitsOf, linksResolve } from '../supabase/functions/_shared/curriculumjudge.mjs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const sub = (code, y, t, lec, lab = 0) => ({ code, year_level: y, term: t, lecture_units: lec, laboratory_units: lab });
const answer = (obj) => ({ candidates: [{ content: { parts: [{ text: typeof obj === 'string' ? obj : JSON.stringify(obj) }] } }] });

const good = () => ({
    is_curriculum_document: true,
    printed_totals: { grand_total_units: 9, blocks: [{ year_level: 1, term: 1, total_units: 6 }, { year_level: 1, term: 2, total_units: 3 }] },
    subjects: [sub('A', 1, 1, 3), sub('B', 1, 1, 2, 1), sub('C', 1, 2, 3), { code: 'EL1', year_level: null, term: null, lecture_units: 3, laboratory_units: 0 }],
});

describe('unitsOf: what the subjects add up to', () => {
    test('per semester and in all, lecture plus laboratory, electives in a list left out', () => {
        const u = unitsOf(good().subjects);
        assert.equal(u.total, 9);
        assert.equal(u.blocks.get('1:1'), 6);
        assert.equal(u.blocks.get('1:2'), 3);
        assert.equal(u.blocks.size, 2);
    });
    test('garbage in gives zero, not a crash', () => {
        assert.equal(unitsOf(null).total, 0);
        assert.equal(unitsOf([null, {}, { year_level: 'x' }]).total, 0);
    });
});

describe('totalsMatch: the printed totals against the subjects', () => {
    test('all match: true', () => assert.equal(totalsMatch(good()), true));
    test('the grand total differs: false', () => {
        const g = good(); g.printed_totals.grand_total_units = 12;
        assert.equal(totalsMatch(g), false);
    });
    test('one semester differs although the grand total matches: false (a missing summer term hidden by a double count)', () => {
        const g = good(); g.printed_totals.blocks[1].total_units = 6;
        assert.equal(totalsMatch(g), false);
    });
    test('the document prints no totals: false (nothing to check against, so never "verified")', () => {
        assert.equal(totalsMatch({ subjects: good().subjects }), false);
        assert.equal(totalsMatch({ printed_totals: { grand_total_units: null, blocks: [] }, subjects: good().subjects }), false);
    });
    test('only semester totals printed, and they match: true', () => {
        const g = good(); delete g.printed_totals.grand_total_units;
        assert.equal(totalsMatch(g), true);
    });
    test('a malformed block entry is skipped, not trusted and not a crash', () => {
        const g = good(); g.printed_totals.blocks.push({ year_level: 'x', term: null, total_units: 'y' });
        assert.equal(totalsMatch(g), true);
    });
});

describe('judge: good, usable or bad', () => {
    test('units that match every printed total: good, from any model', () => assert.equal(judge(answer(good())), 'good'));
    test('units that do not match: usable (an answer, not a verified one)', () => {
        const g = good(); g.printed_totals.grand_total_units = 100;
        assert.equal(judge(answer(g)), 'usable');
    });
    test('no printed totals: usable', () => {
        const g = good(); delete g.printed_totals;
        assert.equal(judge(answer(g)), 'usable');
    });
    test('"not a curriculum" is usable, never verified: a quicker model could be wrong about it', () => {
        assert.equal(judge(answer({ is_curriculum_document: false, rejection_reason: 'a resume', subjects: [] })), 'usable');
    });
    test('nothing, not JSON (cut off), or a curriculum with no subjects: bad', () => {
        assert.equal(judge(null), 'bad');
        assert.equal(judge({}), 'bad');
        assert.equal(judge(answer('{"is_curriculum_document": true, "subjects": [{"code": "A", ')), 'bad');
        assert.equal(judge(answer({ is_curriculum_document: true, subjects: [] })), 'bad');
        assert.equal(judge(answer('')), 'bad');
    });
});

describe('the four PDFs of 20 Nov 2026 (real readings), as the reader would judge them', () => {
    // The page's own check passed every one of these against the totals the PDFs print.
    const real = [
        ['ACT', 92, [[1, 1, 26], [1, 2, 26], [1, 3, 8], [2, 1, 23], [2, 2, 9]]],
        ['BSCS-AI 2024-2025', 161, [[1, 1, 23], [1, 2, 23], [2, 1, 24], [2, 2, 24], [3, 1, 21], [3, 2, 18], [4, 1, 9], [4, 2, 19]]],
    ];
    for (const [name, grand, blocks] of real) {
        test(`${name}: ${grand} units in ${blocks.length} semesters is good`, () => {
            const subjects = [];
            for (const [y, t, u] of blocks) { let left = u, i = 0; while (left > 0) { const c = Math.min(3, left); subjects.push(sub(`${y}${t}${i++}`, y, t, c)); left -= c; } }
            const parsed = { is_curriculum_document: true, printed_totals: { grand_total_units: grand, blocks: blocks.map(([y, t, u]) => ({ year_level: y, term: t, total_units: u })) }, subjects };
            assert.equal(judge(answer(parsed)), 'good');
            parsed.subjects.pop();                                  // one subject missed
            assert.equal(judge(answer(parsed)), 'usable');
        });
    }
});

describe('the reader is wired to it', () => {
    const index = read('supabase/functions/analyze-curriculum-document/index.ts');
    test('it uses the hedged call with the judge, and imports the judge from the shared file', () => {
        assert.ok(index.includes('import { judge } from "./curriculumjudge.mjs";'));
        assert.ok(index.includes('callGeminiHedged({'));
        assert.ok(index.includes('accept: judge,'));
        assert.ok(!/\bcallGemini\(\{/.test(index), 'the old one-at-a-time call is gone');
    });
    test('the second round of retries on a fresh clock is gone', () => {
        assert.ok(!index.includes('MAX_ATTEMPTS'));
        assert.ok(!index.includes('await sleep('));
    });
    test('one clock counted from when the request arrived, so the upload is part of it, and it refuses to start with too little left', () => {
        assert.ok(index.includes('const requestStartedAt = Date.now();'));
        assert.ok(index.includes('const TOTAL_MS = 140_000;'));
        assert.ok(index.includes('const left = TOTAL_MS - (Date.now() - requestStartedAt);'));
        assert.ok(index.includes('if (left < MIN_CALL_MS) {'));
        assert.ok(index.includes('askGemini(apiKey, fileBase64, mimeType, left)'));
    });
    test('the total stays under the platform\'s stop (150 s) with a margin', () => {
        const total = Number(index.match(/const TOTAL_MS = ([\d_]+);/)[1].replace(/_/g, ''));
        assert.ok(total <= 145_000 && total >= 120_000, String(total));
    });
    test('the answer is logged with which model won and whether it was the hedge, never the key', () => {
        assert.ok(index.includes('Answered by ${result.model}'));
        assert.ok(!/console\.\w+\([^)]*apiKey/.test(index));
    });
    test('a busy failure is still 503 with the busy message, and anything else 502', () => {
        assert.ok(index.includes('{ status: result.busy ? 503 : 502,'));
        assert.ok(index.includes('error: result.busy ? BUSY_MESSAGE'));
    });
    test('the model order is unchanged: the accurate one first, so a quick model only helps when it is slow', () => {
        assert.ok(index.includes('const MODELS = ["gemini-flash-latest", ...DEFAULT_MODELS.filter((m) => m !== "gemini-flash-latest")];'));
    });
});

describe('linksResolve: every prerequisite points at a real subject (the 21 Nov 2026 misreading)', () => {
    const withLinks = (pre, co = []) => ({ is_curriculum_document: true, printed_totals: { grand_total_units: 6, blocks: [] },
        subjects: [{ ...sub('CC-DISCRET12', 1, 2, 3), prerequisites: [], corequisites: [] },
                   { ...sub('CS-DISCRET21', 2, 1, 3), prerequisites: pre, corequisites: co }] });
    test('links to subjects in the same answer resolve', () => assert.equal(linksResolve(withLinks(['CC-DISCRET12'])), true));
    test('a misread code ("CS-DISCRET12" for "CC-DISCRET12") does not', () => assert.equal(linksResolve(withLinks(['CS-DISCRET12'])), false));
    test('spaces, dashes and case do not count as a difference', () => assert.equal(linksResolve(withLinks(['cc discret12'])), true));
    test('co-requisites are checked too', () => assert.equal(linksResolve(withLinks([], ['NOPE 1'])), false));
    test('no links at all resolve, and garbage does not crash', () => {
        assert.equal(linksResolve(withLinks([])), true);
        assert.equal(linksResolve(null), true);
        assert.equal(linksResolve({ subjects: [{ code: 'A', prerequisites: 'x' }] }), true);
    });
    test('judge: units that match but a link that does not is only "usable", so a quicker model waits for the accurate one', () => {
        const a = withLinks(['CS-DISCRET12']);
        assert.equal(totalsMatch(a), true);
        assert.equal(judge(answer(a)), 'usable');
        assert.equal(judge(answer(withLinks(['CC-DISCRET12']))), 'good');
    });
});
