// curriculumupload.js — one-file curriculum upload with an editable grid.
//
// Load after config.js and XLSX, before departmentdashboard.js.
// Exposes window.CurriculumUpload.mount(supabase, opts).
//
// The existing two-file path (subjects, then prerequisites) stays as it
// is. This is the layout Department Staff actually work from: one sheet
// shaped like the printed prospectus, prerequisites in a column beside
// each subject.
//
// Sheet columns:
//   code, title, lec, lab, year, term, prerequisite
//
// A row with no year and no term is a catalogue elective. It carries a
// prerequisite chain like any other subject, but it is not scheduled and
// must not count toward the programme unit total — the eight IT-EL and
// IT-FRE slots already carry those 24 units. Summing everything gives
// 257 instead of 176.
//
// The prerequisite cell takes:
//   CC-COMPROG11            one condition
//   IT-OOPROG21, IT-SAD21   two conditions, both required
//   **                      must finish 1st to 2nd year courses
//   ***                     must finish 1st to 3rd year courses
//   (blank)                 no condition
//
// Comma-separated codes become separate rule_groups, because groups are
// ANDed and members within a group are alternatives. Everything printed
// in that column is a hard requirement, so each gets its own group.

(function () {
'use strict';

const HEADERS = ['code', 'title', 'lec', 'lab', 'year', 'term', 'prerequisite'];

const YEAR_LABEL = { 1: 'I — First year', 2: 'II — Second year',
                     3: 'III — Third year', 4: 'IV — Fourth year' };
const TERM_LABEL = { 1: '1st semester', 2: '2nd semester', 3: 'Summer' };

let SB      = null;
let OPTS    = {};
let ROWS    = [];      // parsed, with .errors
let MOUNT   = null;
let CUR_TAB = 0;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
    c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

const norm = (s) => String(s ?? '').trim();
const num  = (v) => { const n = Number(String(v ?? '').trim()); return Number.isFinite(n) ? n : null; };

const isMark = (s) => s === '**' || s === '***';


/* ---- parsing ---- */

function parseSheet(rows) {
    return rows.map((raw, i) => {
        const r = {
            n:      i + 2,                       // sheet row, header is 1
            code:   norm(raw.code).toUpperCase(),
            title:  norm(raw.title),
            lec:    num(raw.lec),
            lab:    num(raw.lab),
            year:   num(raw.year),
            term:   num(raw.term),
            prereq: norm(raw.prerequisite),
            errors: [],
        };

        // No year and no term means a catalogue elective — an option the
        // student picks, not a scheduled subject.
        r.isCatalogue = r.year === null && r.term === null;
        r.units = (r.lec ?? 0) + (r.lab ?? 0);

        return r;
    });
}

function conditionsOf(row) {
    if (!row.prereq) return [];

    return row.prereq.split(',')
        .map(s => norm(s).toUpperCase())
        .filter(Boolean)
        .map(token => isMark(token)
            ? { standing: token.length }         // ** -> 2, *** -> 3
            : { code: token });
}


/* ---- validation ---- */

function validate() {
    const byCode = new Map();

    for (const r of ROWS) {
        r.errors = [];

        if (!r.code)  r.errors.push('Code is missing.');
        if (!r.title) r.errors.push('Title is missing.');

        if (r.code) {
            if (byCode.has(r.code)) {
                r.errors.push(`Code repeats row ${byCode.get(r.code).n}.`);
            } else {
                byCode.set(r.code, r);
            }
        }

        if (r.units <= 0) r.errors.push('Units must be more than zero.');

        if (!r.isCatalogue) {
            if (![1, 2, 3, 4].includes(r.year)) r.errors.push('Year must be 1 to 4.');
            if (![1, 2, 3].includes(r.term))    r.errors.push('Term must be 1, 2 or 3.');
        }
    }

    // Prerequisites must resolve inside this file. A code that does not
    // is not a warning: it creates a rule the engine can never satisfy,
    // so the subject is blocked forever with nothing to show why.
    for (const r of ROWS) {
        for (const c of conditionsOf(r)) {
            if (c.standing) continue;
            if (c.code === r.code) {
                r.errors.push('A subject cannot require itself.');
            } else if (!byCode.has(c.code)) {
                r.errors.push(`Prerequisite ${c.code} is not in this file.`);
            }
        }
    }

    // Cycles. A chain that loops means neither subject can ever be taken.
    const graph = new Map();
    for (const r of ROWS) {
        graph.set(r.code, conditionsOf(r).filter(c => c.code).map(c => c.code));
    }

    const state = new Map();          // 0 unvisited, 1 on stack, 2 done

    function walk(code, path) {
        if (state.get(code) === 2) return null;
        if (state.get(code) === 1) return [...path, code];

        state.set(code, 1);
        for (const next of (graph.get(code) ?? [])) {
            const loop = walk(next, [...path, code]);
            if (loop) return loop;
        }
        state.set(code, 2);
        return null;
    }

    for (const r of ROWS) {
        if (state.get(r.code)) continue;
        const loop = walk(r.code, []);
        if (loop) {
            const row = byCode.get(loop[0]);
            if (row) row.errors.push(`Circular: ${loop.join(' \u2192 ')}`);
        }
    }

    return byCode;
}


/* ---- rendering ---- */

const scheduled = () => ROWS.filter(r => !r.isCatalogue);
const catalogue = () => ROWS.filter(r =>  r.isCatalogue);
const badRows   = () => ROWS.filter(r => r.errors.length);

function summaryHtml() {
    const bad = badRows().length;
    // Only scheduled subjects count. Catalogue electives are options.
    const units = scheduled().reduce((t, r) => t + r.units, 0);

    return `<div class="cu-stats">
        <div class="cu-stat"><p class="k">Rows</p><p class="v">${ROWS.length}</p></div>
        <div class="cu-stat ok"><p class="k">Valid</p><p class="v">${ROWS.length - bad}</p></div>
        <div class="cu-stat ${bad ? 'bad' : ''}"><p class="k">Errors</p><p class="v">${bad}</p></div>
        <div class="cu-stat"><p class="k">Units</p><p class="v">${units}</p>
            <p class="u">scheduled only</p></div>
    </div>`;
}

function rowHtml(r) {
    const bad = r.errors.length > 0;

    // Valid rows stay as text. Turning 85 rows into inputs is slow and
    // invites edits nobody meant to make; a click switches any row over.
    if (!bad) {
        return `<tr data-row="${r.n}">
            <td class="cu-code">${esc(r.code)}</td>
            <td>${esc(r.title)}</td>
            <td class="n">${r.lec ?? ''}</td>
            <td class="n">${r.lab ?? ''}</td>
            <td class="cu-pre">${r.prereq ? esc(r.prereq) : '<span class="dim">—</span>'}</td>
        </tr>`;
    }

    return `<tr data-row="${r.n}" class="cu-bad">
        <td><input data-f="code"   value="${esc(r.code)}"></td>
        <td><input data-f="title"  value="${esc(r.title)}"></td>
        <td class="n"><input data-f="lec" value="${r.lec ?? ''}"></td>
        <td class="n"><input data-f="lab" value="${r.lab ?? ''}"></td>
        <td>
            <input data-f="prereq" value="${esc(r.prereq)}">
            <p class="cu-err">${esc(r.errors[0])}</p>
        </td>
    </tr>`;
}

function panelHtml(label, rows) {
    if (!rows.length) return '';
    const units = rows.reduce((t, r) => t + r.units, 0);

    return `<div class="cu-panel">
        <div class="cu-panel-head">
            <span>${esc(label)}</span>
            <span class="dim">${rows.length} subject${rows.length === 1 ? '' : 's'} \u00b7 ${units} units</span>
        </div>
        <table>
            <thead><tr>
                <th>Code</th><th>Descriptive title</th>
                <th class="n">Lec</th><th class="n">Lab</th><th>Prerequisite</th>
            </tr></thead>
            <tbody>${rows.map(rowHtml).join('')}</tbody>
        </table>
    </div>`;
}

function tabsHtml() {
    const years = [1, 2, 3, 4].filter(y => scheduled().some(r => r.year === y));
    const tabs  = years.map(y => ({ key: y, label: YEAR_LABEL[y],
        bad: scheduled().filter(r => r.year === y && r.errors.length).length }));

    if (catalogue().length) {
        tabs.push({ key: 'el', label: 'Electives',
            bad: catalogue().filter(r => r.errors.length).length });
    }

    return { tabs, html: tabs.map((t, i) =>
        `<button class="cu-tab${i === CUR_TAB ? ' on' : ''}" data-tab="${i}">
            ${esc(t.label)}${t.bad ? ` <span class="cu-count">${t.bad}</span>` : ''}
        </button>`).join('') };
}

function bodyHtml(tabs) {
    const t = tabs[CUR_TAB];
    if (!t) return '';

    if (t.key === 'el') {
        const it  = catalogue().filter(r => !/^FRE/.test(r.code));
        const fre = catalogue().filter(r =>  /^FRE/.test(r.code));
        return panelHtml('IT elective courses', it) +
               panelHtml('Free elective courses', fre);
    }

    return [1, 2, 3]
        .map(term => panelHtml(TERM_LABEL[term],
            scheduled().filter(r => r.year === t.key && r.term === term)))
        .join('');
}

function errorListHtml() {
    const bad = badRows();
    if (!bad.length) return '';

    return `<div class="cu-errors">
        <p class="cu-errors-head">${bad.length} row${bad.length === 1 ? '' : 's'} need attention</p>
        <table>${bad.map(r => `<tr>
            <td class="dim">Row ${r.n}</td>
            <td class="cu-code">${esc(r.code || '—')}</td>
            <td>${esc(r.errors.join(' '))}</td>
        </tr>`).join('')}</table>
    </div>`;
}

function render() {
    const { tabs, html } = tabsHtml();
    const bad = badRows().length;

    MOUNT.innerHTML = summaryHtml()
        + `<div class="cu-tabs">${html}</div>`
        + `<div class="cu-body">${bodyHtml(tabs)}</div>`
        + errorListHtml()
        + `<div class="cu-actions">
            <button class="btn-primary" id="cu-save" ${bad ? 'disabled' : ''}>
                Save ${ROWS.length} subject${ROWS.length === 1 ? '' : 's'}
            </button>
            <button id="cu-download">Download corrected file</button>
            <button id="cu-cancel">Cancel</button>
            <span class="cu-hint">${bad
                ? `Fix all ${bad} error${bad === 1 ? '' : 's'} to save`
                : 'Ready to save'}</span>
        </div>`;
}


/* ---- events ---- */

function bind() {
    MOUNT.addEventListener('click', (e) => {
        const tab = e.target.closest('.cu-tab');
        if (tab) { CUR_TAB = Number(tab.dataset.tab); return render(); }

        if (e.target.closest('#cu-cancel'))   return reset();
        if (e.target.closest('#cu-download')) return download();
        if (e.target.closest('#cu-save'))     return commit();
    });

    // Re-validate as the row is corrected, so the error clears in place.
    MOUNT.addEventListener('change', (e) => {
        const input = e.target.closest('input[data-f]');
        if (!input) return;

        const tr  = input.closest('tr');
        const row = ROWS.find(r => r.n === Number(tr.dataset.row));
        if (!row) return;

        const f = input.dataset.f;
        if (f === 'lec' || f === 'lab') row[f] = num(input.value);
        else if (f === 'code')          row.code = norm(input.value).toUpperCase();
        else if (f === 'prereq')        row.prereq = norm(input.value);
        else                            row[f] = norm(input.value);

        row.units = (row.lec ?? 0) + (row.lab ?? 0);

        validate();
        render();
    });
}


/* ---- file in, file out ---- */

async function readFile(file) {
    if (typeof XLSX === 'undefined') {
        throw new Error('The spreadsheet reader did not load.');
    }

    const buf = await file.arrayBuffer();
    const wb  = XLSX.read(buf, { type: 'array', raw: false, cellDates: false });
    const ws  = wb.Sheets[wb.SheetNames[0]];

    const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });

    if (!rows.length) throw new Error('That file has no rows.');

    const missing = HEADERS.filter(h => !(h in rows[0]));
    if (missing.length) {
        throw new Error('Missing column' + (missing.length === 1 ? ' ' : 's ') + missing.join(', '));
    }

    return rows;
}

function download() {
    // The typos were fixed on screen; the source file still has them.
    const out = ROWS.map(r => ({
        code: r.code, title: r.title,
        lec: r.lec ?? '', lab: r.lab ?? '',
        year: r.year ?? '', term: r.term ?? '',
        prerequisite: r.prereq,
    }));

    const ws = XLSX.utils.json_to_sheet(out, { header: HEADERS });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Curriculum');
    XLSX.writeFile(wb, 'curriculum-corrected.xlsx');
}

function template() {
    const rows = [
        { code: 'CC-INTCOM11',  title: 'Introduction to Computing', lec: 3, lab: '', year: 1, term: 1, prerequisite: '' },
        { code: 'CC-COMPROG11', title: 'Computer Programming 1',    lec: 2, lab: 1,  year: 1, term: 1, prerequisite: '' },
        { code: 'CC-COMPROG12', title: 'Computer Programming 2',    lec: 2, lab: 1,  year: 1, term: 2, prerequisite: 'CC-COMPROG11' },
        { code: 'CC-APPSDEV22', title: "Applications Dev't",        lec: 2, lab: 1,  year: 2, term: 2, prerequisite: 'IT-OOPROG21, IT-SAD21' },
        { code: 'CC-PROFIS10',  title: 'Professional Issues',       lec: 3, lab: '', year: 3, term: 3, prerequisite: '**' },
        { code: 'ELPHP1',       title: 'PHP Programming Module 1',  lec: 3, lab: '', year: '', term: '', prerequisite: 'IT-IMDBSYS31' },
    ];

    const ws = XLSX.utils.json_to_sheet(rows, { header: HEADERS });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Curriculum');
    XLSX.writeFile(wb, 'curriculum-template.xlsx');
}


/* ---- commit ---- */

async function commit() {
    if (badRows().length) return;

    const btn = MOUNT.querySelector('#cu-save');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving\u2026'; }

    const subjects = ROWS.map(r => ({
        prospectus_id: OPTS.prospectusId,
        created_by:    OPTS.staffId,
        code:          r.code,
        title:         r.title,
        units:         r.units,
        lec_units:     r.lec ?? 0,
        lab_units:     r.lab ?? 0,
        year_level:    r.isCatalogue ? null : r.year,
        term:          r.isCatalogue ? null : r.term,
        is_elective:   r.isCatalogue || /^IT-EL|^IT-FRE/.test(r.code),
    }));

    const { data, error } = await SB.from('subject').insert(subjects).select('id, code');

    if (error) {
        console.error('subject insert failed:', error.message);
        if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
        return OPTS.onError?.('Could not save the subjects. ' + error.message);
    }

    // Prerequisites second — they reference the ids just created.
    const byCode = new Map(data.map(s => [s.code, s.id]));
    const rules  = [];

    for (const r of ROWS) {
        const conditions = conditionsOf(r);

        conditions.forEach((c, i) => {
            rules.push({
                subject_id:              byCode.get(r.code),
                prerequisite_subject_id: c.standing ? null : byCode.get(c.code),
                requirement_type:        c.standing ? 'standing' : 'prerequisite',
                rule_type:               'and',
                // Each printed condition is required, so each is its own
                // group. Alternatives would share one.
                rule_group:              i + 1,
                threshold_value:         c.standing ?? null,
                created_by:              OPTS.staffId,
            });
        });
    }

    if (rules.length) {
        const res = await SB.from('prerequisite').insert(rules);
        if (res.error) {
            console.error('prerequisite insert failed:', res.error.message);
            return OPTS.onError?.(
                `Subjects saved, but the rules failed: ${res.error.message}. ` +
                'Remove the subjects and try again, or add the rules by hand.');
        }
    }

    const n = subjects.length;
    reset();
    OPTS.onDone?.(`${n} subject${n === 1 ? '' : 's'} and ${rules.length} rule${rules.length === 1 ? '' : 's'} saved.`);
}

function reset() {
    ROWS = [];
    CUR_TAB = 0;
    if (MOUNT) MOUNT.innerHTML = '';
    OPTS.onReset?.();
}


/* ---- entry point ---- */

function mount(supabase, opts) {
    SB    = supabase;
    OPTS  = opts ?? {};
    MOUNT = opts.mountEl;

     if (MOUNT && MOUNT !== opts.mountEl) reset();
    if (window.__cuBound) { SB = supabase; OPTS = opts; MOUNT = opts.mountEl; return; }
    window.__cuBound = true;

    if (!MOUNT) return console.error('CurriculumUpload: no mount element');

    MOUNT.classList.add('cu');
    bind();

    opts.fileInput?.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        MOUNT.innerHTML = '<p class="cu-loading">Reading the file\u2026</p>';

        try {
            ROWS = parseSheet(await readFile(file));
            validate();
            CUR_TAB = 0;
            render();
        } catch (err) {
            MOUNT.innerHTML = '';
            OPTS.onError?.(err.message);
        }
    });

    opts.templateBtn?.addEventListener('click', template);
}

window.CurriculumUpload = { mount, reset };

})();