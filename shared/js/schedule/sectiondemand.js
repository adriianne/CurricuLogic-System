// sectiondemand.js
//
// How crowded each section is, for the Department. Pure functions only: no page, no database.
//
// WHAT THE NUMBERS ARE
//
// "Selected" is how many different students chose the section in a plan that was sent
// (waiting for the adviser) or approved. It is a demand signal the system really knows. It is
// NOT the EDP office's seat count: the EDP office owns seats and the system cannot see them.
// So it can say "many students want this section", never "this section is full at EDP".
//
//   - a student who never goes to EDP is still counted (it can only over-count)
//   - a student who does not use the system is not counted (it can only under-count)
//
// A section with no capacity set is judged against DEFAULT_CAPACITY.
//
//   const state = SectionDemand.classify({ selected: 41, capacity: null, is_open: true });
//   -> { capacity: 45, capacityIsDefault: true, left: 4, share: 0.91, level: 'near' }
//
//   levels, most urgent first:
//     'full'    selected has reached the capacity
//     'near'    selected is within WARN_MARGIN of the capacity (40 of 45)
//     'ok'      room to spare
//     'closed'  the Department has closed it: no longer offered to students
//
// The rows are what db/076_section_demand.sql returns.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.SectionDemand = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const DEFAULT_CAPACITY = 45;
/* How many seats short of the capacity a section is called "near": 45 -> from 40 selected. */
const WARN_MARGIN = 5;

const ORDER = { full: 0, near: 1, ok: 2, closed: 3 };

function capacityOf(row) {
    const n = Number(row?.capacity);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_CAPACITY;
}

function classify(row) {
    const capacity = capacityOf(row);
    const capacityIsDefault = !(Number(row?.capacity) > 0);
    const selected = Math.max(0, Number(row?.selected) || 0);
    const left = capacity - selected;

    let level;
    if (row?.is_open === false) level = 'closed';
    else if (selected >= capacity) level = 'full';
    else if (selected >= capacity - WARN_MARGIN) level = 'near';
    else level = 'ok';

    return { capacity, capacityIsDefault, left, share: Math.min(1, selected / capacity), level };
}

/* The rows with their state, the most crowded first. */
function prepare(rows) {
    return (rows ?? [])
        .map(r => ({ ...r, state: classify(r) }))
        .sort((a, b) =>
            ORDER[a.state.level] - ORDER[b.state.level]
            || b.state.share - a.state.share
            || String(a.subject_code).localeCompare(String(b.subject_code))
            || String(a.section).localeCompare(String(b.section)));
}

/* Counts for the headline, from prepared rows. */
function summarize(prepared) {
    const out = { full: 0, near: 0, ok: 0, closed: 0, sections: 0, students: 0 };
    for (const r of prepared ?? []) {
        out[r.state.level]++;
        out.sections++;
        out.students += Math.max(0, Number(r.selected) || 0);
    }
    return out;
}

/* One line for the top of the card. */
function headline(summary) {
    if (!summary.sections) return 'No sections are scheduled for this term yet.';
    const parts = [];
    if (summary.full) parts.push(`${summary.full} full`);
    if (summary.near) parts.push(`${summary.near} near full`);
    if (!parts.length) return `No section is near its limit. ${summary.sections} section${summary.sections === 1 ? '' : 's'} checked.`;
    return `${parts.join(' and ')}: students may need another section.`;
}

/* The prepared rows grouped by section (BSIT-1A, BSIT-3C ...), one group per section, in name order with the
   numbers read as numbers (1A, 2A ... 10A). Each group keeps its subjects most-crowded first and says how many
   of them are full, near full, fine or closed. The group's level is its most urgent subject. */
function groupBySection(prepared) {
    const groups = new Map();
    for (const r of prepared ?? []) {
        const key = String(r.section ?? '');
        if (!groups.has(key)) groups.set(key, { section: key, rows: [], counts: { full: 0, near: 0, ok: 0, closed: 0 } });
        const g = groups.get(key);
        g.rows.push(r);
        g.counts[r.state.level]++;
    }
    const out = [...groups.values()];
    for (const g of out) {
        g.level = g.counts.full ? 'full' : g.counts.near ? 'near' : g.counts.ok ? 'ok' : 'closed';
        g.subjects = g.rows.length;
        g.students = g.rows.reduce((t, r) => t + Math.max(0, Number(r.selected) || 0), 0);
    }
    return out.sort((a, b) => a.section.localeCompare(b.section, undefined, { numeric: true, sensitivity: 'base' }));
}

/* The year level a section belongs to, read from its name: the first digit after the dash, so BSIT-1A is 1,
   BSN-3C is 3 and "BSIT-2-B" is 2. A name that does not follow that pattern has no year (null). */
function yearOf(section) {
    const m = /^[^-]*-\s*(\d)/.exec(String(section ?? ''));
    return m ? Number(m[1]) : null;
}

/* "1st Year", "2nd Year", "3rd Year", "4th Year" ... and "Other sections" for a name with no year. */
function yearLabel(year) {
    if (year == null) return 'Other sections';
    const ord = { 1: '1st', 2: '2nd', 3: '3rd' }[year] ?? `${year}th`;
    return `${ord} Year`;
}

/* The section groups gathered under their year level, 1st year first, sections with no year last. Each year says how
   many sections it has and how many need attention. */
function groupByYear(groups) {
    const years = new Map();
    for (const g of groups ?? []) {
        const y = yearOf(g.section);
        if (!years.has(y)) years.set(y, { year: y, label: yearLabel(y), groups: [] });
        years.get(y).groups.push(g);
    }
    const out = [...years.values()];
    for (const y of out) {
        y.sections = y.groups.length;
        y.attention = y.groups.filter(g => g.level === 'full' || g.level === 'near').length;
    }
    return out.sort((a, b) => (a.year ?? 99) - (b.year ?? 99));
}

/* One line for the top of the card, in sections: "2 sections need attention: BSIT-1A (1 full), BSIT-1B (1 near full)". */
function headlineBySection(groups) {
    if (!groups?.length) return 'No sections are scheduled for this term yet.';
    const need = groups.filter(g => g.level === 'full' || g.level === 'near');
    if (!need.length) return `No section is near its limit. ${groups.length} section${groups.length === 1 ? '' : 's'} checked.`;
    const part = (g) => {
        const bits = [g.counts.full ? `${g.counts.full} full` : '', g.counts.near ? `${g.counts.near} near full` : ''].filter(Boolean);
        return `${g.section} (${bits.join(', ')})`;
    };
    // the fullest first, so the first names are the ones to look at
    const ordered = [...need].sort((a, b) => b.counts.full - a.counts.full || b.counts.near - a.counts.near);
    const shown = ordered.slice(0, 3).map(part).join(', ');
    const more = ordered.length > 3 ? ` and ${ordered.length - 3} more` : '';
    return `${need.length} section${need.length === 1 ? ' needs' : 's need'} attention: ${shown}${more}.`;
}

/* What to tell the Department about one section. */
function advice(row) {
    const s = row.state ?? classify(row);
    const sel = Number(row.selected) || 0;
    if (s.level === 'closed') return 'Closed. Students are no longer offered it.';
    if (s.level === 'full') {
        const over = sel - s.capacity;
        return over > 0
            ? `${sel} students chose it, ${over} over the ${s.capacity} limit. Consider opening another section.`
            : `${sel} students chose it: it has reached the ${s.capacity} limit. Consider opening another section.`;
    }
    if (s.level === 'near') return `${s.left} seat${s.left === 1 ? '' : 's'} left of ${s.capacity} by student choices.`;
    return `${s.left} seats left of ${s.capacity} by student choices.`;
}

return { classify, prepare, summarize, headline, groupBySection, headlineBySection, yearOf, yearLabel, groupByYear, advice, capacityOf, DEFAULT_CAPACITY, WARN_MARGIN };

}));
