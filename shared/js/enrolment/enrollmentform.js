// enrollmentform.js
//
// The university's own College Enrollment Form (UC-Form 1A, old student), printed already filled in from the
// approved plan, so nobody copies subjects, sections, times and EDP codes onto it by hand.
//
//   Page 1  the form: semester, school year, programme, year level, section, ID number, name, one table row per
//           meeting of every approved subject (EDP code, subject code, time, days, room, units), total units,
//           the "Approved by" line (left empty: the Dean/Chairperson/Head signs and writes their own name), the acknowledgement, the enrolment flow and the stub.
//   Page 2  Student Supplementary Information (what the system holds, email and mobile, is filled in; the rest is
//           left for the student to write once) and the enrolment terms and conditions.
//
// Both pages are legal size (8.5 x 14 in). Signatures, dates, fees and the Dean's/Chairperson's signature stay blank.
//
//   EnrollmentForm.build({ items })            -> { rows, totalUnits, section }
//   EnrollmentForm.html(data)                  -> a full printable page
//   EnrollmentForm.printApprovedRequest(supabase, requestId, { programName })   (the Faculty adviser, the Registrar and the student)
//   EnrollmentForm.showHistory(supabase, requestId, element)   writes "Printed 3 times. Last: ..." into the element (db/092)
//
// Every print is recorded (log_form_print, db/092): who printed it and when, so a lost or reprinted form can be traced.
//
// data = { student: { first_name, last_name, student_id, year_level, email, phone }, items, term: { number, year },
//          program: { name }, ref }
// An item is { code, units, changedAt, meetings: [{ edp_code, schedule_days, start_time, end_time, room, section }] }.
// changedAt (request_item.section_changed_at, db/091) is set when the student switched that subject to another section
// after approval. The latest one marks the form REVISED: the Dean signed the old section, so a reprint must be told
// apart from the first copy and signed again.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('../schedule/scheduleconflicts.js'), require('../curriculum/curriculumprint.js'));
    else root.EnrollmentForm = factory(root.ScheduleConflicts, root.CurriculumPrint);
}(typeof self !== 'undefined' ? self : this, function (SC, CP) {
'use strict';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const MIN_ROWS = 16;     // the printed table has this many lines; a longer plan makes it longer
const ID_BOXES = 8;      // the paper form has 8 ID boxes

const unitText = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/* "8:00 AM–9:30 AM" */
function timeText(m) {
    if (!m?.start_time || !m?.end_time) return '';
    const f = SC?.formatClock ?? ((t) => String(t).slice(0, 5));
    return `${f(m.start_time)}–${f(m.end_time)}`;
}

/* One table row per meeting. The subject's units are written once, on its first meeting, so a lecture
   with a laboratory is not counted twice. A subject with no section posted still gets a row. */
function build({ items }) {
    const rows = [];
    const sections = new Map();
    for (const it of items ?? []) {
        const meetings = (it.meetings ?? []).length ? it.meetings : [null];
        meetings.forEach((m, i) => {
            rows.push({
                edp: String(m?.edp_code ?? '').trim(),
                code: it.code ?? '',
                time: timeText(m),
                days: m?.schedule_days ?? '',
                room: m?.room ?? '',
                units: i === 0 ? num(it.units) : null,
            });
            const s = String(m?.section ?? '').trim();
            if (s) sections.set(s, (sections.get(s) ?? 0) + 1);
        });
    }
    // The section written in the header is the one most of the subjects are in.
    const section = [...sections.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
    return { rows, totalUnits: rows.reduce((t, r) => t + (r.units ?? 0), 0), section };
}

/* The latest time a section was switched on this plan, or null when none was. */
function revisedAt(items) {
    let latest = null;
    for (const it of items ?? []) {
        const t = it?.changedAt ? new Date(it.changedAt) : null;
        if (t && !Number.isNaN(t.getTime()) && (!latest || t > latest)) latest = t;
    }
    return latest;
}

const dateText = (d) => d.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Manila' });

const TERM_BOX = { 1: 'first', 2: 'second', 3: 'summer' };

const box = (on) => `<span class="box${on ? ' on' : ''}"></span>`;

/* The ID number as separate boxes, one digit each, from the left. An ID longer than 8 digits gets more boxes, never cut. */
function idBoxes(id) {
    const digits = String(id ?? '').replace(/\s/g, '').split('');
    return Array.from({ length: Math.max(ID_BOXES, digits.length) }, (_, i) => `<span class="idbox">${esc(digits[i] ?? '')}</span>`).join('');
}

const TERMS = [
    'No student shall be enrolled unless he/she presents and attaches his/her high school card (for high school graduates) or Certificate of Transfer Credentials for those who have taken college studies from other school.',
    'No student shall be admitted to classes unless he/she presents his/her Student Load based on the Certificate of Matriculation duly approved by the Campus Academic Director.',
    'Changing/Adding/Dropping of subjects shall only be allowed within the enrollment period. Dissolution of subjects is allowed a week after the first day of classes. Changing/Adding and Dropping of subjects needs the approval of the Dean and shall be submitted to the Registrar for recording.',
    '10% cash discount on tuition fee only if paid in full (not later than July 16 - First semester / December 16 - Second semester).',
    'July 15 (First semester) and November 29 (Second semester) deadline for filing of discount and privileges.',
    'Please claim your ASSESSMENT/EXAMINATION PERMITS at the DEAN\'S office one week before examination period.',
];
const WITHDRAWAL = [
    'Enrollment period - Registration fee',
    'Within the 1st week of classes - 10% of Tuition fees + Registration fees',
    'Within the 2nd week of classes - 20% of Tuition fees + Registration fees',
    'After the 2nd week of classes - Full charge regardless of whether or not a student has actually attended the classes',
];

const FLOW = [
    ['1. SEEK DEAN\'S/CHAIRPERSON\'S APPROVAL', true],
    ['*** IF SCHOLAR, PROCEED TO SCHOLARSHIP COORDINATOR\'S OFFICE ***', false, 'italic'],
    ['2. GET ASSESSMENT AT THE ACCOUNTING SECTION', true],
    ['3. GO TO CASHIER FOR PAYMENT', true],
    ['4. GO TO REGISTRAR FOR CHECKING OF ENROLLMENT FORM', false],
    ['5. GO TO ID SECTION FOR PICTURE TAKING OR VALIDATION OF ID', false],
];

const line = (label, value = '', cls = '') =>
    `<div class="fl ${cls}"><span class="lab">${label}</span><span class="val">${esc(value)}</span></div>`;

function page1(data, sheet) {
    const { student = {}, term, program, ref } = data;
    const revised = revisedAt(data.items);
    const ay = Number.isFinite(Number(term?.year)) ? `${Number(term.year)}–${Number(term.year) + 1}` : '';
    const on = TERM_BOX[term?.number];
    const total = Math.max(MIN_ROWS, sheet.rows.length);
    // 16 lines fill the sheet at 40px each; a longer plan gets thinner lines so the page still fits.
    // The REVISED mark makes the header taller, so its lines are 2px thinner to give that height back.
    const rowPx = Math.max(18, Math.floor(MIN_ROWS * (revised ? 38 : 40) / total));
    const body = Array.from({ length: total }, (_, i) => {
        const r = sheet.rows[i];
        return r
            ? `<tr><td>${esc(r.edp)}</td><td>${esc(r.code)}</td><td>${esc(r.time)}</td><td>${esc(r.days)}</td><td>${esc(r.room)}</td><td class="c">${r.units === null ? '' : esc(unitText(r.units))}</td></tr>`
            : '<tr><td></td><td></td><td></td><td></td><td></td><td></td></tr>';
    }).join('');
    const stubBoxes = (cls) => `<span class="${cls}">${box(on === 'first')} 1st ${box(on === 'second')} 2nd ${box(on === 'summer')} SUMMER</span>`;

    return `
<section class="page">
  <header class="top">
    ${CP ? CP.brandHtml() : ''}
    <div class="org">
      <div class="u">UNIVERSITY OF CEBU</div>
      <div class="c">BANILAD CAMPUS</div>
      <div class="a">GOV. M. CUENCO AVENUE, BANILAD, CEBU CITY, PHILIPPINES 6000</div>
    </div>
    <div class="formno"><strong>UC-FORM 1A</strong><span>COLLEGE ENROLLMENT FORM</span><b>OLD STUDENT</b>${ref ? `<em>Ref. ${esc(ref)}</em>` : ''}${revised ? `<u class="revised">REVISED COPY<small>Section changed ${esc(dateText(revised))}. Replaces any earlier printed copy; needs a new signature.</small></u>` : ''}</div>
  </header>

  <div class="id-row">
    <div class="left">
      <div class="fl"><span class="lab">SEMESTER</span>${stubBoxes('terms')}</div>
      ${line('SCHOOL YEAR', ay)}
      ${line('COURSE/PROGRAM', program?.name ?? '')}
      ${line('MAJOR', program?.name ?? '')}
      <div class="two">${line('YEAR LEVEL', student.year_level ? String(student.year_level) : '')}${line('SECTION', sheet.section)}</div>
    </div>
    <div class="idnum"><span class="lab">ID NUMBER</span><div class="boxes">${idBoxes(student.student_id)}</div></div>
  </div>
  <div class="namerow"><span class="lab">NAME</span>
    <div class="nm"><span class="val">${esc(student.last_name ?? '')}</span><small>LAST NAME</small></div>
    <div class="nm"><span class="val">${esc(student.first_name ?? '')}</span><small>FIRST NAME</small></div>
    <div class="nm"><span class="val">${esc(student.middle_name ?? '')}</span><small>MIDDLE NAME</small></div>
  </div>

  <div class="main">
    <div class="tablecol">
      <table class="subj" style="--row:${rowPx}px">
        <thead><tr><th>EDP Code</th><th>Subject Code</th><th>Time</th><th>Days</th><th>Room</th><th>Units</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
      <div class="approve">
        <div class="by"><b>APPROVED BY:</b>
          <div class="sig"></div>
          <div class="cap"><span>Dean/Chairperson/Head</span><span>DATE</span></div>
        </div>
        <div class="tot"><span>TOTAL UNITS</span><strong>${esc(unitText(sheet.totalUnits))}</strong></div>
      </div>
      <div class="ack">
        <h3>ACKNOWLEDGEMENT</h3>
        <p>In consideration of my admission to the University of Cebu, I hereby promise to abide by and comply with the rules and regulations laid down by competent authorities in the university.</p>
        <div class="cap2"><span>Student's signature over printed name</span><span>Date signed</span></div>
      </div>
    </div>
    <div class="flow">
      <div class="flowbox title">ENROLLMENT FLOW</div>
      ${FLOW.map(([t, sig, cls]) => `<div class="flowbox${cls ? ' ' + cls : ''}">${esc(t)}${sig ? '<i></i>' : ''}</div>`).join('')}
    </div>
  </div>

  <div class="cut"></div>
  <div class="stub">
    <div class="sl">
      <div class="fl"><span class="lab">ID NUMBER</span></div><div class="boxes">${idBoxes(student.student_id)}</div>
      ${line('LAST NAME:', student.last_name ?? '')}
      ${line('FIRST NAME:', student.first_name ?? '')}
      ${line('MIDDLE NAME:', '')}
    </div>
    <div class="sr">
      <div class="fl"><span class="lab">SEMESTER</span>${stubBoxes('terms')}</div>
      ${line('SCHOOL YEAR:', ay)}
      <div class="two">${line('YEAR LEVEL', student.year_level ? String(student.year_level) : '')}${line('SECTION', sheet.section)}</div>
      ${line('ENTRANCE ₱', '')}
      ${line('OLD ACCOUNTS ₱', '')}
      ${line('TOTAL ₱', '')}
    </div>
  </div>
</section>`;
}

function page2(data) {
    const { student = {} } = data;
    const addr = (title) => `
      <div class="addr"><h4>${title}</h4>
        <div class="al"><i>&nbsp;</i><span>(House Number)</span><span>(Street)</span></div>
        <div class="al"><i>&nbsp;</i><span>(Barrio)</span><span>(Town/Municipality)</span></div>
        <div class="al"><i>&nbsp;</i><span>(Province)</span><span>(Zip Code)</span><span>(District)</span></div>
      </div>`;
    return `
<section class="page p2">
  <h2>STUDENT SUPPLEMENTARY INFORMATION</h2>
  <p class="req">* PLEASE FILL IN ALL THE REQUESTED INFORMATION</p>
  <div class="two">
    <div class="fl"><span class="lab">Gender:</span>${box(false)} Male ${box(false)} Female</div>
    ${line('Civil Status:', '')}
  </div>
  <div class="fl"><span class="lab">Date of Birth:</span><span class="val short"></span> / <span class="val short"></span> / <span class="val short"></span> <small>MM / DD / YYYY</small></div>

  <h4>PARENTS NAME</h4>
  <div class="two w">${line('Father', '')}${line('Contact #', '')}</div>
  <div class="two w">${line('Mother', '')}${line('Contact #', '')}</div>
  <div class="two w">${line('Guardian\'s Name', '')}${line('Contact #', '')}</div>
  ${line('Spouse (if married)', '')}
  <div class="two">${line('<b>Nationality</b>', '')}${line('<b>ACR NO. IF FOREIGNER</b>', '')}</div>

  ${addr('CITY ADDRESS')}
  ${addr('PROVINCIAL ADDRESS')}

  <h4>CONTACT INFORMATION</h4>
  <div class="contact"><div><span class="val">${esc(student.email ?? '')}</span><small>Email Address</small></div>
    <div><span class="val">${esc(student.phone ?? '')}</span><small>Mobile Number</small></div>
    <div><span class="val"></span><small>Landline</small></div></div>

  <h4>WHO IS SUPPORTING FOR YOUR STUDIES?</h4>
  <div class="support">${box(false)} Parents ${box(false)} Self Supporting ${box(false)} Part Self ${box(false)} Gov't/Private Business ${box(false)} University Scholarship</div>
  <p class="small">If employed state the nature of employment.</p>
  <div class="two"><div><span class="val"></span><small>Company Name</small></div><div><span class="val"></span><small>Address</small></div></div>

  <h4>EDUCATIONAL BACKGROUND</h4>
  ${line('Elementary', '')}
  ${line('Secondary', '')}
  <p class="small">COLLEGE/UNIVERSITY last attended other than UC (for transferee only).</p>
  <div class="two"><div><span class="val"></span><small>Course/Program</small></div><div class="lastsem">${line('Last Semester Attended', '')}${line('Date Graduated', '')}</div></div>
  ${line('<b>Extra Curricular Activities</b>', '')}

  <div class="cut"></div>
  <div class="terms">
    <h3>ENROLLMENT TERMS AND CONDITIONS</h3>
    <ol>
      ${TERMS.map(t => `<li>${esc(t)}</li>`).join('')}
      <li>CHARGES FOR WITHDRAWAL - when officially enrolled:
        <ul>${WITHDRAWAL.map(t => `<li>${esc(t)}</li>`).join('')}</ul></li>
    </ol>
  </div>
</section>`;
}

const CSS = `
  @page { size: 8.5in 14in; margin: 0.4in; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 9.5px/1.3 Arial, Helvetica, sans-serif; color: #000; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  /* Each sheet is legal (14in) less the 0.4in margins; the page stretches to fill it, like the printed form. */
  .page { width: 7.7in; height: 13.15in; margin: 0 auto; display: flex; flex-direction: column; page-break-after: always; break-after: page; }
  .page:last-child { page-break-after: auto; break-after: auto; }
  ${CP ? CP.BRAND_CSS : ''}
  .top { display: flex; align-items: flex-end; gap: 10px; padding-bottom: 6px; border-bottom: 1px solid #000; margin-bottom: 8px; }
  .uni { width: 96px; height: 48px; }
  .org .u { font-size: 17px; letter-spacing: .12em; }
  .org .c { font-size: 11px; letter-spacing: .12em; margin-top: 2px; }
  .org .a { font-size: 9px; letter-spacing: .08em; margin-top: 2px; }
  .formno { margin-left: auto; text-align: right; }
  .formno strong { display: block; font-size: 14px; }
  .formno span, .formno b, .formno em { display: block; font-size: 8px; font-style: normal; }
  .formno em { margin-top: 2px; color: #333; }
  .formno .revised { display: block; margin-top: 4px; padding: 2px 6px; border: 1.5px solid #000; text-decoration: none; font-size: 9px; font-weight: 700; letter-spacing: .06em; }
  .formno .revised small { display: block; max-width: 190px; margin-left: auto; font-size: 7.5px; font-weight: 400; letter-spacing: 0; }
  .fl { display: flex; align-items: flex-end; gap: 6px; margin: 3px 0; }
  .fl .lab { font-weight: 600; white-space: nowrap; font-size: 9px; letter-spacing: .03em; }
  .fl .val { flex: 1; min-height: 12px; border-bottom: 1px solid #000; padding: 0 3px; font-size: 10px; font-weight: 700; }
  .fl .val.short { flex: none; width: 36px; }
  .two { display: flex; gap: 14px; } .two > * { flex: 1; }
  .box { display: inline-block; width: 11px; height: 11px; border: 1px solid #000; vertical-align: -2px; margin: 0 2px 0 8px; text-align: center; line-height: 9px; font-size: 10px; font-weight: 700; }
  .box.on::after { content: "✓"; }
  .terms .box { margin-left: 0; }
  .id-row { display: flex; gap: 20px; } .id-row .left { flex: 1.5; } .idnum { flex: 1; padding-top: 14px; }
  .idnum .lab { display: block; font-size: 9px; font-weight: 600; margin-bottom: 2px; }
  /* Big boxes, as on the printed form: the ID is what the EDP office looks for first. */
  .boxes { display: flex; } .idbox { width: 28px; height: 36px; border: 1.5px solid #000; margin-right: -1.5px; text-align: center; font-weight: 700; font-size: 18px; line-height: 33px; }
  .stub .idbox { width: 22px; height: 28px; font-size: 14px; line-height: 25px; }
  /* Labels start every value at the same place, so the lines read as columns. */
  .id-row .left > .fl > .lab, .id-row .left .two .fl:first-child .lab { width: 100px; }
  .stub .sl .fl .lab { width: 84px; } .stub .sr > .fl > .lab, .stub .sr .two .fl:first-child .lab { width: 96px; }
  .stub .sl .fl:first-child { margin-bottom: 4px; }
  .namerow { display: flex; align-items: flex-end; gap: 14px; margin: 8px 0 12px; }
  .namerow .lab { width: 100px; font-weight: 600; font-size: 9px; letter-spacing: .03em; padding-bottom: 11px; }
  .nm { flex: 1; } .nm:nth-child(2) { flex: 1.25; } .nm:nth-child(3) { flex: 1.25; }
  .nm .val { display: block; min-height: 18px; padding: 0 4px 1px; border-bottom: 1px solid #000; font-size: 11px; font-weight: 700; text-align: center; }
  .nm small { display: block; text-align: center; font-size: 8px; letter-spacing: .08em; margin-top: 2px; }
  .main { display: flex; gap: 10px; align-items: stretch; }
  .tablecol { flex: 1.9; }
  table.subj { width: 100%; border-collapse: collapse; table-layout: fixed; }
  .subj th { background: #000; color: #fff; font-size: 8.5px; padding: 3px 2px; border: 1px solid #000; }
  .subj td { border: 1px solid #000; height: var(--row, 40px); padding: 0 3px; font-size: 9.5px; font-weight: 700; overflow: hidden; white-space: nowrap; }
  .subj td.c { text-align: center; }
  .subj th:nth-child(1) { width: 15%; } .subj th:nth-child(2) { width: 21%; } .subj th:nth-child(3) { width: 26%; }
  .subj th:nth-child(4) { width: 11%; } .subj th:nth-child(5) { width: 17%; } .subj th:nth-child(6) { width: 10%; }
  .approve { display: flex; border: 1px solid #000; border-top: 0; }
  .approve .by { flex: 1; padding: 4px 6px; min-height: 90px; } .approve .sig { height: 38px; border-bottom: 1px solid #000; margin: 14px 14px 0 4px; position: relative; }
  .cap { display: flex; justify-content: space-between; font-size: 8px; padding: 1px 18px 0 14px; }
  .approve .tot { width: 23%; border-left: 1px solid #000; text-align: center; padding: 3px; font-size: 8px; }
  .tot strong { display: block; font-size: 15px; margin-top: 8px; }
  .ack { border: 1px solid #000; margin-top: 12px; padding: 8px 10px 6px; }
  .ack h3 { text-align: center; margin: 0 0 3px; font-size: 10px; } .ack p { margin: 0 0 40px; font-size: 9.5px; }
  .cap2 { display: flex; justify-content: space-between; font-size: 8px; text-align: center; border-top: 0; }
  .cap2 span { border-top: 1px solid #000; padding-top: 1px; width: 56%; } .cap2 span:last-child { width: 30%; }
  .flow { flex: 1; display: flex; flex-direction: column; gap: 9px; } .flowbox { flex: 1; border: 1px solid #000; border-radius: 6px; padding: 8px 8px; font-size: 9.5px; position: relative; }
  .flowbox.title { flex: none; text-align: center; font-weight: 700; padding: 9px; } .flowbox.italic { font-style: italic; }
  .flowbox i { position: absolute; left: 8px; right: 8px; bottom: 12px; border-bottom: 1px solid #000; }
  .cut { border-top: 1px dashed #000; margin: 20px 0 12px; }
  .stub { display: flex; gap: 20px; }
  .stub .fl { margin: 8px 0; }
  .page:not(.p2) .cut { margin-top: auto; } .stub .sl { flex: 1; } .stub .sr { flex: 1; }
  .p2 h2 { margin: 0; font-size: 13px; } .p2 .req { margin: 0 0 6px; font-size: 8px; font-style: italic; }
  .p2 { justify-content: space-between; } .p2 .fl { margin: 6px 0; }
  .p2 > .fl > .lab, .p2 .two.w .fl:first-child .lab { width: 112px; }
  .p2 .two.w .fl:last-child .lab { width: 54px; }
  .p2 h4, .addr h4 { margin: 12px 0 4px; font-size: 10.5px; }
  .two.w .fl:first-child { flex: 5; } .two.w .fl:last-child { flex: 1.2; }
  .addr .al { display: flex; flex-wrap: wrap; margin-bottom: 2px; border-top: 0; }
  .addr .al i { flex-basis: 100%; border-bottom: 1px solid #000; height: 22px; } .addr .al { margin-bottom: 6px; }
  .addr .al span { flex: 1; text-align: center; font-size: 8px; }
  .contact { display: flex; gap: 14px; } .contact > div, .two > div { flex: 1; }
  .contact .val, .two > div > .val { display: block; min-height: 14px; border-bottom: 1px solid #000; font-weight: 700; font-size: 10px; padding: 0 3px; }
  .contact small, .two > div > small { display: block; text-align: center; font-size: 8px; }
  .support { margin: 3px 0; } .support .box { margin-left: 10px; } .support .box:first-child { margin-left: 0; }
  .small { margin: 4px 0 2px; font-size: 8.5px; }
  .terms h3 { margin: 4px 0 6px 10px; font-size: 11px; } .terms ol { margin: 0; padding-left: 28px; font-size: 9.5px; line-height: 1.5; }
  .terms ul { margin: 2px 0 0; padding-left: 90px; list-style: disc; }
`;

function html(data) {
    const sheet = build({ items: data.items });
    const name = [data.student?.last_name, data.student?.first_name].filter(Boolean).join(' ');
    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Enrollment form${name ? ' - ' + esc(name) : ''}</title>
<style>${CSS}</style></head><body>
${page1(data, sheet)}
${page2(data)}
</body></html>`;
}

function print(data) {
    if (!data?.student) return console.error('EnrollmentForm: no student');
    const w = window.open('', '_blank', 'width=900,height=1100');
    if (!w) return alert('The print window was blocked. Allow pop-ups for this site.');
    w.document.write(html(data));
    w.document.close();
    // Wait for layout (and the logo) before printing, or the first page comes out empty.
    w.onload = () => { w.focus(); w.print(); };
    setTimeout(() => { try { w.focus(); w.print(); } catch (e) {} }, 600);
}

/* Prints the form of an APPROVED plan, with the subjects the adviser approved. Returns { ok: true } or
   { ok: false, error } in words fit for the page. */
async function printApprovedRequest(supabase, requestId, helpers = {}) {
    if (!supabase) return { ok: false, error: 'Could not open the print view.' };

    const load = (itemCols) => supabase
        .from('request')
        .select(`
            id, status, registrar_status, requested_term, requested_year, created_at,
            student:student_id (id, first_name, last_name, student_id, year_level, program_id, email, phone),
            request_item (
                status, subject_id${itemCols},
                subject:subject_id (code, units),
                offering:offering_id (section)
            )
        `)
        .eq('id', requestId)
        .maybeSingle();
    let { data: req, error } = await load(', section_changed_at');
    // Before db/091 the column does not exist: print without the REVISED mark rather than not at all.
    if (error && /section_changed_at/.test(error.message ?? '')) ({ data: req, error } = await load(''));
    if (error || !req) return { ok: false, error: 'Could not load that plan.' };

    const RS = window.CurriculogicRequestStatus;
    const approved = RS
        ? RS.finalApproved(req)
        : (req.status === 'approved' || req.status === 'partially_approved') && req.registrar_status !== 'rejected';
    if (!approved) return { ok: false, error: 'This plan is not approved yet.' };

    const okItems = (req.request_item ?? []).filter(i => i.status === 'approved');
    if (!okItems.length) return { ok: false, error: 'No approved subjects on this plan to print.' };

    // Every meeting of each approved section (a lecture and its laboratory are two rows, each with its own EDP code).
    const ids = [...new Set(okItems.map(i => i.subject_id))];
    const { data: offerings, error: offErr } = await supabase.from('subject_offering')
        .select('subject_id, section, edp_code, meeting_type, schedule_days, start_time, end_time, room')
        .in('subject_id', ids)
        .eq('academic_year', req.requested_year)
        .eq('term', req.requested_term);
    if (offErr) return { ok: false, error: 'Could not load the sections of this plan.' };

    const items = okItems.map(i => ({
        code: i.subject?.code ?? '',
        units: i.subject?.units ?? 0,
        changedAt: i.section_changed_at ?? null,
        meetings: i.offering?.section
            ? (offerings ?? []).filter(o => o.subject_id === i.subject_id && o.section === i.offering.section)
            : [],
    }));

    const programs = window.CurriculogicPrograms;
    print({
        student: req.student,
        items,
        term: { number: req.requested_term, year: req.requested_year },
        ref: window.CurriculogicRequestRef?.format(req.id, req.created_at) ?? '',
        program: { name: helpers.programName ? helpers.programName(req.student) : (programs?.nameOf(req.student.program_id, '') ?? '') },
    });
    // The record of this print (db/092). A failure here must never stop the form from printing.
    try { await supabase.rpc('log_form_print', { p_request_id: req.id }); } catch (e) { /* the form is already open */ }
    return { ok: true };
}

const WHO = { student: 'the student', faculty: 'the adviser', registrar: 'the Registrar' };

const stampText = (value) => new Date(value).toLocaleString('en-PH', {
    year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila',
});

/* "Printed 3 times. Last: October 30, 2026, 10:42 AM, by Jay Darga (the adviser)." An empty string when it was never printed.
   rows: what form_print_history returns, newest first: { printed_at, printed_as, printed_by_name, total }. */
function historyText(rows) {
    const list = (rows ?? []).filter(r => r && r.printed_at && !Number.isNaN(new Date(r.printed_at).getTime()));
    if (!list.length) return '';
    const total = Math.max(Number(list[0].total) || 0, list.length);
    const last = list[0];
    const who = last.printed_by_name
        ? `${last.printed_by_name} (${WHO[last.printed_as] ?? last.printed_as})`
        : (WHO[last.printed_as] ?? '');
    return `Printed ${total === 1 ? 'once' : total + ' times'}. Last: ${stampText(last.printed_at)}${who ? ', by ' + who : ''}.`;
}

/* Reads the print record of a plan and writes the sentence into element. Quiet when there is nothing to say or the
   record is not available (before db/092): the form works either way. */
async function showHistory(supabase, requestId, element) {
    if (!supabase || !element) return;
    try {
        const { data, error } = await supabase.rpc('form_print_history', { p_request_id: Number(requestId) });
        element.textContent = error ? '' : historyText(data);
    } catch (e) {
        element.textContent = '';
    }
}

return { build, html, print, printApprovedRequest, idBoxes, timeText, revisedAt, historyText, showHistory };
}));
