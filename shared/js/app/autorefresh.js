// autorefresh.js
//
// Keeps a screen current without the person reloading it. Every minute (and the moment they come back to the tab) it asks a
// cheap question, "has anything changed?", and only when the answer differs from last time does it redraw. So a screen is
// never redrawn for nothing, and one that someone is typing into is left alone until they are done.
//
//   const r = AutoRefresh.create({ probe, onChange, isBusy, isHidden });
//   await r.tick();                       // one check
//   const stop = AutoRefresh.start({ every: 60000, probe, onChange, isBusy });
//
// probe()    -> a text that changes when the data changes, or null when it could not ask (offline, signed out)
// onChange() -> redraw; runs only when the text differs from the last one
// isBusy()   -> true while a dialog is open or a field is being typed in: the redraw waits for the next check
// isHidden() -> true while the tab is not showing (default: document.hidden): nothing is asked
//
// Pure apart from start(), which adds the timer and the tab-visible listener. Tested in tests/autorefresh.test.mjs.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.AutoRefresh = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const EVERY_MS = 60 * 1000;

function create({ probe, onChange, isBusy, isHidden } = {}) {
    let last = null;       // what the screen shows now
    let running = false;   // one check at a time
    const hidden = isHidden ?? (() => typeof document !== 'undefined' && document.hidden === true);

    async function tick() {
        if (typeof probe !== 'function' || running || hidden()) return 'skipped';
        running = true;
        try {
            const now = await probe();
            if (now == null) return 'unavailable';                 // could not ask: keep what is shown
            if (last === null) { last = now; return 'baseline'; }  // first answer: this is what the screen already shows
            if (now === last) return 'same';
            if (typeof isBusy === 'function' && isBusy()) return 'waiting';   // changed, but not while someone is in the middle of something
            await onChange?.(now);
            last = now;
            return 'changed';
        } catch (_) {
            return 'error';                                        // a failed check must never break the screen
        } finally {
            running = false;
        }
    }

    return { tick, reset: () => { last = null; } };
}

function start(options = {}) {
    const r = create(options);
    const every = Number(options.every) > 0 ? Number(options.every) : EVERY_MS;
    r.tick();                                                      // sets the baseline straight away
    const timer = setInterval(r.tick, every);
    const onVisible = () => { if (typeof document !== 'undefined' && !document.hidden) r.tick(); };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
    return function stop() {
        clearInterval(timer);
        if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
    };
}

return { create, start, EVERY_MS };
}));
