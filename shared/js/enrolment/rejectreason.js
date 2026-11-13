// rejectreason.js
//
// The reason a faculty adviser gives when rejecting a subject (or a whole plan). It is required, because the student
// sees it next to the subject and has to know what to fix. Quick picks write a sentence to start from; the adviser
// adds the specifics (which subject, which section) before sending.
//
// Pure functions (REASONS, starter, validate, merge) are tested in Node. ask() draws the dialog and returns a promise
// of the reason, or null if the adviser cancels. It touches no database.
//
//   const reason = await CurriculogicRejectReason.ask({ title: 'Reject this subject', subtitle: 'MATH 101 ...', confirm: 'Reject subject' });

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.CurriculogicRejectReason = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

/* The database refuses a longer reason (db/050). */
const MAX = 500;

const REASONS = [
    { key: 'prereq', label: 'Prerequisite not met', text: 'A prerequisite for this subject has not been passed yet.' },
    { key: 'clash',  label: 'Schedule clash',       text: 'This section clashes with another subject in the plan. Please choose a different section.' },
    { key: 'full',   label: 'Section full or closed', text: 'This section is full or closed. Please choose another section.' },
    { key: 'load',   label: 'Too many units',       text: 'The plan is over the allowed unit load. Please take fewer units this term.' },
    { key: 'term',   label: 'Not offered this term', text: 'This subject is not offered this term for your year level.' },
    { key: 'other',  label: 'Other',                text: '' },
];

function starter(key) {
    const hit = REASONS.find(r => r.key === key);
    return hit ? hit.text : '';
}

/* A reason is required, trimmed, and within the database limit. */
function validate(text) {
    const t = String(text == null ? '' : text).trim();
    if (!t) return { ok: false, text: t, error: 'Write a reason: the student needs to know what to fix.' };
    if (t.length > MAX) return { ok: false, text: t, error: 'That reason is ' + t.length + ' characters. Please keep it under ' + MAX + '.' };
    return { ok: true, text: t, error: null };
}

/* What the text box holds after a quick pick. An empty box, or one still holding the previous pick's sentence
   unedited, is replaced. Text the adviser has already written is kept and the new sentence is added after it, so a
   pick never throws away their words. */
function merge(current, previousKey, nextKey) {
    const cur = String(current == null ? '' : current).trim();
    const next = starter(nextKey);
    const prev = previousKey ? starter(previousKey) : '';
    if (!cur || (prev && cur === prev)) return next;
    if (!next || cur.indexOf(next) !== -1) return cur;
    return cur + ' ' + next;
}

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* The dialog. One is built the first time and reused. Resolves to the trimmed reason, or null when cancelled. */
let dlg = null;
function ask(opts) {
    opts = opts || {};
    const doc = (typeof document !== 'undefined') ? document : null;
    if (!doc) return Promise.resolve(null);

    if (!dlg) {
        dlg = doc.createElement('dialog');
        dlg.className = 'rej-dlg';
        dlg.setAttribute('aria-labelledby', 'rej-title');
        doc.body.appendChild(dlg);
    }
    dlg.innerHTML =
        '<form class="rej-form" novalidate>' +
            '<header class="rej-head"><div><h2 id="rej-title">' + esc(opts.title || 'Reject') + '</h2>' +
                (opts.subtitle ? '<p class="rej-sub">' + esc(opts.subtitle) + '</p>' : '') + '</div>' +
                '<button type="button" class="rej-x" data-rej-cancel aria-label="Close"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>' +
            '</header>' +
            '<div class="rej-body">' +
                '<p class="rej-hint">' + (opts.initial
                    ? 'Filled in from what the system found. Check it, change what you need, then send.'
                    : 'The student sees this next to the subject. Pick a reason to start from, then add what to fix.') + '</p>' +
                '<div class="rej-chips" role="group" aria-label="Quick reasons">' +
                    REASONS.map(r => '<button type="button" class="rej-chip" data-rej-key="' + r.key + '" aria-pressed="false">' + esc(r.label) + '</button>').join('') +
                '</div>' +
                '<label class="rej-label" for="rej-text">Reason</label>' +
                '<textarea id="rej-text" class="rej-text" rows="4" maxlength="' + (MAX + 200) + '" placeholder="Which subject or section, and what the student should do instead"></textarea>' +
                '<div class="rej-meta"><span class="rej-err" id="rej-err" role="alert"></span><span class="rej-count" id="rej-count"></span></div>' +
            '</div>' +
            '<footer class="rej-foot">' +
                '<button type="button" class="btn-small" data-rej-cancel>Cancel</button>' +
                '<button type="button" class="btn-small rej-ok" id="rej-ok" disabled>' + esc(opts.confirm || 'Reject') + '</button>' +
            '</footer>' +
        '</form>';

    const text = dlg.querySelector('#rej-text');
    const count = dlg.querySelector('#rej-count');
    const err = dlg.querySelector('#rej-err');
    const ok = dlg.querySelector('#rej-ok');
    let key = null;
    let finished = false;

    return new Promise((resolve) => {
        /* Keeps the count, the error line and the confirm button in step with the text box. The confirm button is
           off while the reason is empty or too long. An empty box shows no error until the adviser tries to send. */
        function refresh(showError) {
            const v = validate(text.value);
            count.textContent = v.text.length + ' / ' + MAX;
            ok.disabled = !v.ok;
            err.textContent = (!v.ok && (showError || v.text)) ? v.error : '';
        }

        function finish(value) {
            if (finished) return;
            finished = true;
            if (dlg.open) dlg.close();
            resolve(value);
        }

        dlg.querySelector('.rej-chips').addEventListener('click', (e) => {
            const chip = e.target.closest('[data-rej-key]');
            if (!chip) return;
            const next = chip.dataset.rejKey;
            text.value = merge(text.value, key, next);
            key = next;
            dlg.querySelectorAll('.rej-chip').forEach(c => c.setAttribute('aria-pressed', String(c === chip)));
            refresh(false);
            text.focus();
            text.setSelectionRange(text.value.length, text.value.length);
        });
        text.addEventListener('input', () => refresh(false));
        ok.addEventListener('click', () => {
            const v = validate(text.value);
            if (!v.ok) { refresh(true); return; }
            finish(v.text);
        });
        dlg.querySelectorAll('[data-rej-cancel]').forEach(b => b.addEventListener('click', () => finish(null)));
        dlg.querySelector('form').addEventListener('submit', (e) => e.preventDefault());
        dlg.addEventListener('cancel', (e) => { e.preventDefault(); finish(null); }, { once: true });
        dlg.addEventListener('click', (e) => { if (e.target === dlg) finish(null); }, { once: true });
        dlg.addEventListener('close', () => finish(null), { once: true });

        text.value = opts.initial ? String(opts.initial) : '';
        refresh(false);
        if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
        text.focus();
        text.setSelectionRange(text.value.length, text.value.length);
    });
}

return { MAX, REASONS, starter, validate, merge, ask };

}));
