// gradefile.js
//
// How the grade upload works out the shape of a spreadsheet. Pure
// functions only -- no DOM, no Supabase, no SheetJS -- so the rules run in
// the department page and in Node tests.
//
// The upload used to assume the first sheet, header in row 1, and exact
// column names. Real files break all three: Excel adds stray sheets, a
// title or blank row sits above the header, and registrars write "Student
// No" or "Final Grade". This decides those things by looking at the data.
//
//   const found = GradeFile.pickSheet([{ name, aoa }, ...]);
//   // -> { name, aoa, headerIdx, columns } or null
//   GradeFile.normCode('HUM – REP 101')  // 'HUM-REP101'

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.GradeFile = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

/* Canonical column -> the header spellings accepted for it, already in
   normHeader() form. */
const ALIASES = {
    student_id:    ['student_id', 'student_no', 'student_number', 'studentid', 'student_id_no',
                    'student_id_number', 'stud_no', 'stud_id', 'studno', 'id_number', 'id_no', 'id'],
    /* Not 'course' on its own: in a student list that column is usually the
       degree programme (BSIT), not a subject. */
    subject_code:  ['subject_code', 'subject', 'subject_no', 'course_code', 'course_no', 'code',
                    'subjectcode', 'subj_code', 'sub_code', 'subj', 'course_number',
                    'subject_number'],
    grade:         ['grade', 'final_grade', 'final_rating', 'rating', 'grades'],
    /* Not 'remarks' or 'result': those are free text ("Passed with honors")
       and would be rejected as an invalid status. Not 'year': that is
       usually the student's year level, not the academic year. */
    status:        ['status'],
    student_name:  ['student_name', 'name', 'full_name', 'student'],
    /* Not 'semester' or 'sem': that column often holds where the subject
       sits in the curriculum, not the term the grade was earned. */
    term:          ['term'],
    academic_year: ['academic_year', 'school_year', 'ay', 's_y', 'sy'],
};

const REQUIRED = ['student_id', 'subject_code'];

/* A class list names its subject once, above the table, so the rows carry no
   subject column: the subject is chosen on the page instead. Such a sheet
   still needs the student ID, and something that makes it a grade table and
   not any list with an ID in it. */
const CLASS_LIST_ALSO = ['grade', 'status', 'student_name'];

/* A header is looked for in the first rows only; a data row further down
   that happens to say "student_id" must not be mistaken for it. */
const HEADER_SCAN_ROWS = 15;

/* 'Student No.' -> 'student_no', ' Final  Grade ' -> 'final_grade'.
   '#' reads as "No", so 'Student #' is a student number, not a name. */
function normHeader(h) {
    return String(h ?? '')
        .trim()
        .toLowerCase()
        .replace(/#/g, ' no ')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

/* Canonical name for one header cell, or null when it means nothing to us.
   The first accepted spelling in a row wins for a canonical name, so a
   second "Subject" column cannot displace the "Subject Code" before it. */
function canonicalOf(cell) {
    const h = normHeader(cell);
    if (!h) return null;
    for (const [canon, names] of Object.entries(ALIASES)) {
        if (names.includes(h)) return canon;
    }
    return null;
}

/* Finds the header row of one sheet.
   Returns { headerIdx, columns } where `columns[j]` is the canonical name of
   column j (or null for an unrecognised column), or null when no row in the
   first HEADER_SCAN_ROWS carries every required column. */
function locateHeader(aoa, classList = false) {
    const limit = Math.min((aoa ?? []).length, HEADER_SCAN_ROWS);
    for (let i = 0; i < limit; i++) {
        const seen = new Set();
        const columns = (aoa[i] ?? []).map(cell => {
            const c = canonicalOf(cell);
            if (!c || seen.has(c)) return null;
            seen.add(c);
            return c;
        });
        const found = classList
            ? seen.has('student_id') && CLASS_LIST_ALSO.some(c => seen.has(c))
            : REQUIRED.every(r => seen.has(r));
        if (found) return { headerIdx: i, columns };
    }
    return null;
}

const isBlankRow = (row) => !(row ?? []).some(c => String(c ?? '').trim() !== '');

/* Which sheet holds the grades. Workbooks often carry a leftover sheet from
   an Excel import or an empty template; the first sheet is not reliable. Of
   the sheets that have a usable header, the one with the most data rows is
   taken; a tie goes to the earlier sheet.
   `sheets` is [{ name, aoa }]. Returns the winner with its header, or null. */
function pickSheet(sheets, options = {}) {
    const pick = (classList) => {
        let best = null;
        for (const sheet of sheets ?? []) {
            const header = locateHeader(sheet.aoa, classList);
            if (!header) continue;
            const dataRows = sheet.aoa.slice(header.headerIdx + 1).filter(r => !isBlankRow(r)).length;
            if (!best || dataRows > best.dataRows) best = { ...sheet, ...header, dataRows };
        }
        return best;
    };
    // A file with a subject on every row always reads as before. Only when no
    // sheet has one, and the subject was chosen on the page, is a sheet with
    // no subject column accepted.
    return pick(false) ?? (options.subjectChosen ? pick(true) : null);
}

/* Data rows of a picked sheet as { canonicalName: text, __line } objects.
   `__line` is the row number as Excel shows it (1-based), so an error message
   points at the right row even when a title sits above the header. */
function readRows(picked) {
    const { aoa, headerIdx, columns } = picked;
    const out = [];
    for (let i = headerIdx + 1; i < aoa.length; i++) {
        const row = aoa[i];
        if (isBlankRow(row)) continue;
        const obj = { __line: i + 1 };
        columns.forEach((name, j) => {
            if (name) obj[name] = String(row[j] ?? '').trim();
        });
        // Every canonical column exists on every row, so callers never
        // have to tell "column absent" from "cell empty".
        for (const name of Object.keys(ALIASES)) if (!(name in obj)) obj[name] = '';
        out.push(obj);
    }
    return out;
}

/* Subject codes compared without spaces or case, and with every dash
   variant read as a plain hyphen. Word autocorrects a typed "-" into an
   en dash, which is how BSN's "HUM – REP 101" arrives in a spreadsheet. */
function normCode(v) {
    return String(v ?? '')
        .trim()
        .replace(/[‐-―−]/g, '-')
        .replace(/\s+/g, '')
        .toUpperCase();
}

/* normCode with every separator dropped too, so "CRIM-111", "CRIM.111" and
   "CRIM 111" all reach the same subject. Only used as a fallback when the
   exact key misses, and only where it is unambiguous (see the caller). */
function looseCode(v) {
    return normCode(v).replace(/[^A-Z0-9]/g, '');
}

/* One grade cell -> { points, status?, error? }.
   Blank or "-" is no grade yet. A comma decimal ("1,75") is read as 1.75;
   parseFloat would have stopped at the comma and returned 1, a passing
   mark that was never given. Anything that is not a plain number in
   1-5 is an error, except the usual "dropped" spellings. */
function parseGrade(raw) {
    const s = String(raw ?? '').trim();
    if (s === '' || s === '-') return { points: null };
    if (/^(DRP|DROP|DROPPED|W|WD|WITHDRAWN|UW)$/i.test(s)) return { points: null, status: 'DROPPED' };

    const t = /^\d+,\d+$/.test(s) ? s.replace(',', '.') : s;
    if (!/^\d+(\.\d+)?$/.test(t)) return { points: null, error: `Grade "${s}" must be 1.0–5.0.` };

    const n = Number(t);
    if (n < 1 || n > 5) return { points: null, error: `Grade "${s}" must be 1.0–5.0.` };
    return { points: Math.round(n * 100) / 100 };
}

/* Status spellings -> PASSED | FAILED | ENROLLED | DROPPED. Anything
   unrecognised comes back upper-cased so the caller can report it. */
function normStatus(raw) {
    const s = String(raw ?? '').trim().toUpperCase().replace(/[^A-Z]+/g, ' ').trim();
    if (!s) return '';
    if (['PASSED', 'PASS', 'P'].includes(s)) return 'PASSED';
    if (['FAILED', 'FAIL', 'F'].includes(s)) return 'FAILED';
    if (['DROPPED', 'DROP', 'DRP', 'W', 'WD', 'WITHDRAWN'].includes(s)) return 'DROPPED';
    if (['ENROLLED', 'ONGOING', 'CURRENT', 'IP', 'IN PROGRESS'].includes(s)) return 'ENROLLED';
    return s;
}

/* "1", "1st Sem", "2nd Semester", "Sem 2", "First", "Summer" -> 1|2|3.
   Blank gives the fallback; anything unreadable gives NaN. */
function parseTerm(raw, fallback) {
    const s = String(raw ?? '').trim().toLowerCase();
    if (!s) return fallback;
    if (/summer|mid.?year/.test(s)) return 3;
    if (/\bfirst\b/.test(s)) return 1;
    if (/\bsecond\b/.test(s)) return 2;
    if (/\bthird\b/.test(s)) return 3;
    const m = s.match(/(?<!\d)([123])(?!\d)/);
    return m ? Number(m[1]) : NaN;
}

/* "2025", "2025-2026", "AY 2025-2026", "S.Y. 2025–26" -> 2025 (the year the
   term started). Blank gives the fallback; anything unreadable gives NaN. */
function parseYear(raw, fallback) {
    const s = String(raw ?? '').trim();
    if (!s) return fallback;
    const m = s.match(/20\d{2}/);
    return m ? Number(m[0]) : NaN;
}

/* Whether a name in the file plausibly belongs to the student on record.
   Word order, commas, accents, case and middle names do not matter:
   "Villanueva, Althea M." matches Althea Villanueva. A blank name matches. */
function nameMatches(provided, first, last) {
    const tokens = (v) => String(v ?? '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase().replace(/[^a-z]+/g, ' ').split(' ').filter(Boolean);
    const p = tokens(provided);
    if (!p.length) return true;
    const e = tokens(`${first ?? ''} ${last ?? ''}`);
    return p.every(t => e.includes(t)) || e.every(t => p.includes(t));
}

/* The class list for one subject, as rows ready for a spreadsheet:
   a header, then one row per student, with the grade left to fill in.
     subject   { code }
     people    [{ student_id, first_name, last_name }]
   A student listed twice (two approved requests) appears once. Sorted by
   last name so the sheet reads like the roll a teacher is used to. */
function classListRows(subject, people) {
    const seen = new Set();
    const list = [];
    for (const p of people ?? []) {
        const id = String(p?.student_id ?? '').trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        list.push(p);
    }
    const key = (p) => `${p.last_name ?? ''}|${p.first_name ?? ''}`.toLowerCase();
    list.sort((a, b) => key(a).localeCompare(key(b)));

    const rows = [['student_id', 'student_name', 'subject_code', 'grade', 'status']];
    for (const p of list) {
        rows.push([
            String(p.student_id).trim(),
            `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim(),
            subject?.code ?? '',
            '',
            '',
        ]);
    }
    return rows;
}

/* ---- what is already recorded ----
   An attempt is one student, one subject, one term and year: the key of
   academic_record. Saving a row for an attempt that exists REPLACES it (that is
   how a corrected grade is entered), so uploading a file twice cannot make a
   second record. What it could do, without the checks below, is look as though
   it had saved something new. */

function attemptKey(studentId, subjectId, term, year) {
    return [studentId, subjectId, term, year].join('|');
}

const samePoints = (a, b) =>
    (a == null && b == null) ||
    (a != null && b != null && Math.abs(Number(a) - Number(b)) < 0.005);

/* Says, for each row, how it relates to the records already saved.
     rows      [{ student: { id }, subject: { id }, term, academic_year, grade_points, status }]
     existing  [{ student_id, subject_id, taken_term, taken_year, grade_points, status }]
   Each row comes back with
     change: 'new'        nothing is recorded for this attempt yet
             'unchanged'  recorded exactly as the file says: nothing to save
             'changed'    recorded differently: saving replaces it (a correction)
     prev:   { grade_points, status }, for 'changed' and 'unchanged' */
function compareWithRecords(rows, existing) {
    const byKey = new Map();
    for (const e of existing ?? []) {
        byKey.set(attemptKey(e.student_id, e.subject_id, e.taken_term, e.taken_year), e);
    }
    return (rows ?? []).map(r => {
        const e = byKey.get(attemptKey(r.student?.id, r.subject?.id, r.term, r.academic_year));
        if (!e) return { ...r, change: 'new' };
        const prev = { grade_points: e.grade_points == null ? null : Number(e.grade_points), status: e.status };
        const same = samePoints(r.grade_points, e.grade_points) && String(r.status) === String(e.status);
        return { ...r, change: same ? 'unchanged' : 'changed', prev };
    });
}

/* A soft warning for a row that is a NEW attempt at a subject the student has
   already PASSED in another term or year. A retake of a failed subject is normal
   and gets no warning; a second pass of a passed one usually means the file was
   uploaded under the wrong term. The row is still accepted: only flagged.
   Adds repeat: { year, term, grade_points } (the most recent earlier pass).
   Takes the rows after compareWithRecords and the same saved records. */
function flagRepeats(rows, existing) {
    const passed = new Map();   // student|subject -> saved PASSED attempts
    for (const e of existing ?? []) {
        if (String(e.status) !== 'PASSED') continue;
        const key = [e.student_id, e.subject_id].join('|');
        if (!passed.has(key)) passed.set(key, []);
        passed.get(key).push(e);
    }
    return (rows ?? []).map(r => {
        if (r.change !== 'new') return r;
        const earlier = passed.get([r.student?.id, r.subject?.id].join('|'));
        if (!earlier?.length) return r;
        const latest = [...earlier].sort((a, b) =>
            (b.taken_year - a.taken_year) || (b.taken_term - a.taken_term))[0];
        return {
            ...r,
            repeat: {
                year: latest.taken_year,
                term: latest.taken_term,
                grade_points: latest.grade_points == null ? null : Number(latest.grade_points),
            },
        };
    });
}

/* { new, changed, unchanged, toSave } for rows that went through compareWithRecords. */
function summarizeChanges(rows) {
    const out = { new: 0, changed: 0, unchanged: 0 };
    for (const r of rows ?? []) out[r.change] = (out[r.change] ?? 0) + 1;
    out.toSave = out.new + out.changed;
    return out;
}

const ACCEPTED_HEADERS_HELP =
    'Needs a header row with a student ID column (student_id, Student No, ID Number) ' +
    'and a subject code column (subject_code, Subject, Course Code). ' +
    'Optional: grade, status, student_name, term, academic_year. ' +
    'A class list with no subject column also works once the subject is chosen above.';

return { normHeader, canonicalOf, locateHeader, pickSheet, readRows, classListRows, attemptKey, compareWithRecords, flagRepeats, summarizeChanges, normCode, looseCode,
         parseGrade, normStatus, parseTerm, parseYear, nameMatches,
         ALIASES, REQUIRED, ACCEPTED_HEADERS_HELP };

}));
