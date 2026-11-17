// termorder.js
//
// The "same time or later" rule of the Department's integrity check: a subject may not require a prerequisite that is
// scheduled in the same semester or a later one.
//
// A subject can only be put in order when it HAS a year and a semester. The courses of the elective lists (the IT
// electives and the free electives) belong to no year or semester by design, shown as "—" in the tables. Comparing
// them used to read a missing term as 0, so every elective that required anything was reported as "scheduled at the same
// time or later" (13 false alarms on the 2020-2021 curriculum on 17 Nov 2026, for example ELIBM2 requiring ELIBM1, where
// neither has a term). A pair is compared only when BOTH subjects are placed; for the others the order cannot be judged,
// so nothing is reported. Cycles and a subject requiring itself are separate checks and are not affected.
//
// Pure function, so it is tested without a browser.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.CurriculogicTermOrder = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const placed = (s) => Number.isInteger(s?.year_level) && Number.isInteger(s?.term);
const position = (s) => s.year_level * 10 + s.term;

/* true when `subject` requires `prerequisite` but the prerequisite is not in an EARLIER semester.
   A "taken alongside" (co_requisite) condition may share the same semester; only a later one is wrong. */
function isOutOfOrder(subject, prerequisite, requirementType) {
    if (!placed(subject) || !placed(prerequisite)) return false;
    return requirementType === 'co_requisite'
        ? position(prerequisite) > position(subject)
        : position(prerequisite) >= position(subject);
}

return { isOutOfOrder, placed, position };
}));
