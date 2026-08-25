// registrardashboard.js
// Registrar Staff: account approval and record verification.
//
// This module removes the manual bottleneck — until now, approving a
// student account required someone running SQL by hand.
//
// Requires config.js to be loaded first.

(function () {
'use strict';

const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.CURRICULOGIC ?? {};

const supabase = (window.supabase && SUPABASE_URL && SUPABASE_ANON_KEY)
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

const $ = (id) => document.getElementById(id);

const LOGIN_PAGE = 'staffloginpage.html';

let AUTH_UID      = null;
let REGISTRAR     = null;   // registrar_staff row
let REGISTRAR_ID  = null;   // registrar_staff.id — the FK target, not user_id
let STUDENTS      = [];
let PREVIEW       = false;


/* preview mode (development only) */

const PREVIEW_HOSTS = ['localhost', '127.0.0.1', ''];

const PREVIEW_REGISTRAR = {
    id: 'reg1', first_name: 'Registrar', last_name: 'Tester',
    employee_id: 'EMP-REG01', email: 'registrartest@gmail.com', is_approved: true,
};

const PREVIEW_STUDENTS = [
    { id: 's1', first_name: 'Althea', last_name: 'Villanueva', student_id: '2401187', email: 'althea1@gmail.com', year_level: 2, is_approved: true,  record_verified: true,  approval_status: 'approved', declared_path: 'existing', created_at: '2026-08-11T02:00:00Z' },
    { id: 's2', first_name: 'Marco',  last_name: 'Deveza',     student_id: '2401203', email: 'marco.deveza@uc.edu.ph',     year_level: 2, is_approved: false, record_verified: false, approval_status: 'pending',  declared_path: 'existing', created_at: '2026-08-20T09:15:00Z' },
    { id: 's3', first_name: 'Janine', last_name: 'Abella',     student_id: null,          email: 'janine.abella@uc.edu.ph',    year_level: null, is_approved: false, record_verified: false, approval_status: 'pending', declared_path: 'new',     created_at: '2026-08-22T14:40:00Z' },
    { id: 's4', first_name: 'Paulo',  last_name: 'Cabahug',    student_id: '9999999', email: 'paulo.cabahug@uc.edu.ph',    year_level: null, is_approved: false, record_verified: false, approval_status: 'declined', declared_path: 'existing', created_at: '2026-08-18T11:05:00Z', review_note: 'Student ID not found in the official list.' },
];

const PREVIEW_RECORDS = {
    s1: [
        { id: 'r1', grade: '1.75', grade_points: 1.75, status: 'PASSED',   taken_term: 1, taken_year: 2024, subject: { code: 'ENGL 100',     title: 'Communication Arts',      units: 3 } },
        { id: 'r2', grade: '2.00', grade_points: 2.00, status: 'PASSED',   taken_term: 1, taken_year: 2024, subject: { code: 'CC-INTCOM11',  title: 'Introduction to Computing', units: 3 } },
        { id: 'r3', grade: '5.00', grade_points: 5.00, status: 'FAILED',   taken_term: 2, taken_year: 2024, subject: { code: 'CC-COMPROG12', title: 'Computer Programming 2',  units: 3 } },
        { id: 'r4', grade: null,   grade_points: null, status: 'ENROLLED', taken_term: 1, taken_year: 2026, subject: { code: 'CC-COMPROG12', title: 'Computer Programming 2',  units: 3 } },
    ],
};

function previewRequested() {
    if (!PREVIEW_HOSTS.includes(window.location.hostname)) return false;
    return new URLSearchParams(window.location.search).has('preview');
}


/* view routing */

const VIEWS = {
    dashboard: 'Dashboard',
    requests:  'Account requests',
    students:  'Students',
    student:   'Student detail',
    profile:   'Profile',
};

const shell = $('shell');

/* Hash may carry a student id: #student/<uuid> */
function parseHash() {
    const [name, param] = window.location.hash.replace('#', '').split('/');
    return { name: name in VIEWS ? name : 'dashboard', param: param || null };
}

function showView(name, param) {
    Object.keys(VIEWS).forEach((key) => {
        const s = $(`view-${key}`);
        if (s) s.hidden = key !== name;
    });

    document.querySelectorAll('.side-nav a').forEach((link) => {
        // Student detail is reached from Students, so keep that item lit.
        const target = name === 'student' ? 'students' : name;
        link.classList.toggle('active', link.dataset.view === target);
    });

    const title = $('topbar-title');
    if (title) title.textContent = VIEWS[name];

    shell?.classList.remove('nav-open');

    if (name === 'requests') renderRequests();
    if (name === 'students') renderStudents();
    if (name === 'student' && param) openStudent(param);
}

function route() {
    const { name, param } = parseHash();
    showView(name, param);
}
window.addEventListener('hashchange', route);


/* mobile nav + logout */

$('menu-toggle')?.addEventListener('click', () => shell.classList.toggle('nav-open'));
$('scrim')?.addEventListener('click', () => shell.classList.remove('nav-open'));

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') shell?.classList.remove('nav-open');
});

$('logout')?.addEventListener('click', async () => {
    if (supabase) await supabase.auth.signOut();
    sessionStorage.clear();
    window.location.href = LOGIN_PAGE;
});


/* helpers */

const initials = (f, l, fb) =>
    (((f || '').trim()[0] || '') + ((l || '').trim()[0] || '')).toUpperCase()
    || (fb || '?')[0].toUpperCase();

function setText(id, value, className) {
    const el = $(id);
    if (!el) return;
    el.textContent = value;
    if (className) el.className = className;
}

const ordinal = (n) =>
    ({ 1: '1st Year', 2: '2nd Year', 3: '3rd Year', 4: '4th Year', 5: '5th Year' })[n] || null;

const fullName = (p) => [p?.first_name, p?.last_name].filter(Boolean).join(' ');

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function daysAgo(iso) {
    if (!iso) return '';
    const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
    if (d <= 0) return 'today';
    if (d === 1) return 'yesterday';
    return `${d} days ago`;
}

function showMsg(boxId, text, type = 'error') {
    const box = $(boxId);
    if (!box) return;
    box.textContent = text;
    box.className = 'msg ' + type;
}


/* profile */

function renderProfile(staff, authEmail) {
    const full  = fullName(staff);
    const email = staff?.email || authEmail || '—';

    $('avatar').textContent    = initials(staff?.first_name, staff?.last_name, email);
    $('user-name').textContent = full || email;
    $('user-sub').textContent  = staff?.employee_id || '';
    $('greeting').textContent  = staff?.first_name ? `Welcome back, ${staff.first_name}` : 'Welcome back';

    setText('d-name',  full || '—');
    setText('d-eid',   staff?.employee_id || '—', 'mono');
    setText('d-email', email, 'mono');

    $('d-status').innerHTML = staff?.is_approved
        ? '<span class="pill ok"><i class="fa-solid fa-check"></i> Approved</span>'
        : '<span class="pill waiting"><i class="fa-solid fa-clock"></i> Awaiting approval</span>';
}

function renderNotice(staff) {
    const box = $('status-notice');
    if (!box) return;
    box.innerHTML = staff ? '' : `
        <div class="notice pending">
            <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
            <div>
                <strong>No registrar record found</strong>
                Your sign-in worked, but no registrar record is linked to this
                account. Please contact the System Administrator.
            </div>
        </div>`;
}


/* data */

const SELECT_COLS =
    'id, first_name, last_name, student_id, email, year_level, is_approved, ' +
    'record_verified, approval_status, declared_path, review_note, created_at';

async function loadStudents() {
    if (PREVIEW) {
        STUDENTS = [...PREVIEW_STUDENTS];
        return afterLoad();
    }

    if (!supabase) return;

    const { data, error } = await supabase
        .from('university_student')
        .select(SELECT_COLS)
        .order('created_at', { ascending: true });

    if (error) {
        console.warn('student load failed:', error.message);
        const body = $('requests-body');
        if (body) body.innerHTML = `
            <div class="empty">
                <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
                <h3>Could not load students</h3>
                <p>${escapeHtml(error.message)}</p>
                <p class="dim">If this mentions approval_status, run db/022.</p>
            </div>`;
        return;
    }

    STUDENTS = data ?? [];
    afterLoad();
}

function afterLoad() {
    renderStats();
    renderRecent();
    renderRequests();
    renderStudents();
}

const pending = () => STUDENTS.filter(s => (s.approval_status ?? 'pending') === 'pending');


/* dashboard */

function renderStats() {
    const p = pending().length;
    const a = STUDENTS.filter(s => s.approval_status === 'approved').length;
    const d = STUDENTS.filter(s => s.approval_status === 'declined').length;
    const v = STUDENTS.filter(s => s.record_verified).length;

    setText('stat-pending',  String(p), 'stat-value');
    setText('stat-approved', String(a), 'stat-value');
    setText('stat-verified', String(v), 'stat-value');
    setText('stat-declined', String(d), 'stat-value');

    const badge = $('nav-pending');
    if (badge) {
        badge.textContent = String(p);
        badge.hidden = p === 0;
    }
}

function renderRecent() {
    const body = $('recent-body');
    if (!body) return;

    const list = pending().slice(0, 5);

    if (list.length === 0) {
        body.innerHTML = `
            <div class="empty">
                <i class="fa-solid fa-circle-check" aria-hidden="true"></i>
                <h3>Nothing awaiting review</h3>
                <p>All account requests have been reviewed.</p>
            </div>`;
        return;
    }

    body.innerHTML = `
        <div class="table-wrap">
            <table class="data-table">
                <thead><tr><th>Student ID</th><th>Name</th><th>Email</th><th>Requested</th></tr></thead>
                <tbody>${list.map(s => `
                    <tr>
                        <td class="mono">${escapeHtml(s.student_id || '—')}</td>
                        <td><strong>${escapeHtml(fullName(s) || '—')}</strong></td>
                        <td class="dim">${escapeHtml(s.email || '—')}</td>
                        <td class="dim">${daysAgo(s.created_at)}</td>
                    </tr>`).join('')}
                </tbody>
            </table>
        </div>`;
}


/* account requests */

function renderRequests() {
    const body  = $('requests-body');
    const count = $('requests-count');
    if (!body) return;

    const list = pending();
    if (count) count.textContent = list.length ? `${list.length} awaiting review` : '';

    if (list.length === 0) {
        body.innerHTML = `
            <div class="empty">
                <i class="fa-solid fa-circle-check" aria-hidden="true"></i>
                <h3>Queue is clear</h3>
                <p>Every account request has been reviewed.</p>
            </div>`;
        return;
    }

    body.innerHTML = list.map(s => `
        <article class="review-card">
            <div class="review-head">
                <div>
                    <h3 class="review-name">${escapeHtml(fullName(s) || '—')}</h3>
                    <p class="review-meta">
                        <span class="mono">${escapeHtml(s.student_id || 'No ID given')}</span>
                        · ${escapeHtml(s.email || '—')}
                        · requested ${daysAgo(s.created_at)}
                    </p>
                </div>
                <span class="pill ${s.declared_path === 'new' ? 'info' : 'waiting'}">
                    ${s.declared_path === 'new' ? 'New student' : 'Existing record'}
                </span>
            </div>

            <p class="review-hint">
                ${s.declared_path === 'new'
                    ? 'Confirm this person appears on the incoming student list, then assign their student ID.'
                    : 'Match the student ID above against the official student list before approving.'}
            </p>

            <div class="review-actions">
                <button class="btn-accent" data-approve="${escapeHtml(s.id)}">
                    <i class="fa-solid fa-check" aria-hidden="true"></i>
                    <span>Approve</span>
                </button>
                <button class="btn-danger" data-decline="${escapeHtml(s.id)}">
                    <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                    <span>Decline</span>
                </button>
            </div>
        </article>`).join('');

    body.querySelectorAll('[data-approve]').forEach(b =>
        b.addEventListener('click', () => decide(b.dataset.approve, 'approved')));
    body.querySelectorAll('[data-decline]').forEach(b =>
        b.addEventListener('click', () => promptDecline(b.dataset.decline)));
}

function promptDecline(id) {
    const student = STUDENTS.find(s => s.id === id);
    const note = window.prompt(
        `Decline the request from ${fullName(student) || 'this student'}?\n\n` +
        'Give a reason. The student sees this, so make it actionable — ' +
        'e.g. "Student ID not found in the official list; contact the ' +
        'Registrar to confirm your number."');

    if (note === null) return;                 // cancelled
    if (!note.trim()) {
        return showMsg('request-msg', 'A reason is required when declining.');
    }
    decide(id, 'declined', note.trim());
}

async function decide(id, status, note = null) {
    const patch = {
        approval_status: status,
        is_approved:     status === 'approved',
        review_note:     note,
        reviewed_by:     REGISTRAR_ID,
        reviewed_at:     new Date().toISOString(),
    };

    if (PREVIEW) {
        Object.assign(STUDENTS.find(s => s.id === id), patch);
        afterLoad();
        return showMsg('request-msg', `Request ${status} (preview only — not saved).`, 'success');
    }

    const { error } = await supabase
        .from('university_student')
        .update(patch)
        .eq('id', id);

    if (error) {
        console.error('decision failed:', error.message);
        return showMsg('request-msg', 'Could not save that decision. Please try again.');
    }

    const student = STUDENTS.find(s => s.id === id);
    Object.assign(student, patch);
    afterLoad();

    showMsg('request-msg',
        status === 'approved'
            ? `${fullName(student)} approved. They can now sign in.`
            : `${fullName(student)} declined.`,
        'success');
}


/* students */

function filteredStudents() {
    const term   = ($('student-search')?.value || '').trim().toLowerCase();
    const filter = $('student-filter')?.value || 'all';

    return STUDENTS.filter((s) => {
        const status = s.approval_status ?? 'pending';
        if (filter === 'approved'   && status !== 'approved') return false;
        if (filter === 'pending'    && status !== 'pending')  return false;
        if (filter === 'declined'   && status !== 'declined') return false;
        if (filter === 'unverified' && s.record_verified)     return false;

        if (!term) return true;
        return [s.first_name, s.last_name, s.student_id, s.email]
            .filter(Boolean).join(' ').toLowerCase().includes(term);
    });
}

function statusPill(s) {
    const status = s.approval_status ?? 'pending';
    if (status === 'approved') return '<span class="pill ok">Approved</span>';
    if (status === 'declined') return '<span class="pill bad">Declined</span>';
    return '<span class="pill waiting">Pending</span>';
}

function renderStudents() {
    const body  = $('students-body');
    const count = $('students-count');
    if (!body) return;

    const list = filteredStudents();
    if (count) count.textContent = STUDENTS.length ? `${list.length} of ${STUDENTS.length}` : '';

    if (list.length === 0) {
        body.innerHTML = `
            <div class="empty">
                <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
                <h3>${STUDENTS.length === 0 ? 'No students yet' : 'No matches'}</h3>
                <p>${STUDENTS.length === 0
                    ? 'Student accounts will appear here once they have registered.'
                    : 'No student matches that search or filter.'}</p>
            </div>`;
        return;
    }

    body.innerHTML = `
        <div class="table-wrap">
            <table class="data-table">
                <thead>
                    <tr>
                        <th>Student ID</th><th>Name</th><th>Year</th>
                        <th>Account</th><th>Record</th><th></th>
                    </tr>
                </thead>
                <tbody>${list.map(s => `
                    <tr class="row-link" data-open="${escapeHtml(s.id)}" tabindex="0" role="button">
                        <td class="mono">${escapeHtml(s.student_id || '—')}</td>
                        <td>
                            <strong>${escapeHtml(fullName(s) || '—')}</strong>
                            <span class="row-sub">${escapeHtml(s.email || '')}</span>
                        </td>
                        <td>${escapeHtml(ordinal(s.year_level) || '—')}</td>
                        <td>${statusPill(s)}</td>
                        <td>${s.record_verified
                            ? '<span class="pill ok">Verified</span>'
                            : '<span class="pill waiting">Unverified</span>'}</td>
                        <td class="num"><i class="fa-solid fa-chevron-right dim" aria-hidden="true"></i></td>
                    </tr>`).join('')}
                </tbody>
            </table>
        </div>`;

    body.querySelectorAll('[data-open]').forEach((row) => {
        const go = () => { window.location.hash = `#student/${row.dataset.open}`; };
        row.addEventListener('click', go);
        row.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
        });
    });
}


/* student detail */

async function openStudent(studentRowId) {
    const s = STUDENTS.find(x => x.id === studentRowId);

    if (!s) {
        setText('detail-name', 'Student not found');
        setText('detail-sub', '');
        $('detail-record-body').innerHTML = `
            <div class="empty">
                <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
                <h3>No such student</h3>
                <p>That student could not be found.</p>
            </div>`;
        return;
    }

    setText('detail-name', fullName(s) || '—');
    setText('detail-sub',
        `${s.student_id || 'No ID'} · ${ordinal(s.year_level) || 'Year not set'} · BS Information Technology`);

    $('detail-status').innerHTML = `
        <div class="detail"><dt>University email</dt><dd class="mono">${escapeHtml(s.email || '—')}</dd></div>
        <div class="detail"><dt>Registration path</dt><dd>${s.declared_path === 'new' ? 'New student' : 'Existing record'}</dd></div>
        <div class="detail"><dt>Account</dt><dd>${statusPill(s)}</dd></div>
        <div class="detail"><dt>Record</dt><dd>${s.record_verified
            ? '<span class="pill ok">Verified</span>'
            : '<span class="pill waiting">Unverified</span>'}</dd></div>
        ${s.review_note ? `<div class="detail"><dt>Review note</dt><dd>${escapeHtml(s.review_note)}</dd></div>` : ''}`;

    // Verification is the only write the Registrar performs here. Grade
    // upload belongs to Department Staff; this view is read-only on grades.
    $('detail-actions').innerHTML = s.approval_status === 'approved'
        ? `<button class="${s.record_verified ? 'btn-danger' : 'btn-accent'}"
                   data-verify="${escapeHtml(s.id)}" data-to="${s.record_verified ? 'false' : 'true'}">
               <i class="fa-solid ${s.record_verified ? 'fa-xmark' : 'fa-check'}" aria-hidden="true"></i>
               <span>${s.record_verified ? 'Mark unverified' : 'Verify record'}</span>
           </button>`
        : '<p class="prose">This account has not been approved, so its record cannot be verified yet.</p>';

    $('detail-actions').querySelectorAll('[data-verify]').forEach(b =>
        b.addEventListener('click', async () => {
            await setVerified(b.dataset.verify, b.dataset.to === 'true');
            openStudent(studentRowId);
        }));

    await loadStudentRecord(s.id);
}

async function loadStudentRecord(studentRowId) {
    const body  = $('detail-record-body');
    const count = $('detail-record-count');
    if (!body) return;

    body.innerHTML = `
        <div class="empty">
            <i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i>
            <h3>Loading</h3>
            <p>Fetching grades.</p>
        </div>`;

    let records = [];

    if (PREVIEW) {
        records = PREVIEW_RECORDS[studentRowId] ?? [];
    } else {
        const { data, error } = await supabase
            .from('academic_record')
            .select('id, grade, grade_points, status, taken_term, taken_year, subject:subject_id (code, title, units)')
            .eq('student_id', studentRowId)
            .order('taken_year', { ascending: true })
            .order('taken_term', { ascending: true });

        if (error) {
            console.warn('record load failed:', error.message);
            body.innerHTML = `
                <div class="empty">
                    <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
                    <h3>Could not load grades</h3>
                    <p>${escapeHtml(error.message)}</p>
                </div>`;
            return;
        }
        records = data ?? [];
    }

    const passed = records.filter(r => r.status === 'PASSED');
    const units  = passed.reduce((t, r) => t + Number(r.subject?.units || 0), 0);

    if (count) {
        count.textContent = records.length
            ? `${records.length} subject${records.length === 1 ? '' : 's'} · ${units} units earned`
            : '';
    }

    if (records.length === 0) {
        body.innerHTML = `
            <div class="empty">
                <i class="fa-solid fa-file-circle-question" aria-hidden="true"></i>
                <h3>No grades on file</h3>
                <p>
                    No academic record has been uploaded for this student.
                    Grade files are uploaded by Department Staff.
                </p>
            </div>`;
        return;
    }

    body.innerHTML = `
        <div class="table-wrap">
            <table class="data-table">
                <thead>
                    <tr>
                        <th>Code</th><th>Descriptive title</th>
                        <th class="num">Units</th><th class="num">Grade</th>
                        <th>Status</th><th>Term</th>
                    </tr>
                </thead>
                <tbody>${records.map(r => `
                    <tr>
                        <td class="mono">${escapeHtml(r.subject?.code || '—')}</td>
                        <td>${escapeHtml(r.subject?.title || '—')}</td>
                        <td class="num">${escapeHtml(r.subject?.units ?? '—')}</td>
                        <td class="num">${r.grade_points != null
                            ? escapeHtml(Number(r.grade_points).toFixed(2))
                            : escapeHtml(r.grade || '—')}</td>
                        <td><span class="pill ${statusClass(r.status)}">${statusLabel(r.status)}</span></td>
                        <td class="dim">${termLabel(r.taken_term)} · ${escapeHtml(r.taken_year || '—')}</td>
                    </tr>`).join('')}
                </tbody>
            </table>
        </div>`;
}

const statusClass = (s) =>
    ({ PASSED: 'ok', FAILED: 'bad', ENROLLED: 'info', DROPPED: 'waiting' })[s] || 'waiting';

const statusLabel = (s) =>
    ({ PASSED: 'Passed', FAILED: 'Failed', ENROLLED: 'Enrolled', DROPPED: 'Dropped' })[s] || s;

const termLabel = (t) => ({ 1: '1st Sem', 2: '2nd Sem', 3: 'Summer' })[t] || '—';

async function setVerified(id, verified) {
    const patch = {
        record_verified: verified,
        verified_by:     verified ? REGISTRAR_ID : null,
        verified_at:     verified ? new Date().toISOString() : null,
    };

    if (PREVIEW) {
        Object.assign(STUDENTS.find(s => s.id === id), patch);
        afterLoad();
        return showMsg('student-msg', 'Updated (preview only — not saved).', 'success');
    }

    const { error } = await supabase
        .from('university_student')
        .update(patch)
        .eq('id', id);

    if (error) {
        console.error('verification failed:', error.message);
        return showMsg('student-msg', 'Could not update the record.');
    }

    const student = STUDENTS.find(s => s.id === id);
    Object.assign(student, patch);
    afterLoad();

    showMsg('student-msg',
        verified
            ? `${fullName(student)}'s record verified. Eligibility can now be computed.`
            : `${fullName(student)}'s record marked unverified.`,
        'success');
}

$('student-search')?.addEventListener('input', renderStudents);
$('student-filter')?.addEventListener('change', renderStudents);


/* boot */

(async function init() {

    if (previewRequested()) {
        PREVIEW = true;
        REGISTRAR = PREVIEW_REGISTRAR;
        REGISTRAR_ID = PREVIEW_REGISTRAR.id;
        document.body.classList.add('is-preview');
        renderProfile(REGISTRAR, PREVIEW_REGISTRAR.email);
        renderNotice(REGISTRAR);
        await loadStudents();
        route();
        return;
    }

    if (!supabase) {
        setText('greeting', 'Cannot reach the service');
        console.error('registrardashboard.js: Supabase client not created. Is config.js loaded?');
        return;
    }

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { window.location.href = LOGIN_PAGE; return; }

    AUTH_UID = session.user.id;

    const { data: staff, error } = await supabase
        .from('registrar_staff')
        .select('id, user_id, first_name, last_name, employee_id, email, is_approved')
        .eq('user_id', AUTH_UID)
        .maybeSingle();

    if (error) console.warn('registrar load failed:', error.message);

    if (staff && staff.is_approved === false) {
        await supabase.auth.signOut();
        window.location.href = LOGIN_PAGE;
        return;
    }

    REGISTRAR = staff;
    // reviewed_by / verified_by reference registrar_staff.id, not user_id.
    REGISTRAR_ID = staff?.id ?? null;

    renderProfile(staff, session.user.email);
    renderNotice(staff);

    await loadStudents();
    route();
})();

})();