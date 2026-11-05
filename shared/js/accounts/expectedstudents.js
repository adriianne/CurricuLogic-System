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

const COLUMNS = ['student_id', 'first_name', 'middle_name', 'last_name', 'program_code', 'email', 'year_level', 'curriculum_year'];

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

/* The year a row says the student is in. Blank is fine (it stays blank). "3", "3rd" and "3rd Year" all mean 3.
   Returns { value: 1-4 | null } or { error }. */
function parseYearLevel(raw) {
    const text = String(raw ?? '').trim();
    if (!text) return { value: null };
    const m = /^([1-4])(?:\s*(?:st|nd|rd|th))?(?:\s*year)?$/i.exec(text);
    return m ? { value: Number(m[1]) } : { error: 'Year level must be 1 to 4, or left blank.' };
}

/* The curriculum a student started under, as a year: "2024", or "2024-2025" (the first year counts). Blank is fine and
   means "the active curriculum". Returns { value: 2000-2100 | null } or { error }. */
function parseCurriculumYear(raw) {
    const text = String(raw ?? '').trim();
    if (!text) return { value: null };
    const m = /^(\d{4})(?:\s*[-\u2013/]\s*\d{4})?$/.exec(text);
    const year = m ? Number(m[1]) : NaN;
    return year >= 2000 && year <= 2100 ? { value: year } : { error: 'Curriculum year must be a year such as 2024, or left blank.' };
}

/* A student ID is 8 digits, as everywhere else in the system. Spaces and dashes typed in are dropped. */
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
     curricula: Map of programme id -> Set of curriculum years that exist (null skips the check)
     existingEmails: Map of e-mail -> student ID already on the list, so a second student cannot take an e-mail that
               another listed student has (the setup link and the confirmation go to that address)
   Returns { ok: [...], bad: [...] }. An ok row is { line, studentId, first, last, email, programCode,
   programId, isUpdate }. A bad row carries what could be read plus `why`. */
function checkRows(rows, programs, existing = new Set(), existingEmails = new Map(), curricula = null) {
    const ok = [];
    const bad = [];
    const seenIds = new Set();
    const seenEmails = new Map();   // e-mail -> line of its first row in this file
    const fileIds = new Set((rows ?? []).map(r => cleanStudentId(r.student_id)).filter(Boolean));

    for (const r of rows ?? []) {
        const first = NameRules.clean(r.first_name);
        const last = NameRules.clean(r.last_name);
        const middle = NameRules.clean(r.middle_name);
        const email = EmailRules.clean(r.email);
        const studentId = cleanStudentId(r.student_id);
        const base = { line: r.__line, studentId, first, middle, last, email, programCode: String(r.program_code ?? '').trim().toUpperCase() };
        const reject = (why) => bad.push({ ...base, why });

        if (!studentId) { reject('Missing student ID.'); continue; }
        if (!/^\d{8}$/.test(studentId)) { reject('Student ID must be 8 digits.'); continue; }

        const firstProblem = first ? NameRules.problem(first, 'first name') : 'Missing first name.';
        if (firstProblem) { reject(firstProblem); continue; }
        const lastProblem = last ? NameRules.problem(last, 'last name') : 'Missing last name.';
        if (lastProblem) { reject(lastProblem); continue; }
        const middleProblem = NameRules.middleProblem(middle);
        if (middleProblem) { reject(middleProblem); continue; }

        const prog = matchProgram(programs, r.program_code);
        if (prog.error) { reject(prog.error); continue; }

        const year = parseYearLevel(r.year_level);
        if (year.error) { reject(year.error); continue; }

        const cy = parseCurriculumYear(r.curriculum_year);
        if (cy.error) { reject(cy.error); continue; }
        if (cy.value && curricula) {
            const have = curricula.get(prog.program.id);
            if (!have || !have.has(cy.value)) {
                const years = have ? [...have].sort().join(', ') : 'none';
                reject(`No curriculum for ${cy.value} exists for ${prog.program.code} (published: ${years}).`); continue;
            }
        }

        if (!email) { reject('Missing email.'); continue; }
        const emailProblem = EmailRules.problem(email);
        if (emailProblem) { reject(emailProblem); continue; }

        if (seenIds.has(studentId)) { reject('Duplicate student ID in file.'); continue; }
        seenIds.add(studentId);

        // One e-mail, one student: the confirmation and the setup link go to this address, and two accounts cannot share it.
        if (seenEmails.has(email)) { reject(`This e-mail is already used by another student in the file (line ${seenEmails.get(email)}).`); continue; }
        const owner = existingEmails.get(email);
        if (owner && owner !== studentId && !fileIds.has(owner)) { reject(`This e-mail is already on the list for student ${owner}.`); continue; }
        seenEmails.set(email, r.__line);

        ok.push({
            ...base,
            programCode: prog.program.code,
            programId: prog.program.id,
            // undefined when the file has no middle_name column, so saving it leaves saved middle names alone
            middle: 'middle_name' in r ? (middle || null) : undefined,
            // undefined when the file has no year_level column at all, so saving it leaves saved years alone
            yearLevel: 'year_level' in r ? year.value : undefined,
            // same for the curriculum year: leaving the column out of the file keeps what is saved
            curriculumYear: 'curriculum_year' in r ? cy.value : undefined,
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
        [s.student_id, s.first_name, s.middle_name, s.last_name, `${s.first_name} ${s.last_name}`, [s.first_name, s.middle_name, s.last_name].filter(Boolean).join(' '), s.email, s.program_code]
            .some(v => String(v ?? '').toLowerCase().includes(q)));
}

/* What the Register page does with the answer of check_registration_match (db/095). The EDP list now decides who
   may have an account, so only 'match' lets the student through. The e-mail must be the one the EDP office has
   on file: the ID or the name alone would let a person take someone else's account.
     'match'     go on (the database checks again when the row is saved)
     'no_match'  stop: the details are not on the list, or the e-mail is not the one on file
     'no_list'   stop: no list has been uploaded yet, so registration is not open
   Anything else (an error, nothing) also stops, because the database would refuse it anyway. */
const NOT_ON_LIST_MESSAGE = 'These details do not match the EDP student list. Check your name, student ID, degree program and e-mail, which must be the address the EDP office has on file. If they are right, contact the EDP office.';
const NOT_OPEN_MESSAGE = 'Registration is not open yet. Please contact the EDP office.';
const CANNOT_CHECK_MESSAGE = 'We could not check your details right now. Please try again in a moment.';

function registrationCheck(result) {
    if (result === 'match')    return { allow: true,  message: '' };
    if (result === 'no_match') return { allow: false, message: NOT_ON_LIST_MESSAGE };
    if (result === 'no_list')  return { allow: false, message: NOT_OPEN_MESSAGE };
    return { allow: false, message: CANNOT_CHECK_MESSAGE };
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

/* Which listed students the Admin's "Create accounts" button would create, now.
     list:            rows of the list as stored: { student_id, first_name, last_name, email, year_level, program_code }
     takenIds:        Set of student IDs that already have an account
     takenEmails:     Set of lower-case emails that already have an account
     limit:           the most to create in one go (the email sender has hourly and daily limits)
   Returns { create: [...rows], skipped: [{ row, why }], later: n } where `later` is how many more are
   eligible but beyond the limit, so one more click picks them up. */
function accountCandidates(list, takenIds, takenEmails, limit) {
    const eligible = [];
    const skipped = [];
    for (const row of list ?? []) {
        if (takenIds.has(row.student_id)) { skipped.push({ row, why: 'Already has an account (student ID).' }); continue; }
        if (takenEmails.has(String(row.email ?? '').trim().toLowerCase())) { skipped.push({ row, why: 'An account already uses this email.' }); continue; }
        eligible.push(row);
    }
    const cap = Math.max(0, limit ?? eligible.length);
    return { create: eligible.slice(0, cap), skipped, later: Math.max(0, eligible.length - cap) };
}

return { COLUMNS, parseYearLevel, parseCurriculumYear, accountCandidates, pickSheet, cleanStudentId, matchProgram, checkRows, search, registrationCheck, NOT_ON_LIST_MESSAGE, NOT_OPEN_MESSAGE, statusBadge, NOT_ON_LIST_NOTE };

}));
