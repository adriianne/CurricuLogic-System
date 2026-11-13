// schedulecards.js
//
// How a section's rows are laid out on the Department schedule: one group per subject, the LECTURE card on top and the
// LABORATORY card below it on a connector (the same top-to-bottom style as the plan overview a faculty adviser sees).
// Pure functions (no DOM, no database), so the layout rules can be tested in Node.
//
//   groups(rows, subjectOf)  -> [{ key, subjectId, lec: [rows], lab: [rows], other: [rows], needsLab: bool }]
//   isTimed(row)             -> days, start and end are all filled in
//   progress(groups)         -> { done, total } subjects whose every meeting is timed
//   state(group)             -> 'ready' | 'partial' | 'empty'

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.CurriculogicScheduleCards = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const isTimed = (r) => !!(r && typeof r.schedule_days === 'string' && r.schedule_days.trim() && r.start_time && r.end_time);

/* One group per subject, in the order its first row appears. A lecture row goes in lec, a LAB row in lab, anything else
   in other. A row with no subject chosen yet stands alone. subjectOf(id) -> the curriculum subject (for lab_units). */
function groups(rows, subjectOf) {
    const byKey = new Map();
    for (const r of rows || []) {
        const key = r.subject_id != null && r.subject_id !== '' && !Number.isNaN(Number(r.subject_id))
            ? 's' + r.subject_id
            : 'blank:' + r.__key;
        if (!byKey.has(key)) {
            const subject = typeof subjectOf === 'function' ? subjectOf(r.subject_id) : null;
            byKey.set(key, {
                key,
                subjectId: key.startsWith('s') ? Number(r.subject_id) : null,
                lec: [], lab: [], other: [],
                needsLab: !!(subject && Number(subject.lab_units) > 0),
            });
        }
        const g = byKey.get(key);
        if (r.meeting_type === 'LAB') g.lab.push(r);
        else if (!r.meeting_type || r.meeting_type === 'LEC') g.lec.push(r);
        else g.other.push(r);
    }
    return [...byKey.values()];
}

/* A subject is ready when its lecture and, where it has a lab, its lab both have days and times. */
function state(g) {
    const lecOk = g.lec.length > 0 && g.lec.every(isTimed);
    const labOk = !g.needsLab || (g.lab.length > 0 && g.lab.every(isTimed));
    if (lecOk && labOk) return 'ready';
    const any = [...g.lec, ...g.lab, ...g.other].some(isTimed);
    return any ? 'partial' : 'empty';
}

function progress(gs) {
    const real = gs.filter(g => g.subjectId != null);
    return { done: real.filter(g => state(g) === 'ready').length, total: real.length };
}

/* How another row is named in a warning: "CC-COMPROG11 LAB". A row with no subject yet is named by its EDP code, so
   the adviser can find it ("SAMPLE-57A-LAB"); with neither, by what it is. */
function meetingLabel(subjectCode, row) {
    const type = (row && row.meeting_type) || 'LEC';
    const code = String(subjectCode == null ? '' : subjectCode).trim();
    if (code) return code + ' ' + type;
    const edp = String((row && row.edp_code) == null ? '' : row.edp_code).trim();
    return edp || ('an unassigned ' + type);
}

/* The same sentence is only worth saying once (two rows with the same room and time give the same warning). */
function uniqueReasons(list) {
    const seen = new Set();
    const out = [];
    for (const t of list || []) {
        const s = String(t == null ? '' : t).trim();
        if (s && !seen.has(s)) { seen.add(s); out.push(s); }
    }
    return out;
}

/* What a card shows under it: the first warning, then "+N more"; the full list goes in the hover text. */
function clashSummary(reasons) {
    const all = uniqueReasons(reasons);
    if (!all.length) return { text: '', title: '', count: 0 };
    return {
        text: all[0] + (all.length > 1 ? ' +' + (all.length - 1) + ' more' : ''),
        title: all.join('\n'),
        count: all.length,
    };
}

return { isTimed, groups, state, progress, meetingLabel, uniqueReasons, clashSummary };

}));
