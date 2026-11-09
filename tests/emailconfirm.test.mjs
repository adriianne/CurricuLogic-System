// emailconfirm.test.mjs
// Found 5 Nov 2026: a student who had not confirmed the e-mail only saw "Invalid username or password.", and
// there was no way to ask for a new link. The sign-in function now says so, only to someone with the right
// password, and can send a new confirmation e-mail; the login pages offer a button for it.
//
//   node --test tests/emailconfirm.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const fn = read('supabase/functions/sign-in/index.ts');
const page = read('shared/js/accounts/auth.js');

describe('the sign-in function', () => {
    test('says "not confirmed" only when Supabase says so (which it does after the password was checked)', () => {
        assert.match(fn, /res\.status === 400 && why\?\.error_code === "email_not_confirmed"/);
        assert.match(fn, /code: "email_not_confirmed"/);
    });
    test('every other failure is still the same generic answer', () => {
        // after the failure is counted (db/101) the answer is still the plain generic one
        assert.match(fn, /could not record the failed attempt[^\n]*\n\s*return fail\(\);\s*\}/);
    });
    test('a resend uses the address behind the identifier on the server, and never returns it', () => {
        assert.match(fn, /body\?\.resend === true/);
        assert.match(fn, /auth\/v1\/resend/);
        assert.match(fn, /json\(200, \{ resent: true \}\)/);
        assert.doesNotMatch(fn, /json\(\d+, \{[^}]*\bemail\b\s*[,:]/);
    });
});

describe('the login pages', () => {
    test('a 403 with that code shows the message and the resend button', () => {
        assert.match(page, /res\.status === 403/);
        assert.match(page, /why\?\.code === 'email_not_confirmed'/);
        assert.match(page, /Send me a new confirmation e-mail/);
    });
    test('the button sends the same identifier and password with resend: true', () => {
        assert.match(page, /JSON\.stringify\(\{ identifier, password, resend: true \}\)/);
    });
    test('the button goes away when the message is cleared', () => {
        assert.match(page, /\$\('resend-confirm'\)\?\.remove\(\)/);
    });
});

describe('after the confirmation link', () => {
    const reg = read('shared/js/accounts/register.js');
    test('Request an account asks for the login page as the place the link leads to', () => {
        assert.match(reg, /emailRedirectTo: loginUrl/);
        assert.match(reg, /loginpage\.html\?confirmed=1/);
    });
    test('the login page says the e-mail is confirmed, and does not sign anyone in from the address', () => {
        assert.match(page, /get\('confirmed'\) === '1'/);
        assert.match(page, /Your e-mail address is confirmed/);
        assert.match(page, /detectSessionInUrl: false/);
    });
});

describe('when the e-mail sender fails during registration', () => {
    const reg = read('shared/js/accounts/register.js');
    test('the student is told the account was not created and why, not "check your details"', () => {
        assert.match(reg, /sending confirmation email/);
        assert.match(reg, /so the account was not created/);
    });
});

describe('after the password is saved on the Set password page', () => {
    const pages = read('shared/js/accounts/passwordpages.js');
    const html = read('features/auth/html/setpassword.html');
    test('"Go to log in" opens the right login page with the reset note, for every role', () => {
        for (const p of ['loginpage.html', 'staffloginpage.html', 'adminloginpage.html']) assert.ok(pages.includes(`${p}?reset=1`), p);
        assert.match(html, /id="login-link" href="loginpage\.html\?reset=1"/);
    });
    test('the login pages say the password was changed, and clean the address', () => {
        assert.match(page, /get\('reset'\) === '1'/);
        assert.match(page, /Your password has been changed\. Log in with your new password\./);
    });
});
