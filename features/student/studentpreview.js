// student-preview.js — fixture data for the student dashboard preview.
//
// Load before studentdashboard.js. Only used when the page is opened
// with ?preview on localhost; it never runs against the live database.
//
// The earlier fixtures used subject codes (IT 111, IT 112) that are not
// in the BSIT prospectus, so the engine matched nothing and the
// eligibility card rendered as though the student had no history. These
// use the real ids from the subject table.
//
// The history is built to exercise every state the engine can produce:
//
//   passed     first year, less one subject
//   failed     CC-COMPROG12, which blocks IT-OOPROG21 and IT-SAD21
//   enrolled   CC-DIGILOG21 and CC-ACCTG21, in progress this term
//   eligible   CC-TWRITE21, RIZAL 101, SOCIO 101, PE 103, CC-QUAMETH22
//   blocked    CC-APPSDEV22 and the rest of second year
//
// The failed subject is the point. It demonstrates the retake ranking,
// and it shows a chain: one unpassed subject holds up four others.

window.CL_PREVIEW = (function () {
'use strict';

const S = (id, code, title, units, year, term) =>
    ({ id, code, title, units, year_level: year, term, is_elective: false });

/* First and second year of BSIT 2023-2024, with live ids. */
const SUBJECTS = [
    S(100, 'CC-COMPROG11', 'Computer Programming 1',                   3, 1, 1),
    S(73,  'CC-INTCOM11',  'Introduction to Computing',                3, 1, 1),
    S(85,  'ENGL 100',     'Communication Arts',                       3, 1, 1),
    S(90,  'IT-WEBDEV11',  'Web Design & Development',                 3, 1, 1),
    S(82,  'MATH 100',     'College Mathematics',                      3, 1, 1),
    S(83,  'NSTP 101',     'National Service Training Program 1',      3, 1, 1),
    S(64,  'PE 101',       'Movement Competency Training (PATHFit 1)', 2, 1, 1),
    S(86,  'PSYCH 101',    'Understanding the Self',                   3, 1, 1),
    S(65,  'SOCIO 102',    'Gender and Society',                       3, 1, 1),

    S(88,  'CC-COMPROG12', 'Computer Programming 2',                   3, 1, 2),
    S(111, 'CC-DISCRET12', 'Discrete Structures',                      3, 1, 2),
    S(59,  'ENGL 101',     'Purposive Communication',                  3, 1, 2),
    S(61,  'ENTREP 101',   'The Entrepreneurial Mind',                 3, 1, 2),
    S(97,  'HIST 101',     'Readings in Philippine History',           3, 1, 2),
    S(75,  'HUM 101',      'Art Appreciation',                         3, 1, 2),
    S(72,  'MATH 101',     'Mathematics in the Modern World',          3, 1, 2),
    S(103, 'NSTP 102',     'National Service Training Program 2',      3, 1, 2),
    S(74,  'PE 102',       'Exercise-based Fitness Activities (PATHFit 2)', 2, 1, 2),

    S(95,  'CC-ACCTG21',   'Accounting for IT',                        3, 2, 1),
    S(99,  'CC-DIGILOG21', 'Digital Logic Design',                     3, 2, 1),
    S(66,  'CC-TWRITE21',  'Technical Writing & Presentation Skills in IT', 3, 2, 1),
    S(87,  'IT-OOPROG21',  'Object Oriented Programming',              3, 2, 1),
    S(69,  'IT-SAD21',     'System Analysis & Design',                 3, 2, 1),
    S(80,  'PE 103',       'Sports and Dance (PATHFit 3)',             2, 2, 1),
    S(92,  'RIZAL 101',    'Life, Works & Writings of Dr. Jose Rizal', 3, 2, 1),
    S(102, 'SOCIO 101',    'The Contemporary World',                   3, 2, 1),

    S(77,  'CC-APPSDEV22', "Applications Dev't & Emerging Tech.",      3, 2, 2),
    S(96,  'CC-DASTRUC22', 'Data Structures & Algorithms',             3, 2, 2),
    S(110, 'CC-DATACOM22', 'Data Communications',                      3, 2, 2),
    S(94,  'CC-QUAMETH22', 'Quantitative Methods w/ Prob. Stat.',      3, 2, 2),
    S(107, 'IT-PLATECH22', 'Platform Technologies w/ Op. Sys.',        3, 2, 2),
    S(104, 'PE 104',       'Sports/Outdoor Adventure (PATHFit 4)',     2, 2, 2),
    S(78,  'PHILO 101',    'Ethics',                                   3, 2, 2),
    S(116, 'STS 101',      'Science, Technology & Society',            3, 2, 2),
];

const R = (subject, requires, group = 1) => ({
    subject_id: subject,
    prerequisite_subject_id: requires,
    requirement_type: 'prerequisite',
    rule_type: 'and',
    rule_group: group,
    threshold_value: null,
});

const RULES = [
    R(88,  100),          // CC-COMPROG12 <- CC-COMPROG11
    R(111, 73),           // CC-DISCRET12 <- CC-INTCOM11
    R(59,  85),           // ENGL 101     <- ENGL 100
    R(72,  82),           // MATH 101     <- MATH 100
    R(103, 83),           // NSTP 102     <- NSTP 101
    R(74,  64),           // PE 102       <- PE 101

    R(99,  111),          // CC-DIGILOG21 <- CC-DISCRET12
    R(87,  88),           // IT-OOPROG21  <- CC-COMPROG12
    R(69,  88),           // IT-SAD21     <- CC-COMPROG12
    R(95,  72),           // CC-ACCTG21   <- MATH 101
    R(66,  59,  1),       // CC-TWRITE21  <- ENGL 101 and
    R(66,  73,  2),       //                 CC-INTCOM11
    R(80,  74),           // PE 103       <- PE 102

    R(94,  111),          // CC-QUAMETH22 <- CC-DISCRET12
    R(107, 99),           // IT-PLATECH22 <- CC-DIGILOG21
    R(77,  87,  1),       // CC-APPSDEV22 <- IT-OOPROG21 and
    R(77,  69,  2),       //                 IT-SAD21
    R(96,  87),           // CC-DASTRUC22 <- IT-OOPROG21
    R(110, 99),           // CC-DATACOM22 <- CC-DIGILOG21
    R(104, 80),           // PE 104       <- PE 103
];

const byId = new Map(SUBJECTS.map(s => [s.id, s]));

const rec = (id, status, grade, year, term) => {
    const s = byId.get(id);
    return {
        id: 'pv-' + id,
        subject_id: id,
        subject: { code: s.code, title: s.title, units: s.units },
        subject_code: s.code,
        subject_title: s.title,
        units: s.units,
        grade: grade === null ? null : grade.toFixed(2),
        grade_points: grade,
        status,
        taken_year: year,
        taken_term: term,
    };
};

/* First year, less CC-COMPROG12. Two second-year subjects in progress. */
const RECORDS = [
    rec(73,  'PASSED', 1.75, 2025, 1),
    rec(100, 'PASSED', 2.25, 2025, 1),
    rec(85,  'PASSED', 2.00, 2025, 1),
    rec(90,  'PASSED', 1.50, 2025, 1),
    rec(82,  'PASSED', 2.50, 2025, 1),
    rec(83,  'PASSED', 1.25, 2025, 1),
    rec(64,  'PASSED', 1.00, 2025, 1),
    rec(86,  'PASSED', 2.00, 2025, 1),
    rec(65,  'PASSED', 1.75, 2025, 1),

    rec(111, 'PASSED', 2.25, 2025, 2),
    rec(59,  'PASSED', 1.75, 2025, 2),
    rec(61,  'PASSED', 2.00, 2025, 2),
    rec(97,  'PASSED', 1.50, 2025, 2),
    rec(75,  'PASSED', 2.00, 2025, 2),
    rec(72,  'PASSED', 2.75, 2025, 2),
    rec(103, 'PASSED', 1.25, 2025, 2),
    rec(74,  'PASSED', 1.00, 2025, 2),

    // The one that did not pass. It blocks four second-year subjects.
    rec(88,  'FAILED', 5.00, 2025, 2),

    rec(99,  'ENROLLED', null, 2026, 1),
    rec(95,  'ENROLLED', null, 2026, 1),
];

return {
    STUDENT: {
        first_name: 'Althea', last_name: 'Villanueva',
        student_id: '2401187', email: 'althea1@gmail.com',
        year_level: 2, is_approved: true, record_verified: true,
    },
    EMAIL: 'althea1@gmail.com',
    RECORDS,
    KB: { subjects: SUBJECTS, rules: RULES, offerings: [] },
};

})();