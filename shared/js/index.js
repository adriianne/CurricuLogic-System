// index.js — landing page

document.addEventListener('DOMContentLoaded', () => {

    /* ---------- mobile nav ---------- */

    const header = document.querySelector('.site-header');
    const navToggle = document.getElementById('nav-toggle');

    if (header && navToggle) {
        navToggle.addEventListener('click', () => {
            const open = header.classList.toggle('nav-open');
            navToggle.classList.toggle('open', open);
            navToggle.setAttribute('aria-expanded', String(open));
        });

        document.querySelectorAll('.main-nav a, .header-actions a').forEach((link) => {
            link.addEventListener('click', () => {
                header.classList.remove('nav-open');
                navToggle.classList.remove('open');
                navToggle.setAttribute('aria-expanded', 'false');
            });
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && header.classList.contains('nav-open')) {
                header.classList.remove('nav-open');
                navToggle.classList.remove('open');
                navToggle.setAttribute('aria-expanded', 'false');
            }
        });
    }

    /* ---------- how it works: each step shows its real screen ---------- */

    const steps = Array.from(document.querySelectorAll('.steps .step'));
    const shots = Array.from(document.querySelectorAll('.shot-img'));
    const phones = Array.from(document.querySelectorAll('.phone-img'));
    const caption = document.getElementById('shot-caption');
    const visual = document.querySelector('.how-visual');
    const deviceBtns = Array.from(document.querySelectorAll('.device-btn'));

    if (steps.length && steps.length === shots.length) {
        let current = 0;
        let timer = null;
        let userTookOver = false;

        const show = (i) => {
            current = i;
            steps.forEach((s, n) => {
                s.classList.toggle('is-active', n === i);
                s.querySelector('.step-num').setAttribute('aria-pressed', String(n === i));
            });
            shots.forEach((img, n) => img.classList.toggle('is-active', n === i));
            phones.forEach((img, n) => img.classList.toggle('is-active', n === i));
            const appMode = visual && visual.dataset.device === 'app';
            const label = appMode && phones[i] ? phones[i] : shots[i];
            if (caption) caption.textContent = label.dataset.caption || '';
        };

        deviceBtns.forEach((btn) => {
            btn.addEventListener('click', () => {
                visual.dataset.device = btn.dataset.device;
                deviceBtns.forEach((b) => {
                    b.classList.toggle('is-active', b === btn);
                    b.setAttribute('aria-pressed', String(b === btn));
                });
                userTookOver = true;
                stop();
                show(current);
            });
        });

        const stop = () => { clearInterval(timer); timer = null; };

        // Auto-advance every 3s while the section is on screen. It pauses while the
        // pointer is over it (3s is quick to read in), stops for good once the visitor
        // clicks, and never runs with reduced motion.
        const autoplay = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const STEP_MS = 3000;
        let inView = false;
        let hovering = false;

        const sync = () => {
            const shouldRun = autoplay && inView && !hovering && !userTookOver;
            if (shouldRun && !timer) {
                timer = setInterval(() => show((current + 1) % steps.length), STEP_MS);
            } else if (!shouldRun) {
                stop();
            }
        };

        steps.forEach((step, i) => {
            step.addEventListener('click', () => { userTookOver = true; stop(); show(i); });
        });

        const how = document.getElementById('how-it-works');
        const inner = how && how.querySelector('.how-inner');

        if (inner) {
            inner.addEventListener('pointerenter', (e) => {
                if (e.pointerType === 'mouse') { hovering = true; sync(); }
            });
            inner.addEventListener('pointerleave', () => { hovering = false; sync(); });
        }

        if (how && autoplay && 'IntersectionObserver' in window) {
            new IntersectionObserver(([entry]) => {
                inView = entry.isIntersecting;
                sync();
            }, { threshold: 0.4 }).observe(how);
        }
    }

    /* ---------- reveal on scroll ---------- */
    // Hero rows animate on load in CSS. Below-the-fold items fade up once,
    // staggered 60ms within their own group. No JS = everything stays visible.

    if (!('IntersectionObserver' in window)) return;

    const groups = [
        '.feat-grid .feat-card',
        '.steps .step',
    ];

    document.documentElement.classList.add('js');

    const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            const el = entry.target;
            el.classList.add('is-in');
            observer.unobserve(el);

            // Once faded in, hand the element back to its own hover/press transitions
            el.addEventListener('transitionend', (e) => {
                if (e.propertyName !== 'opacity') return;
                el.classList.remove('reveal', 'is-in');
                el.style.removeProperty('--reveal-delay');
            }, { once: false });
        });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

    groups.forEach((selector) => {
        document.querySelectorAll(selector).forEach((el, i) => {
            el.classList.add('reveal');
            el.style.setProperty('--reveal-delay', `${i * 60}ms`);
            observer.observe(el);
        });
    });
});
