// curriculumstart.js
//
// Whether a student's curriculum has not started yet, so they cannot choose
// subjects from it. Pure: no DOM, no network. The website, assess-student and
// submit-advising-request all call it, so the three cannot disagree.
//
// A curriculum version has an effective year. One whose year is later than the
// current academic year is post-dated. An existing student already on such a
// version keeps working; the rule is for a student who has no curriculum of
// their own yet (placed on the programme's active version) or who has no
// academic record yet. Those are the students a post-dated active version
// would otherwise catch.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.CurriculogicCurriculumStart = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

/* curriculumYear: the effective year of the version the student would use.
   currentYear:    the system's current academic year.
   ownProspectus:  true when the student has their own prospectus_id.
   recordCount:    how many academic-record rows the student has.
   Unknown years are never a reason to refuse. */
function notStarted({ curriculumYear, currentYear, ownProspectus, recordCount }) {
    if (!Number.isInteger(curriculumYear) || !Number.isInteger(currentYear)) return false;
    if (curriculumYear <= currentYear) return false;
    return !ownProspectus || !(recordCount > 0);
}

function message(curriculumYear) {
    return `The curriculum for your programme takes effect in ${curriculumYear}–${curriculumYear + 1}, ` +
           'so you cannot choose subjects from it yet. Please contact your department.';
}

return { notStarted, message };

}));
