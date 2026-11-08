// passwordrules.js
//
// The one password rule, used by the register page, every dashboard's
// change-password box and the admin's Create account form and bulk upload.
// Pure functions only, so they are testable without a browser.
//
//   - at least 8 characters, with at least one letter, one number and one special character
//   - an ADMIN account needs at least 12 characters (same special character rule)
//   - spaces do not count toward the minimum: 8 spaces and a ! is not a password
//   - at most 72 BYTES: bcrypt ignores everything after that, and an accented
//     letter is 2 bytes, a Japanese character 3, an emoji 4
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

/* Length bcrypt sees: UTF-8 bytes, not characters. */
const byteLength = (password) => new TextEncoder().encode(String(password ?? '')).length;

/* Characters that are not whitespace; only these count toward the minimum. */
const visibleLength = (password) => [...String(password ?? '').replace(/\s/g, '')].length;

/* Not a letter, digit or space (any alphabet). */
const hasSpecial = (password) => /[^\p{L}\p{N}\s]/u.test(String(password ?? ''));
const hasLetter  = (password) => /\p{L}/u.test(String(password ?? ''));
const hasDigit   = (password) => /\p{N}/u.test(String(password ?? ''));

/* null when the password is acceptable, otherwise a plain sentence. */
function problem(password, role) {
    const pw  = typeof password === 'string' ? password : '';
    const min = minLength(role);
    if (visibleLength(pw) < min) {
        return `Password must be at least ${min} characters` + (/\s/.test(pw) ? ' (spaces do not count).' : '.');
    }
    if (byteLength(pw) > MAX) {
        return `Password must be at most ${MAX} bytes (accented, emoji and non-Latin characters count as 2 to 4 each).`;
    }
    if (!hasSpecial(pw)) return 'Password must include a special character, such as ! @ # $ or %.';
    if (!hasLetter(pw))  return 'Password must include a letter.';
    if (!hasDigit(pw))   return 'Password must include a number.';
    return null;
}

/* The line shown under a password field. */
function hint(role) {
    return `At least ${minLength(role)} characters, with a letter, a number and a special character (! @ # $ %).`;
}

const LETTERS  = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz';
const DIGITS   = '23456789';
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
    const pool   = LETTERS + DIGITS + SPECIALS;

    // One letter, one number and one special character first, each in its own random position, so every
    // password has all three; the other positions are drawn from the whole pool.
    const chars = Array.from({ length }, () => pool[rand(pool.length)]);
    const free  = Array.from({ length }, (_, i) => i);
    const spot  = () => free.splice(rand(free.length), 1)[0];
    chars[spot()] = LETTERS[rand(LETTERS.length)];
    chars[spot()] = DIGITS[rand(DIGITS.length)];
    chars[spot()] = SPECIALS[rand(SPECIALS.length)];
    return chars.join('');
}

return { MIN, MIN_ADMIN, MAX, minLength, byteLength, hasSpecial, hasLetter, hasDigit, problem, hint, generate };
}));
