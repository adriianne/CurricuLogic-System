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

    /* ---------- reveal on scroll ---------- */
    // Hero rows animate on load in CSS. Below-the-fold items fade up once,
    // staggered 60ms within their own group. No JS = everything stays visible.

    if (!('IntersectionObserver' in window)) return;

    const groups = [
        '.feat-grid .feat-card',
        '.steps .step',
        '.shot-stats .stat',
        '.shot-rows .shot-row',
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
