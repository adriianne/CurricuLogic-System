// motion.js
//
// Small motion helpers for the dashboards. The arithmetic is separate from the
// browser so it can be tested; countUp() is the only part that touches the page.
//
//   CurriculogicMotion.countUp(element, 27)   // 0 -> 27 over about 0.6 s
//
// Nothing moves for a person who asked for reduced motion: the number is simply
// set. A number that is already shown is not counted up again from zero.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.CurriculogicMotion = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

/* Starts quickly and settles gently. t and the result are both 0..1. */
const easeOutCubic = (t) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

/* The whole number to show `elapsed` ms into a count from `from` to `to`. */
function valueAt(from, to, elapsed, duration) {
    if (!(duration > 0)) return to;
    return Math.round(from + (to - from) * easeOutCubic(elapsed / duration));
}

const prefersReducedMotion = () =>
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/* Count `el`'s text up to `to`. A running count on the same element is replaced. */
function countUp(el, to, { duration = 600 } = {}) {
    if (!el) return;
    const target = Math.round(Number(to));
    if (!Number.isFinite(target)) { el.textContent = String(to); return; }

    if (el._countFrame) cancelAnimationFrame(el._countFrame);

    const shown = Number(el.textContent);
    const from = Number.isFinite(shown) && el.textContent.trim() !== '' ? shown : 0;

    if (prefersReducedMotion() || from === target || typeof requestAnimationFrame !== 'function') {
        el.textContent = String(target);
        return;
    }

    const started = performance.now();
    const step = (now) => {
        const elapsed = now - started;
        el.textContent = String(valueAt(from, target, elapsed, duration));
        el._countFrame = elapsed < duration ? requestAnimationFrame(step) : 0;
    };
    el._countFrame = requestAnimationFrame(step);
}

return { easeOutCubic, valueAt, countUp };

}));
