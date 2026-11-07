// lockout.test.mjs
// Sign-in lockout (security item 3, db/101 and supabase/functions/sign-in). These tests read the files; the live
// behaviour was checked on 6 Nov 2026 with a test account (5 wrong passwords -> locked, a right password during the
// lock still refused, unlock when the failures age out, a right password clears the count).
//
//   node --test tests/lockout.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const fn = read('supabase/functions/sign-in/index.ts');
const sql = read('db/101_login_attempt.sql');

describe('the table', () => {
    test('only the service role can touch it', () => {
        assert.match(sql, /enable row level security/);
        assert.match(sql, /revoke all on public\.login_attempt from public, anon, authenticated/);
        assert.match(sql, /grant select, insert, delete on public\.login_attempt to service_role/);
        assert.doesNotMatch(sql.replace(/--.*$/gm, ''), /create policy/);
    });
    test('the key is bounded', () => {
        assert.match(sql, /char_length\(key\) <= 254/);
    });
});

describe('the sign-in function', () => {
    test('5 failures in 15 minutes lock the account', () => {
        assert.match(fn, /const MAX_FAILS = 5;/);
        assert.match(fn, /LOCK_WINDOW_MS = 15 \* 60 \* 1000/);
        assert.match(fn, /\(count \?\? 0\) >= MAX_FAILS\) return json\(429/);
    });
    test('the lock is checked BEFORE the password is tried, so a right password during a lock is still refused', () => {
        const lock = fn.indexOf('MAX_FAILS) return json(429');
        const grant = fn.indexOf('grant_type=password');
        assert.ok(lock > 0 && grant > 0 && lock < grant);
    });
    test('e-mail, student ID and employee ID of one account share one counter', () => {
        assert.match(fn, /const key = \(isEmail \|\| email !== DECOY_EMAIL \? email : `id:\$\{identifier\}`\)/);
    });
    test('a wrong password is recorded, a right one clears the account, an e-mail that is not confirmed is not counted', () => {
        assert.match(fn, /from\("login_attempt"\)\.insert\(\{ key \}\)/);
        assert.match(fn, /from\("login_attempt"\)\.delete\(\)\.eq\("key", key\)/);
        const notConfirmed = fn.indexOf('email_not_confirmed');
        const record = fn.indexOf('.insert({ key })');
        assert.ok(notConfirmed > 0 && notConfirmed < record, 'the not-confirmed answer returns before a failure is recorded');
    });
    test('a broken counter never blocks sign-in (it logs and carries on)', () => {
        assert.match(fn, /lockout check failed \(continuing without it\)/);
    });
    test('the lock message does not say whether the account exists', () => {
        assert.match(fn, /Too many failed attempts\. Please wait 15 minutes and try again\./);
    });
});

describe('the pages', () => {
    test('the website and the app already turn a 429 into a plain "wait a few minutes" message', () => {
        assert.match(read('shared/js/accounts/auth.js'), /res\.status === 429/);
    });
});
