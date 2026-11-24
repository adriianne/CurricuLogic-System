// samecurriculum.js
//
// Is this curriculum the same as one the programme already has under another year? (21 Nov 2026)
//
// A year is a label; the curriculum is its subjects. Uploading the 2023 curriculum again and choosing 2025 would make two
// versions that say the same thing, and a student on either would be advised from the same list. The builder compares the
// set it is about to save with the programme's other versions and refuses an identical one.
//
// Two subjects are the same when their code (letters and digits only, so "ENGL 101" and "ENGL-101" agree), year level,
// semester and lecture and laboratory units all match. Titles are left out on purpose: a retyped title is not a different
// curriculum. Prerequisites are left out too; they are changed far more often than the list of subjects.
//
//   compare(mine, theirs)  -> { identical, same, mine, theirs, similarity, differing }
//   mine / theirs          arrays of { code, year, term, lec, lab }  (year/term/lec/lab may be null)
//   similarity             0 to 1: subjects in both, over the larger of the two lists
//   differing              how many subjects of the longer list the other list does not have
//   fromBuilderRow(row)    a builder row ({ code, year, term, lec, lab }) -> a comparable subject
//   fromDbRow(row)         a subject table row ({ code, year_level, term, lec_units, lab_units }) -> a comparable subject
//   NEAR                   similarity at or above this (and not identical) is a warning (0.9: 21 Nov 2026, a re-scan of the same
//                          file against a hand-corrected version was 94.5% alike and slipped past 0.95)
//   findSame(mine, others) -> [{ version, result }] for each other version that is identical or near, most alike first
//   printedYear(text)      the first year in "2024-2025", "AY 2024–2025", "2024"; null when there is none
//   yearMismatch(printed, selected) -> null, or { printed, selected } when the year the file prints is not the year chosen
//   programmeFit(printedName, { code, name }) -> { fits, score }: does the programme the file names look like this programme

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.CurriculogicSameCurriculum = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const NEAR = 0.9;
/* A version with fewer subjects than this is a stub (an empty draft), not a curriculum to compare against. */
const MIN_SUBJECTS = 5;

const codeKey = (c) => String(c ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const num = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v))) ? 0 : Number(v);
const whole = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v))) ? '' : String(Number(v));

function signature(s) {
    return `${codeKey(s?.code)}|${whole(s?.year)}|${whole(s?.term)}|${num(s?.lec)}|${num(s?.lab)}`;
}

function fromBuilderRow(r) {
    return { code: r?.code, year: r?.year, term: r?.term, lec: r?.lec, lab: r?.lab };
}

function fromDbRow(r) {
    return { code: r?.code, year: r?.year_level, term: r?.term, lec: r?.lec_units, lab: r?.lab_units };
}

function compare(mine, theirs) {
    const a = (Array.isArray(mine) ? mine : []).filter((s) => codeKey(s?.code));
    const b = (Array.isArray(theirs) ? theirs : []).filter((s) => codeKey(s?.code));
    const sigsA = new Set(a.map(signature));
    const sigsB = new Set(b.map(signature));
    let same = 0;
    for (const s of sigsA) if (sigsB.has(s)) same++;
    const larger = Math.max(sigsA.size, sigsB.size);
    const similarity = larger ? same / larger : 0;
    // How many subjects differ: those of the longer list that the other does not have. Three codes read differently is three
    // subjects, not six (three in each list).
    const differing = Math.max(sigsA.size, sigsB.size) - same;
    return {
        identical: sigsA.size > 0 && sigsA.size === sigsB.size && same === sigsA.size,
        same,
        mine: sigsA.size,
        theirs: sigsB.size,
        similarity,
        differing,
    };
}

/** others: [{ version, subjects }] where subjects are comparable subjects. Stubs are skipped. */
function findSame(mine, others) {
    const out = [];
    for (const o of Array.isArray(others) ? others : []) {
        if (!Array.isArray(o?.subjects) || o.subjects.length < MIN_SUBJECTS) continue;
        const result = compare(mine, o.subjects);
        if (result.identical || result.similarity >= NEAR) out.push({ version: o.version, result });
    }
    return out.sort((x, y) => y.result.similarity - x.result.similarity);
}

/** The year a document prints for itself: the first four-digit year in the text ("2024-2025", "A.Y. 2024–2025", "SY 2024"). */
function printedYear(text) {
    const m = /(?:^|[^0-9])((?:19|20)\d{2})(?:[^0-9]|$)/.exec(String(text ?? ''));
    return m ? Number(m[1]) : null;
}

/** null when nothing can be said or the years agree; otherwise what the file prints and what was chosen. */
function yearMismatch(printed, selected) {
    const y = printedYear(printed);
    const sel = Number(selected);
    if (y === null || !Number.isInteger(sel) || sel <= 0) return null;
    return y === sel ? null : { printed: y, selected: sel };
}

/* Words every programme name shares, or that only describe how the degree is worded. They say nothing about WHICH programme. */
const COMMON = new Set(['BACHELOR', 'OF', 'SCIENCE', 'ARTS', 'IN', 'WITH', 'SPECIALIZATION', 'SPECIALISATION', 'MAJOR', 'MAJORING',
    'THE', 'AND', 'FOR', 'PROGRAM', 'PROGRAMME', 'DEGREE', 'A', 'AN']);

/** The meaningful words of a programme name: upper case, an acronym in brackets such as (BSCS) left out, common words left out. */
function nameWords(text) {
    return new Set(String(text ?? '')
        .replace(/\(\s*[A-Za-z]{2,8}\s*\)/g, (m) => (/[a-z]/.test(m) ? m : ' '))     // (BSCS) is a code, not words; (Artificial) stays
        .toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim().split(' ')
        .filter((w) => w && !COMMON.has(w)));
}

const FIT_AT = 0.6;

/** Does the programme the document names look like this programme? A programme code in the printed name fits at once. */
function programmeFit(printedName, program) {
    const printed = nameWords(printedName);
    const own = nameWords(program?.name);
    const code = codeKey(program?.code);
    if (!printed.size || !own.size) return { fits: true, score: null };           // nothing to compare: say nothing
    if (code && [...printed].includes(code)) return { fits: true, score: 1 };
    let both = 0;
    for (const w of printed) if (own.has(w)) both++;
    const score = both / (printed.size + own.size - both);
    return { fits: score >= FIT_AT, score };
}

/** A file whose printed programme has NOTHING in common with this one: no shared meaningful word and no programme code in its name
    (the Criminology prospectus read into BSHM, 24 Nov 2026: "Criminology" against "Hospitality Management"). Close names that only share
    some words (BSCS against BSCSAI) are not a clash: they stay a warning, because the wording of a programme's name varies. */
function programmeClash(printedName, program) {
    const fit = programmeFit(printedName, program);
    if (!(fit.score === 0 && !fit.fits)) return false;
    // A name that is only an abbreviation ("BSCS-AI", "BS IT") says nothing a word comparison can judge: it shares no word with the full
    // name by nature. Only a name with a real programme word in it ("Criminology", "Hospitality") can clash, since a false stop cannot be overridden.
    return [...nameWords(printedName)].some((w) => w.length >= 6);
}

/** What must stop a save before anything is written, as plain sentences (empty when it may go ahead).
      hasVersion   a curriculum version (a year's row) is already open, so the year is known
      year         the curriculum year chosen, when no version exists yet
      printedName  the programme name printed in the scanned file ('' when nothing was scanned)
      program      { code, name } of the programme being worked on
    Two things happened on 24 Nov 2026: the same Criminology file was saved into BSHM twice (the second time published and active), and a
    version was saved with no year at all. Both are refused here instead of being left to a warning someone can click through. */
function saveGuard({ hasVersion, year, printedName, program } = {}) {
    const out = [];
    if (!hasVersion && !(Number(year) >= 2000)) {
        out.push('Choose the curriculum year first. A curriculum cannot be saved without a year.');
    }
    if (printedName && programmeClash(printedName, program)) {
        const own = [program?.code, program?.name].filter(Boolean).join(' ');
        out.push(`This file is for “${printedName}”, which has nothing in common with ${own || 'this programme'}. ` +
                 `It belongs to another programme: sign in with that programme’s Department account, or choose the right file. Nothing was saved.`);
    }
    return out;
}

return { NEAR, MIN_SUBJECTS, compare, findSame, fromBuilderRow, fromDbRow, printedYear, yearMismatch, programmeFit, programmeClash, saveGuard };

}));
