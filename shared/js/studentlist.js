// studentlist.js
// The pure parts of the Registrar's Students pages: building the search for the
// database (so only one page of students is ever fetched), page ranges, how far a
// student is through their degree, and which plan is "this term's".
//
//   CurriculogicStudentList.searchTokens('  athena  po ')        // ['athena', 'po']
//   CurriculogicStudentList.searchClause('athena')              // 'first_name.ilike.*athena*,...'
//   CurriculogicStudentList.rangeFor(3, 20)                     // { from: 40, to: 59 }
//   CurriculogicStudentList.progress(records, 161)              // { units, total, percent }
//   CurriculogicStudentList.pickPlan(requests, { term, year }, isFinal)
//
// Plain functions, no browser, so they are unit-tested.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.CurriculogicStudentList = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const MAX_TOKENS = 4;
const MAX_TOKEN_LENGTH = 60;

/* The words of a search box, cleaned so they cannot break the database filter
   (commas, brackets, quotes and wildcards have a meaning there). Every word must
   match somewhere, so "athena po" finds Athena Po and not every Athena. */
function searchTokens(text) {
    return String(text ?? '')
        .replace(/[,()*%\\"':;]/g, ' ')
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, MAX_TOKENS)
        .map(t => t.slice(0, MAX_TOKEN_LENGTH));
}

/* One word matched against the four searchable columns (a PostgREST `or` list). */
function searchClause(token) {
    return ['first_name', 'last_name', 'student_id', 'email']
        .map(col => `${col}.ilike.*${token}*`)
        .join(',');
}

/* Row range for a 1-based page. */
function rangeFor(page, size) {
    const p = Math.max(1, Math.floor(Number(page)) || 1);
    return { from: (p - 1) * size, to: p * size - 1 };
}

function pageCount(total, size) {
    return Math.max(1, Math.ceil((Number(total) || 0) / size));
}

const clampPercent = (done, total) => {
    const t = Number(total) || 0;
    if (t <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round((Number(done) || 0) / t * 100)));
};

/* Units earned: each passed subject counts once, however many times it was
   recorded (a repeated upload or a retake of a passed subject). Records are
   {subject_id, status, units} or {subject_id, status, subject: {units}}. */
function passedUnits(records) {
    const seen = new Set();
    let units = 0;
    for (const r of records ?? []) {
        if (r?.status !== 'PASSED') continue;
        const key = r.subject_id ?? `${r.subject_code ?? ''}|${r.subject?.code ?? ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        units += Number(r.units ?? r.subject?.units ?? 0) || 0;
    }
    return units;
}

function progress(records, totalUnits) {
    const units = passedUnits(records);
    const total = Number(totalUnits) || 0;
    return { units, total, percent: clampPercent(units, total) };
}

/* Which request is "this term's plan". Among the student's requests, the ones for
   the system's current term come first; inside those, an adviser-approved plan
   beats one still waiting, and newer beats older. With no current term known, the
   newest request is used. Returns the request or null. */
function pickPlan(requests, cfg, isFinal) {
    const list = [...(requests ?? [])].filter(Boolean);
    if (!list.length) return null;

    const rank = (r) => {
        const sameTerm = cfg && Number(r.requested_term) === Number(cfg.term) && Number(r.requested_year) === Number(cfg.year);
        return [sameTerm ? 1 : 0, (isFinal ? isFinal(r) : false) ? 1 : 0, new Date(r.created_at).getTime() || 0];
    };
    list.sort((a, b) => {
        const x = rank(a), y = rank(b);
        for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return y[i] - x[i];
        return 0;
    });

    const best = list[0];
    // Without a known current term anything will do; with one, only a plan for it counts.
    if (cfg && rank(best)[0] === 0) return null;
    return best;
}

const initialsOf = (first, last, fallback) =>
    (((first ?? '').trim()[0] || '') + ((last ?? '').trim()[0] || '')).toUpperCase()
    || String(fallback ?? '?').trim()[0]?.toUpperCase() || '?';

return { searchTokens, searchClause, rangeFor, pageCount, clampPercent, passedUnits, progress, pickPlan, initialsOf };
}));
