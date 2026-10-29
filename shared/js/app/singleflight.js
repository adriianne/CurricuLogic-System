// singleflight.js
//
// "One at a time." Wraps an async action (an AI analysis, a file check) so that pressing its button again while it is still
// running does nothing, instead of starting a second copy. Pure and small, so the rule is tested (tests/singleflight.test.mjs).
//
//   const analyze = SingleFlight.guard(async (file) => { ... }, { onStart, onEnd });
//   analyze(file);    // runs
//   analyze(file);    // ignored while the first is running (returns undefined)
//
// onStart runs when a call is accepted, onEnd runs when it finishes by any route: it returns, it throws, or it is rejected.
// The guard is released in "finally", so a failure never leaves the button stuck.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.SingleFlight = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

function guard(action, { onStart, onEnd } = {}) {
    let running = false;
    let ignored = 0;

    async function guarded(...args) {
        if (running) { ignored++; return undefined; }
        running = true;
        try {
            if (onStart) onStart();
            return await action(...args);
        } finally {
            running = false;
            if (onEnd) onEnd();
        }
    }

    Object.defineProperty(guarded, 'busy', { get: () => running });
    Object.defineProperty(guarded, 'ignored', { get: () => ignored });
    return guarded;
}

return { guard };

}));
