// subjectcategory.js
//
// The kind of course a subject is (General Education, Core Computing, Professional, Elective), as a curriculum
// prints it with a colour and totals in its "Summary of Courses". The AI curriculum reader returns one per
// subject; the database only accepts the five values below, so whatever the reader sends is cleaned here and
// anything unrecognised becomes null (no category) rather than being guessed or rejected.
//
//   CurriculogicSubjectCategory.clean('Core Computing')   // 'COMMON_COMPUTING'
//   CurriculogicSubjectCategory.clean('banana')           // null

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.CurriculogicSubjectCategory = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

/* The values the database accepts (subject_category_check). */
const CATEGORIES = ['GE', 'COMMON_COMPUTING', 'PROFESSIONAL_IT', 'ELECTIVE', 'OTHER'];

/* Other ways the same kind of course is written. */
const ALIASES = {
    GENERAL_EDUCATION: 'GE',
    GENERAL_EDUCATION_COURSES: 'GE',
    GEC: 'GE',
    CORE_COMPUTING: 'COMMON_COMPUTING',
    CORE_COMPUTING_COURSES: 'COMMON_COMPUTING',
    COMMON_COMPUTING_COURSES: 'COMMON_COMPUTING',
    COMPUTING: 'COMMON_COMPUTING',
    PROFESSIONAL: 'PROFESSIONAL_IT',
    PROFESSIONAL_COURSES: 'PROFESSIONAL_IT',
    PROFESSIONAL_IT_COURSES: 'PROFESSIONAL_IT',
    ELECTIVES: 'ELECTIVE',
    IT_ELECTIVE: 'ELECTIVE',
    FREE_ELECTIVE: 'ELECTIVE',
};

function clean(value) {
    if (value == null) return null;
    const key = String(value).trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (!key) return null;
    if (CATEGORIES.includes(key)) return key;
    return ALIASES[key] ?? null;
}

return { clean, CATEGORIES };

}));
