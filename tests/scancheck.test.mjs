// scancheck.test.mjs
// The scan check: the overview shown under the AI-assisted curriculum upload (extractioncheck.js overview() and html(),
// and how curriculum-builder.js shows it).
//
//   node --test tests/scancheck.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const X = require('../shared/js/curriculum/extractioncheck.js');
const readFile = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

const sub = (code, y, t, lec, lab = 0, title = code) => ({ code, title, year_level: y, term: t, lecture_units: lec, laboratory_units: lab });

describe('overview(): a scan that matches the document', () => {
    const subjects = [sub('A', 1, 1, 3), sub('B', 1, 1, 2, 1), sub('C', 1, 2, 3), sub('IT-EL1', null, null, 3, 0, 'IT Elective 1')];
    const printed = { grand_total_units: 9, blocks: [{ year_level: 1, term: 1, total_units: 6 }, { year_level: 1, term: 2, total_units: 3 }] };
    const r = X.overview(subjects, printed, { prereqLinks: 2, gates: 0, coreqs: 0, followUps: [], interpreted: [], rowsWithErrors: 0 });

    test('is a pass with no warning, and says so plainly', () => {
        assert.equal(r.verdict, 'ok');
        assert.equal(r.warned, 0);
        assert.equal(r.headline, 'The scan matches the document');
        assert.match(r.sub, /No mistakes found by the scan check/);
    });
    test('counts the subjects and says where they are', () => {
        assert.equal(r.checks[0].title, '4 subjects read');
        assert.match(r.checks[0].detail, /3 in the year-by-year tables and 1 in the elective lists/);
    });
    test('reports the units and every semester as matching', () => {
        const titles = r.checks.map((c) => c.title);
        assert.ok(titles.includes('Units match the document'));
        assert.ok(titles.includes('All 2 semester totals match'));
        assert.deepEqual(r.blocks.map((b) => [b.printed, b.read, b.ok]), [[6, 6, true], [3, 3, true]]);
    });
    test('reports no repeated code, units on every subject, and a clean row check', () => {
        const titles = r.checks.map((c) => c.title);
        assert.ok(titles.includes('No repeated subject codes'));
        assert.ok(titles.includes('Every scheduled subject has units'));
        assert.ok(titles.includes('Every row passes the builder’s checks'));
        assert.ok(titles.includes('2 prerequisite links read'));
    });
    test('always carries the honest note that it cannot see a wrongly read prerequisite or title', () => {
        assert.match(r.note, /cannot tell whether a prerequisite or a title was read wrongly/);
    });
});

describe('overview(): what needs a look', () => {
    test('a missing summer term is a warning, with the semester named and the units short', () => {
        const subjects = [sub('A', 3, 1, 3), sub('B', 3, 2, 3)];
        const printed = { grand_total_units: 12, blocks: [
            { year_level: 3, term: 1, total_units: 3 }, { year_level: 3, term: 2, total_units: 3 }, { year_level: 3, term: 3, total_units: 6 }] };
        const r = X.overview(subjects, printed, {});
        assert.equal(r.verdict, 'warn');
        const units = r.checks.find((c) => c.title === 'Units do not match the document');
        assert.match(units.detail, /add up to 6 units; the document prints 12 \(6 units short\)/);
        const block = r.checks.find((c) => /semester totals differ/.test(c.title));
        assert.equal(block.title, '1 of 3 semester totals differ');
        assert.deepEqual(block.items, ['3rd year, summer: document 6, scan 0']);
        assert.equal(r.headline, 'Check 2 things before you save');
    });
    test('a repeated code and a subject with no units are named', () => {
        const r = X.overview([sub('A', 1, 1, 3), sub('A', 1, 2, 3), sub('Z', 1, 2, 0)], {}, {});
        assert.ok(r.checks.some((c) => c.title === '1 repeated code' && c.items[0] === 'A appears 2 times'));
        assert.ok(r.checks.some((c) => c.title === '1 subject shows 0 units' && c.items[0] === 'Z'));
    });
    test('elective placeholders that repeat a code are not called repeats', () => {
        const r = X.overview([sub('IT-EL', null, null, 3, 0, 'IT Elective'), sub('IT-EL', null, null, 3, 0, 'IT Elective')], {}, {});
        assert.ok(r.checks.some((c) => c.title === 'No repeated subject codes'));
    });
    test('a prerequisite on a subject not in the document is a warning, other notes are "adding by hand", rules are info', () => {
        const r = X.overview([sub('A', 1, 1, 3)], {}, {
            prereqLinks: 0,
            followUps: ['B: prerequisite "ZZ" is not a subject in this document', 'C: "GEC"'],
            interpreted: ['D: "Finished Third Year Subjects" → year-standing gate'],
            gates: 3, coreqs: 1, rowsWithErrors: 2,
        });
        const by = (re) => r.checks.find((c) => re.test(c.title));
        assert.equal(by(/link names a subject that is not in this document/).status, 'warn');
        assert.equal(by(/note needs adding by hand/).status, 'warn');
        assert.equal(by(/note turned into rules/).status, 'info');
        assert.equal(by(/year-standing gates/).status, 'info');
        assert.equal(by(/goes-with link/).status, 'info');
        assert.equal(by(/2 rows have issues/).status, 'warn');
        assert.equal(r.verdict, 'warn');
    });
    test('a document that prints no totals is not called a pass of the units', () => {
        const r = X.overview([sub('A', 1, 1, 3)], {}, { prereqLinks: 1 });
        assert.equal(r.verdict, 'ok');
        assert.equal(r.headline, 'No problems found, but the units could not be checked');
        assert.ok(r.checks.some((c) => c.title === 'The document prints no totals' && c.status === 'info'));
    });
    test('nothing read at all is a warning', () => {
        const r = X.overview([], { grand_total_units: 100 }, {});
        assert.equal(r.verdict, 'warn');
        assert.ok(r.checks.some((c) => c.title === 'No subjects were found'));
    });
    test('garbage in does not throw', () => {
        assert.doesNotThrow(() => X.overview(null, null, null));
        assert.doesNotThrow(() => X.overview('x', 5, 'y'));
        assert.equal(X.html(null), '');
        assert.equal(X.html({}), '');
    });
});

describe('html(): the card', () => {
    test('shows the verdict, one line per check and a table of the semester totals', () => {
        const r = X.overview([sub('A', 1, 1, 3)], { grand_total_units: 3, blocks: [{ year_level: 1, term: 1, total_units: 3 }] }, {});
        const h = X.html(r);
        assert.ok(h.includes('class="cb-scan is-ok"'));
        assert.ok(h.includes('The scan matches the document'));
        assert.equal((h.match(/class="cb-scan-item /g) || []).length, r.checks.length);
        assert.ok(h.includes('Semester totals, document against scan (1)'));
        assert.ok(h.includes('class="cb-yr-name">1st year<'));
        assert.ok(h.includes('class="cb-tot-name">1st semester<'));
    });
    test('a warning card says so and lists the items', () => {
        const h = X.html(X.overview([sub('A', 1, 1, 3), sub('A', 1, 1, 3)], {}, {}));
        assert.ok(h.includes('class="cb-scan is-warn"'));
        assert.ok(h.includes('A appears 2 times'));
    });
    test('text that came from a document is escaped', () => {
        const evil = '<img src=x onerror=alert(1)>';
        const r = X.overview([sub(evil, 1, 1, 3), sub(evil, 1, 1, 3)], {}, {
            followUps: [evil + ' is not a subject in this document'], interpreted: [evil] });
        const h = X.html(r);
        assert.ok(!h.includes('<img'));
        assert.ok(h.includes('&lt;img'));
    });
});

describe('the builder shows the scan check under the upload', () => {
    const builder = readFile('features/department/curriculum-builder.js');
    const css = readFile('features/department/curriculum-builder.css');

    test('it is drawn straight under the status message, inside the upload card', () => {
        const card = builder.slice(builder.indexOf('function aiUploadHtml'), builder.indexOf('function scanReportHtml'));
        assert.ok(card.indexOf('id="ai-analyze-status"') < card.indexOf('${scanReportHtml()}'));
        assert.ok(card.indexOf('${scanReportHtml()}') < card.indexOf('cb-ai-actions'));
    });
    test('it is made before render(), so the first paint has it, from the same facts the builder gathered', () => {
        const run = builder.slice(builder.indexOf('SCAN_REPORT = window.CurriculogicExtractionCheck?.overview('));
        assert.ok(run.indexOf('SCAN_REPORT = window') < run.indexOf('render();'));
        for (const field of ['prereqLinks', 'gates: gatesAdded', 'coreqs: coreqsAdded', 'followUps', 'interpreted', 'rowsWithErrors: badRows().length']) {
            assert.ok(run.slice(0, 700).includes(field), field);
        }
        assert.ok(builder.includes('SCAN_REPORT.rowsRef = ROWS'));
    });
    test('it is shown only while the rows are the ones that scan made, and a new scan clears it', () => {
        assert.ok(builder.includes('SCAN_REPORT.rowsRef !== ROWS'));
        const start = builder.slice(builder.indexOf('async function analyzeDocumentRun'), builder.indexOf('async function analyzeDocumentRun') + 900);
        assert.ok(start.includes('SCAN_REPORT = null;'));
    });
    test('the old single self-check is computed once, not twice', () => {
        assert.equal((builder.match(/const selfCheck = /g) || []).length, 1);
    });
    test('the styles exist', () => {
        for (const c of ['.cb-scan {', '.cb-scan.is-warn', '.cb-scan-item', '.cb-scan-blocks', '.cb-scan-note']) assert.ok(css.includes(c), c);
    });
});

describe('semester totals as tiles (21 Nov 2026: a narrow table left the right half of the card empty)', () => {
    const printed = { grand_total_units: 9, blocks: [{ year_level: 1, term: 1, total_units: 6 }, { year_level: 1, term: 2, total_units: 3 }] };
    const html = (subs, p = printed) => X.html(X.overview(subs, p, {}));
    test('one tile per printed total, plus a whole-programme tile, in a grid instead of a table', () => {
        const h = html([sub('A', 1, 1, 6), sub('B', 1, 2, 3)]);
        assert.equal((h.match(/class="cb-tot /g) || []).length, 3);
        assert.ok(h.includes('class="cb-tots"'));
        assert.ok(h.includes('cb-tot is-ok is-grand'));
        assert.ok(!h.includes('<table'));
    });
    test('the section is open by default and keeps its heading', () => {
        const h = html([sub('A', 1, 1, 6), sub('B', 1, 2, 3)]);
        assert.ok(h.includes('<details class="cb-scan-blocks" open>'));
        assert.ok(h.includes('Semester totals, document against scan (2)'));
    });
    test('a tile shows the scan and the document numbers, a bar, and says so when they match', () => {
        const h = html([sub('A', 1, 1, 6), sub('B', 1, 2, 3)]);
        assert.ok(h.includes('<b>6</b><span> of 6 units</span>'));
        assert.ok(h.includes('style="width:100%"'));
        assert.ok(h.includes('✓ Matches the document'));
    });
    test('a semester that differs is marked, with the bar short and the document\'s number named', () => {
        const h = html([sub('A', 1, 1, 6), sub('B', 1, 2, 2)]);
        assert.ok(h.includes('cb-tot is-off'));
        assert.ok(h.includes('! Document prints 3'));
        assert.ok(h.includes('style="width:67%"'));
    });
    test('the grand total is on the report only when the document prints one', () => {
        assert.deepEqual(X.overview([sub('A', 1, 1, 6), sub('B', 1, 2, 3)], printed, {}).grand, { printed: 9, read: 9, ok: true });
        assert.equal(X.overview([sub('A', 1, 1, 3)], { blocks: [{ year_level: 1, term: 1, total_units: 3 }] }, {}).grand, null);
        assert.ok(!html([sub('A', 1, 1, 3)], { blocks: [{ year_level: 1, term: 1, total_units: 3 }] }).includes('is-grand'));
    });
    test('document text in a label is escaped, and a zero-unit semester does not divide by zero', () => {
        const h = html([sub('A', 1, 1, 0)], { grand_total_units: null, blocks: [{ year_level: 1, term: 1, total_units: 0 }] });
        assert.ok(h.includes('style="width:100%"'));
        assert.ok(!h.includes('NaN'));
    });
    test('the stylesheet lays the tiles out across the card and keeps them readable in dark mode', () => {
        const css = readFileSync(new URL('../features/department/curriculum-builder.css', import.meta.url), 'utf8');
        assert.ok(css.includes('grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));'));
        assert.ok(css.includes('grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr));'), 'All checks as cards');
        assert.ok(css.includes('.cb-tot.is-off'));
        assert.ok(!/\.cb-tot \{[^}]*background: rgba\(255, 255, 255/.test(css), 'a fixed white tile would be unreadable in dark mode');
    });
});

describe('semester totals by year, and All checks as cards', () => {
    const blocks = [1, 2].flatMap((y) => [1, 2].map((t) => ({ year_level: y, term: t, total_units: 3 })));
    const subs = [1, 2].flatMap((y) => [1, 2].map((t) => sub(`S${y}${t}`, y, t, 3)));
    const printed = { grand_total_units: 12, blocks };
    test('one column per year with its semesters stacked in it, in year and semester order, then a column for the whole programme', () => {
        const h = X.html(X.overview(subs, printed, {}));
        assert.equal((h.match(/class="cb-yr"/g) || []).length, 2);
        assert.equal((h.match(/class="cb-yr is-grand-col"/g) || []).length, 1);
        assert.ok(h.indexOf('>1st year<') < h.indexOf('>2nd year<') && h.indexOf('>2nd year<') < h.indexOf('>All years<'));
        const col1 = h.slice(h.indexOf('>1st year<'), h.indexOf('>2nd year<'));
        assert.ok(col1.indexOf('>1st semester<') < col1.indexOf('>2nd semester<'));
    });
    test('a summer sits under the semesters of its year, and years given out of order are sorted', () => {
        const p = { blocks: [{ year_level: 2, term: 1, total_units: 3 }, { year_level: 1, term: 3, total_units: 3 }, { year_level: 1, term: 1, total_units: 3 }] };
        const h = X.html(X.overview([sub('A', 1, 1, 3), sub('B', 1, 3, 3), sub('C', 2, 1, 3)], p, {}));
        assert.ok(h.indexOf('>1st year<') < h.indexOf('>2nd year<'));
        const col1 = h.slice(h.indexOf('>1st year<'), h.indexOf('>2nd year<'));
        assert.ok(col1.indexOf('>1st semester<') < col1.indexOf('>summer<'));
        assert.ok(!h.includes('All years'), 'no whole-programme column when the document prints no grand total');
    });
    test('All checks opens by itself when any check is a warning or a note to read, and stays shut when every check passes', () => {
        const allOk = X.overview([{ ...sub('A', 1, 1, 3), prerequisites: [] }, { ...sub('B', 1, 2, 3), prerequisites: ['A'] }], { grand_total_units: 6, blocks: [] }, { prereqLinks: 1 });
        assert.ok(allOk.checks.every((c) => c.status === 'ok'));
        assert.ok(X.html(allOk).includes('<details class="cb-scan-all">'));
        const note = X.overview(subs, printed, {});
        assert.ok(note.checks.some((c) => c.status === 'info'));
        assert.ok(X.html(note).includes('<details class="cb-scan-all" open>'));
        assert.ok(X.html(X.overview([sub('A', 1, 1, 3), sub('A', 1, 1, 3)], {}, {})).includes('<details class="cb-scan-all" open>'));
    });
    test('the check cards are tinted by status in the stylesheet', () => {
        const css = readFileSync(new URL('../features/department/curriculum-builder.css', import.meta.url), 'utf8');
        assert.ok(css.includes('.cb-scan-item.is-warn { border-color'));
        assert.ok(css.includes('.cb-yr-tiles'));
    });
});
