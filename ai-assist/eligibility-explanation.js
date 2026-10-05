// eligibility-explanation.js
//
// Takes the real, already-computed output of engine.assess() and reduces
// it to the small, flat shape the explain-eligibility Edge Function
// actually needs. Nothing here makes any decision -- it only selects and
// renames fields that already exist in assess()'s real return value.
//
// Why this exists rather than sending assess() output directly:
// assess() returns full subject rows, raw rule-group trace objects, and
// nested offering records. Sending that whole thing to Gemini wastes
// tokens on data it will never reference, and a bigger, messier payload
// makes it more likely the model treats something as its own information
// to reason over, rather than a fact it must simply narrate.
//
// Load this in the same page that already calls engine.assess() -- the
// student dashboard, and the faculty page that views one student.

// Shared with the "Build your plan" schedule picker (see
// features/student/studentdashboard.js) so a clash Cura reports and a
// clash the picker flags can never disagree -- both read the same
// deterministic overlap check, computed once, here.
const SC = (typeof window !== 'undefined' && window.ScheduleConflicts)
    ? window.ScheduleConflicts
    : require('../shared/js/scheduleconflicts.js');

// r.sections is the flat offering rows engine.assess() already attached
// per recommended subject (shared/engine/engine.js). Grouped into
// sections and labelled with a time-of-day bucket, that is everything
// Cura needs to discuss schedules -- it never computes overlap itself.
function summarizeSections(r) {
    return SC.groupSections(r.sections).map(g => ({
        section: g.section,
        meetings: g.meetings.map(m => ({
            type: m.meeting_type,
            days: m.schedule_days,
            start: m.start_time,
            end: m.end_time,
        })),
        timeOfDay: SC.sectionTimeOfDay(g.meetings),
    }));
}

/* opts.inRequestIds: ids of subjects the student has already submitted and that
   are still awaiting a decision (the same set the Build your plan page marks
   "In review"). They are kept out of "recommended" -- Cura must not suggest them
   again, and the plan table is drawn from that list -- and listed under
   "inReview" instead. */
function summarizeForExplanation(assessResult, studentName, opts = {}) {
    const { facts, locked, totalUnits } = assessResult;
    const inReviewIds = new Set(opts.inRequestIds ?? []);
    const allRecommended = assessResult.recommended;
    const recommended = allRecommended.filter(r => !inReviewIds.has(r.subject.id));
    const inReview = allRecommended.filter(r => inReviewIds.has(r.subject.id));
    const unitsOf = (list) => list.reduce((n, r) => n + (Number(r.subject.units) || 0), 0);

    // Only the plain-English "detail" strings from each unmet condition
    // survive here -- evaluateCondition() in engine.js already writes
    // these as full sentences ("CC-NETWORK31 has not been taken."), so
    // there is nothing left to interpret; only to narrate.
    const lockedSummary = locked
        .filter(l => l.termsAway !== null)          // reachable within the horizon
        .sort((a, b) => (a.termsAway ?? 99) - (b.termsAway ?? 99))
        .slice(0, 6)                                 // cap: a summary, not a full list
        .map(l => ({
            code: l.subject.code,
            title: l.subject.title,
            termsAway: l.termsAway,
            reasons: l.unmet.map(c => c.detail),
        }));

    const recommendedSummary = recommended.map(r => ({
        code: r.subject.code,
        title: r.subject.title,
        units: r.subject.units,
        retake: r.retake,
        reason: r.reason,
        sections: summarizeSections(r),
        // Set only when the student has stated a preference: the section
        // that was picked for them and why, so Cura cites it, not guesses.
        chosenSection: r.chosenSection
            ? { section: r.chosenSection.section, timeOfDay: r.chosenSection.timeOfDay }
            : null,
        timeMatch: r.timeMatch ?? null,
        sectionReason: r.preferenceReason ?? null,
        // An open elective slot: the catalogue subjects that could fill it.
        slotOptions: r.slotOptions ?? null,
    }));

    // What the student asked for and what it changed, as computed by
    // shared/engine/preferences.js. Null when nothing was applied.
    const pref = assessResult.preference ?? null;
    const preferences = pref && (pref.timeOfDay || pref.load)
        ? {
            timeOfDay: pref.timeOfDay,
            load: pref.load,
            unitCeiling: pref.ceiling,
            movedToLaterTerm: pref.deferred,
            notes: pref.notes,
        }
        : null;

    // Every real day/time overlap between two recommended subjects'
    // sections, labelled by subject code -- so if asked "can I take
    // both", Cura cites this list instead of reasoning about times
    // itself. A subject with more than one section can clash on one
    // offering and not another; both are reported.
    const leftOut = assessResult.leftOutForClash ?? [];
    const labeledSections = [...allRecommended, ...leftOut].flatMap(r =>
        SC.groupSections(r.sections).map(g => ({
            label: `${r.subject.code} (${g.section})`,
            meetings: g.meetings,
        })));
    const scheduleConflicts = SC.findClashes(labeledSections);

    // The real menu of start times actually offered across the
    // recommended list -- e.g. [{time:'07:30',label:'7:30 AM'}, ...] --
    // so Cura can offer concrete choices ("7:30 AM, 10:00 AM, or 1:00
    // PM?") when asking about a time preference, instead of only the
    // coarse morning/afternoon/evening buckets on each section.
    const availableStartTimes = SC.availableStartTimes(recommended);

    return {
        studentName: studentName ?? null,
        unitsEarned: facts.unitsEarned,
        totalUnits,
        completedThroughPosition: facts.completedThroughPosition,
        recommended: recommendedSummary,
        // Units of what is still to be submitted, not of the whole suggested load.
        recommendedUnits: inReviewIds.size ? unitsOf(recommended) : assessResult.recommendedUnits,
        // The most the student may take this term (24, or more when graduating).
        // "recommendedUnits" is what is suggested, which can be less.
        unitLimit: assessResult.maxUnits ?? null,
        graduating: assessResult.graduating === true,
        // Already submitted and waiting for the adviser: not to be suggested again.
        inReview: inReview.map(r => ({ code: r.subject.code, title: r.subject.title, units: r.subject.units })),
        inReviewUnits: unitsOf(inReview),
        preferences,
        scheduleConflicts,
        // Eligible subjects the planner could not fit beside the suggested ones. Each says
        // which suggested subject-sections block its sections ("blockedBy") and which single
        // swap would make room ("swaps": take it in that section instead of that subject).
        // Null when everything fits.
        leftOutForClash: leftOut.length
            ? leftOut.map(l => ({
                code: l.subject.code,
                title: l.subject.title,
                units: l.subject.units,
                sections: summarizeSections(l),
                blockedBy: l.blockedBy ?? [],
                swaps: l.swaps ?? [],
                // Can it be taken together with each suggested subject? possible:true says in
                // which section, and which suggested subjects (dropFirst) would have to be dropped.
                together: l.together ?? [],
            }))
            : null,
        // Other clash-free plans the student can ask to see, each named by "label" and described by
        // "changes" against the current one. Empty when there is no real alternative.
        alternatives: (assessResult.alternatives ?? []).map(a => ({
            label: a.label,
            units: a.units,
            placed: a.placed,
            notIncluded: a.notIncluded,
            changes: a.changes,
            note: a.note,
        })),
        availableStartTimes,
        locked: lockedSummary,
        lockedCount: locked.length,      // so "6 more subjects are also locked" is possible
    };
}

if (typeof module === 'object' && module.exports) {
    module.exports = { summarizeForExplanation };
}