import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { run, checkNewPassword } = require('../shared/js/forcepasswordchange.js');
const rules = require('../shared/js/passwordrules.js');

test('a new password must be entered', () => {
    assert.equal(checkNewPassword('', '', 'student', rules), 'Enter a new password.');
});

test('the one password rule applies (length and a special character)', () => {
    assert.match(checkNewPassword('short!', 'short!', 'student', rules), /at least 8/);
    assert.match(checkNewPassword('longenough1', 'longenough1', 'student', rules), /special character/);
});

test('an administrator needs 12 characters', () => {
    assert.match(checkNewPassword('Sh0rt!pass', 'Sh0rt!pass', 'admin', rules), /at least 12/);
    assert.equal(checkNewPassword('Long-enough-pass1', 'Long-enough-pass1', 'admin', rules), null);
});

test('the two entries must match', () => {
    assert.equal(checkNewPassword('Good#pass1', 'Good#pass2', 'student', rules), 'The two passwords do not match.');
    assert.equal(checkNewPassword('Good#pass1', 'Good#pass1', 'student', rules), null);
});

const stubDoc = () => ({ getElementById: () => null, body: { appendChild() { throw new Error('should not draw'); } } });

test('nothing is shown to a person who has already chosen a password', async () => {
    const supabase = { rpc: async () => ({ data: false, error: null }) };
    assert.equal(await run(supabase, 'student', { document: stubDoc(), rules }), false);
});

test('a failed check never blocks the page', async () => {
    assert.equal(await run({ rpc: async () => ({ data: null, error: { message: 'x' } }) }, 'student', { document: stubDoc(), rules }), false);
    assert.equal(await run({ rpc: async () => { throw new Error('offline'); } }, 'student', { document: stubDoc(), rules }), false);
});

test('without a client or a page it does nothing', async () => {
    assert.equal(await run(null, 'student', { document: stubDoc() }), false);
    assert.equal(await run({ rpc: async () => ({ data: true }) }, 'student', { document: null }), false);
});
