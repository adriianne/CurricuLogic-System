// programswitch.js
//
// The "Programme" switch in the header of the Faculty and Registrar pages, for someone who covers MORE THAN ONE
// programme (db/107, db/110). It replaces the read-only programme label with a dropdown: "All my programmes" plus one
// entry per programme. With a single programme it does nothing and the plain label stays.
//
// The page decides what the choice scopes (lists, counts). This file only draws the control, remembers the choice for
// the browser tab, and tells the page when it changes. It touches no database.
//
//   const sw = CurriculogicProgramSwitch.create({ wrap, key: 'registrar', onChange(value) { ... } });
//   sw.setOptions([{ id: 7, code: 'BSIT', name: 'BS Information Technology' }, ...]);
//   sw.value()   // 'all' or a programme id (number)

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.CurriculogicProgramSwitch = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const ALL = 'all';

/* The choice that applies to the options now on offer: a remembered programme the person no longer covers falls back
   to "all". Pure, so it can be tested. */
function resolveChoice(stored, options) {
    if (stored === undefined || stored === null || stored === '' || stored === ALL) return ALL;
    const id = Number(stored);
    return (options || []).some(o => Number(o.id) === id) ? id : ALL;
}

/* What the button says. */
function labelFor(choice, options) {
    const list = options || [];
    if (choice === ALL) return 'All programmes (' + list.length + ')';
    const hit = list.find(o => Number(o.id) === Number(choice));
    return hit ? hit.code : 'All programmes (' + list.length + ')';
}

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function create(cfg) {
    const doc = (cfg.wrap && cfg.wrap.ownerDocument) || (typeof document !== 'undefined' ? document : null);
    const storageKey = 'curriculogic.programme.' + (cfg.key || 'page');
    let options = [];
    let choice = ALL;
    let host = null;
    let open = false;

    const read = () => { try { return window.sessionStorage.getItem(storageKey); } catch (e) { return null; } };
    const write = (v) => { try { window.sessionStorage.setItem(storageKey, String(v)); } catch (e) { /* private window: fine */ } };

    function build() {
        if (host || !cfg.wrap || !doc) return;
        host = doc.createElement('div');
        host.className = 'pswitch';
        host.hidden = true;
        host.innerHTML =
            '<span class="pswitch-label">Programme</span>' +
            '<button type="button" class="pswitch-btn" aria-haspopup="listbox" aria-expanded="false" aria-label="Switch programme">' +
                '<span class="pswitch-value"></span><i class="fa-solid fa-chevron-down" aria-hidden="true"></i>' +
            '</button>' +
            '<ul class="pswitch-menu" role="listbox" tabindex="-1" hidden></ul>';
        cfg.wrap.parentNode.insertBefore(host, cfg.wrap.nextSibling);

        const btn = host.querySelector('.pswitch-btn');
        btn.addEventListener('click', () => toggle());
        btn.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); toggle(true); }
        });
        host.querySelector('.pswitch-menu').addEventListener('click', (e) => {
            const li = e.target.closest('[data-psw]');
            if (li) pick(li.dataset.psw);
        });
        host.querySelector('.pswitch-menu').addEventListener('keydown', onMenuKey);
        doc.addEventListener('click', (e) => { if (open && !host.contains(e.target)) close(); });
    }

    function onMenuKey(e) {
        const items = [...host.querySelectorAll('[data-psw]')];
        const at = items.indexOf(doc.activeElement);
        if (e.key === 'Escape') { e.preventDefault(); close(true); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); items[Math.min(items.length - 1, at + 1)].focus(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); items[Math.max(0, at - 1)].focus(); }
        else if (e.key === 'Home') { e.preventDefault(); items[0].focus(); }
        else if (e.key === 'End') { e.preventDefault(); items[items.length - 1].focus(); }
        else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (at >= 0) pick(items[at].dataset.psw); }
        else if (e.key === 'Tab') close();
    }

    function paint() {
        if (!host) return;
        host.querySelector('.pswitch-value').textContent = labelFor(choice, options);
        const menu = host.querySelector('.pswitch-menu');
        const row = (value, code, name, on) =>
            '<li role="option" tabindex="-1" data-psw="' + esc(value) + '" aria-selected="' + on + '" class="pswitch-opt' + (on ? ' is-on' : '') + '">' +
                '<span class="pswitch-code">' + esc(code) + '</span>' +
                (name ? '<span class="pswitch-name">' + esc(name) + '</span>' : '') +
                (on ? '<i class="fa-solid fa-check" aria-hidden="true"></i>' : '') +
            '</li>';
        menu.innerHTML = row(ALL, 'All my programmes', '', choice === ALL) +
            options.map(o => row(o.id, o.code, o.name, choice !== ALL && Number(choice) === Number(o.id))).join('');
    }

    function toggle(focusList) { open ? close() : show(focusList); }
    function show(focusList) {
        if (!host) return;
        open = true;
        host.querySelector('.pswitch-menu').hidden = false;
        host.querySelector('.pswitch-btn').setAttribute('aria-expanded', 'true');
        const on = host.querySelector('.pswitch-opt.is-on') || host.querySelector('.pswitch-opt');
        if (on && focusList !== false) on.focus();
    }
    function close(returnFocus) {
        if (!host) return;
        open = false;
        host.querySelector('.pswitch-menu').hidden = true;
        const btn = host.querySelector('.pswitch-btn');
        btn.setAttribute('aria-expanded', 'false');
        if (returnFocus) btn.focus();
    }

    function pick(raw) {
        const next = raw === ALL ? ALL : Number(raw);
        close(true);
        if (next === choice) return;
        choice = next;
        write(choice);
        paint();
        if (typeof cfg.onChange === 'function') cfg.onChange(choice);
    }

    return {
        /* Offer these programmes. Shows the switch only when there are two or more, and hides the plain label then. */
        setOptions(list) {
            options = (list || []).filter(o => o && o.id != null);
            build();
            choice = resolveChoice(read(), options);
            const many = options.length > 1;
            if (host) host.hidden = !many;
            if (cfg.wrap) cfg.wrap.hidden = many;
            if (!many) choice = ALL;
            paint();
            return choice;
        },
        value() { return choice; },
    };
}

return { create, resolveChoice, labelFor, ALL };

}));
