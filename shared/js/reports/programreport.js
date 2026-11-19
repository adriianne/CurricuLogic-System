// programreport.js
// The Programme Report: how one programme's students stand, on one page, for the Department and the Registrar.
//
//   ProgramReport.load(supabase, { programId })  -> raw data, read with the signed-in person's own permissions
//   ProgramReport.build(raw, { programName, near, generatedAt })  -> the report (plain data, no browser needed)
//   ProgramReport.html(report) / rows(report) / print(report) / mount(el, getReport)
//
// raw = { students: [{ id, year_level, prospectus_id, record_verified, program_id }],
//         records:  [{ student_id, subject_id, status, units }],
//         prospectuses: [{ id, label, units, active }],     // label "2024–2025", units = the curriculum's total
//         requests: [{ student_id, status }] }
//
// How the numbers are made:
//   Progress          units passed (each subject once) against the total of the student's OWN curriculum; a student with
//                     no curriculum of their own is measured against the programme's active one.
//   Near graduation   a student with 1..near units (default 30) still to earn.
//   No grades yet     the student has no passed, failed or enrolled record at all.
//   Requests          counted per status, over the students of this programme only.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('../records/studentlist.js'), require('./studentreport.js'));
    else root.ProgramReport = factory(root.CurriculogicStudentList, root.StudentReport);
}(typeof self !== 'undefined' ? self : this, function (SL, SR) {
'use strict';

const root = typeof self !== 'undefined' ? self : globalThis;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const NEAR = 30;
const BANDS = [
    { label: 'Under 25%', from: 0, to: 25 },
    { label: '25% to 49%', from: 25, to: 50 },
    { label: '50% to 74%', from: 50, to: 75 },
    { label: '75% and over', from: 75, to: 101 },
];
const REQUEST_STATUSES = [
    ['submitted', 'Waiting for the adviser'],
    ['approved', 'Approved'],
    ['partially_approved', 'Partly approved'],
    ['rejected', 'Rejected'],
    ['withdrawn', 'Withdrawn'],
];

const page = 1000;
async function readAll(make) {
    const all = [];
    for (let from = 0; ; from += page) {
        const { data, error } = await make().range(from, from + page - 1);
        if (error) throw new Error(error.message);
        all.push(...(data ?? []));
        if (!data || data.length < page) break;
    }
    return all;
}

async function load(supabase, { programId = null } = {}) {
    const inProgram = (q) => (programId != null ? q.eq('program_id', programId) : q);
    const students = await readAll(() => inProgram(supabase.from('university_student')
        .select('id, year_level, prospectus_id, record_verified, program_id').order('id')));
    const ids = students.map((s) => s.id);

    const pros = await readAll(() => inProgram(supabase.from('prospectus').select('id, academic_year, is_active, program_id').order('id')));
    const proIds = pros.map((p) => p.id);
    const subjects = proIds.length
        ? await readAll(() => supabase.from('subject').select('id, prospectus_id, units')
            .in('prospectus_id', proIds).not('year_level', 'is', null).eq('is_active', true).order('id'))
        : [];
    const total = new Map();
    for (const s of subjects) total.set(s.prospectus_id, (total.get(s.prospectus_id) || 0) + Number(s.units || 0));
    const prospectuses = pros.map((p) => ({
        id: p.id,
        label: p.academic_year ? `${p.academic_year}–${Number(p.academic_year) + 1}` : 'No year',
        units: total.get(p.id) || 0,
        active: !!p.is_active,
    }));

    // chunks keep the ".in" list short for a large programme
    const chunk = (list, n = 200) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));
    const records = [];
    const requests = [];
    for (const part of chunk(ids)) {
        const recs = await readAll(() => supabase.from('academic_record')
            .select('student_id, subject_id, status, subject:subject_id (units, code, title)').in('student_id', part).order('id'));
        for (const r of recs) records.push({ student_id: r.student_id, subject_id: r.subject_id, status: r.status, units: r.subject?.units, code: r.subject?.code, title: r.subject?.title });
        // Requests are optional: a role that may not read them still gets the rest of the report.
        const { data, error } = await supabase.from('request').select('student_id, status').in('student_id', part);
        if (!error) requests.push(...(data ?? []));
        else requests.unreadable = true;
    }
    return { students, records, prospectuses, requests, requestsUnreadable: requests.unreadable === true };
}

function build(raw, { programName = '', near = NEAR, generatedAt = new Date() } = {}) {
    const students = raw?.students ?? [];
    const pros = new Map((raw?.prospectuses ?? []).map((p) => [p.id, p]));
    const active = (raw?.prospectuses ?? []).find((p) => p.active) ?? null;

    const byStudent = new Map();
    for (const r of raw?.records ?? []) {
        if (!byStudent.has(r.student_id)) byStudent.set(r.student_id, []);
        byStudent.get(r.student_id).push(r);
    }

    const years = new Map();
    const curricula = new Map();
    const bands = BANDS.map((b) => ({ label: b.label, count: 0 }));
    let measured = 0;
    let percentSum = 0;
    let unitsSum = 0;
    let nearGraduation = 0;
    let noGrades = 0;

    for (const s of students) {
        const recs = byStudent.get(s.id) ?? [];
        const pro = (s.prospectus_id != null ? pros.get(s.prospectus_id) : null) ?? active;
        const yl = Number(s.year_level) || 0;
        years.set(yl, (years.get(yl) || 0) + 1);
        const label = pro ? pro.label + (pro.active ? ' (active)' : '') : 'No curriculum';
        curricula.set(label, (curricula.get(label) || 0) + 1);

        if (!recs.length) noGrades++;
        const units = SL.passedUnits(recs);
        unitsSum += units;
        if (pro && pro.units > 0) {
            const pct = Math.min(100, (units / pro.units) * 100);
            measured++;
            percentSum += pct;
            bands[BANDS.findIndex((b) => pct >= b.from && pct < b.to)].count++;
            const left = pro.units - units;
            if (left > 0 && left <= near) nearGraduation++;
        }
    }

    const studentIds = new Set(students.map((s) => s.id));
    const counts = new Map(REQUEST_STATUSES.map(([k]) => [k, 0]));
    let requestTotal = 0;
    for (const q of raw?.requests ?? []) {
        if (!studentIds.has(q.student_id)) continue;
        requestTotal++;
        counts.set(q.status, (counts.get(q.status) || 0) + 1);
    }

    return {
        generatedAt,
        programName,
        near,
        total: students.length,
        noGrades,
        withGrades: students.length - noGrades,
        averagePercent: measured ? Math.round(percentSum / measured) : null,
        averageUnits: students.length ? Math.round((unitsSum / students.length) * 10) / 10 : null,
        nearGraduation,
        years: [...years.entries()].sort((a, b) => a[0] - b[0]).map(([y, count]) => ({ label: y ? SR.yearWord(y) : 'Year not set', count })),
        curricula: [...curricula.entries()].sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count })),
        bands,
        requests: {
            total: requestTotal,
            unreadable: raw?.requestsUnreadable === true,
            byStatus: REQUEST_STATUSES.map(([k, label]) => ({ status: k, label, count: counts.get(k) || 0 })),
        },
    };
}

const stamp = (d) => new Date(d).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });

const CSS = `
  * { box-sizing: border-box; }
  body { font: 10pt/1.35 Arial, Helvetica, sans-serif; color: #111; margin: 0; padding: 14mm; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  h1 { font-size: 16pt; margin: 0 0 2px; }
  .sub { color: #555; margin: 0 0 10px; }
  .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin: 10px 0 14px; }
  .stat { border: 1px solid #bbb; border-radius: 4px; padding: 6px 8px; }
  .stat b { display: block; font-size: 14pt; }
  .stat span { color: #555; font-size: 8.5pt; }
  h2 { font-size: 11pt; margin: 14px 0 4px; border-bottom: 1px solid #999; padding-bottom: 2px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
  th, td { border: 1px solid #bbb; padding: 3px 6px; text-align: left; font-size: 9pt; }
  th { background: #f0f0f0; }
  td.num, th.num { text-align: right; }
  .note { color: #555; font-size: 8.5pt; margin-top: 12px; }
  .sign { display: flex; gap: 40px; margin-top: 28px; }
  .sign div { flex: 1; border-top: 1px solid #111; padding-top: 3px; font-size: 8.5pt; text-align: center; }
  @page { size: A4 portrait; margin: 8mm; }
  @media print { body { padding: 4mm; } }`;

const table = (head, rows) => `<table><thead><tr>${head.map((h, i) => `<th${i ? ' class="num"' : ''}>${esc(h)}</th>`).join('')}</tr></thead>
  <tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td${i ? ' class="num"' : ''}>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

function html(r) {
    const pct = (n) => (r.total ? Math.round((n / r.total) * 100) + '%' : '—');
    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Programme report${r.programName ? ' - ' + esc(r.programName) : ''}</title>
<style>${CSS}</style></head><body>
  <h1>Programme Report</h1>
  <p class="sub">${esc(r.programName || 'All programmes')} · ${r.total} student${r.total === 1 ? '' : 's'}</p>
  <div class="grid">
    <div class="stat"><b>${r.total}</b><span>Students</span></div>
    <div class="stat"><b>${r.averagePercent === null ? '—' : r.averagePercent + '%'}</b><span>Average progress</span></div>
    <div class="stat"><b>${r.nearGraduation}</b><span>Within ${r.near} units of graduating</span></div>
    <div class="stat"><b>${r.noGrades}</b><span>No grades on file yet</span></div>
  </div>
  <h2>Students by year level</h2>${table(['Year level', 'Students', '% of students'], r.years.map((y) => [y.label, y.count, pct(y.count)]))}
  <h2>Students by curriculum</h2>${table(['Curriculum', 'Students', '% of students'], r.curricula.map((c) => [c.label, c.count, pct(c.count)]))}
  <h2>Progress through the degree</h2>${table(['Units earned', 'Students', '% of students'], r.bands.map((b) => [b.label, b.count, pct(b.count)]))}
  <h2>Advising requests</h2>${r.requests.unreadable
        ? '<p>Requests could not be read with this account.</p>'
        : table(['Status', 'Requests'], [...r.requests.byStatus.map((s) => [s.label, s.count]), ['All requests', r.requests.total]])}
  <p class="note">Generated ${esc(stamp(r.generatedAt))} by CurricuLogic. Progress is units passed (each subject once) against the total of the student's own curriculum; a student without one is measured against the programme's active curriculum.</p>
  <div class="sign"><div>Prepared by</div><div>Noted by</div></div>
</body></html>`;
}

function rows(r) {
    const out = [
        ['Programme Report'], ['Programme', r.programName], ['Students', r.total], ['Average progress (%)', r.averagePercent ?? ''],
        ['Average units earned', r.averageUnits ?? ''], [`Within ${r.near} units of graduating`, r.nearGraduation],
        ['No grades on file yet', r.noGrades], ['Generated', stamp(r.generatedAt)], [],
        ['Students by year level'], ['Year level', 'Students'], ...r.years.map((y) => [y.label, y.count]), [],
        ['Students by curriculum'], ['Curriculum', 'Students'], ...r.curricula.map((c) => [c.label, c.count]), [],
        ['Progress through the degree'], ['Units earned', 'Students'], ...r.bands.map((b) => [b.label, b.count]), [],
        ['Advising requests'], ['Status', 'Requests'],
    ];
    if (r.requests.unreadable) out.push(['Not readable with this account', '']);
    else out.push(...r.requests.byStatus.map((s) => [s.label, s.count]), ['All requests', r.requests.total]);
    return out;
}

/* The same report on screen, in the dashboard's own look (cards, tiles, tables). */
function screen(r) {
    const pct = (n) => (r.total ? Math.round((n / r.total) * 100) + '%' : '—');
    const tile = (value, label) => `<div class="stat"><span class="stat-value">${esc(value)}</span><span class="stat-label">${esc(label)}</span></div>`;
    const tbl = (head, body) => `<div class="table-wrap"><table class="data-table"><thead><tr>${head.map((h, i) => `<th${i ? ' class="num"' : ''}>${esc(h)}</th>`).join('')}</tr></thead>
        <tbody>${body.map((x) => `<tr>${x.map((c, i) => `<td${i ? ' class="num"' : ''}>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    const card = (title, inner) => `<section class="card"><div class="card-head"><span class="card-title">${esc(title)}</span></div><div class="card-body">${inner}</div></section>`;
    return `
        <div class="stats is-slim">
            ${tile(r.total, 'Students')}
            ${tile(r.averagePercent === null ? '—' : r.averagePercent + '%', 'Average progress')}
            ${tile(r.nearGraduation, 'Within ' + r.near + ' units of graduating')}
            ${tile(r.noGrades, 'No grades on file yet')}
        </div>
        <div class="report-grid">
            ${card('Students by year level', tbl(['Year level', 'Students', '% of students'], r.years.map((y) => [y.label, y.count, pct(y.count)])))}
            ${card('Students by curriculum', tbl(['Curriculum', 'Students', '% of students'], r.curricula.map((c) => [c.label, c.count, pct(c.count)])))}
            ${card('Progress through the degree', tbl(['Units earned', 'Students', '% of students'], r.bands.map((b) => [b.label, b.count, pct(b.count)])))}
            ${card('Advising requests', r.requests.unreadable
                ? '<p class="dim">Requests cannot be read with this account.</p>'
                : tbl(['Status', 'Requests'], [...r.requests.byStatus.map((x) => [x.label, x.count]), ['All requests', r.requests.total]]))}
        </div>`;
}

function print(report) {
    const w = window.open('', '_blank', 'width=900,height=1100');
    if (!w) return alert('The print window was blocked. Allow pop-ups for this site.');
    w.document.write(html(report));
    w.document.close();
    w.onload = () => { w.focus(); w.print(); };
    setTimeout(() => { try { w.focus(); w.print(); } catch (e) { /* already printing */ } }, 600);
}

/* Print, Excel and CSV buttons in the element; getReport() builds the report when one is pressed. */
function mount(el, getReport) {
    if (!el) return;
    el.innerHTML = `
        <button type="button" class="btn-small" data-rep="print"><i class="fa-solid fa-print" aria-hidden="true"></i> Print report</button>
        <button type="button" class="btn-small" data-rep="xlsx"><i class="fa-solid fa-file-excel" aria-hidden="true"></i> Excel</button>
        <button type="button" class="btn-small" data-rep="csv"><i class="fa-solid fa-file-csv" aria-hidden="true"></i> CSV</button>`;
    el.onclick = (e) => {
        const b = e.target.closest('button[data-rep]');
        const report = b && getReport();
        if (!report) return;
        const name = 'Programme-report-' + root.ReportFile.safeName(report.programName || 'all');
        root.ReportFile.logExport('program_report', b.dataset.rep, null, b.dataset.rep === 'print' ? null : rows(report).length);
        try {
            if (b.dataset.rep === 'print') print(report);
            else if (b.dataset.rep === 'xlsx') root.ReportFile.downloadXlsx(name + '.xlsx', [{ name: 'Programme report', rows: rows(report) }]);
            else root.ReportFile.download(name + '.csv', root.ReportFile.csv(rows(report)));
        } catch (err) { console.warn('programme report failed:', err.message); alert('The report could not be created: ' + err.message); }
    };
}

return { load, build, html, rows, screen, print, mount, NEAR, BANDS };
}));
