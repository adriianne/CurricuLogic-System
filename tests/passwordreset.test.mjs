import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const PR = require('../shared/js/accounts/passwordreset.js');

test('setPasswordUrl follows the site the page was loaded from', () => {
    assert.equal(PR.setPasswordUrl('http://localhost:8123/features/admin/admindashboard.html#accounts'),
        'http://localhost:8123/features/auth/html/setpassword.html');
    assert.equal(PR.setPasswordUrl('https://uc.example.edu.ph/features/auth/html/loginpage.html'),
        'https://uc.example.edu.ph/features/auth/html/setpassword.html');
});

test('setPasswordUrl keeps a sub-folder the site is hosted in', () => {
    assert.equal(PR.setPasswordUrl('https://school.example/capstone/features/admin/admindashboard.html'),
        'https://school.example/capstone/features/auth/html/setpassword.html');
    assert.equal(PR.setPasswordUrl('https://school.example/capstone/index.html'),
        'https://school.example/capstone/features/auth/html/setpassword.html');
});

test('setPasswordUrl gives an empty string for something that is not an address', () => {
    assert.equal(PR.setPasswordUrl('not a url'), '');
    assert.equal(PR.setPasswordUrl(undefined), '');
});

test('linkProblem is null for a normal address, including a good recovery link', () => {
    assert.equal(PR.linkProblem('http://x/features/auth/html/setpassword.html'), null);
    assert.equal(PR.linkProblem('http://x/setpassword.html#access_token=abc&type=recovery'), null);
});

test('linkProblem explains an expired or used link, in the hash or the query', () => {
    const hash = 'http://x/setpassword.html#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired';
    assert.match(PR.linkProblem(hash), /expired or has already been used/);
    assert.match(PR.linkProblem('http://x/setpassword.html?error=access_denied&error_code=otp_expired'), /expired or has already been used/);
});

test('linkProblem has a generic sentence for any other error', () => {
    assert.match(PR.linkProblem('http://x/p.html#error=server_error'), /could not be used/);
});

test('sendProblem tells a rate limit from a broken mail setup', () => {
    assert.match(PR.sendProblem({ status: 429, message: 'x' }), /Wait a minute/);
    assert.match(PR.sendProblem({ code: 'over_email_send_rate_limit' }), /Wait a minute/);
    assert.match(PR.sendProblem({ message: 'For security purposes, you can only request this after 45 seconds.' }), /Wait a minute/);
    assert.match(PR.sendProblem({ message: 'Error sending recovery email' }), /administrator needs to check/);
    assert.match(PR.sendProblem({ status: 500, message: 'boom' }), /administrator needs to check/);
    assert.match(PR.sendProblem({ message: 'redirect URL not allowed' }), /not allowed to send links/);
    assert.equal(PR.sendProblem({ message: 'something odd' }), 'The email could not be sent.');
    assert.equal(PR.sendProblem(null), null);
});

test('sendSetupLink passes the address and the page to Supabase', async () => {
    const calls = [];
    const client = { auth: { resetPasswordForEmail: async (email, opts) => { calls.push([email, opts]); return { error: null }; } } };
    const r = await PR.sendSetupLink(client, 'a@b.edu', 'http://x/set.html');
    assert.deepEqual(r, { ok: true });
    assert.deepEqual(calls, [['a@b.edu', { redirectTo: 'http://x/set.html' }]]);
});

test('sendSetupLink turns a failure into a plain message and never throws', async () => {
    const failing = { auth: { resetPasswordForEmail: async () => ({ error: { status: 429, message: 'x' } }) } };
    const r1 = await PR.sendSetupLink(failing, 'a@b.edu', 'http://x/set.html');
    assert.equal(r1.ok, false);
    assert.match(r1.message, /Wait a minute/);

    const throwing = { auth: { resetPasswordForEmail: async () => { throw new Error('Error sending recovery email'); } } };
    const r2 = await PR.sendSetupLink(throwing, 'a@b.edu', 'http://x/set.html');
    assert.equal(r2.ok, false);

    const r3 = await PR.sendSetupLink(null, 'a@b.edu', 'http://x/set.html');
    assert.equal(r3.ok, false);
});

test('the Forgot password answer does not say whether the address has an account', () => {
    assert.match(PR.FORGOT_MESSAGE, /^If that address belongs to an account/);
});

test('sendSetupLink stops waiting when the mail server never answers', async () => {
    const hanging = { auth: { resetPasswordForEmail: () => new Promise(() => {}) } };
    const started = Date.now();
    const r = await PR.sendSetupLink(hanging, 'a@b.edu', 'http://x/set.html', 40);
    assert.equal(r.ok, false);
    assert.equal(r.message, PR.SLOW_MESSAGE);
    assert.match(r.message, /check the email settings/);
    assert.ok(Date.now() - started < 1000);
});

test('a quick answer is not replaced by the timeout message', async () => {
    const quick = { auth: { resetPasswordForEmail: async () => ({ error: null }) } };
    assert.deepEqual(await PR.sendSetupLink(quick, 'a@b.edu', 'http://x/set.html', 40), { ok: true });
});
