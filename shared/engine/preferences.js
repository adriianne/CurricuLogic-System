// preferences.js
//
// Applies a student's preferences to an assessment. Pure functions only: no
// DOM, no Supabase, no network.
//
// WHAT THIS IS, AND IS NOT
//
// engine.js decides what a student MAY take and in what priority order. That
// stays the single source of truth: nothing here can make a locked subject
// eligible, and nothing here re-ranks the engine's list. This is a second,
// visible step that only does two things with what the engine already chose:
//
//   load   trims the list to the load the student asked for, dropping from
//          the bottom of the priority order (the least important first).
//   time   chooses a section for each subject so that nothing overlaps, and
//          among clash-free plans prefers the preferred time of day. A subject
//          with no section that fits beside the others is left out of the
//          suggested load (plan.leftOutForClash) instead of being shown clashing.
//
// Every choice carries a plain-language reason, so a student, an adviser or
// a panel can see exactly why a section or a load was suggested.
//
//   const plan = CurricuLogicPreferences.apply(assessResult, {
//       timeOfDay: 'morning',      // 'morning' | 'afternoon' | 'evening' | null
//       load: 'light',             // 'light' | 'regular' | 'full' | null
//   });
//   plan.recommended   // same shape as assess().recommended, plus
//                      //   chosenSection, timeMatch, clashesWith (always empty now)
//   plan.leftOutForClash // [{ ...entry, blockedBy: [labels], swaps: [{section, instead}] }]
//   plan.preference    // { timeOfDay, load, ceiling, deferred, notes }

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('../js/scheduleconflicts.js'));
    else root.CurricuLogicPreferences = factory(root.ScheduleConflicts);
}(typeof self !== 'undefined' ? self : this, function (SC) {
'use strict';

const TIMES = ['morning', 'afternoon', 'evening'];
const LOADS = ['light', 'regular', 'full'];

/* Units per term a student can ask for. "full" is the programme's own cap,
   so it is not a number here. Both are clamped to that cap. */
const LOAD_UNITS = { light: 15, regular: 21 };

const LABEL = { morning: 'morning', afternoon: 'afternoon', evening: 'evening' };

/* Anything unrecognised is treated as "no preference" rather than guessed at. */
function clean(prefs) {
    const p = prefs ?? {};
    return {
        timeOfDay: TIMES.includes(p.timeOfDay) ? p.timeOfDay : null,
        load: LOADS.includes(p.load) ? p.load : null,
    };
}

/* How well one section (a group from groupSections) suits a time of day.
   'match'   every meeting starts in that part of the day
   'partial' some do, some do not (a morning lecture and an afternoon lab)
   'other'   none do
   'any'     no preference was given, or the section has no times */
function timeMatchOf(group, wanted) {
    if (!wanted) return 'any';
    const parts = group.meetings
        .map(m => SC.timeOfDay(SC.minutesOf(m.start_time)))
        .filter(Boolean);
    if (!parts.length) return 'any';
    const hits = parts.filter(p => p === wanted).length;
    if (hits === parts.length) return 'match';
    return hits > 0 ? 'partial' : 'other';
}

const MATCH_RANK = { match: 0, any: 1, partial: 2, other: 3 };

function clashCount(group, chosen) {
    let n = 0;
    for (const c of chosen) {
        if (c.meetings.some(m1 => group.meetings.some(m2 => SC.meetingsClash(m1, m2)))) n++;
    }
    return n;
}

const timeWord = (t) => LABEL[t] ?? t;

/* ---- load ---- */

function ceilingFor(result, load) {
    if (!load || load === 'full') return null;
    return Math.min(Number(result.maxUnits) || Infinity, LOAD_UNITS[load]);
}

function trimToLoad(list, room) {
    const kept = [];
    const deferred = [];
    let units = 0;
    for (const e of list) {
        const u = Number(e.subject.units) || 0;
        if (units + u <= room) { kept.push(e); units += u; }
        else deferred.push(e);
    }
    return { kept, deferred, units };
}

/* ---- sections: the best clash-free mix ---- */

/* Two sections clash when any meeting of one overlaps any meeting of the other. */
const sectionsClash = (a, b) =>
    a.some(m1 => b.some(m2 => SC.meetingsClash(m1, m2)));

/* Safety stop for the search below. A term has a dozen subjects at most, so it is
   never reached in practice; if it were, the best plan found so far is used. */
const NODE_LIMIT = 200000;

/* What a subject is worth in the plan: a retake first, then its units, then how
   much it unlocks; a tiny amount more for coming earlier in the engine's order,
   so equal choices keep that order. */
function weightOf(e, i, n, force) {
    return (force && force.includes(e.subject.code) ? 5000 : 0)
        + (e.retake ? 1000 : 0)
        + (Number(e.subject.units) || 0) * 10
        + Math.min(Number(e.unlocks) || 0, 9)
        + (n - i) * 0.001;
}

/* Chooses a section for every subject so that nothing overlaps, and leaves a
   subject out only when no section of it fits beside the others. Among plans
   that place the same amount, the one that suits the preferred time better wins,
   then the department's own section order. Subjects the engine ranked first are
   weighed more, so what is left out is the least important.

   Exact search over a handful of subjects with a few sections each; nothing is
   guessed. */
function planSections(kept, wanted, force = []) {
    const n = kept.length;
    const items = kept.map((e, i) => {
        const groups = SC.groupSections(e.sections);
        const options = groups
            .map((g, gi) => ({ g, gi, match: timeMatchOf(g, wanted) }))
            .sort((a, b) => MATCH_RANK[a.match] - MATCH_RANK[b.match] || a.gi - b.gi);
        return { e, groups, options, weight: weightOf(e, i, n, force) };
    });

    const suffix = new Array(n + 1).fill(0);
    for (let i = n - 1; i >= 0; i--) suffix[i] = suffix[i + 1] + items[i].weight;

    let best = null;
    let nodes = 0;
    const picks = new Array(n).fill(null);
    const placed = [];     // { meetings } of the sections taken so far

    const improves = (score, cost) =>
        !best || score > best.score + 1e-9 || (Math.abs(score - best.score) <= 1e-9 && cost < best.cost - 1e-9);

    function search(i, score, cost) {
        if (++nodes > NODE_LIMIT) return;
        if (i === n) {
            if (improves(score, cost)) best = { score, cost, picks: picks.slice() };
            return;
        }
        // Even placing everything left cannot beat the best plan found: stop.
        if (best && score + suffix[i] < best.score - 1e-9) return;

        const item = items[i];

        // No schedule published: nothing to clash with, so it is always placed.
        if (!item.options.length) {
            picks[i] = { free: true };
            search(i + 1, score + item.weight, cost);
            picks[i] = null;
            return;
        }

        for (const opt of item.options) {
            if (placed.some(p => sectionsClash(p.meetings, opt.g.meetings))) continue;
            picks[i] = opt;
            placed.push({ meetings: opt.g.meetings });
            search(i + 1, score + item.weight, cost + MATCH_RANK[opt.match] + opt.gi * 0.001);
            placed.pop();
            picks[i] = null;
        }
        // Leave it out (tried after the ways of placing it).
        picks[i] = null;
        search(i + 1, score, cost);
    }
    search(0, 0, 0);

    const chosenPicks = best ? best.picks : new Array(n).fill(null);
    const out = [];
    const leftOut = [];
    const notes = [];
    const taken = [];     // { label, meetings } of the final plan

    items.forEach((item, i) => {
        const pick = chosenPicks[i];
        if (pick && !pick.free) taken.push({ code: item.e.subject.code, label: `${item.e.subject.code} (${pick.g.section})`, meetings: pick.g.meetings });
    });

    items.forEach((item, i) => {
        const e = item.e;
        const pick = chosenPicks[i];

        if (!item.groups.length) {
            out.push({
                ...e,
                chosenSection: null,
                timeMatch: 'none',
                clashesWith: [],
                preferenceReason: e.scheduleState === 'pending'
                    ? 'No schedule has been published for this yet.'
                    : 'No section is listed for this subject.',
            });
            return;
        }

        if (!pick) {
            // Left out: say what blocks each of its sections, and which single
            // subject would have to give way for a section to fit.
            const perSection = item.groups.map(g => {
                const clashing = taken.filter(c => sectionsClash(c.meetings, g.meetings));
                return { section: g.section, with: clashing.map(c => c.label), codes: clashing.map(c => c.code) };
            });
            const blockedBy = [...new Set(perSection.flatMap(s => s.with))];
            const swaps = perSection
                .filter(s => s.with.length === 1)
                .map(s => ({ section: s.section, instead: s.with[0] }));
            // For each suggested subject: can this one be taken together with it? Yes when
            // some section of this subject does not clash with it; the other suggested
            // subjects in the way of that section would then have to be dropped.
            const together = [...new Set(taken.map(c => c.code))].map(code => {
                const ways = perSection
                    .filter(s => !s.codes.includes(code))
                    .sort((a, b) => a.codes.length - b.codes.length);
                return ways.length
                    ? { with: code, possible: true, takeSection: ways[0].section, dropFirst: ways[0].codes }
                    : { with: code, possible: false, takeSection: null, dropFirst: [] };
            });
            leftOut.push({ ...e, blockedBy, swaps, together });
            notes.push(`${e.subject.code} is not in your suggested load: every section clashes with ${blockedBy.join(' and ')}.`);
            return;
        }

        const g = pick.g;
        const tod = SC.sectionTimeOfDay(g.meetings);
        let reason;
        if (!wanted) {
            reason = item.groups.length > 1 ? `Section ${g.section}.` : `Only section: ${g.section}.`;
        } else if (pick.match === 'match') {
            reason = `Section ${g.section} is a ${timeWord(wanted)} class, as you preferred.`;
        } else if (item.groups.length === 1) {
            reason = `Only section ${g.section} is offered${tod ? ` (${timeWord(tod)})` : ''}.`;
        } else {
            reason = `No ${timeWord(wanted)} section is free of clashes; section ${g.section}${tod ? ` is ${timeWord(tod)}` : ''}.`;
        }

        out.push({
            ...e,
            chosenSection: { section: g.section, timeOfDay: tod, meetings: g.meetings },
            timeMatch: pick.match,
            clashesWith: [],
            preferenceReason: reason,
        });

        if (wanted && pick.match !== 'match' && pick.match !== 'any') {
            notes.push(`${e.subject.code} has no ${timeWord(wanted)} section${tod ? `; suggested ${timeWord(tod)}` : ''}.`);
        }
    });

    return { out, leftOut, notes };
}

/* ---- alternatives ---- */

const planKey = (out) =>
    out.map(e => `${e.subject.code}@${e.chosenSection ? e.chosenSection.section : '-'}`).sort().join('|');

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/* Other clash-free plans worth offering, each named and described by how it differs from
   the main one: the same subjects in morning / afternoon / evening sections where that
   changes anything, and, for the first subjects that did not fit, a plan that takes
   that subject instead of something else. Never more than four, never a repeat. */
function alternativesFor(fits, primary, wanted) {
    const mainKey = planKey(primary.out);
    const mainSection = new Map(primary.out.map(e => [e.subject.code, e.chosenSection ? e.chosenSection.section : null]));
    const seen = new Set([mainKey]);
    const found = [];

    const variants = [];
    for (const t of TIMES) if (t !== wanted) variants.push({ label: `${cap(t)} classes`, wanted: t, force: [], time: t });
    for (const l of primary.leftOut.slice(0, 2)) {
        variants.push({ label: `Include ${l.subject.code}`, wanted, force: [l.subject.code], time: wanted });
    }

    for (const v of variants) {
        if (found.length >= 4) break;
        const alt = planSections(fits, v.wanted, v.force);
        const key = planKey(alt.out);
        if (seen.has(key)) continue;
        seen.add(key);

        const changes = [];
        for (const e of alt.out) {
            const code = e.subject.code;
            const sec = e.chosenSection ? e.chosenSection.section : null;
            if (!mainSection.has(code)) changes.push(`${code} is added`);
            else if (mainSection.get(code) !== sec && sec) changes.push(`${code} moves to section ${sec}`);
        }
        const altCodes = new Set(alt.out.map(e => e.subject.code));
        for (const code of mainSection.keys()) if (!altCodes.has(code)) changes.push(`${code} is left out`);

        const timed = alt.out.filter(e => e.chosenSection);
        const matched = v.time ? timed.filter(e => e.timeMatch === 'match').length : 0;
        found.push({
            label: v.label,
            placed: alt.out.map(e => ({ code: e.subject.code, section: e.chosenSection ? e.chosenSection.section : null })),
            notIncluded: alt.leftOut.map(l => l.subject.code),
            units: alt.out.reduce((t, e) => t + (Number(e.subject.units) || 0), 0),
            changes,
            note: v.time && timed.length ? `${matched} of ${timed.length} scheduled subject${timed.length === 1 ? '' : 's'} in ${v.time} sections.` : null,
        });
    }
    return found;
}

/* ---- main entry point ---- */

function apply(result, prefs) {
    const p = clean(prefs);
    const notes = [];

    const ceiling = ceilingFor(result, p.load);
    const room = ceiling === null
        ? Number(result.availableUnits) || 0
        : Math.max(0, ceiling - (Number(result.enrolledUnits) || 0));

    // A preference can only shrink what the engine suggested, never add to it.
    const { kept: fits, deferred } = trimToLoad(result.recommended, Math.min(room, Number(result.availableUnits) || 0));

    if (deferred.length) {
        notes.push(`Kept to about ${ceiling} units as you asked; ${deferred.length} subject${deferred.length === 1 ? '' : 's'} moved to a later term.`);
        if (result.graduating) {
            notes.push('You are close to graduating: a lighter load may add a term.');
        }
        if (deferred.some(d => d.retake)) {
            notes.push('A retake was left out to keep the load. Retakes normally come first.');
        }
    }

    const planned = planSections(fits, p.timeOfDay);
    const { out, leftOut, notes: sectionNotes } = planned;
    notes.push(...sectionNotes);
    const alternatives = alternativesFor(fits, planned, p.timeOfDay);

    if (p.timeOfDay) {
        const withTimes = out.filter(e => e.chosenSection);
        const matched = withTimes.filter(e => e.timeMatch === 'match').length;
        if (withTimes.length) {
            notes.unshift(`${matched} of ${withTimes.length} scheduled subject${withTimes.length === 1 ? '' : 's'} fit your ${timeWord(p.timeOfDay)} preference.`);
        }
    }

    return {
        ...result,
        recommended: out,
        // Eligible and within the load, but with no section that fits beside the
        // plan; each says what blocks it and what single swap would make room.
        leftOutForClash: leftOut,
        // Other clash-free plans: [{ label, placed: [{code, section}], notIncluded, units, changes, note }]
        alternatives,
        recommendedUnits: out.reduce((t, e) => t + (Number(e.subject.units) || 0), 0),
        preference: {
            timeOfDay: p.timeOfDay,
            load: p.load,
            ceiling,
            deferred: deferred.map(d => d.subject.code),
            deferredForClash: leftOut.map(d => d.subject.code),
            notes,
        },
    };
}

return { apply, clean, TIMES, LOADS, LOAD_UNITS };

}));
