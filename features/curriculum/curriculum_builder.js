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
let PENDING_AI_FILE = null;
let PROGRESS_TIMER  = null;
let PROGRESS_VALUE  = 0;

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
    /* Un-numbered IT-EL / IT-FRE placeholders are exempt from the
       duplicate check. Several slots share the same base code by
       design — that is the whole point of a placeholder — and
       normalizeElectiveCodes() gives each its own numbered code
       before the payload reaches the database. Without this exemption
       the Create button stays disabled by its own validation, and the
       numbering routine that would resolve the clash never runs. */
    const isPlaceholder = /^IT-(EL|FRE)$/.test(code);

    if (!isPlaceholder) {
        if (seen.has(code)) r.errors.push('This code is already used.');
        else seen.set(code, code);
    }
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


function yearOptions() {
    const list = OPTS.versions ?? [];
    const now = new Date().getFullYear();
    
    // Build map of existing years with their ACTUAL database status
    const known = new Map(list.map(v => [v.academic_year, v]));
    
    // Determine which years to show
    const years = new Map();
    
    // Generate future years (current + 5 years ahead)
    for (let y = now - 1; y <= now + 5; y++) {
        const existing = known.get(y);
        const isNew = existing === undefined;
        const isDraft = existing !== undefined && !existing.is_active;
        const isActive = existing?.is_active || false;
        
        // ⭐ Build label based on ACTUAL database status
        let label = `${y}–${y + 1}`;
        if (isActive) {
            label += ' · Active';
        } else if (isDraft) {
            label += ' · Draft';
        } else {
            label += ' · New';
        }
        
        years.set(y, {
            year: y,
            id: existing?.id ?? null,
            is_active: isActive,
            is_draft: isDraft,
            is_new: isNew,
            label: label,
        });
    }
    
    // Check for any draft years outside our range
    const result = [];
    for (const [year, data] of years) {
        // Skip Active years (they shouldn't be editable)
        if (data.is_active) continue;
        result.push(data);
    }
    
    // Add any existing draft years outside our generated range
    for (const v of list) {
        if (!years.has(v.academic_year) && !v.is_active) {
            result.push({
                year: v.academic_year,
                id: v.id,
                is_active: false,
                is_draft: true,
                is_new: false,
                label: `${v.academic_year}–${v.academic_year + 1} · Draft`,
            });
        }
    }
    
    // Sort: newest first, with Drafts showing before New
    result.sort((a, b) => {
        // Draft years come before New years
        if (a.is_draft && b.is_new) return -1;
        if (a.is_new && b.is_draft) return 1;
        // Otherwise sort by year (newest first)
        return b.year - a.year;
    });
    
    return result;
}

function showCustomYearInput() {
    // Create overlay for custom year input
    const overlay = document.createElement('div');
    overlay.className = 'cbp-overlay';
    overlay.innerHTML = `
        <div class="cbp-modal" role="dialog" aria-label="Add custom year">
            <div class="cbp-bar">
                <div>
                    <p class="cbp-title">Add Custom Academic Year</p>
                    <p class="cbp-sub">Enter a new academic year that isn't already in use.</p>
                </div>
                <button class="cbp-close" aria-label="Close">&times;</button>
            </div>
            <div class="cbp-body">
                <div class="field" style="margin-bottom: var(--s3);">
                    <label for="custom-year-input" style="display: block; font-weight: 600; margin-bottom: 0.35rem;">
                        Academic Year (YYYY)
                    </label>
                    <input type="number" id="custom-year-input" 
                           min="2000" max="2100" step="1"
                           placeholder="e.g., 2027"
                           style="width: 100%; padding: 0.7rem; border: 1.5px solid var(--line); border-radius: 8px; font-size: 0.95rem;">
                    <p id="custom-year-error" style="color: #dc2626; font-size: 0.85rem; margin-top: 0.35rem; display: none;"></p>
                </div>
            </div>
            <div class="cb-cf-foot" style="display: flex; gap: var(--s2); justify-content: flex-end; padding-top: var(--s3); border-top: 1px solid var(--line);">
                <button class="cb-cf-cancel" style="padding: 0.5rem 1.2rem;">Cancel</button>
                <button class="btn-primary" id="confirm-custom-year" style="padding: 0.5rem 1.2rem;">
                    <i class="fa-solid fa-plus"></i> Add Year
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    const close = () => {
        overlay.remove();
        document.removeEventListener('keydown', onKey);
    };

    const onKey = (e) => {
        if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);

    // Focus the input
    const input = overlay.querySelector('#custom-year-input');
    const error = overlay.querySelector('#custom-year-error');
    setTimeout(() => input?.focus(), 100);

    // Close handlers
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay || e.target.closest('.cbp-close') || e.target.closest('.cb-cf-cancel')) {
            close();
        }
    });

    // Confirm handler
    overlay.querySelector('#confirm-custom-year')?.addEventListener('click', async () => {
        const year = Number(input?.value?.trim());
        error.style.display = 'none';

        // Validate
        if (!year || year < 2000 || year > 2100) {
            error.textContent = 'Please enter a valid year between 2000 and 2100.';
            error.style.display = 'block';
            return;
        }

        // Check if year already exists
        const existing = (OPTS.versions ?? []).find(v => v.academic_year === year);
        if (existing) {
            error.textContent = `Year ${year} already exists as ${existing.is_active ? 'Active' : 'Draft'}.`;
            error.style.display = 'block';
            return;
        }

        close();

        // Create the new prospectus
        const { data, error: insertError } = await SB.from('prospectus')
            .insert({
                program_id: OPTS.programId || 1,
                academic_year: year,
                academic_term: 1,
                is_active: false,
                created_by: OPTS.staffId,
            })
            .select('id, academic_year, is_active')
            .single();

        if (insertError) {
            console.error('Failed to create custom year:', insertError.message);
            OPTS.onError?.('Could not create the custom year. ' + insertError.message);
            return;
        }

        // Update versions
        const newVersion = {
            id: data.id,
            academic_year: data.academic_year,
            is_active: false,
            subject_count: 0,
            student_count: 0,
        };
        OPTS.versions = [...(OPTS.versions ?? []), newVersion];

        // ⭐ FIX: Refresh version status to ensure "Draft" shows correctly
        refreshVersionStatus();

        // Select the new year
        SELECTED_YEAR = year;
        OPTS.prospectusId = data.id;

        // Clear existing rows (start fresh for new year)
        ROWS = [];
        for (let i = 0; i < 3; i++) ROWS.push(blank(1, 1));
        validate();

        // Re-render
        render();

        // Notify parent
        if (OPTS.onVersionChange) {
            OPTS.onVersionChange(OPTS.prospectusId, year);
        }

        OPTS.onDone?.(`Academic year ${year} created as a draft. Add subjects to get started.`);
            });
}

function versionHtml() {
    const opts = yearOptions();
    const sel = SELECTED_YEAR;

    // Check if the selected year is active (should not happen)
    const isActive = (OPTS.versions ?? []).find(v => v.academic_year === sel)?.is_active;
    if (isActive) {
        // If somehow the selected year is active, reset to null (Select Year)
        SELECTED_YEAR = null;
        OPTS.prospectusId = null;
    }

    // Build options HTML with "Select Year" as default
    let optionsHtml = `<option value="">Select Year</option>`;
    
    optionsHtml += opts.map(o => {
        const isSelected = o.year === sel;
        const disabled = o.is_active; // Active years are disabled
        return `<option value="${o.year}" ${isSelected ? 'selected' : ''} ${disabled ? 'disabled style="color: #94a3b8;"' : ''}>
            ${o.label}
        </option>`;
    }).join('');

    // Only show custom year option if a year is selected
    return `<div class="cb-version">
        <div>
            <p class="k">Curriculum year</p>
            <p class="v">${sel ? `${sel}–${sel + 1}` : '—'}</p>
        </div>
        <div style="display: flex; gap: var(--s2); align-items: center;">
            <select id="cb-version-pick" aria-label="Select curriculum year" style="flex: 1;" value="${sel || ''}">
                ${optionsHtml}
                ${sel ? '<option value="__custom__">+ Add custom year…</option>' : ''}
            </select>
        </div>
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
    const hasExisting = filled().some(r => r.dbId);

    // Create Curriculum must stay available even when every row was
    // already saved by Save (unpublished) -- "already saved to the
    // table" and "already published" are different things. Previously
    // this button was replaced outright by a checkmark once hasExisting
    // was true, meaning a fully-drafted curriculum had no way to ever
    // reach the publish step: selecting an existing draft year and
    // trying to publish it left nothing clickable at all.
    return `<div class="cb-actions">
        <button id="cb-draft" ${!n ? 'disabled' : ''}>Save (unpublished)</button>
        <button class="btn-primary" id="cb-create" ${bad || !n ? 'disabled' : ''}>
            Create curriculum
        </button>
        <button id="cb-preview" ${!n ? 'disabled' : ''}>Preview</button>
        <span class="cb-hint">${
            !n ? 'Add at least one subject'
            : bad ? `Fix ${bad} issue${bad === 1 ? '' : 's'}`
            : hasExisting ? `${n} subject${n === 1 ? '' : 's'} saved \u2014 ready to publish`
            : 'Ready'
        }</span>
    </div>`;
}

/* Sits above the manual editing area. Uploading a PDF here populates
   ROWS the same way the manual "+ Add subject" flow does -- nothing
   is treated as trusted until the staff member reviews it below and
   presses Create. */
/* AI upload card. Rendered from PENDING_AI_FILE so it survives any
   render() call elsewhere in the builder (adding a row, switching tabs)
   without losing the operator's file selection. */
function aiUploadHtml() {
    const hasFile = !!PENDING_AI_FILE;

    return `<div class="cb-ai-upload">
        <div class="cb-ai-head">
            <div>
                <strong>AI-assisted curriculum upload</strong>
                <span class="cb-dim">Extract subjects from a curriculum or prospectus PDF.</span>
            </div>
            ${hasFile ? `<button class="cb-ai-icon-btn" id="ai-close" aria-label="Cancel">
                <i class="fa-solid fa-xmark"></i>
            </button>` : ''}
        </div>

        ${hasFile ? `
            <div class="cb-ai-card">
                <div class="cb-ai-file-icon">
                    <i class="fa-solid fa-file-pdf"></i>
                    <span>PDF</span>
                </div>
                <div class="cb-ai-file-meta">
                    <p class="cb-ai-file-name">${esc(PENDING_AI_FILE.name)}</p>
                    <p class="cb-ai-file-size">${formatBytes(PENDING_AI_FILE.size)}</p>
                </div>
                <button class="cb-ai-icon-btn" id="ai-trash" aria-label="Remove file">
                    <i class="fa-solid fa-trash-can"></i>
                </button>
                <div class="cb-ai-progress" id="ai-progress" hidden>
                    <div class="cb-ai-progress-pct" id="ai-progress-pct">0%</div>
                    <div class="cb-ai-progress-track">
                        <div class="cb-ai-progress-fill" id="ai-progress-fill" style="width:0%"></div>
                    </div>
                </div>
            </div>
        ` : `
            <label class="cb-ai-drop" for="ai-document-input">
                <i class="fa-solid fa-file-arrow-up" aria-hidden="true"></i>
                <span>Choose a PDF</span>
                <input type="file" id="ai-document-input" accept="application/pdf" hidden>
            </label>
        `}

        <div id="ai-analyze-status" class="msg" role="status"></div>

        ${hasFile ? `
            <div class="cb-ai-actions">
                <button class="btn-primary" id="ai-extract">Extract Subjects</button>
            </div>
        ` : ''}
    </div>`;
}

function formatBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
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
        + aiUploadHtml()
        + statsHtml()
        + `<div class="cb-tabs">${tabs}</div>`
        + `<div class="cb-body">${bodyHtml()}</div>`
        + actionsHtml();

    sizeStage();
}

function refreshVersionStatus() {
    if (!OPTS.versions || !OPTS.versions.length) return;
    
    // Fetch fresh status for all versions
    const versionIds = OPTS.versions.map(v => v.id).filter(id => id !== null);
    if (!versionIds.length) return;
    
    SB.from('prospectus')
        .select('id, is_active, published_at')
        .in('id', versionIds)
        .then(({ data, error }) => {
            if (error) {
                console.warn('Failed to refresh version status:', error.message);
                return;
            }
            
            // Update OPTS.versions with fresh status
            for (const fresh of data) {
                const idx = OPTS.versions.findIndex(v => v.id === fresh.id);
                if (idx !== -1) {
                    OPTS.versions[idx].is_active = fresh.is_active;
                    OPTS.versions[idx].published_at = fresh.published_at;
                }
            }
            
            // Re-render to show updated statuses
            render();
        });
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

    // NOTE: previously this blocked Create Curriculum outright once every
    // row already had a dbId (i.e. Save (unpublished) had already saved them
    // as a draft). That conflated "nothing new to INSERT" with "nothing
    // left to DO" -- a fully saved draft still needs Create Curriculum to
    // actually finalize it, so blocking here left no way to move a fully-
    // drafted curriculum forward at all. toSubjectRows() already correctly
    // skips rows with a dbId on insert, so re-running Create after Save
    // Progress is safe -- it simply has zero new rows to add and proceeds.

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

/* AI-assisted extraction. Uploads a PDF to the analyze-curriculum-
   document Edge Function, which sends it to Gemini and returns either
   a rejection (not a curriculum document) or structured subject rows.
   Extracted rows are placed into ROWS exactly like a manually-typed
   row would be -- same shape, same validation, same review table,
   same Save/Create path. Nothing here writes to Supabase directly;
   the staff member must still press Create to commit anything. */

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            // FileReader gives a data: URL; the Edge Function wants the
            // base64 payload alone, after the comma.
            const result = reader.result;
            const base64 = result.substring(result.indexOf(',') + 1);
            resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

async function analyzeDocument(file) {
    if (!file) return;

    if (file.type !== 'application/pdf') {
        return showAiStatus('Please upload a PDF file.', 'error');
    }

    showAiStatus('Reading document\u2026');
    startProgress();

    let base64;
    try {
        base64 = await fileToBase64(file);
    } catch (err) {
        console.error('file read failed:', err);
        stopProgress();
        return showAiStatus('Could not read that file.', 'error');
    }

    showAiStatus('Analyzing with AI\u2026 this can take a moment.');

    const { data, error } = await SB.functions.invoke('analyze-curriculum-document', {
        body: { fileBase64: base64, mimeType: 'application/pdf' },
    });

    if (error) {
        console.error('analyze-curriculum-document failed:', error);
        stopProgress();
        return showAiStatus('The analysis service failed. Try again in a moment.', 'error');
    }

    if (!data || data.is_curriculum_document !== true) {
        const reason = data?.rejection_reason || 'This does not appear to be a curriculum or prospectus document.';
        stopProgress();
        return showAiStatus('Rejected: ' + reason, 'error');
    }

    const extracted = Array.isArray(data.subjects) ? data.subjects : [];

    if (!extracted.length) {
        stopProgress();
        return showAiStatus('The document was recognized as a curriculum, but no subjects could be extracted. You can still enter them manually below.', 'error');
    }

    // Build every row first, keyed by the code the AI extracted, so
    // prerequisites (which the AI returns as code strings) can be
    // resolved to the correct row's internal uid in a second pass --
    // prereqs are stored as { uid }, not as codes, and a row's uid does
    // not exist until the row itself has been created.
    ROWS = [];
    const byCode = new Map();

    for (const item of extracted) {
        const year = item.year_level ?? null;
        const term = item.term ?? null;

        // Catalogue entries (electives) have no year and no term. They must
        // carry an elective_type or they show up in neither the IT electives
        // nor the Free electives tab -- catalog() filters on
        // r.electiveType === 'IT' or 'FREE', and null falls through both.
        let electiveType = null;
        if (year === null && term === null) {
            if (item.elective_type === 'IT' || item.elective_type === 'FREE') {
                electiveType = item.elective_type;
            } else {
                // Fall back to code prefix if the AI didn't return a type.
                // This prospectus uses EL* for IT electives and FRE* for
                // free electives; adjust the patterns if your naming differs.
                const code = String(item.code ?? '').toUpperCase();
                if (/^IT-FRE|^FRE/.test(code))      electiveType = 'FREE';
                else if (/^IT-EL|^EL/.test(code))   electiveType = 'IT';
            }
        }

        const row = blank(year, term, electiveType);
        row.code  = String(item.code ?? '').trim().toUpperCase();
        row.title = String(item.title ?? '').trim();
        row.lec   = Number.isFinite(item.lecture_units) ? item.lecture_units : null;
        row.lab   = Number.isFinite(item.laboratory_units) ? item.laboratory_units : null;
        row._aiPrereqCodes = Array.isArray(item.prerequisites) ? item.prerequisites : [];
        ROWS.push(row);
        if (row.code) byCode.set(row.code, row);
    }

    for (const row of ROWS) {
        for (const prereqCode of row._aiPrereqCodes) {
            const target = byCode.get(String(prereqCode).trim().toUpperCase());
            // A prerequisite the AI named but that does not match any
            // extracted subject is dropped rather than guessed at -- the
            // reviewer sees the row with that prerequisite simply absent
            // and can add it manually via the existing picker if needed.
            if (target) row.prereqs.push({ uid: target.uid });
        }
        delete row._aiPrereqCodes;
    }

    TAB = ROWS.find(r => r.year)?.year ?? 1;

    // Bar hits 100% and holds for a beat so the operator actually sees it
    // complete before the card resets to the empty drop zone. Without the
    // delay, render() replaces the bar in the same tick and 100% never
    // appears on screen.
    finishProgress();

    setTimeout(() => {
        PENDING_AI_FILE = null;
        validate();
        render();

        // showAiStatus re-queries #ai-analyze-status on every call, so it
        // lands on the element inside the freshly-rendered card. The old
        // version captured the element once at function entry, and by this
        // point it was already detached from the DOM -- the message was
        // written into nothing.
        showAiStatus(
            `Extracted ${extracted.length} subject${extracted.length === 1 ? '' : 's'}. `
            + 'Review every row below, then press Create to save \u2014 nothing has been saved yet.',
            'success',
        );
    }, 500);
}

function showAiStatus(msg, cls) {
    const el = document.getElementById('ai-analyze-status');
    if (!el) return;
    el.textContent = msg;
    el.className = 'msg' + (cls ? ' ' + cls : '');
}

function clearAiFile() {
    PENDING_AI_FILE = null;
    stopProgress();
    render();
}

function startProgress() {
    const bar  = document.getElementById('ai-progress');
    const fill = document.getElementById('ai-progress-fill');
    const pct  = document.getElementById('ai-progress-pct');
    if (!bar || !fill || !pct) return;

    bar.hidden = false;
    PROGRESS_VALUE = 0;
    const t0 = Date.now();

    /* Time-calibrated estimate, not a measurement. Gemini returns one
       response when it finishes; there is no per-chunk signal to read.
       The curve below is fitted to the observed pace of the 58-subject
       prospectus PDFs:
         0-2s   → fast   (upload + server receipt)
         2-8s   → steady (Gemini reading the document)
         8-15s  → slow   (Gemini composing the JSON)
         15s+   → creep  (bounded at 95 until the real response arrives)
       It is monotonic, never reads 100 before the data lands, and
       stays alive if the analysis runs long. */
    PROGRESS_TIMER = setInterval(() => {
        const elapsed = (Date.now() - t0) / 1000;
        let next;

        if (elapsed < 2)       next = elapsed * 10;                 // 0  → 20
        else if (elapsed < 8)  next = 20 + (elapsed - 2) * 6;       // 20 → 56
        else if (elapsed < 15) next = 56 + (elapsed - 8) * 3;       // 56 → 77
        else                   next = 77 + (elapsed - 15) * 1.2;    // slow creep

        PROGRESS_VALUE = Math.min(next, 95);   // never hit 100 until done

        fill.style.width = PROGRESS_VALUE.toFixed(1) + '%';
        pct.textContent  = Math.round(PROGRESS_VALUE) + '%';
    }, 100);
}
function finishProgress() {
    if (PROGRESS_TIMER) { clearInterval(PROGRESS_TIMER); PROGRESS_TIMER = null; }
    const fill = document.getElementById('ai-progress-fill');
    const pct  = document.getElementById('ai-progress-pct');
    if (fill) fill.style.width = '100%';
    if (pct)  pct.textContent = '100%';
}

function stopProgress() {
    if (PROGRESS_TIMER) { clearInterval(PROGRESS_TIMER); PROGRESS_TIMER = null; }
}

function runAiExtraction() {
    if (!PENDING_AI_FILE) return;
    analyzeDocument(PENDING_AI_FILE);
}

function bind() {
    MOUNT.addEventListener('change', (e) => {

        // AI document upload. Only this input fires change -- the trash,
        // close, and extract buttons all fire click and live in the click
        // handler below. Putting them here meant nothing happened when
        // they were pressed, because a button never emits 'change'.
        if (e.target.id === 'ai-document-input') {
            const file = e.target.files?.[0];
            e.target.value = '';   // allow re-selecting the same file later
            if (!file) return;
            if (file.type !== 'application/pdf') {
                return showAiStatus('Only PDF files are supported.', 'error');
            }
            PENDING_AI_FILE = file;
            render();              // rebuilds the card so it shows the file
            return;
        }

        const pick = e.target.closest('#cb-version-pick');
        if (!pick) return;

        // Handle "Select Year" (empty value)
        if (pick.value === '') {
            SELECTED_YEAR = null;
            OPTS.prospectusId = null;
            ROWS = [];
            for (let i = 0; i < 3; i++) ROWS.push(blank(1, 1));
            TAB = 1;
            validate();
            render();
            if (OPTS.onVersionChange) {
                OPTS.onVersionChange(null, null);
            }
            return;
        }

        // Handle custom year selection
        if (pick.value === '__custom__') {
            const prevYear = SELECTED_YEAR;
            pick.value = prevYear ? String(prevYear) : '';
            showCustomYearInput();
            return;
        }

        const year = Number(pick.value);
        if (year === SELECTED_YEAR) return;

        const isActive = (OPTS.versions ?? []).find(v => v.academic_year === year)?.is_active;
        if (isActive) {
            OPTS.onError?.('Cannot edit an active curriculum. Please select a draft or new year.');
            pick.value = SELECTED_YEAR ? String(SELECTED_YEAR) : '';
            return;
        }

        // Unsaved changes prompt before switching
        if (filled().length && SELECTED_YEAR !== null && !confirm(
            'Switch curriculum year? Unsaved subjects entered here will be cleared.')) {
            pick.value = SELECTED_YEAR ? String(SELECTED_YEAR) : '';
            return;
        }

        SELECTED_YEAR = year;
        const known = (OPTS.versions ?? []).find(v => v.academic_year === year);
        OPTS.prospectusId = known?.id ?? null;

        ROWS = [];
        for (let i = 0; i < 3; i++) ROWS.push(blank(1, 1));
        TAB = 1;
        validate();

        if (OPTS.prospectusId) {
            loadExisting(OPTS.prospectusId).then(data => {
                if (data) {
                    applyExisting(data);
                } else {
                    render();
                }
            });
        } else {
            render();
        }

        OPTS.onVersionChange?.(OPTS.prospectusId, year);
    });

    /* Typing into a row's code/title/lec/lab field must reach ROWS or
       the next render() wipes what the operator typed. Only the row
       being edited is repainted, so focus is not lost mid-word. */
    MOUNT.addEventListener('input', (e) => {
        const field = e.target.closest('input[data-f]');
        if (!field) return;

        const tr = field.closest('tr[data-uid]');
        if (!tr) return;

        const row = ROWS.find(r => r.uid === Number(tr.dataset.uid));
        if (!row) return;

        const key = field.dataset.f;

        if (key === 'lec' || key === 'lab') {
            const digits = field.value.replace(/[^0-9]/g, '').slice(0, 1);
            if (field.value !== digits) field.value = digits;
            row[key] = digits === '' ? null : Number(digits);

            if (key === 'lab') {
                // Operator typed a lab value directly — stop the
                // lec-driven suggestion from overwriting it.
                row.labTouched = true;
            }

            if (key === 'lec' && !row.labTouched) {
                if (row.lec === 2) row.lab = 1;
                else if (row.lec === 3) row.lab = null;

                const labField = tr.querySelector('input[data-f="lab"]');
                if (labField) labField.value = row.lab ?? '';
            }
        } else {
            row[key] = field.value;
        }

        validate();

        tr.classList.toggle('cb-bad', row.errors.length > 0);

        const total = tr.querySelector('.cb-total');
        if (total) total.textContent = unitsOf(row) || '';

        const stats = MOUNT.querySelector('.cb-stats');
        if (stats) stats.outerHTML = statsHtml();

        const actions = MOUNT.querySelector('.cb-actions');
        if (actions) actions.outerHTML = actionsHtml();
    });

    MOUNT.addEventListener('click', (e) => {

        /* AI upload actions. These are buttons, so they fire click --
           putting them in the change handler above meant nothing
           happened when they were pressed. */
        if (e.target.closest('#ai-trash') || e.target.closest('#ai-close')) {
            clearAiFile();
            return;
        }
        if (e.target.closest('#ai-extract')) {
            return runAiExtraction();
        }

        const tab = e.target.closest('.cb-tab');
        if (tab) {
            closePicker();
            const v = tab.dataset.tab;
            return showTab(v === 'it' || v === 'free' ? v : Number(v));
        }

        const add = e.target.closest('[data-add]');
        if (add) {
            const [y, t] = add.dataset.add.split('-');
            ROWS.push(
                y === 'it'   ? blank(null, null, 'IT')
              : y === 'free' ? blank(null, null, 'FREE')
              : y === 'el'   ? blank(null, null)
              :                blank(Number(y), Number(t)));
            validate();
            return render();
        }

        const del = e.target.closest('[data-del]');
        if (del) {
            const uid = Number(del.dataset.del);
            ROWS = ROWS.filter(r => r.uid !== uid);
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
}

function updateStats() {
    const stats = MOUNT.querySelector('.cb-stats');
    if (stats) stats.outerHTML = statsHtml();

    const actions = MOUNT.querySelector('.cb-actions');
    if (actions) actions.outerHTML = actionsHtml();
}


/* ---- persistence ---- */

/* ⭐ NEW: Elective placeholder slots (IT-EL, IT-FRE) are reused across
   semesters — a BSIT curriculum has four of each. Every subject row
   needs a unique code within its prospectus, so unnumbered placeholders
   get a sequential suffix: IT-EL becomes IT-EL1, IT-EL2, and so on.
   Codes the operator typed with an explicit number (IT-EL3) are
   respected, and their number seeds the counter so auto-numbering
   never collides with an explicit choice.

   Mutates ROWS in place, so the UI reflects the numbered codes after
   the next render() and the downstream prerequisite lookup (which
   re-reads r.code) still matches. */
function normalizeElectiveCodes() {
    const counters = {};

    // Pass 1: collect explicit numbers already present, so auto-numbers
    // start above them and never collide.
    for (const r of ROWS) {
        if (r.year === null) continue;   // catalogue entries untouched
        const raw = r.code.trim().toUpperCase();
        const m = raw.match(/^(IT-EL|IT-FRE)(\d+)$/);
        if (m) counters[m[1]] = Math.max(counters[m[1]] || 0, Number(m[2]));
    }

    // Pass 2: assign numbers to unnumbered placeholders.
    for (const r of ROWS) {
        if (r.year === null) continue;
        const raw = r.code.trim().toUpperCase();
        const m = raw.match(/^(IT-EL|IT-FRE)$/);
        if (!m) continue;
        const base = m[1];
        counters[base] = (counters[base] || 0) + 1;
        r.code = `${base}${counters[base]}`;
    }
}

function toSubjectRows() {
    // ⭐ NEW: Number placeholders before building the payload — see comment
    // on normalizeElectiveCodes for the reasoning.
    normalizeElectiveCodes();

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
    // Check if there's anything to save
    const rowsToSave = filled();
    if (!rowsToSave.length) {
        return OPTS.onError?.('Nothing to save yet — add a subject first.');
    }

    // ──────────────────────────────────────────────────────────────
    // STEP 1: Ensure we have a prospectus_id
    // ──────────────────────────────────────────────────────────────
    if (!OPTS.prospectusId) {
        const { data, error } = await SB.from('prospectus')
            .insert({
                program_id: OPTS.programId || 1,
                academic_year: SELECTED_YEAR || new Date().getFullYear(),
                academic_term: 1,
                is_active: false,
                created_by: OPTS.staffId,
            })
            .select('id, academic_year, is_active, academic_term, published_at')
            .single();

        if (error) {
            console.error('prospectus insert failed:', error.message);
            return OPTS.onError?.('Could not create the curriculum year. ' + error.message);
        }

        OPTS.prospectusId = data.id;
        const newVersion = {
            id: data.id,
            academic_year: data.academic_year,
            academic_term: data.academic_term || 1,
            is_active: data.is_active || false,
            subject_count: 0,
            student_count: 0,
            published_at: data.published_at || null,
        };
        
        if (!OPTS.versions) OPTS.versions = [];
        OPTS.versions = [...OPTS.versions, newVersion];
        
        if (OPTS.onVersionChange) {
            OPTS.onVersionChange(OPTS.prospectusId, SELECTED_YEAR);
        }
    }

    // ──────────────────────────────────────────────────────────────
    // STEP 2: Fetch ALL existing subjects for this prospectus
    // ──────────────────────────────────────────────────────────────
    const { data: existingSubjects } = await SB
        .from('subject')
        .select('id, code')
        .eq('prospectus_id', OPTS.prospectusId);

    const existingCodes = new Set((existingSubjects ?? []).map(s => s.code.toUpperCase()));

    // After inserting subjects, refresh the version status from database
const { data: freshVersion } = await SB
    .from('prospectus')
    .select('id, academic_year, is_active, academic_term, published_at')
    .eq('id', OPTS.prospectusId)
    .single();

if (freshVersion) {
    // Update the version in OPTS.versions
    const idx = OPTS.versions.findIndex(v => v.id === freshVersion.id);
    if (idx !== -1) {
        OPTS.versions[idx] = {
            ...OPTS.versions[idx],
            is_active: freshVersion.is_active,
            published_at: freshVersion.published_at,
        };
    }
}
    // ──────────────────────────────────────────────────────────────
    // STEP 3: Filter out rows that already exist
    // ──────────────────────────────────────────────────────────────
    const newRows = rowsToSave.filter(r => 
        r.code.trim() && !existingCodes.has(r.code.trim().toUpperCase())
    );

    const validRows = newRows.filter(r => r.errors.length === 0);

    // ⭐ NEW: Give unnumbered IT-EL / IT-FRE placeholders their sequential
    // suffix so the unique (prospectus_id, code) constraint doesn't reject
    // them. Must run BEFORE newRows' codes are read below for the
    // existingCodes filter — otherwise the filter compares the un-numbered
    // "IT-EL" against existing "IT-EL1", and thinks there's no clash while
    // the DB insert then fails on the constraint.
    normalizeElectiveCodes();

    if (!validRows.length) {
        if (newRows.length) {
            return OPTS.onError?.('Cannot save: ' + newRows.filter(r => r.errors.length).length + ' row(s) have errors. Fix them first.');
        }
        render();
        const versionToUpdate = OPTS.versions?.find(v => v.id === OPTS.prospectusId);
        if (versionToUpdate) {
            const { data: fresh } = await SB
                .from('prospectus')
                .select('is_active, published_at')
                .eq('id', OPTS.prospectusId)
                .single();
            if (fresh) {
                versionToUpdate.is_active = fresh.is_active;
                versionToUpdate.published_at = fresh.published_at;
                render();
            }
        }
        return OPTS.onDone?.('All subjects already exist in this curriculum.');
    }

    // ──────────────────────────────────────────────────────────────
    // STEP 4: Save new subjects
    // ──────────────────────────────────────────────────────────────
    const subjectRows = validRows.map(r => ({
        prospectus_id: OPTS.prospectusId,
        created_by: OPTS.staffId,
        code: r.code.trim().toUpperCase(),
        title: r.title.trim(),
        units: (r.lec || 0) + (r.lab || 0),
        lec_units: r.lec || 0,
        lab_units: r.lab || 0,
        year_level: r.year,
        term: r.term,
        is_elective: r.year === null,
        is_active: true,
        elective_type: r.electiveType 
            || (/^IT-FRE/.test(r.code.trim().toUpperCase()) ? 'FREE'
                : /^IT-EL/.test(r.code.trim().toUpperCase()) ? 'IT'
                : null),
    }));

    const { data: inserted, error: subjectError } = await SB
        .from('subject')
        .insert(subjectRows)
        .select('id, code');

    if (subjectError) {
        console.error('subject insert failed:', subjectError.message);
        if (subjectError.message.includes('prospectus_id')) {
            return OPTS.onError?.('Database error: Could not save subjects. The curriculum year may not exist. Please try creating a new year.');
        }
        return OPTS.onError?.('Could not save subjects. ' + subjectError.message);
    }

    // ──────────────────────────────────────────────────────────────
    // STEP 5: ⭐ BUILD COMPLETE CODE → ID MAP (EXISTING + NEW)
    // ──────────────────────────────────────────────────────────────
    const allSubjects = [...(existingSubjects ?? []), ...inserted];
    const byCode = new Map(allSubjects.map(s => [s.code.toUpperCase(), s.id]));

    // ──────────────────────────────────────────────────────────────
    // STEP 6: Save prerequisites using the complete map
    // ──────────────────────────────────────────────────────────────
    const ruleRows = [];

    for (const r of validRows) {
        const subjectId = byCode.get(r.code.trim().toUpperCase());
        if (!subjectId) continue;

        // Check if prerequisites already exist for this subject
        const { data: existingRules } = await SB
            .from('prerequisite')
            .select('id')
            .eq('subject_id', subjectId);

        if (existingRules && existingRules.length > 0) {
            // Delete existing rules first (to avoid duplicates)
            await SB
                .from('prerequisite')
                .delete()
                .eq('subject_id', subjectId);
        }

        // Build new rules
        r.prereqs.forEach((p, i) => {
            if (p.standing) {
                // Standing rule
                ruleRows.push({
                    subject_id: subjectId,
                    prerequisite_subject_id: null,
                    requirement_type: 'standing',
                    rule_type: 'and',
                    rule_group: i + 1,
                    threshold_value: p.standing,
                    created_by: OPTS.staffId,
                });
            } else {
                // Find the target subject
                const target = ROWS.find(x => x.uid === p.uid);
                if (target) {
                    const targetCode = target.code.trim().toUpperCase();
                    const targetId = byCode.get(targetCode);
                    
                    // ⭐ This will now work for BOTH new AND existing subjects
                    if (targetId) {
                        ruleRows.push({
                            subject_id: subjectId,
                            prerequisite_subject_id: targetId,
                            requirement_type: 'prerequisite',
                            rule_type: 'and',
                            rule_group: i + 1,
                            threshold_value: null,
                            created_by: OPTS.staffId,
                        });
                    } else {
                        console.warn(`Prerequisite subject ${targetCode} not found in database.`);
                    }
                }
            }
        });
    }

    // ──────────────────────────────────────────────────────────────
    // STEP 7: Insert prerequisites
    // ──────────────────────────────────────────────────────────────
    if (ruleRows.length) {
        const { error: ruleError } = await SB
            .from('prerequisite')
            .insert(ruleRows);

        if (ruleError) {
            console.error('prerequisite insert failed:', ruleError.message);
            // Don't rollback subjects, but warn the user
            OPTS.onError?.('Subjects saved, but prerequisites failed: ' + ruleError.message);
        } else {
            console.log(`✅ Saved ${ruleRows.length} prerequisites`);
        }
    }

    // ──────────────────────────────────────────────────────────────
    // STEP 8: Mark rows as saved and update counts
    // ──────────────────────────────────────────────────────────────
    const insertedMap = new Map(inserted.map(s => [s.code, s.id]));
    for (const r of validRows) {
        const savedId = insertedMap.get(r.code.trim().toUpperCase());
        if (savedId) r.dbId = savedId;
    }

    const versionToUpdate = OPTS.versions?.find(v => v.id === OPTS.prospectusId);
    if (versionToUpdate) {
        versionToUpdate.subject_count = (versionToUpdate.subject_count || 0) + inserted.length;
    }

    DRAFT_BATCH = null;

    // ──────────────────────────────────────────────────────────────
    // STEP 9: Refresh UI and dispatch events
    // ──────────────────────────────────────────────────────────────
    if (OPTS.prospectusId) {
        document.dispatchEvent(new CustomEvent('curriculum-saved', {
            detail: {
                prospectusId: OPTS.prospectusId,
                count: inserted.length,
                isDraft: true
            }
        }));
    }

    // ⭐ Refresh version status from database
    refreshVersionStatus();

    render();

    if (OPTS.onVersionChange) {
        OPTS.onVersionChange(OPTS.prospectusId);
    }

    const message = `${inserted.length} subject${inserted.length === 1 ? '' : 's'} saved with ${ruleRows.length} prerequisite${ruleRows.length === 1 ? '' : 's'}. `
        + 'Not yet published \u2014 use Create Curriculum when ready.';
    OPTS.onDone?.(message);
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

    // ⭐ NEW: Number placeholders before the pre-flight checks codes against
    // the DB. Otherwise it would compare un-numbered "IT-EL" against the
    // existing "IT-EL1" and miss the collision, then fail on the actual
    // insert with a raw Postgres message.
    normalizeElectiveCodes();
    validate();

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

    /* ⭐ FIX: Do NOT auto-select a year on load.
       The user must manually choose from the dropdown.
       Only restore a previously selected year if it was explicitly set. */
    if (SELECTED_YEAR === null) {
        // ⭐ Leave SELECTED_YEAR as null - "Select Year" will be shown
        // Do NOT auto-select the first available year
        SELECTED_YEAR = null;
        OPTS.prospectusId = null;
    } else {
        // If a year was previously selected, restore it
        const chosen = (OPTS.versions ?? []).find(v => v.academic_year === SELECTED_YEAR);
        OPTS.prospectusId = chosen?.id ?? null;
    }

    if (!OPTS.versions?.length) {
        console.warn('CurriculumBuilder: no versions passed — every year will show as New');
    }

    // Start with empty rows (no data loaded until year is selected)
    ROWS = [];
    for (let i = 0; i < 3; i++) ROWS.push(blank(1, 1));

    validate();
    render();

    /* Progress is written into the draft curriculum itself now, and
       selecting a year loads it through loadExisting(). The old resume
       prompt read stg_subject, which nothing writes to any more — it would
       offer a stale copy of work that has since moved on. */
}

window.CurriculumBuilder = {
    mount,
    reset: () => { ROWS = []; SEQ = 1; SELECTED_YEAR = null; render(); },
};


})();