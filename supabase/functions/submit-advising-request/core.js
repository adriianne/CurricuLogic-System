// core.js -- what submit-advising-request decides, apart from the database.
//
// Pure: no network, no Deno. Two decisions live here:
//   1. which subjects already have a request awaiting a decision (so a second
//      submission cannot duplicate them), and
//   2. whether each chosen subject is really open to this student.
//
// The second uses the SAME engine the website and assess-student use
// (shared/engine/engine.js), so a subject the student sees as open is never
// flagged here, and one that is locked never slips through. No client-supplied
// status is trusted.

'use strict';

/* The subjects that are locked by an earlier request. Only the most recent
   request per subject counts, and a subject stays resubmittable when the whole
   plan was sent back by the Registrar or Faculty rejected that item.
   Mirrors computeSubjectLocks() on the website.
   requests: newest first, each { registrar_status, request_item: [{subject_id, status}] } */
function lockedSubjectIds(requests) {
    const latest = new Map();
    for (const req of requests ?? []) {
        for (const item of req.request_item ?? []) {
            if (!latest.has(item.subject_id)) latest.set(item.subject_id, { req, item });
        }
    }
    const locked = new Set();
    for (const [subjectId, { req, item }] of latest) {
        const sentBack = req.registrar_status === 'rejected';
        const rejected = item.status === 'rejected';
        if (!sentBack && !rejected) locked.add(subjectId);
    }
    return locked;
}

/* How often one student may send a plan. Subjects already awaiting a decision
   are refused separately (lockedSubjectIds); this stops someone from sending
   request after request to flood their adviser's queue.
   requests: the student's requests, any order, each { created_at }.
   Returns { ok: true } or { ok: false, error, retryAfterSeconds }. */
const MAX_PER_DAY = 5;
const MIN_GAP_SECONDS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

function submissionLimit(requests, now = Date.now()) {
    const times = (requests ?? [])
        .map(r => new Date(r.created_at).getTime())
        .filter(t => Number.isFinite(t) && t <= now)
        .sort((a, b) => b - a);

    const sinceLast = times.length ? Math.ceil((now - times[0]) / 1000) : Infinity;
    if (sinceLast < MIN_GAP_SECONDS) {
        const wait = MIN_GAP_SECONDS - sinceLast;
        return { ok: false, retryAfterSeconds: wait,
                 error: `Please wait ${wait} second${wait === 1 ? '' : 's'} before sending another request.` };
    }

    const recent = times.filter(t => now - t < DAY_MS);
    if (recent.length >= MAX_PER_DAY) {
        const oldest = recent[MAX_PER_DAY - 1];
        const wait = Math.ceil((oldest + DAY_MS - now) / 1000);
        const hours = Math.ceil(wait / 3600);
        return { ok: false, retryAfterSeconds: wait,
                 error: `You have already sent ${MAX_PER_DAY} requests in the last 24 hours. Try again in about ${hours} hour${hours === 1 ? '' : 's'}, or talk to your adviser.` };
    }
    return { ok: true };
}

/* deps:  { engine }
   input: { student, program, records, subjects, rules, offerings, term, selections }
   selections: [{ subjectId, offeringId }]
   returns [{ subjectId, offeringId, valid, reason }] in the order given. */
function evaluateSelections(deps, input) {
    const { engine } = deps;
    const { student, program, records, subjects, rules, offerings, term, selections } = input;

    const result = engine.assess(
        { id: student.id, year_level: student.year_level },
        records,
        { subjects, rules, offerings },
        {
            maxUnits: program?.max_units ?? 24,
            maxUnitsGraduating: program?.max_units_graduating ?? 27,
            term,
            respectOfferings: offerings.length > 0,
        },
    );

    const open = new Map(result.eligible.map(e => [e.subject.id, e]));
    const locked = new Map(result.locked.map(l => [l.subject.id, l]));
    const passed = new Set(result.completed.map(s => s.id));
    const taking = new Set(result.inProgress.map(s => s.id));

    // offering id -> subject id, to check a chosen section belongs to its subject.
    const offeringSubject = new Map(offerings.map(o => [o.id, o.subject_id]));

    return selections.map(sel => {
        const base = { subjectId: sel.subjectId, offeringId: sel.offeringId ?? null };
        const no = (reason) => ({ ...base, valid: false, reason });

        if (passed.has(sel.subjectId)) return no('This subject is already passed.');
        if (taking.has(sel.subjectId)) return no('This subject is already in progress.');

        if (locked.has(sel.subjectId)) {
            const unmet = (locked.get(sel.subjectId).unmet ?? []).map(u => u.detail).join(' ');
            return no(unmet || 'Requirements for this subject are not met.');
        }
        if (!open.has(sel.subjectId)) return no('Subject not found in the current curriculum.');

        // Eligible is not enough: it must be something that can be enrolled in this semester.
        const entry = open.get(sel.subjectId);
        if (entry.availableThisTerm === false) {
            const why = entry.scheduleState === 'not-run'
                ? 'The department is not running this subject this term.'
                : entry.subject.year_level == null
                    ? 'No section is open for this elective this term.'
                    : 'This subject belongs to another semester and has no section this term.';
            return { ...no(why), unavailable: true };
        }

        if (base.offeringId != null && offeringSubject.get(base.offeringId) !== sel.subjectId) {
            return no('The chosen section is not offered for this subject this term.');
        }
        return { ...base, valid: true, reason: null };
    });
}

module.exports = { lockedSubjectIds, evaluateSelections, submissionLimit, MAX_PER_DAY, MIN_GAP_SECONDS };
