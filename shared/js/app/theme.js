// theme.js
//
// Light and dark mode for the dashboards.
//
//   - The choice is remembered in this browser (localStorage).
//   - Until a choice is made, the system setting decides.
//   - The page gets <html data-theme="light"> or <html data-theme="dark">; the
//     colours are in shared/css/dashboard-paper.css.
//   - A button with id="theme-toggle" switches it.
//
// The one-line snippet in each page's <head> applies the theme before the page
// is drawn, so a dark-mode user never sees a white flash. This file does the
// rest (the button, and following the system while no choice is made).
// The decision itself is a pure function so it can be tested.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory({});
    else root.CurriculogicTheme = factory(root);
}(typeof self !== 'undefined' ? self : this, function (root) {
'use strict';

const KEY = 'curriculogic-theme';

/* 'light' or 'dark', from what was stored and what the system prefers. */
function resolve(stored, systemDark) {
    if (stored === 'light' || stored === 'dark') return stored;
    return systemDark ? 'dark' : 'light';
}

const other = (theme) => (theme === 'dark' ? 'light' : 'dark');

/* ---- the page ---- */

function read() {
    try { return root.localStorage.getItem(KEY); } catch (e) { return null; }
}
function write(theme) {
    try { root.localStorage.setItem(KEY, theme); } catch (e) { /* private window: the choice lasts for this page only */ }
}
const systemDark = () => !!(root.matchMedia && root.matchMedia('(prefers-color-scheme: dark)').matches);
const current = () => root.document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';

function apply(theme) {
    root.document.documentElement.dataset.theme = theme;
    const btn = root.document.getElementById('theme-toggle');
    if (btn) {
        const toDark = theme === 'light';
        btn.setAttribute('aria-label', toDark ? 'Switch to dark mode' : 'Switch to light mode');
        btn.setAttribute('title', toDark ? 'Dark mode' : 'Light mode');
        btn.setAttribute('aria-pressed', String(theme === 'dark'));
        const icon = btn.querySelector('i');
        if (icon) icon.className = toDark ? 'fa-solid fa-moon' : 'fa-solid fa-sun';
    }
}

function init() {
    apply(resolve(read(), systemDark()));

    const btn = root.document.getElementById('theme-toggle');
    if (btn) {
        btn.addEventListener('click', () => {
            const next = other(current());
            write(next);
            apply(next);
        });
    }

    // Until a choice is made, follow the system if it changes.
    if (root.matchMedia) {
        const mq = root.matchMedia('(prefers-color-scheme: dark)');
        const follow = () => { if (!read()) apply(resolve(null, mq.matches)); };
        if (mq.addEventListener) mq.addEventListener('change', follow);
    }
}

if (root.document) {
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', init);
    else init();
}

return { KEY, resolve, other };

}));
