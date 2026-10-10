// facultydashboard.js
// Faculty Staff view: student lookup and academic record review.
//
// Eligibility is blocked on the knowledge base, same as the student
// dashboard. What works today is the student list and record viewing —
// which is the half a faculty member needs before a recommendation exists.
//
// Requires config.js to be loaded first.

(function () {
'use strict';

const { SUPABASE_URL, SUPABASE_ANON_KEY, authStorageKey, authOptions } = window.CURRICULOGIC ?? {};

// Bucketed storage key (see config.js) -- faculty, registrar and
// department share the "staff" bucket, since they already share one
// login page/form; this just keeps that bucket separate from student
// and admin sessions in other tabs.
const supabase = (window.supabase && SUPABASE_URL && SUPABASE_ANON_KEY)
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: authOptions ? authOptions(['faculty_staff']) : { storageKey: authStorageKey?.(['faculty_staff']) },
    })
    : null;

const $ = (id) => document.getElementById(id);

const LOGIN_PAGE = '../auth/html/staffloginpage.html';

let AUTH_UID = null;
let FACULTY  = null;
let STUDENTS = [];
let PREVIEW  = false;
let CURRENT_SLIP = null;


/* preview mode (development only) */

const PREVIEW_HOSTS = ['localhost', '127.0.0.1', ''];

const PREVIEW_FACULTY = {
    first_name: 'Rhea', last_name: 'Lumactod',
    employee_id: 'EMP-00871', email: 'rhea.lumactod@uc.edu.ph',
    department: 'College of Computer Studies', program_id: 1, is_approved: true,
};

const PREVIEW_STUDENTS = [
    { id: 's1', user_id: 'u1', first_name: 'Althea',  last_name: 'Villanueva', student_id: '2401187', email: 'althea1@gmail.com',  year_level: 2, is_approved: true,  record_verified: true  },
    { id: 's2', user_id: 'u2', first_name: 'Marco',   last_name: 'Deveza',     student_id: '2401203', email: 'marco.deveza@uc.edu.ph',      year_level: 2, is_approved: true,  record_verified: true  },
    { id: 's3', user_id: 'u3', first_name: 'Janine',  last_name: 'Abella',     student_id: '2300845', email: 'janine.abella@uc.edu.ph',     year_level: 3, is_approved: true,  record_verified: false },
    { id: 's4', user_id: 'u4', first_name: 'Paulo',   last_name: 'Cabahug',    student_id: '2501562', email: 'paulo.cabahug@uc.edu.ph',     year_level: 1, is_approved: true,  record_verified: false },
];

const PREVIEW_RECORDS = {
    s1: [
        { id: 'r1', subject_code: 'IT 111',   subject_title: 'Introduction to Computing', units: 3, grade: '1.75', grade_points: 1.75, status: 'PASSED', taken_term: 1, taken_year: 2024 },
        { id: 'r2', subject_code: 'IT 112',   subject_title: 'Computer Programming 1',    units: 3, grade: '2.25', grade_points: 2.25, status: 'PASSED', taken_term: 1, taken_year: 2024 },
        { id: 'r3', subject_code: 'IT 121',   subject_title: 'Computer Programming 2',    units: 3, grade: '3.25', grade_points: 3.25, status: 'FAILED', taken_term: 2, taken_year: 2024 },
        { id: 'r4', subject_code: 'IT 122',   subject_title: 'Data Structures',           units: 3, grade: null, grade_points: null, status: 'ENROLLED', taken_term: 1, taken_year: 2026 },
    ],
    s2: [
        { id: 'r5', subject: { code: 'IT 111', title: 'Introduction to Computing', units: 3 }, subject_code: 'IT 111', subject_title: 'Introduction to Computing', units: 3, grade: '2.00', grade_points: 2.00, status: 'PASSED', taken_term: 1, taken_year: 2024 },
    ],
};

function previewRequested() {
    if (!PREVIEW_HOSTS.includes(window.location.hostname)) return false;
    return new URLSearchParams(window.location.search).has('preview');
}


/* view routing */

const VIEWS = {
    dashboard: 'Dashboard',
    students:  'Students',
    student:   'Student detail',
    requests:  'Advising requests',
    prospectus: 'Prospectus',
    profile:   'Profile',
};

const shell = $('shell');

/* Hash may carry a student id: #student/<uuid> */
function parseHash() {
    const raw = window.location.hash.replace('#', '');
    const [name, param] = raw.split('/');
    return { name: name in VIEWS ? name : 'dashboard', param: param || null };
}

function showView(name, param) {
    Object.keys(VIEWS).forEach((key) => {
        const section = $(`view-${key}`);
        if (section) section.hidden = key !== name;
    });

    document.querySelectorAll('.side-nav a').forEach((link) => {
        // The student detail view is reached from Students, so keep that
        // nav item highlighted while drilled in.
        const target = name === 'student' ? 'students' : name;
        link.classList.toggle('active', link.dataset.view === target);
    });

    const title = $('topbar-title');
    if (title) title.textContent = VIEWS[name];

    shell?.classList.remove('nav-open');

    if (name === 'students') loadStudents();
    if (name === 'student' && param) openStudent(param);
    if (name === 'prospectus') loadProspectusPage();

    if (name === 'requests') {
        const inDetail = !!param;
        const queueEl  = $('req-sub-queue');
        const detailEl = $('req-sub-detail');
        if (queueEl)  queueEl.hidden  = inDetail;
        if (detailEl) detailEl.hidden = !inDetail;
        if (inDetail) loadRequestDetail(param);
        else          loadRequestQueue();
    }
}

/* The curriculum, by year, read-only. Every published version of the
   adviser's own programme (access rules already limit it to that), including
   older ones a student may still be on. */
async function loadProspectusPage() {
    const body = $('prospectus-grid');
    const sel  = $('pros-version');
    if (!body || !sel) return;

    if (typeof window.ProspectusGrid === 'undefined') {
        console.error('prospectusgrid.js not loaded');
        body.innerHTML = '<div class="empty"><h3>Could not load the curriculum</h3></div>';
        return;
    }
    if (PREVIEW) {
        body.innerHTML = '<div class="empty"><h3>Preview mode</h3>' +
            '<p>The curriculum is not loaded in preview.</p></div>';
        return;
    }
    await window.ProspectusGrid.mountVersions(supabase, { select: sel, body, title: $('pros-title') });
}

function route() {
    const { name, param } = parseHash();
    showView(name, param);
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

/* A student's degree, looked up from their program_id rather than typed.
   No programme set reads "—". Preview has no database, so it shows the
   sample programme its fixtures describe. */
function programName(student) {
    return window.CurriculogicPrograms?.nameOf(student?.program_id, PREVIEW ? 'BS Information Technology' : '—')
        ?? '—';
}

function ordinal(n) {
    const map = { 1: '1st Year', 2: '2nd Year', 3: '3rd Year', 4: '4th Year', 5: '5th Year' };
    return map[n] || null;
}

/* The programme this account is assigned to, shown next to the term in the
   header. Static: it only changes when an admin reassigns the account. */
function paintProgramChip() {
    const chip = document.getElementById('topbar-program');
    if (!chip) return;
    const id = FACULTY?.program_id;
    const P = window.CurriculogicPrograms;
    const code = id == null ? '' : P?.codeOf(id, '');
    if (!code) { chip.hidden = true; return; }
    chip.textContent = code;
    chip.title = P.nameOf(id, code);
    chip.hidden = false;
}

function termLabel(t) {
    return { 1: '1st Sem', 2: '2nd Sem', 3: 'Summer' }[t] || '—';
}

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

function statusClass(s) {
    return { PASSED: 'ok', FAILED: 'bad', ENROLLED: 'info', DROPPED: 'waiting' }[s] || 'waiting';
}

function statusLabel(s) {
    // An unknown status is shown as it is, but as text: this goes into HTML.
    return { PASSED: 'Passed', FAILED: 'Failed', ENROLLED: 'Enrolled', DROPPED: 'Dropped' }[s] || escapeHtml(s);
}

function showMsg(id, text, type = 'error') {
    const box = $(id);
    if (!box) return;
    box.textContent = text;
    // An empty message must never carry error styling -- see the same
    // fix applied to Department Staff's showMsg earlier: clearing a
    // message is not itself an error.
    box.className = text ? 'msg ' + type : 'msg';
}

function fullName(p) {
    return [p?.first_name, p?.last_name].filter(Boolean).join(' ');
}


/* profile */

function renderProfile(staff, authEmail) {
    const full  = fullName(staff);
    const email = staff?.email || authEmail || '—';

    $('avatar').textContent    = initials(staff?.first_name, staff?.last_name, email);
    $('user-name').textContent = full || email;
    $('user-sub').textContent  = staff?.employee_id || '';

    $('greeting').textContent = staff?.first_name
        ? `Welcome back, ${staff.first_name}`
        : 'Welcome back';

    setText('d-name',  full || '—');
    setText('d-eid',   staff?.employee_id || '—', 'mono');
    setText('d-email', email, 'mono');
    setText('d-dept',  staff?.department || '—');

    $('d-status').innerHTML = staff?.is_approved
        ? '<span class="pill ok"><i class="fa-solid fa-check"></i> Approved</span>'
        : '<span class="pill waiting"><i class="fa-solid fa-clock"></i> Awaiting approval</span>';
}

function renderNotice(staff) {
    const box = $('status-notice');
    if (!box) return;

    if (!staff) {
        box.innerHTML = `
            <div class="notice pending">
                <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
                <div>
                    <strong>No faculty record found</strong>
                    Your sign-in worked, but no faculty record is linked to this
                    account. Please contact the System Administrator.
                </div>
            </div>`;
        return;
    }

    box.innerHTML = '';
}

/* Password change. Same pattern as Department Staff's: re-authenticate
   with the current password first (catches "left laptop open" and a
   mistyped current password in one step; also refreshes the session
   token as a harmless side effect), then call updateUser(). Faculty
   had no self-service path for this at all before -- the only option
   was asking the System Administrator to reset it by hand. */
function openPasswordModal() {
    const modal = $('password-modal');
    if (!modal) return;

    ['pw-current', 'pw-new', 'pw-confirm'].forEach(id => {
        const el = $(id); if (el) el.value = '';
    });
    showMsg('pw-msg', '');

    modal.hidden = false;
    setTimeout(() => $('pw-current')?.focus(), 60);

    const close = () => {
        modal.hidden = true;
        $('pw-cancel')?.removeEventListener('click', onCancel);
        $('pw-submit')?.removeEventListener('click', onSubmit);
        modal.removeEventListener('click', onBackdrop);
        document.removeEventListener('keydown', onKey);
    };

    const onCancel   = () => close();
    const onSubmit   = () => submitPasswordChange(close);
    const onBackdrop = (e) => { if (e.target === modal) close(); };
    const onKey      = (e) => { if (e.key === 'Escape') close(); };

    $('pw-cancel')?.addEventListener('click', onCancel);
    $('pw-submit')?.addEventListener('click', onSubmit);
    modal.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKey);
}

async function submitPasswordChange(close) {
    const current = $('pw-current')?.value ?? '';
    const next    = $('pw-new')?.value ?? '';
    const confirm = $('pw-confirm')?.value ?? '';

    if (!current) return showMsg('pw-msg', 'Enter your current password.');
    const pwProblem = CurriculogicPasswordRules.problem(next);
    if (pwProblem) return showMsg('pw-msg', pwProblem);
    if (next !== confirm) return showMsg('pw-msg', 'New passwords do not match.');

    const btn = $('pw-submit');
    if (btn) { btn.disabled = true; btn.textContent = 'Updating…'; }

    const finish = (msg, type) => {
        if (btn) { btn.disabled = false; btn.textContent = 'Change password'; }
        showMsg('pw-msg', msg, type);
    };

    if (PREVIEW) {
        finish('Password updated (preview only).', 'success');
        return setTimeout(close, 900);
    }

    // 1. Verify current password by attempting a sign-in.
    const email = FACULTY?.email;
    if (!email) return finish('No email on record for this account.', 'error');

    const { error: authErr } = await supabase.auth.signInWithPassword({
        email,
        password: current,
    });
    if (authErr) return finish('Current password is incorrect.', 'error');

    // 2. Change it.
    const { error: upErr } = await supabase.auth.updateUser({ password: next });
    if (upErr) return finish(upErr.message || 'Could not change password.');

    // 3. Clear the must-change flag if it was set.
    if (FACULTY?.must_change_password && FACULTY?.id) {
        await supabase.rpc('clear_must_change_password');
        FACULTY = { ...FACULTY, must_change_password: false };
    }

    finish('Password updated.', 'success');
    setTimeout(close, 900);
}

$('p-change-password')?.addEventListener('click', openPasswordModal);


/* students */

let studentsLoaded = false;

async function loadStudents(force = false) {
    if (studentsLoaded && !force) return renderStudents();

    if (PREVIEW) {
        STUDENTS = [...PREVIEW_STUDENTS];
        studentsLoaded = true;
        renderStudents();
        renderRecent();
        renderStats();
        return;
    }

    if (!supabase) return;

    const { data, error } = await supabase
        .from('university_student')
        .select('id, user_id, first_name, last_name, student_id, email, year_level, is_approved, record_verified, prospectus_id, program_id')
        .order('last_name', { ascending: true });

    if (error) {
        console.warn('student list failed:', error.message);
        const body = $('students-body');
        if (body) {
            body.innerHTML = `
                <div class="empty">
                    <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
                    <h3>Could not load students</h3>
                    <p>${escapeHtml(error.message)}</p>
                    <p class="dim">If this says permission denied, run db/008_staff_read_access.sql.</p>
                </div>`;
        }
        return;
    }

    STUDENTS = data ?? [];
    studentsLoaded = true;
    renderStudents();
    renderRecent();
    renderStats();
}

function filteredStudents() {
    const term   = ($('student-search')?.value || '').trim().toLowerCase();
    const filter = $('student-filter')?.value || 'all';

    return STUDENTS.filter((s) => {
        if (filter === 'verified' && !s.record_verified) return false;
        if (filter === 'pending'  &&  s.record_verified) return false;

        if (!term) return true;

        const haystack = [
            s.first_name, s.last_name, s.student_id, s.email,
        ].filter(Boolean).join(' ').toLowerCase();

        return haystack.includes(term);
    });
}

const STUDENT_PAGE_SIZE = 20;
let STUDENT_PAGE = 1;

function renderStudents() {
    const body  = $('students-body');
    const count = $('students-count');
    if (!body) return;

    const list = filteredStudents();

    // 20 students a page; a search or filter change goes back to page 1.
    const pages = Math.max(1, Math.ceil(list.length / STUDENT_PAGE_SIZE));
    STUDENT_PAGE = Math.min(Math.max(1, STUDENT_PAGE), pages);
    const from = (STUDENT_PAGE - 1) * STUDENT_PAGE_SIZE;
    const shown = list.slice(from, from + STUDENT_PAGE_SIZE);

    if (count) {
        count.textContent = STUDENTS.length
            ? `${list.length} of ${STUDENTS.length}`
            : '';
    }

    if (STUDENTS.length === 0) {
        body.innerHTML = `
            <div class="empty">
                <i class="fa-solid fa-users-slash" aria-hidden="true"></i>
                <h3>No students yet</h3>
                <p>Student accounts will appear here once they have registered.</p>
            </div>`;
        return;
    }

    if (list.length === 0) {
        body.innerHTML = `
            <div class="empty">
                <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
                <h3>No matches</h3>
                <p>No student matches that search or filter.</p>
            </div>`;
        return;
    }

    const rows = shown.map((s) => `
        <tr class="row-link" data-open="${escapeHtml(s.id)}" tabindex="0" role="button">
            <td class="mono">${escapeHtml(s.student_id || '—')}</td>
            <td><strong>${escapeHtml(fullName(s) || '—')}</strong></td>
            <td class="dim">${escapeHtml(s.email || '—')}</td>
            <td>${escapeHtml(ordinal(s.year_level) || '—')}</td>
            <td>${s.record_verified
                ? '<span class="pill ok">Verified</span>'
                : '<span class="pill waiting">Pending</span>'}</td>
            <td class="num"><i class="fa-solid fa-chevron-right dim" aria-hidden="true"></i></td>
        </tr>`).join('');

    body.innerHTML = `
        <div class="table-wrap">
            <table class="data-table">
                <thead>
                    <tr>
                        <th>Student ID</th>
                        <th>Name</th>
                        <th>Email</th>
                        <th>Year</th>
                        <th>Record</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
        ${pages > 1 ? `
        <div class="pager">
            <span class="dim">${from + 1}–${from + shown.length} of ${list.length}</span>
            <span class="pager-btns">
                <button type="button" class="btn-small" data-student-page="prev" ${STUDENT_PAGE === 1 ? 'disabled' : ''}>Previous</button>
                <span class="pager-now">Page ${STUDENT_PAGE} of ${pages}</span>
                <button type="button" class="btn-small" data-student-page="next" ${STUDENT_PAGE === pages ? 'disabled' : ''}>Next</button>
            </span>
        </div>` : ''}`;

    body.querySelectorAll('[data-open]').forEach((row) => {
        const go = () => { window.location.hash = `#student/${row.dataset.open}`; };
        row.addEventListener('click', go);
        row.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
        });
    });
}

$('student-search')?.addEventListener('input', () => { STUDENT_PAGE = 1; renderStudents(); });
$('student-filter')?.addEventListener('change', () => { STUDENT_PAGE = 1; renderStudents(); });
$('students-body')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-student-page]');
    if (!b || b.disabled) return;
    STUDENT_PAGE += b.dataset.studentPage === 'next' ? 1 : -1;
    renderStudents();
});

$('print-slip')?.addEventListener('click', () => {
    if (!CURRENT_SLIP) return;
    if (typeof window.AdvisingSlip === 'undefined') {
        console.error('advisingslip.js not loaded — check script order');
        return;
    }
    window.AdvisingSlip.print(CURRENT_SLIP);
});

/* dashboard tiles */

function renderStats() {
    const verified = STUDENTS.filter(s => s.record_verified).length;

    setText('stat-students', String(STUDENTS.length), 'stat-value');
    setText('stat-verified', String(verified), 'stat-value');
    setText('stat-pending',  String(STUDENTS.length - verified), 'stat-value');
    setText('stat-requests', '—', 'stat-value muted');
}

function renderRecent() {
    const body = $('recent-body');
    if (!body) return;

    if (STUDENTS.length === 0) {
        body.innerHTML = `
            <div class="empty">
                <i class="fa-solid fa-users-slash" aria-hidden="true"></i>
                <h3>No students yet</h3>
                <p>Student accounts will appear here once they have registered.</p>
            </div>`;
        return;
    }

    const rows = STUDENTS.slice(0, 5).map((s) => `
        <tr class="row-link" data-open="${escapeHtml(s.id)}" tabindex="0" role="button">
            <td class="mono">${escapeHtml(s.student_id || '—')}</td>
            <td><strong>${escapeHtml(fullName(s) || '—')}</strong></td>
            <td>${escapeHtml(ordinal(s.year_level) || '—')}</td>
            <td>${s.record_verified
                ? '<span class="pill ok">Verified</span>'
                : '<span class="pill waiting">Pending</span>'}</td>
        </tr>`).join('');

    body.innerHTML = `
        <div class="table-wrap">
            <table class="data-table">
                <thead>
                    <tr><th>Student ID</th><th>Name</th><th>Year</th><th>Record</th></tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;

    body.querySelectorAll('[data-open]').forEach((row) => {
        row.addEventListener('click', () => {
            window.location.hash = `#student/${row.dataset.open}`;
        });
    });
}


/* student detail */

/* eligibility */

/* One knowledge base per prospectus version, cached. Faculty move
   between students and most share a version; a student who started
   earlier is assessed against the curriculum they enrolled under, not
   whichever version happens to be active. */
const KB_CACHE = new Map();

async function kbFor(prospectusId) {
    if (KB_CACHE.has(prospectusId)) return KB_CACHE.get(prospectusId);

    const [subs, rules] = await Promise.all([
        supabase.from('subject')
            .select('id, code, title, units, lec_units, lab_units, year_level, term, is_elective, elective_type, category, is_active')
            .eq('prospectus_id', prospectusId),
        supabase.from('prerequisite')
            .select('subject_id, prerequisite_subject_id, requirement_type, rule_type, rule_group, threshold_value'),
    ]);

    if (subs.error)  console.warn('subject load failed:', subs.error.message);
    if (rules.error) console.warn('rule load failed:', rules.error.message);

    const kb = {
        subjects:  subs.data  ?? [],
        rules:     rules.data ?? [],
        /* Offerings are not consulted here. An adviser needs to see what a
           student is qualified for, not only what the department happens
           to be running this term. */
        offerings: [],
    };

    KB_CACHE.set(prospectusId, kb);
    return kb;
}

/* assess() output -> the grid's status map. */
function statusMap(result) {
    const map = new Map();
    if (!result) return map;

    for (const s of result.completed) {
        map.set(s.id, { state: 'passed', detail: 'Passed' });
    }

    for (const s of result.inProgress) {
        map.set(s.id, { state: 'enrolled', detail: 'Currently enrolled' });
    }

    for (const e of result.eligible) {
        map.set(e.subject.id, {
            state:  e.retake ? 'retake' : 'eligible',
            detail: e.retake
                ? 'Previously failed. Eligible to retake.'
                : 'All requirements met.',
        });
    }

    for (const l of result.locked) {
        map.set(l.subject.id, {
            state:  'blocked',
            detail: l.unmet.map(u => u.detail).join(' '),
        });
    }

    return map;
}


/* student detail */

async function openStudent(studentRowId) {
    const userId = studentRowId;   // university_student.id, not user_id
    const student = STUDENTS.find(s => s.id === userId);

    // Clear the slip action from any previous student before the
    // new one is evaluated. Any branch that actually computes a
    // result will set these back below.
    CURRENT_SLIP = null;
    const slipBtnReset = $('print-slip');
    if (slipBtnReset) slipBtnReset.hidden = true;

    // Deep link straight to a student, before the list has loaded.
    if (!student && !studentsLoaded) {
        await loadStudents();
        return openStudent(userId);
    }

    if (!student) {
        setText('detail-name', 'Student not found');
        setText('detail-sub', '');
        $('detail-record-body').innerHTML = `
            <div class="empty">
                <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
                <h3>No such student</h3>
                <p>That student could not be found in the list you can access.</p>
            </div>`;
        return;
    }

    setText('detail-name', fullName(student) || '—');
    setText('detail-sub',
        `${student.student_id || 'No ID'} · ${ordinal(student.year_level) || 'Year not set'} · ${programName(student)}`);

    const eligNote = $('detail-elig-note');
    const eligBody = $('detail-elig-body');

    // Load once. The table below and the engine above read the same rows.
    const records = await fetchRecords(userId);
    renderStudentRecord(records);

    if (!student.record_verified) {
        if (eligNote) eligNote.textContent = '';
        eligBody.innerHTML = `
            <div class="empty">
                <i class="fa-solid fa-hourglass-half" aria-hidden="true"></i>
                <h3>Record not yet verified</h3>
                <p>
                    Eligibility cannot be computed until the Office of the Registrar
                    confirms this student's academic record.
                </p>
            </div>`;
        return;
    }

    if (!student.prospectus_id) {
        if (eligNote) eligNote.textContent = '';
        eligBody.innerHTML = `
            <div class="empty">
                <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
                <h3>No curriculum version set</h3>
                <p>
                    This student is not linked to a prospectus version, so eligibility
                    cannot be computed. The Office of the Registrar can set it.
                </p>
            </div>`;
        return;
    }

    if (typeof CurricuLogicEngine === 'undefined' ||
        typeof window.ProspectusGrid === 'undefined') {
        console.error('engine.js or prospectusgrid.js not loaded — check script order');
        if (eligNote) eligNote.textContent = '';
        eligBody.innerHTML = `
            <div class="empty">
                <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
                <h3>Could not run the assessment</h3>
                <p>The inference engine did not load.</p>
            </div>`;
        return;
    }

    if (eligNote) eligNote.textContent = '';
    eligBody.innerHTML = `
        <div class="empty">
            <i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i>
            <h3>Assessing</h3>
            <p>Checking this student against the curriculum.</p>
        </div>`;

    const kb = await kbFor(student.prospectus_id);

    if (kb.subjects.length === 0) {
        eligBody.innerHTML = `
            <div class="empty">
                <i class="fa-solid fa-diagram-project" aria-hidden="true"></i>
                <h3>Curriculum not yet encoded</h3>
                <p>
                    This student's prospectus version has no subjects, so eligibility
                    cannot be computed.
                </p>
            </div>`;
        return;
    }

    const result = CurricuLogicEngine.assess(
        { id: student.id, year_level: student.year_level },
        records,
        kb,
        { respectOfferings: false },
    );

    if (eligNote && result) {
        eligNote.textContent =
            `${result.completed.length} passed · ` +
            `${result.eligible.length} available · ` +
            `${result.locked.length} locked`;
    }

    await window.ProspectusGrid.render(
        supabase, student.prospectus_id, eligBody, statusMap(result));

    // The slip reads the same assess() output the grid above was just
    // built from — a slip that disagreed with the screen would be worse
    // than no slip at all.
    CURRENT_SLIP = {
        student,
        result,
        records,
        term: {
            label: document.querySelector('.topbar-term')?.textContent?.trim() ?? '',
        },
        adviser: fullName(FACULTY) || 'Faculty adviser',
        program: {
            name: programName(student),
            college: window.CurriculogicPrograms?.collegeOf(student.program_id, '') ?? '',
        },
    };
    const slipBtn = $('print-slip');
    if (slipBtn) slipBtn.hidden = false;
}


/* academic record */

/* Fetch only. openStudent needs these rows for the engine as well as for
   the table, and querying twice would be both slower and a chance for
   the two panels to disagree. */
async function fetchRecords(userId) {
    if (PREVIEW) return PREVIEW_RECORDS[userId] ?? [];

    const { data, error } = await supabase
        .from('academic_record')
        .select('id, subject_id, grade, grade_points, status, taken_term, taken_year, subject:subject_id (code, title, units)')
        .eq('student_id', userId)
        .order('taken_year', { ascending: true })
        .order('taken_term', { ascending: true });

    if (error) {
        console.warn('record load failed:', error.message);
        return null;               // distinct from "no records"
    }

    return (data ?? []).map((r) => ({
        ...r,
        subject_code:  r.subject?.code  ?? r.subject_code  ?? '—',
        subject_title: r.subject?.title ?? r.subject_title ?? '—',
        units:         r.subject?.units ?? r.units         ?? 0,
    }));
}

function renderStudentRecord(records) {
    const body  = $('detail-record-body');
    const count = $('detail-record-count');
    if (!body) return;

    if (records === null) {
        if (count) count.textContent = '';
        body.innerHTML = `
            <div class="empty">
                <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
                <h3>Could not load the record</h3>
                <p>The academic record could not be read. Check the console for details.</p>
            </div>`;
        return;
    }

    const passed = records.filter(r => r.status === 'PASSED');
    const units  = passed.reduce((s, r) => s + Number(r.units || 0), 0);

    if (count) {
        count.textContent = records.length
            ? `${records.length} subject${records.length === 1 ? '' : 's'} · ${units} units earned`
            : '';
    }

    if (records.length === 0) {
        body.innerHTML = `
            <div class="empty">
                <i class="fa-solid fa-file-circle-question" aria-hidden="true"></i>
                <h3>No subjects recorded</h3>
                <p>
                    This student has no subject history yet. Eligibility cannot be
                    computed without it.
                </p>
            </div>`;
        return;
    }

    const rows = records.map((r) => `
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
                        <th>Code</th><th>Descriptive title</th>
                        <th class="num">Units</th><th class="num">Grade</th>
                        <th>Status</th><th>Term</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;
}


/* boot */

/* Advising requests */

/* Scoped strictly to this faculty's own advisees via advisee_assignment
   -- the RLS policy on request_item already enforces this at the
   database level, so a faculty member could never read another
   faculty's advisee requests even if this query were written wrong.
   This select just needs to actually reach the real, already-flagged
   data the engine computed at submission time -- nothing here
   re-evaluates eligibility; request_item.status is already final. */
/* Queue = one summary card per submitted request. Clicking View opens
   the detail sub-view. Students with no requests never appear here. */
async function loadRequestQueue() {
    const queue   = $('req-queue');
    const countEl = $('req-queue-count');
    if (!queue || !supabase || !FACULTY) return;

    const { data: requests, error } = await supabase
        .from('request')
        .select(`
            id, status, requested_term, requested_year, created_at,
            student:student_id (id, first_name, last_name, student_id, year_level),
            request_item (
                id, status,
                subject:subject_id (units)
            )
        `)
        .eq('status', 'submitted')
        .order('created_at', { ascending: true });

    if (error) {
        console.warn('loadRequestQueue failed:', error.message);
        queue.innerHTML = '<div class="empty"><p>Could not load requests.</p></div>';
        return;
    }

    const list = requests ?? [];
    if (countEl) countEl.textContent = list.length ? `${list.length} pending` : '';

    if (!list.length) {
        queue.innerHTML = `
            <div class="empty">
                <i class="fa-solid fa-inbox" aria-hidden="true"></i>
                <h3>Nothing pending</h3>
                <p>No submitted requests from your advisees right now.</p>
            </div>`;
        return;
    }

    queue.innerHTML = list.map(req => {
        const items = req.request_item ?? [];
        const flagged = items.filter(i => i.status === 'flagged').length;
        const ready   = items.length - flagged;
        const units = items.reduce((sum, i) =>
            i.status !== 'flagged' ? sum + Number(i.subject?.units || 0) : sum, 0);

        const termLbl = `${termLabel(req.requested_term)} ${req.requested_year || ''}`.trim();

        return `
        <div class="req-summary" data-view-request="${req.id}">
            <div class="req-summary-main">
                <div class="req-summary-name">
                    <strong>${escapeHtml(fullName(req.student))}</strong>
                    <span class="mono">${escapeHtml(req.student?.student_id ?? '')}</span>
                </div>
                <p class="req-summary-meta">
                    ${items.length} subject${items.length === 1 ? '' : 's'}
                    · ${units} units
                    · ${escapeHtml(termLbl)}
                </p>
                <div class="req-summary-status">
                    <span class="req-badge ok">
                        <i class="fa-solid fa-check" aria-hidden="true"></i>
                        ${ready} ready
                    </span>
                    ${flagged ? `
                        <span class="req-badge warning">
                            <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
                            ${flagged} flagged
                        </span>` : ''}
                </div>
            </div>
            <div class="req-summary-action">
                <span class="req-summary-date">submitted ${new Date(req.created_at).toLocaleDateString()}</span>
                <button class="btn-small req-view-btn" type="button">
                    View
                    <i class="fa-solid fa-chevron-right" aria-hidden="true"></i>
                </button>
            </div>
        </div>`;
    }).join('');
}

/* Detail sub-view. One request, its items in a compact table, and the
   header/footer actions. Loaded fresh each time so a review done on
   another tab is visible immediately. */
async function loadRequestDetail(requestId) {
    const nameEl    = $('req-detail-name');
    const subEl     = $('req-detail-sub');
    const countEl   = $('req-detail-count');
    const actionsEl = $('req-detail-actions');
    const bodyEl    = $('req-detail-body');
    const footEl    = $('req-detail-foot');
    if (!bodyEl) return;

    bodyEl.innerHTML = `
        <div class="empty">
            <i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i>
            <h3>Loading</h3>
        </div>`;
    if (actionsEl) actionsEl.innerHTML = '';
    if (footEl)    footEl.innerHTML = '';

    const { data: req, error } = await supabase
        .from('request')
        .select(`
            id, status, registrar_status, requested_term, requested_year, created_at,
            student:student_id (id, first_name, last_name, student_id, year_level),
            request_item (
                id, status, remarks, offering_id,
                subject:subject_id (code, title, units),
                offering:offering_id (section, schedule_days, start_time, end_time, room)
            )
        `)
        .eq('id', requestId)
        .maybeSingle();

    if (error || !req) {
        console.warn('loadRequestDetail failed:', error?.message);
        bodyEl.innerHTML = `
            <div class="empty">
                <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
                <h3>Could not load that request</h3>
                <p>It may have been reviewed on another device.</p>
            </div>`;
        return;
    }

    const items = req.request_item ?? [];
    const undecided = items.filter(i =>
        i.status !== 'approved' && i.status !== 'rejected');
    const units = items.reduce((sum, i) =>
        (i.status === 'valid' || i.status === 'approved')
            ? sum + Number(i.subject?.units || 0)
            : sum, 0);

    setText('req-detail-name', fullName(req.student) || '—');

    // Build from parts and drop empty ones -- requested_year (or any
    // other part) can be missing, and joining unconditionally with ' · '
    // left a dangling separator ("1st Year ·  · submitted ...") when it
    // was. Filtering keeps the line clean regardless of which parts
    // exist for a given request.
    const subParts = [
        req.student?.student_id || 'No ID',
        ordinal(req.student?.year_level) || 'Year not set',
        [termLabel(req.requested_term), req.requested_year].filter(Boolean).join(' ') || null,
        `submitted ${new Date(req.created_at).toLocaleDateString()}`,
    ].filter(Boolean);
    setText('req-detail-sub', subParts.join(' · '));

    if (countEl) {
        countEl.textContent =
            `${items.length} subject${items.length === 1 ? '' : 's'} · ${units} units`;
    }

    if (actionsEl) {
        if (undecided.length) {
            actionsEl.innerHTML = `
                <button class="btn-small" data-approve-all="${req.id}">
                    <i class="fa-solid fa-check" aria-hidden="true"></i>
                    Approve all
                </button>
                <button class="btn-small" data-reject-all="${req.id}">
                    <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                    Reject all
                </button>`;
        } else {
            actionsEl.innerHTML =
                '<span class="pill ok"><i class="fa-solid fa-check"></i> All reviewed</span>';
        }
    }

    bodyEl.innerHTML = renderRequestTable(items);

    // The adviser's approval is final, so the adviser prints the enrollment
    // form once the plan is approved (see shared/js/requeststatus.js). A plan
    // the Registrar sent back under the old two-step flow stays closed.
    if (footEl) {
        const RS = window.CurriculogicRequestStatus;
        if (RS.finalApproved(req)) {
            footEl.innerHTML = `
                <p class="dim">
                    <i class="fa-solid fa-check" aria-hidden="true"></i>
                    Approved for enrollment. Print the enrollment form for the student to sign.
                </p>
                <button class="btn-small" id="print-enrollment-form" data-print-request="${req.id}">
                    <i class="fa-solid fa-print" aria-hidden="true"></i>
                    Print enrollment form
                </button>`;
            footEl.querySelector('[data-print-request]')?.addEventListener('click', async () => {
                const result = await window.AdvisingSlip.printApprovedRequest(supabase, req.id, {
                    programName: (s) => window.CurriculogicPrograms?.nameOf(s?.program_id, '') ?? '',
                });
                if (!result.ok) showMsg('req-detail-msg', result.error);
            });
        } else if (RS.sentBack(req)) {
            footEl.innerHTML = `
                <p class="dim">
                    <i class="fa-solid fa-arrow-rotate-left" aria-hidden="true"></i>
                    This plan was sent back earlier. It is closed; the student will
                    submit a new one.
                </p>`;
        } else {
            footEl.innerHTML = '';
        }
    }
}

/* The subject table for one request. One row per subject, status on the
   right. Every undecided row shows a small approve/reject pair inline;
   decided rows show their outcome. */
function renderRequestTable(items) {
    const rows = items.map(item => {
        const o = item.offering;
        const time = (o?.start_time && o?.end_time)
            ? `${o.start_time.slice(0, 5)}–${o.end_time.slice(0, 5)}`
            : '';
        const sched = o
            ? [o.section, o.schedule_days, time].filter(Boolean).join(' · ')
            : '—';

        // Every undecided subject can be approved or rejected on its own,
        // not only flagged ones: an adviser may want to reject one subject
        // the engine is happy with (too heavy a load, say) and approve the
        // rest. Approve all / Reject all remain for the common case.
        const itemButtons = `
                <button class="btn-icon btn-xs" data-approve-item="${item.id}" title="Approve this subject">
                    <i class="fa-solid fa-check" aria-hidden="true"></i>
                </button>
                <button class="btn-icon btn-xs" data-reject-item="${item.id}" title="Reject this subject">
                    <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                </button>`;

        let statusHtml;
        if (item.status === 'valid') {
            // Labelled, so the engine's verdict is not mistaken for the
            // approve button sitting next to it.
            statusHtml = `<span class="req-status is-valid" title="${escapeHtml(item.remarks || 'All requirements met.')}">
                <i class="fa-solid fa-check" aria-hidden="true"></i> ready
            </span>${itemButtons}`;
        } else if (item.status === 'flagged') {
            statusHtml = `
                <span class="req-status is-flagged" title="${escapeHtml(item.remarks || '')}">
                    <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> check
                </span>${itemButtons}`;
        } else if (item.status === 'approved') {
            statusHtml = `<span class="req-status is-approved">
                <i class="fa-solid fa-check" aria-hidden="true"></i> approved
            </span>`;
        } else if (item.status === 'rejected') {
            statusHtml = `<span class="req-status is-rejected">
                <i class="fa-solid fa-xmark" aria-hidden="true"></i> rejected
            </span>`;
        } else {
            statusHtml = `<span class="req-status">${escapeHtml(item.status)}</span>`;
        }

        return `
            <tr data-item-id="${item.id}">
                <td class="mono">${escapeHtml(item.subject?.code ?? '')}</td>
                <td>${escapeHtml(item.subject?.title ?? '')}</td>
                <td class="num">${item.subject?.units != null
                    ? Number(item.subject.units).toFixed(1)
                    : '—'}</td>
                <td class="dim">${escapeHtml(sched)}</td>
                <td class="req-status-cell">${statusHtml}</td>
            </tr>`;
    }).join('');

    return `
        <div class="table-wrap">
            <table class="req-table">
                <thead>
                    <tr>
                        <th>Code</th>
                        <th>Descriptive title</th>
                        <th class="num">Units</th>
                        <th>Schedule</th>
                        <th class="req-status-col"></th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;
}

async function reviewRequestItem(itemId, decision, note = null) {
    if (!supabase || !FACULTY) return;

    // request_item itself holds the engine's verdict and is not
    // touched here -- Faculty's decision is a separate fact, recorded
    // as its own request_review row, so the engine's original finding
    // and the human's judgment both stay on the record rather than one
    // overwriting the other.
    const { data: item, error: itemError } = await supabase
        .from('request_item')
        .select('id, request_id')
        .eq('id', itemId)
        .maybeSingle();

    if (itemError || !item) {
        const box = parseHash().param ? 'req-detail-msg' : 'req-msg';
        return showMsg(box, 'Could not find that request item.');
    }

    // A rejection carries a reason the student sees. On approval any
    // prior remarks (a stale flag reason from the engine, say) are
    // cleared -- leaving an old warning attached to an approved item
    // would confuse the next reader.
    const patch = { status: decision === 'approved' ? 'approved' : 'rejected' };
    if (decision === 'rejected' && note) patch.remarks = note;
    if (decision === 'approved')          patch.remarks = null;

    const { error: updateError } = await supabase
        .from('request_item')
        .update(patch)
        .eq('id', itemId);

    // The item decision is the thing being saved. If it did not go
    // through, say so instead of carrying on and telling the student
    // their request had been reviewed.
    if (updateError) {
        console.warn('request_item status update failed:', updateError.message);
        const box = parseHash().param ? 'req-detail-msg' : 'req-msg';
        return showMsg(box, 'Could not save your decision. Please try again.');
    }

    // Once every item has a decision the request itself moves on, the
    // review is recorded once for the whole request, and only then is
    // the student told. Deciding one subject of several is not "finished
    // reviewing", so it produces neither a review row nor a notification.
    await finishReviewIfComplete(item.request_id);

    // Re-render whichever screen the faculty is looking at. The detail
    // view keeps them on the student's plan; the queue view refreshes
    // the list because a completed request drops out of it.
    const { param } = parseHash();
    if (param) {
        showMsg('req-detail-msg', `Subject ${decision}.`, 'success');
        loadRequestDetail(param);
    } else {
        showMsg('req-msg', `Subject ${decision}.`, 'success');
        loadRequestQueue();
    }
    loadRequestCount();
}

// The database refuses a longer rejection reason (db/050). A prompt() box has
// no length limit of its own, so the length is checked here, before saving.
const REMARK_MAX = 500;
const remarkTooLong = (text) => (text && text.length > REMARK_MAX
    ? `That reason is ${text.length} characters. Please keep it under ${REMARK_MAX}.`
    : null);

async function reviewRequestBulk(requestId, decision) {
    if (!supabase || !FACULTY) return;

    let note = null;
    if (decision === 'rejected') {
        note = window.prompt(
            'Reason for rejecting this plan?\n\n' +
            'The student sees this. Be specific: which subject, what requirement.');
        if (note === null) return;
        if (!note.trim()) {
            return showMsg('req-detail-msg', 'A reason is required when rejecting.');
        }
        note = note.trim();
        const tooLong = remarkTooLong(note);
        if (tooLong) return showMsg('req-detail-msg', tooLong);
    }

    const { data: items, error } = await supabase
        .from('request_item')
        .select('id')
        .eq('request_id', requestId)
        .not('status', 'in', '(approved,rejected)');

    if (error || !items?.length) {
        return showMsg('req-detail-msg', 'Nothing to review on that request.');
    }

    // One update for the whole set of undecided items, not one round trip
    // (and one review row) per item.
    const patch = { status: decision };
    if (note) patch.remarks = note;

    const { error: upErr } = await supabase
        .from('request_item')
        .update(patch)
        .in('id', items.map(i => i.id));

    if (upErr) {
        console.warn('bulk item update failed:', upErr.message);
        return showMsg('req-detail-msg', 'Could not save your decisions. Please try again.');
    }
    const ok = items.length;

    await finishReviewIfComplete(requestId);

    const { param } = parseHash();
    if (param) {
        showMsg('req-detail-msg', `${ok} subject${ok === 1 ? '' : 's'} ${decision}.`, 'success');
        loadRequestDetail(param);
    } else {
        showMsg('req-msg', `${ok} subject${ok === 1 ? '' : 's'} ${decision}.`, 'success');
        loadRequestQueue();
    }
    loadRequestCount();
}
/* Counts undecided items on a request. When there are none, flips the
   request's own status based on the aggregate outcome. Called after
   every item decision — cheap, and the request is small. */
async function transitionRequestIfComplete(requestId) {
    const { data: items, error } = await supabase
        .from('request_item')
        .select('status, remarks')
        .eq('request_id', requestId);

    if (error || !items?.length) return null;

    const undecided = items.filter(i =>
        i.status !== 'approved' && i.status !== 'rejected'
    );
    if (undecided.length > 0) return null;

    const allRejected  = items.every(i => i.status === 'rejected');
    const anyRejected  = items.some(i => i.status === 'rejected');

    const next = allRejected  ? 'rejected'
               : anyRejected  ? 'partially_approved'
               :                'approved';

    const { error: upErr } = await supabase
        .from('request')
        .update({ status: next })
        .eq('id', requestId);

    if (upErr) {
        console.warn('request status transition failed:', upErr.message);
        return null;
    }

    // The reasons given for any rejected subjects, for the review record.
    const remarks = [...new Set(items
        .filter(i => i.status === 'rejected' && i.remarks)
        .map(i => i.remarks))].join(' ') || null;

    return { status: next, remarks };
}

/* request_review has no item column: it is one row per request. Write it
   once when the review completes, and update it if this adviser has
   already recorded one (a request sent back and decided again), rather
   than piling up a row per subject. */
async function recordReview(requestId, status, remarks) {
    const { data: existing } = await supabase
        .from('request_review')
        .select('id')
        .eq('request_id', requestId)
        .eq('faculty_id', FACULTY.id)
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle();

    // The joined reasons of a long plan can pass the database's 5000-character
    // limit on a review (db/050); cut rather than fail the review.
    const row = {
        status,
        remarks: remarks == null ? null : String(remarks).slice(0, 5000),
        reviewed_at: new Date().toISOString(),
    };

    const { error } = existing
        ? await supabase.from('request_review').update(row).eq('id', existing.id)
        : await supabase.from('request_review').insert({
              request_id: requestId, faculty_id: FACULTY.id, ...row });

    if (error) console.warn('request_review save failed:', error.message);
}

/* Runs after any item decision. Does nothing until the last undecided
   item has one; then moves the request, records the review, and tells
   the student, once. */
async function finishReviewIfComplete(requestId) {
    const outcome = await transitionRequestIfComplete(requestId);
    if (!outcome) return;

    await recordReview(requestId, outcome.status, outcome.remarks);

    // Fire and forget: a failed notification must not undo a review that
    // already succeeded.
    notifyStudentOfReview(requestId).catch(err =>
        console.warn('notification insert failed:', err.message));
}

/* Notifies the student when their request changes state. Reads the
   student's user_id via the request row, then writes one notification.
   Type is fixed; the message summarises without duplicating the item
   decisions — the student opens the request to see those. */
async function notifyStudentOfReview(requestId) {
    const { data: request, error } = await supabase
        .from('request')
        .select('id, status, student:student_id (user_id, first_name)')
        .eq('id', requestId)
        .maybeSingle();

    if (error || !request?.student?.user_id) return;

    // The adviser's approval is final, so the notice says what it now means.
    const note = {
        approved: {
            title: 'Advising plan approved for enrollment',
            message: 'Your adviser approved your plan. It is now approved for enrollment, and your adviser can print your enrollment form.',
        },
        partially_approved: {
            title: 'Advising plan partly approved',
            message: 'Your adviser approved part of your plan. Open it to see which subjects were approved, and the remarks.',
        },
        rejected: {
            title: 'Advising plan not approved',
            message: 'Your adviser did not approve your plan. Open it to see the remarks, then send a new one.',
        },
    }[request.status] ?? { title: 'Advising plan reviewed', message: 'Your adviser reviewed your plan. Open it to see the decisions.' };

    await supabase.from('notification').insert({
        user_id: request.student.user_id,
        type: 'request_reviewed',
        title: note.title,
        message: note.message,
        related_request_id: request.id,
        is_read: false,
    });
}

async function loadRequestCount() {
    if (PREVIEW) {
        setText('stat-requests', '3', 'stat-value');
        return;
    }
    const { count, error } = await supabase
        .from('request')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'submitted');

    if (error) {
        console.warn('request count failed:', error.message);
        setText('stat-requests', '—', 'stat-value muted');
        return;
    }
    setText('stat-requests', String(count ?? 0), 'stat-value');
}

/* One delegated handler on the whole requests section. Covers the queue
   (View cards) and the detail sub-view (per-row actions, bulk actions,
   print), since both live inside #view-requests. */
$('view-requests')?.addEventListener('click', (e) => {
    // View — opens the detail sub-view.
    const viewCard = e.target.closest('[data-view-request]');
    if (viewCard) {
        window.location.hash = `#requests/${viewCard.dataset.viewRequest}`;
        return;
    }

    const approve = e.target.closest('[data-approve-item]');
    if (approve) return reviewRequestItem(Number(approve.dataset.approveItem), 'approved');

    const reject = e.target.closest('[data-reject-item]');
    if (reject) {
        const reason = window.prompt('Reason for rejecting this subject?');
        if (reason === null) return;
        const tooLong = remarkTooLong(reason.trim());
        if (tooLong) return showMsg(parseHash().param ? 'req-detail-msg' : 'req-msg', tooLong);
        return reviewRequestItem(
            Number(reject.dataset.rejectItem), 'rejected', reason.trim() || null);
    }

    const approveAll = e.target.closest('[data-approve-all]');
    if (approveAll) return reviewRequestBulk(Number(approveAll.dataset.approveAll), 'approved');

    const rejectAll = e.target.closest('[data-reject-all]');
    if (rejectAll) return reviewRequestBulk(Number(rejectAll.dataset.rejectAll), 'rejected');

});


(async function init() {

    if (previewRequested()) {
        PREVIEW = true;
        FACULTY = PREVIEW_FACULTY;
        document.body.classList.add('is-preview');
        renderProfile(FACULTY, PREVIEW_FACULTY.email);
        renderNotice(FACULTY);
        await loadStudents();
        loadRequestCount();
        route();
        return;
    }

    if (!supabase) {
        setText('greeting', 'Cannot reach the service');
        console.error('facultydashboard.js: Supabase client not created. Is config.js loaded?');
        return;
    }

    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
        window.location.href = LOGIN_PAGE;
        return;
    }

    AUTH_UID = session.user.id;

    const { data: staff, error } = await supabase
        .from('faculty_staff')
        .select('id, user_id, first_name, last_name, employee_id, email, department, program_id, is_approved, must_change_password')
        .eq('user_id', AUTH_UID)
        .maybeSingle();

    if (error) {
        // A failed lookup is not proof this is the wrong kind of account;
        // do not bounce a real faculty member because the network blinked.
        console.warn('faculty load failed:', error.message);
        setText('greeting', 'Could not load your account');
        return;
    }

    // Unapproved staff are signed out.
    if (staff && staff.is_approved === false) {
        await supabase.auth.signOut();
        window.location.href = LOGIN_PAGE;
        return;
    }

    // A signed-in user with no faculty row (a student who edited the URL)
    // has no business here. Send them back rather than showing an empty
    // shell. Not signed out: they are validly signed in, just elsewhere.
    if (!staff) {
        window.location.href = LOGIN_PAGE;
        return;
    }

    FACULTY = staff;
    renderProfile(staff, session.user.email);
    renderNotice(staff);
    window.CurriculogicForcePassword?.run(supabase, 'faculty');

    // Looked up, not typed: each student's line names their own degree.
    await window.CurriculogicPrograms?.load(supabase);
    paintProgramChip();

    await loadStudents();
    loadRequestCount();
    route();
})();

})();