// passwordrules.js
//
// The one password rule, used by the register page, every dashboard's
// change-password box and the admin's Create account form and bulk upload.
// Pure functions only, so they are testable without a browser.
//
//   - at least 8 characters, and at least one special character
//   - an ADMIN account needs at least 12 characters (same special character rule)
//   - at most 72: bcrypt ignores everything after that
//
// A special character is anything that is not a letter, a digit or a space.
//
// This is a browser-side check. The same rule is enforced again by the
// database for accounts an administrator creates (db/049). A student's own
// sign-up and password change go straight to Supabase Auth, which can only
// require a minimum length, so for those two the browser is the only place
// the special character is checked.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.CurriculogicPasswordRules = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const MIN       = 8;
const MIN_ADMIN = 12;
const MAX       = 72;

const isAdmin   = (role) => String(role ?? '').trim().toLowerCase() === 'admin';
const minLength = (role) => (isAdmin(role) ? MIN_ADMIN : MIN);

/* Not a letter, digit or space (any alphabet). */
const hasSpecial = (password) => /[^\p{L}\p{N}\s]/u.test(String(password ?? ''));

/* null when the password is acceptable, otherwise a plain sentence. */
function problem(password, role) {
    const pw  = typeof password === 'string' ? password : '';
    const min = minLength(role);
    if (pw.length < min) return `Password must be at least ${min} characters.`;
    if (pw.length > MAX) return `Password must be at most ${MAX} characters.`;
    if (!hasSpecial(pw)) return 'Password must include a special character, such as ! @ # $ or %.';
    return null;
}

/* The line shown under a password field. */
function hint(role) {
    return `At least ${minLength(role)} characters, including a special character (! @ # $ %).`;
}

const LETTERS  = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
const SPECIALS = '!@#$%';

/* A random password that passes problem(). `pick(n)` returns an integer in
   [0, n); it defaults to the browser's crypto source. Passing one in is for
   tests. */
function generate(role, pick) {
    const rand = pick ?? ((n) => {
        const buf = new Uint32Array(1);
        globalThis.crypto.getRandomValues(buf);
        return buf[0] % n;
    });
    const length = isAdmin(role) ? 14 : 10;
    const pool   = LETTERS + SPECIALS;

    const chars = [];
    for (let i = 0; i < length; i++) chars.push(pool[rand(pool.length)]);
    // The pool is mostly letters, so most draws contain no special character:
    // make sure there is one, in a random position.
    if (!chars.some((c) => SPECIALS.includes(c))) {
        chars[rand(length)] = SPECIALS[rand(SPECIALS.length)];
    }
    return chars.join('');
}

return { MIN, MIN_ADMIN, MAX, minLength, hasSpecial, problem, hint, generate };
}));
