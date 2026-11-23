// linkerror.test.mjs
// 22 Nov 2026: a student tapped the confirmation link twice. The first tap confirmed the account; every later tap was refused
// ("Email link is invalid or has expired"), and the login page said nothing about it. Now it explains, whichever login page it is.
//
//   node --test tests/linkerror.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const LE = require('../shared/js/accounts/linkerror.js');
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

const REAL = '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired';

describe('read', () => {
    test('the refusal Supabase sent on 22 Nov explains that the link was already used or expired', () => {
        const r = LE.read(REAL, '');
        assert.equal(r.code, 'otp_expired');
        assert.equal(r.message, LE.USED_OR_EXPIRED);
        assert.match(r.message, /already used or has expired/);
        assert.match(r.message, /just log in/);
        assert.match(r.message, /new link/);
    });
    test('the same refusal in the query string (the other sign-in flow) is read too', () => {
        const r = LE.read('', '?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
        assert.equal(r.message, LE.USED_OR_EXPIRED);
    });
    test('without an error code, the description still tells an expired link apart', () => {
        const r = LE.read('#error=access_denied&error_description=Email+link+is+invalid+or+has+expired', '');
        assert.equal(r.message, LE.USED_OR_EXPIRED);
    });
    test('any other error gets the general sentence', () => {
        const r = LE.read('#error=server_error&error_code=unexpected_failure&error_description=Something+broke', '');
        assert.equal(r.message, LE.OTHER);
        assert.equal(r.code, 'unexpected_failure');
    });
    test('nothing in the address means nothing to say', () => {
        for (const [h, s] of [['', ''], [null, undefined], ['#', '?'], ['#section', ''], ['', '?confirmed=1'], ['', '?reset=1']])
            assert.equal(LE.read(h, s), null, JSON.stringify([h, s]));
    });
    test('the success flags are not mistaken for errors', () => {
        assert.equal(LE.read('', '?confirmed=1'), null);
    });
    test('text from the address is never shown: anyone can write a link', () => {
        const r = LE.read('#error=x&error_code=y&error_description=%3Cimg+src%3Dx+onerror%3Dalert(1)%3E+expired', '');
        assert.ok(!r.message.includes('<'));
        assert.ok(!r.message.includes('onerror'));
    });
});

describe('the login pages', () => {
    const pages = ['loginpage', 'staffloginpage', 'adminloginpage'];
    for (const p of pages) {
        test(`${p} loads the module before auth.js`, () => {
            const html = read(`features/auth/html/${p}.html`);
            const mod = html.indexOf('shared/js/accounts/linkerror.js');
            assert.ok(mod > 0);
            assert.ok(mod < html.indexOf('shared/js/accounts/auth.js'));
        });
    }
    test('auth.js shows it and clears the address bar, and leaves the confirmed message alone', () => {
        const js = read('shared/js/accounts/auth.js');
        assert.match(js, /CurriculogicLinkError\?\.read\(window\.location\.hash, window\.location\.search\)/);
        assert.match(js, /showMsg\(linkProblem\.message, 'error'\)/);
        assert.ok(js.includes("get('confirmed') === '1'"));
    });
});
