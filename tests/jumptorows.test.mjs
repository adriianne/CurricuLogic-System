// jumptorows.test.mjs
// The cards of the scan check that are about particular rows take the person to those rows (21 Nov 2026): one at a time, with the
// row lit up, a way back, and arrows on the Issues tile to step through every issue.
//
//   node --test tests/jumptorows.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const X = require('../shared/js/curriculum/extractioncheck.js');
const builder = readFileSync(new URL('../features/department/curriculum-builder.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../features/department/curriculum-builder.css', import.meta.url), 'utf8');
const between = (a, b) => builder.slice(builder.indexOf(a), builder.indexOf(b, builder.indexOf(a)));
const sub = (code, y, t, l, extra = {}) => ({ code, title: code, year_level: y, term: t, lecture_units: l, laboratory_units: 0, ...extra });

describe('which checks know their rows', () => {
    const r = X.overview(
        [sub('A', 1, 1, 3), sub('A', 1, 1, 3), sub('B', 1, 2, 0), sub('C', 2, 1, 3)],
        { grand_total_units: 9, blocks: [] },
        { followUps: ['B: prerequisite "ZZ" is not a subject in this document', 'C: prerequisite "YY" is not a subject in this document'],
          interpreted: ['A: "All prof courses" → year-standing gate'], rowsWithErrors: 2 });
    const by = (re) => r.checks.find((c) => re.test(c.title));
    test('repeated codes: the codes that repeat', () => assert.deepEqual(by(/repeated/).jump, { kind: 'codes', codes: ['A'] }));
    test('subjects with no units: their codes', () => assert.deepEqual(by(/0 units/).jump, { kind: 'codes', codes: ['B'] }));
    test('prerequisite links to nothing: the subjects that name them, each once', () => {
        assert.deepEqual(by(/not in this document/).jump, { kind: 'codes', codes: ['B', 'C'] });
    });
    test('notes turned into rules: the subjects they belong to', () => assert.deepEqual(by(/turned into rules/).jump, { kind: 'codes', codes: ['A'] }));
    test('rows with issues: every row the builder flags', () => assert.deepEqual(by(/have issues/).jump, { kind: 'issues' }));
    test('a check about the whole file has no rows to go to', () => {
        assert.equal(by(/subjects read/).jump, null);
        assert.equal(by(/Units match/).jump, null);
    });
    test('a subject with no code is not offered as a destination', () => {
        const q = X.overview([sub('', 1, 1, 0), sub('D', 1, 2, 3)], { grand_total_units: 3, blocks: [] }, {});
        const noUnits = q.checks.find((c) => /0 units/.test(c.title));
        assert.deepEqual(noUnits.jump, { kind: 'codes', codes: [] });
        assert.ok(!X.html(q).includes('data-jump="codes"'), 'no rows known, so the card is not a button');
    });
});

describe('the cards', () => {
    const r = X.overview([sub('A', 1, 1, 3), sub('A', 1, 1, 3), sub('B', 1, 2, 0)], { grand_total_units: 6, blocks: [] }, { rowsWithErrors: 1 });
    const h = X.html(r);
    test('a card about rows is a button with its kind and codes, and says where it goes', () => {
        assert.ok(h.includes('class="cb-scan-item is-warn is-jump" role="button" tabindex="0" data-jump="codes"'));
        assert.ok(h.includes('data-jump="issues"'));
        assert.ok(h.includes('Go to the first issue ›'));
        assert.ok(h.includes('Go to the row ›'));
    });
    test('a card about the whole file stays a plain card', () => {
        const plain = h.match(/<li class="cb-scan-item is-ok">/g) || [];
        assert.ok(plain.length >= 1);
    });
    test('the codes travel safely in an attribute', () => {
        const evil = X.html(X.overview([sub('A"><b>', 1, 1, 3), sub('A"><b>', 1, 1, 3)], {}, {}));
        assert.ok(!evil.includes('<b>'));
        assert.ok(evil.includes('data-codes="[&quot;'));
    });
    test('several rows: the hint says it starts at the first', () => {
        const many = X.html(X.overview([sub('A', 1, 1, 3), sub('A', 1, 1, 3), sub('B', 1, 1, 3), sub('B', 1, 1, 3)], {}, {}));
        assert.ok(many.includes('Go to the first row ›'));
    });
});

describe('the builder: jumping from a card', () => {
    const fn = between('function jumpFromCard(card)', 'let BACK_PILL = null;');
    test('reads the kind and codes, finds the rows, and goes to them in table order', () => {
        assert.ok(fn.includes('const kind = card.dataset.jump;'));
        assert.ok(fn.includes("JSON.parse(card.dataset.codes || '[]')"));
        assert.ok(fn.includes('kind === \'issues\' ? issueRows() : filled().filter(r => keys.has(SC.key(r.code)))'));
        assert.ok(fn.includes('.sort((a, b) => rank(a) - rank(b))'));
    });
    test('each click goes to the next row, round and round, and the card says where it is', () => {
        assert.ok(fn.includes('const i = (Number(card.dataset.i) || 0) % rows.length;'));
        assert.ok(fn.includes("card.dataset.i = String(i + 1);"));
        assert.ok(fn.includes('Row ${i + 1} of ${rows.length}'));
    });
    test('when the rows have been fixed meanwhile it says so instead of failing', () => {
        assert.ok(fn.includes('Nothing left to go to'));
        assert.ok(fn.indexOf('Nothing left to go to') < fn.indexOf('goToRow(rows[i], { back: true });'));
    });
    test('a bad attribute does not throw', () => {
        assert.match(fn, /try \{ codes = JSON\.parse\(card\.dataset\.codes \|\| '\[\]'\); \} catch \(_\) \{/);
    });
});

describe('the builder: going to a row', () => {
    const fn = between('function goToRow(row', 'const issueRows');
    test('opens the tab the row is on, scrolls to it and puts the cursor in it', () => {
        assert.ok(fn.includes("showTab(row.year ?? (row.electiveType === 'FREE' ? 'free' : 'it'));"));
        assert.ok(fn.includes("scrollIntoView({ block: 'center', behavior: 'smooth' })"));
        assert.ok(fn.includes("focus({ preventScroll: true })"));
    });
    test('lights the row up for two seconds, then stops', () => {
        assert.ok(fn.includes("tr.classList.add('cb-flash');"));
        assert.ok(fn.includes("setTimeout(() => tr.classList.remove('cb-flash'), 2200);"));
    });
    test('only a jump from a card offers the way back', () => {
        assert.ok(fn.includes('if (back) showBackPill();'));
    });
});

describe('the way back', () => {
    const fn = between('let BACK_PILL = null;', '/* ---- persistence ---- */');
    test('a button that scrolls to the scan check and goes away', () => {
        assert.ok(fn.includes("BACK_PILL.id = 'cb-back-pill';"));
        assert.ok(fn.includes("document.querySelector('.cb-scan')?.scrollIntoView({ block: 'start', behavior: 'smooth' });"));
        assert.ok(fn.includes('removeBackPill();'));
    });
    test('it is only offered while there is a scan check, and goes after 15 seconds', () => {
        assert.ok(fn.includes("if (!document.querySelector('.cb-scan')) return;"));
        assert.ok(fn.includes('BACK_TIMER = setTimeout(removeBackPill, 15000);'));
    });
    test('there is one at a time', () => {
        assert.ok(fn.includes('if (!BACK_PILL) {'));
    });
    test('it is cleared with a cancelled upload, a new scan, a save and a fresh mount', () => {
        assert.ok(builder.split('removeBackPill();').length - 1 >= 5);
    });
});

describe('the Issues tile arrows', () => {
    test('they show only when there is more than one issue, with a position', () => {
        const stats = between('function statsHtml()', 'function rowHtml(r)');
        assert.ok(stats.includes('${bad > 1'));
        assert.ok(stats.includes('data-issue-step="-1"') && stats.includes('data-issue-step="1"'));
        assert.ok(stats.includes('} of ${bad}'));
    });
    test('they wrap round, redraw the position and go to the issue', () => {
        const fn = between('function stepIssue(step)', '/* A card in the scan check');
        assert.ok(fn.includes('(((ISSUE_I + step) % rows.length) + rows.length) % rows.length'));
        assert.ok(fn.includes('updateStats();'));
        assert.ok(fn.includes('goToRow(rows[ISSUE_I]);'));
    });
    test('the tile itself goes to the current issue, the first until the arrows move it', () => {
        const fn = between('function jumpToIssue()', '/* The arrows on the Issues tile');
        assert.ok(fn.includes('goToRow(rows[ISSUE_I]);'));
        assert.match(builder, /let ISSUE_I\s+= 0;/);
    });
});

describe('the clicks and keys', () => {
    test('an arrow is handled before the tile, so one click is one step and never also a jump', () => {
        const click = between("MOUNT.addEventListener('click', (e) => {", "if (e.target.closest('[data-jump-issue]')) return jumpToIssue();");
        assert.ok(click.indexOf('[data-issue-step]') < click.length);
        assert.ok(click.includes('return stepIssue('));
        assert.ok(click.includes("e.target.closest('.cb-scan-item[data-jump]')"));
    });
    test('Enter or Space on a card goes there, and on an arrow is left to the button', () => {
        const key = between("MOUNT.addEventListener('keydown', (e) => {", "MOUNT.addEventListener('click', (e) => {");
        assert.ok(key.includes("if (e.target.closest('[data-issue-step]')) return;"));
        assert.ok(key.includes("jumpFromCard(e.target.closest('.cb-scan-item[data-jump]'));"));
        assert.ok(key.includes('e.preventDefault();'));
    });
});

describe('the look', () => {
    test('a clickable card shows it, with a keyboard focus ring', () => {
        for (const part of ['.cb-scan-item.is-jump { cursor: pointer;', '.cb-scan-item.is-jump:hover', '.cb-scan-item.is-jump:focus-visible', '.cb-jump-hint']) {
            assert.ok(css.includes(part), part);
        }
    });
    test('the jumped-to row fades from yellow, and holds still for people who ask for less motion', () => {
        assert.ok(css.includes('.cb tr.cb-flash > td { animation: cb-flash 2.2s ease-out; }'));
        assert.ok(css.includes('@keyframes cb-flash'));
        assert.match(css, /prefers-reduced-motion: reduce\) \{\s+\.cb tr\.cb-flash > td \{ animation: none;/);
    });
    test('the arrows and the way-back button are styled', () => {
        assert.ok(css.includes('.cb-issue-nav'));
        assert.ok(css.includes('#cb-back-pill {'));
    });
});
