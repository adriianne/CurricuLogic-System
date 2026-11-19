// studentreport.js
// The Student Academic Report: one student's whole record on one printable page, for the Registrar and the Faculty adviser.
//
//   StudentReport.build({ student, program, curriculum, totalUnits, records, plan, generatedAt })  -> the report (plain data)
//   StudentReport.html(report)      -> a full printable page (A4; "Save as PDF" in the print window gives a PDF)
//   StudentReport.rows(report)      -> rows for CSV / Excel: a summary block, then one line per subject attempt
//   StudentReport.print(report)     opens the print window (browser only)
//
// student  { first_name, last_name, student_id, year_level, email }
// records  [{ subject_id, subject_code, subject_title, units, status, grade, grade_points, taken_term, taken_year }]
// plan     the approved plan of this term, if any: { reference, term, year, items: [{ code, title, units, schedule }] }
//
// What the numbers mean (the page says so too):
//   Units earned    each passed subject counts once, however many times it was recorded.
//   Average grade   the units-weighted mean of the grade points of the passed subjects (1.00 is the best). Shown only when
//                   every passed subject has a numeric grade, so it is never a guess.
//   Retakes         subjects that were failed and later passed, and subjects still failed (not yet retaken).

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('../records/recordgrades.js'), require('../records/studentlist.js'));
    else root.StudentReport = factory(root.CurriculogicRecordGrades, root.CurriculogicStudentList);
}(typeof self !== 'undefined' ? self : this, function (RG, SL) {
const root = typeof self !== 'undefined' ? self : globalThis;
'use strict';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ORD = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th', 5: '5th' };
const yearWord = (y) => (Number(y) ? `${ORD[Number(y)] ?? Number(y) + 'th'} Year` : '—');
const key = (r) => r.subject_id ?? r.subject_code;

function build({ student = {}, program = null, curriculum = '', totalUnits = 0, records = [], plan = null, generatedAt = new Date() } = {}) {
    const recs = (records ?? []).filter(Boolean);
    const total = Number(totalUnits) || 0;
    const prog = SL.progress(recs, total);

    const passedKeys = new Set(recs.filter((r) => r.status === 'PASSED').map(key));
    const failedKeys = new Set(recs.filter((r) => r.status === 'FAILED').map(key));
    const takingKeys = new Set(recs.filter((r) => r.status === 'ENROLLED').map(key));
    const retaken = [...failedKeys].filter((k) => passedKeys.has(k));
    const stillFailed = [...failedKeys].filter((k) => !passedKeys.has(k));

    // the average of the passing attempts' grade points, weighted by units
    let weighted = 0;
    let weight = 0;
    let numeric = true;
    for (const k of passedKeys) {
        const best = RG.pick(recs.filter((r) => key(r) === k));
        const row = recs.filter((r) => key(r) === k && r.status === 'PASSED')[0];
        const pts = Number(best?.grade);
        if (!best || !Number.isFinite(pts)) { numeric = false; break; }
        const u = Number(row?.units) || 0;
        weighted += pts * u;
        weight += u;
    }
    const average = numeric && weight > 0 ? Math.round((weighted / weight) * 100) / 100 : null;

    const groups = RG.groupByTerm(recs).map((g) => ({
        label: g.label,
        subjects: g.subjects,
        passed: g.passed,
        unitsEarned: g.unitsEarned,
        rows: g.rows.map((r) => {
            const shown = r.status === 'DROPPED' ? { grade: 'Dropped' } : (r.status === 'ENROLLED' ? null : RG.pick([r]));
            return {
                code: r.subject_code ?? '',
                title: r.subject_title ?? '',
                units: Number(r.units) || 0,
                grade: shown ? shown.grade : '',
                status: RG.chipFor(r.status)[1],
            };
        }),
    }));

    return {
        generatedAt,
        student: {
            name: [student.first_name, student.last_name].filter(Boolean).join(' '),
            id: student.student_id ?? '',
            yearLevel: student.year_level ?? null,
            email: student.email ?? '',
        },
        program: program ?? '',
        curriculum: curriculum ?? '',
        units: prog.units,
        totalUnits: total,
        percent: prog.percent,
        counts: { passed: passedKeys.size, failed: stillFailed.length, retaken: retaken.length, taking: takingKeys.size },
        average,
        groups,
        plan: plan ? {
            reference: plan.reference ?? '',
            term: plan.term ?? '',
            items: (plan.items ?? []).map((i) => ({ code: i.code ?? '', title: i.title ?? '', units: Number(i.units) || 0, schedule: i.schedule ?? '' })),
        } : null,
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
  .bar { height: 7px; background: #e3e3e3; border-radius: 4px; overflow: hidden; margin: 2px 0 12px; }
  .bar i { display: block; height: 100%; background: #333; }
  h2 { font-size: 11pt; margin: 14px 0 4px; border-bottom: 1px solid #999; padding-bottom: 2px; }
  h3 { font-size: 10pt; margin: 10px 0 3px; }
  h3 small { font-weight: normal; color: #555; margin-left: 6px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
  th, td { border: 1px solid #bbb; padding: 3px 6px; text-align: left; font-size: 9pt; }
  th { background: #f0f0f0; }
  td.num, th.num { text-align: right; }
  .note { color: #555; font-size: 8.5pt; margin-top: 12px; }
  .sign { display: flex; gap: 40px; margin-top: 28px; }
  .sign div { flex: 1; border-top: 1px solid #111; padding-top: 3px; font-size: 8.5pt; text-align: center; }
  tr { break-inside: avoid; }
  @page { size: A4 portrait; margin: 8mm; }
  @media print { body { padding: 4mm; } }`;

function html(report) {
    const r = report;
    const avg = r.average === null ? '—' : r.average.toFixed(2);
    const groups = r.groups.map((g) => `
  <h3>${esc(g.label)}<small>${g.subjects} subject${g.subjects === 1 ? '' : 's'} · ${g.passed} passed · ${g.unitsEarned} units earned</small></h3>
  <table><thead><tr><th>Code</th><th>Descriptive title</th><th class="num">Units</th><th class="num">Grade</th><th>Status</th></tr></thead>
  <tbody>${g.rows.map((x) => `<tr><td>${esc(x.code)}</td><td>${esc(x.title)}</td><td class="num">${x.units || ''}</td><td class="num">${esc(x.grade)}</td><td>${esc(x.status)}</td></tr>`).join('')}</tbody></table>`).join('');
    const plan = r.plan && r.plan.items.length ? `
  <h2>Approved plan${r.plan.term ? ' · ' + esc(r.plan.term) : ''}${r.plan.reference ? ' · ' + esc(r.plan.reference) : ''}</h2>
  <table><thead><tr><th>Code</th><th>Descriptive title</th><th class="num">Units</th><th>Schedule</th></tr></thead>
  <tbody>${r.plan.items.map((x) => `<tr><td>${esc(x.code)}</td><td>${esc(x.title)}</td><td class="num">${x.units || ''}</td><td>${esc(x.schedule)}</td></tr>`).join('')}</tbody></table>` : '';
    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Academic report - ${esc(r.student.name)}</title>
<style>${CSS}</style></head><body>
  <h1>Student Academic Report</h1>
  <p class="sub">${esc(r.student.name)} · ${esc(r.student.id)} · ${esc(yearWord(r.student.yearLevel))}${r.program ? ' · ' + esc(r.program) : ''}${r.curriculum ? ' · Curriculum ' + esc(r.curriculum) : ''}</p>
  <div class="grid">
    <div class="stat"><b>${r.units}${r.totalUnits ? ' / ' + r.totalUnits : ''}</b><span>Units earned</span></div>
    <div class="stat"><b>${r.counts.passed}</b><span>Subjects passed</span></div>
    <div class="stat"><b>${r.counts.failed}</b><span>Failed, not yet retaken</span></div>
    <div class="stat"><b>${avg}</b><span>Average grade (1.00 is best)</span></div>
  </div>
  ${r.totalUnits ? `<div class="bar"><i style="width:${Math.max(0, Math.min(100, r.percent))}%"></i></div>` : ''}
  <p class="sub">${r.totalUnits ? r.percent + '% of the degree · ' : ''}${r.counts.retaken} retaken and passed · ${r.counts.taking} being taken now</p>
  <h2>Grades by term</h2>${groups || '<p>No grades are on file.</p>'}${plan}
  <p class="note">Generated ${esc(stamp(r.generatedAt))} by CurricuLogic. Units earned count each passed subject once. The average grade is weighted by units and is shown only when every passed subject has a numeric grade.</p>
  <div class="sign"><div>Prepared by</div><div>Verified by</div></div>
</body></html>`;
}

function rows(report) {
    const r = report;
    const out = [
        ['Student Academic Report'],
        ['Name', r.student.name],
        ['Student ID', r.student.id],
        ['Year level', yearWord(r.student.yearLevel)],
        ['Programme', r.program],
        ['Curriculum', r.curriculum],
        ['Units earned', r.units],
        ['Total units', r.totalUnits || ''],
        ['Progress (%)', r.totalUnits ? r.percent : ''],
        ['Subjects passed', r.counts.passed],
        ['Failed, not yet retaken', r.counts.failed],
        ['Retaken and passed', r.counts.retaken],
        ['Average grade', r.average === null ? '' : r.average],
        ['Generated', stamp(r.generatedAt)],
        [],
        ['Term', 'Code', 'Descriptive title', 'Units', 'Grade', 'Status'],
    ];
    for (const g of r.groups) for (const x of g.rows) out.push([g.label, x.code, x.title, x.units, x.grade, x.status]);
    return out;
}

function print(report) {
    const w = window.open('', '_blank', 'width=900,height=1100');
    if (!w) return alert('The print window was blocked. Allow pop-ups for this site.');
    w.document.write(html(report));
    w.document.close();
    w.onload = () => { w.focus(); w.print(); };
    setTimeout(() => { try { w.focus(); w.print(); } catch (e) { /* already printing */ } }, 600);
}

/* Three buttons in the element: print (or save as PDF), Excel, CSV. getReport() builds the report when a button is pressed,
   so it always reflects the record on screen. */
function mount(el, getReport) {
    if (!el) return;
    el.innerHTML = `
        <button type="button" class="btn-small" data-rep="print"><i class="fa-solid fa-print" aria-hidden="true"></i> Student report</button>
        <button type="button" class="btn-small" data-rep="xlsx"><i class="fa-solid fa-file-excel" aria-hidden="true"></i> Excel</button>
        <button type="button" class="btn-small" data-rep="csv"><i class="fa-solid fa-file-csv" aria-hidden="true"></i> CSV</button>`;
    el.onclick = (e) => {
        const b = e.target.closest('button[data-rep]');
        if (!b) return;
        const report = getReport();
        if (!report) return;
        const name = 'Student-report-' + root.ReportFile.safeName(report.student.id || report.student.name);
        root.ReportFile.logExport('student_report', b.dataset.rep === 'print' ? 'print' : b.dataset.rep, report.student.id || null, b.dataset.rep === 'print' ? null : rows(report).length);
        try {
            if (b.dataset.rep === 'print') print(report);
            else if (b.dataset.rep === 'xlsx') root.ReportFile.downloadXlsx(name + '.xlsx', [{ name: 'Student report', rows: rows(report) }]);
            else root.ReportFile.download(name + '.csv', root.ReportFile.csv(rows(report)));
        } catch (err) { console.warn('student report failed:', err.message); alert('The report could not be created: ' + err.message); }
    };
}

return { build, html, rows, print, mount, yearWord };
}));
