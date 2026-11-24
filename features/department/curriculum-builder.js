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
   ELPHP1, IT-EL______. Letters, digits, hyphen, space and underscore
   cover all of them; anything else is a typo. */
// The shape rule (starts with a letter; "123123" is a typo) is SC.problem().

/* How a code is cleaned and compared (shared/js/curriculum/subjectcode.js): kept as typed,
   but upper case, one kind of dash, single spaces. Two codes are the same
   subject when their letters and digits match (ENGL 101 = ENGL-101). */
const SC = window.CurriculogicSubjectCode;

/* Titles are not letters-only. The prospectus has "Computer Programming 1",
   "Web Design & Development", "Applications Dev't & Emerging Tech.",
   "Life, Works & Writings of Dr. Jose Rizal" and
   "Sports/Outdoor Adventure (PATHFit 4)". Requiring at least one letter
   and rejecting control characters is the useful check. */
const TITLE_OK = /^[^\x00-\x1f]*[A-Za-z][^\x00-\x1f]*$/;

/* An exact whitelist of "allowed" lec/lab values only works for one
   programme's own conventions -- BSIT is almost all 2-or-3 lecture with
   a 0-or-1 lab, but that is BSIT's convention, not a rule. Cross-checked
   against real prospectus PDFs from four colleges (BSIT, BSN, BSCRIM,
   BSBA-OM): lecture units alone range from 1 (a 1-lec/1-lab elective) to
   10 (BSCRIM's Criminology Enhancement Course), and laboratory units run
   as high as 8 (BSN's RLE-heavy clinical courses, e.g. a single subject
   at 8 lec / 6 lab). A practicum-style course isn't one fixed shape
   either: BSIT's records its units entirely under laboratory (6 or 9,
   lecture 0), BSBA's the opposite way (6 lecture, lab 0), and BSCRIM's
   OJT is just an ordinary 3-lecture course with no special-casing at
   all. A bounded range is the check that survives all of that: it still
   catches a fat-fingered "30" typed for "3", without rejecting a real
   subject just because no one told this file that other colleges exist.
   PE is 2 lecture with no laboratory, which is why the lab auto-fill is
   a suggestion the operator can clear rather than a rule. */
const LEC_MAX = 12;
const LAB_MAX = 10;

/* A semester beyond this is almost certainly a mistake -- but real
   heavy terms run higher than BSIT's own 26: BSCRIM's 2nd-year 1st
   semester is 33 units. Adding rows stops here rather than letting a
   term grow without limit. */
const MAX_TERM_UNITS = 40;

const STANDING = [
    { key: 'STAND2', label: 'Must finish all 1st to 2nd year courses', threshold: 2 },
    { key: 'STAND3', label: 'Must finish all 1st to 3rd year courses', threshold: 3 },
];

/* The prerequisite table stores a standing threshold as a position,
   Y*10+T (22 = through 2nd year, 2nd sem) -- the form the engine reads.
   This builder only offers whole years, so in memory `standing` is a year
   (2 -> **, 3 -> ***). A stored position it does not model (11, 21, 31...)
   keeps its exact value in `pos`, so opening and re-saving a prospectus
   does not turn it into something else. A bare 1-9 from an older writer
   is a year. */
function standingFromDb(value) {
    const n = Number(value) || 0;
    if (n >= 10) return { standing: Math.floor(n / 10), pos: n };
    return { standing: n || 2 };
}
const standingToDb = (p) => p.pos ?? p.standing * 10 + 2;

/* ---- elective slots ----
   Decided from a row's data, not from one programme's naming: see
   shared/js/curriculum/electives.js (loaded before this file). */
const { placeholderOf, electiveTypeOf, isElectiveRow } = window.CurriculogicElectives;

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
let AI_BUSY         = false;   // an extraction is running: its button, the file buttons and a second run are locked
/* The scan check shown under the upload (extractioncheck.js overview). It describes the rows made by ONE scan, so it is
   shown only while ROWS is still that very array: loading another year, a reset or a new scan replaces ROWS and the
   report disappears with it, instead of describing rows that are no longer there. */
let ISSUE_I         = 0;       // which issue the arrows on the Issues tile are at (0 = the first)
let SCAN_RUN        = 0;       // the number of the scan that is current: pressing Stop moves it on, and a scan that finds it has changed ends quietly
let LIVE_ABORT      = null;    // cuts the request that is in flight, when a scan is running
let SCAN_DOC        = null;    // what the scanned FILE says about itself: { year, name } (its printed year and programme name)
let SCAN_REPORT     = null;
/* The circles while a scan runs (extractioncheck.js progress()): which stage the scan is at, or where it stopped.
   Kept here, not in the DOM, so a redraw of the card does not lose it. Cleared when the result takes over, and when the
   file is removed or another one is chosen. */
let SCAN_STAGE      = null;
let SCAN_LAST_SEC   = -1;

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
        category: null,        // GE / COMMON_COMPUTING / PROFESSIONAL_IT / ELECTIVE / OTHER, as the curriculum prints it
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
        const code = SC.clean(r.code);

        // A wholly empty row is a row not filled in yet, not an error.
        if (!code && !r.title.trim() && r.lec === null && r.lab === null) continue;

        if (!code) {
            r.errors.push('Code is required.');
        } else if (SC.problem(code)) {
            r.errors.push(SC.problem(code));
        }

        if (!r.title.trim()) {
            r.errors.push('Title is required.');
        } else if (!TITLE_OK.test(r.title.trim())) {
            r.errors.push('Title must contain at least one letter.');
        }

        if (r.lec !== null && (r.lec < 0 || r.lec > LEC_MAX)) {
            r.errors.push(`Lecture units must be 0–${LEC_MAX}.`);
        }
        if (r.lab !== null && (r.lab < 0 || r.lab > LAB_MAX)) {
            r.errors.push(`Laboratory units must be 0–${LAB_MAX}.`);
        }

        if (unitsOf(r) <= 0) r.errors.push('Units must be more than zero.');

if (code) {
    /* Un-numbered elective placeholders (IT-EL, BSN-ELEC, FREE...) are
       exempt from the duplicate check. Several slots share the same base
       code by design — that is the whole point of a placeholder — and
       normalizeElectiveCodes() gives each its own numbered code
       before the payload reaches the database. Without this exemption
       the Create button stays disabled by its own validation, and the
       numbering routine that would resolve the clash never runs. */
    const ph = placeholderOf(code);
    const isPlaceholder = ph !== null && ph.num === null;

    if (!isPlaceholder) {
        if (seen.has(SC.key(code))) r.errors.push('This code is already used.');
        else seen.set(SC.key(code), code);
    }
}
    }

    /* A prerequisite must come in an EARLIER semester (candidatesFor): a subject that needs one taken in its own semester, or later, could
       never be opened. The scan can produce one (the ACT PDF's Web Design 1 got Introduction to Computing, in the same semester, 22 Nov 2026)
       and nothing said so. "Goes with" links are meant to be in the same term, so they are left out. */
    for (const r of ROWS) {
        for (const p of r.prereqs ?? []) {
            if (!p.uid || p.co) continue;
            const target = ROWS.find(x => x.uid === p.uid);
            if (!target || candidatesFor(r).includes(target)) continue;     // a deleted target is reported elsewhere
            r.errors.push(`${target.code || 'A subject'} is not in an earlier semester, so it cannot be a prerequisite. Untick it in the prerequisite list.`);
        }
    }

    return seen;
}

const filled  = () => ROWS.filter(r => r.code.trim() || r.title.trim());

/* ---- unsaved work, and "where I left off" ----

   UNSAVED: a fingerprint of everything typed or scanned into the table (codes, titles, units, year, term, kind and
   each row's prerequisites by code). It is taken when rows are loaded, saved or cleared, and compared again later, so
   "unsaved changes" means exactly "the table is not what the database holds" and never guesses from clicks. A
   scanned-but-unsaved curriculum counts, which is what was being lost when someone left or reloaded the page.

   WHERE I LEFT OFF: the year being edited is remembered for the tab's session, per programme, so coming back to the
   Curriculum tab (or reloading) reopens that draft with its saved subjects instead of a blank "Select Year". It is
   only the person's own last choice: nothing is selected for them the first time. */
let SAVED_SIG = '[]';
let MOUNTED_PROGRAM;           // the programme the builder was last mounted for; undefined before the first mount

function sig() {
    const codeOf = (uid) => ROWS.find(x => x.uid === uid)?.code ?? '';
    return JSON.stringify(filled().map(r => [
        SC.clean(r.code), String(r.title ?? '').trim(), r.lec ?? null, r.lab ?? null, r.year, r.term,
        r.electiveType ?? null, r.category ?? null,
        (r.prereqs ?? []).map(p => p.standing ? 's' + (p.pos ?? p.standing * 10 + 2) : (p.co ? 'c' : 'p') + SC.clean(codeOf(p.uid))).sort(),
    ]));
}

const isDirty = () => sig() !== SAVED_SIG;

function refreshDirty() {
    const badge = document.getElementById('cb-unsaved');
    if (badge) badge.hidden = !isDirty();
}

function markClean() { SAVED_SIG = sig(); refreshDirty(); }

const recallKey = () => `cb-last-year:${OPTS.programId ?? 'none'}`;

function rememberYear(year) {
    try {
        if (year == null) sessionStorage.removeItem(recallKey());
        else sessionStorage.setItem(recallKey(), String(year));
    } catch (_) { /* storage blocked: the page simply does not remember */ }
}

function recalledYear() {
    try {
        const y = Number(sessionStorage.getItem(recallKey()));
        return Number.isInteger(y) && y > 0 ? y : null;
    } catch (_) { return null; }
}

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
        // A "goes with" link: taken in the same term, not before.
        return p.co
            ? `<span class="cb-chip co" title="Goes with: taken in the same term">+ ${esc(t?.code || '?')}</span>`
            : `<span class="cb-chip">${esc(t?.code || '?')}</span>`;
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

    // A prerequisite already on this row that is NOT allowed here (same or later semester) is not a candidate, so it would never be listed
    // and could never be unticked. List it, ticked, so it can be removed.
    const stray = row.prereqs.filter(p => p.uid && !p.co && !opts.some(o => o.uid === p.uid))
        .map(p => ROWS.find(r => r.uid === p.uid)).filter(Boolean);
    if (stray.length) groups.set('Not allowed here: untick to remove', stray);

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
            ${opts.length || stray.length ? list : '<p class="cb-pick-none">No earlier subjects yet.</p>'}
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
        // Re-check before drawing: the prerequisites just changed, and a link that is not allowed is an error (an untick clears it).
        if (e.target.closest('.cb-pick-done')) { closePicker(); validate(); render(); }
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
        <div class="cbp-modal cb-yearmodal" role="dialog" aria-label="Create academic year">
            <div class="cbp-bar">
                <div>
                    <p class="cbp-title">Create Academic Year</p>
                    <p class="cbp-sub">Enter the year it starts. It runs to the next year, for example 2027–2028.</p>
                </div>
                <button class="cbp-close" aria-label="Close">&times;</button>
            </div>
            <div class="cbp-body">
                <div class="field" style="margin-bottom: var(--s3);">
                    <label for="custom-year-input" style="display: block; font-weight: 600; margin-bottom: 0.35rem;">
                        Starting year (YYYY)
                    </label>
                    <input type="number" id="custom-year-input" class="cb-year-input"
                           min="2000" max="2100" step="1"
                           placeholder="2027">
                    <p id="custom-year-range" aria-live="polite" style="font-weight: 600; margin-top: 0.35rem; min-height: 1.2em;"></p>
                    <p id="custom-year-error" style="color: #dc2626; font-size: 0.85rem; margin-top: 0.35rem; display: none;"></p>
                </div>
            </div>
            <div class="cb-cf-foot" style="display: flex; gap: var(--s2); justify-content: flex-end; padding-top: var(--s3); border-top: 1px solid var(--line);">
                <button class="cb-cf-cancel" style="padding: 0.5rem 1.2rem;">Cancel</button>
                <button class="btn-primary" id="confirm-custom-year" style="padding: 0.5rem 1.2rem;">
                    <i class="fa-solid fa-plus"></i> Create Year
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
    const range = overlay.querySelector('#custom-year-range');
    setTimeout(() => input?.focus(), 100);

    // Show the full academic year as the start year is typed
    input?.addEventListener('input', () => {
        error.style.display = 'none';
        const y = Number(input.value);
        range.textContent = Number.isInteger(y) && y >= 2000 && y <= 2100 ? `${y}–${y + 1}` : '';
    });

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
            error.textContent = `${year}–${year + 1} already exists as ${existing.is_active ? 'Active' : 'Draft'}.`;
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
            OPTS.onError?.(yearTaken(insertError) ?? 'Could not create that year. ' + insertError.message);
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
        rememberYear(year);
        markClean();

        // Re-render
        render();

        // Notify parent
        if (OPTS.onVersionChange) {
            OPTS.onVersionChange(OPTS.prospectusId, year);
        }

        OPTS.onDone?.(`${year}–${year + 1} created as a draft. Add subjects to get started.`);
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
            <span class="cb-unsaved" id="cb-unsaved" role="status"${isDirty() ? '' : ' hidden'}>Unsaved changes</span>
        </div>
        <div style="display: flex; gap: var(--s2); align-items: center;">
            <select id="cb-version-pick" aria-label="Select curriculum year" style="flex: 1;" value="${sel || ''}">
                ${optionsHtml}
                <option value="__custom__">+ Create Year…</option>
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
        <div class="cb-stat ${bad ? '' : 'ok'}"><p class="k">Valid</p><p class="v">${rows.length - bad}/${rows.length}</p></div>
        <div class="cb-stat ${bad ? 'bad cb-jump' : ''}"${bad
            ? ' role="button" tabindex="0" data-jump-issue title="Go to this issue"' : ''}><p class="k">Issues</p><p class="v">${bad}</p>${bad > 1
            ? `<span class="cb-issue-nav"><button type="button" data-issue-step="-1" aria-label="Previous issue" title="Previous issue">‹</button>`
              + `<span class="cb-issue-pos">${(((ISSUE_I % bad) + bad) % bad) + 1} of ${bad}</span>`
              + `<button type="button" data-issue-step="1" aria-label="Next issue" title="Next issue">›</button></span>` : ''}</div>
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
    </tr>
    <tr class="cb-err" data-err-for="${r.uid}"${bad ? '' : ' hidden'}>
        <td colspan="7" role="status">${esc(r.errors.join(' '))}</td>
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
    if (tab === 'it')   return tableHtml('Programme elective courses', catalog('IT'), null, null);
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
/* THE NOTE BY THE BUTTONS (22 Nov 2026). Create used to say what it did in a green line at the TOP of the page, while the button is at the
   bottom: after a save the table blanked and refilled and nothing visible said it worked, so people pressed Create again and read
   "0 subjects and 0 rules created". Now the answer sits beside the buttons and the page scrolls to it.
     kind  saving | saved | nothing | warn          text  the sentence          it goes away on the next edit, or after a while */
let SAVE_NOTE = null;
let SAVE_NOTE_TIMER = null;

function refreshActions() {
    const bar = MOUNT?.querySelector('.cb-actions');
    if (bar) bar.outerHTML = actionsHtml();
}

function setSaveNote(kind, text, ms = 20000) {
    clearTimeout(SAVE_NOTE_TIMER);
    SAVE_NOTE = { kind, text, programId: OPTS?.programId ?? null, prospectusId: OPTS?.prospectusId ?? null };
    SAVE_NOTE_TIMER = setTimeout(clearSaveNote, kind === 'saving' ? 90000 : ms);
    refreshActions();
}

function clearSaveNote() {
    clearTimeout(SAVE_NOTE_TIMER);
    if (!SAVE_NOTE) return;
    SAVE_NOTE = null;
    refreshActions();
}

function focusActions() {
    MOUNT?.querySelector('.cb-actions')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function actionsHtml() {
    const rows = filled();
    const n   = rows.length;
    const bad = badRows().length;
    const hasExisting = rows.some(r => r.dbId);
    const unsaved = rows.filter(r => !r.dbId).length;
    // saved subjects whose prerequisites were changed on screen and not stored yet
    const edited = n ? window.CurriculogicRuleSync.changedRows(rows, RULE_DEPS).length : 0;
    // Everything on screen is what the database holds: there is nothing for Create to do, and the button says so.
    const settled = n > 0 && !unsaved && !edited && !isDirty();
    const ICON = { saving: '…', saved: '✓', nothing: 'i', warn: '!' };
    // Only ever for the year it was written about: switching year must not show another year's "Saved".
    const noteIsHere = SAVE_NOTE && SAVE_NOTE.prospectusId === (OPTS?.prospectusId ?? null) && SAVE_NOTE.programId === (OPTS?.programId ?? null);
    const note = noteIsHere
        ? `<span class="cb-hint cb-note is-${esc(SAVE_NOTE.kind)}" role="status"><b aria-hidden="true">${ICON[SAVE_NOTE.kind] ?? ''}</b> ${esc(SAVE_NOTE.text)}</span>`
        : '';

    // Create Curriculum must stay available even when every row was
    // already saved by Save (unpublished) -- "already saved to the
    // table" and "already published" are different things. Previously
    // this button was replaced outright by a checkmark once hasExisting
    // was true, meaning a fully-drafted curriculum had no way to ever
    // reach the publish step: selecting an existing draft year and
    // trying to publish it left nothing clickable at all.
    return `<div class="cb-actions">
        <button id="cb-draft" ${!n ? 'disabled' : ''}>Save (unpublished)</button>
        <button class="btn-primary${settled ? ' is-saved' : ''}" id="cb-create" ${bad || !n ? 'disabled' : ''}>
            ${settled ? 'Saved \u2713' : 'Create curriculum'}
        </button>
        <button id="cb-preview" ${!n ? 'disabled' : ''}>Preview</button>
        ${note || `<span class="cb-hint">${
            !n ? 'Add at least one subject'
            : bad ? `Fix ${bad} issue${bad === 1 ? '' : 's'}`
            : edited
                ? `${edited} saved subject${edited === 1 ? ' has' : 's have'} edited prerequisites \u2014 press Save (unpublished) to store ${edited === 1 ? 'it' : 'them'}`
            : hasExisting ? `${n} subject${n === 1 ? '' : 's'} saved \u2014 ready to publish`
            : 'Ready'
        }</span>`}
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
            ${hasFile ? `<button class="cb-ai-icon-btn" id="ai-close" aria-label="Cancel"${AI_BUSY ? ' disabled' : ''}>
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
                <button class="cb-ai-icon-btn" id="ai-trash" aria-label="Remove file"${AI_BUSY ? ' disabled' : ''}>
                    <i class="fa-solid fa-trash-can"></i>
                </button>
                <div class="cb-ai-progress" id="ai-progress"${AI_BUSY ? '' : ' hidden'}>
                    <div class="cb-ai-progress-pct" id="ai-progress-pct">${AI_BUSY ? Math.round(PROGRESS_VALUE) : 0}%</div>
                    <div class="cb-ai-progress-track">
                        <div class="cb-ai-progress-fill" id="ai-progress-fill" style="width:${AI_BUSY ? PROGRESS_VALUE.toFixed(1) : 0}%"></div>
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
        ${scanStepsHtml()}
        ${scanReportHtml()}

        ${hasFile || SCAN_REPORT ? `
            <div class="cb-ai-actions">
                <button class="cb-ai-cancel${AI_BUSY ? ' is-stop' : ''}" id="ai-cancel" title="${AI_BUSY ? 'Stop reading the file (Esc)' : 'Remove the file and clear the table'}">${AI_BUSY ? 'Stop' : 'Cancel'}</button>
                ${hasFile ? `<button class="btn-primary" id="ai-extract"${AI_BUSY ? ' disabled' : ''}>${AI_BUSY ? 'Extracting…' : 'Extract Subjects'}</button>` : ''}
            </div>
        ` : ''}
    </div>`;
}

/* ---- the circles while the scan runs ---- */

const scanState = () => ({
    ...SCAN_STAGE,
    seconds: SCAN_STAGE?.t3 ? Math.floor((Date.now() - SCAN_STAGE.t3) / 1000) : 0,
});

function scanStepsHtml() {
    if (!SCAN_STAGE || !window.CurriculogicExtractionCheck?.progressItems) return '';
    return `<ol class="cb-steps cb-steps-live" id="ai-steps" aria-label="How the scan is going">${
        window.CurriculogicExtractionCheck.progressItems(scanState())}</ol>`;
}

/* Repaints just the circles. Looks the list up on every call (render() can replace the card while a scan runs), and puts
   it under the status line if the card has not drawn it yet. */
function paintScanSteps() {
    if (!SCAN_STAGE || !window.CurriculogicExtractionCheck?.progressItems) return;
    let ol = document.getElementById('ai-steps');
    if (!ol) {
        const status = document.getElementById('ai-analyze-status');
        if (!status) return;
        status.insertAdjacentHTML('afterend', scanStepsHtml());
        ol = document.getElementById('ai-steps');
        if (!ol) return;
    }
    ol.innerHTML = window.CurriculogicExtractionCheck.progressItems(scanState());
}

function setScanStage(stage, extra) {
    SCAN_STAGE = { ...(SCAN_STAGE ?? {}), failedAt: 0, ...extra, stage };
    SCAN_LAST_SEC = -1;
    paintScanSteps();
}

/* The scan stopped at circle `at`: it turns red with the reason, the ones before it stay done. */
function failScan(at, message) {
    SCAN_STAGE = { ...(SCAN_STAGE ?? {}), stage: at, failedAt: at, message };
    paintScanSteps();
}

function scanReportHtml() {
    if (!SCAN_REPORT || SCAN_REPORT.rowsRef !== ROWS) return '';
    return window.CurriculogicExtractionCheck?.html(SCAN_REPORT) ?? '';
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
            Programme electives${catalog('IT').length
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

/* Advisory only. Read from the programme (program.target_units); 176 is the
   BSIT figure, used when the programme is unknown. */
const targetUnits = () =>
    window.CurriculogicPrograms?.limitsOf(OPTS.programId).targetUnits ?? 176;

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

    return new Set((data ?? []).map(r => SC.key(r.code)));
}

/* The programme's OTHER curriculum years with their live subjects, for the same-curriculum check. null when they cannot be read. */
async function otherVersions() {
    const versions = (OPTS.versions ?? []).filter(v => v.id && v.id !== OPTS.prospectusId);
    if (!versions.length) return [];

    const { data, error } = await SB.from('subject')
        .select('prospectus_id, code, year_level, term, lec_units, lab_units')
        .in('prospectus_id', versions.map(v => v.id))
        .eq('is_active', true)
        .limit(5000);

    if (error) {
        console.warn('could not read the other curriculum years:', error.message);
        return null;
    }

    const SAME = window.CurriculogicSameCurriculum;
    return versions.map(v => ({
        version:  v,
        subjects: (data ?? []).filter(r => r.prospectus_id === v.id).map(SAME.fromDbRow),
    }));
}

/* Other PROGRAMMES' curricula with their live subjects, to warn when this file is really another programme's. A programme
   that this account may not read is simply not in the answer; any failure gives [] (this check only ever adds a warning). */
async function otherProgrammes() {
    try {
        const { data: pros, error } = await SB.from('prospectus')
            .select('id, program_id, academic_year, is_active, program:program_id(code, name)')
            .neq('program_id', OPTS.programId);
        if (error || !pros?.length) return [];

        const { data: subs, error: e2 } = await SB.from('subject')
            .select('prospectus_id, code, year_level, term, lec_units, lab_units')
            .in('prospectus_id', pros.map(p => p.id))
            .eq('is_active', true)
            .limit(8000);
        if (e2) return [];

        const SAME = window.CurriculogicSameCurriculum;
        return pros.map(p => ({
            version:  { ...p, programme: p.program?.code || p.program?.name || 'another programme' },
            subjects: (subs ?? []).filter(r => r.prospectus_id === p.id).map(SAME.fromDbRow),
        }));
    } catch (_) {
        return [];
    }
}

/* The database allows one curriculum per programme and year (db/130). If it says no, say why in plain words. */
function yearTaken(error) {
    return /prospectus_program_year_key|duplicate key/.test(error?.message ?? '')
        ? 'That curriculum year already exists for this programme. Reload the page to see it.'
        : null;
}

/* What must stop a save before anything is written: the plain sentences from samecurriculum.js saveGuard(), for the state of this page. */
function saveProblems() {
    return window.CurriculogicSameCurriculum.saveGuard({
        hasVersion: !!OPTS.prospectusId,
        year: SELECTED_YEAR,
        printedName: SCAN_DOC?.name ?? '',
        program: { code: OPTS.programCode, name: OPTS.programName },
    });
}

function preflight(taken, others = [], elsewhere = []) {
    const blockers = [];
    const warnings = [];
    const rows     = filled();

    if (!rows.length) {
        blockers.push('There are no subjects to save.');
        return { blockers, warnings };
    }

    // Refused outright, not left to a warning: a file for another programme, and a curriculum with no year (shared/js/curriculum/samecurriculum.js).
    blockers.push(...saveProblems());

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
        if (r.prereqs.some(p => p.uid && p.uid === r.uid)) {
            blockers.push(`${r.code || 'A subject'} requires itself, so it could never be taken. Remove that prerequisite.`);
        }
        const dangling = r.prereqs.filter(p => p.uid && !live.has(p.uid));
        if (dangling.length) {
            blockers.push(`${r.code || 'A subject'} requires a subject that is no longer in the list.`);
        }
    }

    if (taken === null) {
        warnings.push('Could not check for codes already in this curriculum year.');
    } else if (taken?.size) {
        // A row with a dbId already IS the saved record `taken` found --
        // that is not a collision, it is the same row. Only a genuinely
        // new row (no dbId yet) whose code matches something already
        // saved is a real clash.
        const clash = rows.filter(r => !r.dbId && taken.has(SC.key(r.code)))
                          .map(r => SC.clean(r.code));
        if (clash.length) {
            blockers.push(
                `Already in this curriculum year: ${clash.slice(0, 6).join(', ')}` +
                (clash.length > 6 ? ` and ${clash.length - 6} more.` : '.'));
        }
    }

    /* The same subjects under another year is not a new curriculum, it is a copy with a different label. `others` is the
       programme's other versions with their subjects; null means they could not be read. */
    if (others === null) {
        warnings.push('Could not compare this with the programme\'s other curriculum years.');
    } else {
        const SAME = window.CurriculogicSameCurriculum;
        for (const { version, result } of SAME.findSame(rows.map(SAME.fromBuilderRow), others)) {
            const label = `${version.academic_year}–${version.academic_year + 1}${version.is_active ? ' (Active)' : ' (Draft)'}`;
            if (result.identical) {
                blockers.push(
                    `This is the same curriculum as ${label}: all ${result.mine} subjects have the same codes, units, year and semester. ` +
                    'A year of an unchanged curriculum is made from Prospectus, New version (copy), not by uploading it again.');
            } else {
                const n = result.differing;
                warnings.push(
                    `${Math.round(result.similarity * 100)}% the same as ${label}: ${n} subject${n === 1 ? '' : 's'} differ. ` +
                    'Check that this is a real change and not the same file read slightly differently.');
            }
        }
    }

    /* The file's own claims against what was chosen: a different year, or a different programme. Warnings only: a document can
       print a different year than the one it takes effect, and a programme's printed name is worded however the college likes. */
    {
        const SAME = window.CurriculogicSameCurriculum;
        const picked = SELECTED_YEAR;
        const yearOff = SCAN_DOC ? SAME.yearMismatch(SCAN_DOC.year, picked) : null;
        if (yearOff) {
            warnings.push(`This file says ${yearOff.printed}–${yearOff.printed + 1}, but you selected ${picked}–${picked + 1}. ` +
                          'Check that the right curriculum year is selected.');
        }
        if (SCAN_DOC?.name && (OPTS.programName || OPTS.programCode)) {
            const fit = SAME.programmeFit(SCAN_DOC.name, { code: OPTS.programCode, name: OPTS.programName });
            // A file with nothing in common is already a blocker above; this is for names that share some words.
            if (!fit.fits && !SAME.programmeClash(SCAN_DOC.name, { code: OPTS.programCode, name: OPTS.programName })) {
                warnings.push(`This file is for “${SCAN_DOC.name}”, but this curriculum is for ` +
                              `${OPTS.programCode ? OPTS.programCode + ' ' : ''}${OPTS.programName ?? ''}`.trim() + '. Check that it is the right file.');
            }
        }
        for (const { version, result } of SAME.findSame(rows.map(SAME.fromBuilderRow), elsewhere ?? [])) {
            warnings.push(`${Math.round(result.similarity * 100)}% the same as ${version.programme} ` +
                          `${version.academic_year}–${version.academic_year + 1}, a different programme's curriculum. ` +
                          'Check that this file belongs to this programme.');
        }
    }

    const years = [1, 2, 3, 4].filter(y => rows.some(r => r.year === y));

    /* A curriculum is published as a whole. A four-year programme with
       year 3 missing is not a partial curriculum — it is one that would
       tell a student they have nothing to take. Incomplete work belongs
       in Save progress, which is what that button is for. */
    /* Only the years the curriculum reaches: a two-year programme (the ACT associate course) has no 3rd or 4th year, and was refused for it
       (22 Nov 2026). A gap BEFORE the last year is still an error. Stopping short of four years is only a warning below, so a four-year
       curriculum that lost its last years still gets a word about it. */
    const lastYear = years.length ? Math.max(...years) : 0;
    for (const y of [1, 2, 3, 4].filter(n => n <= lastYear)) {
        const missing = [1, 2].filter(t => !inCell(y, t).some(r => r.code.trim()));

        if (missing.length === 2) {
            blockers.push(`${YEARS[y]} has no subjects.`);
        } else if (missing.length === 1) {
            blockers.push(`${YEARS[y]} has no ${TERMS[missing[0]].toLowerCase()} subjects.`);
        }
    }
    if (lastYear >= 1 && lastYear < 4) {
        const ordinal = { 2: '2nd', 3: '3rd' }[lastYear];
        warnings.push(`This curriculum covers ${lastYear === 1 ? 'the 1st year only' : `the 1st to ${ordinal} year`}. ` +
                      'If the programme runs longer, the later years are missing.');
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
    if (Math.abs(total - targetUnits()) > 20) {
        warnings.push(`${total} units total, against the ${targetUnits()} expected for this programme's full curriculum.`);
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

    /* Only one check dialog at a time: pressing Create again must not stack a second one on top (21 Nov 2026: three were
       open at once, and each could start its own save). */
    document.querySelectorAll('.cbp-overlay').forEach(o => { if (o.querySelector('.cb-confirm')) o.remove(); });

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
            return esc(t?.code || '?') + (p.co ? ' (co)' : '');
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

/* THE SIX STAGES OF A SCAN, in this order, each one finishing before the next begins:
     1 PDF read       the browser reads the file
     2 Sent           the file goes up to the server (a real upload, with its real percentage)
     3 AI reading     the AI reads the document: the long wait, shown in seconds
     4 Table built    the answer becomes rows and prerequisites
     5 Totals checked the rows are compared with the totals the document prints
     6 Ready          the result is prepared and shown
   A circle pulses while its work is happening, turns green when it is done, and only then does the next one start. A stage
   that finishes in a blink is held on screen for MIN_STEP_MS so it is seen, never skipped. If anything fails, the circle
   that was running turns red. */
const MIN_STEP_MS = 450;

/* Stage n is done: keep it on screen for at least MIN_STEP_MS since it began, then start stage n + 1. */
async function finishStage(n, startedAt) {
    const wait = MIN_STEP_MS - (Date.now() - startedAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    setScanStage(n + 1);
}

/* Sends the PDF to the reader and reports the upload as it happens (stage 2), then waits for the answer (stage 3).
   onProgress(percent) while the file goes up; onUploaded() once the whole file has been sent.
   Returns { status, data } for any answer from the server, or { status: 0, networkError: true } when none came.
   If this page cannot make the tracked request (no session or settings), it falls back to the client's own call: the file
   is then "sent" when that call starts, as before. */
async function postDocument(base64, { onProgress, onUploaded, onRetry = () => {} }) {
    const cfg = window.CURRICULOGIC ?? {};
    let token = null;
    try { token = (await SB.auth.getSession())?.data?.session?.access_token ?? null; } catch (_) { /* fall back below */ }

    if (!token || !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
        onUploaded();
        const { data, error } = await SB.functions.invoke('analyze-curriculum-document', {
            body: { fileBase64: base64, mimeType: 'application/pdf' },
        });
        if (!error) return { status: 200, data };
        const status = Number(error?.context?.status) || 0;
        return { status, data: null, networkError: status === 0 };
    }

    /* One try at the tracked request. A file that stops going up (no progress for UPLOAD_STALL_MS before the last byte is
       sent) is cancelled and reported as stalled, so the caller can try again on a fresh connection instead of waiting for
       a connection that has died. On 21 Nov 2026 an upload sat at 96% for over two minutes with nothing reaching the server. */
    const attempt = () => new Promise((resolve) => {
        const x = new XMLHttpRequest();
        let uploaded = false;
        let lastMoved = Date.now();
        let watchdog = null;
        const stop = () => { if (watchdog) { clearInterval(watchdog); watchdog = null; } };

        x.open('POST', `${cfg.SUPABASE_URL}/functions/v1/analyze-curriculum-document`);
        // The server stops a reader at about 150 to 160 seconds, counted from when it has the whole file; on a slow upload
        // (30 s is common) that is 190 s on this side. So this is a net, not a limit: the server's own answer comes first.
        x.timeout = 300000;
        x.setRequestHeader('Authorization', `Bearer ${token}`);
        x.setRequestHeader('apikey', cfg.SUPABASE_ANON_KEY);
        x.setRequestHeader('Content-Type', 'application/json');
        x.upload.onprogress = (e) => {
            lastMoved = Date.now();
            if (e.lengthComputable) onProgress(Math.round((e.loaded * 100) / e.total));
        };
        x.upload.onload = () => { uploaded = true; stop(); onUploaded(); };
        x.onload = () => {
            stop();
            let data = null;
            try { data = JSON.parse(x.responseText); } catch (_) { /* not JSON: the status says enough */ }
            resolve({ status: x.status, data });
        };
        x.onerror   = () => { stop(); resolve({ status: 0, data: null, networkError: true, uploaded }); };
        x.ontimeout = () => { stop(); resolve({ status: 0, data: null, networkError: true, timedOut: true, uploaded }); };

        watchdog = setInterval(() => {
            if (!uploaded && Date.now() - lastMoved > UPLOAD_STALL_MS) {
                stop();
                x.abort();
                resolve({ status: 0, data: null, networkError: true, stalled: true, uploaded: false });
            }
        }, 1000);

        // Stop: the page can cut this request at any moment. The answer, if the server still sends one, is never read.
        LIVE_ABORT = () => { stop(); try { x.abort(); } catch (_) { /* already finished */ } resolve({ status: 0, data: null, cancelled: true, uploaded }); };

        x.send(JSON.stringify({ fileBase64: base64, mimeType: 'application/pdf' }));
    });

    // Up to UPLOAD_TRIES tries, each on a new connection; only a stalled upload is retried (anything else is an answer).
    let reply;
    for (let n = 1; n <= UPLOAD_TRIES; n++) {
        reply = await attempt();
        if (reply.cancelled || !reply.stalled || n === UPLOAD_TRIES) break;
        onRetry(n + 1);
    }
    LIVE_ABORT = null;
    return reply;
}

/* An upload that makes no progress for this long is cancelled and tried again. A normal upload pauses for 10 to 20 s near
   the end, so this is well above that; the file itself takes about 25 s on a slow connection. */
const UPLOAD_STALL_MS = 30000;
const UPLOAD_TRIES = 3;

async function analyzeDocumentRun(file) {
    const myRun = ++SCAN_RUN;      // this scan's number; Stop moves SCAN_RUN on, and this scan then ends without a word
    // Whatever breaks inside, the circle that was running turns red and the person is told, never a card that just stops.
    try {
        await analyzeDocumentSteps(file, myRun);
    } catch (err) {
        if (myRun !== SCAN_RUN) return;      // stopped: whatever broke was only the scan being cut off
        console.error('scan failed:', err);
        stopProgress();
        const at = SCAN_STAGE && SCAN_STAGE.stage >= 1 && SCAN_STAGE.stage <= 6 ? SCAN_STAGE.stage : 4;
        failScan(at, 'Something went wrong');
        showAiStatus('Something went wrong while reading the document. Please try again.', 'error');
    }
}

async function analyzeDocumentSteps(file, myRun) {
    if (!file) return;
    const stale = () => myRun !== SCAN_RUN;      // true once Stop was pressed (or a newer scan began): nothing more may touch the page

    const fileIssue = CurriculogicUploadLimits.fileProblem(file, 'pdf');
    if (fileIssue) return showAiStatus(fileIssue, 'error');

    SCAN_REPORT = null;            // a new scan starts: the last report must not sit beside its message
    SCAN_DOC = null;
    ISSUE_I = 0;
    removeBackPill();
    if (SAVE_NOTE && SAVE_NOTE.kind !== 'saving') clearSaveNote();      // a new scan: what the last save said is old news
    SCAN_STAGE = null;
    document.querySelector('.cb-scan')?.remove();      // ...and its card must not stay on screen while the new scan runs

    // 1 PDF read: the browser reads the file.
    setScanStage(1);
    showAiStatus('Reading the file\u2026');
    startProgress();
    let began = Date.now();

    let base64;
    try {
        base64 = await fileToBase64(file);
    } catch (err) {
        if (stale()) return;
        console.error('file read failed:', err);
        stopProgress();
        failScan(1, 'Could not read the file');
        return showAiStatus('Could not read that file.', 'error');
    }
    if (stale()) return;
    await finishStage(1, began);   // 1 is done and was seen; 2 begins
    if (stale()) return;

    // 2 Sent: the file goes up. Its percentage is the real upload. When the last byte is sent, 2 is done and 3 begins.
    showAiStatus('Sending the file\u2026');
    began = Date.now();
    let entered3;
    const inAIStage = new Promise((res) => { entered3 = res; });
    let uploadStarted = began;
    const reply = await postDocument(base64, {
        onProgress: (pct) => {
            if (stale()) return;
            if (SCAN_STAGE && SCAN_STAGE.stage === 2) { SCAN_STAGE.uploadPct = pct; paintScanSteps(); }
        },
        // The upload stopped moving and was cancelled: circle 2 says so and starts again from 0% on a fresh connection.
        onRetry: (n) => {
            if (stale()) return;
            if (SCAN_STAGE && SCAN_STAGE.stage === 2) { SCAN_STAGE.uploadPct = 0; SCAN_STAGE.retry = n; paintScanSteps(); }
            showAiStatus(`The upload stalled. Trying again (${n} of ${UPLOAD_TRIES})…`);
        },
        onUploaded: () => {
            // The whole file is up. Show stage 2 long enough to be seen, then the AI circle starts and counts its seconds.
            // (Stopped meanwhile: nothing is painted, but the wait below is still released so the scan can end.)
            if (stale()) return entered3();
            finishStage(2, uploadStarted).then(() => {
                if (stale()) return entered3();
                SCAN_STAGE = { ...SCAN_STAGE, t3: Date.now() };
                paintScanSteps();
                showAiStatus('Analyzing with AI\u2026 this can take a moment.');
                entered3();
            });
        },
    });

    // Stopped while it was in flight: the answer, if one ever comes, is not read, and nothing turns red.
    if (stale() || reply.cancelled) return;

    if (reply.status === 0 || reply.status >= 400 || !reply.data) {
        console.error('analyze-curriculum-document failed:', reply.status);
        stopProgress();
        if (reply.stalled) {
            // The file stopped going up, three times on three connections: it never reached the server, so the AI was never asked.
            failScan(2, 'The upload kept stalling');
            return showAiStatus('The file could not be sent: the connection kept stalling. Check your connection and try again.', 'error');
        }
        if (reply.timedOut && !reply.uploaded) {
            failScan(2, 'The upload took too long');
            return showAiStatus('The upload took too long. Check your connection and try again.', 'error');
        }
        if (reply.timedOut) {
            // Nothing came back in all that time: the AI is too slow today. Not a lost connection, and not the person's file.
            await inAIStage;
            failScan(3, 'The AI took too long to answer');
            return showAiStatus('The AI took too long to answer. Please try again in a few minutes.', 'error');
        }
        if (reply.networkError) {
            // No answer at all: it stopped while the file was going up (circle 2) or while the AI was reading (circle 3).
            const uploaded = SCAN_STAGE && SCAN_STAGE.stage >= 3;
            const why = uploaded ? 'The connection was lost while the AI was reading. Please try again.'
                                 : 'The file could not be sent. Check your connection and try again.';
            failScan(uploaded ? 3 : 2, uploaded ? 'Connection lost' : 'Could not send the file');
            return showAiStatus(why, 'error');
        }
        // A refusal (signed out, wrong role, too large) is the person's to fix;
        // anything else is the service having a bad moment.
        const why = CurriculogicUploadLimits.aiProblem(reply.status)
            || 'The analysis service failed. Try again in a moment.';
        await inAIStage;           // the AI circle was reached before the server answered
        failScan(3, why);
        return showAiStatus(why, 'error');
    }

    await inAIStage;               // never leave stage 2 unfinished, however fast the answer came back
    if (stale()) return;
    const data = reply.data;
    began = SCAN_STAGE?.t3 ?? Date.now();

    if (data.is_curriculum_document !== true) {
        const reason = data?.rejection_reason || 'This does not appear to be a curriculum or prospectus document.';
        stopProgress();
        failScan(3, 'This does not look like a curriculum');
        return showAiStatus('Rejected: ' + reason, 'error');
    }

    // 3 AI reading is done (the answer is in); 4 Table built begins.
    await finishStage(3, began);
    if (stale()) return;
    began = Date.now();

    const extracted = Array.isArray(data.subjects) ? data.subjects : [];

    if (!extracted.length) {
        stopProgress();
        failScan(4, 'No subjects could be read');
        return showAiStatus('The document was recognized as a curriculum, but no subjects could be extracted. You can still enter them manually below.', 'error');
    }

    // Build every row first, keyed by the code the AI extracted, so
    // prerequisites (which the AI returns as code strings) can be
    // resolved to the correct row's internal uid in a second pass --
    // prereqs are stored as { uid }, not as codes, and a row's uid does
    // not exist until the row itself has been created.
    ROWS = [];
    const byCode = new Map();
    const rowsByKey = new Map();    // key -> every scanned row with that code (normally one)

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
                // Fall back to the code if the AI didn't return a type: FRE*
                // is a free elective, EL* a programme elective, with or
                // without a programme prefix (IT-EL1, BSN-FRE).
                const code = SC.fromPrinted(item.code);
                if (/^(?:[A-Z0-9]+-)?FRE/.test(code))      electiveType = 'FREE';
                else if (/^(?:[A-Z0-9]+-)?EL/.test(code))  electiveType = 'IT';
            }
        }

        const row = blank(year, term, electiveType);
        // Word-authored prospectus PDFs (BSN's is one) autocorrect a typed
        // "-" into an en dash (–) or em dash (—) in codes like
        // "HUM – REP 101". Gemini reads the document as an image and
        // can carry that character through verbatim, which the code check
        // would then reject as punctuation it doesn't recognize -- so it
        // is normalized back to a plain hyphen here, the one place raw
        // AI-extracted text enters ROWS.
        row.code  = SC.fromPrinted(item.code);       // "CS-EL____" (a slot printed with blanks) reads "CS-EL", and is numbered later
        row.title = String(item.title ?? '').trim();
        row.lec   = Number.isFinite(item.lecture_units) ? item.lecture_units : null;
        row.lab   = Number.isFinite(item.laboratory_units) ? item.laboratory_units : null;
        row._aiPrereqCodes = Array.isArray(item.prerequisites) ? item.prerequisites : [];
        row._aiNotes  = Array.isArray(item.prerequisite_notes) ? item.prerequisite_notes : [];
        row._aiCoreqCodes = Array.isArray(item.corequisites) ? item.corequisites : [];
        row._aiMarker = item.footnote_marker ?? null;
        // The kind of course, cleaned to a value the database accepts (null when the document does not show it).
        row.category = window.CurriculogicSubjectCategory?.clean(item.category) ?? null;
        ROWS.push(row);
        if (row.code) {
            byCode.set(SC.key(row.code), row);
            // A code printed twice (a typo in the document) leaves two rows with one key; byCode keeps the later, so remember
            // them all, to tell the row apart from its namesake when a prerequisite names that code.
            const same = rowsByKey.get(SC.key(row.code)) ?? [];
            same.push(row);
            rowsByKey.set(SC.key(row.code), same);
        }
    }

    const FN = window.CurriculogicFootnotes;
    const footnotes = Array.isArray(data.footnotes) ? data.footnotes : [];
    const looseIndex = new Map(ROWS.filter(r => r.code).map(r => [FN.looseKey(r.code), r]));
    const followUps = [];      // what a person still has to add by hand
    const interpreted = [];    // wording the builder turned into a rule
    let gatesAdded = 0;
    let coreqsAdded = 0;

    // A link between two subjects of the SAME semester can only mean "taken together": nobody can pass a subject before the
    // one they are taking beside it. A "Pre / Co-requisite" column (the BSHM prospectus) lists such links with the
    // prerequisites, and the scan read them as prerequisites, which the earlier-semester check then rejected. They become
    // "goes with" links, and each is listed on the check card so a misread cannot slip through unseen.
    const sameTerm = (a, b) => a.year != null && a.term != null && a.year === b.year && a.term === b.term;
    const linkTo = (row, target, wording) => {
        if (target === row || row.prereqs.some(p => p.uid === target.uid)) return;
        if (sameTerm(row, target)) {
            row.prereqs.push({ uid: target.uid, co: true });
            coreqsAdded++;
            interpreted.push(`${row.code}: ${wording} is in the same semester, so it was read as a goes-with (co-requisite) link with ${target.code}`);
        } else {
            row.prereqs.push({ uid: target.uid });
        }
    };

    for (const row of ROWS) {
        // "HM 111, 112, 113" arrives as "HM 111", "112", "113": a bare number takes the letters of the code before it, when
        // that is a subject of this document (shared/js/curriculum/prereqshorthand.js).
        const shorthand = window.CurriculogicPrereqShorthand?.expand(row._aiPrereqCodes, (c) => byCode.has(SC.key(c)));
        if (shorthand) {
            row._aiPrereqCodes = shorthand.codes;
            if (shorthand.expanded.length) {
                interpreted.push(`${row.code}: ${shorthand.expanded.map(e => `"${e.from}"`).join(', ')} read as ${shorthand.expanded.map(e => e.to).join(', ')}`);
            }
        }
        for (const prereqCode of row._aiPrereqCodes) {
            let target = byCode.get(SC.key(prereqCode));
            // A subject never requires itself. When the code is shared by two rows (the BSCS 2023-2024 PDF prints ELDNET1 for both
            // .NET modules) and the later row's prerequisite names it, byCode gives the row ITSELF: use its namesake instead.
            if (target === row) {
                target = (rowsByKey.get(SC.key(prereqCode)) ?? []).find(r => r !== row) ?? null;
                if (!target) {
                    followUps.push(`${row.code}: prerequisite "${prereqCode}" is the subject itself, so it was not linked`);
                    continue;
                }
            }
            // A prerequisite the AI named but that does not match any
            // extracted subject is dropped rather than guessed at -- the
            // reviewer sees the row with that prerequisite simply absent
            // and can add it manually via the existing picker if needed.
            // It is now listed below so it is not lost without a word.
            if (target) linkTo(row, target, `"${prereqCode}"`);
            else followUps.push(`${row.code}: prerequisite "${prereqCode}" is not a subject in this document`);
        }

        // The "Co requisite" column, when the document has one: subjects that go with this one in the
        // same term. Each becomes a "goes with" rule; a code that is no subject here is listed, not guessed.
        const co = window.CurriculogicCorequisites.resolve(
            row._aiCoreqCodes, row, (code) => byCode.get(SC.key(code)));
        for (const target of co.targets) {
            if (!row.prereqs.some(p => p.uid === target.uid)) {
                row.prereqs.push({ uid: target.uid, co: true });
                coreqsAdded++;
            }
        }
        for (const code of co.missing) {
            followUps.push(`${row.code}: co-requisite "${code}" is not a subject in this document`);
        }

        // Prerequisite text the AI kept apart from the codes. A code it put
        // there by mistake (wrapped across lines, or printed without a
        // space: "LEA111") is resolved to its subject; what is left is real
        // non-code text ("All prof courses", "GEC") that has no rule form.
        const { matched, leftover } = FN.resolveNotes(row._aiNotes, looseIndex);
        for (const target of matched) linkTo(row, target, `"${target.code}"`);
        // Wording such as "All CLJ/CDI Subjects" or "Finished Third Year
        // Subjects" is turned into a rule the engine understands. The result
        // is listed for review; text with no defined meaning ("GEC") is left
        // for a person, as before.
        for (const text of leftover) {
            const rule = FN.interpretNote(text, row, ROWS);
            if (rule?.kind === 'subjects') {
                for (const target of rule.targets) {
                    if (!row.prereqs.some(p => p.uid === target.uid)) row.prereqs.push({ uid: target.uid });
                }
                interpreted.push(`${row.code}: "${text}" → ${rule.targets.length} prerequisite${rule.targets.length === 1 ? '' : 's'} (${rule.label})`);
            } else if (rule?.kind === 'standing') {
                if (!row.prereqs.some(p => p.standing && (p.pos ?? p.standing * 10 + 2) === rule.position)) {
                    row.prereqs.push({ standing: Math.floor(rule.position / 10), pos: rule.position });
                }
                interpreted.push(`${row.code}: "${text}" → year-standing gate (${rule.label})`);
            } else {
                followUps.push(`${row.code}: "${text}"`);
            }
        }

        // A footnote mark meaning "finish years 1 to N" is a year-standing
        // gate. It is held to before the subject's own semester so a
        // subject can never be asked to pass itself first.
        if (row._aiMarker) {         // catalogue electives too: they have no semester, so their gate is through year N (22, 32...)
            const y = FN.throughYear(row._aiMarker, footnotes);
            if (y) {
                const pos = FN.standingPositionFor(y, row.year, row.term);
                // Not twice: a prerequisite that says "must finish 1st to 2nd year" in WORDS was already turned into this same gate
                // above (the ACT PDF's Internship and Capstone rows each got two identical gates, 22 Nov 2026).
                const already = row.prereqs.some(p => p.standing && (p.pos ?? p.standing * 10 + 2) === pos);
                if (pos && !already) { row.prereqs.push({ standing: Math.floor(pos / 10), pos }); gatesAdded++; }
            } else if (footnotes.some(f => String(f?.marker ?? '').trim() === String(row._aiMarker).trim())) {
                followUps.push(`${row.code}: "${row._aiMarker}"`);
            }
        }

        delete row._aiPrereqCodes;
        delete row._aiNotes;
        delete row._aiMarker;
        delete row._aiCoreqCodes;
    }

    // A summer block printed under the wrong year (the BSHM prospectus prints the summer between years 1 and 2 under SECOND YEAR) breaks
    // the order of the prerequisites. It is moved to the neighbouring year only when that is what makes them hold, and each move is
    // listed on the check card (shared/js/curriculum/summerplacement.js).
    const moved = [];
    for (const m of window.CurriculogicSummerPlacement?.analyze(ROWS).moves ?? []) {
        m.row.year = m.to;
        moved.push(`${m.row.code}: printed under year ${m.from} summer, placed in year ${m.to} summer because ${m.because}`);
    }

    // What the chains say about the document, from the subjects themselves (shared/js/curriculum/chainanalysis.js): a later part
    // of a sequence that does not lead back to the earlier part, one that comes too early, and the longest chain. Reported only.
    const chain = window.CurriculogicChainAnalysis?.analyze(ROWS) ?? { sequels: [], outOfOrder: [], longest: null };

    TAB = ROWS.find(r => r.year)?.year ?? 1;
    validate();                    // the new rows are checked like any row the builder holds
    await finishStage(4, began);   // 4 Table built is done and was seen; 5 begins
    if (stale()) return;           // stopped while the table was being built: the table was already cleared by Stop
    began = Date.now();

    // 5 Totals checked: the rows against the totals the document itself prints (shared/js/curriculum/extractioncheck.js).
    // The subjects the AI returned are added up and compared, so a missing block (a summer term, a whole year) shows before
    // anything is saved. It reads the AI's raw answer, not the table, so it keeps working however the table is edited later.
    const selfCheck = window.CurriculogicExtractionCheck?.check(extracted, data.printed_totals)
        ?? { checked: false, warnings: [], actualTotal: 0 };

    // The overview under the upload: what went right as well as what needs a look. Made before the final render(), so the
    // card is part of the first paint and survives later renders (a tab switch, an added row) until the rows are replaced.
    SCAN_REPORT = window.CurriculogicExtractionCheck?.overview(extracted, data.printed_totals, {
        prereqLinks: ROWS.reduce((n, r) => n + r.prereqs.filter(p => p.uid != null && !p.co).length, 0),
        gates: gatesAdded,
        coreqs: coreqsAdded,
        followUps,
        interpreted,
        moved,
        chain,
        rowsWithErrors: badRows().length,
    }) ?? null;
    if (SCAN_REPORT) SCAN_REPORT.rowsRef = ROWS;
    // What the file says about itself, kept for the pre-flight: the year and the programme it is printed for.
    SCAN_DOC = { year: data.academic_year ?? null, name: data.program_name ?? null };
    await finishStage(5, began);   // 5 Totals checked is done; 6 begins
    if (stale()) return;
    began = Date.now();

    // 6 Ready: what the person is told, prepared from the checks above.
    const needFixing = badRows().length;
    const needsLook = selfCheck.warnings.length > 0 || SCAN_REPORT?.verdict === 'warn';
    await finishStage(6, began);   // 6 is done: all six circles are green (stage 7)
    if (stale()) return;

    // All six green and the bar at 100%, held for a beat so it is seen, then the result's own circles take over. Without
    // the hold, render() would replace the card in the same tick and the finished row would never appear on screen.
    finishProgress();
    await new Promise((r) => setTimeout(r, 700));
    if (stale()) return;

    PENDING_AI_FILE = null;
    SCAN_STAGE = null;             // the live circles give way to the result's circles (SCAN_REPORT)
    render();

    // showAiStatus re-queries #ai-analyze-status on every call, so it lands on the element inside the freshly-rendered
    // card. What matched and what needs a look is in the scan check card right under this line, so the line is short.
    showAiStatus(
        `Extracted ${extracted.length} subject${extracted.length === 1 ? '' : 's'}.`
        + (needsLook ? ' Some checks need a look: see the scan check below.' : '')
        + (needFixing ? ' Check the Issues card for rows to fix.' : '')
        + ' Review every row below, then press Create to save. Nothing has been saved yet.',
        needsLook ? 'warning' : 'success',
    );
}

/* Pressing Extract again while it runs does nothing: one analysis at a time. A second click used to start a second paid AI
   call and a second progress timer, so the bar jumped back and an old timer could overwrite 100% with its own value.
   The lock is released on every way out (done, rejected, failed). */
const analyzeDocument = SingleFlight.guard(analyzeDocumentRun, {
    onStart: () => setAiBusy(true),
    onEnd: () => setAiBusy(false),
});

/* CANCEL (21 Nov 2026): the file goes, the scan's card and circles go, and the table is cleared. The table then shows what the
   DATABASE holds for the selected year (its saved subjects, or nothing for a new year); nothing saved is ever deleted here. */
function discardUpload(message = 'Cancelled. The file was removed and the table cleared.') {
    PENDING_AI_FILE = null;
    if (SAVE_NOTE && SAVE_NOTE.kind !== 'saving') clearSaveNote();
    SCAN_DOC = null;
    ISSUE_I = 0;
    removeBackPill();
    SCAN_REPORT = null;
    SCAN_STAGE = null;
    stopProgress();

    ROWS = [];
    for (let i = 0; i < 3; i++) ROWS.push(blank(1, 1));
    TAB = 1;
    validate();
    markClean();
    render();

    if (SELECTED_YEAR !== null && OPTS.prospectusId) {
        const mine = ROWS;
        loadExisting(OPTS.prospectusId).then((data) => { if (data && ROWS === mine) applyExisting(data); });
    }
    showAiStatus(message, 'success');
}

/* STOP (22 Nov 2026): the scan is cut while the AI is still reading. The request is aborted in the browser and the scan is told it
   is no longer current, so whatever answer comes back later is never read and cannot refill the table. The file, the circles, the bar
   and the table go, as with Cancel. The server may still finish its one AI call; nothing is saved either way. */
function stopScan() {
    if (!AI_BUSY) return;
    SCAN_RUN++;
    LIVE_ABORT?.();
    LIVE_ABORT = null;
    discardUpload('Scan stopped. Nothing was saved.');
}

/* Esc stops a scan that is running, unless a dialog is open (Esc closes that first). Bound once. */
let STOP_KEY_BOUND = false;
function bindStopKey() {
    if (STOP_KEY_BOUND) return;
    STOP_KEY_BOUND = true;
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || !AI_BUSY) return;
        if (document.querySelector('.cbp-overlay')) return;
        stopScan();
    });
}

/* Asks first when the table holds subjects that are not saved (a scan, or typing); with nothing to lose it just clears. */
function cancelUpload() {
    if (AI_BUSY) return;                                       // a scan is being read: the button is disabled, and so is this
    const unsaved = filled().filter(r => !r.dbId).length;
    if (!unsaved && !isDirty()) return discardUpload();

    document.querySelectorAll('.cbp-overlay').forEach(o => { if (o.querySelector('.cb-cancel')) o.remove(); });

    const el = document.createElement('div');
    el.className = 'cbp-overlay';
    el.innerHTML = `
        <div class="cbp-modal cb-cancel" role="dialog" aria-label="Cancel the upload">
            <div class="cbp-bar">
                <div>
                    <p class="cbp-title">Cancel this upload?</p>
                    <p class="cbp-sub">${unsaved} subject${unsaved === 1 ? '' : 's'} not saved yet</p>
                </div>
                <button class="cbp-close" aria-label="Close">&times;</button>
            </div>
            <div class="cbp-body">
                <p class="cb-cf-ok" style="color:inherit">The file is removed and the table is cleared. Nothing that is already saved in the database is deleted.</p>
            </div>
            <div class="cb-cf-foot">
                <button class="cb-cf-cancel">Keep working</button>
                <button class="cb-cf-danger cb-cf-yes">Cancel and clear the table</button>
            </div>
        </div>`;
    document.body.appendChild(el);

    const close = () => { el.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);

    el.addEventListener('click', (e) => {
        if (e.target === el || e.target.closest('.cbp-close') || e.target.closest('.cb-cf-cancel')) return close();
        if (e.target.closest('.cb-cf-yes')) { close(); discardUpload(); }
    });
}

/* Locks or unlocks the card in place (a full render() would reset the bar). render() reads AI_BUSY too, so a redraw keeps it. */
function setAiBusy(on) {
    AI_BUSY = on;
    const extract = document.getElementById('ai-extract');
    if (extract) {
        extract.disabled = on;
        extract.textContent = on ? 'Extracting…' : 'Extract Subjects';
    }
    for (const id of ['ai-trash', 'ai-close']) {
        const btn = document.getElementById(id);
        if (btn) btn.disabled = on;
    }
    // Cancel stays pressable while a scan runs: it becomes Stop, which cuts the scan (stopScan).
    const stop = document.getElementById('ai-cancel');
    if (stop) {
        stop.textContent = on ? 'Stop' : 'Cancel';
        stop.classList.toggle('is-stop', on);
        stop.title = on ? 'Stop reading the file (Esc)' : 'Remove the file and clear the table';
    }
    // A run that ended without filling the grid (rejected or failed) must not leave the bar frozen part-way; a finished
    // run redraws the card, which starts with the bar hidden.
    if (!on && PROGRESS_VALUE < 100) {
        const bar = document.getElementById('ai-progress');
        if (bar) bar.hidden = true;
        PROGRESS_VALUE = 0;
    }
}

function showAiStatus(msg, cls, details) {
    const el = document.getElementById('ai-analyze-status');
    if (!el) return;
    el.textContent = msg;
    el.className = 'msg' + (cls ? ' ' + cls : '');

    // details: one { title, items } box, or a list of them (several things to check)
    for (const d of [].concat(details ?? [])) {
        if (!d?.items?.length) continue;
        const box = document.createElement('div');
        const head = document.createElement('strong');
        head.textContent = d.title;
        const ul = document.createElement('ul');
        ul.style.margin = '0.35rem 0 0 1.1rem';
        for (const t of d.items) {
            const li = document.createElement('li');
            li.textContent = t;
            ul.appendChild(li);
        }
        box.style.marginTop = '0.5rem';
        box.append(head, ul);
        el.appendChild(box);
    }
}

function clearAiFile() {
    if (AI_BUSY) return;          // the file is being read; removing it now would leave an analysis writing rows for nothing
    PENDING_AI_FILE = null;
    SCAN_DOC = null;
    SCAN_STAGE = null;            // the circles of a stopped scan go with the file
    stopProgress();
    render();
}

/* Paints the bar on the card that is on screen right now. The elements are looked up on every call, because render() can
   replace the card while an analysis is running; a timer holding the old elements would paint nothing. */
function paintProgress() {
    const bar  = document.getElementById('ai-progress');
    const fill = document.getElementById('ai-progress-fill');
    const pct  = document.getElementById('ai-progress-pct');
    if (!bar || !fill || !pct) return;
    bar.hidden = false;
    fill.style.width = PROGRESS_VALUE.toFixed(1) + '%';
    pct.textContent  = Math.round(PROGRESS_VALUE) + '%';
}

function startProgress() {
    stopProgress();               // never two timers: a leftover one would keep painting its own, older value
    PROGRESS_VALUE = 0;
    const t0 = Date.now();
    paintProgress();

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
        // The bar follows the circles, so the two can never disagree (it used to run on its own clock and sat at 95% with
        // three circles still to go). Each stage owns a stretch of the bar; only the AI's reading, which cannot be
        // measured, is an estimate, and it can never pass the start of stage 4:
        //   1 PDF read 0-8 | 2 Sent 8-20 (the real upload %) | 3 AI reading 20-88 (creeping) | 4 -> 92 | 5 -> 96 | 6 -> 99
        const st = SCAN_STAGE;
        let next = PROGRESS_VALUE;
        if (st && !st.failedAt) {
            const sec = st.t3 ? (Date.now() - st.t3) / 1000 : 0;
            if (st.stage === 1)      next = 5;
            else if (st.stage === 2) next = 8 + 0.12 * (st.uploadPct ?? 0);
            else if (st.stage === 3) next = st.t3 ? 20 + 68 * (1 - Math.exp(-sec / 40)) : 20;
            else if (st.stage === 4) next = 92;
            else if (st.stage === 5) next = 96;
            else                     next = 99;
        }
        PROGRESS_VALUE = Math.min(Math.max(PROGRESS_VALUE, next), 99);   // never goes back, never 100 until it is done
        paintProgress();

        // While the AI reads (circle 3) the seconds it has taken are shown; repaint the circles once a second, not every tick.
        if (SCAN_STAGE && !SCAN_STAGE.failedAt && SCAN_STAGE.stage === 3) {
            const sec = Math.floor((Date.now() - (SCAN_STAGE.t3 ?? Date.now())) / 1000);
            if (sec !== SCAN_LAST_SEC) { SCAN_LAST_SEC = sec; paintScanSteps(); }
        }
    }, 100);
}
function finishProgress() {
    stopProgress();
    PROGRESS_VALUE = 100;
    paintProgress();
}

function stopProgress() {
    if (PROGRESS_TIMER) { clearInterval(PROGRESS_TIMER); PROGRESS_TIMER = null; }
}

function runAiExtraction() {
    if (!PENDING_AI_FILE || AI_BUSY) return;
    analyzeDocument(PENDING_AI_FILE);
}

function bind() {
    /* Leaving or reloading the page with work the database does not hold: the browser asks first. (Moving between the
       dashboard's own tabs does not lose it: the table stays in memory.) */
    window.addEventListener('beforeunload', (e) => {
        if (!isDirty()) return;
        e.preventDefault();
        e.returnValue = '';
    });

    /* The "Unsaved changes" badge follows typing. A tick later, so the row has taken the new value first. */
    MOUNT.addEventListener('input',  () => {
        if (SAVE_NOTE && SAVE_NOTE.kind !== 'saving') clearSaveNote();      // an edit makes "Saved" / "Nothing new" old news
        setTimeout(refreshDirty, 0);
    });
    MOUNT.addEventListener('change', () => setTimeout(refreshDirty, 0));

    MOUNT.addEventListener('change', (e) => {

        // AI document upload. Only this input fires change -- the trash,
        // close, and extract buttons all fire click and live in the click
        // handler below. Putting them here meant nothing happened when
        // they were pressed, because a button never emits 'change'.
        if (e.target.id === 'ai-document-input') {
            const file = e.target.files?.[0];
            e.target.value = '';   // allow re-selecting the same file later
            if (!file) return;
            const fileIssue = CurriculogicUploadLimits.fileProblem(file, 'pdf');
            if (fileIssue) return showAiStatus(fileIssue, 'error');
            PENDING_AI_FILE = file;
            SCAN_STAGE = null;     // a new file: no circles of an earlier scan
            render();              // rebuilds the card so it shows the file
            return;
        }

        const pick = e.target.closest('#cb-version-pick');
        if (!pick) return;

        // Handle "Select Year" (empty value)
        if (pick.value === '') {
            if (isDirty() && !confirm('Clear the table? Changes that are not saved yet will be lost.')) {
                pick.value = SELECTED_YEAR ? String(SELECTED_YEAR) : '';
                return;
            }
            SELECTED_YEAR = null;
            OPTS.prospectusId = null;
            rememberYear(null);
            ROWS = [];
            for (let i = 0; i < 3; i++) ROWS.push(blank(1, 1));
            TAB = 1;
            validate();
            markClean();
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

        // Unsaved changes prompt before switching. Only changes the database does not hold count: a year that was just
        // loaded and not touched is not "unsaved", so it no longer asks.
        if (isDirty() && !confirm(
            'Switch curriculum year? Unsaved subjects entered here will be cleared.')) {
            pick.value = SELECTED_YEAR ? String(SELECTED_YEAR) : '';
            return;
        }

        SELECTED_YEAR = year;
        const known = (OPTS.versions ?? []).find(v => v.academic_year === year);
        OPTS.prospectusId = known?.id ?? null;
        rememberYear(year);

        ROWS = [];
        for (let i = 0; i < 3; i++) ROWS.push(blank(1, 1));
        TAB = 1;
        validate();
        markClean();

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

        /* Every row, not only the edited one: a duplicate code makes the
           other row bad or good again, and each row shows its reasons. */
        for (const r of ROWS) {
            const rtr = MOUNT.querySelector(`tr[data-uid="${r.uid}"]`);
            if (!rtr) continue;
            rtr.classList.toggle('cb-bad', r.errors.length > 0);
            const errRow = MOUNT.querySelector(`tr[data-err-for="${r.uid}"]`);
            if (errRow) {
                errRow.hidden = r.errors.length === 0;
                errRow.firstElementChild.textContent = r.errors.join(' ');
            }
        }

        const total = tr.querySelector('.cb-total');
        if (total) total.textContent = unitsOf(row) || '';

        updateStats();
    });

    MOUNT.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        // The arrows are real buttons: Enter on one is a click, handled below, not a jump to the current issue.
        if (e.target.closest('[data-issue-step]')) return;
        if (e.target.closest('[data-jump-issue]')) {
            e.preventDefault();
            jumpToIssue();
        } else if (e.target.closest('.cb-scan-item[data-jump]')) {
            e.preventDefault();
            jumpFromCard(e.target.closest('.cb-scan-item[data-jump]'));
        }
    });

    MOUNT.addEventListener('click', (e) => {

        const stepper = e.target.closest('[data-issue-step]');
        if (stepper) return stepIssue(Number(stepper.dataset.issueStep) || 1);
        const card = e.target.closest('.cb-scan-item[data-jump]');
        if (card) return jumpFromCard(card);
        if (e.target.closest('[data-jump-issue]')) return jumpToIssue();

        /* AI upload actions. These are buttons, so they fire click --
           putting them in the change handler above meant nothing
           happened when they were pressed. */
        if (e.target.closest('#ai-trash') || e.target.closest('#ai-close')) {
            clearAiFile();
            return;
        }
        if (e.target.closest('#ai-cancel')) {
            return AI_BUSY ? stopScan() : cancelUpload();
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

    updateTabCounts();
}

/* The red number on each year tab. render() draws it, but typing does not
   redraw, so without this it kept showing a problem that was already fixed. */
function updateTabCounts() {
    for (const y of [1, 2, 3, 4]) {
        const btn = MOUNT.querySelector(`.cb-tab[data-tab="${y}"]`);
        if (!btn) continue;
        const bad = ROWS.filter(r => r.year === y && r.errors.length).length;
        let badge = btn.querySelector('.cb-count');
        if (!bad) { badge?.remove(); continue; }
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'cb-count';
            btn.append(' ', badge);
        }
        badge.textContent = bad;
    }
}

/* Go to the first problem in curriculum order: open its year tab, scroll
   to the row and put the cursor in its code box. */
/* Takes the person to one row: opens its tab, scrolls to it, puts the cursor in it and lights it up for two seconds. */
function goToRow(row, { back = false } = {}) {
    if (!row) return;

    closePicker();
    showTab(row.year ?? (row.electiveType === 'FREE' ? 'free' : 'it'));

    const tr = MOUNT.querySelector(`tr[data-uid="${row.uid}"]`);
    if (!tr) return;
    tr.scrollIntoView({ block: 'center', behavior: 'smooth' });
    tr.querySelector('input')?.focus({ preventScroll: true });

    tr.classList.add('cb-flash');
    setTimeout(() => tr.classList.remove('cb-flash'), 2200);
    if (back) showBackPill();
}

const issueRows = () => badRows().sort((a, b) => rank(a) - rank(b));

/* The Issues tile: goes to the current issue (the first, until the arrows move it). */
function jumpToIssue() {
    const rows = issueRows();
    if (!rows.length) return;
    ISSUE_I = ((ISSUE_I % rows.length) + rows.length) % rows.length;
    goToRow(rows[ISSUE_I]);
}

/* The arrows on the Issues tile: the next or the previous issue, wrapping round. */
function stepIssue(step) {
    const rows = issueRows();
    if (!rows.length) return;
    ISSUE_I = (((ISSUE_I + step) % rows.length) + rows.length) % rows.length;
    updateStats();              // the "2 of 7" on the tile
    goToRow(rows[ISSUE_I]);
}

/* A card in the scan check: go to the rows it is about, one at a time (each click goes to the next, round and round). */
function jumpFromCard(card) {
    const kind = card.dataset.jump;
    let codes = [];
    try { codes = JSON.parse(card.dataset.codes || '[]'); } catch (_) { /* no codes: the rows below stay empty */ }
    const keys = new Set(codes.map(c => SC.key(c)));
    const rows = (kind === 'issues' ? issueRows() : filled().filter(r => keys.has(SC.key(r.code))))
        .sort((a, b) => rank(a) - rank(b));

    const hint = card.querySelector('.cb-jump-hint');
    if (!rows.length) {
        if (hint) hint.textContent = 'Nothing left to go to — already fixed';
        return;
    }
    const i = (Number(card.dataset.i) || 0) % rows.length;
    card.dataset.i = String(i + 1);
    goToRow(rows[i], { back: true });
    if (hint) hint.textContent = rows.length > 1 ? `Row ${i + 1} of ${rows.length} — click for the next ›` : 'Go to the row ›';
}

/* After a jump from the scan check, a small button to get back to it (it is a long way up the page). Goes after a while,
   or when it is used, or when the scan check itself is gone. */
let BACK_PILL = null;
let BACK_TIMER = null;

function removeBackPill() {
    BACK_PILL?.remove();
    BACK_PILL = null;
    clearTimeout(BACK_TIMER);
}

function showBackPill() {
    if (!document.querySelector('.cb-scan')) return;
    if (!BACK_PILL) {
        BACK_PILL = document.createElement('button');
        BACK_PILL.type = 'button';
        BACK_PILL.id = 'cb-back-pill';
        BACK_PILL.textContent = '↑ Back to the scan check';
        BACK_PILL.addEventListener('click', () => {
            document.querySelector('.cb-scan')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
            removeBackPill();
        });
        document.body.appendChild(BACK_PILL);
    }
    clearTimeout(BACK_TIMER);
    BACK_TIMER = setTimeout(removeBackPill, 15000);
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
        const ph = placeholderOf(r.code);
        if (ph && ph.num !== null) counters[ph.base] = Math.max(counters[ph.base] || 0, ph.num);
    }

    // Pass 2: assign numbers to unnumbered placeholders.
    for (const r of ROWS) {
        if (r.year === null) continue;
        const ph = placeholderOf(r.code);
        if (!ph || ph.num !== null) continue;
        counters[ph.base] = (counters[ph.base] || 0) + 1;
        r.code = `${ph.base}${counters[ph.base]}`;
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
        code:          SC.clean(r.code),
        title:         r.title.trim(),
        units:         unitsOf(r),
        lec_units:     r.lec ?? 0,
        lab_units:     r.lab ?? 0,
        year_level:    r.year,
        term:          r.term,
        is_elective:   isElectiveRow(r),
        elective_type: electiveTypeOf(r),
        category:      r.category ?? null,
    }));
}

/* Reads a row the way rulesync.js needs (see there). */
const RULE_DEPS = {
    key:             (code) => SC.key(code),
    requirementType: (p) => window.CurriculogicCorequisites.requirementType(p),
    standingToDb:    (p) => standingToDb(p),
};

/* Subjects that were already saved are skipped by the inserts below, so edits to THEIR prerequisites used to be lost without a
   word (17 Nov 2026). This rewrites the rules of every saved subject whose conditions changed since it was loaded or last
   saved. The new rules go in first and the old ones are deleted afterwards, so a failure never leaves a subject with none.
   Returns { count, dropped, error }. */
async function syncExistingRules(byCode) {
    const RS = window.CurriculogicRuleSync;
    const result = { count: 0, dropped: 0, error: null };

    for (const r of RS.changedRows(filled(), RULE_DEPS)) {
        const { rules, dropped } = RS.ruleRows(r.dbId, r, ROWS, byCode, RULE_DEPS, OPTS.staffId);
        result.dropped += dropped;

        const old = await SB.from('prerequisite').select('id').eq('subject_id', r.dbId);
        if (old.error) { result.error = 'Could not read the saved rules of ' + r.code + '. ' + old.error.message; break; }

        if (rules.length) {
            const ins = await SB.from('prerequisite').insert(rules);
            if (ins.error) { result.error = 'Could not store the prerequisites of ' + r.code + ' (nothing was changed for it). ' + ins.error.message; break; }
        }

        const oldIds = (old.data ?? []).map(x => x.id);
        if (oldIds.length) {
            const del = await SB.from('prerequisite').delete().in('id', oldIds);
            if (del.error) { result.error = 'The new prerequisites of ' + r.code + ' were stored, but the old ones could not be removed. ' + del.error.message; break; }
        }

        r.savedRules = RS.signature(r, ROWS, RULE_DEPS);
        result.count++;
    }
    return result;
}

async function saveDraft() {
    // Check if there's anything to save
    const rowsToSave = filled();
    if (!rowsToSave.length) {
        return OPTS.onError?.('Nothing to save yet — add a subject first.');
    }

    // Save (unpublished) writes too: it gets the same two refusals as Create.
    const stopped = saveProblems();
    if (stopped.length) return OPTS.onError?.(stopped[0]);

    // Prerequisites refer to rows by uid. Creating the curriculum year in
    // step 1 makes the host remount the builder, which replaces ROWS, so
    // a lookup against ROWS in step 6 found nothing and every prerequisite
    // was silently dropped. Resolve them against this snapshot instead.
    const rowByUid = new Map(rowsToSave.map(r => [r.uid, r]));

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
            return OPTS.onError?.(yearTaken(error) ?? 'Could not create the curriculum year. ' + error.message);
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

    const existingCodes = new Set((existingSubjects ?? []).map(s => SC.key(s.code)));

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
        r.code.trim() && !existingCodes.has(SC.key(r.code))
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
        // No new subjects, but a saved subject's prerequisites may have been edited.
        var syncedOnly = await syncExistingRules(new Map((existingSubjects ?? []).map(s => [SC.key(s.code), s.id])));
        if (syncedOnly.error) { render(); return OPTS.onError?.(syncedOnly.error); }
        markClean();           // the edited rules are saved: nothing is left unsaved
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
        return OPTS.onDone?.(syncedOnly.count
            ? window.CurriculogicRuleSync.message(syncedOnly.count, syncedOnly.dropped)
            : 'All subjects already exist in this curriculum.');
    }

    // ──────────────────────────────────────────────────────────────
    // STEP 4: Save new subjects
    // ──────────────────────────────────────────────────────────────
    const subjectRows = validRows.map(r => ({
        prospectus_id: OPTS.prospectusId,
        created_by: OPTS.staffId,
        code: SC.clean(r.code),
        title: r.title.trim(),
        units: (r.lec || 0) + (r.lab || 0),
        lec_units: r.lec || 0,
        lab_units: r.lab || 0,
        year_level: r.year,
        term: r.term,
        is_elective: isElectiveRow(r),
        is_active: true,
        elective_type: electiveTypeOf(r),
        category: r.category ?? null,
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
    const byCode = new Map(allSubjects.map(s => [SC.key(s.code), s.id]));

    // ──────────────────────────────────────────────────────────────
    // STEP 6: Save prerequisites using the complete map
    // ──────────────────────────────────────────────────────────────
    const ruleRows = [];

    for (const r of validRows) {
        const subjectId = byCode.get(SC.key(r.code));
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
                    threshold_value: standingToDb(p),
                    created_by: OPTS.staffId,
                });
            } else {
                // Find the target subject
                const target = rowByUid.get(p.uid);
                if (target) {
                    const targetCode = SC.key(target.code);
                    const targetId = byCode.get(targetCode);

                    // ⭐ This will now work for BOTH new AND existing subjects
                    if (targetId) {
                        ruleRows.push({
                            subject_id: subjectId,
                            prerequisite_subject_id: targetId,
                            requirement_type: window.CurriculogicCorequisites.requirementType(p),
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

    // Saved subjects whose prerequisites were edited on screen (they were skipped by the inserts above).
    const syncedExisting = await syncExistingRules(byCode);

    // ──────────────────────────────────────────────────────────────
    // STEP 8: Mark rows as saved and update counts
    // ──────────────────────────────────────────────────────────────
    const insertedMap = new Map(inserted.map(s => [SC.key(s.code), s.id]));
    for (const r of validRows) {
        const savedId = insertedMap.get(SC.key(r.code));
        if (savedId) r.dbId = savedId;
    }

    const versionToUpdate = OPTS.versions?.find(v => v.id === OPTS.prospectusId);
    if (versionToUpdate) {
        versionToUpdate.subject_count = (versionToUpdate.subject_count || 0) + inserted.length;
    }

    DRAFT_BATCH = null;
    markClean();           // everything valid is saved now: the table is what the database holds

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

    if (syncedExisting.error) return OPTS.onError?.(syncedExisting.error);

    const message = `${inserted.length} subject${inserted.length === 1 ? '' : 's'} saved with ${ruleRows.length} prerequisite${ruleRows.length === 1 ? '' : 's'}. `
        + (syncedExisting.count ? window.CurriculogicRuleSync.message(syncedExisting.count, syncedExisting.dropped) + ' ' : '')
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
            .select('id, code, title, lec_units, lab_units, year_level, term, elective_type, category')
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
        row.code       = SC.clean(r.code);
        row.title      = r.title ?? '';
        row.lec        = r.lec_units == null ? null : Number(r.lec_units);
        row.lab          = Number(r.lab_units) || null;
        row.labTouched   = true;
        row.electiveType = r.elective_type ?? null;
        row.category     = r.category ?? null;
        row.dbId         = r.id;        // marks this row as already saved

        ROWS.push(row);
        byId.set(r.id, row);
    }

    for (const rule of data.rules) {
        const owner = byId.get(rule.subject_id);
        if (!owner) continue;

        if (rule.requirement_type === 'standing') {
            owner.prereqs.push(standingFromDb(rule.threshold_value));
        } else {
            const target = byId.get(rule.prerequisite_subject_id);
            // A saved "goes with" rule stays one when the curriculum is reopened (it was shown as a pre-requisite).
            if (target) owner.prereqs.push(window.CurriculogicCorequisites.isCoRequisiteRow(rule)
                ? { uid: target.uid, co: true } : { uid: target.uid });
        }
    }

    // What the rules are NOW, remembered so a later Save can tell which saved subjects were edited (rulesync.js).
    for (const row of ROWS) row.savedRules = window.CurriculogicRuleSync.signature(row, ROWS, RULE_DEPS);

    markClean();           // these rows ARE the database's: nothing is unsaved until the person changes one
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
        row.code  = SC.clean(r.code);
        row.title = r.title ?? '';

        // stg_subject holds total units only; split it the way the builder
        // would have, and let the operator correct anything unusual.
        const u = Number(r.units || 0);
        row.lec = u === 3 ? 2 : u;
        row.lab = u === 3 ? 1 : null;
        row.labTouched = true;

        ROWS.push(row);
        byCode.set(SC.key(row.code), row);
    }

    for (const rule of draft.rules) {
        const owner = byCode.get(SC.key(rule.subject_code));
        if (!owner) continue;

        if (rule.requirement_type === 'standing') {
            owner.prereqs.push(standingFromDb(rule.threshold_value));
        } else {
            const target = byCode.get(SC.key(rule.prerequisite_code));
            if (target) owner.prereqs.push(window.CurriculogicCorequisites.isCoRequisiteRow(rule)
                ? { uid: target.uid, co: true } : { uid: target.uid });
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
let CREATE_BUSY = false;       // the check, or the save, is running: a second press does nothing

async function create() {
    if (CREATE_BUSY) return;

    /* Nothing new to write: every subject on screen is already in the database. Say so plainly instead of opening a dialog that ends in
       "0 subjects and 0 rules created", which reads like a failure. Create and Save only ADD subjects and store prerequisite changes: an
       edit to the code, title, units or semester of a subject that is already saved is not stored by either, and must not be passed off
       as "saved". */
    const rows = filled();
    const unsaved = rows.filter(r => !r.dbId).length;
    const ruleEdits = rows.length ? window.CurriculogicRuleSync.changedRows(rows, RULE_DEPS).length : 0;
    if (rows.length && !unsaved && !ruleEdits) {
        if (!isDirty()) {
            setSaveNote('nothing', `Everything is already saved (${rows.length} subject${rows.length === 1 ? '' : 's'}). Nothing new to create.`);
        } else {
            setSaveNote('warn', 'You changed subjects that are already saved. Create and Save only add new subjects and store prerequisite changes: '
                + 'a changed code, title, units or semester is not stored from this table.', 30000);
        }
        focusActions();
        return;
    }

    CREATE_BUSY = true;
    try { await createCheck(); } finally { CREATE_BUSY = false; }
}

async function createCheck() {
    const btn = MOUNT.querySelector('#cb-create');
    if (btn) { btn.disabled = true; btn.textContent = 'Checking\u2026'; }

    // ⭐ NEW: Number placeholders before the pre-flight checks codes against
    // the DB. Otherwise it would compare un-numbered "IT-EL" against the
    // existing "IT-EL1" and miss the collision, then fail on the actual
    // insert with a raw Postgres message.
    normalizeElectiveCodes();
    validate();

    const [taken, others, elsewhere] = await Promise.all([existingCodes(), otherVersions(), otherProgrammes()]);

    if (btn) { btn.disabled = false; btn.textContent = 'Create curriculum'; }

    confirmCreate(preflight(taken, others, elsewhere));
}


let COMMITTING = false;        // a save is running: a second confirm must not start another one

async function commit() {
    if (COMMITTING) return;
    COMMITTING = true;
    setSaveNote('saving', 'Saving… the table will refresh when it is done.');
    try { await commitRows(); }
    finally {
        COMMITTING = false;
        if (SAVE_NOTE?.kind === 'saving') clearSaveNote();      // it did not finish: the error, if any, is shown by the page
    }
}

async function commitRows() {
    if (badRows().length || !filled().length) return;

    // The same refusals as the pre-flight, once more at the last moment: a file for another programme and a curriculum with no year must
    // never reach the database, whichever way this was started.
    const stopped = saveProblems();
    if (stopped.length) { setSaveNote('warn', stopped[0], 30000); return; }

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
            return OPTS.onError?.(yearTaken(error) ?? 'Could not create the curriculum year. ' + error.message);
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

    // Rules second — they need the ids the insert just returned. Also
    // resolve targets against subjects saved earlier (a prior Save
    // (unpublished), or an already-loaded draft, both of which mark a row
    // with dbId) -- without this, a brand-new subject's prerequisite on
    // one of those already-saved subjects can't find its id in `data`
    // (which only holds rows inserted *this* call) and silently drops.
    const byCode = new Map(data.map(s => [SC.key(s.code), s.id]));
    for (const r of filled()) {
        if (r.dbId) byCode.set(SC.key(r.code), r.dbId);
    }
    const rules  = [];

    // Only rows inserted just now need their rules built here -- an
    // already-saved subject's rules were written when IT was saved;
    // rebuilding them again would insert duplicates alongside them.
    for (const r of filled().filter(row => !row.dbId)) {
        const id = byCode.get(SC.key(r.code));
        if (!id) continue;

        r.prereqs.forEach((p, i) => {
            const target = p.uid ? ROWS.find(x => x.uid === p.uid) : null;
            rules.push({
                subject_id:              id,
                prerequisite_subject_id: target
                    ? byCode.get(SC.key(target.code))
                    : null,
                requirement_type: window.CurriculogicCorequisites.requirementType(p),
                rule_type:        'and',
                // Every condition shown on one row is required, so each
                // gets its own group. Groups are ANDed.
                rule_group:       i + 1,
                threshold_value:  p.standing ? standingToDb(p) : null,
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

    // Saved subjects whose prerequisites were edited on screen are not inserted again, so their rules are rewritten here.
    const syncedExisting = await syncExistingRules(byCode);
    if (syncedExisting.error) {
        if (btn) { btn.disabled = false; btn.textContent = 'Create curriculum'; }
        return OPTS.onError?.(syncedExisting.error);
    }

    // The draft has become a curriculum; it should not be offered again.
    if (DRAFT_BATCH) {
        await SB.from('stg_prerequisite').delete().eq('batch_id', DRAFT_BATCH);
        await SB.from('stg_subject').delete().eq('batch_id', DRAFT_BATCH);
        DRAFT_BATCH = null;
    }

    const n = data.length;
    ROWS = [];
    /* The table is empty on purpose and the database now holds the curriculum. Without this the old signature stayed, the
       empty table counted as "unsaved", and mount() kept it instead of reloading the saved subjects (21 Nov 2026). */
    markClean();
    SCAN_DOC = null;               // the file's claims belonged to the table that was just saved
    ISSUE_I = 0;
    removeBackPill();
    // The answer, by the buttons, where the person is looking. The page re-mounts the builder right after this; the note survives that
    // (it is kept while the programme and the year are the same), and the scroll is repeated once the saved table has come back.
    setSaveNote('saved', `Saved: ${n} subject${n === 1 ? '' : 's'} and ${rules.length} rule${rules.length === 1 ? '' : 's'}.`);
    focusActions();
    setTimeout(focusActions, 900);
    OPTS.onDone?.(`${n} subjects and ${rules.length} rules created.`
        + (syncedExisting.count ? ' ' + window.CurriculogicRuleSync.message(syncedExisting.count, syncedExisting.dropped) : ''));
    render();
}


/* ---- entry point ---- */

function mount(supabase, opts) {
    bindStopKey();
    // The page re-mounts the builder after many things (a save, a version list refresh). If the table holds work the
    // database does not have, and the programme is the same, keep the rows: only refresh what the page passed in.
    if (MOUNT && opts?.mountEl && MOUNTED_PROGRAM === (opts.programId ?? null) && isDirty() && filled().length) {
        const keep = OPTS.prospectusId;
        SB = supabase;
        OPTS = { ...opts, prospectusId: keep };
        MOUNT = opts.mountEl;
        render();
        return;
    }

    SB    = supabase;
    OPTS  = opts ?? {};
    MOUNT = opts.mountEl;
    SCAN_DOC = null;               // a fresh mount holds the database's rows, not a scan: no file is making claims
    ISSUE_I = 0;
    removeBackPill();
    // The "Saved" note must outlive the re-mount that follows a save, but not a move to another year or programme.
    if (SAVE_NOTE && (SAVE_NOTE.programId !== (opts.programId ?? null) || SAVE_NOTE.prospectusId !== (opts.prospectusId ?? null))) {
        clearTimeout(SAVE_NOTE_TIMER);
        SAVE_NOTE = null;
    }

    if (!MOUNT) return console.error('CurriculumBuilder: no mount element');

    // A year chosen for another programme must never carry over to this one.
    if (MOUNTED_PROGRAM !== (OPTS.programId ?? null)) SELECTED_YEAR = null;
    MOUNTED_PROGRAM = OPTS.programId ?? null;

    MOUNT.classList.add('cb');

    if (!MOUNT.dataset.bound) {
        bind();
        window.addEventListener('resize', sizeStage);
        MOUNT.dataset.bound = '1';
    }

    /* ⭐ FIX: Do NOT auto-select a year on load.
       The user must manually choose from the dropdown.
       Only restore a previously selected year if it was explicitly set. */
    // Still nothing is chosen FOR the person. But the year THEY last worked on (this session, this programme) is
    // reopened, so coming back to the Curriculum tab, or reloading, continues where they left off. An active year is
    // never reopened here: the builder does not edit an active curriculum.
    if (SELECTED_YEAR === null) {
        const last = recalledYear();
        const v = last == null ? null : (OPTS.versions ?? []).find(x => x.academic_year === last);
        if (v && !v.is_active) SELECTED_YEAR = last;
    }

    if (SELECTED_YEAR === null) {
        OPTS.prospectusId = null;
    } else {
        const chosen = (OPTS.versions ?? []).find(v => v.academic_year === SELECTED_YEAR);
        OPTS.prospectusId = chosen?.id ?? null;
    }

    if (!OPTS.versions?.length) {
        console.warn('CurriculumBuilder: no versions passed — every year will show as New');
    }

    // Start with empty rows, then load the chosen year's saved subjects (below). This used to stop here, so after a save
    // the year stayed selected but its table came back empty and had to be picked again.
    ROWS = [];
    for (let i = 0; i < 3; i++) ROWS.push(blank(1, 1));

    validate();
    markClean();
    render();

    if (SELECTED_YEAR !== null && OPTS.prospectusId) {
        const mine = ROWS;
        loadExisting(OPTS.prospectusId).then((data) => {
            if (data && ROWS === mine) applyExisting(data);   // not if the person has already moved on
        });
    }

    /* Progress is written into the draft curriculum itself now, and
       selecting a year loads it through loadExisting(). The old resume
       prompt read stg_subject, which nothing writes to any more — it would
       offer a stale copy of work that has since moved on. */
}

/* Opens a saved DRAFT year for editing, with its subjects loaded: what the Prospectus tab's "Edit subjects" does.
   v is a version row ({ id, academic_year, is_active }). Returns false when it does not open (an active curriculum is
   not edited here), or when the person says no to losing changes that are not saved. */
function open(v) {
    if (!v || v.is_active || !MOUNT) return false;

    if (v.academic_year !== SELECTED_YEAR && isDirty() && !confirm(
        'Open this curriculum year? Unsaved subjects entered here will be cleared.')) {
        return false;
    }

    if (!(OPTS.versions ?? []).some(x => x.id === v.id)) OPTS.versions = [...(OPTS.versions ?? []), v];

    if (v.academic_year !== SELECTED_YEAR || OPTS.prospectusId !== v.id) {
        SELECTED_YEAR = v.academic_year;
        OPTS.prospectusId = v.id;
        ROWS = [];
        for (let i = 0; i < 3; i++) ROWS.push(blank(1, 1));
        TAB = 1;
        validate();
        markClean();
        render();
        const mine = ROWS;
        loadExisting(v.id).then((data) => { if (data && ROWS === mine) applyExisting(data); });
    }
    rememberYear(v.academic_year);
    return true;
}

window.CurriculumBuilder = {
    mount,
    open,
    isDirty,
    /* The curriculum year the builder is working on (its prospectus id), which can be a year it has just created and the page
       has not heard of yet. The page uses it to follow the builder to a new year. */
    currentId: () => OPTS?.prospectusId ?? null,
    reset: () => { ROWS = []; SEQ = 1; SELECTED_YEAR = null; markClean(); render(); },
};


})();