// summerplacement.js
//
// Which year a summer block belongs to, decided by the prerequisites and not by where the document prints it.
//
// The BSHM prospectus (23 Nov 2026) prints its Summer block under the SECOND YEAR heading, above the 2nd year's 1st semester:
//     SECOND YEAR  Summer: HM ELECT 4, HM ELECT 5, PE 103
//                  1st Semester: ... PE 104 (needs PE 103) ...
// The reader put it in year 2, after the 2nd semester. Then PE 103 (the end of year 2) came AFTER PE 104 (the start of year 2),
// which no student can follow. The block is the summer between year 1 and year 2.
//
// The rule: time runs  1st sem, 2nd sem, summer  of year 1, then the same for year 2. A subject must come strictly before every
// subject that needs it (a "goes with" link may share its term). A summer block is moved to the neighbouring year ONLY when
//   - its links break that order where it stands, and
//   - they all hold in the other year, and
//   - the other year has no summer block already (two summers would be merged on a guess).
// Nothing is moved on a hunch: a block whose links already hold stays where the document printed it (BSIT's summer, after 3rd year).
//
//   analyze(rows) -> { moves: [{ row, from, to, because: 'PE 104 needs PE 103' }] }     rows are not changed
//
// rows: [{ uid, code, year, term, prereqs: [{ uid, co?, standing? }] }]. Pure functions, so they are unit-tested.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.CurriculogicSummerPlacement = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const scheduled = (r) => r && r.year != null && r.term != null;
const SUMMER = 3;

/* The links that have exactly one end in the block: how many break the order when the block sits in `year`.
   Returns the list of broken ones as { row, target } (row needs target, but target does not come first). */
function broken(rows, block, year) {
    const inBlock = new Set(block);
    const byUid = new Map(rows.map((r) => [r.uid, r]));
    const rank = (r) => (inBlock.has(r) ? year * 10 + SUMMER : r.year * 10 + r.term);
    const out = [];
    for (const r of rows) {
        if (!scheduled(r)) continue;
        for (const p of r.prereqs ?? []) {
            if (p.uid == null || p.co) continue;
            const t = byUid.get(p.uid);
            if (!t || t === r || !scheduled(t)) continue;
            if (inBlock.has(r) === inBlock.has(t)) continue;      // both inside, or neither: where the block sits does not change it
            if (rank(t) >= rank(r)) out.push({ row: r, target: t });
        }
    }
    return out;
}

function analyze(rows) {
    const list = Array.isArray(rows) ? rows : [];
    const moves = [];
    const years = [...new Set(list.filter((r) => scheduled(r) && r.term === SUMMER).map((r) => r.year))].sort();
    for (const year of years) {
        const block = list.filter((r) => scheduled(r) && r.term === SUMMER && r.year === year);
        const here = broken(list, block, year);
        if (!here.length) continue;                                 // the order holds where it is printed: leave it
        const options = [year - 1, year + 1].filter((y) => y >= 1 && y <= 4
            && !list.some((r) => scheduled(r) && r.term === SUMMER && r.year === y));
        const fits = options.filter((y) => broken(list, block, y).length === 0);
        if (!fits.length) continue;                                 // no year makes it work: not our call, the row errors say so
        const to = fits[0];                                         // two years fit: the earlier one (year - 1 is tried first)
        const sample = here[0];
        const because = `${sample.row.code} needs ${sample.target.code}`;
        for (const row of block) moves.push({ row, from: year, to, because });
    }
    return { moves };
}

return { analyze, broken };
}));
