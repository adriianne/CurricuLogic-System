// chainanalysis.js
//
// Makes sense of the chains of a scanned curriculum from the subjects themselves, not from how the document is laid out:
// "to take B you must take A first".
//
// A printed prospectus can leave a link out (a column cell nobody printed, a line the reader skipped) or put a block in the wrong
// year (the BSHM summer, 23 Nov 2026). Three things in the subjects themselves show it:
//
//   1. PARTS OF A SEQUENCE. "Research in Hospitality 1" and "Research in Hospitality 2", "Physical Activity Towards Health and
//      Fitness I" and "II": part 2 is taken after part 1. Part 2 should therefore lead back to part 1 through its prerequisites
//      (directly, or through a chain), or sit behind a year-standing gate that covers it. If it does not, that is listed to check.
//   2. ORDER. Part 2 must come in a LATER term than part 1. If it does not, that is a real contradiction, listed as a warning.
//   3. THE LONGEST CHAIN. The longest line of "needs" in the document, as a sentence ("PE 101 > PE 102 > PE 103 > PE 104").
//      Nothing to fix; it shows the chains were understood, and a chain that is longer than the years allow would show up as an
//      order error on its rows.
//
// It only REPORTS. Nothing is added, moved or deleted: the document may leave a link out on purpose, and a person decides.
//
//   analyze(rows) -> { sequels: [text], outOfOrder: [text], longest: { length, codes } | null }
//     rows: [{ uid, code, title, year, term, prereqs: [{ uid, co?, standing?, pos? }] }]
//   every text starts with the subject's code and a colon, so the check card can take the person to that row.
//
// Pure functions, so they are unit-tested.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.CurriculogicChainAnalysis = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const ROMAN = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10 };
const MIN_BASE = 5;                                           // letters in the part of the title before the number

const scheduled = (r) => r && r.year != null && r.term != null;
const rank = (r) => r.year * 10 + r.term;                     // 11, 12, 13 (summer), 21 ...: the same positions the year-standing gates use

/* "Research in Hospitality 2" -> { base: 'research in hospitality', n: 2 }; "... Fitness II" -> n: 2. null when the title does not end in a part number. */
function parts(title) {
    const t = String(title ?? '').replace(/\s+/g, ' ').trim();
    if (!t) return null;
    let m = /^(.*[A-Za-z])\s*(\d{1,2})$/.exec(t);                         // "Programming 2", "Programming2"
    let n = m ? Number(m[2]) : null;
    if (!m) {
        m = /^(.*[A-Za-z])\s+([IVX]{1,4})$/.exec(t);                      // "Fitness II" (a space first: "Vitamin C" is not part 100)
        n = m ? ROMAN[m[2]] ?? null : null;
    }
    if (!m || !n) return null;
    const base = m[1].toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (base.replace(/[^a-z]/g, '').length < MIN_BASE) return null;
    return { base, n };
}

/* Adjacency of "needs" links that need an earlier pass (not "goes with"): uid -> [uid]. */
function needs(rows) {
    const adj = new Map();
    for (const r of rows) {
        adj.set(r.uid, (r.prereqs ?? []).filter((p) => p.uid != null && !p.co).map((p) => p.uid));
    }
    return adj;
}

/* Does `from` lead back to `to` through "needs" links, however many steps? */
function leadsTo(adj, from, to) {
    const seen = new Set();
    const stack = [from];
    while (stack.length) {
        const u = stack.pop();
        if (u === to) return true;
        if (seen.has(u)) continue;
        seen.add(u);
        for (const v of adj.get(u) ?? []) stack.push(v);
    }
    return false;
}

/* A year-standing gate on `row` that covers the position of `earlier` ("must finish all 1st to 3rd year courses"). */
function gateCovers(row, earlier) {
    return (row.prereqs ?? []).some((p) => p.standing && (p.pos ?? p.standing * 10 + 2) >= rank(earlier));
}

/* "CS Elective 2", "Free Elective 3": numbered slots to be filled from a list, not parts of one subject. The numbers say nothing about the
   order (saved BSCS and BSIT curricula have "Free Elective 2" a semester BEFORE "Free Elective 1"), so they are left out of the pairs. */
const isElectiveSlot = (r) => !!r.electiveType || !!r.isElective || /\belective\b/i.test(String(r.title ?? ''))
    || /^(?:[A-Z0-9]+-)?(?:EL|FRE)\d*$/i.test(String(r.code ?? '').trim());

const where = (r) => `year ${r.year} ${r.term === 3 ? 'summer' : `semester ${r.term}`}`;
const name = (r) => `${r.code} ${String(r.title ?? '').trim()}`.trim();

function analyze(rows) {
    const list = Array.isArray(rows) ? rows : [];
    const adj = needs(list);
    const sequels = [];
    const outOfOrder = [];

    // 1 and 2: the parts of a sequence
    const groups = new Map();
    for (const r of list) {
        if (!scheduled(r) || isElectiveSlot(r)) continue;
        const p = parts(r.title);
        if (!p) continue;
        if (!groups.has(p.base)) groups.set(p.base, []);
        groups.get(p.base).push({ row: r, n: p.n });
    }
    for (const members of groups.values()) {
        if (members.length < 2) continue;
        const ns = members.map((m) => m.n);
        if (new Set(ns).size !== ns.length) continue;                   // two "part 2": not a clean sequence, leave it
        members.sort((a, b) => a.n - b.n);
        for (let i = 0; i + 1 < members.length; i++) {
            if (members[i + 1].n !== members[i].n + 1) continue;        // 1 and 3 with no 2: not a pair to judge
            const a = members[i].row;
            const b = members[i + 1].row;
            if (rank(b) <= rank(a)) {
                outOfOrder.push(`${b.code}: ${name(b)} is in ${where(b)}, not after ${name(a)} in ${where(a)}`);
            } else if (!leadsTo(adj, b.uid, a.uid) && !gateCovers(b, a)) {
                sequels.push(`${b.code}: ${name(b)} has no prerequisite chain back to ${name(a)}`);
            }
        }
    }

    // 3: the longest chain of "needs"
    const byUid = new Map(list.map((r) => [r.uid, r]));
    const memo = new Map();
    const visiting = new Set();
    const chainFrom = (u) => {                                          // the longest line starting at u: [u, what u needs, ...]
        if (memo.has(u)) return memo.get(u);
        if (visiting.has(u)) return [u];                                // a loop (only possible among unscheduled rows): stop here
        visiting.add(u);
        let best = [];
        for (const v of adj.get(u) ?? []) {
            if (!byUid.has(v) || v === u) continue;
            const c = chainFrom(v);
            if (c.length > best.length) best = c;
        }
        visiting.delete(u);
        const out = [u, ...best];
        memo.set(u, out);
        return out;
    };
    let longest = null;
    for (const r of list) {
        const c = chainFrom(r.uid);
        if (c.length >= 3 && (!longest || c.length > longest.length)) longest = c;
    }
    return {
        sequels,
        outOfOrder,
        longest: longest ? { length: longest.length, codes: longest.map((u) => byUid.get(u).code).reverse() } : null,   // first to take, then onward
    };
}

return { analyze, parts, leadsTo };
}));
