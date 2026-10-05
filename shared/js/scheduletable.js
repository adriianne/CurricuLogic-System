// scheduletable.js
//
// The "when do my subjects meet" table under one of Cura's answers. Like the plan
// table it is built here, from the real summary, never from anything the model
// wrote: Cura only decides that this answer calls for the table.
//
//   const t = CurriculogicScheduleTable.build(summary);
//   t.rows     [{ code, title, section, meetings: [{ kind, days, start, end, text }], when }]
//   t.notInPlan [{ code, title, reason }]   eligible subjects that did not fit, and why
//
// Pure functions only: no DOM, no network.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./scheduleconflicts.js'));
    else root.CurriculogicScheduleTable = factory(root.ScheduleConflicts);
}(typeof self !== 'undefined' ? self : this, function (SC) {
'use strict';

const clock = (t) => (SC && SC.formatClock ? SC.formatClock(t) : String(t ?? ''));

/* "TTH 8:00 AM–9:30 AM", with a LAB prefix for a lab meeting. */
function meetingText(m) {
    const span = m.start && m.end ? `${clock(m.start)}–${clock(m.end)}` : '';
    const lab = String(m.type ?? '').toUpperCase() === 'LAB' ? 'LAB ' : '';
    return [lab + (m.days ?? ''), span].filter(Boolean).join(' ').trim();
}

/* The section a subject is planned in: the one the planner chose, else the only/first one offered. */
function sectionOf(entry) {
    const sections = entry.sections ?? [];
    const chosen = entry.chosenSection?.section;
    return sections.find(s => s.section === chosen) ?? sections[0] ?? null;
}

/* The rows for one plan. "entries" are the summary's subject entries (with their sections);
   "placed" is null for the current plan, or [{code, section}] for an alternative. */
function rowsFor(entries, placed) {
    const byCode = new Map(entries.map(e => [e.code, e]));
    const list = placed
        ? placed.map(p => ({ entry: byCode.get(p.code), section: p.section, code: p.code })).filter(x => x.entry)
        : entries.map(e => ({ entry: e, section: e.chosenSection?.section ?? null, code: e.code }));

    return list.map(({ entry: e, section }) => {
        const sec = (e.sections ?? []).find(s => s.section === section) ?? sectionOf(e);
        const meetings = (sec?.meetings ?? []).map(m => ({
            kind: String(m.type ?? 'LEC').toUpperCase() === 'LAB' ? 'LAB' : 'LEC',
            days: m.days ?? '',
            start: m.start ?? null,
            end: m.end ?? null,
            text: meetingText(m),
        }));
        return {
            code: e.code,
            title: e.title,
            section: sec?.section ?? null,
            meetings,
            when: meetings.map(m => m.text).join(' + '),
        };
    });
}

/* option: null for the current plan, or the label of one of summary.alternatives. An option
   that is not (or no longer) in the summary gives an empty table rather than the wrong one. */
function build(summary, option = null) {
    const recommended = summary?.recommended ?? [];
    const leftOut = summary?.leftOutForClash ?? [];

    if (option) {
        const want = String(option).trim().toLowerCase();
        const alt = (summary?.alternatives ?? []).find(a => String(a.label).trim().toLowerCase() === want);
        if (!alt) return { rows: [], notInPlan: [], label: null, changes: [] };
        const rows = rowsFor([...recommended, ...leftOut], alt.placed ?? []);
        const titleOf = new Map([...recommended, ...leftOut].map(e => [e.code, e.title]));
        return {
            rows,
            notInPlan: (alt.notIncluded ?? []).map(code => ({
                code, title: titleOf.get(code) ?? '', reason: 'no section fits beside the others in this version',
            })),
            label: alt.label,
            changes: alt.changes ?? [],
        };
    }

    const notInPlan = leftOut.map(l => ({
        code: l.code,
        title: l.title,
        reason: (l.blockedBy ?? []).length
            ? `clashes with ${l.blockedBy.join(' and ')}`
            : 'no section fits',
    }));

    return { rows: rowsFor(recommended, null), notInPlan, label: null, changes: [] };
}

/* The suggested subjects for the plan table ("what should I take?"), each with the section
   and when it meets once a schedule is published: the summary's own entries plus
   { section, meetings, when }. Subjects with no published section get section null and an
   empty "when", so the table can leave the column out until there is something to show. */
function planRows(summary) {
    const recommended = summary?.recommended ?? [];
    const times = new Map(rowsFor(recommended, null).map(r => [r.code, r]));
    return recommended.map(e => {
        const t = times.get(e.code);
        return { ...e, section: t?.section ?? null, meetings: t?.meetings ?? [], when: t?.when ?? '' };
    });
}

return { build, planRows, meetingText };
}));
