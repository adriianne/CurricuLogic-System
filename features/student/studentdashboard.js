// studentdashboard.js
// Session guard, hash-routed views, read-only academic record.
//
// Eligibility stays empty until the prospectus is encoded. The academic
// record is read-only: grades arrive through the validated GradeFile
// upload performed by Department Staff, not student self-report.
// See db/013_enforce_erd_record_flow.sql.
//
// Requires config.js to be loaded first.

(function () {
'use strict';

const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.CURRICULOGIC ?? {};

const supabase = (window.supabase && SUPABASE_URL && SUPABASE_ANON_KEY)
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

const $ = (id) => document.getElementById(id);

const LOGIN_PAGE = '../auth/html/loginpage.html';

/* Session state, populated at boot. */
let AUTH_UID        = null;   // auth.users.id  == university_student.user_id
let STUDENT_ROW_ID  = null;   // university_student.id — the FK target
let STUDENT  = null;
let RECORDS  = [];
let PREVIEW  = false;

/* Knowledge base and the engine's verdict, loaded once per session. */
let KB     = null;
let RESULT = null;

/* Set students curriculum to default prospectus if not set */
let ACTIVE_PROSPECTUS_ID = null;

/* The term the recommendation is for. Hardcoded until a system_config
   table or a term selector exists — the topbar shows the same value, and
   the two must not drift. */
const CURRENT_TERM = 1;
const CURRENT_YEAR = 2026;
const MAX_UNITS    = 24;


/* preview mode (development only) */

const PREVIEW_HOSTS = ['localhost', '127.0.0.1', ''];

const PREVIEW_STATES = {
    ready: {
        first_name: 'Althea', last_name: 'Villanueva',
        student_id: '2401187', email: 'althea1@gmail.com',
        year_level: 2, is_approved: true, record_verified: true,
    },
    unverified: {
        first_name: 'Althea', last_name: 'Villanueva',
        student_id: '2401187', email: 'althea1@gmail.com',
        year_level: 2, is_approved: true, record_verified: false,
    },
    orphan: null,
};

const PREVIEW_EMAIL = 'althea1@gmail.com';

const PREVIEW_RECORDS = [
    { id: 'p1', subject: { code: 'IT 111', title: 'Introduction to Computing', units: 3 }, subject_code: 'IT 111', subject_title: 'Introduction to Computing', units: 3, grade: '1.75', grade_points: 1.75, status: 'PASSED', taken_term: 1, taken_year: 2024 },
    { id: 'p2', subject_code: 'IT 112', subject_title: 'Computer Programming 1',    units: 3, grade: '2.25', grade_points: 2.25, status: 'PASSED', taken_term: 1, taken_year: 2024 },
    { id: 'p3', subject: { code: 'MATH 101', title: 'Mathematics in the Modern World', units: 3 }, subject_code: 'MATH 101', subject_title: 'Mathematics in the Modern World', units: 3, grade: '2.00', grade_points: 2.00, status: 'PASSED', taken_term: 1, taken_year: 2024 },
    { id: 'p4', subject_code: 'IT 121', subject_title: 'Computer Programming 2',    units: 3, grade: '3.25', grade_points: 3.25, status: 'FAILED', taken_term: 2, taken_year: 2024 },
    { id: 'p5', subject_code: 'IT 122', subject_title: 'Data Structures',           units: 3, grade: null, grade_points: null, status: 'ENROLLED', taken_term: 1, taken_year: 2026 },
];

function previewStudent() {
    if (!PREVIEW_HOSTS.includes(window.location.hostname)) return undefined;
    const params = new URLSearchParams(window.location.search);
    if (!params.has('preview')) return undefined;
    const key = params.get('preview');
    return key in PREVIEW_STATES ? PREVIEW_STATES[key] : PREVIEW_STATES.ready;
}


/* view routing */

const VIEWS = {
    dashboard:  'Dashboard',
    prospectus: 'My prospectus',
    record:     'Academic record',
    requests:   'Advising requests',
    'ask-ai':   'Ask AI',
    profile:    'Profile',
};

const shell = $('shell');

function currentView() {
    const hash = window.location.hash.replace('#', '');
    return hash in VIEWS ? hash : 'dashboard';
}

function showView(name) {
    Object.keys(VIEWS).forEach((key) => {
        const section = $(`view-${key}`);
        if (section) section.hidden = key !== name;
    });

    document.querySelectorAll('.side-nav a').forEach((link) => {
        link.classList.toggle('active', link.dataset.view === name);
    });

    const title = $('topbar-title');
    if (title) title.textContent = VIEWS[name];

    // Close the mobile drawer on navigation, or the new view is hidden
    // behind it on small screens.
    shell?.classList.remove('nav-open');

    // Views that fetch on first visit rather than at boot.
    if (name === 'prospectus') loadProspectus();
    if (name === 'record')     loadRecords();
    if (name === 'ask-ai')     initChatIfNeeded();
    if (name === 'requests')   loadRequestPicker();
}

function route() {
    showView(currentView());
}

window.addEventListener('hashchange', route);


/* mobile nav */

$('menu-toggle')?.addEventListener('click', () => shell.classList.toggle('nav-open'));
$('scrim')?.addEventListener('click', () => shell.classList.remove('nav-open'));

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') shell?.classList.remove('nav-open');
});


/* logout */

$('logout')?.addEventListener('click', async () => {
    if (supabase) await supabase.auth.signOut();
    sessionStorage.clear();
    window.location.href = LOGIN_PAGE;
});


/* helpers */

function initials(first, last, fallback) {
    const a = (first || '').trim()[0] || '';
    const b = (last || '').trim()[0] || '';
    return (a + b).toUpperCase() || (fallback || '?')[0].toUpperCase();
}

function setText(id, value, className) {
    const el = $(id);
    if (!el) return;
    el.textContent = value;
    if (className) el.className = className;
}

function ordinal(n) {
    const map = { 1: '1st Year', 2: '2nd Year', 3: '3rd Year', 4: '4th Year', 5: '5th Year' };
    return map[n] || null;
}

function termLabel(t) {
    return { 1: '1st Sem', 2: '2nd Sem', 3: 'Summer' }[t] || '—';
}

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

/* Message box helper, same shape as the one on the staff dashboards.
   An empty text means "clear the message" — do not apply a status
   class, or the box renders as a colored bar with no content. */
function showMsg(id, text, type = 'error') {
    const box = $(id);
    if (!box) return;
    box.textContent = text;
    box.className = text ? 'msg ' + type : 'msg';
}

/* profile + dashboard render */

function renderProfile(student, authEmail) {
    const first = student?.first_name || '';
    const last  = student?.last_name  || '';
    const full  = [first, last].filter(Boolean).join(' ');
    const email = student?.email || authEmail || '—';

    $('avatar').textContent    = initials(first, last, email);
    $('user-name').textContent = full || email;
    $('user-sub').textContent  = student?.student_id || '';

    $('greeting').textContent = first ? `Welcome back, ${first}` : 'Welcome back';

    setText('d-name',  full || '—');
    setText('d-sid',   student?.student_id || 'Not yet assigned', 'mono');
    setText('d-email', email, 'mono');
    setText('d-year',  ordinal(student?.year_level) || 'Pending verification');
    setText('d-program', 'BS Information Technology');

    $('d-status').innerHTML = student?.is_approved
        ? '<span class="pill ok"><i class="fa-solid fa-check"></i> Approved</span>'
        : '<span class="pill waiting"><i class="fa-solid fa-clock"></i> Awaiting approval</span>';

    $('d-verified').innerHTML = student?.record_verified
        ? '<span class="pill ok"><i class="fa-solid fa-check"></i> Verified</span>'
        : '<span class="pill waiting"><i class="fa-solid fa-clock"></i> Pending with Registrar</span>';
}

/* The prospectus to assess this student against. Their own if it was
   set at registration (a returnee stays on their original curriculum),
   otherwise whatever is currently active. Returns null only when
   neither exists — a fresh system with no versions at all. */
function effectiveProspectusId(student) {
    return student?.prospectus_id ?? ACTIVE_PROSPECTUS_ID;
}

function renderNotice(student) {
    const box = $('status-notice');
    if (!box) return;

    if (!student) {
        box.innerHTML = `
            <div class="notice pending">
                <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
                <div>
                    <strong>No student record found</strong>
                    Your sign-in worked, but no student record is linked to this account.
                    Please contact the Office of the Registrar.
                </div>
            </div>`;
        return;
    }

    if (!student.record_verified) {
        box.innerHTML = `
            <div class="notice pending">
                <i class="fa-solid fa-clock" aria-hidden="true"></i>
                <div>
                    <strong>Your academic record is being verified</strong>
                    Subject eligibility cannot be computed until the Office of the
                    Registrar confirms your record and uploads your subject history.
                </div>
            </div>`;
        return;
    }

    box.innerHTML = '';
}

/* Counts derived from the academic record. These are real numbers even
   with no curriculum encoded — completed subjects and units earned do not
   depend on the knowledge base. Eligible and locked do, and stay dashed. */
function renderStats() {
    const passed = RECORDS.filter(r => r.status === 'PASSED');
    const units  = passed.reduce((sum, r) => sum + Number(r.units || 0), 0);

    setText('stat-done',  String(passed.length), 'stat-value');
    setText('stat-units', String(units),         'stat-value');

    const hint = $('stat-eligible-hint');

    if (!RESULT) {
        setText('stat-eligible', '—', 'stat-value muted');
        setText('stat-locked',   '—', 'stat-value muted');
        if (hint) hint.textContent = 'Awaiting curriculum data';
        return;
    }

    setText('stat-eligible', String(RESULT.eligible.length), 'stat-value');
    setText('stat-locked',   String(RESULT.locked.length),   'stat-value');
    if (hint) hint.textContent = `${RESULT.recommended.length} suggested this term`;
}

/* assess() output -> the grid's status map.
   A failed subject that is eligible again is a retake, not merely
   available — the distinction is what a student most needs to see. */
function statusMap(result, records) {
    const map = new Map();
    if (!result) return map;

    const graded = new Map();
    for (const r of records) {
        if (r.status === 'PASSED' && r.subject_id) graded.set(r.subject_id, r.grade);
    }

    for (const s of result.completed)  map.set(s.id, { state: 'passed', detail: graded.get(s.id) ? `Grade ${graded.get(s.id)}` : 'Passed' });
    for (const s of result.inProgress) map.set(s.id, { state: 'enrolled', detail: 'Currently enrolled' });

    for (const e of result.eligible) {
        map.set(e.subject.id, {
            state: e.retake ? 'retake' : 'eligible',
            detail: e.retake ? 'Previously failed. Retake available.' : 'All requirements met.',
        });
    }

    for (const l of result.locked) {
        map.set(l.subject.id, {
            state: 'blocked',
            detail: l.unmet.map(u => u.detail).join(' '),
        });
    }

    return map;
}

/* eligibility */

async function loadKnowledgeBase(student) { 
    if (KB) return KB;

    if (PREVIEW) {
        KB = { subjects: [], rules: [], offerings: [] };
        return KB;
    }

    const [subs, rules, offerings] = await Promise.all([
        supabase.from('subject')
            .select('id, code, title, units, year_level, term, is_elective')
            .eq('prospectus_id', effectiveProspectusId(student)),
        supabase.from('prerequisite')
            .select('subject_id, prerequisite_subject_id, requirement_type, rule_type, rule_group, threshold_value'),
        supabase.from('subject_offering')
            .select('subject_id, section, schedule_days, start_time, end_time, room')
            .eq('academic_year', CURRENT_YEAR)
            .eq('term', CURRENT_TERM),
    ]);

    console.log('[kb] prospectus', student.prospectus_id,
                'subjects', subs.data?.length, subs.error?.message,
                'rules', rules.data?.length, rules.error?.message,
                'offerings', offerings.data?.length, offerings.error?.message);

    if (subs.error)  console.warn('subject load failed:', subs.error.message);
    if (rules.error) console.warn('rule load failed:', rules.error.message);

    KB = {
        subjects:  subs.data  ?? [],
        rules:     rules.data ?? [],
        /* An empty offering table means nothing has been scheduled yet.
           Treating that as "nothing is available" would show a student an
           empty recommendation for a reason they cannot see, so the engine
           is told to ignore availability until a schedule exists. */
        offerings: offerings.data ?? [],
    };

    return KB;
}

async function runAssessment(student) {
    if (!student || !student.record_verified) return null;

    const pid = effectiveProspectusId(student);
    if (!pid) {
        console.warn('no prospectus available — cannot assess');
        return null;
    }

    const kb = await loadKnowledgeBase(student);

    return CurricuLogicEngine.assess(
        { id: STUDENT_ROW_ID, year_level: student.year_level },
        RECORDS,
        kb,
        { maxUnits: MAX_UNITS, respectOfferings: kb.offerings.length > 0 },
    );
}

function renderEligibility(student) {
    const body = $('elig-body');
    const note = $('elig-note');
    if (!body) return;

    if (!student || !student.record_verified) {
        if (note) note.textContent = '';
        body.innerHTML = `
            <div class="empty">
                <i class="fa-solid fa-hourglass-half" aria-hidden="true"></i>
                <h3>Nothing to show yet</h3>
                <p>
                    Once the Office of the Registrar verifies your record, this
                    panel will list what you can take and the specific requirement
                    behind anything you cannot.
                </p>
            </div>`;
        return;
    }

    if (!RESULT) {
        if (note) note.textContent = 'Awaiting curriculum data';
        body.innerHTML = `
            <div class="empty">
                <i class="fa-solid fa-diagram-project" aria-hidden="true"></i>
                <h3>Curriculum not yet available</h3>
                <p>
                    The prospectus has not been published yet. Subject eligibility
                    will appear here once it is.
                </p>
            </div>`;
        return;
    }

    const { recommended, eligible, locked, recommendedUnits, maxUnits } = RESULT;
    const alsoEligible = eligible.filter(e => !recommended.some(r => r.subject.id === e.subject.id));

    if (note) note.textContent = `${recommendedUnits} of ${maxUnits} units`;

    body.innerHTML = `
        ${renderRecommended(recommended, recommendedUnits, maxUnits)}
        ${renderAlsoEligible(alsoEligible)}
        ${renderLocked(locked)}`;

    bindWhyToggles(body);
}

function renderRecommended(list, units, maxUnits) {
    if (list.length === 0) {
        return `
            <div class="empty">
                <i class="fa-solid fa-circle-check" aria-hidden="true"></i>
                <h3>Nothing to recommend</h3>
                <p>
                    There is no subject you can take right now. Anything still
                    outstanding is listed below with the requirement behind it.
                </p>
            </div>`;
    }

    return `
        <h3 class="group-head">Suggested load — ${units} of ${maxUnits} units</h3>
        <div class="subject-list">
            ${list.map(e => `
                <article class="subject-card is-recommended">
                    <div class="subject-head">
                        <span class="subject-code mono">${escapeHtml(e.subject.code)}</span>
                        <span class="subject-units">${escapeHtml(e.subject.units)} units</span>
                    </div>
                    <h4 class="subject-title">${escapeHtml(e.subject.title)}</h4>
                    <p class="subject-reason">
                        <i class="fa-solid fa-lightbulb" aria-hidden="true"></i>
                        ${escapeHtml(e.reason)}
                    </p>
                    ${renderSections(e.sections)}
                </article>`).join('')}
        </div>`;
}

function renderAlsoEligible(list) {
    if (list.length === 0) return '';

    return `
        <h3 class="group-head">Also open to you</h3>
        <p class="prose">
            You meet the requirements for these, but they did not fit within the
            unit limit or are not scheduled this term.
        </p>
        <div class="table-wrap">
            <table class="data-table">
                <thead><tr><th>Code</th><th>Descriptive title</th>
                           <th class="num">Units</th><th>Scheduled</th></tr></thead>
                <tbody>${list.map(e => `
                    <tr>
                        <td class="mono">${escapeHtml(e.subject.code)}</td>
                        <td>${escapeHtml(e.subject.title)}</td>
                        <td class="num">${escapeHtml(e.subject.units)}</td>
                        <td>${e.offered
                            ? '<span class="pill ok">Offered</span>'
                            : '<span class="pill waiting">Not this term</span>'}</td>
                    </tr>`).join('')}
                </tbody>
            </table>
        </div>`;
}

/* Every locked subject carries its reasoning. A refusal without a reason
   is the situation this system replaces — a student turned away at the
   counter with no idea what to do about it. */
function renderLocked(list) {
    if (list.length === 0) return '';

    const sorted = [...list].sort((a, b) =>
        (a.termsAway ?? 99) - (b.termsAway ?? 99) ||
        a.subject.year_level - b.subject.year_level);

    return `
        <h3 class="group-head">Not yet available — ${sorted.length}</h3>
        <div class="subject-list">
            ${sorted.map((e, i) => `
                <article class="subject-card is-locked">
                    <div class="subject-head">
                        <span class="subject-code mono">${escapeHtml(e.subject.code)}</span>
                        <span class="subject-units">${escapeHtml(e.subject.units)} units</span>
                        ${e.termsAway
                            ? `<span class="pill info">${e.termsAway} term${e.termsAway === 1 ? '' : 's'} away</span>`
                            : ''}
                    </div>
                    <h4 class="subject-title">${escapeHtml(e.subject.title)}</h4>
                    <button class="why-toggle" data-why="${i}" aria-expanded="false">
                        <i class="fa-solid fa-chevron-right" aria-hidden="true"></i>
                        Why is this locked?
                    </button>
                    <div class="why-body" id="why-${i}" hidden>
                        <ul class="why-list">
                            ${CurricuLogicEngine.explain(e).map(line => {
                                const met = line.startsWith('\u2713');
                                return `<li class="why-line ${met ? 'is-met' : 'is-unmet'}">
                                    ${escapeHtml(line.slice(2))}
                                </li>`;
                            }).join('')}
                        </ul>
                    </div>
                </article>`).join('')}
        </div>`;
}

function renderSections(sections) {
    if (!sections || sections.length === 0) return '';

    return `
        <div class="subject-sections">
            ${sections.map(o => `
                <span class="section-chip">
                    <strong>${escapeHtml(o.section)}</strong>
                    ${escapeHtml(o.schedule_days || '')}
                    ${o.start_time ? escapeHtml(o.start_time.slice(0, 5)) : ''}
                    ${o.room ? '· ' + escapeHtml(o.room) : ''}
                </span>`).join('')}
        </div>`;
}

function bindWhyToggles(scope) {
    scope.querySelectorAll('[data-why]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const panel = $(`why-${btn.dataset.why}`);
            const open = btn.getAttribute('aria-expanded') === 'true';
            btn.setAttribute('aria-expanded', String(!open));
            btn.classList.toggle('is-open', !open);
            panel.hidden = open;
        });
    });
}


/* academic record */

let recordsLoaded = false;

async function loadRecords(force = false) {
    if (recordsLoaded && !force) return;

    const body = $('record-body');
    if (!body) return;

    if (PREVIEW) {
        RECORDS = [...PREVIEW_RECORDS];
        recordsLoaded = true;
        renderRecords();
        renderStats();
        return;
    }

    if (!supabase || !STUDENT_ROW_ID) return;

    const { data, error } = await supabase
        .from('academic_record')
        .select('id, subject_id, grade, grade_points, status, taken_term, taken_year, subject:subject_id (code, title, units)')
        .eq('student_id', STUDENT_ROW_ID)
        .order('taken_year', { ascending: true })
        .order('taken_term', { ascending: true });

    if (error) {
        console.warn('record load failed:', error.message);
        body.innerHTML = `
            <div class="empty">
                <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
                <h3>Could not load your record</h3>
                <p>${escapeHtml(error.message)}</p>
            </div>`;
        return;
    }

    // academic_record identifies the subject by FK, not by text code. The
    // subject_code / subject_title / units columns added during the
    // self-report experiment are null on seeded and uploaded rows, so read
    // through the join and fall back to the text columns only if the FK is
    // unresolved.
    RECORDS = (data ?? []).map((r) => ({
        ...r,
        subject_code:  r.subject?.code  ?? r.subject_code  ?? '—',
        subject_title: r.subject?.title ?? r.subject_title ?? '—',
        units:         r.subject?.units ?? r.units         ?? 0,
    }));

    recordsLoaded = true;
    renderRecords();
    renderStats();
}

/* Grades are deliberately not shown to the student. CurricuLogic is an
   advising tool, not a records portal — the engine needs the grade to
   decide passed or failed, but a student reading this page needs the
   outcome, not the number. Showing marks would duplicate the university's
   own system and invite the question of which one is authoritative.
   Faculty and Registrar views keep grades: advising and verification are
   the cases where the actual mark matters. */
function renderRecords() {
    const body  = $('record-body');
    const count = $('record-count');
    if (!body) return;

    if (count) {
        const units = RECORDS
            .filter(r => r.status === 'PASSED')
            .reduce((s, r) => s + Number(r.units || 0), 0);
        count.textContent = RECORDS.length
            ? `${RECORDS.length} subject${RECORDS.length === 1 ? '' : 's'} · ${units} units earned`
            : '';
    }

    if (RECORDS.length === 0) {
        body.innerHTML = `
            <div class="empty">
                <i class="fa-solid fa-file-circle-plus" aria-hidden="true"></i>
                <h3>No subjects recorded yet</h3>
                <p>
                    Your academic record has not been uploaded yet. Once the
                    Registrar publishes it, every subject you have taken will
                    appear here and your eligibility can be computed.
                </p>
            </div>`;
        return;
    }

    const rows = RECORDS.map((r) => `
        <tr>
            <td class="mono">${escapeHtml(r.subject_code)}</td>
            <td>${escapeHtml(r.subject_title || '—')}</td>
            <td class="num">${escapeHtml(r.units)}</td>
            <td><span class="pill ${statusClass(r.status)}">${statusLabel(r.status)}</span></td>
            <td class="dim">${termLabel(r.taken_term)} · ${escapeHtml(r.taken_year || '—')}</td>
        </tr>`).join('');

    body.innerHTML = `
        <div class="table-wrap">
            <table class="data-table">
                <thead>
                    <tr>
                        <th>Code</th>
                        <th>Descriptive title</th>
                        <th class="num">Units</th>
                        <th>Status</th>
                        <th>Term</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;
}

function statusClass(s) {
    return { PASSED: 'ok', FAILED: 'bad', ENROLLED: 'info', DROPPED: 'waiting' }[s] || 'waiting';
}

function statusLabel(s) {
    return { PASSED: 'Passed', FAILED: 'Failed', ENROLLED: 'Enrolled', DROPPED: 'Dropped' }[s] || s;
}

/* Record entry was removed on 21 Aug to match the ERD: grades reach
   academic_record through the validated GradeFile upload performed by
   Department Staff, not through student self-report. The student view is
   read-only. See db/013_enforce_erd_record_flow.sql. */


/* prospectus */

let prospectusLoaded = false;

async function loadProspectus() {
    if (prospectusLoaded) return;

    const body = $('prospectus-body');
    const note = $('prospectus-note');
    if (!body) return;

    prospectusLoaded = true;

    const pid = effectiveProspectusId(STUDENT);
    if (!supabase || PREVIEW || !pid) {
        return renderProspectusEmpty();
    }

    if (typeof window.ProspectusGrid === 'undefined') {
        console.error('prospectusgrid.js not loaded — check the script tag');
        return renderProspectusEmpty();
    }

    const result = await runAssessment(STUDENT);
    const sm = statusMap(result, RECORDS);

    console.log('[prospectus] result?', !!result, 'statuses:', sm.size);

    if (note && result) {
        note.textContent =
            `${result.completed.length} passed · ${result.eligible.length} available`;
    }

        await window.ProspectusGrid.render(supabase, pid, body, sm);
}


/* Ask AI chat */

let chatInitialized = false;

function initChatIfNeeded() {
    if (chatInitialized) return;
    if (!RESULT || typeof window.EligibilityChat === 'undefined') return;

    // Uses the exact same RESULT the rest of the dashboard already
    // computed -- never a second, separate call to the engine. The
    // chat can only ever discuss what the real assessment already
    // decided.
    const summary = summarizeForExplanation(RESULT, STUDENT?.first_name);
    window.EligibilityChat.initEligibilityChat(summary);
    chatInitialized = true;
}

function appendChatMessage(role, text, table) {
    const log = $('chat-log');
    if (!log) return null;

    const bubble = document.createElement('div');
    bubble.className = 'chat-msg chat-msg-' + role;
    bubble.innerHTML = `<p>${escapeHtml(text)}</p>` + renderChatTable(table);
    log.appendChild(bubble);
    log.scrollTop = log.scrollHeight;
    return bubble;
}

function renderChatTable(entries) {
    if (!entries || !entries.length) return '';

    const totalUnits = entries.reduce((sum, e) => sum + (Number(e.units) || 0), 0);

    const rows = entries.map(e => `
        <tr>
            <td class="mono">${escapeHtml(e.code)}</td>
            <td>${escapeHtml(e.title)}</td>
            <td class="n">${e.units ?? ''}</td>
            <td>${e.retake ? 'Retake' : ''}</td>
        </tr>`).join('');

    return `
        <table class="chat-table">
            <thead>
                <tr><th>Code</th><th>Title</th><th class="n">Units</th><th></th></tr>
            </thead>
            <tbody>${rows}</tbody>
            <tfoot>
                <tr><td colspan="2">Total</td><td class="n">${totalUnits}</td><td></td></tr>
            </tfoot>
        </table>`;
}

$('chat-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const input = $('chat-input');
    const text = input?.value.trim();
    if (!text || !supabase) return;

    appendChatMessage('user', text);
    input.value = '';

    const sendBtn = $('chat-send');
    if (sendBtn) sendBtn.disabled = true;

    const pending = appendChatMessage('pending', 'Thinking\u2026');

    try {
        const result = await window.EligibilityChat.sendChatMessage(supabase, text);
        pending?.remove();
        appendChatMessage('model', result.text, result.table);
    } catch (err) {
        console.warn('chat send failed:', err);
        pending?.remove();
        appendChatMessage('model', 'Sorry, I could not reach the assistant just now. Please try again.');
    } finally {
        if (sendBtn) sendBtn.disabled = false;
    }
});

/* Advising requests */

let SELECTED_SUBJECT_IDS = new Set();
let requestsInitialized = false;

/* Built from the same RESULT the rest of the dashboard already
   computed -- students choose from their real eligible/recommended
   list, never a separate, hand-typed set. The actual valid/flagged
   verdict on submission still comes from the server-side engine run
   in submit-advising-request -- this picker only decides what gets
   sent, not whether it will be accepted. */
function loadRequestPicker() {
    const picker = $('req-picker');
    if (!picker) return;

    if (!RESULT) {
        picker.innerHTML = '<p class="dim">Your eligibility has not loaded yet.</p>';
        return;
    }

    // recommended and eligible overlap in the engine's real output --
    // concatenating them raw duplicated any subject present in both.
    // Filtering eligible down to what recommended does not already
    // cover matches the exact de-duplication renderEligibility() already
    // does for the dashboard's own panel.
    const recommended = RESULT.recommended ?? [];
    const alsoEligible = (RESULT.eligible ?? [])
        .filter(e => !recommended.some(r => r.subject.id === e.subject.id));
    const candidates = [...recommended, ...alsoEligible];

    if (!candidates.length) {
        picker.innerHTML = '<p class="dim">Nothing is currently eligible to request.</p>';
        return;
    }

    picker.innerHTML = candidates.map(entry => {
        const s = entry.subject;
        return `
            <label class="req-row">
                <input type="checkbox" data-subject-id="${s.id}">
                <span class="req-code">${escapeHtml(s.code)}</span>
                <span class="req-title">${escapeHtml(s.title)}</span>
                <span class="req-units">${s.units ?? ''} units</span>
                ${entry.retake ? '<span class="pg-chip danger">Retake</span>' : ''}
            </label>`;
    }).join('');

    if (!requestsInitialized) {
        picker.addEventListener('change', (e) => {
            const box = e.target.closest('input[type="checkbox"]');
            if (!box) return;

            const id = Number(box.dataset.subjectId);
            if (box.checked) SELECTED_SUBJECT_IDS.add(id);
            else SELECTED_SUBJECT_IDS.delete(id);

            updateRequestCount();
        });

        $('req-submit')?.addEventListener('click', submitAdvisingRequest);
        requestsInitialized = true;
    }

    loadRequestHistory();
}

function updateRequestCount() {
    const count = SELECTED_SUBJECT_IDS.size;
    const label = $('req-count');
    const btn = $('req-submit');

    // Units summed from the same RESULT candidates the picker was
    // built from -- never a separate lookup, so this can never disagree
    // with what the checkboxes are actually pointing at.
    const recommended2 = RESULT?.recommended ?? [];
    const alsoEligible2 = (RESULT?.eligible ?? [])
        .filter(e => !recommended2.some(r => r.subject.id === e.subject.id));
    const candidates = [...recommended2, ...alsoEligible2];
    const units = candidates
        .filter(entry => SELECTED_SUBJECT_IDS.has(entry.subject.id))
        .reduce((sum, entry) => sum + (Number(entry.subject.units) || 0), 0);

    if (label) {
        label.textContent = count
            ? `${count} subject${count === 1 ? '' : 's'} selected \u00b7 ${units} units`
            : '';
    }
    if (btn) btn.disabled = count === 0;
}

async function submitAdvisingRequest() {
    if (!SELECTED_SUBJECT_IDS.size || !supabase) return;

    const btn = $('req-submit');
    if (btn) { btn.disabled = true; btn.textContent = 'Submitting\u2026'; }

    try {
        const { data, error } = await supabase.functions.invoke('submit-advising-request', {
            body: { subjectIds: [...SELECTED_SUBJECT_IDS] },
        });

        if (error) {
            let serverMessage = null;
            try {
                const body = await error.context?.json?.();
                serverMessage = body?.error ?? null;
            } catch (_) {}
            showMsg('req-msg', serverMessage || 'Could not submit your request. Please try again.');
            return;
        }

        const flagged = data.flaggedCount ?? 0;
        const total = data.items?.length ?? 0;

        showMsg(
            'req-msg',
            flagged
                ? `Submitted. ${flagged} of ${total} subject${total === 1 ? '' : 's'} were flagged for your adviser to review.`
                : `Submitted. All ${total} subject${total === 1 ? '' : 's'} checked out cleanly.`,
            'success',
        );

        SELECTED_SUBJECT_IDS.clear();
        loadRequestPicker();

    } catch (err) {
        console.warn('submitAdvisingRequest threw:', err);
        showMsg('req-msg', 'Could not reach the server. Please try again.');
    } finally {
        if (btn) { btn.disabled = SELECTED_SUBJECT_IDS.size === 0; btn.textContent = 'Submit for review'; }
    }
}

async function loadRequestHistory() {
    const card = $('req-history-card');
    const body = $('req-history');
    if (!card || !body || !supabase || !STUDENT) return;

    const { data: requests, error } = await supabase
        .from('request')
        .select('id, status, requested_term, requested_year, created_at, request_item(id, status, remarks, subject:subject_id(code, title))')
        .eq('student_id', STUDENT_ROW_ID)
        .order('created_at', { ascending: false })
        .limit(5);

    if (error || !requests?.length) {
        card.hidden = true;
        return;
    }

    card.hidden = false;
    body.innerHTML = requests.map(r => `
        <div class="req-history-entry">
            <div class="req-history-head">
                <span>${new Date(r.created_at).toLocaleDateString()}</span>
                <span class="pg-chip ${r.status === 'submitted' ? 'info' : 'ok'}">${escapeHtml(r.status)}</span>
            </div>
            ${(r.request_item ?? []).map(item => `
                <div class="req-history-item">
                    <span class="req-code">${escapeHtml(item.subject?.code ?? '')}</span>
                    <span class="pg-chip ${item.status === 'valid' ? 'ok' : 'danger'}">${escapeHtml(item.status)}</span>
                    ${item.remarks ? `<span class="dim">${escapeHtml(item.remarks)}</span>` : ''}
                </div>`).join('')}
        </div>`).join('');
}

/* boot */

function render(student, email) {
    renderProfile(student, email);
    renderNotice(student);
    renderStats();
    renderEligibility(student);
}

(async function init() {

    const mock = previewStudent();
    if (mock !== undefined) {
        PREVIEW = true;
        STUDENT = mock;
        document.body.classList.add('is-preview');
        render(mock, PREVIEW_EMAIL);
        route();
        return;
    }

    if (!supabase) {
        setText('greeting', 'Cannot reach the service', 'is-error');
        console.error('studentdashboard.js: Supabase client not created. Is config.js loaded?');
        return;
    }

    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
        window.location.href = LOGIN_PAGE;
        return;
    }

    AUTH_UID = session.user.id;

    const { data: student, error } = await supabase
        .from('university_student')
        .select('id, user_id, student_id, first_name, last_name, email, year_level, is_approved, record_verified, prospectus_id')
        .eq('user_id', AUTH_UID)
        .maybeSingle();

    if (error) console.warn('student load failed:', error.message);

    if (student && student.is_approved === false) {
        await supabase.auth.signOut();
        window.location.href = LOGIN_PAGE;
        return;
    }

    STUDENT = student;
    STUDENT_ROW_ID = student?.id ?? null;
    render(student, session.user.email);

        // Resolve the active prospectus once. Used as a fallback for any
    // student whose own prospectus_id is null — which happens when
    // they were registered before the first curriculum was activated.
    if (!PREVIEW && supabase) {
        const { data: active } = await supabase
            .from('prospectus')
            .select('id')
            .eq('is_active', true)
            .maybeSingle();
        ACTIVE_PROSPECTUS_ID = active?.id ?? null;
    }

    // The record loads at boot regardless of the active view — the stat
    // tiles and the assessment both derive from it.
    await loadRecords();

    RESULT = await runAssessment(student);

    renderStats();
    renderEligibility(student);

    route();
})();

})();