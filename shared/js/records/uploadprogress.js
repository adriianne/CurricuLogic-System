// uploadprogress.js
//
// A percentage that measures real work. Pure functions only, so the arithmetic
// is testable without a browser.
//
// The curriculum upload's bar is a time-based estimate: it waits on one AI call
// that gives no signal until it ends, so it can only guess. A grade upload is
// different: it has countable steps (rows checked, batches saved), so its
// percentage is the share of the work that is actually done.
//
//   const t = UploadProgress.tracker([
//       { id: 'read',  weight: 5,  label: 'Reading the file' },
//       { id: 'rows',  weight: 35, label: 'Checking rows' },
//   ]);
//   t.update('rows', 12 / 40, '12 of 40');   // { percent, label, detail }
//   t.finish();                                // { percent: 100, ... }
//
// A phase's weight is how much of the whole it is worth; `fraction` is how far
// through that phase the work is (0 to 1). The percentage never goes backwards,
// and it is held at 99 until finish() so "100%" always means done.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.UploadProgress = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const clamp01 = (n) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

/* done / total as a 0-1 fraction; an empty job counts as complete. */
const fraction = (done, total) => (total > 0 ? clamp01(done / total) : 1);

function tracker(phases) {
    const list = (phases ?? []).map(p => ({ ...p, weight: Number(p.weight) > 0 ? Number(p.weight) : 0 }));
    const total = list.reduce((sum, p) => sum + p.weight, 0);

    // Where each phase starts, in weight.
    const start = new Map();
    let run = 0;
    for (const p of list) { start.set(p.id, run); run += p.weight; }

    let best = 0;

    return {
        update(id, frac = 0, detail = '') {
            const phase = list.find(p => p.id === id);
            if (!phase) throw new Error(`Unknown progress phase: ${id}`);
            const raw = total > 0 ? ((start.get(id) + phase.weight * clamp01(frac)) / total) * 100 : 0;
            best = Math.max(best, Math.min(99, Math.floor(raw)));
            return { percent: best, label: phase.label, detail };
        },
        finish(detail = '') {
            best = 100;
            return { percent: 100, label: 'Done', detail };
        },
        get percent() { return best; },
    };
}

return { tracker, fraction };

}));
