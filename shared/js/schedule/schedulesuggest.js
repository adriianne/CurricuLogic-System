// schedulesuggest.js
//
// Suggests days and times for the subjects of ONE section. Rules only: no AI,
// no network, no DOM. Same input, same answer, and every answer is checked by
// construction against the rules below.
//
// The patterns come from how the programme's sections are actually scheduled:
//   * a 3-unit lecture meets twice a week, 1.5 hours each, on MW or TTH;
//   * a laboratory meets once, 3 hours, on Friday or Saturday;
//   * classes run between 7:30 AM and 6:30 PM.
// A 2-unit lecture is two 1-hour meetings; a 1-unit lecture is one 1-hour meeting.
//
// What it will not do:
//   * touch a row that already has days or times (the caller passes only empty rows);
//   * overlap anything already placed in the section, or the lunch break (12:00-1:00);
//   * put more than the daily cap (6 hours) on any day;
//   * invent a room or an EDP code. Those stay for a person.
// A subject that finds no free slot is returned in `unplaced` with the reason, not forced in.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.CurriculogicScheduleSuggest = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const DEFAULTS = {
    dayStart: '07:30',
    dayEnd: '18:30',
    lunchStart: '12:00',
    lunchEnd: '13:00',
    maxHoursPerDay: 6,
    stepMinutes: 30,
};

const DAY_NAMES = { M: 'Monday', T: 'Tuesday', W: 'Wednesday', TH: 'Thursday', F: 'Friday', S: 'Saturday' };

/* What to write in the Days box for a set of day letters. */
const DAY_TEXT = (days) => days.join('');

const mins = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); };
const clock = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const overlaps = (a1, a2, b1, b2) => a1 < b2 && b1 < a2;

/* The meetings a row needs: one pattern list per meeting.
   patterns: day sets to choose from, in order of preference.
   length:   minutes per session. */
function needFor(subject, meetingType) {
    const units = Number(subject?.units) || 0;
    if (meetingType === 'LAB') return { patterns: [['F'], ['S']], length: 180 };
    if (units >= 3) return { patterns: [['M', 'W'], ['T', 'TH']], length: 90 };
    if (units === 2) return { patterns: [['M', 'W'], ['T', 'TH']], length: 60 };
    return { patterns: [['M'], ['T'], ['W'], ['TH'], ['F']], length: 60 };
}

/* rows:      the rows to place, each { key, subject_id, meeting_type }.
   fixed:     rows already timed in this section, each { schedule_days, start_time, end_time }.
   subjectOf: subject_id -> { units, lab_units }.
   sc:        the ScheduleConflicts helpers (parseDays, minutesOf).
   Returns { placements: [{ key, days, start, end }], unplaced: [{ key, reason }] }. */
function plan({ rows, fixed, subjectOf, sc, options }) {
    const o = { ...DEFAULTS, ...(options || {}) };
    const dayStart = mins(o.dayStart), dayEnd = mins(o.dayEnd);
    const lunchStart = mins(o.lunchStart), lunchEnd = mins(o.lunchEnd);
    const cap = o.maxHoursPerDay * 60;

    // What each day already holds: [start, end] pairs, in minutes.
    const busy = new Map(Object.keys(DAY_NAMES).map(d => [d, []]));
    for (const f of fixed ?? []) {
        const a = sc.minutesOf(f.start_time), b = sc.minutesOf(f.end_time);
        if (a === null || b === null) continue;
        for (const d of sc.parseDays(f.schedule_days)) busy.get(d)?.push([a, b]);
    }

    const load = (day) => busy.get(day).reduce((t, [a, b]) => t + (b - a), 0);
    const loadOf = (days) => days.reduce((t, d) => t + load(d), 0);

    const fits = (days, start, length) => {
        const end = start + length;
        if (start < dayStart || end > dayEnd) return false;
        if (overlaps(start, end, lunchStart, lunchEnd)) return false;
        return days.every(d =>
            load(d) + length <= cap &&
            !busy.get(d).some(([a, b]) => overlaps(start, end, a, b)));
    };

    const placements = [];
    const unplaced = [];

    // Laboratories first: they are the longest and have the fewest days to go on.
    const ordered = [...rows].sort((a, b) =>
        (b.meeting_type === 'LAB') - (a.meeting_type === 'LAB'));

    for (const row of ordered) {
        const need = needFor(subjectOf(row.subject_id), row.meeting_type);

        // The lighter pattern first, so the section's days stay balanced.
        const patterns = need.patterns
            .map((days, i) => ({ days, i, w: loadOf(days) }))
            .sort((p, q) => p.w - q.w || p.i - q.i);

        let done = null;
        for (const { days } of patterns) {
            for (let s = dayStart; s + need.length <= dayEnd; s += o.stepMinutes) {
                if (fits(days, s, need.length)) { done = { days, start: s }; break; }
            }
            if (done) break;
        }

        if (!done) {
            unplaced.push({ key: row.key, reason: 'No free time is left for it that avoids the other classes, lunch and the daily limit.' });
            continue;
        }

        for (const d of done.days) busy.get(d).push([done.start, done.start + need.length]);
        placements.push({
            key: row.key,
            days: DAY_TEXT(done.days),
            start: clock(done.start),
            end: clock(done.start + need.length),
        });
    }

    return { placements, unplaced };
}

return { plan, needFor, DEFAULTS };

}));
