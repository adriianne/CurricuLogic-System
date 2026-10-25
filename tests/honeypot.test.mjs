// honeypot.test.mjs
// The Register page's hidden bot-trap field: only a filled-in field trips it.
//
//   node --test tests/honeypot.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const H = require('../shared/js/accounts/honeypot.js');

test('an empty field does not trip it', () => {
    for (const v of ['', '   ', '\n\t', null, undefined]) assert.equal(H.tripped(v), false, JSON.stringify(v));
});

test('anything typed trips it', () => {
    for (const v of ['http://spam.example', 'x', ' a ', 0, 12345]) assert.equal(H.tripped(v), true, JSON.stringify(v));
});
