// vacanttime.js
//
// Vacant time in a student's plan, and swaps that reduce it. Rules only: no AI, no network, no DOM.
//
// Vacant time is the hours between two classes on the SAME day. The lunch hour (12:00-13:00) is not
// counted, and the wait before the first class or after the last one is not counted either.
//
// A swap moves ONE subject from the section it is in to another section of the SAME subject, with
// all of that subject's meetings (lecture and lab) together. So a swap can never repeat a subject,
// and a suggestion is only made when the whole plan stays free of overlaps.
//
//   vacantTime(meetings, sc)            -> { hours, gaps: [{ day, from, to, hours }] }
//   suggestSwaps({ picks, fixed, sc, maxSwaps }) -> { before, after, swaps: [...], reason }
//
//   picks    [{ subjectId, code, section, sections: [flat meeting rows of the subject, all sections] }]
//   fixed    flat meeting rows of subjects already sent or approved this term: counted in the vacant time and
//            never overlapped, never moved (optional)
//   sc       { groupSections, meetingsClash, parseDays, minutesOf }  (scheduleconflicts.js)
//   swaps    [{ subjectId, code, from, to, meetings: [flat rows of the new section] }], best plan first
//   status   'found' | 'no-gap' | 'none-posted' | 'one-section' | 'no-help'
//   reason   '' when swaps exist, otherwise why there is nothing to suggest.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.CurriculogicVacantTime = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const LUNCH_START = 12 * 60;
const LUNCH_END = 13 * 60;
const EPS = 1e-9;

/* Gaps between classes on each day. meetings: flat rows { schedule_days, start_time, end_time }. */
function vacantTime(meetings, sc) {
    const byDay = new Map();
    for (const m of meetings ?? []) {
        const a = sc.minutesOf(m.start_time), b = sc.minutesOf(m.end_time);
        if (a === null || b === null || b <= a) continue;
        for (const d of sc.parseDays(m.schedule_days)) {
            if (!byDay.has(d)) byDay.set(d, []);
            byDay.get(d).push([a, b]);
        }
    }
    const gaps = [];
    for (const [day, list] of byDay) {
        list.sort((x, y) => x[0] - y[0]);
        let reach = list[0][1];                       // how far today's classes reach so far
        for (let i = 1; i < list.length; i++) {
            const [s, e] = list[i];
            if (s > reach) {
                const lunch = Math.max(0, Math.min(s, LUNCH_END) - Math.max(reach, LUNCH_START));
                const hours = (s - reach - lunch) / 60;
                if (hours > EPS) gaps.push({ day, from: reach, to: s, hours });
            }
            reach = Math.max(reach, e);
        }
    }
    return { hours: gaps.reduce((t, g) => t + g.hours, 0), gaps };
}

const flat = (groups) => groups.flatMap(g => g.meetings);

/* [fixed]: meetings of subjects already sent to the adviser (or approved). They count in the plan, and nothing may
   overlap them, but they are never moved. */
function planClashes(groupsChosen, sc, fixed = []) {
    const all = flat(groupsChosen).concat(fixed);
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
        if (sc.meetingsClash(all[i], all[j])) return true;
    }
    return false;
}

function suggestSwaps({ picks, fixed = [], sc, maxSwaps = 2 }) {
    const items = (picks ?? []).map(p => {
        const groups = sc.groupSections(p.sections);
        const current = groups.find(g => g.section === p.section) ?? null;
        return { p, groups, current };
    }).filter(it => it.current);                       // a subject with no posted times has nothing to move

    const base = items.map(it => it.current);
    const before = vacantTime(flat(base).concat(fixed), sc).hours;

    const movable = items.filter(it => it.groups.length > 1);
    if (!items.length) return { before: 0, after: 0, swaps: [], status: 'none-posted', reason: 'None of the selected subjects has a posted schedule yet.' };
    if (before <= EPS) return { before, after: before, swaps: [], status: 'no-gap', reason: 'Your plan has no vacant time between classes.' };
    if (!movable.length) return { before, after: before, swaps: [], status: 'one-section', reason: 'The subjects you picked each have only one section, so nothing can be swapped.' };

    // Every way to move up to maxSwaps different subjects to another of their sections.
    let best = null;
    const consider = (moves) => {
        const chosen = items.map(it => moves.find(m => m.it === it)?.group ?? it.current);
        if (planClashes(chosen, sc, fixed)) return;
        const after = vacantTime(flat(chosen).concat(fixed), sc).hours;
        if (after >= before - EPS) return;
        if (!best || after < best.after - EPS || (Math.abs(after - best.after) <= EPS && moves.length < best.moves.length)) best = { after, moves };
    };
    const options = movable.flatMap(it => it.groups.filter(g => g.section !== it.current.section).map(group => ({ it, group })));
    for (const o of options) consider([o]);
    if (maxSwaps >= 2) {
        for (let i = 0; i < options.length; i++) for (let j = i + 1; j < options.length; j++) {
            if (options[i].it !== options[j].it) consider([options[i], options[j]]);
        }
    }

    if (!best) return { before, after: before, swaps: [], status: 'no-help', reason: 'Moving a subject to another section would either overlap another class or not reduce the vacant time.' };
    const swaps = best.moves.map(m => ({
        subjectId: m.it.p.subjectId, code: m.it.p.code, from: m.it.current.section, to: m.group.section, meetings: m.group.meetings,
    }));
    return { before, after: best.after, swaps, status: 'found', reason: '' };
}

return { vacantTime, suggestSwaps };
}));
