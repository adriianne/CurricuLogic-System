// adminmsg.test.mjs
// Found 5 Nov 2026 in the live E2E run: after an EDP upload an empty red bar showed at the top of the page,
// because showMsg('edp-msg', '') gave the box the class "msg error" with no text.
//
//   node --test tests/adminmsg.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const js = readFileSync(new URL('../features/admin/admindashboard.js', import.meta.url), 'utf8');

test('an empty message hides the box instead of showing an empty error bar', () => {
    const fn = js.match(/function showMsg\(boxId, text, type = 'error'\) \{[\s\S]*?\n\}/)[0];
    assert.match(fn, /text \? 'msg ' \+ type : 'msg'/);
});

test('the EDP Remove button says it only takes the student off the list, and warns when an account exists', () => {
    assert.match(js, /'Remove from list'/);
    assert.match(js, /Already has an account\. It stays\./);
    assert.match(js, /Removing a student only takes them off this list/);
});
