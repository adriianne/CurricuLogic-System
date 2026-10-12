// recordgrades.js
// Turns a student's academic_record rows into "the grade to show" for each subject,
// so the curriculum grid can carry a Grade column next to Status.
//
//   const grades = CurriculogicRecordGrades.byStudent(records);   // Map subject_id -> { grade, tone, title }
//   grades.get(subject.id)  // { grade: '1.75', tone: 'pass', title: '1st Sem · 2022' }
//
// Which attempt is shown:
//   a passing attempt (the latest one if there are several), otherwise the latest attempt.
// What is shown:
//   grade points when there are any (1.75), otherwise the grade as written. A subject
//   still being taken has no grade yet, so its cell stays empty (Status already says "Taking").
// tone: 'pass' | 'fail' | '' (colours the cell).
//
// Pure functions, no browser needed, so they are unit-tested.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.CurriculogicRecordGrades = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const TERM = { 1: '1st Sem', 2: '2nd Sem', 3: 'Summer' };

const when = (r) => Number(r.taken_year) * 10 + Number(r.taken_term || 0);

const gradeText = (r) => {
    if (r.grade_points != null && r.grade_points !== '' && Number.isFinite(Number(r.grade_points))) {
        return Number(r.grade_points).toFixed(2);
    }
    return r.grade != null && String(r.grade).trim() !== '' ? String(r.grade).trim() : '';
};

const titleOf = (r) => {
    const t = TERM[r.taken_term] ?? '';
    const y = r.taken_year ?? '';
    return [t, y].filter(Boolean).join(' · ');
};

/* The cell for one subject, from all of this student's rows for it. */
function pick(rows) {
    const mine = (rows ?? []).filter(Boolean);
    if (!mine.length) return null;

    const latest = (list) => list.reduce((a, b) => (when(b) >= when(a) ? b : a));

    const passed = mine.filter(r => r.status === 'PASSED');
    if (passed.length) {
        const r = latest(passed);
        return { grade: gradeText(r) || 'Passed', tone: 'pass', title: titleOf(r) };
    }

    const r = latest(mine);
    if (r.status === 'FAILED') return { grade: gradeText(r) || 'Failed', tone: 'fail', title: titleOf(r) };
    if (r.status === 'DROPPED') return { grade: 'Dropped', tone: '', title: titleOf(r) };
    return null;   // enrolled (no grade yet) or an unknown status
}

/* The status chip for one record row, in the same look as the curriculum grid. */
const CHIPS = {
    PASSED:   ['ok',     'Passed'],
    FAILED:   ['locked', 'Failed'],
    DROPPED:  ['',       'Dropped'],
    ENROLLED: ['info',   'Taking'],
};
const chipFor = (status) => CHIPS[status] ?? ['', status ? String(status) : '—'];

/* The record as a transcript: one group per term, newest first, each with its rows
   in code order and its own counts. Rows with no year are gathered last.
   returns [{ key, label, rows, subjects, passed, unitsEarned }] */
function groupByTerm(records) {
    const groups = new Map();
    for (const r of records ?? []) {
        const known = r.taken_year != null && r.taken_year !== '';
        const key = known ? `${r.taken_year}-${r.taken_term ?? 0}` : 'unknown';
        if (!groups.has(key)) {
            groups.set(key, {
                key,
                label: known ? titleOf(r) : 'Term not recorded',
                order: known ? when(r) : -1,
                rows: [],
            });
        }
        groups.get(key).rows.push(r);
    }
    return [...groups.values()]
        .sort((a, b) => b.order - a.order)
        .map(({ order, ...g }) => {
            const rows = [...g.rows].sort((a, b) =>
                String(a.subject_code ?? '').localeCompare(String(b.subject_code ?? '')));
            const passed = rows.filter(r => r.status === 'PASSED');
            return {
                ...g,
                rows,
                subjects: rows.length,
                passed: passed.length,
                unitsEarned: passed.reduce((t, r) => t + (Number(r.units) || 0), 0),
            };
        });
}

function byStudent(records) {
    const groups = new Map();
    for (const r of records ?? []) {
        if (r?.subject_id == null) continue;
        if (!groups.has(r.subject_id)) groups.set(r.subject_id, []);
        groups.get(r.subject_id).push(r);
    }
    const out = new Map();
    for (const [id, rows] of groups) {
        const p = pick(rows);
        if (p) out.set(id, p);
    }
    return out;
}

/* Put each subject's grade on its status entry (a Map subject_id -> { state, detail }).
   A filled elective slot takes the grade of the subject that filled it. Marks the map
   so the grid shows the Grade column. */
function attach(statuses, records) {
    const grades = byStudent(records);
    for (const [id, st] of statuses) {
        const g = grades.get(st.filledBy?.id ?? id);
        if (g) { st.grade = g.grade; st.gradeTone = g.tone; st.gradeTitle = g.title; }
    }
    statuses.showGrade = true;
    return statuses;
}

return { pick, byStudent, attach, gradeText, groupByTerm, chipFor };
}));
