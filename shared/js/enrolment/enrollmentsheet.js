// enrollmentsheet.js
//
// The page a student brings to the EDP office with the enrolment form: every subject of the approved plan
// with its EDP code(s), section and meeting times, and, next to it, one or two BACKUP sections to write
// down if the first choice turns out to be full. This system cannot see seats; the EDP office checks the
// form. So the sheet makes sure the student leaves the window with an answer, not a new search.
//
// Pure functions: building the rows, plain text for sharing, and a full HTML page for printing.
//
//   const sheet = EnrollmentSheet.build({ items: [{ code, title, units, section, backups }] });
//   EnrollmentSheet.html(sheet, { student, program, college, yearLevel, term, ref })      // a printable page, in the look of the printed curriculum (ref = the request reference, optional)
//   EnrollmentSheet.text(sheet, { student, program, term })      // for a share sheet or a message
//
// A "section" is what ScheduleConflicts.groupSections returns: { section, meetings: [offering rows] }.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('../schedule/scheduleconflicts.js'), require('../curriculum/curriculumprint.js'));
    else root.EnrollmentSheet = factory(root.ScheduleConflicts, root.CurriculumPrint);
}(typeof self !== 'undefined' ? self : this, function (SC, CP) {
'use strict';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const TERM = { 1: '1st Semester', 2: '2nd Semester', 3: 'Summer' };

const NOTE = 'This is a recommendation. The EDP office confirms seats and schedule conflicts on your enrolment '
    + 'form. If a first-choice section is full, use a backup below.';

/* The EDP codes of a section, in meeting order, each once. A section with a lecture and a lab has two. */
function edpCodes(group) {
    const seen = [];
    for (const m of group?.meetings ?? []) {
        const code = String(m.edp_code ?? '').trim();
        if (code && !seen.includes(code)) seen.push(code);
    }
    return seen;
}

/* "TTH 8:00 AM–9:30 AM + LAB F 1:00 PM–4:00 PM" */
function whenText(group) {
    return (group?.meetings ?? []).map(m => {
        const lab = String(m.meeting_type ?? '').toUpperCase() === 'LAB' ? 'LAB ' : '';
        const span = m.start_time && m.end_time ? `${SC.formatClock(m.start_time)}–${SC.formatClock(m.end_time)}` : '';
        return [lab + (m.schedule_days ?? ''), span].filter(Boolean).join(' ').trim();
    }).filter(Boolean).join(' + ');
}

const unitsOf = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/* items: [{ code, title, units, section, backups }] -> the rows of the sheet */
function build({ items }) {
    const rows = (items ?? []).map(it => ({
        code: it.code,
        title: it.title ?? '',
        units: unitsOf(it.units),
        section: it.section?.section ?? null,
        edp: edpCodes(it.section),
        when: whenText(it.section),
        backups: (it.backups ?? []).map(b => ({ section: b.section, edp: edpCodes(b), when: whenText(b) })),
    }));
    return {
        rows,
        totalUnits: rows.reduce((sum, r) => sum + r.units, 0),
        // true when no section carries an EDP code yet (the schedule was posted without them)
        missingEdp: rows.length > 0 && rows.every(r => r.edp.length === 0),
    };
}

const edpText = (codes) => codes.length ? codes.join(' + ') : 'no EDP code posted';
const unitText = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));

function termText(term) {
    if (!term) return '';
    const name = TERM[term.number] ?? '';
    const ay = Number.isFinite(Number(term.year)) ? `AY ${Number(term.year)}–${Number(term.year) + 1}` : '';
    return [name, ay].filter(Boolean).join(', ');
}

/* The same sheet as plain text. */
function text(sheet, info = {}) {
    const lines = ['ENROLMENT SHEET'];
    const who = [info.student?.name, info.student?.id].filter(Boolean).join(' · ');
    if (who) lines.push(who);
    const prog = [info.program, termText(info.term)].filter(Boolean).join(' · ');
    if (prog) lines.push(prog);
    lines.push('');
    for (const r of sheet.rows) {
        lines.push(`${r.code} ${r.title} (${unitText(r.units)} units)`);
        lines.push(`  EDP ${edpText(r.edp)}${r.section ? ` · ${r.section}` : ''}`);
        if (r.when) lines.push(`  ${r.when}`);
        r.backups.forEach((b, i) => {
            lines.push(`  Backup ${i + 1}: EDP ${edpText(b.edp)} · ${b.section}${b.when ? ` · ${b.when}` : ''}`);
        });
        if (!r.backups.length) lines.push('  Backup: none without a clash');
        lines.push('');
    }
    lines.push(`Total: ${unitText(sheet.totalUnits)} units`);
    lines.push('');
    lines.push(NOTE);
    return lines.join('\n');
}

/* A full HTML page, ready to print. */
function html(sheet, info = {}) {
    const rows = sheet.rows.map(r => {
        const backup = (i) => {
            const b = r.backups[i];
            if (!b) return i === 0 ? '<span class="none">none without a clash</span>' : '';
            return `<strong>${esc(edpText(b.edp))}</strong><br>${esc(b.section)}`
                + (b.when ? `<br><span class="when">${esc(b.when)}</span>` : '');
        };
        return `<tr>
            <td><strong>${esc(r.code)}</strong><br><span class="title">${esc(r.title)}</span></td>
            <td class="n">${esc(unitText(r.units))}</td>
            <td class="edp">${esc(edpText(r.edp))}</td>
            <td>${esc(r.section ?? '')}${r.when ? `<br><span class="when">${esc(r.when)}</span>` : ''}</td>
            <td class="backup">${backup(0)}</td>
            <td class="backup">${backup(1)}</td>
        </tr>`;
    }).join('');

    const who = [info.student?.name, info.student?.id].filter(Boolean).join(' · ');
    const prog = [info.program, termText(info.term)].filter(Boolean).join(' · ');
    const colour = CP ? CP.yearColour(info.yearLevel) : { bar: '#111', tint: '#eee' };
    const brand = CP ? CP.brandHtml() : '';
    const printed = new Date().toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });

    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Enrolment sheet</title>
<style>
  :root { --bar: ${colour.bar}; --tint: ${colour.tint}; }
  ${CP ? CP.BRAND_CSS : ''}
  @page { size: A4; margin: 10mm; }
  body { font: 13px/1.45 system-ui, Segoe UI, Arial, sans-serif; color: #111; margin: 24px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .head { display: flex; align-items: flex-end; gap: 12px; border-bottom: 2px solid var(--bar); padding-bottom: 8px; margin-bottom: 10px; }
  .head .org { font-size: 15px; font-weight: 700; line-height: 1.2; }
  .head .org small { display: block; font-size: 11px; font-weight: 400; color: #444; }
  .head .ref { margin-left: auto; font-size: 11px; color: #444; white-space: nowrap; }
  h1 { font-size: 13px; margin: 0 0 8px; padding: 3px 0; text-align: center; color: #fff; background: var(--bar); letter-spacing: .08em; text-transform: uppercase; }
  .meta { color: #333; margin-bottom: 12px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #333; padding: 6px 8px; vertical-align: top; text-align: left; }
  th { background: var(--tint); font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
  td.n { text-align: center; white-space: nowrap; }
  td.edp { font-weight: 700; white-space: nowrap; }
  .title, .when { color: #444; font-size: 12px; }
  .none { color: #777; font-style: italic; }
  tfoot td { font-weight: 700; background: var(--tint); }
  .note { margin-top: 14px; padding: 8px 10px; border: 1px solid #bbb; background: #f7f7f7; }
  .foot { margin-top: 10px; color: #666; font-size: 11px; }
  @media print { body { margin: 0; } }
</style></head><body>
<div class="head">${brand}<div class="org">${esc(info.college || 'University of Cebu')}${info.program ? `<small>${esc(info.program)}</small>` : ''}</div>${info.ref ? `<div class="ref">Ref. <strong>${esc(info.ref)}</strong></div>` : ''}</div>
<h1>Enrolment sheet</h1>
<div class="meta">${esc(who)}${who && prog ? '<br>' : ''}${esc(prog)}</div>
<table>
  <thead><tr><th>Subject</th><th>Units</th><th>EDP code</th><th>Section and time</th><th>Backup 1</th><th>Backup 2</th></tr></thead>
  <tbody>${rows}</tbody>
  <tfoot><tr><td>Total</td><td class="n">${esc(unitText(sheet.totalUnits))}</td><td colspan="4"></td></tr></tfoot>
</table>
${sheet.missingEdp ? '<div class="note">No EDP codes are posted for these sections yet. Ask the Department.</div>' : ''}
<div class="note">${esc(NOTE)}</div>
<div class="foot">Printed ${esc(printed)} from CurricuLogic.</div>
</body></html>`;
}

return { build, text, html, edpCodes, whenText, NOTE };

}));
