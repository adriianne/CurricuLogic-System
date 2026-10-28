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
// WISHES (optional). The student can say, in their own words to Cura, what they want:
//   { earliestStart:'HH:MM'|null, latestEnd:'HH:MM'|null, avoidDays:['MON'..'SUN'],
//     maxUnits:int|null, keepSubjects:[subject codes] }   (checked by cleanWishes in
//   supabase/functions/eligibility-chat/core.js before it gets here)
// They only steer a choice that already passed every rule above; they never add a subject
// the student cannot take or a section that is not posted:
//   - a section that starts too early, ends too late or meets on an avoided day is only used when
//     nothing else fits, and the pick says so ("misses"), so the student sees the closest real option
//   - the units wish lowers the limit for this plan (never raises it)
//   - kept subjects are placed first, so they win a clash, and are added even when the engine did
//     not suggest them. One that cannot fit is reported, never silently dropped.
//   - a subject with no section posted yet has no times, so time and day wishes cannot be checked on it.
//
// Every subject that is left out is reported with a plain reason.
// Subjects locked by a pending or approved request never arrive here: the page
// removes them from the candidates before this runs.
//
//   buildAutoPlan({ entries, suggestedIds, cap, conflicts, wishes })
//     entries       the picker's candidates, best first:
//                   { subject: {id, code, title, units}, sections: [flat meeting rows],
//                     scheduleState, chosenSection?: {section}, alongside?: [{id, code}] }
//     suggestedIds  Set of subject ids the engine suggests
//     cap           the most units the student may take now
//     conflicts     { groupSections, meetingsClash } (shared/js/schedule/scheduleconflicts.js)
//   -> { picks: [{ subjectId, code, title, units, section, offeringId, scheduled, misses }],
//        skipped: [{ subjectId, code, title, reason, kept }],
//        units, cap, wishes }
//      misses  plain phrases for each wish the chosen section does not meet ([] when it meets all)
//      cap     the limit used: the student's own, or the lower units wish
//      wishes  the wishes that were applied, or null

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.CurriculogicAutoPlan = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

/* The most section choices tried for one decision. A real term has a handful of
   subjects with a handful of sections each; this only guards against a freak
   timetable. Running out never produces an overlap: the subject is just left out. */
const SEARCH_LIMIT = 50000;

const NO_SECTION = Object.freeze({ section: null, meetings: [], offeringId: null, misses: [] });

const sectionsClash = (a, b, meetingsClash) =>
    a.meetings.some(m1 => b.meetings.some(m2 => meetingsClash(m1, m2)));

const AVOID_DAY = { MON: 'M', TUE: 'T', WED: 'W', THU: 'TH', FRI: 'F', SAT: 'S', SUN: 'SU' };
const DAY_NAME = { MON: 'Monday', TUE: 'Tuesday', WED: 'Wednesday', THU: 'Thursday', FRI: 'Friday', SAT: 'Saturday', SUN: 'Sunday' };

const clock = (hhmm) => {
    const [h, m] = hhmm.split(':').map(Number);
    return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};

/* Which of the wishes a section does not meet, as short phrases. A meeting without a time
   or day cannot break a wish about it. */
function missesOf(group, wishes, conflicts) {
    if (!wishes) return [];
    const { parseDays, minutesOf } = conflicts;
    const out = [];
    const early = wishes.earliestStart ? minutesOf(wishes.earliestStart) : null;
    const late = wishes.latestEnd ? minutesOf(wishes.latestEnd) : null;
    const avoid = new Map((wishes.avoidDays ?? []).filter(d => AVOID_DAY[d]).map(d => [AVOID_DAY[d], d]));

    if (early !== null && group.meetings.some(m => { const t = minutesOf(m.start_time); return t !== null && t < early; })) {
        out.push(`starts before ${clock(wishes.earliestStart)}`);
    }
    if (late !== null && group.meetings.some(m => { const t = minutesOf(m.end_time); return t !== null && t > late; })) {
        out.push(`ends after ${clock(wishes.latestEnd)}`);
    }
    const hit = new Set();
    for (const m of group.meetings) for (const d of parseDays(m.schedule_days)) if (avoid.has(d)) hit.add(avoid.get(d));
    for (const d of hit) out.push(`meets on ${DAY_NAME[d]}`);
    return out;
}

/* The groups of a subject. Sections that meet every wish come first, and within those the
   engine's own section. A subject with no section posted has one empty choice, which
   overlaps nothing and breaks no wish (it has no times to break one with). */
function choicesOf(entry, groupSections, wishes, conflicts) {
    const groups = groupSections(entry.sections);
    if (!groups.length) return [NO_SECTION];
    const preferred = entry.chosenSection?.section;
    return groups
        .map(g => ({ ...g, misses: missesOf(g, wishes, conflicts) }))
        .sort((a, b) =>
            ((a.misses.length > 0) - (b.misses.length > 0)) || ((b.section === preferred) - (a.section === preferred)));
}

/* The same items, each limited to the sections that meet every wish, where it has any. */
const fittingOnly = (items) => items.map(it => {
    const ok = it.choices.filter(c => c.misses.length === 0);
    return ok.length ? { ...it, choices: ok } : it;
});

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

const looseCode = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

function buildAutoPlan({ entries, suggestedIds, cap, conflicts, wishes = null }) {
    const { groupSections, meetingsClash } = conflicts;
    const studentCap = Number.isFinite(Number(cap)) ? Number(cap) : 0;
    // A units wish can only lower the limit.
    const wishUnits = Number.isFinite(Number(wishes?.maxUnits)) && Number(wishes.maxUnits) > 0 ? Number(wishes.maxUnits) : null;
    const limit = wishUnits !== null ? Math.min(studentCap, wishUnits) : studentCap;

    const keep = new Set((wishes?.keepSubjects ?? []).map(looseCode));
    const isKept = (entry) => keep.has(looseCode(entry.subject.code));

    const skipped = [];
    const taken = new Set();        // subject ids already in the plan
    const items = [];               // what is in the plan so far, in order
    let assignment = [];            // one chosen section per item
    let units = 0;

    const leave = (entry, reason) => skipped.push({
        subjectId: entry.subject.id, code: entry.subject.code, title: entry.subject.title,
        reason: isKept(entry) ? `You asked to keep it, but: ${reason.charAt(0).toLowerCase()}${reason.slice(1)}` : reason,
        kept: isKept(entry),
    });

    // A subject the student insisted on that is not among the candidates at all.
    const have = new Set((entries ?? []).map(e => looseCode(e.subject.code)));
    for (const code of wishes?.keepSubjects ?? []) {
        if (!have.has(looseCode(code))) {
            skipped.push({ subjectId: null, code, title: '', reason: 'You asked to keep it, but it is not available to add to a plan right now.', kept: true });
        }
    }

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

    // Kept subjects go first so they win a clash; otherwise the engine's order stands.
    const ordered = [...(entries ?? [])].sort((a, b) => isKept(b) - isKept(a));

    for (const entry of ordered) {
        if (!suggestedIds?.has(entry.subject.id) && !isKept(entry)) continue;

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
            // Name the units wish, not the student's limit, when the wish is what stopped it.
            const what = wishUnits !== null && units + u <= studentCap ? `your ${limit}-unit wish` : `your ${limit}-unit limit`;
            leave(entry, group.length > 1
                ? `It and ${group.filter(e => e !== entry).map(e => e.subject.code).join(', ')}, which go with it, would take the plan past ${what}.`
                : `It would take the plan past ${what}.`);
            continue;
        }

        // 3. time conflicts: is there ANY arrangement that holds everyone?
        const newItems = group.map(e => ({ entry: e, units: Number(e.subject.units) || 0, choices: choicesOf(e, groupSections, wishes, conflicts) }));
        const item = newItems[0];
        // First try to keep every wish; only when that leaves no arrangement, let a section that breaks one in.
        const all = [...items, ...newItems];
        const trial = assignSections(fittingOnly(all), meetingsClash) ?? assignSections(all, meetingsClash);

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
            misses: assignment[i].misses ?? [],
        })),
        skipped,
        units,
        cap: limit,
        wishes: wishes ?? null,
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

    // Wishes a posted section could not meet: say which, so the plan is not mistaken for a perfect fit.
    const missed = plan.picks.filter(p => p.misses?.length);
    const timeWish = plan.wishes && (plan.wishes.earliestStart || plan.wishes.latestEnd || plan.wishes.avoidDays?.length);
    const wishNote = (missed.length
        ? ` Closest real sections, not a full match: ${missed.map(p => `${p.code} ${p.misses.join(' and ')}`).join('; ')}.`
        : '')
        + (timeWish && unscheduled ? ' Your time and day wishes could not be checked on the subjects with no section yet.' : '');

    return `Selected ${subjects}, ${plan.units} of ${plan.cap} units. ${timing}${wishNote} `
        + 'Each is open to you this term. Check the list, then press Submit for review.';
}

/* The wishes in plain words, one phrase each, for showing the student what was understood.
   Built from the checked wishes only, never from what the model wrote. */
function describeWishes(wishes) {
    if (!wishes) return [];
    const out = [];
    if (wishes.earliestStart) out.push(`no classes before ${clock(wishes.earliestStart)}`);
    if (wishes.latestEnd) out.push(`classes done by ${clock(wishes.latestEnd)}`);
    const days = (wishes.avoidDays ?? []).filter(d => DAY_NAME[d]).map(d => DAY_NAME[d]);
    if (days.length) out.push(`no classes on ${days.join(', ')}`);
    if (wishes.maxUnits) out.push(`up to ${wishes.maxUnits} units`);
    if ((wishes.keepSubjects ?? []).length) out.push(`keep ${wishes.keepSubjects.join(', ')}`);
    return out;
}

return { buildAutoPlan, summarize, describeWishes };

}));
