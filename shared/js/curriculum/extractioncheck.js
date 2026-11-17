// extractioncheck.js
//
// A check on what the curriculum reader (the AI) extracted from a PDF, that does not depend on how the PDF is laid out.
//
// WHY: the reader can miss a block of a document (on 17 Nov 2026 a whole summer term, 6 units, went missing from a
// 2023-2024 curriculum and nobody could tell from the screen), and a new university layout may show a new surprise.
// Instead of chasing every layout, the reader is also asked to report the totals the document PRINTS: a "Total" line
// under each semester or summer, and a grand total of units. This module adds up the subjects the reader returned
// and compares the two, so a missing block shows as a warning before anything is saved. It works for any layout that
// prints totals.
//
//   printed_totals (from the reader):
//     { grand_total_units: 176 | null, blocks: [{ year_level: 3, term: 3, total_units: 6 }, ...] }
//
//   check(subjects, printedTotals) -> { checked, warnings: [text], actualTotal, actualBlocks }
//     checked  true when the document printed at least one total that could be compared
//
// A document may count units differently from the rows (for example a grand total without NSTP), so the wording of every
// warning says "check", never "wrong". Pure functions only, so they are testable without a browser or the AI.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.CurriculogicExtractionCheck = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const YEAR = { 1: '1st year', 2: '2nd year', 3: '3rd year', 4: '4th year', 5: '5th year', 6: '6th year' };
const TERM = { 1: '1st semester', 2: '2nd semester', 3: 'summer' };

const label = (y, t) => `${YEAR[y] ?? `year ${y}`}, ${TERM[t] ?? `term ${t}`}`;
const units = (s) => (Number(s?.lecture_units) || 0) + (Number(s?.laboratory_units) || 0);
const whole = (n) => Number.isFinite(n) && n >= 0 && n <= 1000;
const num = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v));

/* "IT Elective 1", "Free Elective 2": placeholder rows that legitimately repeat the same code. */
const isPlaceholder = (s) => /\belective\b/i.test(String(s?.title ?? ''));

function check(subjects, printedTotals) {
    const subs = Array.isArray(subjects) ? subjects : [];
    const scheduled = subs.filter((s) => Number.isInteger(s?.year_level) && Number.isInteger(s?.term));

    const actualBlocks = {};
    for (const s of scheduled) {
        const k = `${s.year_level}:${s.term}`;
        actualBlocks[k] = (actualBlocks[k] ?? 0) + units(s);
    }
    const actualTotal = scheduled.reduce((a, s) => a + units(s), 0);

    const warnings = [];
    let checked = false;

    // ---- the printed totals ----
    const printed = printedTotals && typeof printedTotals === 'object' ? printedTotals : {};
    const grand = num(printed.grand_total_units);

    if (whole(grand) && grand > 0) {
        checked = true;
        if (actualTotal !== grand) {
            const diff = grand - actualTotal;
            warnings.push(
                `The subjects add up to ${actualTotal} units, but the document's total is ${grand} `
                + `(${Math.abs(diff)} unit${Math.abs(diff) === 1 ? '' : 's'} ${diff > 0 ? 'short' : 'over'}). `
                + `Check that no subject, or a whole block such as a summer term, is missing or counted twice.`);
        }
    }

    const seen = new Set();
    for (const b of Array.isArray(printed.blocks) ? printed.blocks : []) {
        const y = Number(b?.year_level), t = Number(b?.term), total = num(b?.total_units);
        if (!Number.isInteger(y) || !Number.isInteger(t) || !whole(total)) continue;
        const k = `${y}:${t}`;
        if (seen.has(k)) continue;           // the same block reported twice: the first one counts
        seen.add(k);
        checked = true;
        const actual = actualBlocks[k] ?? 0;
        if (actual !== total) {
            warnings.push(
                actual === 0
                    ? `The document prints a total of ${total} units for ${label(y, t)}, but no subjects were found there. The whole block may be missing.`
                    : `${label(y, t)} adds up to ${actual} units, but the document prints ${total}. Check its subjects.`);
        }
    }

    // ---- things that are wrong whatever the document prints ----
    const byCode = new Map();
    for (const s of subs) {
        const code = String(s?.code ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
        if (!code || isPlaceholder(s)) continue;
        byCode.set(code, (byCode.get(code) ?? 0) + 1);
    }
    for (const [code, n] of byCode) {
        if (n > 1) warnings.push(`The code ${code} appears ${n} times. Check for a repeated or mis-read row.`);
    }

    return { checked, warnings, actualTotal, actualBlocks };
}

return { check, label, units };
}));
