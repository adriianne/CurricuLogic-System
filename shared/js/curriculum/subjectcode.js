// subjectcode.js
//
// How a subject code is cleaned and how two codes are compared. Used by the
// curriculum builder; pure functions only, so they are testable without a
// browser.
//
// Real codes in this system do not share one style: ENGL 101, CC-DATACOM22,
// IT-NETWORK31, CRIM OJT 411. The separators belong to the programme, so the
// code is kept as it was typed, apart from the cleaning below. Two codes are
// the SAME subject when their letters and digits match, whatever sits between
// them: ENGL 101, ENGL-101 and ENGL101 are one subject, and a curriculum may
// hold only one of them.
//
//   clean(raw)  the code as it is stored and shown: full-width letters and
//               digits made normal, every kind of dash made "-", invisible
//               characters dropped, runs of spaces made one, upper case
//   key(raw)    letters and digits only; what two codes are compared by
//   problem(raw) null when the code is acceptable, otherwise a plain sentence
//
// The database enforces the same shape and the same uniqueness (db/062).

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.CurriculogicSubjectCode = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const MAX = 20;

/* Hyphen look-alikes: hyphen, non-breaking hyphen, figure dash, en dash,
   em dash, horizontal bar, minus sign. */
const DASHES    = new RegExp('[\\u2010-\\u2015\\u2212]', 'g');
const INVISIBLE = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u2064\\ufeff]', 'g');

const SHAPE = /^[A-Z][A-Z0-9 _-]*$/;

function clean(raw) {
    return String(raw ?? '')
        .normalize('NFKC')
        .replace(DASHES, '-')
        .replace(INVISIBLE, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toUpperCase();
}

const key = (raw) => clean(raw).replace(/[^A-Z0-9]/g, '');

function problem(raw) {
    const code = clean(raw);
    if (!code)               return 'Code is required.';
    if (code.length > MAX)   return `Code must be at most ${MAX} characters.`;
    if (!SHAPE.test(code))   return 'Use letters, digits, hyphens and spaces only, starting with a letter.';
    return null;
}

return { MAX, clean, key, problem };

}));
