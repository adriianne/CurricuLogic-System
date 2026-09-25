// prospectusgrid.js — renders a prospectus as the printed curriculum grid.
// Load after config.js and before departmentdashboard.js.
//
// Exposes window.ProspectusGrid.render(supabase, prospectusId, mountEl, statuses, offline).
// No Supabase writes. Read-only, so every actor can reuse it — Faculty
// and Student get the same grid with a status map layered on later.
//
// `offline` is optional: { subjects, rules } already in memory (e.g. the
// student dashboard's ?preview fixture). When supplied, render() skips the
// Supabase query entirely and builds the grid from that data instead. Every
// existing caller (Faculty, Department, and the Student dashboard outside
// preview) passes a real supabase client and no `offline` argument, so
// their behaviour is unchanged.

(function () {
'use strict';

const TERMS = { 1: '1st Semester', 2: '2nd Semester', 3: 'Summer' };
const YEARS = { 1: 'I — First Year', 2: 'II — Second Year',
                3: 'III — Third Year', 4: 'IV — Fourth Year' };

const CATEGORIES = [
    ['GE',               'General Education Courses'],
    ['COMMON_COMPUTING', 'Common Computing Courses'],
    ['PROFESSIONAL_IT',  'Professional IT Courses'],
    ['ELECTIVE',         'IT Electives / Free Electives'],
    ['OTHER',            'Other Courses (PE & NSTP)'],
];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
    c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

const slug = (code) => 'pg-' + String(code).replace(/[^A-Za-z0-9]/g, '');

let CUR = 0;
let MOUNT = null;
let STATUS = null;   // Map subject_id -> { state, detail }

/* Status vocabulary, matching what assess() returns. */
const CHIP = {
    passed:   ['ok',      'Passed'],
    enrolled: ['info',    'Taking'],
    eligible: ['open',    'Can take'],
    retake:   ['danger',  'Retake'],
    blocked:  ['locked',  'Locked'],
};


/*  data  */

/* Standing-condition label, shared by the live query branch and the
   offline branch below — hoisted out of load() so both can call it. */
function describeStanding(pos) {
    const y = Math.floor(pos / 10);
    const t = pos % 10;
    const ord = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th' }[y] || `${y}th`;
    const term = { 1: '1st Sem', 2: '2nd Sem', 3: 'Summer' }[t] || '';

    if (t === 2) {
        // Year-level — printed notation: ** / *** / ****
        return { mark: '*'.repeat(y + 1) };
    }
    return { label: `Through ${ord} Yr, ${term}` };
}

/* Builds the { subjects, rules } shape render() expects from a flat
   subjects array and a flat prerequisite-rows array already in memory —
   the same shape the live query branch below produces after its own
   join. Used by the offline (preview) path. */
function buildFromOffline(offline) {
    const subjects = offline.subjects ?? [];
    const byId = new Map(subjects.map(s => [s.id, s]));

    const rules = new Map();
    for (const p of (offline.rules ?? [])) {
        if (!byId.has(p.subject_id)) continue;   // rule for another version
        if (!rules.has(p.subject_id)) rules.set(p.subject_id, []);

        if (p.requirement_type === 'standing') {
            rules.get(p.subject_id).push(
                describeStanding(Number(p.threshold_value) || 0)
            );
        } else {
            rules.get(p.subject_id).push({
                code: byId.get(p.prerequisite_subject_id)?.code ?? null
            });
        }
    }

    return { subjects, rules };
}

async function load(supabase, prospectusId) {
    const [subs, pres] = await Promise.all([
        supabase.from('subject')
            .select('id, code, title, units, lec_units, lab_units, year_level, term, is_elective, elective_type, category')
            .eq('prospectus_id', prospectusId)
            /* Retired subjects keep their row so existing academic records
               still resolve, but they are no longer part of the curriculum
               and must not appear in it. */
            .eq('is_active', true)
            .order('year_level').order('term').order('code'),
        supabase.from('prerequisite')
            .select('subject_id, prerequisite_subject_id, requirement_type, rule_type, rule_group, threshold_value'),
    ]);

    if (subs.error) throw new Error(subs.error.message);
    if (pres.error) throw new Error(pres.error.message);

    return buildFromOffline({ subjects: subs.data, rules: pres.data });
}


/*  rendering  */

function statusCell(subject) {
    const st = STATUS?.get(subject.id);
    if (!st) return '<td class="pg-st"></td>';

    const [cls, label] = CHIP[st.state] ?? ['', st.state];
    const why = st.detail ? ` title="${esc(st.detail)}"` : '';

    return `<td class="pg-st"><span class="pg-chip ${cls}"${why}>${label}</span></td>`;
}

function preCell(subject, rules) {
    /* The bullet belongs to the eight placeholder slots that sit in a
       semester and mean "choose one from the catalogue". Catalogue courses
       themselves have real prerequisite chains — ELPHP2 requires ELPHP1 —
       and testing is_elective alone painted the marker over all of them. */
    if (subject.is_elective && subject.year_level != null) {
        const m = subject.elective_type === 'FREE' ? '●●' : '●';
        return `<span class="pg-mark">${m}</span>`;
    }

    const list = rules.get(subject.id) || [];
    if (!list.length) return '<span class="no">—</span>';

    return list.map(r => {
        if (r.mark)  return `<span class="pg-mark">${r.mark}</span>`;
        if (r.label) return `<span class="pg-standing">${esc(r.label)}</span>`;
        if (!r.code) return '<span class="no">?</span>';   // dangling rule
        return `<span class="lk" data-jump="${esc(r.code)}">${esc(r.code)}</span>`;
    }).join(', ');
}

function panel(label, rows, rules, showSplit) {
    const total = rows.reduce((a, s) => a + Number(s.units || 0), 0);

    const body = rows.map(s => {
        const lec = Number(s.lec_units ?? 0);
        const lab = Number(s.lab_units ?? 0);
        const st = STATUS?.get(s.id);
        const cls = [s.is_elective ? 'pg-slot' : '', st ? 'is-' + st.state : ''].join(' ').trim();

        // A placeholder elective slot (a real subject has not been chosen
        // yet) gets a clear instruction instead of a blank or generic
        // title, and a link scrolling to the actual catalogue the student
        // picks from. This does not enforce the choice -- the engine has
        // no concept of "this slot is filled" -- it only tells the
        // student honestly that a choice exists and where to make it.
        const isFreeSlot = s.is_elective && /^IT-FRE/.test(s.code);
        const catalogueId = 'pg-catalogue-' + (isFreeSlot ? 'freeelectivecourses' : 'itelectivecourses');
        const titleCell = s.is_elective
            ? `<span class="pg-slot-hint" data-jump-catalogue="${catalogueId}">`
              + `Choose 1 — see ${isFreeSlot ? 'Free' : 'IT'} Elective Courses</span>`
            : esc(s.title);

        return `<tr class="${cls}" id="${slug(s.code)}">
            <td class="pg-code">${esc(s.code)}</td>
            <td>${titleCell}</td>
            ${showSplit ? `<td class="n pg-u">${lec || ''}</td>
                           <td class="n pg-u">${lab || ''}</td>` : ''}
            <td class="n pg-u t">${Number(s.units)}</td>
            <td class="pg-pre">${preCell(s, rules)}</td>
            ${STATUS ? statusCell(s) : ''}
        </tr>`;
    }).join('');

    return `<div class="pg-panel">
        <div class="pg-panel-head">
            <h3>${esc(label)}</h3>
            <span class="pg-note">${rows.length} subject${rows.length === 1 ? '' : 's'}</span>
        </div>
        <table>
            <thead><tr>
                <th>Code</th><th>Descriptive Title</th>
                ${showSplit ? '<th class="n">Lec</th><th class="n">Lab</th>' : ''}
                <th class="n">${showSplit ? 'Tot' : 'Units'}</th>
                <th>Prerequisite</th>
                ${STATUS ? '<th>Status</th>' : ''}</tr></thead>
            <tbody>${body}</tbody>
        </table>
        <div class="pg-foot"><span class="k">Total</span><span class="v">${total} units</span></div>
    </div>`;
}

function summary(all) {
    /* Only scheduled subjects count toward the programme total. Catalogue
       electives have no term — a student picks four to fill the eight
       elective slots, and those slots already carry the 24 units. Summing
       the catalogue as well would report 257 instead of 176. */
    const subjects = all.filter(s => s.term != null);

    const totals = new Map();
    let uncategorised = 0;

    for (const s of subjects) {
        if (!s.category) { uncategorised++; continue; }
        totals.set(s.category, (totals.get(s.category) || 0) + Number(s.units || 0));
    }

    if (uncategorised === subjects.length) {
        return `<div class="pg-empty">
            Subjects are not yet grouped into categories, so the summary
            cannot be totalled. Set <code>subject.category</code> to see it.
        </div>`;
    }

    const grand = subjects.reduce((a, s) => a + Number(s.units || 0), 0);

    return CATEGORIES.map(([key, label]) =>
        `<div class="pg-row"><span>${label}</span>
         <span class="v">${totals.get(key) ?? 0} units</span></div>`).join('')
        + `<div class="pg-row tot"><span>TOTAL</span>
           <span class="v">${grand} units</span></div>`
        + (uncategorised ? `<div class="pg-empty">${uncategorised} subject${
            uncategorised === 1 ? '' : 's'} not yet categorised.</div>` : '');
}

function electivePanel(label, note, rows, rules) {
    if (!rows.length) {
        const emptyId = 'pg-catalogue-' + label.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
        return `<div class="pg-panel" id="${emptyId}">
            <div class="pg-panel-head"><h3>${esc(label)}</h3></div>
            <div class="pg-empty">
                The elective catalogue has not been encoded yet.
            </div>
        </div>`;
    }

    const body = rows.map(s => `<tr id="${slug(s.code)}">
        <td class="pg-code">${esc(s.code)}</td>
        <td>${esc(s.title)}</td>
        <td class="n pg-u t">${Number(s.units)}</td>
        <td class="pg-pre">${preCell(s, rules)}</td>
        ${STATUS ? statusCell(s) : ''}
    </tr>`).join('');

    const panelId = 'pg-catalogue-' + label.replace(/[^A-Za-z0-9]/g, '').toLowerCase();

    return `<div class="pg-panel" id="${panelId}">
        <div class="pg-panel-head">
            <h3>${esc(label)}</h3><span class="pg-note">${esc(note)}</span>
        </div>
        <table>
            <thead><tr><th>Code</th><th>Descriptive Title</th>
            <th class="n">Units</th><th>Prerequisite</th>
            ${STATUS ? '<th>Status</th>' : ''}</tr></thead>
            <tbody>${body}</tbody>
        </table>
    </div>`;
}


/*  stage  */

function sizeStage() {
    const stage = MOUNT?.querySelector('.pg-stage');
    const cur   = MOUNT?.querySelector('#pg-y' + CUR);
    if (stage && cur) stage.style.height = cur.offsetHeight + 'px';
}

function show(i) {
    if (i === CUR) return;
    const back = i < CUR;
    CUR = i;

    MOUNT.querySelectorAll('.pg-tab').forEach((t, j) => t.classList.toggle('on', j === i));
    MOUNT.querySelectorAll('.pg-yr').forEach((y, j) => {
        y.className = 'pg-yr ' + (j === i ? 'on' : 'off ' + (j < i ? 'l' : 'r'));
    });

    sizeStage();
}

function jump(code) {
    const el = MOUNT.querySelector('#' + slug(code));
    if (!el) return;

    const yr = el.closest('.pg-yr');
    if (yr) {
        const idx = [...MOUNT.querySelectorAll('.pg-yr')].indexOf(yr);
        if (idx >= 0) show(idx);
    }

    setTimeout(() => {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.style.transition = 'background .3s';
        el.style.background = 'var(--accent-soft, #EEF2FF)';
        setTimeout(() => { el.style.background = ''; }, 1600);
    }, 60);
}


/*  entry point  */

async function render(supabase, prospectusId, mountEl, statuses = null, offline = null) {
    MOUNT = mountEl;
    CUR = 0;
    STATUS = statuses;
    MOUNT.className = 'pros-grid';
    MOUNT.innerHTML = '<div class="pg-empty">Loading curriculum…</div>';

    let data;
    try {
        data = offline ? buildFromOffline(offline) : await load(supabase, prospectusId);
    } catch (err) {
        console.error('[prospectus grid]', err.message);
        MOUNT.innerHTML = `<div class="pg-empty">Could not load the curriculum.</div>`;
        return;
    }

    const { subjects, rules } = data;

    if (!subjects.length) {
        MOUNT.innerHTML = '<div class="pg-empty">This version has no subjects yet.</div>';
        return;
    }

    // Only show the lec/lab split once it means something. Seeded values
    // put every subject at lab 0, and wrong numbers shown confidently are
    // worse than a column that is not there.
    const showSplit = subjects.some(s => Number(s.lab_units) > 0);

    /* Catalogue electives have no year — a student chooses when to take
       them. Without this filter they produce a phantom "Year null" tab
       alongside the four real ones, on every dashboard. They belong in
       the elective panels below the stage. */
    const years = [...new Set(subjects.map(s => s.year_level))]
        .filter(y => y != null)
        .sort((a, b) => a - b);

    const tabs = years.map((y, i) =>
        `<button class="pg-tab${i === 0 ? ' on' : ''}" data-year="${i}">
            ${YEARS[y] || 'Year ' + y}
         </button>`).join('');

    const stage = years.map((y, i) => {
        const inYear = subjects.filter(s => s.year_level === y);
        const main   = [1, 2].map(t => [t, inYear.filter(s => s.term === t)])
                             .filter(([, rows]) => rows.length);
        const summer = inYear.filter(s => s.term === 3);

        return `<div class="pg-yr ${i === 0 ? 'on' : 'off r'}" id="pg-y${i}">
            <div class="pg-sems">
                ${main.map(([t, rows]) => panel(TERMS[t], rows, rules, showSplit)).join('')}
            </div>
            ${summer.length
                ? `<div class="pg-summer">${panel(TERMS[3], summer, rules, showSplit)}</div>`
                : ''}
        </div>`;
    }).join('');

    // The catalogue lives in elective_group_member once encoded. Until
    // then these render an empty state rather than a blank table.
    /* Catalogue entries are the ones with no year — options a student
       picks, as against the placeholder slots that sit in a semester and
       carry the 24 elective units.

       Split on elective_type rather than the code prefix. The convention
       was wrong on this very curriculum: the free elective slots are coded
       IT-FRE_____, which starts with IT-, so prefix matching filed all
       four of them as IT electives with nothing to flag it. */
    const cat   = subjects.filter(s => s.year_level == null);
    const frEl  = cat.filter(s => s.elective_type === 'FREE');
    const itEl  = cat.filter(s => s.elective_type !== 'FREE');

    MOUNT.innerHTML = `
        <div class="pg-tabs">${tabs}</div>
        <div class="pg-stage">${stage}</div>

        <div class="pg-pair">
            ${electivePanel('IT Elective Courses', 'Choose four · 12 units', itEl, rules)}
            ${electivePanel('Free Elective Courses', 'Choose four · 12 units', frEl, rules)}
        </div>

        <div class="pg-pair">
            <div class="pg-panel">
                <div class="pg-panel-head"><h3>Summary of Courses</h3></div>
                ${summary(subjects)}
            </div>
            <div class="pg-panel">
                <div class="pg-panel-head"><h3>Remarks</h3></div>
                <div class="pg-legend">
                    <div><span class="m">**</span><span class="t">Must finish all 1st year to 2nd year courses</span></div>
                    <div><span class="m">***</span><span class="t">Must finish all 1st year to 3rd year courses</span></div>
                    <div><span class="m">●</span><span class="t">Choose from the IT elective courses</span></div>
                    <div><span class="m">●●</span><span class="t">Choose from the free elective courses</span></div>
                </div>
            </div>
        </div>`;

    MOUNT.addEventListener('click', (e) => {
        const tab = e.target.closest('.pg-tab');
        if (tab) return show(Number(tab.dataset.year));

        const lk = e.target.closest('[data-jump]');
        if (lk) return jump(lk.dataset.jump);

        const catLink = e.target.closest('[data-jump-catalogue]');
        if (catLink) {
            const target = document.getElementById(catLink.dataset.jumpCatalogue);
            if (target) {
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                target.style.transition = 'background .3s';
                target.style.background = 'var(--accent-soft, #EEF2FF)';
                setTimeout(() => { target.style.background = ''; }, 1600);
            }
        }
    });

    sizeStage();
    window.addEventListener('resize', sizeStage);
}

window.ProspectusGrid = { render };

})();   