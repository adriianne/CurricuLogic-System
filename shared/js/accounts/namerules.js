// namerules.js
//
// The one rule for a person's first or last name, used by the register page,
// the admin's Create account form and the admin's bulk upload. Pure functions
// only, so they are testable without a browser.
//
//   - letters of any alphabet, marks, spaces, and ' ’ . - , only
//   - at least one letter
//   - at most 60 characters (the same as the form's maxlength)
//   - control and zero-width characters are removed, runs of spaces become one
//
// This is a browser-side check. The same rule is enforced again by the
// database (db/060), so a client that skips the form is refused too.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.CurriculogicNameRules = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const MAX = 60;

/* Control characters and the invisible ones that can hide inside a name. */
const INVISIBLE = new RegExp('[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff]', 'g');
const ALLOWED   = /^[\p{L}\p{M}\s'’.\-,]+$/u;
const HAS_LETTER = /\p{L}/u;

/* What is stored: invisible characters dropped, spaces collapsed, trimmed. */
const clean = (raw) => String(raw ?? '')
    .normalize('NFC')
    .replace(INVISIBLE, '')
    .replace(/\s+/g, ' ')
    .trim();

/* null when the name is acceptable, otherwise a plain sentence.
   `label` is "first name" or "last name". */
function problem(raw, label = 'name') {
    const s = clean(raw);
    if (!s)                    return `Enter a ${label}.`;
    if (s.length > MAX)        return `The ${label} must be at most ${MAX} characters.`;
    if (!HAS_LETTER.test(s))   return `The ${label} must contain at least one letter.`;
    if (!ALLOWED.test(s))      return `The ${label} can only contain letters, spaces, and the characters ' . - ,`;
    return null;
}

/* The MIDDLE name is optional, so a blank one is fine (null). When something is typed it is checked more
   strictly than a first or last name, because it is the field most often mistyped or filled with junk:
     "Cursoara"  ok        "Cas@12"  refused (symbol and digits)    "123124"  refused (digits)
     "Q"         refused   (a single letter is not a name; at least 2 letters)
   - letters, spaces and ' ’ . - , only (same characters as other names)
   - at least 2 letters
   - must start with a letter
   - no two punctuation marks in a row (".." "--" ",,")
   - at most 60 characters */
const MIN_LETTERS = 2;
function middleProblem(raw) {
    const s = clean(raw);
    if (!s)                  return null;
    if (s.length > MAX)      return `The middle name must be at most ${MAX} characters.`;
    if (!ALLOWED.test(s))    return "The middle name can only contain letters, spaces, and the characters ' . - ,";
    const letters = (s.match(/\p{L}/gu) || []).length;
    if (letters < MIN_LETTERS) return `The middle name must have at least ${MIN_LETTERS} letters.`;
    if (!/^\p{L}/u.test(s))  return 'The middle name must start with a letter.';
    if (/['’.\-,]{2,}/u.test(s)) return 'The middle name cannot have two punctuation marks in a row.';
    return null;
}

return { MAX, clean, problem, middleProblem };

}));
