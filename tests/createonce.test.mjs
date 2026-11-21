// createonce.test.mjs
// Create curriculum (21 Nov 2026): one check dialog at a time, one save at a time, and after a save the table reloads the
// saved subjects instead of staying empty with "Unsaved changes".
//
//   node --test tests/createonce.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const builder = readFileSync(new URL('../features/department/curriculum-builder.js', import.meta.url), 'utf8');
const between = (a, b) => builder.slice(builder.indexOf(a), builder.indexOf(b, builder.indexOf(a)));

describe('after a save the page is clean, so the saved subjects are reloaded', () => {
    const tail = builder.slice(builder.indexOf('const n = data.length;'), builder.indexOf('/* ---- entry point ---- */'));
    test('the table is emptied and then marked clean before the host is told it is done', () => {
        const emptied = tail.indexOf('ROWS = [];');
        const clean = tail.indexOf('markClean();');
        const done = tail.indexOf('OPTS.onDone?.(');
        assert.ok(emptied >= 0 && clean > emptied && done > clean);
    });
    test('mount keeps the table only when it really holds rows the database does not have', () => {
        assert.match(builder, /isDirty\(\) && filled\(\)\.length\) \{\s+const keep = OPTS\.prospectusId;/);
    });
});

describe('one check dialog at a time', () => {
    const fn = between('function confirmCreate(check) {', 'const list = ');
    test('opening the check removes any check dialog that is already open', () => {
        assert.ok(fn.includes("document.querySelectorAll('.cbp-overlay').forEach(o => { if (o.querySelector('.cb-confirm')) o.remove(); });"));
    });
    test('pressing Create again while the check is running does nothing', () => {
        assert.match(builder, /let CREATE_BUSY = false;/);
        assert.match(builder, /async function create\(\) \{\s+if \(CREATE_BUSY\) return;\s+CREATE_BUSY = true;\s+try \{ await createCheck\(\); \} finally \{ CREATE_BUSY = false; \}/);
    });
});

describe('one save at a time', () => {
    test('a second confirm while a save runs does nothing, and the flag is always released', () => {
        assert.match(builder, /let COMMITTING = false;/);
        assert.match(builder, /async function commit\(\) \{\s+if \(COMMITTING\) return;\s+COMMITTING = true;\s+try \{ await commitRows\(\); \} finally \{ COMMITTING = false; \}/);
    });
    test('the confirm button still calls commit, and the Create button still calls create', () => {
        assert.ok(builder.includes("if (e.target.closest('.cb-cf-go')) { close(); commit(); }"));
        assert.ok(builder.includes("if (e.target.closest('#cb-create')) return create();"));
    });
});
