// idlesignout.js
//
// Signs a person out of a dashboard they have left open.
//
// Before this, a signed-in dashboard stayed signed in for as long as the
// browser kept the session, so an unattended screen in a registrar's office (or
// a shared computer) stayed open to whoever walked up. After a period with no
// mouse, keyboard, scroll or touch activity the person gets a 60-second warning,
// then is signed out through the dashboard's own Log out button.
//
// Switched on by two attributes on a dashboard's <body>:
//     <body data-idle-role="registrar_staff">            (limits below)
//     <body data-idle-role="..." data-idle-minutes="10">  (optional override)
// It does nothing in the localhost "?preview" mode.
//
// This is a browser-side convenience. A stolen session token is not stopped by
// it; ending sessions on the server (Supabase Auth "inactivity timeout" and
// "time-box user sessions") needs a paid Supabase plan. See
// docs/SECURITY-OPERATIONS.md.
//
// Several tabs of the same role share one clock (localStorage), so working in
// one tab keeps the others signed in.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else {
        root.CurriculogicIdle = factory();
        const doc = root.document;
        if (doc) {
            const run = () => root.CurriculogicIdle.autoStart(doc, root);
            if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', run);
            else run();
        }
    }
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const MINUTE = 60 * 1000;

/* Minutes without activity before sign-out, by role. */
const LIMIT_MINUTES = {
    system_administrator: 15,
    registrar_staff:      30,
    department_staff:     30,
    faculty_staff:        30,
    university_student:   60,
};
const DEFAULT_MINUTES = 30;
const WARN_MS = 60 * 1000;
const WRITE_THROTTLE_MS = 5 * 1000;
const EVENTS = ['mousemove', 'mousedown', 'keydown', 'scroll', 'wheel', 'touchstart', 'click'];

/* The limit in milliseconds: an explicit number of minutes wins, else the role's. */
function limitMs(roleKey, minutesOverride) {
    const m = Number(minutesOverride);
    if (Number.isFinite(m) && m > 0) return m * MINUTE;
    return (LIMIT_MINUTES[roleKey] ?? DEFAULT_MINUTES) * MINUTE;
}

/* Where an idle period stands: active, in the warning window, or expired. */
function stateAt(now, lastActive, limit, warn = WARN_MS) {
    const idle = Math.max(0, now - lastActive);
    if (idle >= limit) return { state: 'expired', msLeft: 0 };
    if (idle >= limit - warn) return { state: 'warn', msLeft: limit - idle };
    return { state: 'active', msLeft: limit - idle };
}

/* The on-screen warning. Plain text only (textContent), no HTML. */
function bannerUi(doc) {
    let el = null;
    let text = null;
    const build = () => {
        el = doc.createElement('div');
        el.setAttribute('role', 'alertdialog');
        el.setAttribute('aria-live', 'assertive');
        el.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:99999;' +
            'background:#1f2937;color:#fff;padding:14px 18px;border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.35);' +
            'font:14px/1.4 system-ui,sans-serif;display:flex;gap:14px;align-items:center;max-width:90vw';
        text = doc.createElement('span');
        const btn = doc.createElement('button');
        btn.type = 'button';
        btn.textContent = 'Stay signed in';
        btn.style.cssText = 'background:#fff;color:#1f2937;border:0;border-radius:6px;padding:6px 12px;font:inherit;cursor:pointer';
        btn.addEventListener('click', () => { /* the click itself counts as activity */ });
        el.appendChild(text);
        el.appendChild(btn);
        doc.body.appendChild(el);
    };
    return {
        show(msLeft) {
            if (!el) build();
            text.textContent = `You will be signed out in ${Math.max(0, Math.ceil(msLeft / 1000))} seconds because of inactivity.`;
        },
        hide() { if (el) { el.remove(); el = null; text = null; } },
    };
}

/* Starts the watch. Returns { tick, touch, stop } (tick and touch are exposed
   for tests; the page never needs them). */
function start(options = {}) {
    const win   = options.win ?? (typeof window !== 'undefined' ? window : null);
    const doc   = options.doc ?? win?.document;
    const store = options.store ?? (() => { try { return win?.localStorage; } catch { return null; } })();
    const now   = options.now ?? Date.now;
    const limit = options.limitMs ?? limitMs(options.role, options.minutes);
    const warn  = Math.min(options.warnMs ?? WARN_MS, Math.floor(limit / 2));
    const tickMs = options.tickMs ?? 5000;
    const key   = 'cl-last-active-' + (options.role || 'user');
    const ui    = options.ui ?? (doc ? bannerUi(doc) : { show() {}, hide() {} });
    const onExpire = options.onExpire ?? (() => {
        const button = doc?.getElementById('logout');
        if (button) button.click();
        else if (win) win.location.href = '/';
    });

    let last = now();
    let lastWrite = 0;
    let warning = false;
    let stopped = false;
    let timer = null;

    const write = (t) => { try { store?.setItem(key, String(t)); } catch { /* storage blocked */ } lastWrite = t; };
    const stored = () => { try { const v = Number(store?.getItem(key)); return Number.isFinite(v) ? v : 0; } catch { return 0; } };
    const latest = () => Math.max(last, stored());

    function touch() {
        if (stopped) return;
        const t = now();
        last = t;
        // While the warning is up, answer at once; otherwise write at most every few seconds.
        if (warning || t - lastWrite >= WRITE_THROTTLE_MS) write(t);
        if (warning) { warning = false; ui.hide(); }
    }

    function tick() {
        if (stopped) return;
        const s = stateAt(now(), latest(), limit, warn);
        if (s.state === 'expired') {
            stop();
            onExpire();
        } else if (s.state === 'warn') {
            warning = true;
            ui.show(s.msLeft);
        } else if (warning) {
            warning = false;               // another tab was used: warning is over
            ui.hide();
        }
    }

    function stop() {
        stopped = true;
        if (timer) clearInterval(timer);
        if (doc) {
            for (const e of EVENTS) doc.removeEventListener(e, touch, true);
            doc.removeEventListener('visibilitychange', tick);
        }
        ui.hide();
    }

    write(last);
    if (doc) {
        for (const e of EVENTS) doc.addEventListener(e, touch, { capture: true, passive: true });
        doc.addEventListener('visibilitychange', tick);   // a laptop that slept past the limit signs out on waking
    }
    timer = setInterval(tick, tickMs);
    if (timer && typeof timer.unref === 'function') timer.unref();   // never keeps a Node process alive (tests)

    return { tick, touch, stop };
}

/* Reads <body data-idle-role / data-idle-minutes> and starts. */
function autoStart(doc, win) {
    const body = doc?.body;
    const role = body?.dataset?.idleRole;
    if (!role) return null;
    const local = ['localhost', '127.0.0.1', ''].includes(win?.location?.hostname);
    if (local && new URLSearchParams(win.location.search).has('preview')) return null;
    if (win.__curriculogicIdle) win.__curriculogicIdle.stop();
    win.__curriculogicIdle = start({ win, doc, role, minutes: body.dataset.idleMinutes });
    return win.__curriculogicIdle;
}

return { LIMIT_MINUTES, WARN_MS, limitMs, stateAt, start, autoStart };
}));
