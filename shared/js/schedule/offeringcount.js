// offeringcount.js
//
// How many offerings (sections of subjects with a time) the Department has published FOR THE CURRENT TERM and its own
// programme. Pure, so the rule is tested (tests/offeringcount.test.mjs).
//
// The Department dashboard used to count every offering of the programme in every term, so "100 offerings published"
// meant 89 for this term plus 11 for another one, and a term with nothing posted still showed a number.
//
//   forTerm(rows, { year, term }, prefix)
//     rows    [{ section, academic_year, term }]  (subject_offering rows)
//     prefix  the programme's section prefix, e.g. "BSIT-" (compared without regard to case); empty counts every section
//   -> a whole number
//   When the current term is not known (year or term missing) every offering of the programme counts, as before:
//   an unset term must not hide a real schedule.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.CurriculogicOfferingCount = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

function forTerm(rows, current, prefix = '') {
    const wanted = String(prefix ?? '').toLowerCase();
    const year = Number(current?.year);
    const term = Number(current?.term);
    const known = Number.isFinite(year) && year > 0 && Number.isFinite(term) && term > 0;

    return (rows ?? []).filter((o) => {
        if (wanted && !String(o?.section ?? '').toLowerCase().startsWith(wanted)) return false;
        if (!known) return true;
        return Number(o.academic_year) === year && Number(o.term) === term;
    }).length;
}

return { forTerm };

}));
