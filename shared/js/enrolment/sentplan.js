// sentplan.js
//
// A student who already has a plan with the adviser this term and presses Send again is making a SECOND request. That is
// allowed (each request gets its own approval and its own enrolment form), but it is usually a slip, so the page asks
// first. Pure functions: no DOM, no network.
//
//   countThisTerm(requests, term, year) -> { requests, subjects }   what is already with the adviser, or approved
//   secondRequestNote(subjects)         -> the question, in the student's wording
//
// requests: [{ requested_term, requested_year, request_item: [{ status }] }]. A subject the adviser sent back does not
// count: the student is meant to resend it.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.CurriculogicSentPlan = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

function countThisTerm(requests, term, year) {
    let subjects = 0;
    let withSubjects = 0;
    for (const r of requests ?? []) {
        if (Number(r?.requested_term) !== Number(term) || Number(r?.requested_year) !== Number(year)) continue;
        const kept = (r.request_item ?? []).filter((i) => i?.status !== 'rejected').length;
        if (kept > 0) { subjects += kept; withSubjects++; }
    }
    return { requests: withSubjects, subjects };
}

function secondRequestNote(subjects) {
    const n = Number(subjects) || 0;
    return `You already sent ${n} subject${n === 1 ? '' : 's'} to your adviser this term. These subjects will be a second request, `
        + 'and each request has its own approval and its own enrolment form. Send them anyway?';
}

return { countThisTerm, secondRequestNote };
}));
