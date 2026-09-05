// curriculumbuilder.js — build a curriculum by hand, subject by subject.
//
// Load after config.js, before departmentdashboard.js.
// Exposes window.CurriculumBuilder.mount(supabase, opts).
//
// This is authoring, not importing. The file upload path stays for
// bringing in a curriculum that already exists as a spreadsheet.
//
// Design notes worth knowing:
//
//   Prerequisites are picked from a list, never typed. Every bad-rule
//   failure in this project — a code that does not resolve, a chain that
//   loops — comes from free text. Offering only subjects entered earlier
//   in the curriculum makes both impossible rather than merely caught.
//
//   Total units are computed from lec + lab, not entered. Three boxes
//   let the numbers disagree with each other.
//
//   Lec and lab auto-suggest: typing 2 in lec fills lab with 1, typing 3
//   clears it. That matches most of BSIT, but PE is 2 lec and no lab, so
//   the suggestion is editable and a cleared lab box stays cleared.

(function () {
'use strict';

const YEARS = { 1: 'I — First Year', 2: 'II — Second Year',
                3: 'III — Third Year', 4: 'IV — Fourth Year' };
const TERMS = { 1: 'First Semester', 2: 'Second Semester', 3: 'Summer' };

const STANDING = [
    { key: 'STAND2', label: 'Must finish all 1st to 2nd year courses', threshold: 2 },
    { key: 'STAND3', label: 'Must finish all 1st to 3rd year courses', threshold: 3 },
];

let SB    = null;
let OPTS  = {};
let MOUNT = null;

let ROWS   = [];        // every subject, in entry order
let TAB    = 1;         // 1-4, or 'el'
let SEQ    = 1;
let PICKER = null;      // open prerequisite popover

const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
    c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

const num = (v) => {
    const s = String(v ?? '').trim();
    if (s === '') return null;
    const n = Number(s);
    return Number.isFinite(n) && n >= 0 ? n : null;
};

const unitsOf = (r) => (r.lec ?? 0) + (r.lab ?? 0);


/* ---- rows ---- */

function blank(year, term) {
    return {
        uid: SEQ++,
        code: '', title: '',
        lec: null, lab: null,
        year, term,
        prereqs: [],          // [{ uid }] or [{ standing: 2 }]
        errors: [],
    };
}

const inCell   = (y, t) => ROWS.filter(r => r.year === y && r.term === t);
const catalog  = ()     => ROWS.filter(r => r.year === null);
const scheduled= ()     => ROWS.filter(r => r.year !== null);

/* Subjects a given row may depend on: everything entered before it.
   A subject cannot require something that comes later, so no chain can
   loop back on itself. */
function candidatesFor(row) {
    const i = ROWS.indexOf(row);
    return ROWS.slice(0, i).filter(r => r.code.trim());
}


/* ---- validation ---- */

function validate() {
    const seen = new Map();

    for (const r of ROWS) {
        r.errors = [];
        const code = r.code.trim().toUpperCase();

        // A wholly empty row is a row not filled in yet, not an error.
        if (!code && !r.title.trim() && r.lec === null && r.lab === null) continue;

        if (!code)          r.errors.push('Code is required.');
        if (!r.title.trim()) r.errors.push('Title is required.');
        if (unitsOf(r) <= 0) r.errors.push('Units must be more than zero.');

        if (code) {
            if (seen.has(code)) r.errors.push('This code is already used.');
            else seen.set(code, r);
        }
    }

    return seen;
}

const filled  = () => ROWS.filter(r => r.code.trim() || r.title.trim());
const badRows = () => filled().filter(r => r.errors.length);


/* ---- prerequisite picker ---- */

function chipsHtml(row) {
    if (!row.prereqs.length) {
        return '<span class="cb-pick-empty">Add prerequisite</span>';
    }

    return row.prereqs.map(p => {
        if (p.standing) {
            const s = STANDING.find(x => x.threshold === p.standing);
            return `<span class="cb-chip mark">${'*'.repeat(p.standing)}</span>`;
        }
        const t = ROWS.find(r => r.uid === p.uid);
        return `<span class="cb-chip">${esc(t?.code || '?')}</span>`;
    }).join('');
}

function openPicker(row, anchor) {
    closePicker();

    const opts = candidatesFor(row);
    const chosen = new Set(row.prereqs.filter(p => p.uid).map(p => p.uid));
    const stands = new Set(row.prereqs.filter(p => p.standing).map(p => p.standing));

    // Group by year and term so a long list stays navigable.
    const groups = new Map();
    for (const o of opts) {
        const key = o.year === null ? 'Electives'
                  : `${YEARS[o.year]} · ${TERMS[o.term]}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(o);
    }

    const list = [...groups].map(([label, rows]) => `
        <p class="cb-pick-group">${esc(label)}</p>
        ${rows.map(o => `
            <label class="cb-pick-row" data-uid="${o.uid}">
                <input type="checkbox" ${chosen.has(o.uid) ? 'checked' : ''}>
                <span class="cb-pick-code">${esc(o.code)}</span>
                <span class="cb-pick-title">${esc(o.title)}</span>
            </label>`).join('')}`).join('');

    const el = document.createElement('div');
    el.className = 'cb-picker';
    el.innerHTML = `
        <input class="cb-pick-search" placeholder="Search subjects" autocomplete="off">
        <div class="cb-pick-list">
            <p class="cb-pick-group">Standing</p>
            ${STANDING.map(s => `
                <label class="cb-pick-row" data-standing="${s.threshold}">
                    <input type="checkbox" ${stands.has(s.threshold) ? 'checked' : ''}>
                    <span class="cb-pick-code">${'*'.repeat(s.threshold)}</span>
                    <span class="cb-pick-title">${esc(s.label)}</span>
                </label>`).join('')}
            ${opts.length ? list : '<p class="cb-pick-none">No earlier subjects yet.</p>'}
        </div>
        <div class="cb-pick-foot"><button class="cb-pick-done">Done</button></div>`;

    anchor.appendChild(el);
    PICKER = { el, row };

    el.querySelector('.cb-pick-search')?.focus();

    el.addEventListener('input', (e) => {
        if (!e.target.classList.contains('cb-pick-search')) return;
        const q = e.target.value.trim().toLowerCase();
        el.querySelectorAll('.cb-pick-row').forEach(r => {
            r.style.display = !q || r.textContent.toLowerCase().includes(q) ? '' : 'none';
        });
        el.querySelectorAll('.cb-pick-group').forEach(g => {
            g.style.display = q ? 'none' : '';
        });
    });

    el.addEventListener('change', (e) => {
        const label = e.target.closest('.cb-pick-row');
        if (!label) return;

        const on   = e.target.checked;
        const uid  = label.dataset.uid ? Number(label.dataset.uid) : null;
        const st   = label.dataset.standing ? Number(label.dataset.standing) : null;

        if (uid !== null) {
            row.prereqs = on
                ? [...row.prereqs, { uid }]
                : row.prereqs.filter(p => p.uid !== uid);
        } else if (st !== null) {
            row.prereqs = on
                ? [...row.prereqs, { standing: st }]
                : row.prereqs.filter(p => p.standing !== st);
        }

        // Repaint the cell without closing the picker.
        const cell = anchor.querySelector('.cb-chips');
        if (cell) cell.innerHTML = chipsHtml(row);
    });

    el.addEventListener('click', (e) => {
        if (e.target.closest('.cb-pick-done')) { closePicker(); render(); }
    });
}

function closePicker() {
    PICKER?.el.remove();
    PICKER = null;
}


/* ---- rendering ---- */

function statsHtml() {
    const rows  = filled();
    const bad   = badRows().length;
    // Catalogue electives are options, not requirements. Counting them
    // would report 257 rather than 176.
    const units = scheduled().reduce((t, r) => t + unitsOf(r), 0);

    return `<div class="cb-stats">
        <div class="cb-stat"><p class="k">Subjects</p><p class="v">${rows.length}</p></div>
        <div class="cb-stat ${bad ? '' : 'ok'}"><p class="k">Valid</p><p class="v">${rows.length - bad}</p></div>
        <div class="cb-stat ${bad ? 'bad' : ''}"><p class="k">Issues</p><p class="v">${bad}</p></div>
        <div class="cb-stat"><p class="k">Units</p><p class="v">${units}</p>
            <p class="u">scheduled only</p></div>
    </div>`;
}

function rowHtml(r) {
    const bad = r.errors.length > 0;

    return `<tr data-uid="${r.uid}" class="${bad ? 'cb-bad' : ''}">
        <td><input data-f="code" value="${esc(r.code)}" placeholder="CC-INTCOM11"></td>
        <td><input data-f="title" value="${esc(r.title)}" placeholder="Introduction to Computing"></td>
        <td class="n"><input data-f="lec" value="${r.lec ?? ''}" inputmode="numeric"></td>
        <td class="n"><input data-f="lab" value="${r.lab ?? ''}" inputmode="numeric"></td>
        <td class="n cb-total">${unitsOf(r) || ''}</td>
        <td class="cb-pre">
            <div class="cb-pick" data-uid="${r.uid}">
                <div class="cb-chips">${chipsHtml(r)}</div>
            </div>
        </td>
        <td class="cb-del"><button data-del="${r.uid}" title="Remove">&times;</button></td>
    </tr>`;
}

function tableHtml(label, rows, year, term) {
    const units = rows.reduce((t, r) => t + unitsOf(r), 0);

    return `<div class="cb-panel">
        <div class="cb-panel-head">
            <span>${esc(label)}</span>
            <span class="cb-dim">${rows.filter(r => r.code.trim()).length} subjects · ${units} units</span>
        </div>
        <table>
            <thead><tr>
                <th>Code</th><th>Descriptive title</th>
                <th class="n">Lec</th><th class="n">Lab</th><th class="n">Total</th>
                <th>Prerequisite</th><th></th>
            </tr></thead>
            <tbody>${rows.map(rowHtml).join('')
                || '<tr class="cb-none"><td colspan="7">No subjects yet.</td></tr>'}</tbody>
        </table>
        <div class="cb-panel-foot">
            <button data-add="${year ?? 'el'}-${term ?? 0}">+ Add subject</button>
        </div>
    </div>`;
}

function bodyHtml() {
    if (TAB === 'el') {
        return tableHtml('Elective catalogue', catalog(), null, null);
    }

    let html = `<div class="cb-sems">
        ${tableHtml(TERMS[1], inCell(TAB, 1), TAB, 1)}
        ${tableHtml(TERMS[2], inCell(TAB, 2), TAB, 2)}
    </div>`;

    // Summer exists in the third year of BSIT. Offer it there, and show
    // it anywhere it already holds subjects.
    const summer = inCell(TAB, 3);
    if (TAB === 3 || summer.length) {
        html += `<div class="cb-summer">${tableHtml(TERMS[3], summer, TAB, 3)}</div>`;
    }

    return html;
}

/* The action bar repaints on every keystroke, so it lives in its own
   function. Leaving it inside render() froze the hint and the Create
   button at whatever they were when the view was first drawn. */
function actionsHtml() {
    const n   = filled().length;
    const bad = badRows().length;

    return `<div class="cb-actions">
        <button id="cb-draft">Save as draft</button>
        <button class="btn-primary" id="cb-create" ${bad || !n ? 'disabled' : ''}>
            Create curriculum
        </button>
        <button id="cb-preview" ${!n ? 'disabled' : ''}>Preview</button>
        <span class="cb-hint">${
            !n    ? 'Add at least one subject'
            : bad ? `Fix ${bad} issue${bad === 1 ? '' : 's'} to continue`
            : `${n} subject${n === 1 ? '' : 's'} ready`}</span>
    </div>`;
}

function render() {
    const tabs = [1, 2, 3, 4].map(y => {
        const bad = ROWS.filter(r => r.year === y && r.errors.length).length;
        return `<button class="cb-tab${TAB === y ? ' on' : ''}" data-tab="${y}">
            ${YEARS[y]}${bad ? ` <span class="cb-count">${bad}</span>` : ''}
        </button>`;
    }).join('') + `<button class="cb-tab${TAB === 'el' ? ' on' : ''}" data-tab="el">
        Electives${catalog().length ? ` <span class="cb-n">${catalog().length}</span>` : ''}
    </button>`;

    MOUNT.innerHTML = statsHtml()
        + `<div class="cb-tabs">${tabs}</div>`
        + `<div class="cb-body">${bodyHtml()}</div>`
        + actionsHtml();
}


/* ---- preview ---- */

/* Read-only, laid out like the printed prospectus. The builder's cells
   are inputs and truncate long titles; this is where you check what you
   have actually typed before committing it. Renders from memory, so it
   works on an unsaved draft. */

function previewRows(rows) {
    return rows.map(r => {
        const pre = r.prereqs.map(p => {
            if (p.standing) return `<span class="cbp-mark">${'*'.repeat(p.standing)}</span>`;
            const t = ROWS.find(x => x.uid === p.uid);
            return esc(t?.code || '?');
        }).join(', ');

        return `<tr>
            <td class="cbp-code">${esc(r.code)}</td>
            <td>${esc(r.title)}</td>
            <td class="n">${r.lec ?? ''}</td>
            <td class="n">${r.lab ?? ''}</td>
            <td class="n b">${unitsOf(r) || ''}</td>
            <td class="cbp-pre">${pre || '<span class="cbp-dim">\u2014</span>'}</td>
        </tr>`;
    }).join('');
}

function previewPanel(label, rows) {
    if (!rows.length) return '';
    const units = rows.reduce((t, r) => t + unitsOf(r), 0);

    return `<div class="cbp-panel">
        <div class="cbp-head"><span>${esc(label)}</span>
            <span class="cbp-dim">${rows.length} subjects</span></div>
        <table>
            <thead><tr><th>Code</th><th>Descriptive title</th>
                <th class="n">Lec</th><th class="n">Lab</th><th class="n">Tot</th>
                <th>Prerequisite</th></tr></thead>
            <tbody>${previewRows(rows)}</tbody>
        </table>
        <div class="cbp-foot"><span>Total</span><span>${units} units</span></div>
    </div>`;
}

function openPreview() {
    const rows  = filled();
    const units = scheduled().filter(r => r.code.trim() || r.title.trim())
                             .reduce((t, r) => t + unitsOf(r), 0);

    const years = [1, 2, 3, 4].filter(y => rows.some(r => r.year === y));

    const body = years.map(y => `
        <h4 class="cbp-year">${YEARS[y]}</h4>
        <div class="cbp-sems">
            ${previewPanel(TERMS[1], rows.filter(r => r.year === y && r.term === 1))}
            ${previewPanel(TERMS[2], rows.filter(r => r.year === y && r.term === 2))}
        </div>
        ${previewPanel(TERMS[3], rows.filter(r => r.year === y && r.term === 3))}
    `).join('') + previewPanel('Elective catalogue', rows.filter(r => r.year === null));

    const el = document.createElement('div');
    el.className = 'cbp-overlay';
    el.innerHTML = `
        <div class="cbp-modal" role="dialog" aria-label="Curriculum preview">
            <div class="cbp-bar">
                <div>
                    <p class="cbp-title">Curriculum preview</p>
                    <p class="cbp-sub">${rows.length} subjects \u00b7 ${units} units scheduled</p>
                </div>
                <button class="cbp-close" aria-label="Close">&times;</button>
            </div>
            <div class="cbp-body">${body || '<p class="cbp-dim">Nothing to preview yet.</p>'}</div>
        </div>`;

    document.body.appendChild(el);

    const close = () => { el.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };

    el.addEventListener('click', (e) => {
        if (e.target === el || e.target.closest('.cbp-close')) close();
    });
    document.addEventListener('keydown', onKey);
}


/* ---- events ---- */

function bind() {
    MOUNT.addEventListener('click', (e) => {
        const tab = e.target.closest('.cb-tab');
        if (tab) { closePicker(); TAB = tab.dataset.tab === 'el' ? 'el' : Number(tab.dataset.tab); return render(); }

        const add = e.target.closest('[data-add]');
        if (add) {
            const [y, t] = add.dataset.add.split('-');
            ROWS.push(y === 'el' ? blank(null, null) : blank(Number(y), Number(t)));
            validate();
            return render();
        }

        const del = e.target.closest('[data-del]');
        if (del) {
            const uid = Number(del.dataset.del);
            ROWS = ROWS.filter(r => r.uid !== uid);
            // Drop any rule that pointed at the removed subject.
            for (const r of ROWS) r.prereqs = r.prereqs.filter(p => p.uid !== uid);
            validate();
            return render();
        }

        const pick = e.target.closest('.cb-pick');
        if (pick && !e.target.closest('.cb-picker')) {
            const row = ROWS.find(r => r.uid === Number(pick.dataset.uid));
            if (row) openPicker(row, pick);
            return;
        }

        if (e.target.closest('#cb-preview')) return openPreview();
        if (e.target.closest('#cb-draft'))  return saveDraft();
        if (e.target.closest('#cb-create')) return create();
    });

    MOUNT.addEventListener('input', (e) => {
        const input = e.target.closest('input[data-f]');
        if (!input) return;

        const tr  = input.closest('tr');
        const row = ROWS.find(r => r.uid === Number(tr.dataset.uid));
        if (!row) return;

        const f = input.dataset.f;

        if (f === 'lec' || f === 'lab') {
            row[f] = num(input.value);

            // Suggest the lab value from the lecture hours. Most 3-unit
            // subjects with a laboratory are 2 + 1, and lecture-only ones
            // are 3 + 0. PE is 2 + 0, so this only fills a lab box the
            // user has not touched.
            if (f === 'lec' && !row.labTouched) {
                if (row.lec === 2)      row.lab = 1;
                else if (row.lec === 3) row.lab = null;

                const labInput = tr.querySelector('input[data-f="lab"]');
                if (labInput) labInput.value = row.lab ?? '';
            }

            if (f === 'lab') row.labTouched = true;

            const cell = tr.querySelector('.cb-total');
            if (cell) cell.textContent = unitsOf(row) || '';
        } else {
            row[f] = input.value;
        }

        // Revalidate quietly. A full repaint on every keystroke would
        // steal focus mid-word.
        validate();
        tr.classList.toggle('cb-bad', row.errors.length > 0);
        updateStats();
    });

    document.addEventListener('click', (e) => {
        if (PICKER && !e.target.closest('.cb-pick')) closePicker();
    });
}

/* Repaint only the bits that change as the user types. A full render
   would steal focus mid-word; leaving them alone made the hint and the
   Create button go stale. */
function updateStats() {
    const stats = MOUNT.querySelector('.cb-stats');
    if (stats) stats.outerHTML = statsHtml();

    const actions = MOUNT.querySelector('.cb-actions');
    if (actions) actions.outerHTML = actionsHtml();
}


/* ---- persistence ---- */

function toSubjectRows() {
    return filled().map(r => ({
        prospectus_id: OPTS.prospectusId,
        created_by:    OPTS.staffId,
        code:          r.code.trim().toUpperCase(),
        title:         r.title.trim(),
        units:         unitsOf(r),
        lec_units:     r.lec ?? 0,
        lab_units:     r.lab ?? 0,
        year_level:    r.year,
        term:          r.term,
        is_elective:   r.year === null || /^IT-EL|^IT-FRE/.test(r.code.trim().toUpperCase()),
    }));
}

async function saveDraft() {
    // stg_subject and stg_prerequisite exist for exactly this and have
    // been unused. A draft does not belong in the live subject table.
    const batch = OPTS.draftBatchId ?? crypto.randomUUID();
    OPTS.draftBatchId = batch;

    const rows = filled().map((r, i) => ({
        batch_id:    batch,
        uploaded_by: OPTS.userId,
        row_number:  i + 1,
        code:        r.code.trim().toUpperCase(),
        title:       r.title.trim(),
        units:       unitsOf(r),
        year_level:  r.year,
        term:        r.term,
        is_elective: r.year === null,
        validation_status: r.errors.length ? 'error' : 'ok',
        error_message:     r.errors.join(' ') || null,
    }));

    await SB.from('stg_subject').delete().eq('batch_id', batch);
    const { error } = await SB.from('stg_subject').insert(rows);

    if (error) {
        console.error('draft save failed:', error.message);
        return OPTS.onError?.('Could not save the draft. ' + error.message);
    }

    OPTS.onDone?.(`Draft saved — ${rows.length} subjects.`);
}

async function create() {
    if (badRows().length || !filled().length) return;

    const btn = MOUNT.querySelector('#cb-create');
    if (btn) { btn.disabled = true; btn.textContent = 'Creating\u2026'; }

    const { data, error } = await SB.from('subject')
        .insert(toSubjectRows()).select('id, code');

    if (error) {
        console.error('subject insert failed:', error.message);
        if (btn) { btn.disabled = false; btn.textContent = 'Create curriculum'; }
        return OPTS.onError?.('Could not create the curriculum. ' + error.message);
    }

    // Rules second — they need the ids the insert just returned.
    const byCode = new Map(data.map(s => [s.code, s.id]));
    const rules  = [];

    for (const r of filled()) {
        const id = byCode.get(r.code.trim().toUpperCase());
        if (!id) continue;

        r.prereqs.forEach((p, i) => {
            const target = p.uid ? ROWS.find(x => x.uid === p.uid) : null;
            rules.push({
                subject_id:              id,
                prerequisite_subject_id: target
                    ? byCode.get(target.code.trim().toUpperCase())
                    : null,
                requirement_type: p.standing ? 'standing' : 'prerequisite',
                rule_type:        'and',
                // Every condition shown on one row is required, so each
                // gets its own group. Groups are ANDed.
                rule_group:       i + 1,
                threshold_value:  p.standing ?? null,
                created_by:       OPTS.staffId,
            });
        });
    }

    if (rules.length) {
        const res = await SB.from('prerequisite').insert(rules);
        if (res.error) {
            console.error('prerequisite insert failed:', res.error.message);
            return OPTS.onError?.(
                `Subjects created, but the rules failed: ${res.error.message}`);
        }
    }

    const n = data.length;
    ROWS = [];
    OPTS.onDone?.(`${n} subjects and ${rules.length} rules created.`);
    render();
}


/* ---- entry point ---- */

function mount(supabase, opts) {
    SB    = supabase;
    OPTS  = opts ?? {};
    MOUNT = opts.mountEl;

    if (!MOUNT) return console.error('CurriculumBuilder: no mount element');

    MOUNT.classList.add('cb');

    if (!MOUNT.dataset.bound) {
        bind();
        MOUNT.dataset.bound = '1';
    }

    if (!ROWS.length) {
        // Start with a few empty rows so the table is not a blank slab.
        for (let i = 0; i < 3; i++) ROWS.push(blank(1, 1));
    }

    validate();
    render();
}

window.CurriculumBuilder = { mount, reset: () => { ROWS = []; SEQ = 1; render(); } };

})();