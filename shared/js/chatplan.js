// chatplan.js
//
// "Send this plan to my adviser" under a Cura answer: which subjects and
// sections the table on screen names. Pure functions only (no page, no
// database), so the rule is testable.
//
// Cura never decides what is sent. The table is built by the application from
// the student's real plan, and this only reads that table back. When the answer
// shows a schedule, the schedule is what the student is looking at (it may be an
// alternative version of the plan), so it wins over the plain suggestion table.
//
//   picksOf({ table, schedule }) -> [{ code, section }]
//   pairUp(picks, openEntries)   -> { chosen: [{ subjectId, section }], notOpen: [code] }
//   summary(chosen, units)       -> the confirmation line

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.CurriculogicChatPlan = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

/* The codes (and the section each is shown in) in the answer's table, each once.
   A subject with no published section has section null. */
function picksOf({ table, schedule } = {}) {
    const rows = (schedule?.rows?.length ? schedule.rows : table) ?? [];
    const seen = new Set();
    const picks = [];
    for (const r of rows) {
        const code = r?.code;
        if (!code || seen.has(code)) continue;
        seen.add(code);
        picks.push({ code, section: r.section ?? null });
    }
    return picks;
}

/* Match the picks to what the student can still choose in "Build your plan".
   A subject that is no longer open (sent, locked, closed) is reported, not sent.
   `open` is [{ subject: { id, code }, sections }]; a section name that no longer
   exists is dropped so the planner's own default is used instead. */
function pairUp(picks, open, sectionsOf = e => e.sections) {
    const byCode = new Map((open ?? []).map(e => [e.subject.code, e]));
    const chosen = [];
    const notOpen = [];
    for (const p of picks ?? []) {
        const entry = byCode.get(p.code);
        if (!entry) { notOpen.push(p.code); continue; }
        const names = new Set((sectionsOf(entry) ?? []).map(s => s.section));
        chosen.push({
            subjectId: entry.subject.id,
            section: p.section && names.has(p.section) ? p.section : null,
        });
    }
    return { chosen, notOpen };
}

/* "Send 3 subjects (9 units) to your adviser?" */
function summary(count, units) {
    const n = Number(count) || 0;
    const u = Number(units) || 0;
    return `Send ${n} subject${n === 1 ? '' : 's'} (${u} unit${u === 1 ? '' : 's'}) to your adviser?`;
}

return { picksOf, pairUp, summary };

}));
