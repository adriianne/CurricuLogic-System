// core.js -- what eligibility-chat decides about the facts it gives Cura, apart
// from the network. Pure: no Deno, no fetch, so it is tested in Node.
//
// WHY THIS EXISTS
// Cura answers from a "summary" of the student's standing: what they may take,
// what is locked and why, their sections, clashes and preferences. That summary
// used to arrive in the request body, built by the browser, so the chat took the
// student's word for the very facts it was supposed to narrate. The function now
// asks assess-student (the same engine, run on the server with the student's own
// token) and ignores any summary the client sends.
//
//   interpretAssessment(status, body)
//     status  the HTTP status assess-student answered with (0 if it could not be reached)
//     body    its JSON, or null
//   -> { ok: true, summary }  or  { ok: false, status, error }
//      where status/error are what eligibility-chat should answer the student with.

'use strict';

const NOT_READY = {
    record_not_verified:
        'Your academic record has not been verified yet, so Cura cannot discuss your subjects. Please ask the Registrar.',
    no_curriculum:
        'No curriculum has been set up for your programme yet, so Cura has nothing to discuss.',
    curriculum_not_started:
        'The curriculum for your programme has not started yet, so Cura has nothing to discuss. Please contact your department.',
};

const TRY_AGAIN = 'Could not load your record. Try again.';

function interpretAssessment(status, body) {
    if (status === 401) return { ok: false, status: 401, error: 'Not signed in.' };
    if (status === 403) return { ok: false, status: 403, error: 'This account is awaiting approval.' };
    if (status === 404) return { ok: false, status: 404, error: 'No student account is linked to this login.' };

    // Anything else that is not a clean 200 (assess-student down, a timeout, a
    // reply that is not JSON) is a temporary failure. The chat never falls back
    // to a summary the browser supplied.
    if (status !== 200 || body === null || typeof body !== 'object') {
        return { ok: false, status: 502, error: TRY_AGAIN };
    }

    if (body.assessed === false) {
        // For a curriculum that has not started, assess-student sends its own sentence naming the
        // year it takes effect; use it when it is there.
        const own = body.reason === 'curriculum_not_started' && typeof body.message === 'string' && body.message.trim()
            ? body.message.trim()
            : null;
        return {
            ok: false,
            status: 409,
            error: own ?? NOT_READY[body.reason] ?? 'Your record cannot be discussed yet. Please ask the Registrar.',
        };
    }

    if (body.assessed !== true || body.summary === null || typeof body.summary !== 'object' || Array.isArray(body.summary)) {
        return { ok: false, status: 502, error: TRY_AGAIN };
    }

    return { ok: true, summary: body.summary };
}

// WISHES
// A student can tell Cura what they want from a plan ("mornings only, no Friday, light load, keep MATH 101").
// Cura only WRITES the wish down as the fields below; it never picks subjects or sections. The model's
// answer is not trusted: cleanWishes() keeps only what is well formed, clamps units to the student's own
// limit, and accepts only subject codes that really are in this student's summary. Whatever it drops is
// returned in "ignored" with a plain reason, so nothing disappears silently.
//
//   cleanWishes(raw, summary)
//     raw      the "wishes" object the model returned (anything at all, including null)
//     summary  the server-built summary (recommended, leftOutForClash, unitLimit)
//   -> { wishes, ignored }
//      wishes   null when nothing usable was asked, else
//               { earliestStart: 'HH:MM'|null, latestEnd: 'HH:MM'|null, avoidDays: ['MON'..'SUN'],
//                 maxUnits: integer|null, keepSubjects: [exact codes from the summary] }
//      ignored  [{ field, value, why }]

const DAYS = {
    MON: 'MON', MONDAY: 'MON', TUE: 'TUE', TUES: 'TUE', TUESDAY: 'TUE',
    WED: 'WED', WEDNESDAY: 'WED', THU: 'THU', THUR: 'THU', THURS: 'THU', THURSDAY: 'THU',
    FRI: 'FRI', FRIDAY: 'FRI', SAT: 'SAT', SATURDAY: 'SAT', SUN: 'SUN', SUNDAY: 'SUN',
};

const MAX_KEEP = 12;

function cleanTime(value) {
    if (typeof value !== 'string') return null;
    const m = value.trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    return `${String(h).padStart(2, '0')}:${m[2]}`;
}

// "MATH 101", "math-101" and "MATH101" are the same subject.
const looseCode = (s) => String(s).toUpperCase().replace(/[^A-Z0-9]/g, '');

function cleanWishes(raw, summary) {
    const ignored = [];
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { wishes: null, ignored };

    let earliestStart = null;
    let latestEnd = null;
    if (raw.earliestStart != null) {
        earliestStart = cleanTime(raw.earliestStart);
        if (!earliestStart) ignored.push({ field: 'earliestStart', value: raw.earliestStart, why: 'That is not a time of day.' });
    }
    if (raw.latestEnd != null) {
        latestEnd = cleanTime(raw.latestEnd);
        if (!latestEnd) ignored.push({ field: 'latestEnd', value: raw.latestEnd, why: 'That is not a time of day.' });
    }
    if (earliestStart && latestEnd && earliestStart >= latestEnd) {
        ignored.push({ field: 'earliestStart', value: earliestStart, why: 'The earliest start is not before the latest end.' });
        ignored.push({ field: 'latestEnd', value: latestEnd, why: 'The earliest start is not before the latest end.' });
        earliestStart = null;
        latestEnd = null;
    }

    const avoidDays = [];
    for (const d of Array.isArray(raw.avoidDays) ? raw.avoidDays : []) {
        const day = typeof d === 'string' ? DAYS[d.trim().toUpperCase()] : undefined;
        if (!day) ignored.push({ field: 'avoidDays', value: d, why: 'That is not a day of the week.' });
        else if (!avoidDays.includes(day)) avoidDays.push(day);
    }

    // Avoiding every school day leaves no day to hold a class: that is not a wish a plan can follow.
    if (['MON', 'TUE', 'WED', 'THU', 'FRI'].every(d => avoidDays.includes(d))) {
        for (const d of avoidDays) ignored.push({ field: 'avoidDays', value: d, why: 'Avoiding every weekday leaves no day for classes.' });
        avoidDays.length = 0;
    }

    let maxUnits = null;
    if (raw.maxUnits != null) {
        const n = Number(raw.maxUnits);
        const limit = Number(summary?.unitLimit);
        if (!Number.isFinite(n) || n < 1) {
            ignored.push({ field: 'maxUnits', value: raw.maxUnits, why: 'That is not a number of units.' });
        } else {
            maxUnits = Math.floor(n);
            if (Number.isFinite(limit) && limit > 0 && maxUnits > limit) {
                ignored.push({ field: 'maxUnits', value: raw.maxUnits, why: `Your limit this term is ${limit} units, so ${limit} is used.` });
                maxUnits = limit;
            }
        }
    }

    // Only subjects this student can actually take (suggested, or eligible but left out for a clash).
    const known = new Map();
    for (const s of [...(summary?.recommended ?? []), ...(summary?.leftOutForClash ?? [])]) {
        if (s && typeof s.code === 'string') known.set(looseCode(s.code), s.code);
    }
    const keepSubjects = [];
    for (const c of Array.isArray(raw.keepSubjects) ? raw.keepSubjects : []) {
        const exact = typeof c === 'string' ? known.get(looseCode(c)) : undefined;
        if (!exact) ignored.push({ field: 'keepSubjects', value: c, why: 'That is not one of the subjects you can take this term.' });
        else if (!keepSubjects.includes(exact)) {
            if (keepSubjects.length >= MAX_KEEP) ignored.push({ field: 'keepSubjects', value: c, why: `At most ${MAX_KEEP} subjects can be kept.` });
            else keepSubjects.push(exact);
        }
    }

    const any = earliestStart || latestEnd || avoidDays.length || maxUnits !== null || keepSubjects.length;
    return {
        wishes: any ? { earliestStart, latestEnd, avoidDays, maxUnits, keepSubjects } : null,
        ignored,
    };
}

// USAGE LOG
// One row per request from a signed-in student, so speed, failures and cost can be watched (db/089_cura_usage.sql).
// It holds how the request ended, never what was said: no message, no reply, no summary.
//
//   usageRow({ userId, client, ms, httpStatus, busy, model, attempts, hadWishes })
//   -> the row to insert, or null when there is nobody to count (a signed-out caller never gets a row, so the
//      table cannot be filled from outside).

const MAX_LOGGED_MS = 10 * 60 * 1000;

function usageRow({ userId, client, ms, httpStatus, busy, model, attempts, hadWishes }) {
    if (typeof userId !== 'string' || userId === '') return null;

    const code = Number.isInteger(httpStatus) ? httpStatus : 500;
    const status = code === 200 ? 'ok'
        : busy === true ? 'busy'
        : code >= 500 ? 'error'
        : 'bad_request';

    const took = Number(ms);
    return {
        user_id: userId,
        client: client === 'web' || client === 'app' ? client : null,
        status,
        http_status: code,
        duration_ms: Number.isFinite(took) ? Math.min(MAX_LOGGED_MS, Math.max(0, Math.round(took))) : 0,
        model: typeof model === 'string' && model !== '' ? model.slice(0, 60) : null,
        attempts: Number.isInteger(attempts) && attempts >= 0 ? attempts : null,
        had_wishes: hadWishes === true,
    };
}

module.exports = { interpretAssessment, cleanWishes, usageRow, NOT_READY, TRY_AGAIN };
