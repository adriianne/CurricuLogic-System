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

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const revealables = document.querySelectorAll('.feat-card, .step, .elig, .reason');

    if (reduceMotion || !('IntersectionObserver' in window)) return;

    const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            entry.target.style.opacity = '1';
            entry.target.style.transform = 'none';
            observer.unobserve(entry.target);
        });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

    revealables.forEach((el, i) => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(14px)';
        el.style.transition = `opacity 0.5s ease ${i % 4 * 60}ms, transform 0.5s ease ${i % 4 * 60}ms`;
        observer.observe(el);
    });
});