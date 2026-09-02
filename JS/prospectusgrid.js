// prospectusgrid.js — renders a prospectus as the printed curriculum grid.
// Load after config.js and before departmentdashboard.js.
//
// Exposes window.ProspectusGrid.render(supabase, prospectusId, mountEl).
// No Supabase writes. Read-only, so every actor can reuse it — Faculty
// and Student get the same grid with a status map layered on later.

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


/*  data  */

async function load(supabase, prospectusId) {
    const [subs, pres] = await Promise.all([
        supabase.from('subject')
            .select('id, code, title, units, lec_units, lab_units, year_level, term, is_elective, category')
            .eq('prospectus_id', prospectusId)
            .order('year_level').order('term').order('code'),
        supabase.from('prerequisite')
            .select('subject_id, prerequisite_subject_id, requirement_type, rule_type, rule_group, threshold_value'),
    ]);

    if (subs.error) throw new Error(subs.error.message);
    if (pres.error) throw new Error(pres.error.message);

    const byId = new Map(subs.data.map(s => [s.id, s]));

    // Group prerequisites onto their subject. A standing rule has no
    // prerequisite_subject_id — it becomes a ** or *** marker.
    const rules = new Map();
    for (const p of (pres.data || [])) {
        if (!byId.has(p.subject_id)) continue;   // rule for another version
        if (!rules.has(p.subject_id)) rules.set(p.subject_id, []);

        rules.get(p.subject_id).push(
            p.requirement_type === 'standing'
                ? { mark: '*'.repeat(Math.max(2, Number(p.threshold_value) || 2)) }
                : { code: byId.get(p.prerequisite_subject_id)?.code ?? null }
        );
    }

    return { subjects: subs.data, rules };
}


/*  rendering  */

function preCell(subject, rules) {
    if (subject.is_elective) {
        // Placeholder slots carry a marker, not a prerequisite.
        const m = /^IT-FRE/.test(subject.code) ? '\u25CF\u25CF' : '\u25CF';
        return `<span class="pg-mark">${m}</span>`;
    }

    const list = rules.get(subject.id) || [];
    if (!list.length) return '<span class="no">\u2014</span>';

    return list.map(r => {
        if (r.mark) return `<span class="pg-mark">${r.mark}</span>`;
        if (!r.code) return '<span class="no">?</span>';   // dangling rule
        return `<span class="lk" data-jump="${esc(r.code)}">${esc(r.code)}</span>`;
    }).join(', ');
}

function panel(label, rows, rules, showSplit) {
    const total = rows.reduce((a, s) => a + Number(s.units || 0), 0);

    const body = rows.map(s => {
        const lec = Number(s.lec_units ?? 0);
        const lab = Number(s.lab_units ?? 0);
        return `<tr class="${s.is_elective ? 'pg-slot' : ''}" id="${slug(s.code)}">
            <td class="pg-code">${esc(s.code)}</td>
            <td>${esc(s.title)}</td>
            ${showSplit ? `<td class="n pg-u">${lec || ''}</td>
                           <td class="n pg-u">${lab || ''}</td>` : ''}
            <td class="n pg-u t">${Number(s.units)}</td>
            <td class="pg-pre">${preCell(s, rules)}</td>
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
            </tr></thead>
            <tbody>${body}</tbody>
        </table>
        <div class="pg-foot"><span class="k">Total</span><span class="v">${total} units</span></div>
    </div>`;
}

function summary(subjects) {
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
        return `<div class="pg-panel">
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
    </tr>`).join('');

    return `<div class="pg-panel">
        <div class="pg-panel-head">
            <h3>${esc(label)}</h3><span class="pg-note">${esc(note)}</span>
        </div>
        <table>
            <thead><tr><th>Code</th><th>Descriptive Title</th>
            <th class="n">Units</th><th>Prerequisite</th></tr></thead>
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

async function render(supabase, prospectusId, mountEl) {
    MOUNT = mountEl;
    CUR = 0;
    MOUNT.className = 'pros-grid';
    MOUNT.innerHTML = '<div class="pg-empty">Loading curriculum\u2026</div>';

    let data;
    try {
        data = await load(supabase, prospectusId);
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

    const years = [...new Set(subjects.map(s => s.year_level))].sort();

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
    const itEl  = subjects.filter(s => s.is_elective && /^IT-EL/.test(s.code) === false && /^EL/.test(s.code));
    const frEl  = subjects.filter(s => s.is_elective && /^FRE/.test(s.code));

    MOUNT.innerHTML = `
        <div class="pg-tabs">${tabs}</div>
        <div class="pg-stage">${stage}</div>

        <div class="pg-pair">
            ${electivePanel('IT Elective Courses', 'Choose four \u00b7 12 units', itEl, rules)}
            ${electivePanel('Free Elective Courses', 'Choose four \u00b7 12 units', frEl, rules)}
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
                    <div><span class="m">\u25CF</span><span class="t">Choose from the IT elective courses</span></div>
                    <div><span class="m">\u25CF\u25CF</span><span class="t">Choose from the free elective courses</span></div>
                </div>
            </div>
        </div>`;

    MOUNT.addEventListener('click', (e) => {
        const tab = e.target.closest('.pg-tab');
        if (tab) return show(Number(tab.dataset.year));

        const lk = e.target.closest('[data-jump]');
        if (lk) jump(lk.dataset.jump);
    });

    sizeStage();
    window.addEventListener('resize', sizeStage);
}

window.ProspectusGrid = { render };

})();