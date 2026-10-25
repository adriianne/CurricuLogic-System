// requestreview.js
//
// What the Registrar's account-request card offers while reviewing a request: the reasons that can be
// picked when declining, the rule for the typed reason, and the three checks to tick before approving.
// Pure functions only, so they are testable without a browser.
//
// The ticks are a reminder for the Registrar, not a gate and not saved: Approve works with or without
// them. The decline reason IS saved and shown to the student, so it has to be present and short enough
// for the database (500 characters, db/050).

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.CurriculogicRequestReview = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const MAX_REASON = 500;

/* Written to the student, so each one says what to do next. Picking one fills the box; it can still be
   edited. */
const QUICK_REASONS = [
    { label: 'Not on the EDP list',
      text: 'You are not on the list of students confirmed by the EDP office. Please contact the Registrar to confirm your details.' },
    { label: 'Student ID not found',
      text: 'Student ID not found in the official list. Contact the Registrar to confirm your number.' },
    { label: 'Wrong programme',
      text: 'The degree program you chose does not match our records. Please register again with the correct program.' },
    { label: 'Duplicate request',
      text: 'You already have an account or another pending request. Please sign in, or contact the Registrar.' },
];

/* null when the reason can be saved, otherwise a sentence for the Registrar. */
function reasonProblem(raw) {
    const text = String(raw ?? '').trim();
    if (!text) return 'A reason is required when declining. The student sees it, so say what they can do next.';
    if (text.length > MAX_REASON) {
        return `That reason is ${text.length} characters. Please keep it under ${MAX_REASON}.`;
    }
    return null;
}

/* The three things to look at before approving. The first depends on how the person registered:
   a new student has no ID yet, an existing record typed one. */
function checklist(declaredPath) {
    return [
        declaredPath === 'new'
            ? 'Name is on the incoming student list'
            : 'Student ID matches the official student list',
        'Degree program is correct',
        'No other account is for this person (see the matches above)',
    ];
}

return { MAX_REASON, QUICK_REASONS, reasonProblem, checklist };

}));
