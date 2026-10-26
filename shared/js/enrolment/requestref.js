// requestref.js
//
// The reference number of an enrollment request, as the student, adviser, Registrar and the printed
// slip show it: CL-2026-000021. It is only a readable label made from the request's own id and the
// year it was made. Nothing is stored, so every request, old or new, already has one, and the same
// request always gives the same text. Knowing a reference does not give access to anything; the
// database rules decide who may read a request.
//
// Pure functions only, so the rule is the same everywhere and can be tested without a browser.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.CurriculogicRequestRef = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const PREFIX = 'CL';
const DIGITS = 6;

/* The id as a whole number of 1 or more, or null. */
function wholeId(value) {
    const text = String(value ?? '').trim();
    if (!/^\d+$/.test(text)) return null;
    const n = Number(text);
    return Number.isSafeInteger(n) && n >= 1 ? n : null;
}

/* The year the request was made (its created_at, not today), or null when the date is unusable. */
function yearOf(createdAt) {
    if (createdAt == null || createdAt === '') return null;
    // A date-only or zone-less timestamp (the table's own kind) is read as written, so a request made
    // late on 31 Dec never moves to the next year because of the viewer's time zone.
    const m = /^(\d{4})-\d{2}-\d{2}/.exec(String(createdAt));
    if (m) return Number(m[1]);
    const d = new Date(createdAt);
    return Number.isNaN(d.getTime()) ? null : d.getFullYear();
}

/* "CL-2026-000021", or '' when the id or the date cannot make one (the page then shows nothing). */
function format(id, createdAt) {
    const n = wholeId(id);
    const year = yearOf(createdAt);
    if (n === null || year === null) return '';
    return `${PREFIX}-${year}-${String(n).padStart(DIGITS, '0')}`;
}

/* The request id in what someone typed: "CL-2026-000021", "cl 2026 21", "2026-21" or just "21". Null when
   it is not a reference. The year is not checked against the request: the id alone finds it. */
function parse(text) {
    const s = String(text ?? '').trim().toLowerCase();
    if (s === '') return null;
    const m = /^(?:cl[\s-]*)?(?:(\d{4})[\s-]+)?(\d+)$/.exec(s);
    if (!m) return null;
    return wholeId(m[2]);
}

/* For a search box that also searches student IDs: a bare number stays an ID search, so only text that
   starts with CL or carries the year ("CL-2026-21", "2026-21") counts as a reference. Else null. */
function fromSearch(text) {
    const s = String(text ?? '').trim().toLowerCase();
    if (!/^(cl|\d{4}[\s-])/.test(s)) return null;
    return parse(s);
}

return { format, parse, fromSearch };

}));
