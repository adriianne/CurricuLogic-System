// sectionlist.js
//
// "Sections this term" on the Department Schedule tab: one line per section that has saved offerings for the chosen year and
// term, with how complete it is, and the printable timetable of one section. Pure functions (no DOM, no database), so the
// rules can be tested in Node.
//
//   summarize(offerings, subjectOf)        -> [{ section, level, letter, rows, subjects, lectures, labs, units, timed, state }]
//   parts(section)                         -> { level, letter } | null           ("ACT-1A" -> 1, "A")
//   timetableHtml({ section, termText, rows, subjectOf, programName })  -> a complete printable HTML page
//
// state: 'ready'   every row has days and a start and end time
//        'partial' some rows are timed, some are not
//        'empty'   no row has a time yet

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.CurriculogicSectionList = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const isTimed = (r) => !!(r && typeof r.schedule_days === 'string' && r.schedule_days.trim() && r.start_time && r.end_time);

/* "ACT-1A" -> { level: 1, letter: 'A' }. Prefix-agnostic, like the rest of the page. null when the shape is not recognised. */
function parts(section) {
    const m = String(section ?? '').match(/^[A-Z]+-(\d)([A-Z]+)$/i);
    return m ? { level: Number(m[1]), letter: m[2].toUpperCase() } : null;
}

/* Year level first, then letter, so ACT-1A, ACT-1B, ACT-2A. A name that is not in the usual shape goes last, alphabetically. */
function bySection(a, b) {
    const pa = parts(a.section), pb = parts(b.section);
    if (pa && pb) return pa.level - pb.level || pa.letter.localeCompare(pb.letter);
    if (pa) return -1;
    if (pb) return 1;
    return String(a.section).localeCompare(String(b.section));
}

function summarize(offerings, subjectOf) {
    const bySec = new Map();
    for (const o of offerings || []) {
        if (!o || !o.section) continue;
        if (!bySec.has(o.section)) bySec.set(o.section, []);
        bySec.get(o.section).push(o);
    }
    const out = [];
    for (const [section, rows] of bySec) {
        const timed = rows.filter(isTimed).length;
        const lectures = rows.filter(r => !r.meeting_type || r.meeting_type === 'LEC').length;
        const labs = rows.filter(r => r.meeting_type === 'LAB').length;
        // A laboratory row carries no units of its own: the subject's units belong to its lecture row.
        let units = 0;
        for (const r of rows) {
            if (r.meeting_type === 'LAB') continue;
            const s = typeof subjectOf === 'function' ? subjectOf(r.subject_id) : null;
            units += Number(s && s.units) || 0;
        }
        const p = parts(section);
        out.push({
            section,
            level: p ? p.level : null,
            letter: p ? p.letter : null,
            rows: rows.length,
            subjects: new Set(rows.map(r => r.subject_id)).size,
            lectures, labs, units, timed,
            state: timed === rows.length ? 'ready' : timed > 0 ? 'partial' : 'empty',
        });
    }
    return out.sort(bySection);
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const clock = (t) => {
    if (!t) return '';
    const [h, m] = String(t).split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return '';
    return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};

const KIND_ORDER = { LEC: 0, LAB: 1 };

/* One section as a printable page: a row per meeting, subjects in code order with the lecture before its lab. */
function timetableHtml({ section, termText, rows, subjectOf, programName }) {
    const list = [...(rows || [])].sort((a, b) => {
        const sa = typeof subjectOf === 'function' ? subjectOf(a.subject_id) : null;
        const sb = typeof subjectOf === 'function' ? subjectOf(b.subject_id) : null;
        const ca = String((sa && sa.code) || ''), cb = String((sb && sb.code) || '');
        return ca.localeCompare(cb) || (KIND_ORDER[a.meeting_type] ?? 0) - (KIND_ORDER[b.meeting_type] ?? 0);
    });
    const body = list.map(r => {
        const s = typeof subjectOf === 'function' ? subjectOf(r.subject_id) : null;
        const time = r.start_time && r.end_time ? `${clock(r.start_time)} – ${clock(r.end_time)}` : '';
        return `<tr>
  <td>${esc(r.edp_code)}</td>
  <td>${esc((s && s.code) || '')}</td>
  <td>${esc((s && s.title) || '')}</td>
  <td>${esc(r.meeting_type === 'LAB' ? 'Lab' : 'Lec')}</td>
  <td>${esc(r.schedule_days)}</td>
  <td>${esc(time)}</td>
  <td>${esc(r.room)}</td>
</tr>`;
    }).join('\n');
    return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${esc(section)} — timetable</title>
<style>
  @page { size: A4 portrait; margin: 14mm; }
  body { font: 12px/1.4 Arial, Helvetica, sans-serif; color: #111; }
  h1 { font-size: 18px; margin: 0 0 2px; }
  p.sub { margin: 0 0 12px; color: #444; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #888; padding: 5px 7px; text-align: left; vertical-align: top; }
  th { background: #eee; }
  tr { break-inside: avoid; }
  p.foot { margin-top: 14px; color: #555; font-size: 11px; }
</style></head><body>
<h1>${esc(section)}</h1>
<p class="sub">${esc([programName, termText].filter(Boolean).join(' · '))}</p>
<table>
<thead><tr><th>EDP code</th><th>Code</th><th>Subject</th><th>Type</th><th>Days</th><th>Time</th><th>Room</th></tr></thead>
<tbody>
${body}
</tbody></table>
<p class="foot">${list.length} meeting${list.length === 1 ? '' : 's'}. Printed from CurricuLogic.</p>
</body></html>`;
}

return { parts, summarize, timetableHtml, isTimed };
}));
