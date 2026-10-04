// scheduleconflicts.js
//
// Deterministic day/time-overlap logic for class sections. Pure
// functions only -- no DOM, no Supabase -- so the same rules run
// unchanged in the "Build your plan" schedule picker, in Cura's
// schedule summary (ai-assist/eligibility-explanation.js), and in
// Node tests.
//
// Nothing here decides what a student *should* take. It only answers
// two factual questions any consumer can rely on: do these two
// meetings overlap, and roughly what time of day is this section.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.ScheduleConflicts = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const MEETING_ORDER = { LEC: 0, LAB: 1, REC: 2 };

/* 'MW' -> ['M','W'], 'TTH' -> ['T','TH']. TH must be read before T.
   Longer spellings already in the data are understood too, and mean the same
   day: 'SAT' -> 'S', 'SUN' -> 'SU', 'THU'/'THURS' -> 'TH', 'MON', 'TUE',
   'WED', 'FRI'. Without that, 'SAT' read as Saturday plus Tuesday. The long
   names are tried first, so the single letters inside them are never
   picked up on their own. */
const DAY_TOKEN = /SUN|SAT|THURS|THUR|THU|MON|TUES|TUE|WED|FRI|SU|TH|M|T|W|F|S/g;
const DAY_CODE = {
    SUN: 'SU', SAT: 'S', THURS: 'TH', THUR: 'TH', THU: 'TH',
    MON: 'M', TUES: 'T', TUE: 'T', WED: 'W', FRI: 'F',
};

function parseDays(s) {
    return (String(s ?? '').toUpperCase().match(DAY_TOKEN) ?? []).map(d => DAY_CODE[d] ?? d);
}

function minutesOf(t) {
    const [h, m] = String(t ?? '').split(':').map(Number);
    return Number.isFinite(h) ? h * 60 + (m || 0) : null;
}

function meetingsClash(a, b) {
    const shared = parseDays(a.schedule_days).some(d => parseDays(b.schedule_days).includes(d));
    if (!shared) return false;
    const [a1, a2, b1, b2] = [minutesOf(a.start_time), minutesOf(a.end_time),
                              minutesOf(b.start_time), minutesOf(b.end_time)];
    if ([a1, a2, b1, b2].some(v => v === null)) return false;
    return a1 < b2 && b1 < a2;
}

/* Flat offering rows for one subject -> one group per section, each
   with its meetings (LEC/LAB/REC) sorted into a consistent order. */
function groupSections(meetings) {
    const bySection = new Map();
    for (const m of meetings ?? []) {
        if (!bySection.has(m.section)) bySection.set(m.section, []);
        bySection.get(m.section).push(m);
    }
    return [...bySection].map(([section, rows]) => {
        rows.sort((a, b) =>
            (MEETING_ORDER[a.meeting_type] ?? 9) - (MEETING_ORDER[b.meeting_type] ?? 9));
        return { section, meetings: rows, offeringId: rows[0].id ?? null };
    });
}

/* 'morning' before noon, 'afternoon' noon-5pm, 'evening' after 5pm.
   A section whose meetings span more than one bucket (an LEC that
   starts at 10am plus a LAB that runs until 6pm) is 'mixed', so
   nothing downstream has to guess which single label fits best. */
function timeOfDay(minutesValue) {
    if (minutesValue === null) return null;
    if (minutesValue < 12 * 60) return 'morning';
    if (minutesValue < 17 * 60) return 'afternoon';
    return 'evening';
}

function sectionTimeOfDay(meetings) {
    const buckets = new Set(
        (meetings ?? [])
            .map(m => timeOfDay(minutesOf(m.start_time)))
            .filter(Boolean));
    if (buckets.size === 0) return null;
    if (buckets.size > 1) return 'mixed';
    return [...buckets][0];
}

/* '13:00' -> '1:00 PM'. The one human-readable clock format every
   consumer (the picker's section labels, Cura's list of real start
   times) should share, so a time is never spelled two different ways. */
function formatClock(t) {
    if (!t) return '';
    const [h, m] = String(t).split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return '';
    return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/* Every distinct start time actually offered across a set of subjects'
   sections, sorted earliest-first with a ready-to-say label -- the
   real menu of choices, so a caller can offer "7:00 AM, 9:00 AM, or
   1:00 PM" instead of guessing at a preference in the abstract. */
function availableStartTimes(subjectsWithSections) {
    const seen = new Map(); // '07:30' -> minutes, for sorting
    for (const subject of subjectsWithSections ?? []) {
        for (const group of groupSections(subject.sections)) {
            for (const m of group.meetings) {
                if (!m.start_time) continue;
                if (!seen.has(m.start_time)) seen.set(m.start_time, minutesOf(m.start_time));
            }
        }
    }
    return [...seen.entries()]
        .sort((a, b) => a[1] - b[1])
        .map(([time]) => ({ time, label: formatClock(time) }));
}

/* Every clashing pair across a set of { label, meetings } sections --
   computed once here so a caller (Cura's summary, a plan picker) only
   ever needs to cite a fixed list of real conflicts, never work out
   day/time overlap on its own. */
function findClashes(labeledSections) {
    const clashes = [];
    for (let i = 0; i < labeledSections.length; i++) {
        for (let j = i + 1; j < labeledSections.length; j++) {
            const a = labeledSections[i];
            const b = labeledSections[j];
            const overlap = a.meetings.some(m1 => b.meetings.some(m2 => meetingsClash(m1, m2)));
            if (overlap) clashes.push({ a: a.label, b: b.label });
        }
    }
    return clashes;
}

return {
    parseDays,
    minutesOf,
    meetingsClash,
    groupSections,
    timeOfDay,
    sectionTimeOfDay,
    formatClock,
    availableStartTimes,
    findClashes,
};

}));
