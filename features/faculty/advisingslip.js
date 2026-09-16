// advisingslip.js — printable enrolment advising slip.
//
// Load after engine.js on the faculty dashboard.
// window.AdvisingSlip.print({ student, result, records, term, adviser })
//
// The engine's reasoning is otherwise trapped on a screen. Enrolment
// happens at a desk with paper, so this is the artifact the student
// carries there: what they are cleared to take, what they have passed,
// and an adviser's signature against it.
//
// Deliberately printed from the same assess() output the dashboard
// shows. A slip that disagreed with the screen would be worse than no
// slip at all.

(function () {
'use strict';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
    c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

const TERM = { 1: '1st Semester', 2: '2nd Semester', 3: 'Summer' };

const today = () => new Date().toLocaleDateString('en-PH',
    { year: 'numeric', month: 'long', day: 'numeric' });


function slipHtml({ student, result, records, term, adviser }) {
    const name = [student.first_name, student.last_name].filter(Boolean).join(' ');

    const recommended = result?.recommended ?? [];
    const recUnits    = recommended.reduce((t, r) => t + Number(r.subject.units || 0), 0);

    const passed = (records ?? []).filter(r => r.status === 'PASSED');
    const earned = passed.reduce((t, r) => t + Number(r.units || 0), 0);

    /* Recommended load. The reason column is the point of the document —
       it is what distinguishes an advising slip from a list. */
    const recRows = recommended.length
        ? recommended.map(r => `<tr>
            <td class="mono">${esc(r.subject.code)}</td>
            <td>${esc(r.subject.title)}</td>
            <td class="n">${Number(r.subject.units)}</td>
            <td class="why">${esc(r.reason || '')}${
                r.retake ? ' <strong>Retake.</strong>' : ''}</td>
          </tr>`).join('')
        : `<tr><td colspan="4" class="none">
             No subjects recommended. Check the eligibility view for the reason.
           </td></tr>`;

    /* Academic record, newest term first — an enrolment officer is
       checking the most recent results, not reading a history. */
    const recSorted = [...(records ?? [])].sort((a, b) =>
        (b.taken_year - a.taken_year) || (b.taken_term - a.taken_term) ||
        String(a.subject_code).localeCompare(String(b.subject_code)));

    const gradeRows = recSorted.length
        ? recSorted.map(r => `<tr>
            <td class="mono">${esc(r.subject_code)}</td>
            <td>${esc(r.subject_title)}</td>
            <td class="n">${esc(r.units)}</td>
            <td class="n">${r.grade_points != null
                ? Number(r.grade_points).toFixed(2)
                : esc(r.grade || '\u2014')}</td>
            <td class="n">${esc(r.status || '')}</td>
            <td class="n">${TERM[r.taken_term] ?? ''} ${esc(r.taken_year ?? '')}</td>
          </tr>`).join('')
        : `<tr><td colspan="6" class="none">No subjects on record.</td></tr>`;

    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<title>Advising slip \u2014 ${esc(name)}</title>
<style>
  @page { size: A4; margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0; color: #111;
    font: 400 10pt/1.4 "Inter", Arial, sans-serif;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .head { display: flex; justify-content: space-between; align-items: flex-start;
          border-bottom: 1.5pt solid #111; padding-bottom: 7pt; margin-bottom: 10pt; }
  .org { font-weight: 600; font-size: 11pt; }
  .org small { display: block; font-weight: 400; font-size: 8.5pt; color: #444; }
  .doc { text-align: right; }
  .doc h1 { margin: 0; font-size: 13pt; letter-spacing: .02em; }
  .doc p { margin: 2pt 0 0; font-size: 8.5pt; color: #444; }

  .facts { display: grid; grid-template-columns: repeat(4, 1fr);
           gap: 5pt 14pt; margin-bottom: 11pt; }
  .facts div { border-bottom: .5pt solid #ccc; padding-bottom: 3pt; }
  .facts .k { font-size: 7.5pt; text-transform: uppercase;
              letter-spacing: .05em; color: #666; }
  .facts .v { font-size: 10pt; }

  h2 { margin: 12pt 0 5pt; font-size: 9.5pt; text-transform: uppercase;
       letter-spacing: .06em; border-bottom: .5pt solid #111; padding-bottom: 3pt; }

  table { width: 100%; border-collapse: collapse; }
  th { font-size: 7.5pt; text-transform: uppercase; letter-spacing: .04em;
       text-align: left; color: #555; padding: 4pt 5pt; border-bottom: .5pt solid #999; }
  td { padding: 4pt 5pt; border-bottom: .5pt solid #e0e0e0; vertical-align: top; }
  td.n, th.n { text-align: center; }
  .mono { font-family: "Courier New", monospace; font-size: 9pt; white-space: nowrap; }
  .why { font-size: 8.5pt; color: #444; }
  .none { text-align: center; color: #666; padding: 9pt; font-style: italic; }
  tfoot td { border-top: .5pt solid #111; border-bottom: none;
             font-weight: 600; padding-top: 5pt; }

  /* Grades run long; let the table break but keep the header on each page. */
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }

  .sign { display: grid; grid-template-columns: repeat(3, 1fr);
          gap: 22pt; margin-top: 26pt; page-break-inside: avoid; }
  .sign div { border-top: .5pt solid #111; padding-top: 4pt;
              font-size: 8pt; color: #444; }

  .foot { margin-top: 14pt; padding-top: 6pt; border-top: .5pt solid #ccc;
          font-size: 7.5pt; color: #666; }
</style></head>
<body>

<div class="head">
  <div class="org">University of Cebu
    <small>College of Computer Studies</small>
  </div>
  <div class="doc">
    <h1>Enrolment Advising Slip</h1>
    <p>${esc(term?.label ?? '')}</p>
  </div>
</div>

<div class="facts">
  <div><p class="k">Student</p><p class="v">${esc(name)}</p></div>
  <div><p class="k">Student ID</p><p class="v mono">${esc(student.student_id ?? '\u2014')}</p></div>
  <div><p class="k">Year level</p><p class="v">${esc(student.year_level ?? '\u2014')}</p></div>
  <div><p class="k">Programme</p><p class="v">BS Information Technology</p></div>
  <div><p class="k">Units earned</p><p class="v">${earned}</p></div>
  <div><p class="k">Subjects passed</p><p class="v">${passed.length}</p></div>
  <div><p class="k">Recommended load</p><p class="v">${recUnits} units</p></div>
  <div><p class="k">Issued</p><p class="v">${today()}</p></div>
</div>

<h2>Recommended subjects for enrolment</h2>
<table>
  <thead><tr>
    <th>Code</th><th>Descriptive title</th><th class="n">Units</th><th>Basis</th>
  </tr></thead>
  <tbody>${recRows}</tbody>
  ${recommended.length ? `<tfoot><tr>
    <td colspan="2">Total</td><td class="n">${recUnits}</td><td></td>
  </tr></tfoot>` : ''}
</table>

<h2>Academic record</h2>
<table>
  <thead><tr>
    <th>Code</th><th>Descriptive title</th><th class="n">Units</th>
    <th class="n">Grade</th><th class="n">Status</th><th class="n">Term</th>
  </tr></thead>
  <tbody>${gradeRows}</tbody>
</table>

<div class="sign">
  <div>Student signature</div>
  <div>${esc(adviser ?? 'Faculty adviser')}<br>Faculty adviser</div>
  <div>Registrar</div>
</div>

<p class="foot">
  Generated by CurricuLogic from the student's verified academic record and
  the BSIT curriculum in effect for their enrolment year. Subject
  eligibility is advisory. Enrolment is subject to subject availability
  and the approval of the Office of the Registrar.
</p>

</body></html>`;
}


function print(data) {
    if (!data?.student) return console.error('AdvisingSlip: no student');

    const w = window.open('', '_blank', 'width=900,height=1000');
    if (!w) {
        return alert('The print window was blocked. Allow pop-ups for this site.');
    }

    w.document.write(slipHtml(data));
    w.document.close();

    // Wait for layout before printing, or the first page comes out empty.
    w.onload = () => { w.focus(); w.print(); };
    setTimeout(() => { try { w.focus(); w.print(); } catch (e) {} }, 400);
}

window.AdvisingSlip = { print, html: slipHtml };

})();