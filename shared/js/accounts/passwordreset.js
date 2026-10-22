// passwordreset.js
//
// The small pure helpers behind "choose your password by email link": the link
// the email points to, what to say when a link is bad, and what to say when an
// email could not be sent. No page logic, so it is testable without a browser.
//
// How the flow works (security item 6):
//   * The administrator creates an account without typing a password; the
//     database gives it a random one nobody sees (db/072).
//   * The website asks Supabase to email the person a one-time link
//     (auth.resetPasswordForEmail). The link opens setpassword.html with a
//     short-lived session in the address; the page lets them choose a password.
//   * "Forgot password" on the login pages uses the same email and the same page.
//
//   setPasswordUrl(pageHref)   absolute address of setpassword.html, worked out
//                              from the page that is asking (so it follows the
//                              site wherever it is hosted)
//   linkProblem(href)          null when the address has no error in it, else a
//                              plain sentence (expired, already used, ...)
//   sendProblem(error)         plain sentence for a failed email send
//   sendSetupLink(client, email, redirectTo)
//                              asks Supabase to send the email; resolves to
//                              { ok: true } or { ok: false, message }
//   FORGOT_MESSAGE             the one answer the Forgot password page gives,
//                              whether or not the address has an account

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.CurriculogicPasswordReset = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const SET_PASSWORD_PATH = '/features/auth/html/setpassword.html';

/* A mail server that cannot be reached makes Supabase wait about 10 seconds and
   retry, so a send can hang for 40. Stop waiting after this long. */
const SEND_TIMEOUT_MS = 15000;

const SLOW_MESSAGE =
    'The email service did not answer in time. The administrator needs to check the email settings.';

const FORGOT_MESSAGE =
    'If that address belongs to an account, an email with a link to choose a new ' +
    'password is on its way. Check your inbox, and your spam folder.';

/* Where setpassword.html lives for the site the page was loaded from. A page
   anywhere under /features/ gives the site root; otherwise the page's own
   folder is taken as the root (index.html at the top of the site). */
function setPasswordUrl(pageHref) {
    let u;
    try { u = new URL(String(pageHref)); } catch { return ''; }

    const at   = u.pathname.indexOf('/features/');
    const base = at >= 0
        ? u.pathname.slice(0, at)
        : u.pathname.replace(/\/[^/]*$/, '');

    return u.origin + base + SET_PASSWORD_PATH;
}

/* Supabase reports a bad link in the address, after # or after ?:
   #error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired */
function linkProblem(href) {
    let u;
    try { u = new URL(String(href)); } catch { return null; }

    const params = new URLSearchParams(u.hash.replace(/^#/, ''));
    for (const [k, v] of new URLSearchParams(u.search)) if (!params.has(k)) params.set(k, v);

    if (!params.has('error') && !params.has('error_code')) return null;

    const code = String(params.get('error_code') || '').toLowerCase();
    if (code === 'otp_expired' || /expired|invalid/i.test(params.get('error_description') || '')) {
        return 'This link has expired or has already been used. Ask for a new one with "Forgot password" on the login page.';
    }
    return 'This link could not be used. Ask for a new one with "Forgot password" on the login page.';
}

/* A failed send, in words a person can act on. */
function sendProblem(error) {
    if (!error) return null;

    const code = String(error.code || error.error_code || '').toLowerCase();
    const msg  = String(error.message || '').toLowerCase();
    const http = Number(error.status || error.statusCode || 0);

    if (http === 429 || code === 'over_email_send_rate_limit' || /rate limit|too many|only request this after/.test(msg)) {
        return 'Too many emails were sent just now. Wait a minute and try again.';
    }
    if (/error sending|smtp|unexpected_failure/.test(msg) || code === 'unexpected_failure' || http >= 500) {
        return 'The email service could not send the message. The administrator needs to check the email settings.';
    }
    if (/redirect|not allowed/.test(msg)) {
        return 'This website address is not allowed to send links yet. The administrator needs to add it in the email settings.';
    }
    return 'The email could not be sent.';
}

async function sendSetupLink(client, email, redirectTo, timeoutMs = SEND_TIMEOUT_MS) {
    if (!client?.auth?.resetPasswordForEmail) {
        return { ok: false, message: 'Cannot reach the service. Please try again later.' };
    }

    let timer;
    const timedOut = new Promise((resolve) => {
        timer = setTimeout(() => resolve({ ok: false, message: SLOW_MESSAGE }), timeoutMs);
    });

    const attempt = (async () => {
        try {
            const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo });
            return error ? { ok: false, message: sendProblem(error) } : { ok: true };
        } catch (err) {
            return { ok: false, message: sendProblem(err) };
        }
    })();

    try {
        return await Promise.race([attempt, timedOut]);
    } finally {
        clearTimeout(timer);
    }
}

return { setPasswordUrl, linkProblem, sendProblem, sendSetupLink, FORGOT_MESSAGE, SET_PASSWORD_PATH, SEND_TIMEOUT_MS, SLOW_MESSAGE };
}));
