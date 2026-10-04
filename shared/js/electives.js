// electives.js
//
// What counts as an elective slot, decided from a subject's data rather than
// from one programme's naming. Pure functions only, so the curriculum
// builder and the tests share them.
//
// A subject is an elective slot when it is a catalogue entry (no year) or it
// carries an elective type. The type is what the row was given, or what a
// conventional placeholder code implies, with any programme prefix and an
// optional number:
//
//   EL, ELEC, ELECTIVE  ->  'IT'    (a programme elective)
//   FRE, FREE           ->  'FREE'
//
// so IT-EL2, BSN-ELEC and FREE1 all read as slots. 'IT' and 'FREE' are the
// two stored types (subject_elective_type_check in the database).

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.CurriculogicElectives = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const PLACEHOLDER_FREE = /^((?:[A-Z0-9]+-)?(?:FRE|FREE))(\d*)$/;
const PLACEHOLDER_IT   = /^((?:[A-Z0-9]+-)?(?:ELECTIVE|ELEC|EL))(\d*)$/;

/* { base, num, type } for a placeholder-shaped code, else null. num is null
   when the code is not numbered yet. */
function placeholderOf(code) {
    const c = String(code ?? '').trim().toUpperCase();
    let m = c.match(PLACEHOLDER_FREE);
    if (m) return { base: m[1], num: m[2] ? Number(m[2]) : null, type: 'FREE' };
    m = c.match(PLACEHOLDER_IT);
    if (m) return { base: m[1], num: m[2] ? Number(m[2]) : null, type: 'IT' };
    return null;
}

/* A builder row is { code, year, electiveType }. */
function electiveTypeOf(row) {
    if (row.electiveType === 'IT' || row.electiveType === 'FREE') return row.electiveType;
    return placeholderOf(row.code)?.type ?? null;
}

const isElectiveRow = (row) => row.year === null || electiveTypeOf(row) !== null;

/* A stored subject is { is_elective, elective_type }. Some were saved with
   an elective type but is_elective left false (the builder's save-draft path
   used to do that), so either one marks a slot. */
const isElectiveSubject = (s) => s.is_elective === true || s.elective_type != null;

return { placeholderOf, electiveTypeOf, isElectiveRow, isElectiveSubject };

}));
