// bulkcancel.test.mjs
// The bulk upload preview has a Cancel button beside Create: it throws the file away and nothing is created.
//   node --test tests/bulkcancel.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const js = read('features/admin/admindashboard.js');
const css = read('shared/css/dashboard.css');

const fn = (name) => {
    const start = js.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `${name} exists`);
    const next = js.indexOf('\nfunction ', start + 10);
    const nextAsync = js.indexOf('\nasync function ', start + 10);
    const ends = [next, nextAsync].filter(i => i > 0);
    return js.slice(start, Math.min(...ends));
};

describe('Cancel on the bulk upload preview', () => {
    test('is drawn beside the Create button', () => {
        const render = fn('renderBulkPreview');
        const create = render.indexOf('id="commit-bulk"');
        const cancel = render.indexOf('id="cancel-bulk"');
        assert.ok(create > 0 && cancel > create, 'Cancel comes right after Create');
        assert.match(render, /<div class="bulk-actions">[\s\S]*id="commit-bulk"[\s\S]*id="cancel-bulk"[\s\S]*<\/div>/);
        assert.match(css, /\.bulk-actions\s*\{[^}]*display:\s*flex/);
    });
    test('is wired in the same click handler as Create', () => {
        assert.match(js, /closest\('#cancel-bulk'\)\) \{ cancelBulkUpload\(\); return; \}/);
    });
    test('forgets the file, the rows and every result, and empties the file box', () => {
        const body = fn('cancelBulkUpload');
        for (const v of ['PENDING_BULK = []', 'PENDING_BULK_BAD = []', "PENDING_BULK_FILE = ''", 'PENDING_BULK_RAW = []', 'BULK_RESULTS = []']) {
            assert.ok(body.includes(v), v);
        }
        assert.match(body, /\$\('bulk-file'\)/);
        assert.match(body, /input\.value = ''/);
        assert.match(body, /box\.innerHTML = ''/);
        assert.match(body, /bulkStatus\(null\)/);
    });
    test('never creates anything and says so', () => {
        const body = fn('cancelBulkUpload');
        assert.doesNotMatch(body, /rpc\(|\.insert\(|\.from\(/);
        assert.match(body, /no accounts were created/);
    });
    test('cannot be pressed once creating has started', () => {
        const commit = js.slice(js.indexOf('async function commitBulk('));
        assert.match(commit, /\$\('cancel-bulk'\)[\s\S]{0,80}\.disabled = true/);
    });
});
