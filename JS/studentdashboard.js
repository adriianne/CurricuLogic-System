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

const LOGIN_PAGE = 'loginpage.html';

/* Session state, populated at boot. */
let AUTH_UID        = null;   // auth.users.id  == university_student.user_id
let STUDENT_ROW_ID  = null;   // university_student.id — the FK target
let STUDENT  = null;
let RECORDS  = [];
let PREVIEW  = false;


/* ---------- preview mode (development only) ---------- */

const PREVIEW_HOSTS = ['localhost', '127.0.0.1', ''];

const PREVIEW_STATES = {
    ready: {
        first_name: 'Althea', last_name: 'Villanueva',
        student_id: '2024-01187', email: 'althea.villanueva@uc.edu.ph',
        year_level: 2, is_approved: true, record_verified: true,
    },
    unverified: {
        first_name: 'Althea', last_name: 'Villanueva',
        student_id: '2024-01187', email: 'althea.villanueva@uc.edu.ph',
        year_level: 2, is_approved: true, record_verified: false,
    },
    orphan: null,
};

const PREVIEW_EMAIL = 'althea.villanueva@uc.edu.ph';

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


/* ---------- view routing ---------- */

const VIEWS = {
    dashboard:  'Dashboard',
    prospectus: 'My prospectus',
    record:     'Academic record',
    requests:   'Advising requests',
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
}

function route() {
    showView(currentView());
}

window.addEventListener('hashchange', route);


/* ---------- mobile nav ---------- */

$('menu-toggle')?.addEventListener('click', () => shell.classList.toggle('nav-open'));
$('scrim')?.addEventListener('click', () => shell.classList.remove('nav-open'));

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') shell?.classList.remove('nav-open');
});


/* ---------- logout ---------- */

$('logout')?.addEventListener('click', async () => {
    if (supabase) await supabase.auth.signOut();
    sessionStorage.clear();
    window.location.href = LOGIN_PAGE;
});


/* ---------- helpers ---------- */

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

/* ---------- profile + dashboard render ---------- */

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

    setText('stat-eligible', '—', 'stat-value muted');
    setText('stat-locked',   '—', 'stat-value muted');

    const hint = $('stat-eligible-hint');
    if (hint) hint.textContent = 'Awaiting curriculum data';
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
                    Once your academic record is verified, this panel will list every
                    subject in your prospectus with its eligibility status and the
                    specific requirement behind anything you cannot take yet.
                </p>
            </div>`;
        return;
    }

    if (note) note.textContent = 'Awaiting curriculum data';
    body.innerHTML = `
        <div class="empty">
            <i class="fa-solid fa-diagram-project" aria-hidden="true"></i>
            <h3>Curriculum not yet available</h3>
            <p>
                Your record is verified, but the BSIT prospectus has not been
                encoded in the system yet. Subject eligibility will appear here
                once the curriculum is published.
            </p>
        </div>`;
}


/* ---------- academic record ---------- */

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
            <td class="num">${r.grade_points != null ? escapeHtml(Number(r.grade_points).toFixed(2)) : escapeHtml(r.grade || '—')}</td>
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
                        <th class="num">Grade</th>
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


/* ---------- prospectus ---------- */

let prospectusLoaded = false;

async function loadProspectus() {
    if (prospectusLoaded) return;

    const body = $('prospectus-body');
    const note = $('prospectus-note');
    if (!body) return;

    prospectusLoaded = true;

    if (!supabase || PREVIEW) return renderProspectusEmpty();

    const { data, error } = await supabase
        .from('subject')
        .select('code, title, units, year_level, term, is_elective')
        .order('year_level', { ascending: true })
        .order('term', { ascending: true });

    // An empty subject table is a legitimate state until the prospectus is
    // published, not an error worth surfacing to the student.
    if (error) {
        console.warn('prospectus load failed:', error.message);
        return renderProspectusEmpty();
    }

    if (!data || data.length === 0) return renderProspectusEmpty();

    if (note) note.textContent = `${data.length} subjects`;

    const byYear = new Map();
    for (const s of data) {
        const key = `${s.year_level}-${s.term}`;
        if (!byYear.has(key)) byYear.set(key, []);
        byYear.get(key).push(s);
    }

    const passed = new Set(RECORDS.filter(r => r.status === 'PASSED').map(r => r.subject_code));

    body.innerHTML = [...byYear.entries()].map(([key, subjects]) => {
        const [year, term] = key.split('-');
        const rows = subjects.map(s => `
            <tr>
                <td class="mono">${escapeHtml(s.code)}</td>
                <td>
                    ${escapeHtml(s.title)}
                    ${s.is_elective ? '<span class="pill info">Elective</span>' : ''}
                </td>
                <td class="num">${escapeHtml(s.units)}</td>
                <td>${passed.has(s.code)
                    ? '<span class="pill ok">Passed</span>'
                    : '<span class="pill waiting">Not taken</span>'}</td>
            </tr>`).join('');

        return `
            <h3 class="group-head">${ordinal(Number(year))} · ${termLabel(Number(term))}</h3>
            <div class="table-wrap">
                <table class="data-table">
                    <thead>
                        <tr><th>Code</th><th>Descriptive title</th><th class="num">Units</th><th>Status</th></tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>`;
    }).join('');
}

function renderProspectusEmpty() {
    const body = $('prospectus-body');
    if (!body) return;
    body.innerHTML = `
        <div class="empty">
            <i class="fa-solid fa-diagram-project" aria-hidden="true"></i>
            <h3>Curriculum not yet published</h3>
            <p>
                The BSIT prospectus has not been encoded in the system yet. Once it
                is, every subject will appear here grouped by year and term, with
                your status against each one.
            </p>
        </div>`;
}


/* ---------- boot ---------- */

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
        setText('greeting', 'Cannot reach the service');
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
        .select('id, first_name, last_name, student_id, email, year_level, is_approved, record_verified')
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

    // Load the record at boot regardless of the active view — the dashboard
    // stat tiles are derived from it.
    await loadRecords();

    route();
})();

})();   