// edpresult.js
//
// What the EDP office said about each subject of an approved plan, as the student reports it, and what
// to do next. The system cannot see EDP; the student ticks the subjects that were turned down and says
// why (db/077_edp_results.sql). Pure functions only (no page, no network), so the web page and the Node
// tests run the same code. The Android app has the same rules in data/plan/EdpResult.kt.
//
//   EdpResult.REASONS                      the reasons a student can pick, with what to do for each
//   EdpResult.checklistRows(request)       the subjects to tick, with anything already reported
//   EdpResult.payload(choices)             what is sent to report_edp_results
//   EdpResult.problems(choices)            what is wrong with the choices (a rejection needs a reason)
//   EdpResult.fullKeys(requests)           sections THIS student reported full: never suggested to them again
//   EdpResult.dropReported(offerings, keys)  the offerings without those sections
//   EdpResult.dropByOfferingIds(offerings, ids)  the same, given the offering ids the student reported full
//   EdpResult.openRows(offerings, keepSection)   the offerings the Department has not closed (the section already in the plan stays)
//   EdpResult.alternatives({...})          for each rejected subject: other sections, or other subjects, that fit
//
// A report changes only the student's own plan. It never closes a section for anyone else: only the
// Department can do that.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./scheduleconflicts.js'), require('./backupsections.js'));
    else root.EdpResult = factory(root.ScheduleConflicts, root.BackupSections);
}(typeof self !== 'undefined' ? self : this, function (SC, BS) {
'use strict';

/* kind: what the student does next.
     section  take another section of the same subject (or another subject if none fits)
     office   something an office has to sort out: no new plan can fix it */
const REASONS = [
    { value: 'full',       label: 'The section is full or closed',          kind: 'section',
      next: 'Ask the EDP office for another section, or choose another subject.' },
    { value: 'conflict',   label: 'The EDP office found a time conflict',    kind: 'section',
      next: 'Choose a section that does not overlap. If the posted schedule looks wrong, tell the Department.' },
    { value: 'code_error', label: 'Wrong EDP code or a mistake on the form', kind: 'section',
      next: 'Check each code against your Enrolment sheet, then write the form again.' },
    { value: 'record',     label: 'My record or a prerequisite was questioned', kind: 'office',
      next: 'Ask the Registrar to check your record, then go back to the EDP office.' },
    { value: 'overload',   label: 'Too many units',                          kind: 'office',
      next: 'Take out a subject, or ask your adviser about your unit limit.' },
    { value: 'hold',       label: 'A hold (balance or clearance)',           kind: 'office',
      next: 'Visit the Registrar or the Cashier. Your plan is still valid.' },
    { value: 'other',      label: 'Another reason',                          kind: 'section',
      next: 'Ask your adviser what to change. Another section may help.' },
];

const reasonOf = (value) => REASONS.find(r => r.value === value) ?? null;
const reasonLabel = (value) => reasonOf(value)?.label ?? '';
const nextStep = (value) => reasonOf(value)?.next ?? '';
/* Does another section or subject fix it? */
const needsNewSection = (value) => reasonOf(value)?.kind === 'section';

/* ---- the checklist ---- */

/* The subjects of an approved request the student can report on: only what the adviser approved. */
function checklistRows(request) {
    return (request?.request_item ?? [])
        .filter(i => i.status === 'approved')
        .map(i => ({
            itemId: i.id,
            subjectId: i.subject_id ?? null,
            code: i.subject?.code ?? '',
            title: i.subject?.title ?? '',
            units: Number(i.subject?.units) || 0,
            section: i._section?.section ?? null,
            edp: [...new Set((i._section?.meetings ?? []).map(m => String(m.edp_code ?? '').trim()).filter(Boolean))],
            result: i.edp_result ?? null,
            reason: i.edp_reason ?? null,
        }));
}

/* choices: [{ itemId, result: 'accepted' | 'rejected' | null, reason }] */
function problems(choices) {
    const out = [];
    for (const c of choices ?? []) {
        if (c.result !== null && c.result !== undefined && c.result !== 'accepted' && c.result !== 'rejected') {
            out.push({ itemId: c.itemId, message: 'Choose accepted or rejected.' });
        } else if (c.result === 'rejected' && !reasonOf(c.reason)) {
            out.push({ itemId: c.itemId, message: 'Say why it was rejected.' });
        }
    }
    return out;
}

function payload(choices) {
    return (choices ?? []).map(c => ({
        item_id: c.itemId,
        result: c.result ?? null,
        reason: c.result === 'rejected' ? c.reason : null,
    }));
}

/* ---- sections this student reported full ---- */

const sectionKey = (subjectId, section) => `${subjectId}|${section}`;

/* From the student's own requests (items carry _section after the page enriched them). Only "full" hides a
   section from future plans: a time conflict may be with another subject that is now changing. */
function fullKeys(requests) {
    const keys = new Set();
    for (const r of requests ?? []) {
        for (const i of r.request_item ?? []) {
            if (i.edp_result === 'rejected' && i.edp_reason === 'full' && i._section?.section && i.subject_id != null) {
                keys.add(sectionKey(i.subject_id, i._section.section));
            }
        }
    }
    return keys;
}

/* Offering rows (one per meeting) without the sections in keys. */
function dropReported(offerings, keys) {
    if (!keys || !keys.size) return offerings;
    return (offerings ?? []).filter(o => !keys.has(sectionKey(o.subject_id, o.section)));
}

/* The same, when all that is known is the offering ids of the items reported full (the planner reads those
   with one small query). An offering id is one meeting of a section, so the whole section goes. */
function dropByOfferingIds(offerings, offeringIds) {
    const ids = new Set(offeringIds ?? []);
    if (!ids.size) return offerings;
    const keys = new Set((offerings ?? []).filter(o => ids.has(o.id)).map(o => sectionKey(o.subject_id, o.section)));
    return dropReported(offerings, keys);
}

/* Offering rows (one per meeting) of the sections the Department has not closed (is_open = false). The section
   a plan already holds stays, closed or not, so the plan still shows it. */
function openRows(offerings, keepSection = null) {
    return (offerings ?? []).filter(o => o.is_open !== false || (keepSection != null && o.section === keepSection));
}

/* ---- alternatives ---- */

const clash = (a, b) => (a.meetings ?? []).some(m1 => (b.meetings ?? []).some(m2 => SC.meetingsClash(m1, m2)));

/*
 * request   the approved request: items with _section (the section chosen, a groupSections group) and
 *           _allSections (every section of that subject)
 * rejected  Set of item ids the student says were turned down
 * eligible  the engine's eligible entries ({ subject, sections: offering rows, availableThisTerm, alongside })
 * room      units that can still be added (the limit less what is kept)
 * fullKeys  sections reported full by this student
 * timeOfDay the student's class-time preference, or null
 *
 * returns Map: item id -> { sameSubject: [group], replacements: [{ code, title, units, group }] }
 * Other sections of the same subject come first; another subject is offered only when no other section fits.
 */
function alternatives({ request, rejected, eligible = [], room = Infinity, fullKeys: full = new Set(), timeOfDay = null, max = 3 }) {
    const items = (request?.request_item ?? []).filter(i => i.status === 'approved' && i._section);
    const isRejected = (i) => rejected.has(i.id);
    const kept = items.filter(i => !isRejected(i));
    const keptGroups = kept.map(i => i._section);
    const keptCodes = new Set(items.map(i => i.subject?.code));
    const isFull = (subjectId) => (g) => full.has(sectionKey(subjectId, g.section));

    const out = new Map();
    for (const item of items.filter(isRejected)) {
        const plan = [...kept, item].map(i => ({
            code: i.subject?.code ?? '', chosen: i._section.section, sections: i._allSections ?? [i._section],
        }));
        const own = BS.backupsFor(plan, { max, timeOfDay, isClosed: isFull(item.subject_id) })
            .get(item.subject?.code ?? '') ?? [];

        let replacements = [];
        if (!own.length) {
            const freed = (Number(item.subject?.units) || 0);
            for (const e of eligible) {
                if (replacements.length >= max) break;
                if (keptCodes.has(e.subject.code)) continue;
                if (e.availableThisTerm === false) continue;
                if (e.subject.year_level == null) continue;          // an elective choice, not a plan subject
                if ((e.alongside ?? []).length) continue;            // must be taken together with another subject
                const u = Number(e.subject.units) || 0;
                if (u > room + freed) continue;
                const group = SC.groupSections(e.sections)
                    .filter(g => !isFull(e.subject.id)(g))
                    .find(g => !keptGroups.some(k => clash(g, k)));
                if (!group) continue;
                replacements.push({ code: e.subject.code, title: e.subject.title, units: u, group });
            }
        }
        out.set(item.id, { sameSubject: own, replacements });
    }
    return out;
}

/*
 * Sections one subject of an approved plan can be switched to (db/079_move_item_section.sql): other open
 * sections of the same subject that do not clash with the rest of the plan, are not reported full by this
 * student, and have a meeting of the same kind (lecture for lecture, lab for lab) to move to.
 * Subjects the student says were turned down no longer take up time, so they do not count as a clash.
 *
 * returns [{ group, offeringId }]   offeringId is the meeting to pass to move_request_item_section
 */
function moveOptions({ request, item, fullKeys: full = new Set(), max = 6 }) {
    const current = (item?._section?.meetings ?? []).find(m => m.id === item.offering_id);
    if (!current) return [];

    const others = (request?.request_item ?? [])
        .filter(i => i.status === 'approved' && i._section && i.id !== item.id
            && i.subject_id !== item.subject_id && i.edp_result !== 'rejected');

    const out = [];
    for (const g of item._allSections ?? []) {
        if (out.length >= max) break;
        if (g.section === item._section.section) continue;
        if (full.has(sectionKey(item.subject_id, g.section))) continue;
        if (g.meetings.some(m => m.is_open === false)) continue;
        const target = g.meetings.find(m => (m.meeting_type ?? null) === (current.meeting_type ?? null));
        if (!target) continue;
        if (others.some(o => clash(g, o._section))) continue;
        out.push({ group: g, offeringId: target.id });
    }
    return out;
}

return { REASONS, reasonLabel, nextStep, needsNewSection, checklistRows, problems, payload, sectionKey, fullKeys, dropReported, dropByOfferingIds, openRows, alternatives, moveOptions };

}));
