// emailrules.js
//
// The one rule for an email address typed into the register page, the admin's
// Create account form and the admin's bulk upload. Pure functions only, so they
// are testable without a browser.
//
// The old check was "something, an @, something, a dot, something", which let
// through "a@b.c", "a@@b.com", "x..y@school.edu", "a@-b.com", an address with
// quotes, angle brackets or spaces inside it, and an address of any length.
//
//   clean(raw)    what is stored: invisible characters dropped, full-width
//                 characters made normal, trimmed, lower case
//   problem(raw)  null when the address is acceptable, otherwise a plain sentence
//
// The rule, in words:
//   - exactly one @
//   - before it: letters, digits and . ! # $ % & ' * + / = ? ^ _ ` { | } ~ -
//     (at most 64 characters), no dot at either end and no two dots in a row
//   - after it: two or more parts joined by dots; each part is letters, digits
//     and hyphens (1-63 characters), not starting or ending with a hyphen; the
//     last part is letters only and at least 2 long
//   - at most 254 characters in all
//   - plain ASCII only; an internationalised address has to be given in its
//     punycode form (xn--...)
//
// The database enforces the same rule on the email columns (db/063).

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.CurriculogicEmailRules = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const MAX       = 254;
const MAX_LOCAL = 64;

const INVISIBLE = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u2064\\ufeff]', 'g');

const LOCAL  = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/;
const LABEL  = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const TLD    = /^[a-z]{2,}$/;

function clean(raw) {
    return String(raw ?? '')
        .normalize('NFKC')
        .replace(INVISIBLE, '')
        .trim()
        .toLowerCase();
}

const INVALID = 'That does not look like a valid email address.';

function problem(raw) {
    const email = clean(raw);
    if (!email)             return 'Enter an email address.';
    if (email.length > MAX) return `The email address must be at most ${MAX} characters.`;

    const parts = email.split('@');
    if (parts.length !== 2) return INVALID;
    const [local, domain] = parts;

    if (!local || local.length > MAX_LOCAL || !LOCAL.test(local)) return INVALID;
    if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) return INVALID;

    const labels = domain.split('.');
    if (labels.length < 2 || !labels.every(l => LABEL.test(l))) return INVALID;
    if (!TLD.test(labels[labels.length - 1])) return INVALID;

    return null;
}

return { MAX, MAX_LOCAL, clean, problem };

}));
