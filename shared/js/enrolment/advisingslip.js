// advisingslip.js — printable enrolment advising slip.
//
// Load on the faculty and registrar dashboards.
//   window.AdvisingSlip.print({ student, subjects, rules, records, term, adviser, program, approvedIds })
//   window.AdvisingSlip.printApprovedRequest(supabase, requestId, helpers)
//
// The slip follows the layout of the printed curriculum: ONE semester block of the
// student's curriculum (their year level, in the term being enrolled), with a Grade
// column that says PASSED, FAILED or RETAKE for what they have already taken. It is
// the same form for the faculty adviser and the Registrar.
//
// It looks like the printed curriculum (shared/js/curriculum/curriculumprint.js): the UC mark, the year's own colour on the
// bar and the table headings, ruled cells.
//
//   term:     { number: 1|2|3, year: 2023 }   the semester being enrolled
//   program:  { name, code, college }         of the STUDENT, looked up by the caller
//   subjects: the student's curriculum  [{ id, code, title, units, lec_units, lab_units, year_level, term, is_elective }]
//   rules:    prerequisite rows         [{ subject_id, prerequisite_subject_id, requirement_type, rule_group, threshold_value }]
//   records:  academic_record rows      [{ subject_id, status, taken_year, taken_term }]
//   approvedIds: subject ids the adviser approved (Registrar reprint); marked in Remarks
//   approvalNotes: { subjectId: "note" } the adviser left when approving a subject; printed under "Approved"
//   approvedItems: [{ id, code, title, units, lec, lab, section, note }] every subject the adviser approved. A subject of the
//                 semester is marked Approved from this list (by id or by code, since a plan may be written against another
//                 version of the curriculum). A subject that is NOT in the printed semester (an irregular student taking subjects
//                 from other year levels) is listed in its own block, "Approved subjects outside this semester", so nothing the
//                 adviser approved is ever missing from the form.
//
// Grade column:
//   PASSED  a passing record exists
//   FAILED  the latest attempt was failed in the term being enrolled
//   RETAKE  failed in an earlier term and still to be taken again
//   (blank) not taken yet, or being taken now

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('../curriculum/curriculumprint.js'));
    else root.AdvisingSlip = factory(root.CurriculumPrint);
}(typeof self !== 'undefined' ? self : this, function (CP) {
'use strict';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
    c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

const TERM  = { 1: '1st Semester', 2: '2nd Semester', 3: 'Summer' };
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI'];
const YEAR  = ['', 'FIRST', 'SECOND', 'THIRD', 'FOURTH', 'FIFTH', 'SIXTH'];
const ORD   = ['', '1st', '2nd', '3rd', '4th', '5th', '6th'];

const today = () => new Date().toLocaleDateString('en-PH',
    { year: 'numeric', month: 'long', day: 'numeric' });

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const unitText = (v) => { const n = num(v); return n ? String(n) : ''; };

/* "AY 2023–2024" for the academic year that starts in `year`. */
const ayText = (year) => Number.isFinite(Number(year)) ? `AY ${Number(year)}–${Number(year) + 1}` : '';

/* What to print in the Grade column for one subject. */
function gradeFor(subjectId, records, current) {
    const mine = (records ?? []).filter(r => r.subject_id === subjectId);
    if (mine.some(r => r.status === 'PASSED')) return 'PASSED';

    const failed = mine.filter(r => r.status === 'FAILED');
    if (!failed.length) return '';

    const at = (r) => num(r.taken_year) * 10 + num(r.taken_term);
    const latest = failed.reduce((a, b) => (at(b) > at(a) ? b : a));
    const failedNow = current
        && num(latest.taken_year) === num(current.year)
        && num(latest.taken_term) === num(current.number);
    return failedNow ? 'FAILED' : 'RETAKE';
}

/* A subject's requirements as separate lines, one per group. Groups are "and",
   so each line must be met; inside a group the choices are "or" and stay on
   one line ("A21 or B21"). */
function requirementLines(subjectId, rules, byId) {
    const mine = (rules ?? []).filter(r => r.subject_id === subjectId);
    const groups = new Map();
    for (const r of mine) {
        const g = r.rule_group ?? 1;
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g).push(r);
    }
    const parts = [];
    for (const [, list] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
        const bits = list.map(r => {
            if (r.requirement_type === 'standing') {
                const t = num(r.threshold_value);
                const year = t < 10 ? t : Math.floor(t / 10);
                return `${ORD[year] || year} yr standing`;
            }
            const code = byId.get(r.prerequisite_subject_id)?.code;
            if (!code) return '';
            return r.requirement_type === 'co_requisite' ? `${code} (co)` : code;
        }).filter(Boolean);
        if (bits.length) parts.push(bits.join(' or '));
    }
    return parts;
}

/* "CC-COMPROG12, IT-SAD21" style text for a subject's requirements. */
function requirementText(subjectId, rules, byId) {
    return requirementLines(subjectId, rules, byId).join(', ');
}

/* "CC-COMPROG11" and "cc-comprog11 " are the same subject. */
const codeKey = (c) => String(c ?? '').trim().toUpperCase();

/* The rows of the one semester block being printed, in curriculum order. */
function semesterRows({ subjects, rules, records, yearLevel, term, approvedIds, approvalNotes, approvedItems }) {
    const byId = new Map((subjects ?? []).map(s => [s.id, s]));
    const approved = new Set(approvedIds ?? []);
    const items = approvedItems ?? [];
    // The adviser's approval for a subject of this semester, by its id or, when the plan was written against another
    // version of the curriculum, by its code.
    const itemFor = (s) => items.find(i => (i.id != null && i.id === s.id) || (i.code && codeKey(i.code) === codeKey(s.code)));
    const current = term && term.number ? { number: term.number, year: term.year } : null;

    return (subjects ?? [])
        .filter(s => s.is_active !== false
            && s.year_level != null
            && Number(s.year_level) === Number(yearLevel)
            && Number(s.term) === Number(term?.number))
        .sort((a, b) => a.id - b.id)
        .map(s => ({
            code: s.code,
            title: s.title,
            lec: unitText(s.lec_units),
            lab: unitText(s.lab_units),
            total: num(s.units),
            grade: gradeFor(s.id, records, current),
            requires: requirementText(s.id, rules, byId),
            requiresLines: requirementLines(s.id, rules, byId),
            approved: approved.has(s.id) || !!itemFor(s),
            note: (approved.has(s.id) || itemFor(s)) ? String((approvalNotes ?? {})[s.id] ?? itemFor(s)?.note ?? "").trim() : "",
        }));
}

/* The approved subjects that are NOT in the semester block (by code), in the order the adviser approved them. */
function outsideSemester(rows, approvedItems) {
    const printed = new Set((rows ?? []).map(r => codeKey(r.code)));
    return (approvedItems ?? []).filter(i => i && i.code && !printed.has(codeKey(i.code)));
}

function slipHtml(data) {
    const { student, subjects, rules, records, term, adviser, program, approvedIds, approvalNotes, approvedItems, ref } = data;
    const name = [student.first_name, student.last_name].filter(Boolean).join(' ');
    const year = Number(student.year_level) || null;

    // The colour of the student's year, as on the printed curriculum.
    const colour = CP ? CP.yearColour(year) : { bar: '#111', tint: '#eee' };
    const brand = CP ? CP.brandHtml() : '';

    const rows = year ? semesterRows({ subjects, rules, records, yearLevel: year, term, approvedIds, approvalNotes, approvedItems }) : [];
    const total = rows.reduce((t, r) => t + r.total, 0);
    const outside = outsideSemester(rows, approvedItems);
    const outsideTotal = outside.reduce((t, i) => t + num(i.units), 0);
    // What was approved in all: the approved subjects of the semester block plus the ones outside it.
    const approvedTotal = rows.filter(r => r.approved).reduce((t, r) => t + r.total, 0) + outsideTotal;

    const termLabel = term?.number
        ? [TERM[term.number], ayText(term.year)].filter(Boolean).join(', ')
        : (term?.label ?? '');

    const progLine = program?.name
        ? `${program.name}${program.code ? ` (${program.code})` : ''}`
        : '';

    const body = rows.length
        ? rows.map(r => `<tr>
            <td class="grade g-${esc(r.grade.toLowerCase())}">${esc(r.grade)}</td>
            <td class="mono">${esc(r.code)}</td>
            <td>${esc(r.title)}</td>
            <td class="n">${esc(r.lec)}</td>
            <td class="n">${esc(r.lab)}</td>
            <td class="n">${esc(r.total)}</td>
            <td class="req">${r.requiresLines.length
                ? r.requiresLines.map(l => `<span class="ln">${esc(l)}</span>`).join('')
                : '<span class="ln none-dash">—</span>'}</td>
            <td class="rem">${r.approved ? '<strong>Approved</strong>' + (r.note ? `<span class="note">${esc(r.note)}</span>` : '') : ''}</td>
          </tr>`).join('')
        : `<tr><td colspan="8" class="none">${year
            ? 'No subjects in this student’s curriculum for this semester.'
            : 'This student’s year level is not set.'}</td></tr>`;

    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<title>Advising slip — ${esc(name)}</title>
<style>
  @page { size: A4; margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0; color: #111;
    font: 400 10pt/1.4 "Inter", Arial, sans-serif;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  :root { --bar: ${colour.bar}; --tint: ${colour.tint}; }
  ${CP ? CP.BRAND_CSS : ''}
  .head { display: flex; justify-content: space-between; align-items: flex-start;
          border-bottom: 1.5pt solid var(--bar); padding-bottom: 7pt; margin-bottom: 10pt; }
  .org { display: flex; align-items: flex-end; gap: 10pt; font-weight: 600; font-size: 11pt; }
  .org .uni { padding-right: 10pt; }
  .org small { display: block; font-weight: 400; font-size: 8.5pt; color: #444; }
  .doc { text-align: right; }
  .doc h1 { margin: 0; font-size: 13pt; letter-spacing: .02em; text-transform: uppercase; }
  .doc p { margin: 2pt 0 0; font-size: 9pt; color: #444; }

  .facts { margin: 0 0 12pt; }
  .facts div { display: flex; gap: 8pt; padding: 2pt 0; border-bottom: .5pt solid #ddd; }
  .facts .k { width: 82pt; font-size: 8pt; text-transform: uppercase;
              letter-spacing: .05em; color: #666; padding-top: 1pt; }
  .facts .v { font-size: 10.5pt; }

  .block { margin: 0 0 4pt; padding: 3pt 0; text-align: center; font-weight: 700;
           font-size: 10pt; letter-spacing: .08em; color: #fff; background: var(--bar); }

  table { width: 100%; border-collapse: collapse; }
  th { font-size: 7.5pt; text-transform: uppercase; letter-spacing: .04em;
       text-align: left; color: #111; padding: 4pt 5pt; background: var(--tint); border: .5pt solid #333; }
  td { padding: 5pt; border: .5pt solid #333; vertical-align: top; }
  td.n, th.n { text-align: center; width: 28pt; }
  th.grade, td.grade { width: 54pt; }
  td.grade { font-weight: 700; font-size: 8.5pt; letter-spacing: .03em; }
  .mono { font-family: "Courier New", monospace; font-size: 9pt; white-space: nowrap; }
  .req { font-size: 8.5pt; color: #333; width: 138pt; }
  .req .ln { display: block; white-space: nowrap; }
  .req .ln + .ln { margin-top: 1.5pt; }
  .req .none-dash { color: #999; }
  .rem { font-size: 8.5pt; color: #333; width: 58pt; white-space: nowrap; }
  .rem .note { display: block; white-space: normal; font-size: 7.5pt; font-weight: 400; color: #444; max-width: 110pt; }
  th.req, th.rem { padding-left: 8pt; }
  td.req, td.rem { padding-left: 8pt; }
  .none { text-align: center; color: #666; padding: 12pt; font-style: italic; }
  .block-out { margin-top: 14pt; }
  .grand { margin: 6pt 0 0; font-size: 9.5pt; }
  tfoot td { background: var(--tint); font-weight: 700; padding-top: 5pt; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }

  .sign { display: grid; grid-template-columns: repeat(2, 1fr);
          gap: 28pt; margin-top: 34pt; page-break-inside: avoid; }
  .sign div { border-top: .5pt solid #111; padding-top: 4pt;
              font-size: 8.5pt; color: #444; }
</style></head>
<body>

<div class="head">
  <div class="org">${brand}
    <div>${esc(program?.college || 'University of Cebu')}
      <small>${esc(progLine)}</small>
    </div>
  </div>
  <div class="doc">
    <h1>Enrolment Advising Slip</h1>
    <p>${esc(termLabel)}</p>${ref ? `
    <p>Ref. <strong>${esc(ref)}</strong></p>` : ''}
  </div>
</div>

<div class="facts">
  <div><span class="k">Student ID</span><span class="v mono">${esc(student.student_id ?? '—')}</span></div>
  <div><span class="k">Full name</span><span class="v">${esc(name)}</span></div>
  <div><span class="k">Year level</span><span class="v">${esc(year ? `${ORD[year] || year} Year` : '—')}</span></div>
  <div><span class="k">Issued</span><span class="v">${esc(today())}</span></div>
</div>

${year ? `<p class="block">${esc(`${ROMAN[year] || year} – ${YEAR[year] || ''} YEAR · ${TERM[term?.number] ?? ''}`)}</p>` : ''}
<table>
  <thead><tr>
    <th class="grade">Grade</th><th>Course Code</th><th>Descriptive Title</th>
    <th class="n">Lec</th><th class="n">Lab</th><th class="n">Total</th>
    <th class="req">Pre-requisite</th><th class="rem">Remarks</th>
  </tr></thead>
  <tbody>${body}</tbody>
  ${rows.length ? `<tfoot><tr>
    <td colspan="5">Total units</td><td class="n">${esc(total)}</td><td colspan="2"></td>
  </tr></tfoot>` : ''}
</table>
${outside.length ? `
<p class="block block-out">APPROVED SUBJECTS OUTSIDE THIS SEMESTER</p>
<table>
  <thead><tr>
    <th>Course Code</th><th>Descriptive Title</th>
    <th class="n">Lec</th><th class="n">Lab</th><th class="n">Total</th>
    <th class="req">Section</th><th class="rem">Remarks</th>
  </tr></thead>
  <tbody>${outside.map(i => `<tr>
    <td class="mono">${esc(i.code)}</td>
    <td>${esc(i.title)}</td>
    <td class="n">${esc(unitText(i.lec))}</td>
    <td class="n">${esc(unitText(i.lab))}</td>
    <td class="n">${esc(num(i.units))}</td>
    <td class="req">${i.section ? `<span class="ln">${esc(i.section)}</span>` : '<span class="ln none-dash">—</span>'}</td>
    <td class="rem"><strong>Approved</strong>${String(i.note ?? '').trim() ? `<span class="note">${esc(String(i.note).trim())}</span>` : ''}</td>
  </tr>`).join('')}</tbody>
  <tfoot><tr>
    <td colspan="4">Total units</td><td class="n">${esc(outsideTotal)}</td><td colspan="2"></td>
  </tr></tfoot>
</table>
<p class="grand">Units approved on this plan: <strong>${esc(approvedTotal)}</strong></p>` : ''}

<div class="sign">
  <div>Student signature</div>
  <div>${esc(adviser ?? 'Faculty adviser')}<br>Faculty adviser</div>
</div>

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

/* Prints the enrollment form of an APPROVED plan. Used by the faculty adviser
   (who approves and prints it) and by the Registrar (who can reprint it).

   The semester printed is the one the plan was made for, at the student's year
   level. The subjects the adviser approved are marked "Approved" in Remarks; a
   rejected item of a partly approved plan is not marked. An approved subject that
   is not in that semester (the student takes subjects of other year levels) is listed
   in the block "Approved subjects outside this semester". The Grade column comes
   from the student's academic record as it is now.

   Returns { ok: true } or { ok: false, error } in words fit for the page. */
async function printApprovedRequest(supabase, requestId, helpers = {}) {
    if (!supabase) return { ok: false, error: 'Could not open the print view.' };

    const { data: req, error } = await supabase
        .from('request')
        .select(`
            id, status, registrar_status, requested_term, requested_year, created_at,
            student:student_id (id, first_name, last_name, student_id, year_level, program_id, prospectus_id),
            request_item (
                status, subject_id, remarks,
                subject:subject_id (code, title, units, lec_units, lab_units),
                offering:offering_id (section, schedule_days, start_time, end_time)
            )
        `)
        .eq('id', requestId)
        .maybeSingle();
    if (error || !req) return { ok: false, error: 'Could not load that plan.' };

    // Approved by the adviser, and not one of the old plans the Registrar sent back.
    const RS = window.CurriculogicRequestStatus;
    const approved = RS
        ? RS.finalApproved(req)
        : (req.status === 'approved' || req.status === 'partially_approved') && req.registrar_status !== 'rejected';
    if (!approved) return { ok: false, error: 'This plan is not approved yet.' };

    const approvedIds = (req.request_item ?? []).filter(i => i.status === 'approved').map(i => i.subject_id);
    // What the adviser wrote when approving a subject, printed next to it.
    const approvalNotes = Object.fromEntries((req.request_item ?? [])
        .filter(i => i.status === 'approved' && i.remarks).map(i => [i.subject_id, i.remarks]));
    if (!approvedIds.length) return { ok: false, error: 'No approved subjects on this plan to print.' };

    // Every approved subject with what the form needs, so one that is not in the printed semester is still listed.
    const when = (o) => {
        if (!o) return '';
        const t = (o.start_time && o.end_time) ? `${String(o.start_time).slice(0, 5)}–${String(o.end_time).slice(0, 5)}` : '';
        return [o.section, o.schedule_days, t].filter(Boolean).join(' · ');
    };
    const approvedItems = (req.request_item ?? []).filter(i => i.status === 'approved').map(i => ({
        id: i.subject_id,
        code: i.subject?.code ?? '',
        title: i.subject?.title ?? '',
        units: i.subject?.units ?? 0,
        lec: i.subject?.lec_units ?? 0,
        lab: i.subject?.lab_units ?? 0,
        section: when(i.offering),
        note: i.remarks ?? '',
    }));

    // The student's own curriculum, else their programme's active one.
    let prospectusId = req.student.prospectus_id ?? null;
    if (prospectusId === null) {
        const { data: actives } = await supabase.from('prospectus')
            .select('id, program_id').eq('is_active', true);
        const P = window.CurriculogicPrograms;
        prospectusId = (P?.fallbackProspectus
            ? P.fallbackProspectus(req.student.program_id, actives ?? [])
            : (actives ?? []).find(a => a.program_id === req.student.program_id))?.id ?? null;
    }
    if (prospectusId === null) return { ok: false, error: 'This student has no curriculum assigned yet.' };

    // The adviser's name on the signature line is whoever actually reviewed
    // this request, not whoever is clicking print.
    const [{ data: review }, { data: records }, { data: subjects }] = await Promise.all([
        supabase.from('request_review')
            .select('faculty:faculty_id (first_name, last_name)')
            .eq('request_id', requestId)
            .limit(1)
            .maybeSingle(),
        supabase.from('academic_record')
            .select('subject_id, status, taken_term, taken_year')
            .eq('student_id', req.student.id),
        supabase.from('subject')
            .select('id, code, title, units, lec_units, lab_units, year_level, term, is_elective, is_active')
            .eq('prospectus_id', prospectusId),
    ]);

    const ids = (subjects ?? []).map(s => s.id);
    const { data: rules } = ids.length
        ? await supabase.from('prerequisite')
            .select('subject_id, prerequisite_subject_id, requirement_type, rule_group, threshold_value')
            .in('subject_id', ids)
        : { data: [] };

    const name = (p) => [p?.first_name, p?.last_name].filter(Boolean).join(' ').trim();
    const programs = window.CurriculogicPrograms;

    print({
        student: req.student,
        subjects: subjects ?? [],
        rules: rules ?? [],
        records: records ?? [],
        approvedIds,
        approvalNotes,
        approvedItems,
        term: { number: req.requested_term, year: req.requested_year },
        ref: window.CurriculogicRequestRef?.format(req.id, req.created_at) ?? '',
        adviser: review?.faculty ? name(review.faculty) : 'Faculty adviser',
        program: {
            name: helpers.programName ? helpers.programName(req.student) : (programs?.nameOf(req.student.program_id, '') ?? ''),
            code: programs?.codeOf(req.student.program_id, '') ?? '',
            college: programs?.collegeOf(req.student.program_id, '') ?? '',
        },
    });
    return { ok: true };
}

return { print, html: slipHtml, printApprovedRequest, semesterRows, outsideSemester, gradeFor, requirementText, requirementLines };
}));
