// gridglow.js — makes the green grid spotlight follow the mouse.
//
// Put data-grid-glow on the element that owns the ::after spotlight. Optional:
// data-grid-glow-rest=".some-selector" names areas (like a login card) where the
// glow stops following and drifts on its own while the pointer is over them. While a
// fine pointer is over it, this sets --gx / --gy (px, relative to the element)
// and adds .glow-follow, which swaps the CSS drift animation for those
// coordinates. When the pointer leaves, or on touch screens, the page goes
// back to the slow drift. Pure decoration: nothing here is needed to use the page.

(function () {
    'use strict';

    const hosts = document.querySelectorAll('[data-grid-glow]');
    if (!hosts.length) return;

    // Touch screens have no cursor to follow
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const EASE = reduced ? 1 : 0.14;

    hosts.forEach((host) => {
        let tx = 0, ty = 0;       // where the pointer is
        let x = 0, y = 0;         // where the glow is, easing toward it
        let raf = 0;

        const paint = () => {
            x += (tx - x) * EASE;
            y += (ty - y) * EASE;
            host.style.setProperty('--gx', x.toFixed(1) + 'px');
            host.style.setProperty('--gy', y.toFixed(1) + 'px');
            raf = (Math.abs(tx - x) > 0.5 || Math.abs(ty - y) > 0.5)
                ? requestAnimationFrame(paint)
                : 0;
        };

        const restSel = host.dataset.gridGlowRest;

        const aim = (e) => {
            // Over a resting area: let the CSS drift take over until the pointer leaves it
            if (restSel && e.target.closest && e.target.closest(restSel)) {
                if (host.classList.contains('glow-follow')) release();
                return;
            }

            const r = host.getBoundingClientRect();
            tx = e.clientX - r.left;
            ty = e.clientY - r.top;

            if (!host.classList.contains('glow-follow')) {
                // Start from the cursor so the glow does not fly in from a corner
                x = tx;
                y = ty;
                host.classList.add('glow-follow');
            }
            if (!raf) raf = requestAnimationFrame(paint);
        };

        const release = () => {
            host.classList.remove('glow-follow');
            cancelAnimationFrame(raf);
            raf = 0;
        };

        host.addEventListener('pointermove', aim, { passive: true });
        host.addEventListener('pointerleave', release);
        document.addEventListener('visibilitychange', () => { if (document.hidden) release(); });
    });
})();
