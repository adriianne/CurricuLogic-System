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

module.exports = { interpretAssessment, NOT_READY, TRY_AGAIN };
