// autoplan.js
//
// "Auto-select my plan": from a student's suggested subjects, choose a set the
// student can submit as it stands. Pure functions only (no page, no database),
// so every rule is testable.
//
// Nothing here decides who may take what: the engine already did that. This
// checks each suggested subject AGAIN before it goes in the plan, so a plan is
// never trusted just because it came from the engine:
//
//   1. subject conflicts  the same subject is never picked twice
//   2. this term          a subject the department is not running this term
//                         ("not-run") is left out. A subject with no section
//                         posted YET is kept (the engine recommends it from the
//                         curriculum, and with no times it cannot overlap
//                         anything) but is reported as added without a time check
//   3. time conflicts     the subjects are taken in the engine's order (retakes
//                         first), and a subject goes in only if SOME choice of
//                         sections, for it and for the ones already in, leaves
//                         nothing overlapping. Earlier subjects may move to
//                         another section to make room, so many sections never
//                         cost a subject its place. Wherever there is a choice
//                         the engine's own section is kept.
//   4. unit limit         a subject that would take the plan past the limit is
//                         left out
//   5. taken together     a subject that must be taken in the same term as another
//                         (entry.alongside) goes in with it, or not at all
//
// Every subject that is left out is reported with a plain reason.
// Subjects locked by a pending or approved request never arrive here: the page
// removes them from the candidates before this runs.
//
//   buildAutoPlan({ entries, suggestedIds, cap, conflicts })
//     entries       the picker's candidates, best first:
//                   { subject: {id, code, title, units}, sections: [flat meeting rows],
//                     scheduleState, chosenSection?: {section}, alongside?: [{id, code}] }
//     suggestedIds  Set of subject ids the engine suggests
//     cap           the most units the student may take now
//     conflicts     { groupSections, meetingsClash } (shared/js/schedule/scheduleconflicts.js)
//   -> { picks: [{ subjectId, code, title, units, section, offeringId, scheduled }],
//        skipped: [{ subjectId, code, title, reason }],
//        units, cap }

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.CurriculogicAutoPlan = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

/* The most section choices tried for one decision. A real term has a handful of
   subjects with a handful of sections each; this only guards against a freak
   timetable. Running out never produces an overlap: the subject is just left out. */
const SEARCH_LIMIT = 50000;

const NO_SECTION = Object.freeze({ section: null, meetings: [], offeringId: null });

const sectionsClash = (a, b, meetingsClash) =>
    a.meetings.some(m1 => b.meetings.some(m2 => meetingsClash(m1, m2)));

/* The groups of a subject, the engine's own section first. A subject with no
   section posted has one empty choice, which overlaps nothing. */
function choicesOf(entry, groupSections) {
    const groups = groupSections(entry.sections);
    if (!groups.length) return [NO_SECTION];
    const preferred = entry.chosenSection?.section;
    return [...groups].sort((a, b) => (b.section === preferred) - (a.section === preferred));
}

/* One section for each of the items, none overlapping another, or null.
   Depth-first, items in order, each item's choices in order: the first answer
   found is the one closest to everyone's first choice. */
function assignSections(items, meetingsClash) {
    const chosen = new Array(items.length);
    let tried = 0;

    const place = (i) => {
        if (i === items.length) return true;
        for (const g of items[i].choices) {
            if (++tried > SEARCH_LIMIT) return false;
            let free = true;
            for (let j = 0; j < i; j++) {
                if (sectionsClash(g, chosen[j], meetingsClash)) { free = false; break; }
            }
            if (!free) continue;
            chosen[i] = g;
            if (place(i + 1)) return true;
        }
        return false;
    };

    return place(0) ? chosen : null;
}

function buildAutoPlan({ entries, suggestedIds, cap, conflicts }) {
    const { groupSections, meetingsClash } = conflicts;
    const limit = Number.isFinite(Number(cap)) ? Number(cap) : 0;

    const skipped = [];
    const taken = new Set();        // subject ids already in the plan
    const items = [];               // what is in the plan so far, in order
    let assignment = [];            // one chosen section per item
    let units = 0;

    const leave = (entry, reason) => skipped.push({
        subjectId: entry.subject.id, code: entry.subject.code, title: entry.subject.title, reason,
    });

    const byId = new Map((entries ?? []).map(e => [e.subject.id, e]));
    const bundled = new Set();      // taken into the plan as someone's partner

    /* The entry and every subject it must be taken together with (and what those need
       in turn), minus what is already in the plan. Null when a partner cannot be added. */
    const bundleOf = (entry) => {
        const group = new Map();
        const stack = [entry];
        while (stack.length) {
            const cur = stack.pop();
            if (group.has(cur.subject.id) || taken.has(cur.subject.id)) continue;
            group.set(cur.subject.id, cur);
            for (const p of cur.alongside ?? []) {
                if (taken.has(p.id)) continue;
                const partner = byId.get(p.id);
                if (!partner) return { missing: p.code };
                if (partner.scheduleState === 'not-run') return { missing: p.code };
                stack.push(partner);
            }
        }
        return { entries: [...group.values()] };
    };

    for (const entry of entries ?? []) {
        if (!suggestedIds?.has(entry.subject.id)) continue;

        const id = entry.subject.id;

        // 1. subject conflicts (a partner added with an earlier subject is not a conflict)
        if (bundled.has(id)) continue;
        if (taken.has(id)) { leave(entry, 'Already in the plan.'); continue; }

        // 2. can it be taken this term?
        if (entry.scheduleState === 'not-run') {
            leave(entry, 'The department is not running it this term.');
            continue;
        }

        // 5. subjects it must be taken together with come in with it
        const bundle = bundleOf(entry);
        if (bundle.missing) {
            leave(entry, `It must be taken together with ${bundle.missing}, which cannot be added this term.`);
            continue;
        }
        const group = bundle.entries;
        const u = group.reduce((t, e) => t + (Number(e.subject.units) || 0), 0);

        // 4. unit limit (checked first: no point searching if it cannot fit)
        if (units + u > limit) {
            leave(entry, group.length > 1
                ? `It and ${group.filter(e => e !== entry).map(e => e.subject.code).join(', ')}, which go with it, would take the plan past your ${limit}-unit limit.`
                : `It would take the plan past your ${limit}-unit limit.`);
            continue;
        }

        // 3. time conflicts: is there ANY arrangement that holds everyone?
        const newItems = group.map(e => ({ entry: e, units: Number(e.subject.units) || 0, choices: choicesOf(e, groupSections) }));
        const item = newItems[0];
        const trial = assignSections([...items, ...newItems], meetingsClash);

        if (!trial) {
            // Say what is really in the way: any subject already in the plan
            // that overlaps every one of this subject's sections, in every one of its own.
            const blockers = items.filter(other =>
                other.choices.every(og => item.choices.every(g => sectionsClash(g, og, meetingsClash))));
            const names = blockers.map(b => b.entry.subject.code).join(', ');
            leave(entry, blockers.length
                ? (item.choices.length === 1
                    ? `Its only section overlaps with ${names}.`
                    : `Every section overlaps with ${names}.`)
                : 'No choice of sections fits it without an overlap with the rest of the plan.');
            continue;
        }

        for (const it of newItems) {
            taken.add(it.entry.subject.id);
            if (it.entry !== entry) bundled.add(it.entry.subject.id);
            items.push(it);
        }
        assignment = trial;
        units += u;
    }

    return {
        picks: items.map((it, i) => ({
            subjectId: it.entry.subject.id,
            code: it.entry.subject.code,
            title: it.entry.subject.title,
            units: it.units,
            section: assignment[i].section,
            offeringId: assignment[i].offeringId ?? null,
            scheduled: assignment[i] !== NO_SECTION,
        })),
        skipped,
        units,
        cap: limit,
    };
}

/* The sentence shown after the button is pressed. */
function summarize(plan) {
    const n = plan.picks.length;
    if (!n) {
        return 'Nothing could be selected automatically. You can still choose subjects yourself below.';
    }
    const subjects = `${n} subject${n === 1 ? '' : 's'}`;
    const unscheduled = plan.picks.filter(p => p.scheduled === false).length;

    let timing;
    if (unscheduled === 0) {
        timing = 'No two overlap in time.';
    } else if (unscheduled === n) {
        timing = 'No section is posted for ' + (n === 1 ? 'it' : 'them') + ' yet, so there is nothing to check for time clashes.';
    } else {
        timing = `${unscheduled} ${unscheduled === 1 ? 'has' : 'have'} no section posted yet, so ${unscheduled === 1 ? 'it was' : 'they were'} added without a time check. The others do not overlap in time.`;
    }

    return `Selected ${subjects}, ${plan.units} of ${plan.cap} units. ${timing} `
        + 'Each is open to you this term. Check the list, then press Submit for review.';
}

return { buildAutoPlan, summarize };

}));
