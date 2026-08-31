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

const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.CURRICULOGIC ?? {};

const supabase = (window.supabase && SUPABASE_URL && SUPABASE_ANON_KEY)
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

const $ = (id) => document.getElementById(id);

const LOGIN_PAGE = 'adminloginpage.html';

let AUTH_UID = null;
let ADMIN    = null;
let STAFF    = [];
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
    bulk:      'Bulk upload',
    staff:     'Staff management',
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
        link.classList.toggle('active', link.dataset.view === name);
    });

    const title = $('topbar-title');
    if (title) title.textContent = VIEWS[name];

    shell?.classList.remove('nav-open');

    if (name === 'staff')    loadStaff();
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
        renderStats();
        renderStaff();
        return;
    }

    if (!supabase) return;

    const [faculty, registrar, department] = await Promise.all([
        supabase.from('faculty_staff')
            .select('id, first_name, last_name, email, employee_id, is_approved, created_at'),
        supabase.from('registrar_staff')
            .select('id, first_name, last_name, email, employee_id, is_approved, created_at'),
        supabase.from('department_staff')
            .select('id, first_name, last_name, email, employee_id, is_approved, created_at'),
    ]);

    if (faculty.error)  console.warn('faculty load failed:', faculty.error.message);
    if (registrar.error) console.warn('registrar load failed:', registrar.error.message);
    if (department.error) console.warn('department load failed:', department.error.message);

    STAFF = [
        ...(faculty.data ?? []).map(s => ({ ...s, role: 'faculty' })),
        ...(registrar.data ?? []).map(s => ({ ...s, role: 'registrar' })),
        ...(department.data ?? []).map(s => ({ ...s, role: 'department' })),
    ];

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
    const role       = $('a-role').value;
    const department = $('a-department').value.trim() || 'College of Computer Studies';
    const password   = $('a-password').value;
    const confirm    = $('a-confirm').value;

    // Validation
    if (!first)     return showMsg(boxId, 'Enter a first name.');
    if (!last)      return showMsg(boxId, 'Enter a last name.');
    if (!email)     return showMsg(boxId, 'Enter an email address.');
    if (!EMAIL_RE.test(email)) return showMsg(boxId, 'Enter a valid email address.');
    if (!employeeId) return showMsg(boxId, 'Enter an employee ID.');
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
                is_approved: true,
                created_at: new Date().toISOString(),
            });
            renderStats();
            renderStaff();
            clearCreateForm();
            showMsg(boxId, `${first} ${last} created (preview only — not saved).`, 'success');
            return;
        }

        // Call the RPC to create the account
        const { data, error } = await supabase.rpc('create_staff_account', {
            p_first_name: first,
            p_last_name: last,
            p_email: email,
            p_password: password,
            p_employee_id: employeeId,
            p_role: role,
            p_department: department,
        });

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
    ['a-first-name', 'a-last-name', 'a-email', 'a-employee-id', 'a-department', 'a-password', 'a-confirm']
        .forEach(id => { $(id).value = ''; });
    $('a-role').value = 'faculty';
    $('a-first-name').focus();
}

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
    'employee_id', 'student_id', 'department', 'year_level', 'password', 'username'
];

const VALID_ROLES = ['student', 'faculty', 'registrar', 'department', 'admin'];

let PENDING_BULK = [];
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

    // Role filter
    $('bulk-role-filter')?.addEventListener('change', () => {
        if (PENDING_BULK.length > 0) {
            renderBulkPreview(PENDING_BULK, [], 'filtered');
        }
    });

    // Load history
    loadBulkHistory();
}

function downloadBulkTemplate() {
    const rows = [
        { first_name: 'Juan', last_name: 'Dela Cruz', email: 'juan.delacruz@uc.edu.ph', role: 'faculty', employee_id: 'EMP-00101', student_id: '', department: 'College of Computer Studies', year_level: '', password: '', username: '' },
        { first_name: 'Maria', last_name: 'Santos', email: 'maria.santos@uc.edu.ph', role: 'registrar', employee_id: 'EMP-00102', student_id: '', department: 'Office of the Registrar', year_level: '', password: '', username: '' },
        { first_name: 'Pedro', last_name: 'Reyes', email: 'pedro.reyes@uc.edu.ph', role: 'department', employee_id: 'EMP-00103', student_id: '', department: 'College of Computer Studies', year_level: '', password: '', username: '' },
        { first_name: 'Althea', last_name: 'Villanueva', email: 'althea.villanueva@uc.edu.ph', role: 'student', employee_id: '', student_id: '2401187', department: 'College of Computer Studies', year_level: '2', password: '', username: '' },
        { first_name: 'System', last_name: 'Admin2', email: 'admin2@uc.edu.ph', role: 'admin', employee_id: 'EMP-ADMIN002', student_id: '', department: 'College of Computer Studies', year_level: '', password: '', username: 'admin2' },
    ];

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
        { wch: 30 },  // department
        { wch: 12 },  // year_level
        { wch: 15 },  // password
        { wch: 15 },  // username
    ];

    // Create workbook
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Accounts');
    
    // Download as Excel file
    XLSX.writeFile(wb, 'accounts-template.xlsx');
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
        const department = r.department || 'College of Computer Studies';
        const yearLevel = r.year_level ? parseInt(r.year_level) : null;
        const password = r.password || generateDefaultPassword();
        const username = r.username || '';

        const base = { line: r.__line, first, last, email, role, employeeId, studentId, department, yearLevel, password, username };

        // Basic validation
        if (!first) { bad.push({ ...base, why: 'Missing first name.' }); continue; }
        if (!last) { bad.push({ ...base, why: 'Missing last name.' }); continue; }
        if (!email) { bad.push({ ...base, why: 'Missing email.' }); continue; }
        if (!EMAIL_RE.test(email)) { bad.push({ ...base, why: `"${email}" is not a valid email.` }); continue; }
        if (!VALID_ROLES.includes(role)) { bad.push({ ...base, why: `"${role}" is not a valid role.` }); continue; }
        if (password.length < 8) { bad.push({ ...base, why: 'Password must be at least 8 characters.' }); continue; }

        // Role-specific validation
        if (role === 'student') {
            if (!studentId) { bad.push({ ...base, why: 'Student ID is required for students.' }); continue; }
            if (seenStudentIds.has(studentId)) { bad.push({ ...base, why: 'Duplicate student ID in file.' }); continue; }
            seenStudentIds.add(studentId);
        }

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

function renderBulkPreview(ok, bad, fileName) {
    const box = $('bulk-preview');
    if (!box) return;

    // Apply role filter if selected
    const roleFilter = $('bulk-role-filter')?.value || 'all';
    const filteredOk = roleFilter === 'all' ? ok : ok.filter(r => r.role === roleFilter);

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
                    <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>ID</th><th>Password</th></tr></thead>
                    <tbody>${filteredOk.slice(0, 10).map(r => `
                        <tr>
                            <td>${escapeHtml(r.first)} ${escapeHtml(r.last)}</td>
                            <td class="mono">${escapeHtml(r.email)}</td>
                            <td><span class="pill ${r.role === 'student' ? 'info' : r.role === 'admin' ? 'bad' : 'waiting'}">${escapeHtml(r.role)}</span></td>
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
    const toCreate = roleFilter === 'all' ? PENDING_BULK : PENDING_BULK.filter(r => r.role === roleFilter);

    if (toCreate.length === 0) return;

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

            const { error } = await supabase.rpc('create_user_account', {
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
            });

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
    renderSystemStatus();
    initBulkUpload();

    route();
})();

})();