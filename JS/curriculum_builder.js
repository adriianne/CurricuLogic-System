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

/* Real subject codes in this prospectus: CC-INTCOM11, ENGL 100, PE 101,
   ELPHP1, IT-EL______. Uppercase letters, digits, hyphen, space and
   underscore covers all of them; anything else is a typo. */
// Must begin with a letter. "123123" is a typo, not a subject code.
const CODE_OK  = /^[A-Z][A-Z0-9 \-_]*$/;

/* Titles are not letters-only. The prospectus has "Computer Programming 1",
   "Web Design & Development", "Applications Dev't & Emerging Tech.",
   "Life, Works & Writings of Dr. Jose Rizal" and
   "Sports/Outdoor Adventure (PATHFit 4)". Requiring at least one letter
   and rejecting control characters is the useful check. */
const TITLE_OK = /^[^\x00-\x1f]*[A-Za-z][^\x00-\x1f]*$/;

/* Practicum is 9 lecture units, so 3 is too low a ceiling. 9 keeps every
   value a single digit and still admits everything real. */
/* Lecture units in this curriculum are 2 or 3, and nothing else — a
   3-unit subject is either 3 lecture, or 2 lecture with 1 laboratory.
   The one exception is CC-PRACT40, a 9-unit practicum.

   PE is 2 lecture with no laboratory, which is why the lab auto-fill is
   a suggestion the operator can clear rather than a rule. */
const LEC_OK   = [2, 3, 9];
const LAB_MAX  = 1;

/* A semester beyond this is almost certainly a mistake — the heaviest in
   BSIT is 26. Adding rows stops here rather than letting a term grow
   without limit. */
const MAX_TERM_UNITS = 30;

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
let SELECTED_YEAR = null;   // may be a year with no prospectus row yet
let DRAFT_BATCH   = null;   // survives a re-mount; OPTS does not

const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
    c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

const num = (v) => {
    const s = String(v ?? '').trim();
    if (s === '') return null;
    const n = Number(s);
    return Number.isFinite(n) && n >= 0 ? n : null;
};

const unitsOf = (r) => (r.lec ?? 0) + (r.lab ?? 0);

/* A subject code is letters, digits, hyphens and single spaces, and must
   begin with a letter — CC-COMPROG11, ENGL 100, PE 101. "123123" is a

/* Semesters run 6 to 26 units in BSIT. This is not a hard limit — a
   different programme may differ — but past it, something is usually
   wrong, so it warns rather than blocks. */
/* BSIT runs 26, 26, 23, 23, 24, 24, 6 summer, 12, 12 — so 26 is the
   real ceiling. 27 leaves a little room without letting a fourth-year
   semester quietly reach double what the prospectus says.

   Deliberately one flat number rather than a per-year table. Hardcoding
   the BSIT shape here would make the builder warn constantly on any
   other programme. If the precise per-semester figures are ever needed,
   they belong on the prospectus row, with the curriculum they describe. */
const HEAVY_TERM = 27;


/* ---- rows ---- */

function blank(year, term, electiveType = null) {
    return {
        uid: SEQ++,
        electiveType,          // 'IT' or 'FREE' for catalogue rows
        code: '', title: '',
        lec: null, lab: null,
        year, term,
        prereqs: [],          // [{ uid }] or [{ standing: 2 }]
        errors: [],
    };
}

const inCell   = (y, t) => ROWS.filter(r => r.year === y && r.term === t);
const catalog  = (type) => ROWS.filter(r =>
    r.year === null && (type ? r.electiveType === type : true));
const scheduled= ()     => ROWS.filter(r => r.year !== null);

/* Where a subject sits in the curriculum, as a sortable number.
   Catalogue electives have no year or term and rank last — a student
   chooses when to take them, so they may depend on anything scheduled. */
function rank(r) {
    return r.year === null ? 999 : (r.year * 10) + (r.term ?? 0);
}

/* Subjects a given row may depend on: everything that comes EARLIER IN
   THE CURRICULUM, not earlier in typing order. A second-semester subject
   can require a first-semester one whether or not that row was filled in
   first — which is the whole point, since people fill these tables in
   whatever order suits them.

   Strictly earlier means a chain can never loop: a subject cannot reach
   back to its own position or beyond it. Catalogue electives compare by
   entry order among themselves, so ELPHP2 can require ELPHP1. */
function candidatesFor(row) {
    const here = rank(row);
    const i    = ROWS.indexOf(row);

    return ROWS.filter((r, j) => {
        if (r === row || !r.code.trim()) return false;

        const there = rank(r);
        if (there !== here) return there < here;

        // Same position in the curriculum: only catalogue entries may
        // depend on each other, and only on one entered earlier.
        return row.year === null && j < i;
    });
}


/* ---- validation ---- */

function validate() {
    const seen = new Map();

    for (const r of ROWS) {
        r.errors = [];
        const code = r.code.trim().toUpperCase();

        // A wholly empty row is a row not filled in yet, not an error.
        if (!code && !r.title.trim() && r.lec === null && r.lab === null) continue;

        if (!code) {
            r.errors.push('Code is required.');
        } else if (!CODE_OK.test(code)) {
            r.errors.push('Use letters, digits, hyphens and spaces only.');
        }

        if (!r.title.trim()) {
            r.errors.push('Title is required.');
        } else if (!TITLE_OK.test(r.title.trim())) {
            r.errors.push('Title must contain at least one letter.');
        }

        if (r.lec !== null && !LEC_OK.includes(r.lec)) {
            r.errors.push('Lecture units must be 2 or 3 (9 for practicum).');
        }
        if (r.lab !== null && r.lab > LAB_MAX) {
            r.errors.push('Laboratory units are 1, or blank for none.');
        }

        if (unitsOf(r) <= 0) r.errors.push('Units must be more than zero.');

        if (code) {
            if (seen.has(code)) r.errors.push('This code is already used.');
            else seen.set(code, r);
        }
    }

    return seen;
}

const filled  = () => ROWS.filter(r => r.code.trim() || r.title.trim());

/* Warning, not an error. Nothing is blocked — the operator is told the
   term looks heavy and decides. */
function termWarning(year, term) {
    const u = inCell(year, term).reduce((t, r) => t + unitsOf(r), 0);
    return u > HEAVY_TERM
        ? `${u} units is unusually heavy for one term.`
        : null;
}
const badRows = () => filled().filter(r => r.errors.length);


/* ---- prerequisite picker ---- */

function chipsHtml(row) {
    if (!row.prereqs.length) {
        return '<span class="cb-pick-empty">Add prerequisite</span>';
    }

    return `<span class="cb-chiplist">` + row.prereqs.map(p => {
        if (p.standing) {
            const s = STANDING.find(x => x.threshold === p.standing);
            return `<span class="cb-chip mark">${'*'.repeat(p.standing)}</span>`;
        }
        const t = ROWS.find(r => r.uid === p.uid);
        return `<span class="cb-chip">${esc(t?.code || '?')}</span>`;
    }).join('') + '</span>';
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

    /* A subject either carries a standing gate or names prerequisites,
       never both — that is how the prospectus is written, and mixing the
       two would mean a rule nobody could read off the printed page. The
       two standing levels exclude each other for the same reason. */
    function applyExclusivity() {
        const hasStanding = row.prereqs.some(p => p.standing);
        const hasSubject  = row.prereqs.some(p => p.uid);

        el.querySelectorAll('.cb-pick-row').forEach(label => {
            const box = label.querySelector('input');
            const isStanding = label.dataset.standing !== undefined;

            const block = isStanding
                ? (hasSubject || (hasStanding && !box.checked))
                : hasStanding;

            box.disabled = block;
            label.classList.toggle('is-locked', block);
        });
    }

    applyExclusivity();

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

        applyExclusivity();

        // Repaint the cell without closing the picker.
        const cell = anchor.querySelector('.cb-chip-wrap');
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

/* Which prospectus version these subjects will land in. Versions are
   created and activated in the Prospectus view; this only switches
   between the ones that exist, so a department can build next year's
   curriculum while this year's stays active. */
/* Years offered: every version that exists, plus a span around the
   present so a curriculum can be started for a year nobody has created
   yet. Choosing a new year creates the prospectus row on save, always as
   a draft — activation stays in the Prospectus view, so there is still
   one place that decides what students are assessed against. */
function yearOptions() {
    const list = OPTS.versions ?? [];
    const now  = new Date().getFullYear();

    const known = new Map(list.map(v => [v.academic_year, v]));
    const years = new Set(known.keys());
    for (let y = now - 4; y <= now + 3; y++) years.add(y);

    return [...years].sort((a, b) => b - a).map(y => {
        const v = known.get(y);
        return {
            year: y,
            id: v?.id ?? null,
            label: `${y}\u2013${y + 1}` +
                   (v ? (v.is_active ? ' \u00b7 Active' : ' \u00b7 Draft') : ' \u00b7 New'),
        };
    });
}

function versionHtml() {
    const opts = yearOptions();
    const sel  = SELECTED_YEAR;

    return `<div class="cb-version">
        <div>
            <p class="k">Curriculum year</p>
            <p class="v">${sel}\u2013${sel + 1}</p>
        </div>
        <select id="cb-version-pick" aria-label="Select curriculum year">
            ${opts.map(o => `<option value="${o.year}"${
                o.year === sel ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}
        </select>
    </div>`;
}

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
        <td class="n"><input data-f="lec" value="${r.lec ?? ''}" inputmode="numeric"
            maxlength="1" pattern="[0-9]"></td>
        <td class="n"><input data-f="lab" value="${r.lab ?? ''}" inputmode="numeric"
            maxlength="1" pattern="[0-9]"></td>
        <td class="n cb-total">${unitsOf(r) || ''}</td>
        <td class="cb-pre">
            <div class="cb-pick" data-uid="${r.uid}">
                <div class="cb-chips" role="button" tabindex="0" aria-haspopup="listbox">
                <span class="cb-chip-wrap">${chipsHtml(r)}</span>
                <span class="cb-caret" aria-hidden="true">\u25BE</span>
            </div>
            </div>
        </td>
        <td class="cb-del"><button data-del="${r.uid}" title="Remove">&times;</button></td>
    </tr>`;
}

function tableHtml(label, rows, year, term) {
    const units = rows.reduce((t, r) => t + unitsOf(r), 0);
    const warn  = year ? termWarning(year, term) : null;
    const full  = year !== null && units >= MAX_TERM_UNITS;

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
            <button data-add="${year ?? 'el'}-${term ?? 0}" ${full ? 'disabled' : ''}>
                + Add subject
            </button>
            ${full ? `<span class="cb-full">Semester is at ${units} units</span>` : ''}
        </div>
    </div>`;
}

/* Tab order, so a switch knows whether it is moving forwards or back and
   can slide in the matching direction. */
const TABS = [1, 2, 3, 4, 'it', 'free'];

function paneHtml(tab) {
    /* IT and free electives are separate lists in the printed prospectus
       and are chosen from separately — four of each. Keeping them in one
       tab meant the type had to be inferred from the code afterwards,
       and that inference was wrong for the IT-FRE slots. */
    if (tab === 'it')   return tableHtml('IT elective courses', catalog('IT'), null, null);
    if (tab === 'free') return tableHtml('Free elective courses', catalog('FREE'), null, null);

    let html = `<div class="cb-sems">
        ${tableHtml(TERMS[1], inCell(tab, 1), tab, 1)}
        ${tableHtml(TERMS[2], inCell(tab, 2), tab, 2)}
    </div>`;

    // Summer exists in the third year of BSIT. Offer it there, and show
    // it anywhere it already holds subjects.
    const summer = inCell(tab, 3);
    if (tab === 3 || summer.length) {
        html += `<div class="cb-summer">${tableHtml(TERMS[3], summer, tab, 3)}</div>`;
    }

    return html;
}

/* Every year is rendered and stacked, as the prospectus grid does, so a
   switch is a slide rather than a repaint. The rows are inputs, so they
   all exist in the DOM at once — fine at 58 subjects, and it means a
   half-typed row is still there when you come back to it. */
function bodyHtml() {
    const cur = TABS.indexOf(TAB);

    return `<div class="cb-stage">${TABS.map((t, i) => {
        const cls = i === cur ? 'on' : 'off ' + (i < cur ? 'l' : 'r');
        return `<div class="cb-pane ${cls}" data-pane="${i}">${paneHtml(t)}</div>`;
    }).join('')}</div>`;
}

function sizeStage() {
    const stage = MOUNT?.querySelector('.cb-stage');
    const pane  = MOUNT?.querySelector(`.cb-pane[data-pane="${TABS.indexOf(TAB)}"]`);
    if (stage && pane) stage.style.height = pane.offsetHeight + 'px';
}

/* Slide without repainting. A full render would drop focus and lose any
   half-typed value in the pane being left. */
function showTab(tab) {
    if (tab === TAB) return;

    const from = TABS.indexOf(TAB);
    const to   = TABS.indexOf(tab);
    TAB = tab;

    MOUNT.querySelectorAll('.cb-tab').forEach(b => {
        const raw = b.dataset.tab;
        const v = (raw === 'it' || raw === 'free') ? raw : Number(raw);
        b.classList.toggle('on', v === tab);
    });

    MOUNT.querySelectorAll('.cb-pane').forEach((p, i) => {
        p.className = 'cb-pane ' + (i === to ? 'on' : 'off ' + (i < to ? 'l' : 'r'));
    });

    sizeStage();
}

/* The action bar repaints on every keystroke, so it lives in its own
   function. Leaving it inside render() froze the hint and the Create
   button at whatever they were when the view was first drawn. */
function actionsHtml() {
    const n   = filled().length;
    const bad = badRows().length;

    return `<div class="cb-actions">
        <button id="cb-draft">Save progress</button>
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
    }).join('')
        + `<button class="cb-tab${TAB === 'it' ? ' on' : ''}" data-tab="it">
            IT electives${catalog('IT').length
                ? ` <span class="cb-n">${catalog('IT').length}</span>` : ''}
        </button>`
        + `<button class="cb-tab${TAB === 'free' ? ' on' : ''}" data-tab="free">
            Free electives${catalog('FREE').length
                ? ` <span class="cb-n">${catalog('FREE').length}</span>` : ''}
        </button>`;

    MOUNT.innerHTML = versionHtml()
        + statsHtml()
        + `<div class="cb-tabs">${tabs}</div>`
        + `<div class="cb-body">${bodyHtml()}</div>`
        + actionsHtml();

    sizeStage();
}


/* ---- pre-flight ---- */

/* Row validation catches a bad row. It cannot catch a curriculum that is
   structurally wrong — one subject in one semester passes every row check
   and is not a curriculum.

   Blockers are things that would produce a knowledge base the engine
   cannot reason over. Warnings are things that are legal but usually a
   mistake; the operator acknowledges them and proceeds. Refusing outright
   would be wrong, because a department may deliberately build one year at
   a time, and not every programme runs a summer term. */

const TARGET_UNITS = 176;   // BSIT. Advisory only — other programmes differ.

/* Codes already in the chosen curriculum year. The database has a unique
   constraint on (prospectus_id, code), so a collision fails the whole
   insert with a raw Postgres message. Better to name the offending codes
   before anything is attempted. */
async function existingCodes() {
    if (!OPTS.prospectusId) return new Set();   // a new year holds nothing

    const { data, error } = await SB.from('subject')
        .select('code')
        .eq('prospectus_id', OPTS.prospectusId);

    if (error) {
        console.warn('could not read existing codes:', error.message);
        return null;                            // distinct from "none found"
    }

    return new Set((data ?? []).map(r => String(r.code).toUpperCase()));
}

function preflight(taken) {
    const blockers = [];
    const warnings = [];
    const rows     = filled();

    if (!rows.length) {
        blockers.push('There are no subjects to save.');
        return { blockers, warnings };
    }

    if (!rows.some(r => !r.dbId)) {
        blockers.push('Nothing new to publish \u2014 every subject here is ' +
                      'already in this curriculum year. Edit an existing ' +
                      'subject from the Subjects table below.');
        return { blockers, warnings };
    }

    const bad = badRows().length;
    if (bad) {
        blockers.push(`${bad} row${bad === 1 ? ' has' : 's have'} an unresolved issue.`);
    }

    // A prerequisite pointing at a row that was since deleted would
    // become a rule the engine can never satisfy.
    const live = new Set(rows.map(r => r.uid));
    for (const r of rows) {
        const dangling = r.prereqs.filter(p => p.uid && !live.has(p.uid));
        if (dangling.length) {
            blockers.push(`${r.code || 'A subject'} requires a subject that is no longer in the list.`);
        }
    }

    if (taken === null) {
        warnings.push('Could not check for codes already in this curriculum year.');
    } else if (taken?.size) {
        const clash = rows.filter(r => taken.has(r.code.trim().toUpperCase()))
                          .map(r => r.code.trim().toUpperCase());
        if (clash.length) {
            blockers.push(
                `Already in this curriculum year: ${clash.slice(0, 6).join(', ')}` +
                (clash.length > 6 ? ` and ${clash.length - 6} more.` : '.'));
        }
    }

    const years = [1, 2, 3, 4].filter(y => rows.some(r => r.year === y));

    /* A curriculum is published as a whole. A four-year programme with
       year 3 missing is not a partial curriculum — it is one that would
       tell a student they have nothing to take. Incomplete work belongs
       in Save progress, which is what that button is for. */
    for (const y of [1, 2, 3, 4]) {
        const missing = [1, 2].filter(t => !inCell(y, t).some(r => r.code.trim()));

        if (missing.length === 2) {
            blockers.push(`${YEARS[y]} has no subjects.`);
        } else if (missing.length === 1) {
            blockers.push(`${YEARS[y]} has no ${TERMS[missing[0]].toLowerCase()} subjects.`);
        }
    }

    for (const y of years) {
        for (const t of [1, 2, 3]) {
            const u = inCell(y, t).reduce((a, r) => a + unitsOf(r), 0);
            if (u > HEAVY_TERM) {
                warnings.push(`${YEARS[y]} ${TERMS[t].toLowerCase()} is ${u} units.`);
            }
        }
    }

    const total = scheduled().filter(r => r.code.trim())
                             .reduce((a, r) => a + unitsOf(r), 0);
    if (Math.abs(total - TARGET_UNITS) > 20) {
        warnings.push(`${total} units total, against ${TARGET_UNITS} for a full BSIT curriculum.`);
    }

    for (const [type, label] of [['IT', 'IT'], ['FREE', 'free']]) {
        if (!catalog(type).some(r => r.code.trim())) {
            warnings.push(`No ${label} elective catalogue. Students will see ` +
                          `every ${label} elective as available.`);
        }
    }

    return { blockers, warnings };
}

function confirmCreate(check) {
    const { blockers, warnings } = check;

    const list = (items, cls) => items.map(t =>
        `<li class="${cls}">${esc(t)}</li>`).join('');

    const el = document.createElement('div');
    el.className = 'cbp-overlay';
    el.innerHTML = `
        <div class="cbp-modal cb-confirm" role="dialog" aria-label="Confirm">
            <div class="cbp-bar">
                <div>
                    <p class="cbp-title">${blockers.length ? 'Cannot create yet' : 'Check before creating'}</p>
                    <p class="cbp-sub">${filled().length} subjects \u00b7 ${
                        scheduled().filter(r => r.code.trim())
                                   .reduce((a, r) => a + unitsOf(r), 0)} units scheduled</p>
                </div>
                <button class="cbp-close" aria-label="Close">&times;</button>
            </div>
            <div class="cbp-body">
                ${blockers.length ? `<p class="cb-cf-head bad">Must be fixed</p>
                    <ul class="cb-cf-list">${list(blockers, 'bad')}</ul>` : ''}
                ${warnings.length ? `<p class="cb-cf-head warn">Worth checking</p>
                    <ul class="cb-cf-list">${list(warnings, 'warn')}</ul>` : ''}
                ${!blockers.length && !warnings.length
                    ? '<p class="cb-cf-ok">Nothing looks out of place.</p>' : ''}
            </div>
            <div class="cb-cf-foot">
                <button class="cb-cf-cancel">${blockers.length ? 'Close' : 'Go back'}</button>
                ${blockers.length ? '' :
                    '<button class="btn-primary cb-cf-go">Create curriculum</button>'}
            </div>
        </div>`;

    document.body.appendChild(el);

    const close = () => { el.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);

    el.addEventListener('click', (e) => {
        if (e.target === el || e.target.closest('.cbp-close') || e.target.closest('.cb-cf-cancel')) {
            return close();
        }
        if (e.target.closest('.cb-cf-go')) { close(); commit(); }
    });
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
    MOUNT.addEventListener('change', (e) => {
        const pick = e.target.closest('#cb-version-pick');
        if (!pick) return;

        const year = Number(pick.value);
        if (year === SELECTED_YEAR) return;

        // Rows belong to the version they were entered against, so
        // switching mid-build would file them under the wrong curriculum.
        if (filled().length && !confirm(
            'Switch curriculum year? Subjects entered here will be cleared.')) {
            pick.value = String(SELECTED_YEAR);
            return;
        }

        SELECTED_YEAR = year;
        const known = (OPTS.versions ?? []).find(v => v.academic_year === year);
        OPTS.prospectusId = known?.id ?? null;

        ROWS = [];
        TAB = 1;
        validate();
        render();

        // Show what the year already holds; start empty only if it is new.
        loadExisting(OPTS.prospectusId).then(data => {
            if (data) return applyExisting(data);
            for (let i = 0; i < 3; i++) ROWS.push(blank(1, 1));
            validate();
            render();
        });

        OPTS.onVersionChange?.(OPTS.prospectusId, year);
    });

    MOUNT.addEventListener('click', (e) => {
        const tab = e.target.closest('.cb-tab');
        if (tab) {
            closePicker();
            const v = tab.dataset.tab;
            return showTab(v === 'it' || v === 'free' ? v : Number(v));
        }

        const add = e.target.closest('[data-add]');
        if (add) {
            if (add.disabled) return;
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
            /* One digit, nothing else. Letters, symbols and a second digit
               never reach the field, so the only thing left to validate is
               whether the digit itself is a legal value. */
            const digits = input.value.replace(/\D/g, '').slice(0, 1);
            if (digits !== input.value) input.value = digits;
            row[f] = num(digits);

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
        } else if (f === 'code') {
            /* Uppercase and strip anything a code cannot contain, as it is
               typed. Correcting silently on save would mean the operator
               never sees what was actually stored. */
            const clean = input.value.toUpperCase().replace(/[^A-Z0-9\- ]/g, '');
            if (clean !== input.value) {
                const at = input.selectionStart;
                input.value = clean;
                input.setSelectionRange(at, at);
            }
            row.code = clean;
        } else {
            row[f] = input.value;
        }

        // Revalidate quietly. A full repaint on every keystroke would
        // steal focus mid-word.
        validate();
        tr.classList.toggle('cb-bad', row.errors.length > 0);
        updateStats();
    });

    MOUNT.addEventListener('keydown', (e) => {
        const cell = e.target.closest('.cb-chips');
        if (!cell || (e.key !== 'Enter' && e.key !== ' ')) return;
        e.preventDefault();
        const pick = cell.closest('.cb-pick');
        const row  = ROWS.find(r => r.uid === Number(pick?.dataset.uid));
        if (row) openPicker(row, pick);
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
    /* Rows loaded from an existing year carry dbId and are already stored.
       Re-inserting them would collide with the unique code constraint. */
    return filled().filter(r => !r.dbId).map(r => ({
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
        elective_type: r.electiveType
            ?? (/^IT-FRE/.test(r.code.trim().toUpperCase()) ? 'FREE'
              : /^IT-EL/.test(r.code.trim().toUpperCase())  ? 'IT'
              : null),
    }));
}

async function saveDraft() {
    if (!filled().length) {
        return OPTS.onError?.('Nothing to save yet \u2014 add a subject first.');
    }

    /* One batch per curriculum year per person. Held at module level
       because OPTS is replaced on every re-mount, which is why earlier
       saves left a new batch behind each time. */
    DRAFT_BATCH = DRAFT_BATCH ?? (crypto.randomUUID
        ? crypto.randomUUID()
        : String(Date.now()) + Math.random().toString(16).slice(2));

    const rows = filled();

    const subjects = rows.map((r, i) => ({
        batch_id:    DRAFT_BATCH,
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

    /* Prerequisites go to stg_prerequisite by CODE, not id — the subjects
       do not exist yet, so there is nothing to point at. Saving subjects
       without these would lose every rule the operator picked. */
    const rules = [];
    rows.forEach((r, i) => {
        r.prereqs.forEach((p, g) => {
            const target = p.uid ? ROWS.find(x => x.uid === p.uid) : null;
            rules.push({
                batch_id:          DRAFT_BATCH,
                uploaded_by:       OPTS.userId,
                row_number:        i + 1,
                subject_code:      r.code.trim().toUpperCase(),
                prerequisite_code: target ? target.code.trim().toUpperCase() : null,
                requirement_type:  p.standing ? 'standing' : 'prerequisite',
                rule_type:         'and',
                rule_group:        g + 1,
                threshold_value:   p.standing ?? null,
                validation_status: 'ok',
            });
        });
    });

    await SB.from('stg_subject').delete().eq('batch_id', DRAFT_BATCH);
    await SB.from('stg_prerequisite').delete().eq('batch_id', DRAFT_BATCH);

    const a = await SB.from('stg_subject').insert(subjects);
    if (a.error) {
        console.error('draft subjects failed:', a.error.message);
        return OPTS.onError?.('Could not save the draft. ' + a.error.message);
    }

    if (rules.length) {
        const b = await SB.from('stg_prerequisite').insert(rules);
        if (b.error) {
            console.error('draft rules failed:', b.error.message);
            return OPTS.onError?.(
                `Subjects saved but the ${rules.length} prerequisites did not. ` +
                b.error.message);
        }
    }

    /* "Draft" collided with a draft prospectus — a version row that is not
       yet active. This is neither: the subjects have not been created, so
       nothing appears in the Prospectus view until Create curriculum is
       pressed. Say so, or the next person looks for them there. */
    OPTS.onDone?.(
        `Progress saved \u2014 ${subjects.length} subjects, ${rules.length} rule` +
        `${rules.length === 1 ? '' : 's'}. Not published yet: reopen this page ` +
        'to carry on, then Create curriculum to publish it.');
}


/* Load a curriculum year that already holds subjects, so selecting it
   shows what is there rather than an empty table. Without this the
   builder could only ever add to a year, never see it. */
async function loadExisting(prospectusId) {
    if (!prospectusId) return null;

    const [subs, rules] = await Promise.all([
        SB.from('subject')
            .select('id, code, title, lec_units, lab_units, year_level, term, elective_type')
            .eq('prospectus_id', prospectusId)
            .eq('is_active', true)
            .order('year_level').order('term').order('code'),
        SB.from('prerequisite')
            .select('subject_id, prerequisite_subject_id, requirement_type, threshold_value, rule_group'),
    ]);

    if (subs.error) { console.warn('load failed:', subs.error.message); return null; }
    if (!subs.data?.length) return null;

    const ids = new Set(subs.data.map(r => r.id));

    return {
        subjects: subs.data,
        rules: (rules.data ?? []).filter(r => ids.has(r.subject_id)),
    };
}

/* Existing rows come back with their database id, so a later save can
   tell an edit from an insert. */
function applyExisting(data) {
    ROWS = [];
    SEQ  = 1;

    const byId = new Map();

    for (const r of data.subjects) {
        const row = blank(r.year_level, r.term);
        row.code       = String(r.code ?? '').toUpperCase();
        row.title      = r.title ?? '';
        row.lec        = r.lec_units == null ? null : Number(r.lec_units);
        row.lab          = Number(r.lab_units) || null;
        row.labTouched   = true;
        row.electiveType = r.elective_type ?? null;
        row.dbId         = r.id;        // marks this row as already saved

        ROWS.push(row);
        byId.set(r.id, row);
    }

    for (const rule of data.rules) {
        const owner = byId.get(rule.subject_id);
        if (!owner) continue;

        if (rule.requirement_type === 'standing') {
            owner.prereqs.push({ standing: Number(rule.threshold_value) || 2 });
        } else {
            const target = byId.get(rule.prerequisite_subject_id);
            if (target) owner.prereqs.push({ uid: target.uid });
        }
    }

    validate();
    render();
}


/* Read the most recent draft back into the builder. Without this the
   rows are written and unreachable, which is worse than not saving. */
async function loadDraft() {
    if (!OPTS.userId) return null;

    const { data: subs, error } = await SB.from('stg_subject')
        .select('batch_id, row_number, code, title, units, year_level, term, uploaded_at')
        .eq('uploaded_by', OPTS.userId)
        .not('batch_id', 'is', null)
        .order('uploaded_at', { ascending: false })
        .order('row_number', { ascending: true });

    if (error) { console.warn('draft load failed:', error.message); return null; }
    if (!subs?.length) return null;

    const batch = subs[0].batch_id;
    const mine  = subs.filter(r => r.batch_id === batch);

    const { data: rules } = await SB.from('stg_prerequisite')
        .select('subject_code, prerequisite_code, requirement_type, threshold_value, rule_group')
        .eq('batch_id', batch);

    return { batch, subjects: mine, rules: rules ?? [] };
}

function applyDraft(draft) {
    ROWS = [];
    SEQ  = 1;

    const byCode = new Map();
    for (const r of draft.subjects) {
        const row = blank(r.year_level, r.term);
        row.code  = String(r.code ?? '').toUpperCase();
        row.title = r.title ?? '';

        // stg_subject holds total units only; split it the way the builder
        // would have, and let the operator correct anything unusual.
        const u = Number(r.units || 0);
        row.lec = u === 3 ? 2 : u;
        row.lab = u === 3 ? 1 : null;
        row.labTouched = true;

        ROWS.push(row);
        byCode.set(row.code, row);
    }

    for (const rule of draft.rules) {
        const owner = byCode.get(String(rule.subject_code ?? '').toUpperCase());
        if (!owner) continue;

        if (rule.requirement_type === 'standing') {
            owner.prereqs.push({ standing: Number(rule.threshold_value) || 2 });
        } else {
            const target = byCode.get(String(rule.prerequisite_code ?? '').toUpperCase());
            if (target) owner.prereqs.push({ uid: target.uid });
        }
    }

    DRAFT_BATCH = draft.batch;
    validate();
    render();
}


/* The button opens the pre-flight; commit() below does the writing, and
   is only reachable once the operator has seen what the check found.
   Codes are compared against the chosen curriculum year first, because a
   collision there fails the whole insert with a raw Postgres message. */
async function create() {
    const btn = MOUNT.querySelector('#cb-create');
    if (btn) { btn.disabled = true; btn.textContent = 'Checking\u2026'; }

    const taken = await existingCodes();

    if (btn) { btn.disabled = false; btn.textContent = 'Create curriculum'; }

    confirmCreate(preflight(taken));
}


async function commit() {
    if (badRows().length || !filled().length) return;

    const btn = MOUNT.querySelector('#cb-create');
    if (btn) { btn.disabled = true; btn.textContent = 'Creating\u2026'; }

    // A year with no prospectus row yet gets one now, as a draft. Never
    // active: making a curriculum live is a separate, deliberate act.
    if (!OPTS.prospectusId) {
        const { data, error } = await SB.from('prospectus')
            .insert({
                program_id:    OPTS.programId,
                academic_year: SELECTED_YEAR,
                academic_term: 1,
                is_active:     false,
                created_by:    OPTS.staffId,
            })
            .select('id, academic_year, is_active')
            .single();

        if (error) {
            console.error('prospectus insert failed:', error.message);
            if (btn) { btn.disabled = false; btn.textContent = 'Create curriculum'; }
            return OPTS.onError?.('Could not create the curriculum year. ' + error.message);
        }

        OPTS.prospectusId = data.id;
        OPTS.versions = [...(OPTS.versions ?? []), data];
    }

    const { data, error } = await SB.from('subject')
        .insert(toSubjectRows()).select('id, code');

    if (error) {
        console.error('subject insert failed:', error.message);
        if (btn) { btn.disabled = false; btn.textContent = 'Create curriculum'; }

        // The pre-flight checks codes first, so this is either a race or a
        // constraint the check does not cover. Say which in plain terms.
        /* Postgres names the offending value in error.details, e.g.
           "Key (prospectus_id, code)=(7, IT-EL) already exists." Showing
           the constraint name alone leaves the operator hunting. */
        let msg = 'Could not create the curriculum. ' + error.message;

        if (/subject_prospectus_id_code_key|duplicate key/.test(error.message)) {
            const hit = /=\(\s*\d+\s*,\s*([^)]+)\)/.exec(error.details ?? '');
            msg = hit
                ? `The code ${hit[1].trim()} appears more than once. Every subject ` +
                  'in a curriculum year needs its own code — elective slots included.'
                : 'Two subjects share a code. Every subject in a curriculum year ' +
                  'needs its own code — elective slots included.';
        }

        return OPTS.onError?.(msg);
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

    // The draft has become a curriculum; it should not be offered again.
    if (DRAFT_BATCH) {
        await SB.from('stg_prerequisite').delete().eq('batch_id', DRAFT_BATCH);
        await SB.from('stg_subject').delete().eq('batch_id', DRAFT_BATCH);
        DRAFT_BATCH = null;
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
        window.addEventListener('resize', sizeStage);
        MOUNT.dataset.bound = '1';
    }

    /* Keep the chosen year across a re-mount. loadCurriculum() remounts
       the builder, and mount() replaces OPTS wholesale — so both the year
       AND the prospectus id have to be restored here.

       Restoring only the year was worse than restoring neither: the banner
       showed the year the operator picked while prospectusId silently
       reverted to the caller's active version, so subjects were written to
       the live curriculum under another year's name. */
    if (SELECTED_YEAR === null) {
        const current = (OPTS.versions ?? []).find(v => v.id === OPTS.prospectusId);
        SELECTED_YEAR = current?.academic_year ?? new Date().getFullYear();
    } else {
        const chosen = (OPTS.versions ?? []).find(v => v.academic_year === SELECTED_YEAR);
        // null is correct for a year with no prospectus row yet — commit()
        // creates one. What must not happen is falling back to the caller's id.
        OPTS.prospectusId = chosen?.id ?? null;
    }

    if (!OPTS.versions?.length) {
        console.warn('CurriculumBuilder: no versions passed — every year will show as New');
    }

    if (!ROWS.length) {
        // Start with a few empty rows so the table is not a blank slab.
        for (let i = 0; i < 3; i++) ROWS.push(blank(1, 1));
    }

    validate();
    render();

    // Offer the last draft once per mount, and only when the table is
    // empty — never overwrite work in progress.
    if (!DRAFT_BATCH) {
        loadDraft().then(draft => {
            if (!draft || filled().length) return;

            const when = draft.subjects[0]?.uploaded_at
                ? new Date(draft.subjects[0].uploaded_at).toLocaleString()
                : 'earlier';

            if (confirm(
                `Carry on from ${when}? ` +
                `${draft.subjects.length} subjects, ${draft.rules.length} rule` +
                `${draft.rules.length === 1 ? '' : 's'} unpublished.`)) {
                applyDraft(draft);
            }
        });
    }
}

window.CurriculumBuilder = {
    mount,
    reset: () => { ROWS = []; SEQ = 1; SELECTED_YEAR = null; render(); },
};

})();