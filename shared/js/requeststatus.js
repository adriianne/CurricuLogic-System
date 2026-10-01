// requeststatus.js
//
// Where an enrollment request stands, as the student, adviser, department and
// Registrar pages all show it. Pure functions only, so the rule is the same
// everywhere and can be tested without a browser.
//
// THE RULE
//   The adviser's approval is final. A request is submitted, then the adviser
//   approves it (wholly or in part) or rejects it, and that is the end:
//   an approved plan is approved for enrollment and its form can be printed.
//   The Registrar is not a second approval. Their part is earlier: confirming
//   who the student is and that their record is right (account approval and
//   record verification), which decides whether the student can request at all.
//
// HISTORY
//   Plans used to need a second, Registrar approval, and a few were sent back
//   by the Registrar (registrar_status = 'rejected'). Those stay closed and
//   say so. Nothing writes registrar_status any more; 'approved' and null
//   both just mean "approved by the adviser".

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.CurriculogicRequestStatus = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

/* request.status is submitted | approved | partially_approved | rejected. */
const adviserApproved = (r) => r?.status === 'approved' || r?.status === 'partially_approved';

/* An older plan the Registrar sent back. It is closed: the student sends a new one. */
const sentBack = (r) => r?.registrar_status === 'rejected';

/* Approved for enrollment: approved by the adviser, and not one of the old
   sent-back plans. This is the one question "can this plan be printed / is
   this student taking these subjects" needs. */
const finalApproved = (r) => adviserApproved(r) && !sentBack(r);

/* Still waiting for a decision. Only the adviser can be holding it now. */
const waiting = (r) => r?.status === 'submitted';

/* The chips a request shows: { faculty, registrar }.
   `faculty` is the one real stage (kept under that name so existing markup
   works); `registrar` is null except for an old sent-back plan. */
function stages(r) {
    const faculty = {
        submitted:          { label: 'Awaiting adviser',               chip: 'info'   },
        rejected:           { label: 'Rejected by adviser',            chip: 'danger' },
        approved:           { label: 'Approved for enrollment',        chip: 'ok'     },
        partially_approved: { label: 'Partly approved for enrollment', chip: 'ok'     },
    }[r?.status] ?? { label: r?.status ?? 'Sent', chip: 'info' };

    // An old plan the Registrar sent back is not approved for enrollment: say
    // what the adviser did, then the red step, so the two chips never contradict.
    if (adviserApproved(r) && sentBack(r)) {
        faculty.label = r.status === 'approved' ? 'Approved by adviser' : 'Partly approved by adviser';
        return { faculty, registrar: { label: 'Sent back by Registrar', chip: 'danger' } };
    }

    return { faculty, registrar: null };
}

return { adviserApproved, sentBack, finalApproved, waiting, stages };

}));
