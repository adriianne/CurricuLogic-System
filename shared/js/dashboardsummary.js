// dashboardsummary.js
//
// The status sentence under a dashboard's title and its "Needs attention" list, the same on the Registrar and
// Faculty dashboards. Nothing here knows what is being counted: a page builds a list of items from numbers it
// already has, and this turns them into one honest sentence and a short list. Pure functions except render().
//
//   DashboardSummary.sentence(['3 requests waiting', 'the oldest has waited 5 days'], 'Nothing is waiting.')
//     -> "3 requests waiting · the oldest has waited 5 days."
//
//   DashboardSummary.render(container, items, escapeHtml)
//     items: [{ level: 'full' | 'near' | 'info', title, detail, go: '#requests', label: 'Review' }]
//
// A list that did not change is left as it is, so redrawing the page does not replay its entrance.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.DashboardSummary = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const ICON = { full: 'fa-triangle-exclamation', near: 'fa-circle-exclamation', info: 'fa-circle-info', ok: 'fa-circle-check' };
const LEVELS = ['full', 'near', 'info'];

/* "3 requests waiting · the oldest has waited 5 days." The first word is capitalised; nothing to say gives the fallback. */
function sentence(parts, fallback) {
    const said = (parts ?? []).filter(Boolean);
    if (!said.length) return fallback;
    return said.join(' · ').replace(/^./, c => c.toUpperCase()) + '.';
}

/* "1 request", "3 requests". */
const count = (n, one, many) => `${n} ${n === 1 ? one : many ?? one + 's'}`;

/* Whole days from an ISO time until now (0 for today, or when the time cannot be read). */
function ageDays(iso, now = Date.now()) {
    if (!iso) return 0;
    const t = new Date(iso).getTime();
    return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / 86400000)) : 0;
}

/* The urgent ones first (red, then amber, then information), keeping the page's own order within a colour. */
function ordered(items) {
    const rank = (i) => { const r = LEVELS.indexOf(i.level); return r < 0 ? LEVELS.length : r; };
    return (items ?? []).map((item, n) => ({ item, n }))
        .sort((a, b) => rank(a.item) - rank(b.item) || a.n - b.n)
        .map(x => x.item);
}

/* The list as HTML. `esc` escapes text for HTML; every piece of text goes through it. */
function itemsHtml(items, esc, { max = 5, okText = 'Nothing needs your attention right now.' } = {}) {
    const list = ordered(items);
    if (!list.length) {
        return `<li class="attention-item level-ok"><i class="fa-solid ${ICON.ok}" aria-hidden="true"></i>`
            + `<div class="grow">${esc(okText)}</div></li>`;
    }
    const shown = list.slice(0, max);
    const more = list.length - shown.length;
    return shown.map((i, n) => {
        const level = LEVELS.includes(i.level) ? i.level : 'info';
        return `
        <li class="attention-item level-${esc(level)}" style="--i:${n}">
            <i class="fa-solid ${ICON[level]}" aria-hidden="true"></i>
            <div class="grow"><strong>${esc(i.title)}</strong> <span class="dim">${esc(i.detail ?? '')}</span></div>
            ${i.go ? `<button type="button" class="btn-small" data-attn-go="${esc(i.go)}">${esc(i.label ?? 'Open')}</button>` : ''}
        </li>`;
    }).join('') + (more > 0 ? `<li class="dim">and ${more} more.</li>` : '');
}

/* Draw the list into `container` (a <ul>). The same list again is left alone. */
function render(container, items, esc, options) {
    if (!container) return;
    const html = itemsHtml(items, esc, options);
    if (container.dataset.sig === html) return;
    container.dataset.sig = html;
    container.innerHTML = html;
    container.querySelectorAll('[data-attn-go]').forEach(btn =>
        btn.addEventListener('click', () => { window.location.hash = btn.dataset.attnGo; }));
}

return { sentence, count, ageDays, ordered, itemsHtml, render };

}));
