// analytics.js
// Academic Analytics for the Department: where students struggle, how far they have got, how requests are decided, and
// which sections are in demand. It builds on the Programme report's data (ProgramReport.load) plus the term's section demand.
//
//   Analytics.loadDemand(supabase, { year, term, programId })  -> rows of the section_demand function ([] when it cannot be read)
//   Analytics.loadTotals(supabase, { year, term, programId })  -> one row per section plus an overall row (section_demand_totals, db/125); null when unreadable
//   Analytics.build(raw, demandRows, { programName, generatedAt, topN, totals })  -> the analytics (plain data)
//   Analytics.screen(a) / html(a) / rows(a) / print(a) / mount(el, getAnalytics)
//
// What each part means:
//   Hardest subjects   per subject: students who passed, who failed, and the fail rate = failed / (passed + failed), counting
//                      each student once per subject (a student who failed and then passed counts as passed). Dropped and
//                      still-enrolled records are not outcomes yet. Only subjects with at least one fail are listed.
//   Units earned       how many students sit in each band of units passed (each subject once).
//   Request funnel     requests sent, and how they ended. Approval rate = approved or partly approved, out of the requests
//                      the adviser has decided (approved + partly approved + rejected). Withdrawn ones are not decisions.
//   Section demand     for the term, APPROVED students only (db/125): a student counts once in every section where the adviser
//                      approved at least one of their subjects, so an irregular student (subjects from two sections) is in both.
//                      "Take only some of its subjects" notes how many of a section's students are irregular there. "Reported
//                      full at EDP" is how many students told the system a subject of the section was full at the EDP office;
//                      a student the EDP office turned away (full / time clash) is not counted as seated (db/123). The line under
//                      the table gives the students in total, each once, and how many appear in more than one section.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('../records/studentlist.js'));
    else root.Analytics = factory(root.CurriculogicStudentList);
}(typeof self !== 'undefined' ? self : this, function (SL) {
'use strict';

const gRoot = typeof self !== 'undefined' ? self : globalThis;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const TOP = 10;
const UNIT_BANDS = [
    { label: 'Under 25', from: 0, to: 25 }, { label: '25 to 49', from: 25, to: 50 }, { label: '50 to 74', from: 50, to: 75 },
    { label: '75 to 99', from: 75, to: 100 }, { label: '100 to 124', from: 100, to: 125 }, { label: '125 to 149', from: 125, to: 150 },
    { label: '150 and over', from: 150, to: Infinity },
];

/* programId (optional): only the sections of that programme (db/131). Left out, every programme the account covers, as before. */
const demandArgs = (year, term, programId) => {
    const args = { p_year: year, p_term: term };
    if (programId != null) args.p_program_id = programId;
    return args;
};

async function loadDemand(supabase, { year, term, programId } = {}) {
    if (year == null || term == null) return [];
    const { data, error } = await supabase.rpc('section_demand', demandArgs(year, term, programId));
    return error ? [] : (data ?? []);
}

async function loadTotals(supabase, { year, term, programId } = {}) {
    if (year == null || term == null) return null;
    const { data, error } = await supabase.rpc('section_demand_totals', demandArgs(year, term, programId));
    return error ? null : (data ?? []);
}

function build(raw, demandRows = [], { programName = '', generatedAt = new Date(), topN = TOP, totals = null } = {}) {
    const students = raw?.students ?? [];
    const ids = new Set(students.map((s) => s.id));

    // ---- hardest subjects: one outcome per student and subject
    const outcome = new Map();   // code|student -> 'PASSED' | 'FAILED'
    const names = new Map();
    for (const r of raw?.records ?? []) {
        if (!ids.has(r.student_id)) continue;
        if (r.status !== 'PASSED' && r.status !== 'FAILED') continue;
        const code = r.code || String(r.subject_id);
        names.set(code, r.title || '');
        const k = code + '\u0000' + r.student_id;
        if (outcome.get(k) !== 'PASSED') outcome.set(k, r.status);
    }
    const bySubject = new Map();
    for (const [k, status] of outcome) {
        const code = k.split('\u0000')[0];
        if (!bySubject.has(code)) bySubject.set(code, { code, title: names.get(code) || '', passed: 0, failed: 0 });
        bySubject.get(code)[status === 'PASSED' ? 'passed' : 'failed']++;
    }
    const subjects = [...bySubject.values()]
        .filter((s) => s.failed > 0)
        .map((s) => ({ ...s, failRate: Math.round((s.failed / (s.passed + s.failed)) * 100) }))
        .sort((a, b) => b.failRate - a.failRate || b.failed - a.failed || a.code.localeCompare(b.code));

    // ---- units earned bands
    const perStudent = new Map();
    for (const r of raw?.records ?? []) {
        if (!perStudent.has(r.student_id)) perStudent.set(r.student_id, []);
        perStudent.get(r.student_id).push(r);
    }
    const units = UNIT_BANDS.map((b) => ({ label: b.label, count: 0 }));
    for (const s of students) {
        const u = SL.passedUnits(perStudent.get(s.id) ?? []);
        units[UNIT_BANDS.findIndex((b) => u >= b.from && u < b.to)].count++;
    }

    // ---- request funnel
    const n = { submitted: 0, approved: 0, partially_approved: 0, rejected: 0, withdrawn: 0 };
    let sent = 0;
    for (const q of raw?.requests ?? []) {
        if (!ids.has(q.student_id)) continue;
        sent++;
        if (q.status in n) n[q.status]++;
    }
    const decided = n.approved + n.partially_approved + n.rejected;
    const funnel = {
        sent,
        waiting: n.submitted,
        approved: n.approved,
        partlyApproved: n.partially_approved,
        rejected: n.rejected,
        withdrawn: n.withdrawn,
        decided,
        approvalRate: decided ? Math.round(((n.approved + n.partially_approved) / decided) * 100) : null,
        unreadable: raw?.requestsUnreadable === true,
    };

    // ---- section demand: approved students per section (db/125). The sections offered this term come from section_demand, so a
    // section nobody has been approved into still shows, with 0.
    const num = (v) => Math.max(0, Number(v) || 0);
    const bySection = new Map();
    for (const d of demandRows ?? []) bySection.set(d.section, { section: d.section, students: 0, partial: 0, reportedFull: 0 });
    const demandReadable = Array.isArray(totals);
    let overall = null;
    for (const t of totals ?? []) {
        if (t.section === null || t.section === undefined) {
            overall = { students: num(t.students), multiSection: num(t.partial), reportedFull: num(t.reported_full) };
            continue;
        }
        if (!bySection.has(t.section)) bySection.set(t.section, { section: t.section, students: 0, partial: 0, reportedFull: 0 });
        Object.assign(bySection.get(t.section), { students: num(t.students), partial: num(t.partial), reportedFull: num(t.reported_full) });
    }
    const sections = [...bySection.values()].sort((a, b) => b.students - a.students || a.section.localeCompare(b.section));

    return {
        generatedAt, programName, topN, students: students.length,
        hardest: { total: subjects.length, top: subjects.slice(0, topN) },
        units, funnel,
        demand: { readable: demandReadable, sections: sections.slice(0, topN), totalSections: sections.length, overall, any: sections.length > 0 },
    };
}

const stamp = (d) => new Date(d).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });
/* The line under the section table: approved students in total, each once. */
const overallText = (o) => (o
    ? `${o.students} student${o.students === 1 ? '' : 's'} approved in total, each counted once${o.multiSection ? `. ${o.multiSection} take subjects from more than one section, so they appear in each of those rows` : ''}.`
    : '');
const pctText = (v) => (v === null ? '—' : v + '%');

/* A row with a horizontal bar: the length is value / max. Colour is set by the page's own CSS. */
const bar = (value, max) => `<span class="an-bar"><i style="width:${max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0}%"></i></span>`;

function screen(a) {
    const card = (title, note, inner) => `<section class="card"><div class="card-head"><span class="card-title">${esc(title)}</span><span class="card-note">${esc(note)}</span></div><div class="card-body">${inner}</div></section>`;
    const tbl = (head, body) => `<div class="table-wrap"><table class="data-table"><thead><tr>${head.map((h, i) => `<th${i ? ' class="num"' : ''}>${esc(h)}</th>`).join('')}</tr></thead><tbody>${body.join('')}</tbody></table></div>`;
    const maxFail = Math.max(0, ...a.hardest.top.map((s) => s.failRate));
    const hardest = a.hardest.top.length
        ? tbl(['Subject', 'Passed', 'Failed', 'Fail rate'], a.hardest.top.map((s) => `<tr><td><span class="mono">${esc(s.code)}</span> ${esc(s.title)}</td><td class="num">${s.passed}</td><td class="num">${s.failed}</td><td class="num">${s.failRate}% ${bar(s.failRate, maxFail)}</td></tr>`))
        : '<p class="dim">No subject has a failed grade on file.</p>';
    const maxUnits = Math.max(0, ...a.units.map((u) => u.count));
    const units = tbl(['Units earned', 'Students'], a.units.map((u) => `<tr><td>${esc(u.label)}</td><td class="num">${u.count} ${bar(u.count, maxUnits)}</td></tr>`));
    const f = a.funnel;
    const funnel = f.unreadable ? '<p class="dim">Requests cannot be read with this account.</p>' : tbl(['Step', 'Requests'], [
        ['Sent by students', f.sent], ['Waiting for the adviser', f.waiting], ['Approved', f.approved], ['Partly approved', f.partlyApproved],
        ['Rejected', f.rejected], ['Withdrawn', f.withdrawn], ['Approval rate (of decided)', pctText(f.approvalRate)],
    ].map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${esc(v)}</td></tr>`));
    const maxStudents = Math.max(0, ...a.demand.sections.map((s) => s.students));
    const partialNote = (s) => (s.partial ? ` <span class="dim">· ${s.partial} of ${s.students} take only some of its subjects</span>` : '');
    const demand = !a.demand.readable
        ? '<p class="dim">Section demand could not be loaded.</p>'
        : a.demand.any
            ? tbl(['Section', 'Students (approved)', 'Reported full at EDP'], a.demand.sections.map((s) => `<tr><td>${esc(s.section)}${partialNote(s)}</td><td class="num">${s.students} ${bar(s.students, maxStudents)}</td><td class="num">${s.reportedFull}</td></tr>`))
                + `<p class="dim">${esc(overallText(a.demand.overall))}</p>`
            : '<p class="dim">No section is scheduled this term yet.</p>';
    return `<div class="report-grid">
        ${card('Hardest subjects', `${a.hardest.total} with a failed grade`, hardest)}
        ${card('Units earned', `${a.students} students`, units)}
        ${card('Request funnel', '', funnel)}
        ${card('Section demand', 'this term', demand)}
    </div>`;
}

const CSS = `
  * { box-sizing: border-box; }
  body { font: 10pt/1.35 Arial, Helvetica, sans-serif; color: #111; margin: 0; padding: 14mm; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  h1 { font-size: 16pt; margin: 0 0 2px; } .sub { color: #555; margin: 0 0 10px; }
  h2 { font-size: 11pt; margin: 14px 0 4px; border-bottom: 1px solid #999; padding-bottom: 2px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
  th, td { border: 1px solid #bbb; padding: 3px 6px; text-align: left; font-size: 9pt; } th { background: #f0f0f0; }
  td.num, th.num { text-align: right; }
  .note { color: #555; font-size: 8.5pt; margin-top: 12px; }
  @page { size: A4 portrait; margin: 8mm; } @media print { body { padding: 4mm; } }`;

const ptable = (head, body) => `<table><thead><tr>${head.map((h, i) => `<th${i ? ' class="num"' : ''}>${esc(h)}</th>`).join('')}</tr></thead>
  <tbody>${body.map((r) => `<tr>${r.map((c, i) => `<td${i ? ' class="num"' : ''}>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

function sheet(a) {
    const f = a.funnel;
    return {
        hardest: a.hardest.top.map((s) => [`${s.code} ${s.title}`.trim(), s.passed, s.failed, s.failRate + '%']),
        units: a.units.map((u) => [u.label, u.count]),
        funnel: [['Sent by students', f.sent], ['Waiting for the adviser', f.waiting], ['Approved', f.approved], ['Partly approved', f.partlyApproved],
            ['Rejected', f.rejected], ['Withdrawn', f.withdrawn], ['Approval rate (of decided)', pctText(f.approvalRate)]],
        demand: a.demand.sections.map((s) => [s.section, s.students, s.partial, s.reportedFull]),
    };
}

function html(a) {
    const t = sheet(a);
    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Academic analytics${a.programName ? ' - ' + esc(a.programName) : ''}</title><style>${CSS}</style></head><body>
  <h1>Academic Analytics</h1><p class="sub">${esc(a.programName || 'All programmes')} · ${a.students} students</p>
  <h2>Hardest subjects</h2>${a.hardest.top.length ? ptable(['Subject', 'Passed', 'Failed', 'Fail rate'], t.hardest) : '<p>No subject has a failed grade on file.</p>'}
  <h2>Units earned</h2>${ptable(['Units earned', 'Students'], t.units)}
  <h2>Request funnel</h2>${a.funnel.unreadable ? '<p>Requests could not be read with this account.</p>' : ptable(['Step', 'Requests'], t.funnel)}
  <h2>Section demand (this term, approved students)</h2>${!a.demand.readable ? '<p>Section demand could not be loaded.</p>' : a.demand.any ? ptable(['Section', 'Students (approved)', 'Take only some of its subjects', 'Reported full at EDP'], t.demand) + '<p>' + esc(overallText(a.demand.overall)) + '</p>' : '<p>No section is scheduled this term yet.</p>'}
  <p class="note">Generated ${esc(stamp(a.generatedAt))} by CurricuLogic. Fail rate = failed / (passed + failed), each student counted once per subject; a student who failed and later passed counts as passed.</p>
</body></html>`;
}

function rows(a) {
    const t = sheet(a);
    return [
        ['Academic Analytics'], ['Programme', a.programName], ['Students', a.students], ['Generated', stamp(a.generatedAt)], [],
        ['Hardest subjects'], ['Subject', 'Passed', 'Failed', 'Fail rate'], ...t.hardest, [],
        ['Units earned'], ['Units earned', 'Students'], ...t.units, [],
        ['Request funnel'], ...(a.funnel.unreadable ? [['Not readable with this account', '']] : [['Step', 'Requests'], ...t.funnel]), [],
        ['Section demand (this term, approved students)'], ...(a.demand.readable
            ? [['Section', 'Students (approved)', 'Take only some of its subjects', 'Reported full at EDP'], ...t.demand,
                ...(a.demand.overall ? [['Approved students in total (each once)', a.demand.overall.students], ['Of them in more than one section', a.demand.overall.multiSection]] : [])]
            : [['Not available', '']]),
    ];
}

function print(a) {
    const w = window.open('', '_blank', 'width=900,height=1100');
    if (!w) return alert('The print window was blocked. Allow pop-ups for this site.');
    w.document.write(html(a));
    w.document.close();
    w.onload = () => { w.focus(); w.print(); };
    setTimeout(() => { try { w.focus(); w.print(); } catch (e) { /* already printing */ } }, 600);
}

function mount(el, getAnalytics) {
    if (!el) return;
    el.innerHTML = `
        <button type="button" class="btn-small" data-rep="print"><i class="fa-solid fa-print" aria-hidden="true"></i> Print analytics</button>
        <button type="button" class="btn-small" data-rep="xlsx"><i class="fa-solid fa-file-excel" aria-hidden="true"></i> Excel</button>
        <button type="button" class="btn-small" data-rep="csv"><i class="fa-solid fa-file-csv" aria-hidden="true"></i> CSV</button>`;
    el.onclick = (e) => {
        const b = e.target.closest('button[data-rep]');
        const a = b && getAnalytics();
        if (!a) return;
        const name = 'Analytics-' + gRoot.ReportFile.safeName(a.programName || 'all');
        gRoot.ReportFile.logExport('analytics', b.dataset.rep, null, b.dataset.rep === 'print' ? null : rows(a).length);
        try {
            if (b.dataset.rep === 'print') print(a);
            else if (b.dataset.rep === 'xlsx') gRoot.ReportFile.downloadXlsx(name + '.xlsx', [{ name: 'Analytics', rows: rows(a) }]);
            else gRoot.ReportFile.download(name + '.csv', gRoot.ReportFile.csv(rows(a)));
        } catch (err) { console.warn('analytics failed:', err.message); alert('The report could not be created: ' + err.message); }
    };
}

return { loadDemand, loadTotals, build, screen, html, rows, print, mount, TOP };
}));
