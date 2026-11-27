// offsem.js
//
// Off-semester sections. A student who failed a subject of ANOTHER semester (a 1st-semester subject, now it is the 2nd)
// needs a section of it this term, and the schedule builder does not allow one ("wrong term"). This panel lets the
// System administrator and the Department post one. It calls db/133: public.add_offsem_section / remove_offsem_section,
// which do the real checks (clashes, EDP code, who may call). The checks here only save a round trip and say it in words.
//
//   OffsemSections.validateDraft({ programCode, section, hasLab, meetings })  -> [messages]   ([] = fine)
//   OffsemSections.nextSectionName(programCode, year, taken)                  -> 'BSIT-1R'
//   OffsemSections.isOffSem(subject, term)                                    -> true when the subject belongs to another semester
//   OffsemSections.describeError(error)                                       -> the sentence to show
//   OffsemSections.mount(container, { supabase, programs, onChange })         draws the panel and wires it
//
// Pure apart from mount(). Tested in tests/offsem.test.mjs.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.OffsemSections = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const DAY_RE = /^(TH|[MTWFS])+$/;
const LETTERS = 'RSTUVWXYZ';          // R for retake, then the next free letter; never clashes with the regular A, B, C ...

const normalizeDays = (s) => String(s ?? '').toUpperCase().replace(/\s+/g, '');
const daysValid = (s) => DAY_RE.test(normalizeDays(s));
function toMinutes(t) {
    const m = /^(\d{1,2}):(\d{2})/.exec(String(t ?? ''));
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function nextSectionName(programCode, year, taken = []) {
    const used = new Set((taken ?? []).map((s) => String(s).toUpperCase()));
    for (const l of LETTERS) {
        const name = `${String(programCode).toUpperCase()}-${Number(year) || 1}${l}`;
        if (!used.has(name)) return name;
    }
    return `${String(programCode).toUpperCase()}-${Number(year) || 1}R`;
}

const isOffSem = (subject, term) => subject?.term != null && Number(subject.term) !== Number(term);

function validateDraft({ programCode, section, hasLab, meetings } = {}) {
    const out = [];
    const code = String(programCode ?? '').toUpperCase();
    const sec = String(section ?? '').trim().toUpperCase();
    if (!code) out.push('Choose a programme.');
    else if (!new RegExp(`^${code}-[1-9][A-Z]$`).test(sec)) out.push(`Name the section ${code}, a dash, the year and a letter, for example ${code}-1R.`);

    const list = (meetings ?? []).filter((m) => m && (m.type === 'LEC' || m.type === 'LAB'));
    if (!list.some((m) => m.type === 'LEC')) out.push('Add the lecture meeting.');
    const edps = new Set();
    for (const m of list) {
        const label = m.type === 'LAB' ? 'Laboratory' : 'Lecture';
        if (m.type === 'LAB' && !hasLab) { out.push('This subject has no laboratory.'); continue; }
        if (!daysValid(m.days)) out.push(`${label}: days must be letters like MW, TTH, F or S.`);
        const a = toMinutes(m.start), b = toMinutes(m.end);
        if (a == null || b == null) out.push(`${label}: give the start and end time.`);
        else if (a >= b) out.push(`${label}: the start must be before the end.`);
        else if (a < 7 * 60 || b > 21 * 60) out.push(`${label}: classes run between 07:00 and 21:00.`);
        if (!String(m.room ?? '').trim()) out.push(`${label}: give a room.`);
        const edp = String(m.edp_code ?? '').trim();
        if (!/^\d{5}$/.test(edp)) out.push(`${label}: the EDP code is five digits.`);
        else if (edps.has(edp)) out.push('The lecture and the laboratory need different EDP codes.');
        edps.add(edp);
    }
    return out;
}

function describeError(error) {
    const msg = String(error?.message ?? error ?? '').trim();
    if (!msg) return 'Something went wrong. Nothing was changed.';
    if (/row-level security|permission denied/i.test(msg)) return 'You are not allowed to do that for this programme.';
    if (/uq_offering_edp|duplicate key/i.test(msg)) return 'That EDP code is already used this term.';
    return msg.replace(/^ERROR:\s*/i, '');
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hhmm = (t) => String(t ?? '').slice(0, 5);
const TERM_NAME = { 1: '1st Semester', 2: '2nd Semester', 3: 'Summer' };

/* One small style block, drawn once. It uses the dashboards' own colour tokens (with fallbacks), so it follows the light
   and the dark theme, and it collapses to one column on a phone. */
const STYLE = `
.offsem{display:grid;gap:var(--s3,1.25rem)}
.offsem [hidden]{display:none!important}
.offsem .os-grid{display:grid;gap:.85rem;grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}
.offsem .os-top{grid-template-columns:minmax(110px,.6fr) minmax(130px,.7fr) minmax(240px,2.4fr) minmax(130px,.8fr)}
.offsem .os-f{display:flex;flex-direction:column;gap:.3rem;min-width:0}
.offsem .os-f>label{font-size:.72rem;font-weight:600;letter-spacing:.03em;text-transform:uppercase;color:var(--ink-3,#8c8677)}
.offsem .os-f>label .dim{text-transform:none;letter-spacing:0;font-weight:400}
.offsem .os-f input,.offsem .os-f select{width:100%;box-sizing:border-box;padding:.55rem .65rem;border:1px solid var(--line-strong,#c9c1ad);border-radius:8px;background:var(--surface,#fff);color:var(--ink,inherit);font:inherit;min-height:2.4rem}
.offsem .os-f input:focus,.offsem .os-f select:focus{outline:2px solid var(--accent,#4f46e5);outline-offset:1px;border-color:transparent}
.offsem .os-f input.is-bad{border-color:#c0392b;background:rgba(192,57,43,.06)}
.offsem .os-hint{font-size:.72rem;color:var(--ink-3,#8c8677)}
.offsem .os-subject{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem .75rem;padding:.7rem .9rem;border-radius:10px;background:var(--surface-2,rgba(0,0,0,.03));font-size:.88rem;color:var(--ink-2,inherit)}
.offsem .os-badge{font-size:.7rem;font-weight:600;padding:.12rem .55rem;border-radius:999px;border:1px solid currentColor;white-space:nowrap}
.offsem .os-badge.off{color:#b45309}.offsem .os-badge.in{color:#047857}
.offsem .os-meetings{display:grid;gap:.85rem;grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr))}
.offsem .os-card{border:1px solid var(--line,#e3dccb);border-radius:12px;padding:.95rem 1rem 1.05rem;background:var(--surface,transparent)}
.offsem .os-card h4{margin:0 0 .75rem;font-size:.9rem;display:flex;align-items:center;gap:.5rem}
.offsem .os-card .os-grid{grid-template-columns:repeat(auto-fit,minmax(110px,1fr))}
.offsem .os-wide{grid-column:span 2}
.offsem .os-preview{font-size:.86rem;padding:.65rem .9rem;border-left:3px solid var(--accent,#4f46e5);background:var(--accent-soft,rgba(79,70,229,.07));border-radius:0 8px 8px 0;color:var(--ink,inherit)}
.offsem .os-actions{display:flex;flex-wrap:wrap;align-items:center;gap:.75rem}
.offsem .os-problems{margin:0;padding-left:1.15rem}
.offsem .os-sec{border:1px solid var(--line,#e3dccb);border-radius:12px;overflow:hidden;margin-bottom:.75rem;background:var(--surface,transparent)}
.offsem .os-sec-head{display:flex;justify-content:space-between;align-items:center;gap:.75rem;padding:.6rem .95rem;background:var(--surface-2,rgba(0,0,0,.03));border-bottom:1px solid var(--line,#e3dccb)}
.offsem .os-sec table{width:100%;border-collapse:collapse;font-size:.85rem}
.offsem .os-sec th{font-size:.7rem;text-transform:uppercase;letter-spacing:.03em;text-align:left;color:var(--ink-3,#8c8677);padding:.45rem .95rem;font-weight:600}
.offsem .os-sec td{padding:.45rem .95rem;border-top:1px solid var(--line,#eee)}
.offsem .os-empty{padding:1.1rem;border:1px dashed var(--line-strong,#c9c1ad);border-radius:12px;text-align:center;color:var(--ink-3,#8c8677);font-size:.9rem}
.offsem h4.os-h{margin:0 0 .6rem;font-size:.95rem;display:flex;flex-wrap:wrap;gap:.5rem;align-items:baseline}
@media (max-width:640px){.offsem .os-top{grid-template-columns:1fr 1fr}.offsem .os-top .os-subj{grid-column:1/-1}.offsem .os-wide{grid-column:auto}}
`;

function ensureStyle() {
    if (typeof document === 'undefined' || document.getElementById('offsem-style')) return;
    const el = document.createElement('style'); el.id = 'offsem-style'; el.textContent = STYLE; document.head.appendChild(el);
}

async function mount(container, { supabase, programs, onChange } = {}) {
    if (!container || !supabase || !(programs ?? []).length) return null;
    ensureStyle();
    const st = { programs, programId: programs[0].id, versions: [], versionId: null, subjects: [], year: null, term: null, offerings: [] };

    container.innerHTML = `
        <div class="offsem">
            <p class="prose" data-os="intro" style="margin:0;">Offer a subject of <strong>another semester</strong> in the current term, so a student who failed it can retake it.
                It becomes an ordinary section: it shows in Build your plan, the adviser's view and the enrollment form.</p>

            <div class="os-grid os-top">
                <div class="os-f" data-os="program-wrap"><label>Programme</label><select data-os="program"></select></div>
                <div class="os-f"><label>Curriculum</label><select data-os="version"></select></div>
                <div class="os-f os-subj"><label>Subject</label><select data-os="subject"></select></div>
                <div class="os-f"><label>Section</label><input data-os="section" type="text" maxlength="12" autocomplete="off" spellcheck="false"></div>
            </div>

            <div class="os-subject" data-os="subjectinfo" aria-live="polite"></div>
            <div class="os-meetings" data-os="meetings"></div>
            <div class="os-preview" data-os="preview" aria-live="polite"></div>

            <div class="os-actions">
                <button type="button" class="btn-small" data-os="add"><i class="fa-solid fa-plus" aria-hidden="true"></i> Add the section</button>
                <span class="os-hint">Rooms, instructors and EDP codes are checked for clashes before anything is saved.</span>
            </div>
            <div class="msg" role="status" data-os="msg"></div>

            <div>
                <h4 class="os-h">Off-semester sections this term <span class="dim" data-os="termnote"></span></h4>
                <div data-os="list"></div>
            </div>
        </div>`;

    const $ = (k) => container.querySelector(`[data-os="${k}"]`);
    const say = (text, kind) => {
        const el = $('msg');
        if (Array.isArray(text)) el.innerHTML = text.length === 1 ? esc(text[0]) : `<ul class="os-problems">${text.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`;
        else el.textContent = text || '';
        el.className = 'msg' + (kind ? ` is-${kind}` : '');
    };
    const program = () => st.programs.find((p) => String(p.id) === String(st.programId));
    const subject = () => st.subjects.find((s) => String(s.id) === String($('subject').value));

    function meetingCard(type, label, hint) {
        return `<div class="os-card" data-os-row="${type}">
            <h4>${label} <span class="os-hint">${hint}</span></h4>
            <div class="os-grid">
                <div class="os-f"><label>Days</label><input data-f="days" type="text" placeholder="MW" maxlength="8" autocomplete="off"><span class="os-hint">M T W TH F S</span></div>
                <div class="os-f"><label>Start</label><input data-f="start" type="time" step="900"></div>
                <div class="os-f"><label>End</label><input data-f="end" type="time" step="900"></div>
                <div class="os-f"><label>Room</label><input data-f="room" type="text" maxlength="40" autocomplete="off"></div>
                <div class="os-f"><label>EDP code</label><input data-f="edp_code" type="text" inputmode="numeric" maxlength="5" placeholder="5 digits" autocomplete="off"></div>
                <div class="os-f os-wide"><label>Instructor <span class="dim">(optional)</span></label><input data-f="instructor" type="text" maxlength="80" autocomplete="off"></div>
            </div>
        </div>`;
    }

    function drawSubjectInfo() {
        const s = subject();
        if (!s) { $('subjectinfo').textContent = 'Choose a subject.'; return; }
        const off = isOffSem(s, st.term);
        const where = s.year_level == null ? 'Elective' : `Year ${s.year_level} · ${TERM_NAME[s.term] ?? 'Term ' + s.term}`;
        const lab = Number(s.lab_units ?? 0) > 0;
        $('subjectinfo').innerHTML = `<strong>${esc(s.code)}</strong> ${esc(s.title)} <span>· ${where} · ${esc(s.units)} units${lab ? ' · has a laboratory' : ''}</span> `
            + `<span class="os-badge ${off ? 'off' : 'in'}">${off ? 'Off-semester' : 'Same semester'}</span>`;
    }

    function readMeetings() {
        return [...container.querySelectorAll('[data-os-row]')].map((row) => {
            const g = (f) => row.querySelector(`[data-f="${f}"]`)?.value ?? '';
            return { type: row.dataset.osRow, days: normalizeDays(g('days')), start: g('start'), end: g('end'), room: g('room').trim(), instructor: g('instructor').trim(), edp_code: g('edp_code').trim() };
        });
    }

    function drawPreview() {
        const s = subject(); const sec = String($('section').value || '').trim().toUpperCase();
        const parts = readMeetings().filter((m) => m.days || m.start || m.end || m.room || m.edp_code).map((m) =>
            `${m.type === 'LAB' ? 'Lab' : 'Lecture'} ${m.days || '—'} ${m.start || '—'}–${m.end || '—'}, ${m.room || 'room?'}${m.edp_code ? ' (EDP ' + m.edp_code + ')' : ''}`);
        $('preview').textContent = s
            ? `Will post: ${sec || 'section?'} · ${s.code}${parts.length ? ' · ' + parts.join(' · ') : ' · fill in the meetings above'}`
            : 'Choose a subject to begin.';
    }

    function drawMeetings() {
        const s = subject();
        const hasLab = Number(s?.lab_units ?? 0) > 0;
        $('meetings').innerHTML = meetingCard('LEC', 'Lecture', 'required') + (hasLab ? meetingCard('LAB', 'Laboratory', 'this subject has a lab') : '');
        drawSubjectInfo(); drawPreview();
    }

    function suggestSection() {
        const s = subject(); const p = program();
        if (!p) return;
        const taken = [...new Set(st.offerings.map((o) => o.section))];
        $('section').value = nextSectionName(p.code, s?.year_level ?? 1, taken);
        drawPreview();
    }

    function drawSubjects() {
        const rows = st.subjects.filter((s) => s.is_active !== false).sort((a, b) => String(a.code).localeCompare(String(b.code)));
        $('subject').innerHTML = rows.map((s) => {
            const off = isOffSem(s, st.term);
            const where = s.year_level == null ? 'Elective' : `Year ${s.year_level} · ${TERM_NAME[s.term] ?? 'Term ' + s.term}`;
            return `<option value="${s.id}">${esc(s.code)} — ${esc(s.title)} (${where}${off ? ', off-sem' : ''})</option>`;
        }).join('') || '<option value="">No subjects in this curriculum</option>';
        drawMeetings(); suggestSection();
    }

    async function loadOfferings() {
        const ids = st.subjects.map((s) => s.id);
        if (!ids.length || st.year == null) { st.offerings = []; return; }
        const { data, error } = await supabase.from('subject_offering')
            .select('id, subject_id, section, edp_code, schedule_days, start_time, end_time, room, instructor, meeting_type')
            .eq('academic_year', st.year).eq('term', st.term).in('subject_id', ids);
        st.offerings = error ? [] : (data ?? []);
    }

    function drawList() {
        const byId = new Map(st.subjects.map((s) => [s.id, s]));
        const rows = st.offerings.filter((o) => isOffSem(byId.get(o.subject_id), st.term));
        $('termnote').textContent = st.year != null ? `· ${TERM_NAME[st.term] ?? 'Term ' + st.term}, AY ${st.year}–${st.year + 1}` : '';
        if (!rows.length) { $('list').innerHTML = '<div class="os-empty">No off-semester sections yet this term. Add one above and students who need that subject will see it.</div>'; return; }
        const sections = [...new Set(rows.map((o) => o.section))].sort();
        $('list').innerHTML = sections.map((sec) => {
            const mine = rows.filter((o) => o.section === sec).sort((a, b) => String(byId.get(a.subject_id)?.code).localeCompare(String(byId.get(b.subject_id)?.code)) || String(a.meeting_type).localeCompare(String(b.meeting_type)));
            const subjects = [...new Set(mine.map((o) => byId.get(o.subject_id)?.code))];
            return `<div class="os-sec">
                <div class="os-sec-head"><strong>${esc(sec)}</strong><span class="os-hint">${subjects.length} subject${subjects.length === 1 ? '' : 's'}</span>
                    <button type="button" class="btn-small btn-danger" data-remove="${esc(sec)}">Remove section</button></div>
                <table><thead><tr><th>Subject</th><th>Type</th><th>EDP</th><th>When</th><th>Room</th><th>Instructor</th></tr></thead><tbody>
                ${mine.map((o) => `<tr><td>${esc(byId.get(o.subject_id)?.code)}</td><td>${esc(o.meeting_type)}</td><td>${esc(o.edp_code)}</td><td>${esc(o.schedule_days)} ${hhmm(o.start_time)}–${hhmm(o.end_time)}</td><td>${esc(o.room)}</td><td>${esc(o.instructor ?? '')}</td></tr>`).join('')}
                </tbody></table></div>`;
        }).join('') + '<p class="os-hint">A section can be removed only until a student has chosen it.</p>';
    }

    async function loadVersion() {
        const { data } = await supabase.from('subject')
            .select('id, code, title, units, lab_units, year_level, term, is_active, is_elective')
            .eq('prospectus_id', st.versionId);
        st.subjects = data ?? [];
        await loadOfferings();
        drawSubjects(); drawList();
    }

    async function loadProgram() {
        const { data } = await supabase.from('prospectus').select('id, academic_year, is_active, retired_at')
            .eq('program_id', st.programId).is('retired_at', null).order('academic_year', { ascending: false });
        st.versions = data ?? [];
        const active = st.versions.find((v) => v.is_active) ?? st.versions[0];
        st.versionId = active?.id ?? null;
        $('version').innerHTML = st.versions.map((v) => `<option value="${v.id}">${v.academic_year}${v.is_active ? ' (active)' : ''}</option>`).join('') || '<option value="">No curriculum</option>';
        if (active) $('version').value = String(active.id);
        if (st.versionId) await loadVersion(); else { st.subjects = []; st.offerings = []; drawSubjects(); drawList(); }
    }

    // current term
    const cfg = await supabase.from('system_config').select('current_academic_year, current_term').eq('id', 1).maybeSingle();
    st.year = cfg.data?.current_academic_year ?? null; st.term = cfg.data?.current_term ?? null;

    $('program').innerHTML = programs.map((p) => `<option value="${p.id}">${esc(p.code)}</option>`).join('');
    if (programs.length === 1) $('program-wrap').hidden = true;

    $('program').addEventListener('change', async (e) => { st.programId = e.target.value; await loadProgram(); });
    $('version').addEventListener('change', async (e) => { st.versionId = e.target.value; await loadVersion(); });
    $('subject').addEventListener('change', () => { drawMeetings(); suggestSection(); say(''); });
    container.addEventListener('input', (e) => {
        if (e.target.closest('[data-os-row], [data-os="section"]')) { e.target.classList?.remove('is-bad'); drawPreview(); }
    });

    function markBad(problems, meetings) {
        container.querySelectorAll('.is-bad').forEach((el) => el.classList.remove('is-bad'));
        const bad = (row, f) => container.querySelector(`[data-os-row="${row}"] [data-f="${f}"]`)?.classList.add('is-bad');
        for (const m of meetings) {
            if (!daysValid(m.days)) bad(m.type, 'days');
            const a = toMinutes(m.start), b = toMinutes(m.end);
            if (a == null) bad(m.type, 'start');
            if (b == null || (a != null && a >= b)) bad(m.type, 'end');
            if (!m.room) bad(m.type, 'room');
            if (!/^\d{5}$/.test(m.edp_code)) bad(m.type, 'edp_code');
        }
        if (problems.some((t) => /section/i.test(t))) $('section').classList.add('is-bad');
    }

    $('add').addEventListener('click', async () => {
        const p = program(); const s = subject();
        if (!p || !s) return say('Choose a subject first.', 'error');
        // A laboratory card left completely empty means "no lab meeting": it is optional, so it is not sent.
        const meetings = readMeetings().filter((m) => m.type === 'LEC' || m.days || m.start || m.end || m.room || m.edp_code || m.instructor);
        const problems = validateDraft({ programCode: p.code, section: $('section').value, hasLab: Number(s.lab_units ?? 0) > 0, meetings });
        if (problems.length) { markBad(problems, meetings); return say(problems, 'error'); }
        markBad([], []);
        const btn = $('add'); btn.disabled = true;
        const { data, error } = await supabase.rpc('add_offsem_section', {
            p_program_id: p.id, p_subject_id: s.id, p_section: $('section').value.trim().toUpperCase(),
            p_meetings: meetings.map((m) => ({ type: m.type, days: m.days, start: m.start, end: m.end, room: m.room, instructor: m.instructor, edp_code: m.edp_code })),
        });
        btn.disabled = false;
        if (error) return say(describeError(error), 'error');
        say(`${data?.subject ?? s.code} is now offered in section ${data?.section ?? ''} this term. Students who need it will see it in Build your plan.`, 'success');
        await loadOfferings(); drawMeetings(); suggestSection(); drawList();
        if (typeof onChange === 'function') onChange(data);
    });

    $('list').addEventListener('click', async (e) => {
        const b = e.target.closest('[data-remove]'); if (!b) return;
        b.disabled = true;
        const { data, error } = await supabase.rpc('remove_offsem_section', { p_program_id: program().id, p_section: b.dataset.remove, p_subject_id: null });
        if (error) { b.disabled = false; return say(describeError(error), 'error'); }
        say(`Section ${data?.section ?? b.dataset.remove} was removed.`, 'success');
        await loadOfferings(); suggestSection(); drawList();
        if (typeof onChange === 'function') onChange(data);
    });

    await loadProgram();
    return { reload: loadProgram };
}

return { validateDraft, nextSectionName, isOffSem, describeError, daysValid, normalizeDays, toMinutes, mount };
}));
