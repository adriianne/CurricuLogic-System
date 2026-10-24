// expectedstudents.js
//
// The rules of the Admin's "expected students" upload: the list the EDP office sends of students it has
// confirmed (db/084). Self-registration is checked against this list later. Pure functions only, so they
// are testable without a browser.
//
// One row is one student: student_id, first_name, last_name, program_code, email. A row that cannot be
// used is rejected with a plain reason instead of being skipped without a word. A student ID that is
// already on the list is an update, not a duplicate; the same ID twice in one file is an error.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./namerules.js'), require('./emailrules.js'));
    } else {
        root.CurriculogicExpectedStudents = factory(root.CurriculogicNameRules, root.CurriculogicEmailRules);
    }
}(typeof self !== 'undefined' ? self : this, function (NameRules, EmailRules) {
'use strict';

const COLUMNS = ['student_id', 'first_name', 'last_name', 'program_code', 'email'];

const normHeader = (h) => String(h ?? '').trim().toLowerCase().replace(/\s+/g, '_');

/* sheets: [{ name, aoa }] with aoa = rows as arrays, header first.
   Returns { index, name, matched, skipped: [names] }, or null when no sheet has the columns.
   A sheet qualifies when it has a student_id column and an email column; the one with most of the
   columns wins, and the earlier sheet wins a tie. */
function pickSheet(sheets) {
    let best = null;
    (sheets ?? []).forEach((sh, index) => {
        const header = (sh.aoa?.[0] ?? []).map(normHeader);
        const matched = COLUMNS.filter(c => header.includes(c)).length;
        const qualifies = header.includes('student_id') && header.includes('email');
        if (qualifies && (!best || matched > best.matched)) best = { index, name: sh.name, matched };
    });
    if (!best) return null;
    return { ...best, skipped: sheets.map(sh => sh.name).filter((_, i) => i !== best.index) };
}

/* A student ID is 7 digits, as everywhere else in the system. Spaces and dashes typed in are dropped. */
const cleanStudentId = (raw) => String(raw ?? '').replace(/[\s-]/g, '');

/* The programme a row names, matched against the programmes that exist, ignoring case.
   programs: [{ id, code }]. Returns { program } or { error }. */
function matchProgram(programs, raw) {
    const typed = String(raw ?? '').trim();
    const list = programs ?? [];
    if (!typed) return { error: 'Missing programme code.' };
    const match = list.find(p => String(p.code).toLowerCase() === typed.toLowerCase());
    if (match) return { program: match };
    const codes = list.map(p => p.code).join(', ');
    return { error: `Unknown programme "${typed}".${codes ? ` Known programmes: ${codes}.` : ''}` };
}

/* Check every row of a file.
     rows:     [{ __line, student_id, first_name, last_name, program_code, email }] with headers normalised
     programs: [{ id, code }]
     existing: Set of student IDs already on the list (those rows will be updated, not added)
   Returns { ok: [...], bad: [...] }. An ok row is { line, studentId, first, last, email, programCode,
   programId, isUpdate }. A bad row carries what could be read plus `why`. */
function checkRows(rows, programs, existing = new Set()) {
    const ok = [];
    const bad = [];
    const seenIds = new Set();

    for (const r of rows ?? []) {
        const first = NameRules.clean(r.first_name);
        const last = NameRules.clean(r.last_name);
        const email = EmailRules.clean(r.email);
        const studentId = cleanStudentId(r.student_id);
        const base = { line: r.__line, studentId, first, last, email, programCode: String(r.program_code ?? '').trim().toUpperCase() };
        const reject = (why) => bad.push({ ...base, why });

        if (!studentId) { reject('Missing student ID.'); continue; }
        if (!/^\d{7}$/.test(studentId)) { reject('Student ID must be 7 digits.'); continue; }

        const firstProblem = first ? NameRules.problem(first, 'first name') : 'Missing first name.';
        if (firstProblem) { reject(firstProblem); continue; }
        const lastProblem = last ? NameRules.problem(last, 'last name') : 'Missing last name.';
        if (lastProblem) { reject(lastProblem); continue; }

        const prog = matchProgram(programs, r.program_code);
        if (prog.error) { reject(prog.error); continue; }

        if (!email) { reject('Missing email.'); continue; }
        const emailProblem = EmailRules.problem(email);
        if (emailProblem) { reject(emailProblem); continue; }

        if (seenIds.has(studentId)) { reject('Duplicate student ID in file.'); continue; }
        seenIds.add(studentId);

        ok.push({
            ...base,
            programCode: prog.program.code,
            programId: prog.program.id,
            isUpdate: existing.has(studentId),
        });
    }
    return { ok, bad };
}

/* The rows of the list that match a search typed above it: student ID, name, email or programme. */
function search(list, query) {
    const q = String(query ?? '').trim().toLowerCase();
    if (!q) return list ?? [];
    return (list ?? []).filter(s =>
        [s.student_id, s.first_name, s.last_name, `${s.first_name} ${s.last_name}`, s.email, s.program_code]
            .some(v => String(v ?? '').toLowerCase().includes(q)));
}

/* What the Register page does with the answer of check_expected_student (db/085). Only 'no_match' warns.
   'match', 'no_list' (nothing uploaded yet), an error, or anything unexpected lets the student through
   without a word, so a problem on our side never blocks or scares someone registering. */
function registrationAdvice(result) {
    if (result !== 'no_match') return { warn: false, message: '' };
    return {
        warn: true,
        message: 'We could not find these details on the university\'s student list. ' +
            'Check your name, student ID and degree program. If they are right, select "Submit anyway" ' +
            'and the Registrar will check them by hand.',
    };
}

/* How the Registrar and Admin screens show the answer of edp_status (db/086).
     kind   the colour of the pill: 'ok' | 'bad' | null (nothing to show)
     label  its text, '' when there is nothing to show
     block  true when Approve must be refused
   Only 'not_on_list' blocks. 'no_list' (nothing uploaded yet), nothing fetched yet, an error or anything
   unexpected shows nothing and blocks nothing, so a gap on our side never stops the Registrar working. */
function statusBadge(status) {
    if (status === 'on_list')     return { kind: 'ok',  label: 'On EDP list',     block: false };
    if (status === 'not_on_list') return { kind: 'bad', label: 'Not on EDP list', block: true };
    return { kind: null, label: '', block: false };
}

const NOT_ON_LIST_NOTE = 'This person is not on the EDP list, so the request cannot be approved. ' +
    'If they are a real student, ask the Admin to add them to the list (or fix a typo in it), then reload this page. ' +
    'Otherwise decline the request.';

return { COLUMNS, pickSheet, cleanStudentId, matchProgram, checkRows, search, registrationAdvice, statusBadge, NOT_ON_LIST_NOTE };

}));
