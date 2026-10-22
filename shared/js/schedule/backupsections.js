// backupsections.js
//
// For each subject of a plan, a couple of OTHER sections the student could take if the one in the plan
// turns out to be full at the EDP office. This system cannot see seats (the EDP office checks the
// enrolment form), so the best help is a backup that is already worked out: the same subject, a different
// section, and no clash with the rest of the plan.
//
// Pure functions only (no DOM, no network), so the web page, the printed enrolment sheet and Node tests
// all run the same code. The Android app has the same rules in data/plan/BackupSections.kt.
//
//   const plan = [{ code: 'IT-OOPROG21', chosen: 'BSIT-2A', sections: groupSections(rows) }, ...];
//   const backups = BackupSections.backupsFor(plan, { timeOfDay: 'morning' });
//   backups.get('IT-OOPROG21')   // [ { section: 'BSIT-2B', meetings: [...], offeringId: 12 }, ... ]
//
// A "section" is what ScheduleConflicts.groupSections returns: { section, meetings: [offering rows], offeringId }.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./scheduleconflicts.js'));
    else root.BackupSections = factory(root.ScheduleConflicts);
}(typeof self !== 'undefined' ? self : this, function (SC) {
'use strict';

const MAX_BACKUPS = 2;

function sectionsClash(a, b) {
    return (a.meetings ?? []).some(m1 => (b.meetings ?? []).some(m2 => SC.meetingsClash(m1, m2)));
}

/* The first minute any meeting of the section starts, or null when no time is posted. */
function firstStart(group) {
    // minutesOf() reads a missing time as 00:00, so only meetings that really have a time count
    const starts = (group.meetings ?? []).filter(m => m.start_time).map(m => SC.minutesOf(m.start_time)).filter(v => v !== null);
    return starts.length ? Math.min(...starts) : null;
}

/*
 * plan:    [{ code, chosen, sections }]   chosen = the section name in the plan (or null)
 * options: { max = 2, timeOfDay = null, isClosed = (group) => false }
 *   timeOfDay  the student's class-time preference ('morning' | 'afternoon' | 'evening'); with none, a backup
 *              is preferred when it meets at the same time of day as the section it replaces
 *   isClosed   sections the school has marked full or closed are never offered as a backup
 * returns a Map: code -> up to `max` sections, best first. A subject with no other fitting section maps to [].
 */
function backupsFor(plan, options = {}) {
    const max = options.max ?? MAX_BACKUPS;
    const isClosed = options.isClosed ?? (() => false);
    const wanted = options.timeOfDay ?? null;

    const placed = (plan ?? []).map(entry => ({
        entry,
        group: (entry.sections ?? []).find(g => g.section === entry.chosen) ?? null,
    }));

    const out = new Map();
    for (const { entry, group: current } of placed) {
        const others = placed.filter(p => p.entry !== entry && p.group).map(p => p.group);
        const currentTime = current ? SC.sectionTimeOfDay(current.meetings) : null;
        const target = wanted ?? currentTime;

        const fitting = (entry.sections ?? [])
            .filter(g => g.section !== entry.chosen)
            .filter(g => !isClosed(g))
            .filter(g => !others.some(o => sectionsClash(g, o)));

        const ranked = fitting
            .map(g => {
                const start = firstStart(g);
                return {
                    g,
                    // 0 = meets at the preferred time of day, 1 = another time, so a closer match comes first
                    away: target && SC.sectionTimeOfDay(g.meetings) === target ? 0 : 1,
                    // a section with no posted time cannot be checked for clashes, so it comes last
                    unposted: start === null ? 1 : 0,
                    start: start ?? Infinity,
                };
            })
            .sort((a, b) =>
                a.unposted - b.unposted || a.away - b.away || a.start - b.start || a.g.section.localeCompare(b.g.section));

        out.set(entry.code, ranked.slice(0, max).map(r => r.g));
    }
    return out;
}

return { backupsFor, sectionsClash, MAX_BACKUPS };

}));
