// subjectgroups.js
// Groups a curriculum's subjects by year and semester for the Department's
// Subjects list, so it can be read like the printed prospectus.
//
//   const g = CurriculogicSubjectGroups.group(subjects);
//   g.years     [{ year, label, subjects, units, semesters: [{ key, label, rows, subjects, units }] }]
//   g.electives { subjects, groups: [{ key, label, rows, subjects, units }] }   // the catalogue: no year
//
// Totals count active subjects only; a retired subject stays in `rows` so it can
// still be opened, but does not add to the counts or the units.
// Pure functions, so they are unit-tested.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.CurriculogicSubjectGroups = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const YEAR_LABEL = { 1: 'I — First Year', 2: 'II — Second Year', 3: 'III — Third Year',
                     4: 'IV — Fourth Year', 5: 'V — Fifth Year', 6: 'VI — Sixth Year' };
const TERM_LABEL = { 1: '1st Semester', 2: '2nd Semester', 3: 'Summer' };

const live = (s) => s.is_active !== false;

function totals(rows) {
    const active = rows.filter(live);
    return {
        subjects: active.length,
        units: active.reduce((t, s) => t + (Number(s.units) || 0), 0),
    };
}

const panel = (key, label, rows) => ({ key, label, rows, ...totals(rows) });

function group(subjects) {
    const all = subjects ?? [];
    const placed = all.filter(s => s.year_level != null);

    const years = [...new Set(placed.map(s => s.year_level))]
        .sort((a, b) => a - b)
        .map((year) => {
            const inYear = placed.filter(s => s.year_level === year);
            const semesters = [
                panel('1', TERM_LABEL[1], inYear.filter(s => s.term === 1)),
                panel('2', TERM_LABEL[2], inYear.filter(s => s.term === 2)),
            ];
            const summer = inYear.filter(s => s.term === 3);
            if (summer.length) semesters.push(panel('3', TERM_LABEL[3], summer));
            // A subject with a year but no semester must not vanish from the list.
            const unplaced = inYear.filter(s => ![1, 2, 3].includes(s.term));
            if (unplaced.length) semesters.push(panel('none', 'No semester set', unplaced));
            return { year, label: YEAR_LABEL[year] ?? `Year ${year}`, ...totals(inYear), semesters };
        });

    const catalogue = all.filter(s => s.year_level == null);
    const groups = [];
    const it = catalogue.filter(s => s.elective_type !== 'FREE');
    const free = catalogue.filter(s => s.elective_type === 'FREE');
    if (it.length) groups.push(panel('it', 'Programme elective courses', it));
    if (free.length) groups.push(panel('free', 'Free elective courses', free));

    return { years, electives: { ...totals(catalogue), groups } };
}

return { group, totals, YEAR_LABEL, TERM_LABEL };
}));
