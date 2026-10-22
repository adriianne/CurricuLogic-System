// curriculumprint.js
//
// The curriculum as one printable page, laid out like the printed prospectus (the BSIT 2024-2025 copy): a
// header with the college, programme and effective year and blank lines for the student's details; each
// year in its own colour with its two semesters side by side, a blank Grade column to write in, the elective
// course lists, and a summary of units by kind of course.
//
// Pure functions: the page is built from the same { subjects, rules } shape ProspectusGrid draws on screen,
// so what is printed is what is shown.
//
//   CurriculumPrint.html({ subjects, rules }, { program, college, effective })   // a full HTML page
//   CurriculumPrint.fitPaper(win)                                                // A4, or long bond if it does not fit
//
// rules: Map(subject id -> [{ code } | { label } | { mark }]), as ProspectusGrid builds it.
// A "mark" is the ** / *** standing footnote, a "label" is a standing written in words.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.CurriculumPrint = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const TERM_NAME = { 1: '1st Semester', 2: '2nd Semester', 3: 'Summer' };
const ROMAN = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV', 5: 'V' };
const YEAR_NAME = { 1: 'FIRST YEAR', 2: 'SECOND YEAR', 3: 'THIRD YEAR', 4: 'FOURTH YEAR', 5: 'FIFTH YEAR' };

/* Each year has its own colour, as on the printed copy: a dark bar and a light tint for the tables. */
const YEAR_COLOUR = {
    1: { bar: '#556b2f', tint: '#e8eed4' },
    2: { bar: '#b45309', tint: '#fbe5d3' },
    3: { bar: '#6b2230', tint: '#f3dcdf' },
    4: { bar: '#24456f', tint: '#d9e4f2' },
    5: { bar: '#4b5563', tint: '#e5e7eb' },
};

/* The colour of a subject's title follows its kind of course, as on the printed copy. */
const KIND = {
    GE:               { colour: '#2e7d32', summary: 'General Education Courses' },
    OTHER:            { colour: '#2e7d32', summary: 'General Education Courses' },   // PE and NSTP are counted with General Education
    COMMON_COMPUTING: { colour: '#c62828', summary: 'Core Computing Courses' },
    PROFESSIONAL_IT:  { colour: '#1d3fbf', summary: 'Professional IT Courses' },
    ELECTIVE:         { colour: '#111111', summary: 'IT Electives / Free Electives' },
};
const SUMMARY_ORDER = ['General Education Courses', 'Core Computing Courses', 'Professional IT Courses', 'IT Electives / Free Electives'];
const kindOf = (s) => KIND[s.category] ?? { colour: '#111111', summary: null };

/* Paper. The page prints on A4 when the curriculum fits there, and on long bond (8.5 x 13 in, the usual
   "long" paper) when it does not. Heights are CSS pixels at 96 dpi of the usable area, margins taken off. */
const PAPER = {
    a4:   { css: 'A4 portrait', usable: 1070 },   // 297 mm - 2 x 7 mm
    long: { css: '8.5in 13in',  usable: 1194 },   // 13 in  - 2 x 7 mm
};

/* Which paper a page of this height (px, measured at the printable width) needs. */
const paperFor = (heightPx) => (heightPx <= PAPER.a4.usable ? 'a4' : 'long');

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const unitText = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));

const isSlot = (s) => s.is_elective && s.year_level != null;

/* What goes in the pre-requisite cell of one subject. */
function preParts(subject, rules) {
    // A placeholder slot in a semester means "choose one from the catalogue".
    if (isSlot(subject)) return [{ kind: 'bullet', text: subject.elective_type === 'FREE' ? '●●' : '●' }];
    const list = (rules instanceof Map ? rules.get(subject.id) : rules?.[subject.id]) ?? [];
    return list.map(r => {
        if (r.mark) return { kind: 'mark', text: r.mark };
        if (r.label) return { kind: 'text', text: r.label };
        return r.code ? { kind: 'code', text: r.code } : null;
    }).filter(Boolean);
}

function preText(subject, rules) {
    return preParts(subject, rules).map(p => p.text).join(', ');
}

function preHtml(subject, rules) {
    return preParts(subject, rules).map(p => {
        const t = esc(p.text);
        if (p.kind === 'mark') return `<span class="mk">${t}</span>`;
        if (p.kind === 'bullet') return `<span class="bl">${t}</span>`;
        return t;
    }).join(', ');
}

/* The numbering of the unfilled elective slots: "IT Elective 1", "Free Elective 2", in curriculum order. */
function slotNames(placed) {
    const names = new Map();
    let it = 0, free = 0;
    const ordered = [...placed].filter(isSlot)
        .sort((a, b) => (a.year_level - b.year_level) || (a.term - b.term) || (num(a.id) - num(b.id)));
    for (const s of ordered) {
        names.set(s.id, s.elective_type === 'FREE' ? `Free Elective ${++free}` : `IT Elective ${++it}`);
    }
    return names;
}

/* The code of an unfilled slot is printed as a blank to write in, like "IT-EL______". */
const slotCode = (code) => String(code ?? '').replace(/[\s\d]+$/, '') + '_____';

function row(s, rules, names, first, grade = '') {
    const slot = isSlot(s);
    const colour = slot ? '#111111' : kindOf(s).colour;
    return `${first ? '' : '<tr>'}
        <td class="gr">${esc(grade)}</td>
        <td class="code">${esc(slot ? slotCode(s.code) : s.code)}</td>
        <td class="ttl" style="color:${colour}">${esc(slot ? (names.get(s.id) ?? 'Elective') : (s.title ?? ''))}</td>
        <td class="n">${esc(unitText(num(s.lec_units)))}</td>
        <td class="n">${esc(unitText(num(s.lab_units)))}</td>
        <td class="n">${esc(unitText(num(s.units)))}</td>
        <td class="pre">${preHtml(s, rules)}</td>
    </tr>`;
}

const blankCells = '<td class="gr"></td><td class="code"></td><td></td><td class="n"></td><td class="n"></td><td class="n"></td><td></td></tr>';

/* One semester: a coloured number and a sideways label on the left, then Grade, code, title, units, pre-requisite.
   `pad` adds empty rows so the two semesters of a year come out the same height, as on the printed copy. */
function semesterTable(term, number, rows, rules, names, colour, pad, gradeOf = () => '') {
    const tot = rows.reduce((a, s) => a + num(s.units), 0);
    const lines = rows.map(s => ({ s })).concat(Array.from({ length: Math.max(0, pad) }, () => ({ s: null })));
    const body = lines.map((l, i) => {
        const cells = l.s ? row(l.s, rules, names, i === 0, gradeOf(l.s)) : ((i === 0 ? '' : '<tr class="blank">') + blankCells);
        return (i === 0 ? `<tr><td class="side" rowspan="${lines.length}" style="background:${colour.tint}"><span>${esc(TERM_NAME[term])}</span></td>` : '') + cells;
    }).join('');
    return `<div class="sem">
        <table style="--tint:${colour.tint};--bar:${colour.bar}">
            <colgroup><col class="c-side"><col class="c-gr"><col class="c-code"><col><col class="c-n"><col class="c-n"><col class="c-n"><col class="c-pre"></colgroup>
            <thead>
                <tr>
                    <th rowspan="2" class="side-head" style="background:${colour.bar}">${esc(number)}</th>
                    <th rowspan="2" class="tint">Grade</th>
                    <th rowspan="2" class="tint">Course Code</th>
                    <th rowspan="2" class="tint">Descriptive Title</th>
                    <th colspan="3" class="tint units">Units</th>
                    <th rowspan="2" class="tint">Pre-requisite / Remarks</th>
                </tr>
                <tr><th class="tint n sm">lec</th><th class="tint n sm">lab</th><th class="tint n sm">total</th></tr>
            </thead>
            <tbody>${body}</tbody>
            <tfoot><tr><td colspan="6" class="r tintbg">Total</td><td class="n tintbg">${esc(unitText(tot))}</td><td class="tintbg"></td></tr></tfoot>
        </table>
    </div>`;
}

/* The numbers a page needs: the years in order, the semesters of each, the catalogue, the totals by kind. */
function build({ subjects, rules }) {
    const all = subjects ?? [];
    // Curriculum order, not alphabetical: subjects are saved in the order the curriculum lists them, so the
    // order they were added is the order of the printed copy. A subject added later by hand comes last.
    const placed = all.filter(s => s.year_level != null && s.term != null)
        .sort((a, b) => num(a.id) - num(b.id));
    const years =[...new Set(placed.map(s => s.year_level))].sort((a, b) => a - b);
    const byYear = years.map(y => {
        const inYear = placed.filter(s => s.year_level === y);
        const terms = [1, 2, 3]
            .map(t => ({ term: t, rows: inYear.filter(s => s.term === t) }))
            .filter(t => t.rows.length);
        return { year: y, terms };
    });

    const byKind = new Map();
    for (const s of placed) {
        const label = isSlot(s) ? KIND.ELECTIVE.summary : kindOf(s).summary;
        if (!label) continue;
        byKind.set(label, (byKind.get(label) ?? 0) + num(s.units));
    }

    return {
        years: byYear,
        catalogue: all.filter(s => s.year_level == null),
        totalUnits: placed.reduce((a, s) => a + num(s.units), 0),
        summary: SUMMARY_ORDER.filter(l => byKind.has(l)).map(l => ({ label: l, units: byKind.get(l) })),
        hasItSlots: placed.some(s => isSlot(s) && s.elective_type !== 'FREE'),
        hasFreeSlots: placed.some(s => isSlot(s) && s.elective_type === 'FREE'),
        names: slotNames(placed),
        rules,
    };
}

function catalogueBox(title, items, rules) {
    const rows = items.map(s => `<tr>
        <td class="box"><span></span></td>
        <td class="cc">${esc(s.code)}</td>
        <td>${esc(s.title ?? '')}</td>
        <td class="n">${esc(unitText(num(s.units)))}</td>
        <td class="pre">${preHtml(s, rules)}</td>
    </tr>`).join('');
    return `<div class="cat">
        <table>
            <colgroup><col class="c-box"><col class="c-cc"><col><col class="c-n"><col class="c-pre"></colgroup>
            <thead><tr><th colspan="3" class="l">${esc(title)}</th><th class="n sm">units</th><th class="sm">Pre-requisite</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>
    </div>`;
}

function html(data, info = {}) {
    const b = build(data);
    const rules = data.rules;

    // A degree audit fills the Grade column and the student lines; a blank curriculum leaves them to write in.
    // grades: { subjectId: "1.75" } (or a Map). student: { name, id }.
    const grades = info.grades ?? {};
    const gradeOf = (s) => String((grades instanceof Map ? grades.get(s.id) : grades[s.id]) ?? '');
    const studentId = info.student?.id ? esc(info.student.id) : '';
    const studentName = info.student?.name ? esc(info.student.name) : '';

    const years = b.years.map(y => {
        const colour = YEAR_COLOUR[y.year] ?? YEAR_COLOUR[5];
        const main = y.terms.filter(t => t.term !== 3);
        const summer = y.terms.find(t => t.term === 3);
        const tallest = Math.max(0, ...main.map(t => t.rows.length));
        const number = (t) => String((y.year - 1) * 2 + t.term);
        return `<section class="yr">
            <div class="bar" style="background:${colour.bar}">${esc(ROMAN[y.year] ?? y.year)} - ${esc(YEAR_NAME[y.year] ?? 'YEAR ' + y.year)}</div>
            <div class="sems">${main.map(t => semesterTable(t.term, number(t), t.rows, rules, b.names, colour, tallest - t.rows.length, gradeOf)).join('')}</div>
            ${summer ? `<div class="sems one">${semesterTable(3, 'S', summer.rows, rules, b.names, colour, 0, gradeOf)}</div>` : ''}
        </section>`;
    }).join('');

    const itCat = b.catalogue.filter(s => s.elective_type !== 'FREE');
    const freeCat = b.catalogue.filter(s => s.elective_type === 'FREE');

    const legend = [
        '<div><span class="mk">**</span> <i>must finish all 1st year to 2nd year courses</i></div>',
        '<div><span class="mk">***</span> <i>must finish all 1st year to 3rd year courses</i></div>',
        b.hasItSlots ? '<div><span class="bl">●</span> <i>choose from the IT elective courses</i></div>' : '',
        b.hasFreeSlots ? '<div><span class="bl">●●</span> <i>choose from the free elective courses</i></div>' : '',
    ].filter(Boolean).join('');

    const summaryRows = b.summary.map(r => {
        const colour = Object.values(KIND).find(k => k.summary === r.label)?.colour ?? '#111';
        return `<tr style="color:${colour}"><td>${esc(r.label)}</td><td class="n">${esc(unitText(r.units))} units</td></tr>`;
    }).join('');
    const summary = `<div class="sum">
        <div class="sumhead">SUMMARY OF COURSES</div>
        <table>${summaryRows}
            <tr class="grand"><td class="r">TOTAL</td><td class="n">${esc(unitText(b.totalUnits))} UNITS</td></tr>
        </table>
    </div>`;

    const left = itCat.length ? catalogueBox('● IT ELECTIVE COURSES:', itCat, rules) : '';
    const right = freeCat.length ? catalogueBox('●● FREE ELECTIVE COURSES:', freeCat, rules) : '';

    const effective = info.effective ? `Effective School Year ${esc(info.effective)}` : '';
    const printed = new Date().toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });

    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(info.program || 'Curriculum')}</title>
<style id="paper">@page { size: A4 portrait; margin: 7mm; }</style>
<style>
  * { box-sizing: border-box; }
  body { font: 7pt/1.2 Arial, Helvetica, sans-serif; color: #111; margin: 0; padding: 8px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .head { display: flex; align-items: flex-end; gap: 10px; margin-bottom: 3px; }
${BRAND_CSS}
  .head .col { font: bold 15pt Arial Narrow, Arial, sans-serif; line-height: 1.05; }
  .head .prog { font-size: 9.5pt; font-weight: bold; }
  .head .eff { font-size: 7pt; font-style: italic; }
  .who { display: flex; justify-content: space-between; gap: 16px; font-size: 6.4pt; font-weight: bold; margin: 2px 0 3px; }
  .who div { display: flex; flex-direction: column; gap: 4px; flex: 1; }
  .who span { display: flex; gap: 4px; align-items: flex-end; }
  .who span i { flex: 1; border-bottom: .6px solid #000; min-height: 7px; font-style: normal; font-weight: normal; padding-left: 3px; }
  td.gr { text-align: center; font-size: 6pt; white-space: nowrap; overflow: hidden; }
  .bar { color: #fff; text-align: center; font-weight: bold; font-size: 7.4pt; padding: 1px 0; margin-top: 3px; }
  .sems { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 2px; }
  .sems.one { grid-template-columns: 1fr; }
  table { border-collapse: collapse; width: 100%; table-layout: fixed; }
  th, td { border: .5px solid #333; padding: 0 2px; vertical-align: middle; text-align: left; }
  th.tint { background: var(--tint); font-size: 5.8pt; text-align: center; padding: 0 1px; }
  th.units { font-size: 6pt; }
  th.sm { font-size: 5pt; padding: 0; }
  th.side-head { color: #fff; font-size: 6.4pt; text-align: center; padding: 0; }
  td.side { text-align: center; padding: 0; }
  td.side span { writing-mode: vertical-rl; transform: rotate(180deg); font-size: 6.4pt; font-weight: bold; white-space: nowrap; }
  .sem table { font-size: 6.4pt; }
  col.c-side { width: 3.4%; } col.c-gr { width: 6.5%; } col.c-code { width: 20%; }
  col.c-n { width: 4.2%; } col.c-pre { width: 19%; }
  td.n, th.n { text-align: center; }
  td.code { font-weight: bold; white-space: nowrap; overflow: hidden; }
  td.pre { font-size: 5.8pt; font-style: italic; text-align: center; }
  tr.blank td { height: 9px; }
  td.r { text-align: right; font-weight: bold; }
  td.tintbg { background: var(--tint); font-weight: bold; }
  .mk { color: #c00; font-style: normal; font-weight: bold; }
  .bl { color: #2e7d32; font-style: normal; font-weight: bold; }
  .cats { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 4px; align-items: start; }
  .cat { border: .6px solid #333; }
  .cat table { font-size: 6.2pt; }
  .cat th, .cat td { border: none; padding: 0 2px; }
  .cat th { background: #e5e5e5; font-size: 6.6pt; }
  .cat th.l { text-align: left; }
  col.c-box { width: 5%; } col.c-cc { width: 20%; }
  .cat col.c-n { width: 9%; } .cat col.c-pre { width: 22%; }
  td.box span { display: inline-block; width: 5px; height: 5px; border: .6px solid #000; }
  .legend { border: .6px solid #333; padding: 2px 4px; font-size: 6pt; font-weight: bold; }
  .cat + .legend { border-top: none; }
  .sum { border: .6px solid #333; margin-top: 4px; }
  .cat + .sum, .sum:first-child { margin-top: 4px; }
  .sumhead { background: #e5e5e5; text-align: center; font-weight: bold; font-size: 6.8pt; border-bottom: .6px solid #333; }
  .sum table td { border: none; font-size: 6.6pt; padding: 0 4px; }
  .sum tr.grand td { font-weight: bold; border-top: .6px solid #000; color: #000; }
  .foot { margin-top: 3px; color: #555; font-size: 5.6pt; }
  .yr, .sem, .cats { break-inside: avoid; }
  @media print { body { padding: 0; } }
</style></head><body>
<div class="head">
  ${brandHtml(info.logo)}
  <div>
    <div class="col">${esc(info.college || 'University of Cebu')}</div>
    <div class="prog">${esc(info.program || '')}</div>
    ${effective ? `<div class="eff">${effective}</div>` : ''}
  </div>
</div>
<div class="who">
  <div><span>Student's ID Number: <i>${studentId}</i></span><span>Student's Full Name: <i>${studentName}</i></span></div>
  <div><span>Date Started / First Enrolled: <i></i></span><span>Expected Date of Graduation: <i></i></span></div>
</div>
${years}
<div class="cats">
  <div>${left}<div class="legend">${legend}</div></div>
  <div>${right}${summary}</div>
</div>
<div class="foot">Printed ${esc(printed)} from CurricuLogic. This copy shows the curriculum as encoded in the system.</div>
</body></html>`;
}

/* Called by the page that opened the print window, once the window has loaded. The window is written by
   this page, so the page does the measuring (an inline script in the window would be blocked by the
   Content-Security-Policy). Measures at the printable width of A4 and widens the sheet to long bond when
   the curriculum does not fit. Returns "a4" or "long". */
function fitPaper(win) {
    const doc = win.document;
    const keep = doc.body.style.width;
    doc.body.style.width = '741px';                       // 210 mm - 2 x 7 mm
    const paper = paperFor(doc.body.scrollHeight);
    doc.body.style.width = keep;
    if (paper === 'long') {
        doc.getElementById('paper').textContent = '@page { size: ' + PAPER.long.css + '; margin: 7mm; }';
    }
    return paper;
}

/* Pieces the other printed forms (advising slip, enrolment sheet) share, so every printout has one look. */
const yearColour = (year) => YEAR_COLOUR[year] ?? YEAR_COLOUR[4];
/* The university logo (assets/UC_Logo.png). The file has a wide empty margin round the artwork, so it is cropped
   to the artwork with CSS. The path is relative to the page that opens the print window
   (features/<role>/...). */
const LOGO_URL = '../../assets/UC_Logo.png';
const brandHtml = (url = LOGO_URL) => `<div class="uni"><img src="${esc(url)}" alt="University of Cebu"></div>`;
const BRAND_CSS = [
    '  .uni { position: relative; width: 64px; height: 32px; overflow: hidden; flex: none; }',
    '  .uni img { position: absolute; width: 105.8%; left: -2.9%; top: -41%; }',
].join('\n');

return { html, build, preText, paperFor, fitPaper, PAPER, YEAR_COLOUR, yearColour, brandHtml, BRAND_CSS };

}));
