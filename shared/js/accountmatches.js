// accountmatches.js
//
// For the Registrar's Account requests screen: given one pending request and
// the other student accounts the Registrar can see, which of them look like the
// same person? A match is a prompt to look closer, not a verdict: the Registrar
// still decides, against the school's own records.
//
//   same_id     the typed student ID is already on another account
//   same_email  the e-mail address is already on another account
//   same_name   first and last name are the same (ignoring case, spacing, accents)
//
// Pure functions only, so they are testable without a browser.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.CurriculogicAccountMatches = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const norm = (s) => String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();

const nameKey = (p) => norm(p?.first_name) + '|' + norm(p?.last_name);

/** Other accounts that look like the request's person, strongest reason first. */
function findMatches(request, others) {
    if (!request) return [];
    const myName  = nameKey(request);
    const hasName = myName.replace('|', '') !== '';
    const myEmail = norm(request.email);
    const myId    = String(request.student_id ?? '').trim();
    const out = [];

    for (const o of others || []) {
        if (!o || o.id === request.id) continue;
        const reasons = [];
        if (myId && String(o.student_id ?? '').trim() === myId) reasons.push('same_id');
        if (myEmail && norm(o.email) === myEmail)               reasons.push('same_email');
        if (hasName && nameKey(o) === myName) reasons.push('same_name');
        if (reasons.length) out.push({ account: o, reasons });
    }

    const weight = (m) => m.reasons.includes('same_id') ? 0 : m.reasons.includes('same_email') ? 1 : 2;
    return out.sort((a, b) => weight(a) - weight(b));
}

const REASON_TEXT = {
    same_id:    'same student ID',
    same_email: 'same e-mail',
    same_name:  'same name',
};

const reasonText = (reasons) => reasons.map((r) => REASON_TEXT[r] || r).join(', ');

return { findMatches, reasonText, REASON_TEXT };
}));
