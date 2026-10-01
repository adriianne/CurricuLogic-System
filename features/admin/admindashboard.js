// admindashboard.js
// System Administrator: create and manage staff accounts.
//
// This module provisions pre-approved accounts for faculty, registrar,
// and department staff. It bypasses the normal registration queue —
// accounts created here are immediately active.
//
// Requires config.js to be loaded first.

(function () {
'use strict';

const { SUPABASE_URL, SUPABASE_ANON_KEY, authStorageKey } = window.CURRICULOGIC ?? {};

// Bucketed storage key (see config.js) -- keeps an admin session in this
// tab from colliding with a different role signed in in another tab.
const supabase = (window.supabase && SUPABASE_URL && SUPABASE_ANON_KEY)
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { storageKey: authStorageKey?.(['system_administrator']) },
    })
    : null;

const $ = (id) => document.getElementById(id);

const LOGIN_PAGE = '../auth/html/adminloginpage.html';

let AUTH_UID = null;
let ADMIN    = null;
let STAFF    = [];
let PROGRAMS = [];                 // [{ id, code, name }]
let PROGRAMS_READY = false;        // false until the program table loads
let EDITING_PROGRAM_FOR = null;    // { staffId, role } whose programme is open for editing
let STUDENTS = [];
let PREVIEW  = false;


/* ---------- preview mode (development only) ---------- */

const PREVIEW_HOSTS = ['localhost', '127.0.0.1', ''];

const PREVIEW_ADMIN = {
    id: 'admin1',
    first_name: 'System',
    last_name: 'Admin',
    employee_id: 'EMP-ADMIN001',
    username: 'admin',
    email: 'admin@uc.edu.ph',
    is_approved: true,
};

const PREVIEW_STAFF = [
    { id: 'f1', role: 'faculty',    first_name: 'Rhea',      last_name: 'Lumactod',  email: 'rhea.lumactod@uc.edu.ph', employee_id: 'EMP-00871',  is_approved: true },
    { id: 'r1', role: 'registrar',  first_name: 'Registrar', last_name: 'Staff',     email: 'registrar@uc.edu.ph',    employee_id: 'EMP-REG01',  is_approved: true },
    { id: 'd1', role: 'department', first_name: 'Dept',      last_name: 'Staff',     email: 'dept@uc.edu.ph',         employee_id: 'EMP-DEPT01', is_approved: true },
];

const PREVIEW_STUDENTS = [
    { id: 's1', first_name: 'Althea', last_name: 'Villanueva', student_id: '2401187', email: 'althea1@gmail.com',   is_approved: true,  approval_status: 'approved' },
    { id: 's2', first_name: 'Marco',  last_name: 'Deveza',     student_id: '2401203', email: 'marco.deveza@uc.edu.ph', is_approved: false, approval_status: 'pending' },
    { id: 's3', first_name: 'Janine', last_name: 'Abella',     student_id: null,       email: 'janine.abella@uc.edu.ph', is_approved: false, approval_status: 'pending' },
];

function previewRequested() {
    if (!PREVIEW_HOSTS.includes(window.location.hostname)) return false;
    return new URLSearchParams(window.location.search).has('preview');
}


/* ---------- view routing ---------- */

const VIEWS = {
    dashboard: 'Dashboard',
    accounts:  'Create account',
    bulk:      'Create account',   // the same page as #accounts, in its file mode
    staff:     'Staff management',
    programs:  'Programs',
    students:  'Students',
    profile:   'Profile',
};

const shell = $('shell');

function parseHash() {
    const hash = window.location.hash.replace('#', '');
    return hash in VIEWS ? hash : 'dashboard';
}

function showView(name) {
    Object.keys(VIEWS).forEach((key) => {
        const section = $(`view-${key}`);
        if (section) section.hidden = key !== name;
    });

    document.querySelectorAll('.side-nav a').forEach((link) => {
        // Bulk upload is the second mode of Create account, not a page of its own.
        const owner = name === 'bulk' ? 'accounts' : name;
        link.classList.toggle('active', link.dataset.view === owner);
    });

    const title = $('topbar-title');
    if (title) title.textContent = VIEWS[name];

    shell?.classList.remove('nav-open');

    if (name === 'staff')    loadStaff();
    if (name === 'programs') loadPrograms();
    if (name === 'students') loadStudents();
    if (name === 'bulk')     initBulkUpload();
}

function route() {
    showView(parseHash());
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

function fullName(p) {
    return [p?.first_name, p?.last_name].filter(Boolean).join(' ');
}

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

function showMsg(boxId, text, type = 'error') {
    const box = $(boxId);
    if (!box) return;
    box.textContent = text;
    box.className = 'msg ' + type;
}

function daysAgo(iso) {
    if (!iso) return '';
    const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
    if (d <= 0) return 'today';
    if (d === 1) return 'yesterday';
    return `${d} days ago`;
}

function normalizeHeader(h) {
    return String(h || '').trim().toLowerCase().replace(/\s+/g, '_');
}


/* ---------- password visibility ---------- */

document.querySelectorAll('.toggle-pw').forEach((btn) => {
    btn.addEventListener('click', () => {
        const input = $(btn.dataset.target);
        if (!input) return;
        const hidden = input.type === 'password';
        input.type = hidden ? 'text' : 'password';
        const icon = btn.querySelector('i');
        if (icon) icon.className = hidden ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye';
        btn.setAttribute('aria-label', hidden ? 'Hide password' : 'Show password');
    });
});


/* ---------- profile ---------- */

function renderProfile(admin, authEmail) {
    const full  = fullName(admin);
    const email = admin?.email || authEmail || '—';

    $('avatar').textContent    = initials(admin?.first_name, admin?.last_name, email);
    $('user-name').textContent = full || admin?.username || 'Admin';
    $('user-sub').textContent  = admin?.employee_id || 'System Administrator';

    $('greeting').textContent = admin?.first_name
        ? `Welcome back, ${admin.first_name}`
        : 'Welcome back';

    setText('d-name',  full || '—');
    setText('d-eid',   admin?.employee_id || '—', 'mono');
    setText('d-username', admin?.username || '—', 'mono');
    setText('d-email', email, 'mono');
}

function renderNotice(admin) {
    const box = $('status-notice');
    if (!box) return;
    box.innerHTML = admin ? '' : `
        <div class="notice pending">
            <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
            <div>
                <strong>No admin record found</strong>
                Your sign-in worked, but no admin record is linked to this account.
                Please contact IT support.
            </div>
        </div>`;
}


/* ---------- data loading ---------- */

async function loadStaff(force = false) {
    if (PREVIEW) {
        STAFF = [...PREVIEW_STAFF];
        PROGRAMS = [{ id: 1, code: 'BSIT', name: 'BS Information Technology', college: 'College of Computer Studies' },
                    { id: 2, code: 'BSCS', name: 'BS Computer Science', college: 'College of Computer Studies' }];
        PROGRAMS_READY = true;
        renderStats();
        renderStaff();
        return;
    }

    if (!supabase) return;

    // Each staff table carries its own program_id since db/030 -- no more
    // separate join-table query or per-faculty Set of programs. One
    // programme per account, same shape as university_student.
    const [faculty, registrar, department, programs] = await Promise.all([
        supabase.from('faculty_staff')
            .select('id, first_name, last_name, email, employee_id, department, program_id, is_approved, created_at'),
        supabase.from('registrar_staff')
            .select('id, first_name, last_name, email, employee_id, department, program_id, is_approved, created_at'),
        supabase.from('department_staff')
            .select('id, first_name, last_name, email, employee_id, department, program_id, is_approved, created_at'),
        supabase.from('program').select('id, code, name, college, max_units, max_units_graduating, target_units').order('code'),
    ]);

    if (faculty.error)  console.warn('faculty load failed:', faculty.error.message);
    if (registrar.error) console.warn('registrar load failed:', registrar.error.message);
    if (department.error) console.warn('department load failed:', department.error.message);

    PROGRAMS_READY = !programs.error;
    if (!PROGRAMS_READY) {
        console.warn('programs unavailable:', programs.error.message);
    }
    PROGRAMS = programs.data ?? [];

    STAFF = [
        ...(faculty.data ?? []).map(s => ({ ...s, role: 'faculty' })),
        ...(registrar.data ?? []).map(s => ({ ...s, role: 'registrar' })),
        ...(department.data ?? []).map(s => ({ ...s, role: 'department' })),
    ];

    refreshColleges();
    renderProgramPicker();
    renderStats();
    renderStaff();
}

async function loadStudents(force = false) {
    if (PREVIEW) {
        STUDENTS = [...PREVIEW_STUDENTS];
        renderStudentStats();
        renderStudents();
        return;
    }

    if (!supabase) return;

    const { data, error } = await supabase
        .from('university_student')
        .select('id, first_name, last_name, student_id, email, is_approved, approval_status, created_at')
        .order('created_at', { ascending: false });

    if (error) {
        console.warn('student load failed:', error.message);
        return;
    }

    STUDENTS = data ?? [];
    renderStudentStats();
    renderStudents();
}


/* ---------- dashboard stats ---------- */

function renderStats() {
    const faculty    = STAFF.filter(s => s.role === 'faculty').length;
    const registrar  = STAFF.filter(s => s.role === 'registrar').length;
    const department = STAFF.filter(s => s.role === 'department').length;

    setText('stat-faculty',    String(faculty),    'stat-value');
    setText('stat-registrar',  String(registrar),  'stat-value');
    setText('stat-department', String(department), 'stat-value');
    setText('stat-students',   String(STUDENTS.length), 'stat-value');
}

function renderStudentStats() {
    setText('stat-students', String(STUDENTS.length), 'stat-value');
}


/* ---------- system status ---------- */

function renderSystemStatus() {
    const body = $('system-body');
    const note = $('system-note');
    if (!body) return;

    if (note) note.textContent = 'All systems operational';

    body.innerHTML = `
        <div class="table-wrap">
            <table class="data-table">
                <thead>
                    <tr><th>Component</th><th>Status</th><th>Details</th></tr>
                </thead>
                <tbody>
                    <tr>
                        <td><strong>Supabase Auth</strong></td>
                        <td><span class="pill ok"><i class="fa-solid fa-check"></i> Connected</span></td>
                        <td class="dim">User authentication active</td>
                    </tr>
                    <tr>
                        <td><strong>Database</strong></td>
                        <td><span class="pill ok"><i class="fa-solid fa-check"></i> Connected</span></td>
                        <td class="dim">PostgreSQL accessible</td>
                    </tr>
                    <tr>
                        <td><strong>Staff accounts</strong></td>
                        <td><span class="pill ok"><i class="fa-solid fa-check"></i> ${STAFF.length} configured</span></td>
                        <td class="dim">Faculty, registrar, department</td>
                    </tr>
                    <tr>
                        <td><strong>Student accounts</strong></td>
                        <td><span class="pill ok"><i class="fa-solid fa-check"></i> ${STUDENTS.length} registered</span></td>
                        <td class="dim">Awaiting or approved</td>
                    </tr>
                </tbody>
            </table>
        </div>`;
}


/* ---------- staff listing ---------- */

function filteredStaff() {
    const term   = ($('staff-search')?.value || '').trim().toLowerCase();
    const filter = $('staff-filter')?.value || 'all';

    return STAFF.filter((s) => {
        if (filter !== 'all' && s.role !== filter) return false;
        if (!term) return true;
        return [s.first_name, s.last_name, s.email, s.employee_id]
            .filter(Boolean).join(' ').toLowerCase().includes(term);
    });
}

const ROLE_PILLS = {
    faculty:    '<span class="pill info">Faculty</span>',
    registrar:  '<span class="pill ok">Registrar</span>',
    department: '<span class="pill waiting">Department</span>',
};

// Where each staff role's program_id (db/030) actually lives, and the
// per-programme cap _provision_account enforces for new accounts of
// that role. Students have no entry -- they are never capped.
const ROLE_TABLE = {
    faculty:    'faculty_staff',
    registrar:  'registrar_staff',
    department: 'department_staff',
};
const ROLE_LIMIT = { faculty: 10, registrar: 2, department: 1 };

function renderStaff() {
    const body  = $('staff-body');
    const count = $('staff-count');
    if (!body) return;

    const list = filteredStaff();

    if (count) {
        count.textContent = STAFF.length
            ? `${list.length} of ${STAFF.length}`
            : '';
    }

    if (STAFF.length === 0) {
        body.innerHTML = `
            <div class="empty">
                <i class="fa-solid fa-users-slash" aria-hidden="true"></i>
                <h3>No staff accounts yet</h3>
                <p>Create the first staff account using the <a href="#accounts" class="link-quiet">Create account</a> tab.</p>
            </div>`;
        return;
    }

    if (list.length === 0) {
        body.innerHTML = `
            <div class="empty">
                <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
                <h3>No matches</h3>
                <p>No staff account matches that search or filter.</p>
            </div>`;
        return;
    }

    body.innerHTML = `
        <div class="table-wrap">
            <table class="data-table">
                <thead>
                    <tr>
                        <th>Employee ID</th>
                        <th>Name</th>
                        <th>Email</th>
                        <th>Role</th>
                        <th>Programme</th>
                        <th>Status</th>
                        <th>Created</th>
                    </tr>
                </thead>
                <tbody>
                    ${list.map(s => `
                        <tr>
                            <td class="mono">${escapeHtml(s.employee_id || '—')}</td>
                            <td><strong>${escapeHtml(fullName(s) || '—')}</strong></td>
                            <td class="dim">${escapeHtml(s.email || '—')}</td>
                            <td>${ROLE_PILLS[s.role] || '—'}</td>
                            <td>${staffProgramCell(s)}</td>
                            <td>${s.is_approved
                                ? '<span class="pill ok">Active</span>'
                                : '<span class="pill waiting">Pending</span>'}</td>
                            <td class="dim">${daysAgo(s.created_at)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>`;
}

/* Which programme a staff member belongs to (db/030 -- one per account,
   same shape as a student's). For faculty specifically, this is also
   which students' advising requests reach them for review
   (is_adviser_of_student compares program_id directly). */
function staffProgramCell(s) {
    if (!PROGRAMS_READY) {
        return '<span class="dim" title="Programs could not be loaded">Not set up</span>';
    }

    const editing = EDITING_PROGRAM_FOR?.staffId === s.id && EDITING_PROGRAM_FOR?.role === s.role;

    if (editing) {
        return `
            <div class="prog-edit" data-staff="${escapeHtml(s.id)}" data-role="${escapeHtml(s.role)}">
                <select class="prog-select">
                    ${PROGRAMS.map(p => `
                        <option value="${p.id}" ${p.id === s.program_id ? 'selected' : ''}>${escapeHtml(p.code)}</option>
                    `).join('')}
                </select>
                <span class="prog-actions">
                    <button type="button" class="btn-link" data-program-save="${escapeHtml(s.id)}" data-role="${escapeHtml(s.role)}">Save</button>
                    <button type="button" class="btn-link" data-program-cancel>Cancel</button>
                </span>
            </div>`;
    }

    const mine = PROGRAMS.find(p => p.id === s.program_id);

    return `
        ${mine
            ? `<span class="pill info" title="${escapeHtml(mine.name)}">${escapeHtml(mine.code)}</span>`
            : '<span class="pill waiting" title="No programme assigned">None</span>'}
        <button type="button" class="btn-link" data-program-edit="${escapeHtml(s.id)}" data-role="${escapeHtml(s.role)}">Edit</button>`;
}

async function saveStaffProgram(staffId, role, newProgramId) {
    const staff = STAFF.find(s => s.id === staffId && s.role === role);
    if (!staff) { EDITING_PROGRAM_FOR = null; return renderStaff(); }

    if (newProgramId === staff.program_id) { EDITING_PROGRAM_FOR = null; return renderStaff(); }

    const done = () => {
        staff.program_id = newProgramId;
        EDITING_PROGRAM_FOR = null;
        renderStaff();
    };

    if (PREVIEW || !supabase) {
        done();
        return showMsg('staff-msg', 'Programme updated (preview only, not saved).', 'success');
    }

    // Moving a staff member into a programme that is already at its cap
    // is exactly as unwanted as creating a new account past it -- check
    // the same limit here, against everyone else already in that
    // programme (excluding this account's own current row).
    const table = ROLE_TABLE[role];
    const limit = ROLE_LIMIT[role];
    if (table && limit) {
        const { count, error: countError } = await supabase
            .from(table)
            .select('id', { count: 'exact', head: true })
            .eq('program_id', newProgramId)
            .neq('id', staffId);
        if (countError) {
            console.warn('program count check failed:', countError.message);
            return showMsg('staff-msg', 'Could not check the programme cap. Please try again.');
        }
        if ((count ?? 0) >= limit) {
            const progCode = PROGRAMS.find(p => p.id === newProgramId)?.code ?? 'This programme';
            return showMsg('staff-msg',
                `${progCode} already has the maximum of ${limit} ${role} account${limit === 1 ? '' : 's'}.`);
        }
    }

    const { error } = await supabase.from(table)
        .update({ program_id: newProgramId }).eq('id', staffId);
    if (error) {
        console.warn('staff program update failed:', error.message);
        return showMsg('staff-msg', 'Could not update the programme. Please try again.');
    }

    done();
    showMsg('staff-msg', 'Programme updated.', 'success');
}

$('staff-body')?.addEventListener('click', (e) => {
    const edit = e.target.closest('[data-program-edit]');
    if (edit) {
        EDITING_PROGRAM_FOR = { staffId: edit.dataset.programEdit, role: edit.dataset.role };
        return renderStaff();
    }

    if (e.target.closest('[data-program-cancel]')) { EDITING_PROGRAM_FOR = null; return renderStaff(); }

    const save = e.target.closest('[data-program-save]');
    if (save) {
        const box = save.closest('.prog-edit');
        const chosen = Number(box.querySelector('.prog-select')?.value);
        save.disabled = true;
        return saveStaffProgram(save.dataset.programSave, save.dataset.role, chosen);
    }
});

$('staff-search')?.addEventListener('input', renderStaff);
$('staff-filter')?.addEventListener('change', renderStaff);


/* ---------- students listing ---------- */

function filteredStudents() {
    const term   = ($('student-search')?.value || '').trim().toLowerCase();
    const filter = $('student-filter')?.value || 'all';

    return STUDENTS.filter((s) => {
        const status = s.approval_status || (s.is_approved ? 'approved' : 'pending');
        if (filter !== 'all' && status !== filter) return false;
        if (!term) return true;
        return [s.first_name, s.last_name, s.student_id, s.email]
            .filter(Boolean).join(' ').toLowerCase().includes(term);
    });
}

function renderStudents() {
    const body  = $('student-body');
    const count = $('student-count');
    if (!body) return;

    const list = filteredStudents();

    if (count) {
        count.textContent = STUDENTS.length
            ? `${list.length} of ${STUDENTS.length}`
            : '';
    }

    if (STUDENTS.length === 0) {
        body.innerHTML = `
            <div class="empty">
                <i class="fa-solid fa-user-graduate" aria-hidden="true"></i>
                <h3>No students yet</h3>
                <p>Student accounts will appear here once they register.</p>
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

    body.innerHTML = `
        <div class="table-wrap">
            <table class="data-table">
                <thead>
                    <tr>
                        <th>Student ID</th>
                        <th>Name</th>
                        <th>Email</th>
                        <th>Status</th>
                        <th>Requested</th>
                    </tr>
                </thead>
                <tbody>
                    ${list.map(s => {
                        const status = s.approval_status || (s.is_approved ? 'approved' : 'pending');
                        const pill = status === 'approved'
                            ? '<span class="pill ok">Approved</span>'
                            : status === 'declined'
                                ? '<span class="pill bad">Declined</span>'
                                : '<span class="pill waiting">Pending</span>';
                        return `
                        <tr>
                            <td class="mono">${escapeHtml(s.student_id || '—')}</td>
                            <td><strong>${escapeHtml(fullName(s) || '—')}</strong></td>
                            <td class="dim">${escapeHtml(s.email || '—')}</td>
                            <td>${pill}</td>
                            <td class="dim">${daysAgo(s.created_at)}</td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>
        </div>`;
}

$('student-search')?.addEventListener('input', renderStudents);
$('student-filter')?.addEventListener('change', renderStudents);


/* ---------- create single account ---------- */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function createAccount() {
    const boxId = 'create-msg';
    showMsg(boxId, '');

    const first      = $('a-first-name').value.trim();
    const last       = $('a-last-name').value.trim();
    const email      = $('a-email').value.trim();
    const employeeId = $('a-employee-id').value.trim();
    const studentId  = $('a-student-id')?.value.trim() ?? '';
    const yearLevel  = $('a-year-level')?.value ?? '';
    const role       = $('a-role').value;
    const password   = $('a-password').value;
    const confirm    = $('a-confirm').value;

    // Validation. Employee ID is only meaningful for staff roles; a
    // student has no employee record at all, so requiring it here was
    // what made the single-account form unable to create a student even
    // after "University Student" is selectable in the dropdown.
    if (!first)     return showMsg(boxId, 'Enter a first name.');
    if (!last)      return showMsg(boxId, 'Enter a last name.');
    if (!email)     return showMsg(boxId, 'Enter an email address.');
    if (!EMAIL_RE.test(email)) return showMsg(boxId, 'Enter a valid email address.');

    if (role === 'student') {
        if (!studentId) return showMsg(boxId, 'Enter a student ID.');
    } else {
        if (!employeeId) return showMsg(boxId, 'Enter an employee ID.');
    }

    // Every role in this form belongs to exactly one programme (db/030) --
    // a student's decides their curriculum, and a staff role's is what
    // that programme's per-role account cap is checked against. Every
    // role here needs one chosen, never assumed.
    const pc = resolveProgramCode($('a-program')?.value ?? '');
    if (pc.error) return showMsg(boxId, pc.error);
    const programCode = pc.value;

    // Free-text label only now (db/030 retired the department-text-to-
    // college matching that used to link faculty to programmes) -- still
    // asked for because it is a useful human-readable note on the account.
    const dep = resolveDepartment(role, $('a-department')?.value.trim() ?? '');
    if (dep.error) return showMsg(boxId, dep.error);
    const department = dep.value;

    if (!password || password.length < 8) return showMsg(boxId, 'Password must be at least 8 characters.');
    if (password !== confirm) return showMsg(boxId, 'The two passwords do not match.');

    const btn = $('create-account');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> Creating…';

    try {
        if (PREVIEW) {
            STAFF.push({
                id: Date.now().toString(),
                role,
                first_name: first,
                last_name: last,
                email,
                employee_id: employeeId,
                program_id: PROGRAMS.find(p => p.code === programCode)?.id ?? null,
                is_approved: true,
                created_at: new Date().toISOString(),
            });
            renderStats();
            renderStaff();
            clearCreateForm();
            showMsg(boxId, `${first} ${last} created (preview only — not saved).`, 'success');
            return;
        }

        // create_user_account is the generic RPC -- it already accepts a
        // role plus both employee/student identifiers as optional, which is
        // what the bulk-upload path uses. create_staff_account was staff-only
        // and required an employee ID unconditionally, which is why this form
        // could never create a student even once the role were selectable.
        const declaredPath = $('a-declared-path')?.value ?? 'existing';

        const params = {
            p_first_name: first,
            p_last_name: last,
            p_email: email,
            p_password: password,
            p_role: role,
            p_employee_id: role === 'student' ? null : employeeId,
            p_student_id: role === 'student' ? studentId : null,
            p_department: department,
            p_year_level: role === 'student' ? yearLevel : null,
            p_declared_path: role === 'student' ? declaredPath : 'existing',
        };
        // Every role sends one now (db/030) -- only skipped when resolution
        // above came back empty, in which case the database keeps its own
        // default rather than being sent an explicit blank.
        if (programCode) params.p_program_code = programCode;

        const { data, error } = await supabase.rpc('create_user_account', params);

        if (error) {
            console.error('create account failed:', error.message);
            return showMsg(boxId, 'Could not create account. ' + error.message);
        }

        clearCreateForm();
        showMsg(boxId, `${first} ${last} account created. They can now sign in.`, 'success');
        await loadStaff(true);

    } catch (err) {
        console.error(err);
        showMsg(boxId, 'Something went wrong. Please try again.');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-user-plus" aria-hidden="true"></i><span>Create account</span>';
    }
}

function clearCreateForm() {
    ['a-first-name', 'a-last-name', 'a-email', 'a-employee-id', 'a-student-id', 'a-department', 'a-password', 'a-confirm']
        .forEach(id => { const el = $(id); if (el) el.value = ''; });

        const dp = $('a-declared-path');
        if (dp) dp.value = 'new';

    $('a-role').value = 'faculty';
    updateRoleFields();
    $('a-first-name').focus();
}

// Show Employee ID for staff roles, Student ID + Year level for a student.
// The two field sets are mutually exclusive, not just cosmetically --
// createAccount() sends only the pair matching the selected role, and a
// hidden field the user never touched should not be read as if it were.
//
// Programme is shown for every role in this dropdown now (db/030) --
// faculty, registrar and department staff each belong to exactly one
// programme too, the same as a student, and that link is what a
// programme's per-role account cap (createAccount() below) is checked
// against.
function updateRoleFields() {
    const isStudent = $('a-role').value === 'student';
    $('a-employee-id-wrap').hidden     = isStudent;
    $('a-student-id-wrap').hidden      = !isStudent;
    $('a-year-level-wrap').hidden      = !isStudent;
    $('a-declared-path-wrap').hidden   = !isStudent;
    $('a-program-wrap').hidden         = false;
    // A student's department is not used; their programme is what matters.
    $('a-department-wrap').hidden      = isStudent;
}

/* The programme code to send for a student, from what was typed or picked.
   With one programme it is that one; with several, one must be named, so a
   student is never filed under whichever happens to come first. When the
   list could not be loaded, nothing is sent and the database default holds. */
function resolveProgramCode(typed) {
    const value = String(typed ?? '').trim();
    if (PROGRAMS.length === 0) return { value: '' };

    const codes = PROGRAMS.map(p => p.code).join(', ');
    if (value) {
        const match = PROGRAMS.find(p => p.code.toLowerCase() === value.toLowerCase());
        return match
            ? { value: match.code }
            : { error: `Unknown programme "${value}". Known programmes: ${codes}.` };
    }
    if (PROGRAMS.length === 1) return { value: PROGRAMS[0].code };
    return { error: `Choose a programme (${codes}).` };
}

/* The department to send for an account -- a free-text label only since
   db/030 (staff are linked to their programme through program_id, chosen
   explicitly via resolveProgramCode() above, not by matching this text to
   a college). A blank is filled in when there is exactly one college it
   could mean; the Registrar is university-wide. */
function resolveDepartment(role, typed) {
    const value = String(typed ?? '').trim();
    if (value) return { value };
    if (role === 'registrar') return { value: 'Office of the Registrar' };
    if (role === 'student') return { value: knownColleges()[0] ?? '' };

    const colleges = knownColleges();
    if (colleges.length === 1) return { value: colleges[0] };
    return { error: 'Enter the department or college. Faculty are linked to programmes through it.' };
}

$('a-role')?.addEventListener('change', updateRoleFields);
updateRoleFields();

$('create-account')?.addEventListener('click', createAccount);

// Enter key submits
document.querySelectorAll('#view-accounts input').forEach((input) => {
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') createAccount();
    });
});


/* ============================================================
   BULK ACCOUNT CREATION (ALL ROLES)
   ============================================================ */

const BULK_HEADERS = [
    'first_name', 'last_name', 'email', 'role',
    'employee_id', 'student_id', 'program_code', 'department', 'year_level', 'password', 'username'
];

const VALID_ROLES = ['student', 'faculty', 'registrar', 'department', 'admin'];

let PENDING_BULK = [];
let PENDING_BULK_BAD = [];       // rejected rows from the last validation, kept so
                                  // re-filtering (role/program) doesn't lose them
let PENDING_BULK_FILE = '';
let PENDING_BULK_RAW = [];       // the file's rows as read, so choosing another
                                 // programme can re-check them without a re-upload
let BULK_HISTORY = [];
let bulkInitialized = false;

function initBulkUpload() {
    if (bulkInitialized) return;
    bulkInitialized = true;

    // Toggle upload pane
    $('toggle-bulk-upload')?.addEventListener('click', () => {
        const pane = $('bulk-upload-pane');
        pane.hidden = !pane.hidden;
        $('toggle-bulk-upload').textContent = pane.hidden ? 'Show' : 'Hide';
    });

    // Template download
    $('bulk-template')?.addEventListener('click', downloadBulkTemplate);

    // File input
    $('bulk-file')?.addEventListener('change', handleBulkFile);

    // Role and programme filters
    const rerenderOnFilterChange = () => {
        if (PENDING_BULK.length > 0 || PENDING_BULK_BAD.length > 0) {
            renderBulkPreview(PENDING_BULK, PENDING_BULK_BAD, PENDING_BULK_FILE);
        }
    };
    // Role and programme decide which rows are acceptable, not only which
    // are shown, so choosing another one checks the loaded file again.
    const recheck = () => {
        if (PENDING_BULK_RAW.length > 0) validateBulkRows(PENDING_BULK_RAW, PENDING_BULK_FILE);
    };
    $('bulk-role-filter')?.addEventListener('change', recheck);
    $('bulk-program-filter')?.addEventListener('change', recheck);

    // Programme options mirror the Role dropdown: every programme that
    // currently exists, available as soon as the page loads -- not only
    // once a file has been parsed. init() awaits loadStaff() (which
    // populates PROGRAMS) before calling this, so the list is ready here.
    refreshBulkProgramFilter();

    // Load history
    loadBulkHistory();
}

function downloadBulkTemplate() {
    // NOTE: no sample "admin" row here on purpose. Admin accounts CAN be
    // created through this same bulk path (create_user_account ->
    // _provision_account already refuses to run for anyone who isn't
    // is_system_admin(), and every provision is written to audit_log
    // with 'via': 'ADMIN_BULK') — but a template that ships an admin
    // row as boilerplate invites someone to bulk-upload a real batch of
    // students/faculty without noticing they left a sample admin row
    // in the sheet. commitBulk() below adds a typed confirmation gate
    // specifically for admin rows so that can't happen silently.
    // Sample values come from the programmes that exist, not from a literal
    // that is only right for one of them. program_code is required for
    // every role below except admin (db/030 -- each row's programme is
    // what that role's per-programme account cap is checked against).
    // The programme chosen above the upload is the one the sample rows
    // carry; with "All programmes" it is the first that exists.
    const selected = $('bulk-program-filter')?.value || 'all';
    const sample = CurriculogicBulkAccounts.templateProgram(PROGRAMS, selected);
    const sampleProgram = sample?.code ?? '';
    const sampleCollege = sample?.college ?? knownColleges()[0] ?? '';
    // The Role chosen above the upload keeps only that role's sample row.
    // An admin sample appears only when admin is chosen on purpose.
    const selectedRole = $('bulk-role-filter')?.value || 'all';
    const SAMPLE_ROWS = {
        faculty:    { first_name: 'Juan', last_name: 'Dela Cruz', email: 'juan.delacruz@uc.edu.ph', role: 'faculty', employee_id: 'EMP-00101', student_id: '', program_code: sampleProgram, department: sampleCollege, year_level: '', password: '', username: '' },
        registrar:  { first_name: 'Maria', last_name: 'Santos', email: 'maria.santos@uc.edu.ph', role: 'registrar', employee_id: 'EMP-00102', student_id: '', program_code: sampleProgram, department: 'Office of the Registrar', year_level: '', password: '', username: '' },
        department: { first_name: 'Pedro', last_name: 'Reyes', email: 'pedro.reyes@uc.edu.ph', role: 'department', employee_id: 'EMP-00103', student_id: '', program_code: sampleProgram, department: sampleCollege, year_level: '', password: '', username: '' },
        student:    { first_name: 'Althea', last_name: 'Villanueva', email: 'althea.villanueva@uc.edu.ph', role: 'student', employee_id: '', student_id: '2401187', program_code: sampleProgram, department: '', year_level: '2', password: '', username: '' },
        // An admin belongs to no programme, whatever is chosen above.
        admin:      { first_name: 'Alex', last_name: 'Rivera', email: 'alex.rivera@uc.edu.ph', role: 'admin', employee_id: 'EMP-00001', student_id: '', program_code: '', department: '', year_level: '', password: '', username: 'alex.rivera' },
    };
    const rows = CurriculogicBulkAccounts.sampleRoles(selectedRole).map(role => SAMPLE_ROWS[role]);

    // Create worksheet with proper headers
    const ws = XLSX.utils.json_to_sheet(rows, { header: BULK_HEADERS });
    
    // Set column widths for readability
    ws['!cols'] = [
        { wch: 15 },  // first_name
        { wch: 20 },  // last_name
        { wch: 30 },  // email
        { wch: 12 },  // role
        { wch: 15 },  // employee_id
        { wch: 15 },  // student_id
        { wch: 14 },  // program_code
        { wch: 30 },  // department
        { wch: 12 },  // year_level
        { wch: 15 },  // password
        { wch: 15 },  // username
    ];

    // Create workbook
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Accounts');
    
    // Download as Excel file
    XLSX.writeFile(wb, CurriculogicBulkAccounts.templateFileName(selected, selectedRole));
}

async function handleBulkFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    showMsg('bulk-msg', '');

    try {
        const rows = await readBulkFile(file);
        validateBulkRows(rows, file.name);
    } catch (err) {
        console.error('bulk parse failed:', err);
        showMsg('bulk-msg', 'Could not read that file. ' + err.message);
    }
}

async function readBulkFile(file) {
    if (typeof XLSX === 'undefined') {
        await new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
            s.onload = resolve;
            s.onerror = () => reject(new Error('Spreadsheet library failed to load.'));
            document.head.appendChild(s);
        });
    }

    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array', raw: false, cellDates: false });
    const ws = wb.Sheets[wb.SheetNames[0]];

    if (!ws) throw new Error('File has no readable sheet.');

    const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });
    if (rows.length === 0) throw new Error('File is empty.');

    // Normalize headers
    return rows.map((r, i) => {
        const out = { __line: i + 2 };
        for (const [k, v] of Object.entries(r)) {
            out[normalizeHeader(k)] = String(v ?? '').trim();
        }
        return out;
    });
}

function validateBulkRows(rows, fileName) {
    PENDING_BULK_RAW = rows;
    const selectedProgram = $('bulk-program-filter')?.value || 'all';
    const selectedRole = $('bulk-role-filter')?.value || 'all';
    const ok = [];
    const bad = [];
    const seenEmails = new Set();
    const seenEmployeeIds = new Set();
    const seenStudentIds = new Set();

    for (const r of rows) {
        const first = r.first_name || '';
        const last = r.last_name || '';
        const email = (r.email || '').toLowerCase();
        const role = (r.role || '').toLowerCase();
        const employeeId = (r.employee_id || '').toUpperCase();
        const studentId = (r.student_id || '').replace(/[\s-]/g, '');
        const department = r.department || '';
        const yearLevel = r.year_level ? parseInt(r.year_level) : null;
        const password = r.password || generateDefaultPassword();
        const username = r.username || '';

        const base = { line: r.__line, first, last, email, role, employeeId, studentId, programCode: '', department, yearLevel, password, username };

        // Basic validation
        if (!first) { bad.push({ ...base, why: 'Missing first name.' }); continue; }
        if (!last) { bad.push({ ...base, why: 'Missing last name.' }); continue; }
        if (!email) { bad.push({ ...base, why: 'Missing email.' }); continue; }
        if (!EMAIL_RE.test(email)) { bad.push({ ...base, why: `"${email}" is not a valid email.` }); continue; }
        if (!VALID_ROLES.includes(role)) { bad.push({ ...base, why: `"${role}" is not a valid role.` }); continue; }

        // With a programme chosen above the upload, a row for any other
        // programme is rejected here, with the reason, rather than skipped
        // later without a word. A row that leaves its programme blank takes
        // the chosen one.
        const roleCheck = CurriculogicBulkAccounts.roleGate(selectedRole, role);
        if (roleCheck.error) { bad.push({ ...base, why: roleCheck.error }); continue; }

        const gate = CurriculogicBulkAccounts.programmeGate(selectedProgram, role, r.program_code);
        if (gate.error) { bad.push({ ...base, programCode: String(r.program_code || '').trim().toUpperCase(), why: gate.error }); continue; }
        if (password.length < 8) { bad.push({ ...base, why: 'Password must be at least 8 characters.' }); continue; }

        // Role-specific validation
        if (role === 'student') {
            if (!studentId) { bad.push({ ...base, why: 'Student ID is required for students.' }); continue; }
            if (seenStudentIds.has(studentId)) { bad.push({ ...base, why: 'Duplicate student ID in file.' }); continue; }
            seenStudentIds.add(studentId);
        }

        // Every role except admin belongs to exactly one programme
        // (db/030) -- a student's decides their curriculum, and a staff
        // role's is what that programme's per-role account cap
        // (_provision_account) is checked against.
        if (role !== 'admin') {
            const pc = resolveProgramCode(gate.value ?? (r.program_code || ''));
            if (pc.error) { bad.push({ ...base, why: pc.error }); continue; }
            base.programCode = pc.value;
        }

        // Free-text label only now (db/030 retired the department-text-to-
        // college matching that used to link faculty to programmes).
        const dep = resolveDepartment(role, department);
        if (dep.error) { bad.push({ ...base, why: dep.error }); continue; }
        base.department = dep.value;

        if (['faculty', 'registrar', 'department', 'admin'].includes(role)) {
            if (!employeeId) { bad.push({ ...base, why: 'Employee ID is required for staff.' }); continue; }
            if (seenEmployeeIds.has(employeeId)) { bad.push({ ...base, why: 'Duplicate employee ID in file.' }); continue; }
            seenEmployeeIds.add(employeeId);
        }

        if (role === 'admin' && !username) { 
            bad.push({ ...base, why: 'Username is required for admin accounts.' }); continue; 
        }

        // Check duplicates within the file
        if (seenEmails.has(email)) { bad.push({ ...base, why: 'Duplicate email in file.' }); continue; }
        seenEmails.add(email);

        ok.push(base);
    }

    PENDING_BULK = ok;
    PENDING_BULK_BAD = bad;
    PENDING_BULK_FILE = fileName;
    renderBulkPreview(ok, bad, fileName);
}

function generateDefaultPassword() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%';
    let result = '';
    for (let i = 0; i < 10; i++) {
        result += chars[Math.floor(Math.random() * chars.length)];
    }
    return result;
}

/* Mirrors the Role dropdown: every programme that currently exists in
   the system, listed as soon as PROGRAMS loads -- not only the ones
   that happen to appear in whatever file was last uploaded. Called
   once at init, and again whenever the Programs page might have
   changed PROGRAMS since (loadPrograms() calls this too). */
function refreshBulkProgramFilter() {
    const sel = $('bulk-program-filter');
    if (!sel) return;
    const current = sel.value;

    const codes = [...new Set(PROGRAMS.map(p => p.code))].sort();
    sel.innerHTML = ['<option value="all">All programmes</option>']
        .concat(codes.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`))
        .join('');
    if (codes.includes(current)) sel.value = current;
}

function renderBulkPreview(ok, bad, fileName) {
    const box = $('bulk-preview');
    if (!box) return;

    const roleFilter = $('bulk-role-filter')?.value || 'all';
    const programFilter = $('bulk-program-filter')?.value || 'all';
    const filteredOk = ok
        .filter(r => roleFilter === 'all' || r.role === roleFilter)
        .filter(r => programFilter === 'all' || r.programCode === programFilter);

    box.innerHTML = `
        <div class="notice ${bad.length ? 'pending' : 'info'}">
            <i class="fa-solid ${bad.length ? 'fa-triangle-exclamation' : 'fa-circle-info'}" aria-hidden="true"></i>
            <div>
                <strong>${ok.length} account${ok.length === 1 ? '' : 's'} ready${bad.length ? `, ${bad.length} rejected` : ''}</strong>
                <span class="dim"> · ${escapeHtml(fileName)}</span>
            </div>
        </div>`;

    if (bad.length) {
        box.innerHTML += `
            <h3 class="group-head" style="margin-top:var(--s3);">Rejected rows</h3>
            <div class="table-wrap">
                <table class="data-table">
                    <thead><tr><th>Line</th><th>Name</th><th>Email</th><th>Role</th><th>Reason</th></tr></thead>
                    <tbody>${bad.slice(0, 10).map(b => `
                        <tr>
                            <td class="num">${b.line}</td>
                            <td>${escapeHtml(b.first)} ${escapeHtml(b.last)}</td>
                            <td class="mono">${escapeHtml(b.email)}</td>
                            <td><span class="pill info">${escapeHtml(b.role)}</span></td>
                            <td>${escapeHtml(b.why)}</td>
                        </tr>
                    `).join('')}</tbody>
                </table>
                ${bad.length > 10 ? `<p class="dim" style="margin-top:var(--s2);">and ${bad.length - 10} more</p>` : ''}
            </div>`;
    }

    if (ok.length) {
        box.innerHTML += `
            <h3 class="group-head" style="margin-top:var(--s3);">Ready to create (${filteredOk.length})</h3>
            <div class="table-wrap">
                <table class="data-table">
                    <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Program</th><th>ID</th><th>Password</th></tr></thead>
                    <tbody>${filteredOk.slice(0, 10).map(r => `
                        <tr>
                            <td>${escapeHtml(r.first)} ${escapeHtml(r.last)}</td>
                            <td class="mono">${escapeHtml(r.email)}</td>
                            <td><span class="pill ${r.role === 'student' ? 'info' : r.role === 'admin' ? 'bad' : 'waiting'}">${escapeHtml(r.role)}</span></td>
                            <td class="mono">${escapeHtml(r.programCode || '—')}</td>
                            <td class="mono">${escapeHtml(r.studentId || r.employeeId || r.username || '—')}</td>
                            <td class="mono dim">${escapeHtml(r.password)}</td>
                        </tr>
                    `).join('')}</tbody>
                </table>
                ${filteredOk.length > 10 ? `<p class="dim" style="margin-top:var(--s2);">and ${filteredOk.length - 10} more</p>` : ''}
            </div>
            <button class="btn-accent" id="commit-bulk" style="margin-top:var(--s3);">
                <i class="fa-solid fa-check" aria-hidden="true"></i>
                <span>Create ${filteredOk.length} account${filteredOk.length === 1 ? '' : 's'}</span>
            </button>`;
    }

    $('commit-bulk')?.addEventListener('click', () => commitBulk(fileName, bad));
}

async function commitBulk(fileName, bad) {
    if (PENDING_BULK.length === 0) return;

    const roleFilter = $('bulk-role-filter')?.value || 'all';
    const programFilter = $('bulk-program-filter')?.value || 'all';
    const toCreate = PENDING_BULK
        .filter(r => roleFilter === 'all' || r.role === roleFilter)
        .filter(r => programFilter === 'all' || r.programCode === programFilter);

    if (toCreate.length === 0) return;

    // Admin accounts are the most sensitive thing this dashboard can
    // create. The server already refuses the RPC unless the caller is
    // an admin themselves, and every provision is audited — but a
    // spreadsheet with dozens of rows makes it easy to wave through an
    // admin row you didn't mean to include along with a batch of real
    // student/faculty onboarding. Require the operator to type a fixed
    // word before any admin row in this batch is created; this cannot
    // be dismissed with Enter the way window.confirm() can.
    const adminRows = toCreate.filter(r => r.role === 'admin');
    if (adminRows.length > 0) {
        const names = adminRows.map(r => `${r.first} ${r.last} <${r.email}>`).join('\n  - ');
        const typed = window.prompt(
            `This batch includes ${adminRows.length} ADMIN account${adminRows.length === 1 ? '' : 's'}:\n  - ${names}\n\n` +
            `Admin accounts get full system access with no further approval step. ` +
            `Type CONFIRM (in capitals) to proceed with creating them along with the rest of this batch, ` +
            `or Cancel to stop and remove the admin row(s) from the file first.`
        );
        if (typed !== 'CONFIRM') {
            showMsg('bulk-msg', 'Cancelled — no accounts were created.', 'pending');
            return;
        }
    }

    const btn = $('commit-bulk');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Creating…';
    }

    const success = [];
    const failed = [];

    for (const row of toCreate) {
        try {
            if (PREVIEW) {
                // Just simulate success in preview
                success.push(row);
                continue;
            }

            const params = {
                p_first_name: row.first,
                p_last_name: row.last,
                p_email: row.email,
                p_password: row.password,
                p_role: row.role,
                p_employee_id: row.employeeId || null,
                p_student_id: row.studentId || null,
                p_department: row.department,
                p_year_level: row.yearLevel,
                p_username: row.username || null,
            };
            // Every role sends one now (db/030), except admin which has
            // none to send -- left out when there is none, so the
            // database default holds.
            if (row.programCode) params.p_program_code = row.programCode;

            const { error } = await supabase.rpc('create_user_account', params);

            if (error) {
                failed.push({ ...row, why: error.message });
            } else {
                success.push(row);
            }
        } catch (err) {
            failed.push({ ...row, why: err.message });
        }
    }

    // Save history (if not preview)
    if (!PREVIEW) {
        await saveBulkHistory(fileName, success.length, failed.length);
    }

    // Render results
    const box = $('bulk-preview');
    if (box) {
        box.innerHTML = `
            <div class="notice ${failed.length ? 'pending' : 'success'}">
                <i class="fa-solid ${failed.length ? 'fa-triangle-exclamation' : 'fa-circle-check'}" aria-hidden="true"></i>
                <div>
                    <strong>${success.length} account${success.length === 1 ? '' : 's'} created${failed.length ? `, ${failed.length} failed` : ''}</strong>
                </div>
            </div>
            ${success.length ? `
                <div class="table-wrap" style="margin-top:var(--s2);">
                    <table class="data-table">
                        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Password</th></tr></thead>
                        <tbody>${success.map(s => `
                            <tr>
                                <td>${escapeHtml(s.first)} ${escapeHtml(s.last)}</td>
                                <td class="mono">${escapeHtml(s.email)}</td>
                                <td><span class="pill info">${escapeHtml(s.role)}</span></td>
                                <td class="mono dim">${escapeHtml(s.password)}</td>
                            </tr>
                        `).join('')}</tbody>
                    </table>
                </div>` : ''}
            ${failed.length ? `
                <h3 class="group-head" style="margin-top:var(--s3);">Failed</h3>
                <div class="table-wrap">
                    <table class="data-table">
                        <thead><tr><th>Name</th><th>Email</th><th>Reason</th></tr></thead>
                        <tbody>${failed.map(f => `
                            <tr>
                                <td>${escapeHtml(f.first)} ${escapeHtml(f.last)}</td>
                                <td class="mono">${escapeHtml(f.email)}</td>
                                <td>${escapeHtml(f.why)}</td>
                            </tr>
                        `).join('')}</tbody>
                    </table>
                </div>` : ''}
        `;
    }

    // Clear file input
    $('bulk-file').value = '';

    // Refresh data
    if (!PREVIEW) {
        await loadStaff(true);
        await loadStudents(true);
        renderStats();
    }
    await loadBulkHistory();

    // Clear pending
    PENDING_BULK = [];
    PENDING_BULK_BAD = [];
    PENDING_BULK_FILE = '';

    const msg = `${success.length} account${success.length === 1 ? '' : 's'} created.`;
    showMsg('bulk-msg', failed.length ? msg + ` ${failed.length} failed.` : msg, 'success');
}

async function saveBulkHistory(fileName, successCount, failedCount) {
    if (PREVIEW) return;

    try {
        await supabase.from('bulk_upload_history').insert([{
            admin_id: ADMIN?.id,
            file_name: fileName,
            total_rows: successCount + failedCount,
            success_count: successCount,
            failed_count: failedCount,
            created_at: new Date().toISOString(),
        }]);
    } catch (err) {
        console.warn('could not save bulk history:', err.message);
    }
}

async function loadBulkHistory() {
    const body = $('bulk-history-body');
    const count = $('bulk-history-count');
    if (!body) return;

    if (PREVIEW) {
        body.innerHTML = `
            <div class="empty">
                <i class="fa-solid fa-clock-rotate-left" aria-hidden="true"></i>
                <h3>No history in preview</h3>
                <p>Preview mode does not save upload history.</p>
            </div>`;
        return;
    }

    try {
        const { data, error } = await supabase
            .from('bulk_upload_history')
            .select('file_name, total_rows, success_count, failed_count, created_at')
            .order('created_at', { ascending: false })
            .limit(20);

        if (error) throw error;

        BULK_HISTORY = data ?? [];

        if (count) count.textContent = BULK_HISTORY.length ? `${BULK_HISTORY.length} uploads` : '';

        if (BULK_HISTORY.length === 0) {
            body.innerHTML = `
                <div class="empty">
                    <i class="fa-solid fa-inbox" aria-hidden="true"></i>
                    <h3>No uploads yet</h3>
                    <p>Bulk upload history will appear here once you upload a file.</p>
                </div>`;
            return;
        }

        body.innerHTML = `
            <div class="table-wrap">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>File</th>
                            <th class="num">Total</th>
                            <th class="num">Created</th>
                            <th class="num">Failed</th>
                            <th>Date</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${BULK_HISTORY.map(h => `
                            <tr>
                                <td>${escapeHtml(h.file_name)}</td>
                                <td class="num">${h.total_rows}</td>
                                <td class="num"><span class="pill ok">${h.success_count}</span></td>
                                <td class="num">${h.failed_count ? `<span class="pill bad">${h.failed_count}</span>` : '0'}</td>
                                <td class="dim">${daysAgo(h.created_at)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>`;
    } catch (err) {
        console.warn('bulk history load failed:', err.message);
        body.innerHTML = `
            <div class="empty">
                <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
                <h3>Could not load history</h3>
                <p>${escapeHtml(err.message)}</p>
            </div>`;
    }
} 


/* ---------- programmes ---------- */

/* The degree programmes. Creating one here is what lets the rest of the
   system hold a second programme at all: students, faculty and curricula all
   hang off a program row. Codes are 2 to 10 letters because section names
   (BSN-1A) are built from them and read back with a letters-only pattern.
   A programme is never deleted from the app: a prospectus, students and
   faculty links depend on it. */

const PROGRAM_CODE_RE = /^[A-Za-z]{2,10}$/;
let PROGRAM_STATS = new Map();   // program id -> { faculty, students, curriculum }
let EDITING_PROGRAM = null;      // program id whose name and college are open for editing

/* Colleges the system already knows: on programmes, and as the department
   text on faculty and department accounts. Offered as suggestions so a
   college is spelled the same way everywhere, because faculty are linked to
   a programme by exact match on it. */
function knownColleges() {
    const set = new Set();
    for (const p of PROGRAMS) if (p.college) set.add(p.college);
    for (const s of STAFF) if (s.department && s.role !== 'registrar') set.add(s.department);
    return [...set].sort();
}

function refreshColleges() {
    const list = $('college-list');
    if (list) {
        list.innerHTML = knownColleges()
            .map(c => `<option value="${escapeHtml(c)}"></option>`).join('');
    }
}

/* The programme dropdown on the student account form. With one programme
   it is preselected; with several the admin must choose, so a student is
   never quietly filed under whichever came first. */
function renderProgramPicker() {
    const sel = $('a-program');
    if (!sel) return;
    const current = sel.value;

    if (PROGRAMS.length === 0) {
        sel.innerHTML = '<option value="">No programmes yet</option>';
        return;
    }
    sel.innerHTML =
        (PROGRAMS.length > 1 ? '<option value="">Select programme…</option>' : '') +
        PROGRAMS.map(p =>
            `<option value="${escapeHtml(p.code)}">${escapeHtml(p.code)} — ${escapeHtml(p.name)}</option>`
        ).join('');
    if (current && PROGRAMS.some(p => p.code === current)) sel.value = current;
}

async function loadPrograms() {
    const body = $('programs-body');
    if (!body) return;

    if (PREVIEW || !supabase) {
        PROGRAM_STATS = new Map(PROGRAMS.map(p => [p.id, { faculty: 1, registrar: 0, department: 0, students: 0, curriculum: p.id === 1 }]));
        refreshColleges();
        renderProgramPicker();
        refreshBulkProgramFilter();
        return renderPrograms();
    }

    const [progs, faculty, registrar, department, studs, actives] = await Promise.all([
        supabase.from('program').select('id, code, name, college, max_units, max_units_graduating, target_units').order('code'),
        supabase.from('faculty_staff').select('program_id'),
        supabase.from('registrar_staff').select('program_id'),
        supabase.from('department_staff').select('program_id'),
        supabase.from('university_student').select('program_id'),
        supabase.from('prospectus').select('program_id').eq('is_active', true),
    ]);

    if (progs.error) {
        console.warn('program load failed:', progs.error.message);
        body.innerHTML = `
            <div class="empty">
                <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
                <h3>Could not load programmes</h3>
                <p>${escapeHtml(progs.error.message)}</p>
            </div>`;
        return;
    }

    PROGRAMS = progs.data ?? [];
    PROGRAM_STATS = new Map(PROGRAMS.map(p => [p.id, { faculty: 0, registrar: 0, department: 0, students: 0, curriculum: false }]));
    for (const f of faculty.data ?? [])    { const s = PROGRAM_STATS.get(f.program_id); if (s) s.faculty++; }
    for (const r of registrar.data ?? [])  { const s = PROGRAM_STATS.get(r.program_id); if (s) s.registrar++; }
    for (const d of department.data ?? []) { const s = PROGRAM_STATS.get(d.program_id); if (s) s.department++; }
    for (const s of studs.data ?? []) { const x = PROGRAM_STATS.get(s.program_id); if (x) x.students++; }
    for (const a of actives.data ?? []) { const x = PROGRAM_STATS.get(a.program_id); if (x) x.curriculum = true; }

    refreshColleges();
    renderProgramPicker();
    refreshBulkProgramFilter();
    renderPrograms();
}

function renderPrograms() {
    const body  = $('programs-body');
    const count = $('programs-count');
    if (!body) return;

    if (count) count.textContent = PROGRAMS.length ? `${PROGRAMS.length}` : '';

    if (!PROGRAMS.length) {
        body.innerHTML = `
            <div class="empty">
                <i class="fa-solid fa-graduation-cap" aria-hidden="true"></i>
                <h3>No programmes yet</h3>
                <p>Add the first one above.</p>
            </div>`;
        return;
    }

    body.innerHTML = `
        <div class="table-wrap">
            <table class="data-table">
                <thead>
                    <tr>
                        <th>Code</th><th>Name</th><th>College</th>
                        <th title="Per-term cap · cap when graduating · expected total units">Unit limits</th>
                        <th class="prog-num">Faculty</th>
                        <th class="prog-num">Registrar</th>
                        <th class="prog-num">Department</th>
                        <th class="prog-num">Students</th>
                        <th>Curriculum</th><th></th>
                    </tr>
                </thead>
                <tbody>
                    ${PROGRAMS.map(p => {
                        const st = PROGRAM_STATS.get(p.id) ?? { faculty: 0, registrar: 0, department: 0, students: 0, curriculum: false };
                        const editing = EDITING_PROGRAM === p.id;
                        // A role at its cap is worth a glance, not a blocker here --
                        // the cap itself is enforced at creation/reassignment time
                        // (createAccount(), saveStaffProgram()); this is just a
                        // quota readout.
                        const capCell = (n, limit) =>
                            `<span${n >= limit ? ' class="pill waiting" title="At the cap for this role"' : ''}>${n} / ${limit}</span>`;
                        return `
                        <tr>
                            <td class="mono"><strong>${escapeHtml(p.code)}</strong></td>
                            <td>${editing
                                ? `<input class="prog-edit-name" value="${escapeHtml(p.name)}" aria-label="Name">`
                                : escapeHtml(p.name)}</td>
                            <td>${editing
                                ? `<input class="prog-edit-college" list="college-list" value="${escapeHtml(p.college ?? '')}" aria-label="College">`
                                : (p.college ? escapeHtml(p.college) : '<span class="pill waiting">not set</span>')}</td>
                            <td>${editing
                                ? `<input class="prog-edit-max" type="number" min="1" max="60" value="${p.max_units ?? 24}" aria-label="Units per term" style="width:4.2em">
                                   <input class="prog-edit-grad" type="number" min="1" max="60" value="${p.max_units_graduating ?? 27}" aria-label="Units per term when graduating" style="width:4.2em">
                                   <input class="prog-edit-target" type="number" min="1" max="400" value="${p.target_units ?? 176}" aria-label="Expected total units" style="width:4.8em">`
                                : `${p.max_units ?? 24} · ${p.max_units_graduating ?? 27} · ${p.target_units ?? 176}`}</td>
                            <td class="prog-num">${capCell(st.faculty, ROLE_LIMIT.faculty)}</td>
                            <td class="prog-num">${capCell(st.registrar, ROLE_LIMIT.registrar)}</td>
                            <td class="prog-num">${capCell(st.department, ROLE_LIMIT.department)}</td>
                            <td class="prog-num">${st.students}</td>
                            <td>${st.curriculum
                                ? '<span class="pill ok">Published</span>'
                                : '<span class="pill waiting" title="Department Staff has not activated a curriculum">None yet</span>'}</td>
                            <td>${editing
                                ? `<button type="button" class="btn-link" data-prog-save="${p.id}">Save</button>
                                   <button type="button" class="btn-link" data-prog-cancel>Cancel</button>`
                                : `<button type="button" class="btn-link" data-prog-edit="${p.id}">Edit</button>`}</td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>
        </div>`;
}

$('program-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    showMsg('programs-msg', '');

    let code = $('prog-code').value.trim();
    const name = $('prog-name').value.trim();
    const college = $('prog-college').value.trim();

    if (!PROGRAM_CODE_RE.test(code)) {
        return showMsg('programs-msg',
            'The code must be 2 to 10 letters, with no digits, spaces or hyphens. It becomes part of section names such as BSN-1A.');
    }
    // A code typed in lower case is a code typed carelessly, not a name.
    if (code === code.toLowerCase()) code = code.toUpperCase();

    if (PROGRAMS.some(p => p.code.toLowerCase() === code.toLowerCase())) {
        return showMsg('programs-msg', `A programme with the code ${code} already exists.`);
    }
    if (name.length < 3) return showMsg('programs-msg', 'Enter the programme name.');
    if (!college) {
        return showMsg('programs-msg',
            'Enter the college. Faculty are linked to the programme through it.');
    }

    const btn = $('prog-add');
    btn.disabled = true;
    const done = () => { btn.disabled = false; };

    if (PREVIEW || !supabase) {
        PROGRAMS.push({ id: Date.now(), code, name, college });
        $('program-form').reset();
        await loadPrograms();
        done();
        return showMsg('programs-msg', `${code} added (preview only, not saved).`, 'success');
    }

    const { data, error } = await supabase
        .from('program')
        .insert({ code, name, college })
        .select('id')
        .single();

    if (error) {
        console.warn('program insert failed:', error.message);
        done();
        if (error.code === '23505') return showMsg('programs-msg', `A programme with the code ${code} already exists.`);
        if (error.code === '42501') return showMsg('programs-msg', 'Only the System Administrator can add programmes.');
        return showMsg('programs-msg', 'Could not add the programme. Please try again.');
    }

    // db/030 retired the auto-link-by-college-text trigger that used to
    // run here -- staff are now linked to a programme explicitly, at
    // account creation or via Staff management, never as a side effect
    // of adding the programme itself.
    $('program-form').reset();
    await loadPrograms();
    await loadStaff(true);
    done();
    showMsg('programs-msg',
        `${code} added. Create or reassign faculty, registrar and department accounts to it from Create account or Staff management.`,
        'success');
});

$('programs-body')?.addEventListener('click', async (e) => {
    const edit = e.target.closest('[data-prog-edit]');
    if (edit) { EDITING_PROGRAM = Number(edit.dataset.progEdit); return renderPrograms(); }

    if (e.target.closest('[data-prog-cancel]')) { EDITING_PROGRAM = null; return renderPrograms(); }

    const save = e.target.closest('[data-prog-save]');
    if (!save) return;

    const id = Number(save.dataset.progSave);
    const row = save.closest('tr');
    const name = row.querySelector('.prog-edit-name')?.value.trim() ?? '';
    const college = row.querySelector('.prog-edit-college')?.value.trim() ?? '';
    const before = PROGRAMS.find(p => p.id === id);

    const max_units            = Number(row.querySelector('.prog-edit-max')?.value);
    const max_units_graduating = Number(row.querySelector('.prog-edit-grad')?.value);
    const target_units         = Number(row.querySelector('.prog-edit-target')?.value);

    if (name.length < 3) return showMsg('programs-msg', 'Enter the programme name.');
    if (!college) return showMsg('programs-msg', 'Enter the college.');
    if (![max_units, max_units_graduating, target_units].every(n => Number.isInteger(n) && n > 0)) {
        return showMsg('programs-msg', 'Unit limits must be whole numbers above zero.');
    }
    if (max_units_graduating < max_units) {
        return showMsg('programs-msg', 'The graduating cap cannot be lower than the normal per-term cap.');
    }
    if (before && before.name === name && (before.college ?? '') === college
        && before.max_units === max_units
        && before.max_units_graduating === max_units_graduating
        && before.target_units === target_units) {
        EDITING_PROGRAM = null;
        return renderPrograms();
    }

    save.disabled = true;

    if (PREVIEW || !supabase) {
        Object.assign(before, { name, college, max_units, max_units_graduating, target_units });
        EDITING_PROGRAM = null;
        renderPrograms();
        return showMsg('programs-msg', 'Programme updated (preview only, not saved).', 'success');
    }

    const { error } = await supabase
        .from('program')
        .update({ name, college, max_units, max_units_graduating, target_units, updated_at: new Date().toISOString() })
        .eq('id', id);

    if (error) {
        console.warn('program update failed:', error.message);
        save.disabled = false;
        return showMsg('programs-msg', 'Could not update the programme. Please try again.');
    }

    const collegeChanged = (before?.college ?? '') !== college;
    Object.assign(before, { name, college, max_units, max_units_graduating, target_units });
    EDITING_PROGRAM = null;
    refreshColleges();
    renderProgramPicker();
    renderPrograms();
    showMsg('programs-msg',
        collegeChanged
            ? 'Programme updated. Faculty links are not changed automatically: check Staff management if the college changed.'
            : 'Programme updated.',
        'success');
});


/* ---------- academic term ---------- */

/* The single row in system_config that says what term it is. Students read
   it to choose which offerings to show and what to stamp on an advising
   request; Faculty and the Registrar read the term stored on the request;
   the Department's schedule defaults to it. Only the administrator may
   change it (RLS), which is why the control lives here. */

const TERM_NAMES = { 1: '1st Sem', 2: '2nd Sem', 3: 'Summer' };
let TERM = null;          // { term, year, updated_at }
let TERM_PENDING = null;  // { term, year } awaiting confirmation

const termLabel = (t, y) => `${TERM_NAMES[t] ?? 'Term ' + t} · AY ${y}–${y + 1}`;

async function loadTermConfig() {
    if (PREVIEW || !supabase) {
        TERM = { term: 1, year: 2023, updated_at: null };
        return renderTerm();
    }

    const { data, error } = await supabase
        .from('system_config')
        .select('current_term, current_academic_year, updated_at')
        .eq('id', 1)
        .maybeSingle();

    if (error || !data) {
        console.warn('term config load failed:', error?.message);
        TERM = null;
        return renderTerm();
    }

    TERM = { term: data.current_term, year: data.current_academic_year, updated_at: data.updated_at };
    renderTerm();
}

function renderTerm() {
    const cur = $('term-current');
    const stamp = $('term-updated');
    const year = $('term-year');
    const term = $('term-term');

    if (!TERM) {
        if (cur) cur.textContent = 'not available';
        if (stamp) stamp.textContent = '';
        showMsg('term-msg', 'Could not read the current term. The setting may be missing.');
        return;
    }

    if (cur) cur.textContent = termLabel(TERM.term, TERM.year);
    if (stamp) {
        stamp.textContent = TERM.updated_at
            ? `changed ${new Date(TERM.updated_at).toLocaleDateString()}`
            : '';
    }
    // Do not overwrite something the operator is in the middle of typing.
    if (year && !TERM_PENDING && document.activeElement !== year) year.value = TERM.year;
    if (term && !TERM_PENDING && document.activeElement !== term) term.value = String(TERM.term);
    updateTermYearHint();
}

function updateTermYearHint() {
    const y = Number($('term-year')?.value);
    const hint = $('term-year-hint');
    if (hint) hint.textContent = Number.isInteger(y) && y >= 2000 && y <= 2100
        ? `AY ${y}–${y + 1}` : '';
}

function hideTermConfirm() {
    TERM_PENDING = null;
    const box = $('term-confirm');
    if (box) box.hidden = true;
    const btn = $('term-change');
    if (btn) btn.disabled = false;
}

$('term-year')?.addEventListener('input', () => { hideTermConfirm(); updateTermYearHint(); });
$('term-term')?.addEventListener('change', hideTermConfirm);

/* Step 1: validate, then say what changing it would do. Nothing is written
   until the second click. */
$('term-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    showMsg('term-msg', '');

    const year = Number($('term-year')?.value);
    const term = Number($('term-term')?.value);

    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
        return showMsg('term-msg', 'Enter the academic year as a four-digit year, such as 2026.');
    }
    if (![1, 2, 3].includes(term)) return showMsg('term-msg', 'Choose a term.');
    if (TERM && year === TERM.year && term === TERM.term) {
        return showMsg('term-msg', `${termLabel(term, year)} is already the current term.`);
    }

    // What students would find when the term switches: how much of that
    // term is actually scheduled. Switching to an empty term leaves every
    // student with nothing offered.
    let scheduled = null;
    if (!PREVIEW && supabase) {
        const { count, error } = await supabase
            .from('subject_offering')
            .select('id', { count: 'exact', head: true })
            .eq('academic_year', year)
            .eq('term', term);
        if (!error) scheduled = count;
    } else {
        scheduled = 11;
    }

    TERM_PENDING = { term, year };
    const text = $('term-confirm-text');
    const nothing = scheduled === 0;
    if (text) {
        text.innerHTML =
            `Change the term to <strong>${escapeHtml(termLabel(term, year))}</strong>? ` +
            'Every student, faculty member and the Department will switch to it right away. ' +
            (scheduled === null
                ? 'I could not check whether a schedule exists for it.'
                : nothing
                    ? '<span class="term-warn">No schedule exists for that term yet, so students will see no ' +
                      'offered subjects until Department Staff publishes one.</span>'
                    : `${scheduled} offering${scheduled === 1 ? ' is' : 's are'} scheduled for it.`);
    }
    $('term-confirm').hidden = false;
    $('term-change').disabled = true;
});

/* Step 2: write it. */
$('term-confirm-yes')?.addEventListener('click', async () => {
    if (!TERM_PENDING) return;
    const { term, year } = TERM_PENDING;
    const yes = $('term-confirm-yes');
    if (yes) yes.disabled = true;

    const finish = () => { if (yes) yes.disabled = false; };

    if (PREVIEW || !supabase) {
        TERM = { term, year, updated_at: new Date().toISOString() };
        hideTermConfirm(); finish(); renderTerm();
        return showMsg('term-msg', `Term changed to ${termLabel(term, year)} (preview only, not saved).`, 'success');
    }

    const { error } = await supabase
        .from('system_config')
        .update({
            current_term: term,
            current_academic_year: year,
            updated_by: AUTH_UID,
            updated_at: new Date().toISOString(),
        })
        .eq('id', 1);

    if (error) {
        console.warn('term update failed:', error.message);
        finish();
        return showMsg('term-msg', 'Could not change the term. Please try again.');
    }

    TERM = { term, year, updated_at: new Date().toISOString() };
    hideTermConfirm();
    finish();
    renderTerm();

    // The topbar was painted from the old value when the page loaded.
    const bar = $('topbar-term');
    if (bar) bar.textContent = termLabel(term, year);

    showMsg('term-msg', `The term is now ${termLabel(term, year)}.`, 'success');
});

$('term-confirm-no')?.addEventListener('click', hideTermConfirm);


/* ---------- boot ---------- */

(async function init() {

    if (previewRequested()) {
        PREVIEW = true;
        ADMIN = PREVIEW_ADMIN;
        document.body.classList.add('is-preview');
        renderProfile(ADMIN, PREVIEW_ADMIN.email);
        renderNotice(ADMIN);
        await loadStaff();
        await loadStudents();
        await loadTermConfig();
        renderSystemStatus();
        initBulkUpload();
        route();
        return;
    }

    if (!supabase) {
        setText('greeting', 'Cannot reach the service');
        console.error('admindashboard.js: Supabase client not created. Is config.js loaded?');
        return;
    }

    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
        window.location.href = LOGIN_PAGE;
        return;
    }

    AUTH_UID = session.user.id;

    const { data: admin, error } = await supabase
        .from('system_administrator')
        .select('id, employee_id, first_name, last_name, username, email, is_approved')
        .eq('user_id', AUTH_UID)
        .maybeSingle();

    if (error) console.warn('admin load failed:', error.message);

    if (!admin || admin.is_approved === false) {
        await supabase.auth.signOut();
        window.location.href = LOGIN_PAGE;
        return;
    }

    ADMIN = admin;
    renderProfile(admin, session.user.email);
    renderNotice(admin);

    await loadStaff();
    await loadStudents();
    await loadTermConfig();
    renderSystemStatus();
    initBulkUpload();

    route();
})();

})();