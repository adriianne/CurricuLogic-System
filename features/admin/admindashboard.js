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

const { SUPABASE_URL, SUPABASE_ANON_KEY, authStorageKey, authOptions } = window.CURRICULOGIC ?? {};

// Bucketed storage key (see config.js) -- keeps an admin session in this
// tab from colliding with a different role signed in in another tab.
const supabase = (window.supabase && SUPABASE_URL && SUPABASE_ANON_KEY)
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: authOptions ? authOptions(['system_administrator']) : { storageKey: authStorageKey?.(['system_administrator']) },
    })
    : null;

/* The term helper reads system_config with this signed-in client (db/052). */
window.CurriculogicTerm?.setClient(supabase);

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
    { id: 's1', first_name: 'Althea', last_name: 'Villanueva', student_id: '2401187', program_id: 1, email: 'althea1@gmail.com',   is_approved: true,  approval_status: 'approved' },
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
    edplist:   'EDP student list',
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
    if (name === 'edplist')  initEdpList();
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

    PHOTO_INITIALS = initials(admin?.first_name, admin?.last_name, email);
    window.CurriculogicPhoto.paint($('avatar'), PHOTO_URL, PHOTO_INITIALS);
    $('user-name').textContent = full || admin?.username || 'Admin';
    $('user-sub').textContent  = admin?.employee_id || 'System Administrator';

    $('greeting').textContent = admin?.first_name
        ? `Welcome back, ${admin.first_name}`
        : 'Welcome back';

    window.CurriculogicPhoto.paint($('prof-avatar'), PHOTO_URL, PHOTO_INITIALS);
    setText('prof-name',   full || admin?.username || email);
    setText('prof-sub',    [admin?.employee_id, 'System Administrator'].filter(Boolean).join(' \u00b7 '));

    setText('d-name',  full || '—');
    setText('d-eid',   admin?.employee_id || '—', 'mono');
    setText('d-username', admin?.username || '—', 'mono');
    setText('d-email', email, 'mono');

    const f = $('edit-first'), l = $('edit-last'), e = $('edit-email');
    if (f && document.activeElement !== f) f.value = admin?.first_name || '';
    if (l && document.activeElement !== l) l.value = admin?.last_name || '';
    if (e && document.activeElement !== e) e.value = email === '—' ? '' : email;
}

/* Profile photo: stored privately per account (db/064), helpers in
   shared/js/app/profilephoto.js. Preview has no storage, so a picture chosen there
   only lives until the page is closed. */
let PHOTO_URL = null;
let PHOTO_INITIALS = '';

function showPhoto(url) {
    PHOTO_URL = url || null;
    window.CurriculogicPhoto.paint($('avatar'), PHOTO_URL, PHOTO_INITIALS);
    window.CurriculogicPhoto.paint($('prof-avatar'), PHOTO_URL, PHOTO_INITIALS);
    const rm = $('photo-remove');
    if (rm) rm.hidden = !PHOTO_URL;
}

async function loadPhoto() {
    if (PREVIEW || !supabase || !AUTH_UID) return;
    showPhoto(await window.CurriculogicPhoto.signedUrl(supabase, AUTH_UID));
}

function photoMessage(text, isError) {
    const box = $('photo-msg');
    if (!box) return;
    box.textContent = text || '';
    box.classList.toggle('is-error', !!isError);
}

$('photo-change')?.addEventListener('click', () => $('photo-file')?.click());

$('photo-file')?.addEventListener('change', async (ev) => {
    const input = ev.target;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    const Photo = window.CurriculogicPhoto;
    const bad = Photo.problem(file);
    if (bad) return photoMessage(bad, true);

    photoMessage('Saving…');
    $('photo-change').disabled = true;
    try {
        const blob = await Photo.prepare(file);
        if (PREVIEW || !supabase || !AUTH_UID) {
            showPhoto(URL.createObjectURL(blob));
            photoMessage('Photo updated (preview only, not saved).');
        } else {
            await Photo.upload(supabase, AUTH_UID, blob);
            showPhoto(await Photo.signedUrl(supabase, AUTH_UID));
            photoMessage('Photo updated.');
        }
    } catch (err) {
        photoMessage(err.message || 'The photo could not be saved.', true);
    } finally {
        $('photo-change').disabled = false;
    }
});

$('photo-remove')?.addEventListener('click', async () => {
    photoMessage('Removing…');
    try {
        if (!PREVIEW && supabase && AUTH_UID) await window.CurriculogicPhoto.remove(supabase, AUTH_UID);
        showPhoto(null);
        photoMessage('Photo removed.');
    } catch (err) {
        photoMessage(err.message || 'The photo could not be removed.', true);
    }
});

/* Edit name and email. A new email goes through Supabase Auth, which sends a
   confirmation link; the table's email follows once the sign-in email changes
   (synced at the next load, see syncEmailFromAuth). */
$('prof-edit-form')?.addEventListener('submit', async (ev) => {
    ev.preventDefault();

    const first = CurriculogicNameRules.clean($('edit-first').value);
    const last  = CurriculogicNameRules.clean($('edit-last').value);
    const email = CurriculogicEmailRules.clean($('edit-email').value);
    const pw    = $('edit-pw').value;

    const firstProblem = CurriculogicNameRules.problem(first, 'first name');
    if (firstProblem) return showMsg('edit-msg', firstProblem);
    const lastProblem = CurriculogicNameRules.problem(last, 'last name');
    if (lastProblem) return showMsg('edit-msg', lastProblem);
    const emailProblem = CurriculogicEmailRules.problem(email);
    if (emailProblem) return showMsg('edit-msg', emailProblem);

    const emailChanged = email.toLowerCase() !== String(ADMIN?.email || '').toLowerCase();
    const nameChanged  = first !== (ADMIN?.first_name || '') || last !== (ADMIN?.last_name || '');
    if (!emailChanged && !nameChanged) return showMsg('edit-msg', 'Nothing to save: no details were changed.');
    if (emailChanged && !PREVIEW && !pw) return showMsg('edit-msg', 'Enter your current password to change your email.');

    const btn = $('edit-submit');
    const finish = (msg, type) => {
        if (btn) { btn.disabled = false; btn.textContent = 'Save changes'; }
        showMsg('edit-msg', msg, type);
    };
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

    if (PREVIEW) {
        ADMIN = { ...ADMIN, first_name: first, last_name: last };
        renderProfile(ADMIN, ADMIN?.email);
        return finish('Saved (preview only).', 'success');
    }
    if (!supabase || !ADMIN?.id) return finish('Your admin record could not be found.');

    if (emailChanged) {
        const { error: authErr } = await supabase.auth.signInWithPassword({ email: ADMIN.email, password: pw });
        if (authErr) return finish('Current password is incorrect.');
    }

    if (nameChanged) {
        const { error } = await supabase.from('system_administrator')
            .update({ first_name: first, last_name: last }).eq('id', ADMIN.id);
        if (error) return finish(error.message || 'Could not save your name.');
        ADMIN = { ...ADMIN, first_name: first, last_name: last };
        renderProfile(ADMIN, ADMIN.email);
    }

    if (emailChanged) {
        const { error } = await supabase.auth.updateUser({ email });
        if (error) return finish(error.message || 'Could not change your email.');
        $('edit-pw').value = '';
        return finish(`Saved. We sent a confirmation link to ${email}. Your email changes once you open it.`, 'success');
    }

    $('edit-pw').value = '';
    finish('Saved.', 'success');
});

/* If the email was confirmed since last time, bring the admin record in line. */
async function syncEmailFromAuth(authEmail) {
    if (!authEmail || !ADMIN?.id) return;
    if (authEmail.toLowerCase() === String(ADMIN.email || '').toLowerCase()) return;
    const { error } = await supabase.from('system_administrator')
        .update({ email: authEmail }).eq('id', ADMIN.id);
    if (error) return console.warn('email sync failed:', error.message);
    ADMIN = { ...ADMIN, email: authEmail };
    renderProfile(ADMIN, authEmail);
}

/* Change password */
$('prof-pw-form')?.addEventListener('submit', async (ev) => {
    ev.preventDefault();

    const current = $('pw-current')?.value ?? '';
    const next    = $('pw-new')?.value ?? '';
    const confirm = $('pw-confirm')?.value ?? '';

    if (!current) return showMsg('pw-msg', 'Enter your current password.');
    const pwProblem = CurriculogicPasswordRules.problem(next);
    if (pwProblem) return showMsg('pw-msg', pwProblem);
    if (next !== confirm) return showMsg('pw-msg', 'New passwords do not match.');
    if (next === current) return showMsg('pw-msg', 'Choose a password different from your current one.');

    const btn = $('pw-submit');
    const finish = (msg, type) => {
        if (btn) { btn.disabled = false; btn.textContent = 'Change password'; }
        showMsg('pw-msg', msg, type);
    };
    if (btn) { btn.disabled = true; btn.textContent = 'Updating…'; }

    if (PREVIEW) return finish('Password updated (preview only).', 'success');

    const email = ADMIN?.email;
    if (!supabase || !email) return finish('No email on record for this account.');

    const { error: authErr } = await supabase.auth.signInWithPassword({ email, password: current });
    if (authErr) return finish('Current password is incorrect.');

    const { error: upErr } = await supabase.auth.updateUser({ password: next });
    if (upErr) return finish(upErr.message || 'Could not change password.');

    // A new password replaces any temporary one (db/057).
    await supabase.rpc('clear_must_change_password');

    ['pw-current', 'pw-new', 'pw-confirm'].forEach(id => { const el = $(id); if (el) el.value = ''; });
    finish('Password updated.', 'success');
});

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

    // The Programme column needs the programme list even if Staff was never opened.
    if (!PROGRAMS_READY) {
        const prog = await supabase.from('program').select('id, code, name');
        if (!prog.error) { PROGRAMS = prog.data ?? []; PROGRAMS_READY = true; }
    }

    const { data, error } = await supabase
        .from('university_student')
        .select('id, first_name, last_name, student_id, email, program_id, is_approved, approval_status, created_at')
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

/* One number on the dashboard: set as usual, then counted up from what is
   shown (or from 0 the first time). See shared/js/app/motion.js. */
function setStat(id, n) {
    const el = $(id);
    const before = (el?.textContent ?? '').trim();
    setText(id, String(n), 'stat-value');
    if (!el) return;
    el.textContent = /^\d+$/.test(before) ? before : '0';
    window.CurriculogicMotion?.countUp(el, n);
}

/* The four numbers on the profile page, counted up from what is shown. */
function renderProfileStats() {
    const pending = STUDENTS.filter(s =>
        (s.approval_status || (s.is_approved ? 'approved' : 'pending')) === 'pending').length;
    const set = (id, n) => {
        const el = $(id);
        if (!el) return;
        if (!/^\d+$/.test(el.textContent.trim())) el.textContent = '0';
        window.CurriculogicMotion?.countUp(el, n);
    };
    set('p-stat-staff',    STAFF.length);
    set('p-stat-students', STUDENTS.length);
    set('p-stat-programs', PROGRAMS.length);
    set('p-stat-pending',  pending);
}

function renderStats() {
    renderProfileStats();
    const faculty    = STAFF.filter(s => s.role === 'faculty').length;
    const registrar  = STAFF.filter(s => s.role === 'registrar').length;
    const department = STAFF.filter(s => s.role === 'department').length;

    setStat('stat-faculty',    faculty);
    setStat('stat-registrar',  registrar);
    setStat('stat-department', department);
    setStat('stat-students',   STUDENTS.length);
}

function renderStudentStats() {
    setStat('stat-students', STUDENTS.length);
    renderProfileStats();
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


/* ---------- stop and restore an account (db/088) ----------
   Stopping is reversible and erases nothing: the person cannot sign in or reach any data until the Admin
   restores them. It covers students and faculty, registrar and department staff. The rules (what counts as
   stopped, the reason limit, the wording) are in shared/js/accounts/accountstop.js. */

let STOPPED = new Set();       // 'role:id' of every account the log says is stopped now
let PREVIEW_STOP_LOG = [];     // preview only: the log kept in memory
let ACCT_BUSY = false;         // an action is being saved
// What is open on each row, kept so a redraw never closes the box or clears the typed reason.
const ACCT_UI = {};            // 'role:id' -> { mode: 'stop' | 'restore' | null, reason: '' }
const acctKey = (role, id) => `${role}:${id}`;
const acctUi = (role, id) => (ACCT_UI[acctKey(role, id)] ??= { mode: null, reason: '' });

async function loadStopLog() {
    if (PREVIEW) { STOPPED = CurriculogicAccountStop.latestStops(PREVIEW_STOP_LOG); return; }
    if (!supabase) return;
    const rows = [];
    for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase
            .from('account_stop_log')
            .select('role, target_id, action, seq')
            .order('seq', { ascending: true })
            .range(from, from + 999);
        if (error) { console.warn('stop log load failed:', error.message); return; }
        rows.push(...(data ?? []));
        if ((data ?? []).length < 1000) break;
    }
    STOPPED = CurriculogicAccountStop.latestStops(rows);
}

/* The button at the end of a row: Stop for an active account, Restore for a stopped one, nothing otherwise. */
function acctActionCell(role, row, state) {
    const A = CurriculogicAccountStop;
    const open = acctUi(role, row.id).mode;
    if (A.canStop(state)) {
        return `<button type="button" class="btn-small" data-acct="stop" data-role="${role}" data-id="${escapeHtml(row.id)}" aria-expanded="${open === 'stop'}">Stop</button>`;
    }
    if (A.canRestore(state)) {
        return `<button type="button" class="btn-small" data-acct="restore" data-role="${role}" data-id="${escapeHtml(row.id)}" aria-expanded="${open === 'restore'}">Restore</button>`;
    }
    return '';
}

/* The row under an account that opens when Stop or Restore is chosen. */
function acctPanelRow(role, row, state, colspan) {
    const ui = acctUi(role, row.id);
    if (!ui.mode) return '';
    const A = CurriculogicAccountStop;
    const id = escapeHtml(row.id);
    const who = escapeHtml(fullName(row) || 'this account');

    if (ui.mode === 'stop' && A.canStop(state)) {
        return `
        <tr class="acct-row"><td colspan="${colspan}">
            <div class="decline-panel">
                <label for="as-${id}" class="decline-label">Stop ${who}? <span class="dim">They cannot sign in or reach any data until you restore them. Nothing is deleted.</span></label>
                <textarea id="as-${id}" class="decline-text" rows="2" maxlength="${A.REASON_MAX}" data-acct-reason="${role}" data-id="${id}"
                          placeholder="Why is this account being stopped? (kept in its history)">${escapeHtml(ui.reason)}</textarea>
                <p class="decline-meta"><span data-acct-count="${role}:${id}">${ui.reason.length}/${A.REASON_MAX}</span></p>
                <p class="decline-error" data-acct-error="${role}:${id}" role="alert" hidden></p>
                <div class="review-actions">
                    <button type="button" class="btn-danger" data-acct-confirm="stop" data-role="${role}" data-id="${id}">Stop account</button>
                    <button type="button" class="btn-small" data-acct-cancel="${role}" data-id="${id}">Cancel</button>
                </div>
            </div>
        </td></tr>`;
    }
    if (ui.mode === 'restore' && A.canRestore(state)) {
        return `
        <tr class="acct-row"><td colspan="${colspan}">
            <div class="decline-panel acct-restore">
                <p class="decline-label">Restore ${who}? <span class="dim">They can sign in again and see everything they had before.</span></p>
                <div class="review-actions">
                    <button type="button" class="btn-accent" data-acct-confirm="restore" data-role="${role}" data-id="${id}">Restore account</button>
                    <button type="button" class="btn-small" data-acct-cancel="${role}" data-id="${id}">Cancel</button>
                </div>
            </div>
        </td></tr>`;
    }
    return '';
}

const acctRedraw = (role) => (role === 'student' ? renderStudents() : renderStaff());
const acctMsgBox = (role) => (role === 'student' ? 'student-msg' : 'staff-msg');

function onAcctClick(e) {
    const open = e.target.closest('[data-acct]');
    if (open) {
        const { acct: mode, role, id } = open.dataset;
        const ui = acctUi(role, id);
        ui.mode = ui.mode === mode ? null : mode;
        acctRedraw(role);
        if (ui.mode === 'stop') document.getElementById('as-' + id)?.focus();
        return;
    }
    const cancel = e.target.closest('[data-acct-cancel]');
    if (cancel) {
        acctUi(cancel.dataset.acctCancel, cancel.dataset.id).mode = null;
        return acctRedraw(cancel.dataset.acctCancel);
    }
    const confirmBtn = e.target.closest('[data-acct-confirm]');
    if (confirmBtn) return confirmAcct(confirmBtn.dataset.role, confirmBtn.dataset.id, confirmBtn.dataset.acctConfirm === 'stop');
}

function onAcctInput(e) {
    const box = e.target.closest('[data-acct-reason]');
    if (!box) return;
    const { acctReason: role, id } = box.dataset;
    acctUi(role, id).reason = box.value;
    const count = document.querySelector(`[data-acct-count="${CSS.escape(role + ':' + id)}"]`);
    if (count) count.textContent = `${box.value.length}/${CurriculogicAccountStop.REASON_MAX}`;
    const err = document.querySelector(`[data-acct-error="${CSS.escape(role + ':' + id)}"]`);
    if (err) err.hidden = true;
}

async function confirmAcct(role, id, stop) {
    if (ACCT_BUSY) return;
    const ui = acctUi(role, id);
    const row = (role === 'student' ? STUDENTS : STAFF).find(r => r.id === id);
    if (!row) return;

    if (stop) {
        const problem = CurriculogicAccountStop.reasonProblem(ui.reason);
        if (problem) {
            const err = document.querySelector(`[data-acct-error="${CSS.escape(role + ':' + id)}"]`);
            if (err) { err.textContent = problem; err.hidden = false; }
            return;
        }
    }

    ACCT_BUSY = true;
    const box = acctMsgBox(role);
    try {
        if (PREVIEW) {
            const seq = PREVIEW_STOP_LOG.length + 1;
            PREVIEW_STOP_LOG.push({ role, target_id: id, action: stop ? 'stop' : 'restore', seq });
        } else {
            const { error } = await supabase.rpc('set_account_stopped', {
                p_role: role, p_target: id, p_stop: stop, p_reason: stop ? ui.reason.trim() : null,
            });
            if (error) { showMsg(box, error.message); return; }
        }
        row.is_approved = !stop;
        delete ACCT_UI[acctKey(role, id)];
        await loadStopLog();
        showMsg(box, stop
            ? `${fullName(row)} is stopped. They cannot sign in until you restore them.`
            : `${fullName(row)} is restored and can sign in again.`, 'success');
        acctRedraw(role);
    } catch (err) {
        console.error('stop/restore failed:', err);
        showMsg(box, 'Could not save that. ' + err.message);
    } finally {
        ACCT_BUSY = false;
    }
}

$('student-body')?.addEventListener('click', onAcctClick);
$('student-body')?.addEventListener('input', onAcctInput);
$('staff-body')?.addEventListener('click', onAcctClick);
$('staff-body')?.addEventListener('input', onAcctInput);


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

const STAFF_PAGE_SIZE = 20;
let STAFF_PAGE = 1;

function renderStaff() {
    const body  = $('staff-body');
    const count = $('staff-count');
    if (!body) return;

    const list = filteredStaff();

    // 20 staff a page; a search or filter change goes back to page 1.
    const pages = Math.max(1, Math.ceil(list.length / STAFF_PAGE_SIZE));
    STAFF_PAGE = Math.min(Math.max(1, STAFF_PAGE), pages);
    const from = (STAFF_PAGE - 1) * STAFF_PAGE_SIZE;
    const shown = list.slice(from, from + STAFF_PAGE_SIZE);

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
                        <th></th>
                    </tr>
                </thead>
                <tbody>
                    ${shown.map(s => {
                        const state = CurriculogicAccountStop.accountState(s.role, s, STOPPED);
                        const badge = CurriculogicAccountStop.stateBadge(s.role, state);
                        return `
                        <tr>
                            <td class="mono">${escapeHtml(s.employee_id || '—')}</td>
                            <td><strong>${escapeHtml(fullName(s) || '—')}</strong></td>
                            <td class="dim">${escapeHtml(s.email || '—')}</td>
                            <td>${ROLE_PILLS[s.role] || '—'}</td>
                            <td>${staffProgramCell(s)}</td>
                            <td><span class="pill ${badge.kind}">${escapeHtml(badge.label)}</span></td>
                            <td class="dim">${daysAgo(s.created_at)}</td>
                            <td>${acctActionCell(s.role, s, state)}</td>
                        </tr>
                        ${acctPanelRow(s.role, s, state, 8)}`;
                    }).join('')}
                </tbody>
            </table>
        </div>
        ${pages > 1 ? `
        <div class="pager">
            <span class="dim">${from + 1}–${from + shown.length} of ${list.length}</span>
            <span class="pager-btns">
                <button type="button" class="btn-small" data-staff-page="prev" ${STAFF_PAGE === 1 ? 'disabled' : ''}>Previous</button>
                <span class="pager-now">Page ${STAFF_PAGE} of ${pages}</span>
                <button type="button" class="btn-small" data-staff-page="next" ${STAFF_PAGE === pages ? 'disabled' : ''}>Next</button>
            </span>
        </div>` : ''}`;
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

    // One row: the programme (a fixed-width pill, so every Edit lines up) and its Edit link.
    return `
        <div class="prog-cell">
            ${mine
                ? `<span class="pill info" title="${escapeHtml(mine.name)}">${escapeHtml(mine.code)}</span>`
                : '<span class="pill waiting" title="No programme assigned">None</span>'}
            <button type="button" class="btn-link" data-program-edit="${escapeHtml(s.id)}" data-role="${escapeHtml(s.role)}">Edit</button>
        </div>`;
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
    const pg = e.target.closest('[data-staff-page]');
    if (pg) {
        if (pg.disabled) return;
        STAFF_PAGE += pg.dataset.staffPage === 'next' ? 1 : -1;
        EDITING_PROGRAM_FOR = null;
        return renderStaff();
    }

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

$('staff-search')?.addEventListener('input', () => { STAFF_PAGE = 1; renderStaff(); });
$('staff-filter')?.addEventListener('change', () => { STAFF_PAGE = 1; renderStaff(); });


/* ---------- students listing ---------- */

function filteredStudents() {
    const term   = ($('student-search')?.value || '').trim().toLowerCase();
    const filter = $('student-filter')?.value || 'all';

    return STUDENTS.filter((s) => {
        // 'approved' now means active: a stopped student is approved on paper but has no access.
        const state = CurriculogicAccountStop.accountState('student', s, STOPPED);
        const status = state === 'active' ? 'approved' : state;
        if (filter !== 'all' && status !== filter) return false;
        if (!term) return true;
        return [s.first_name, s.last_name, s.student_id, s.email]
            .filter(Boolean).join(' ').toLowerCase().includes(term);
    });
}

const STUDENT_PAGE_SIZE = 20;
let STUDENT_PAGE = 1;

function renderStudents() {
    const body  = $('student-body');
    const count = $('student-count');
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
                        <th>Programme</th>
                        <th>Email</th>
                        <th>Status</th>
                        <th>EDP list</th>
                        <th>Requested</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody>
                    ${shown.map(s => {
                        const state = CurriculogicAccountStop.accountState('student', s, STOPPED);
                        const badge = CurriculogicAccountStop.stateBadge('student', state);
                        return `
                        <tr>
                            <td class="mono">${escapeHtml(s.student_id || '—')}</td>
                            <td><strong>${escapeHtml(fullName(s) || '—')}</strong></td>
                            <td>${escapeHtml(PROGRAMS.find(p => p.id === s.program_id)?.code || '—')}</td>
                            <td class="dim">${escapeHtml(s.email || '—')}</td>
                            <td><span class="pill ${badge.kind}">${escapeHtml(badge.label)}</span></td>
                            <td>${edpPill(s)}</td>
                            <td class="dim">${daysAgo(s.created_at)}</td>
                            <td>${acctActionCell('student', s, state)}</td>
                        </tr>
                        ${acctPanelRow('student', s, state, 8)}`;
                    }).join('')}
                </tbody>
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

    ensureStudentEdpStatus(shown);
}

/* Is each student on the EDP list (db/086)? Asked only for the page on screen, then the table is drawn
   again with the badges. Forgotten whenever the list changes. A failed lookup shows no badge. */
const STUDENT_EDP = {};         // student uuid -> 'on_list' | 'not_on_list' | 'no_list'

const edpPill = (s) => {
    const b = CurriculogicExpectedStudents.statusBadge(STUDENT_EDP[s.id]);
    return b.kind ? `<span class="pill ${b.kind}">${escapeHtml(b.label)}</span>` : '<span class="dim">—</span>';
};

async function ensureStudentEdpStatus(rows) {
    const want = rows.map(s => s.id).filter(id => !(id in STUDENT_EDP));
    if (PREVIEW || !supabase || want.length === 0) return;
    const { data, error } = await supabase.rpc('edp_status', { p_ids: want });
    if (error) { console.warn('EDP status lookup failed:', error.message); return; }
    for (const id of want) STUDENT_EDP[id] = null;    // asked once, even if no row comes back
    for (const row of data ?? []) STUDENT_EDP[row.student_uuid] = row.status;
    renderStudents();
}

const forgetStudentEdp = () => { for (const k of Object.keys(STUDENT_EDP)) delete STUDENT_EDP[k]; };

$('student-search')?.addEventListener('input', () => { STUDENT_PAGE = 1; renderStudents(); });
$('student-filter')?.addEventListener('change', () => { STUDENT_PAGE = 1; renderStudents(); });
$('student-body')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-student-page]');
    if (!b || b.disabled) return;
    STUDENT_PAGE += b.dataset.studentPage === 'next' ? 1 : -1;
    renderStudents();
});


/* ---------- create single account ---------- */


async function createAccount() {
    const boxId = 'create-msg';
    showMsg(boxId, '');

    const first      = CurriculogicNameRules.clean($('a-first-name').value);
    const last       = CurriculogicNameRules.clean($('a-last-name').value);
    const email      = CurriculogicEmailRules.clean($('a-email').value);
    const studentId  = $('a-student-id')?.value.trim() ?? '';
    const yearLevel  = $('a-year-level')?.value ?? '';
    const role       = $('a-role').value;
    const password   = $('a-password').value;
    const confirm    = $('a-confirm').value;
    // "link": no password is typed; the person is emailed a one-time link to
    // choose their own (db/072). "password": the old way, a temporary password
    // the admin hands over, kept for when email is not set up.
    const sendLink   = signInMode() === 'link';

    // Validation. Employee ID is only meaningful for staff roles; a
    // student has no employee record at all, so requiring it here was
    // what made the single-account form unable to create a student even
    // after "University Student" is selectable in the dropdown.
    const firstProblem = CurriculogicNameRules.problem(first, 'first name');
    if (firstProblem) return showMsg(boxId, firstProblem);
    const lastProblem = CurriculogicNameRules.problem(last, 'last name');
    if (lastProblem) return showMsg(boxId, lastProblem);
    if (!email)     return showMsg(boxId, 'Enter an email address.');
    const emailProblem = CurriculogicEmailRules.problem(email);
    if (emailProblem) return showMsg(boxId, emailProblem);

    // Staff (faculty, registrar, department) get their EMP- number from the
    // database when the account is created; nothing is typed for them.
    // A student with no ID yet is fine: leave it blank and the database
    // issues one (db/045). A typed ID is checked there (7 digits, unique).

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

    if (!sendLink) {
        const pwProblem = CurriculogicPasswordRules.problem(password, role);
        if (pwProblem) return showMsg(boxId, pwProblem);
        if (password !== confirm) return showMsg(boxId, 'The two passwords do not match.');
    }

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
                employee_id: 'EMP-(assigned on save)',
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
            // A blank password makes the database give the account a random one
            // that nobody sees (db/072); the emailed link replaces it.
            p_password: sendLink ? null : password,
            p_role: role,
            p_employee_id: null,
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
        const assigned = data?.employee_id ? ` Employee ID: ${data.employee_id}.`
            : (role === 'student' && !studentId && data?.student_id)
                ? ` Student ID ${data.student_id} was assigned (they sign in with uc-${data.student_id}).`
                : '';
        if (sendLink) {
            // The account exists whatever happens next, so a failed email is
            // reported on its own and never as a failed creation.
            const mail = await CurriculogicPasswordReset.sendSetupLink(
                supabase, email, CurriculogicPasswordReset.setPasswordUrl(window.location.href));
            showMsg(boxId, mail.ok
                ? `${first} ${last} account created.${assigned} A link to choose a password was emailed to ${email}.`
                : `${first} ${last} account created.${assigned} The setup email could not be sent: ${mail.message} ` +
                  'They can ask for it themselves with "Forgot password" on the login page.',
                mail.ok ? 'success' : 'pending');
        } else {
            showMsg(boxId, `${first} ${last} account created.${assigned} They can now sign in with the temporary password.`, 'success');
        }
        await loadStaff(true);

    } catch (err) {
        console.error(err);
        showMsg(boxId, 'Something went wrong. Please try again.');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-user-plus" aria-hidden="true"></i><span>Create account</span>';
    }
}

/* How the new account gets its password: 'link' (emailed, the default) or
   'password' (a temporary one typed here). */
function signInMode() {
    return document.querySelector('input[name="a-signin"]:checked')?.value ?? 'link';
}

function updateSignInMode() {
    const typed = signInMode() === 'password';
    const fields = $('a-password-fields');
    if (fields) fields.hidden = !typed;
    const sub = $('a-signin-sub');
    if (sub) {
        sub.textContent = typed
            ? 'At least 8 characters with a special character (! @ # $ %). Admin accounts need 12. They will be asked to choose their own at first sign-in.'
            : 'The person is emailed a one-time link to choose their own password. You never see or type it.';
    }
}

document.querySelectorAll('input[name="a-signin"]').forEach(r => r.addEventListener('change', updateSignInMode));

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
        faculty:    { first_name: 'Juan', last_name: 'Dela Cruz', email: 'juan.delacruz@uc.edu.ph', role: 'faculty', employee_id: '', student_id: '', program_code: sampleProgram, department: sampleCollege, year_level: '', password: '', username: '' },
        registrar:  { first_name: 'Maria', last_name: 'Santos', email: 'maria.santos@uc.edu.ph', role: 'registrar', employee_id: '', student_id: '', program_code: sampleProgram, department: 'Office of the Registrar', year_level: '', password: '', username: '' },
        department: { first_name: 'Pedro', last_name: 'Reyes', email: 'pedro.reyes@uc.edu.ph', role: 'department', employee_id: '', student_id: '', program_code: sampleProgram, department: sampleCollege, year_level: '', password: '', username: '' },
        student:    { first_name: 'Althea', last_name: 'Villanueva', email: 'althea.villanueva@uc.edu.ph', role: 'student', employee_id: '', student_id: '2401187', program_code: sampleProgram, department: '', year_level: '2', password: '', username: '' },
        // An admin belongs to no programme, whatever is chosen above.
        admin:      { first_name: 'Alex', last_name: 'Rivera', email: 'alex.rivera@uc.edu.ph', role: 'admin', employee_id: 'SYS-ADMIN02', student_id: '', program_code: '', department: '', year_level: '', password: '', username: 'alex.rivera' },
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

/* ---- the status bar ----
   state: 'working' | 'done' | 'wait' | 'error' | null (hide). The percentage is
   measured work, not an estimate: see shared/js/records/uploadprogress.js. */
function bulkStatus(state, text, percent = null) {
    const box = $('bulk-status');
    if (!box) return;
    if (!state) { box.hidden = true; return; }
    box.hidden = false;
    box.className = 'gu-status' + (state === 'working' ? '' : ' is-' + state);
    setText('bulk-status-text', text);
    const pct = percent == null ? null : Math.max(0, Math.min(100, Math.round(percent)));
    setText('bulk-status-pct', pct == null ? '' : pct + '%');
    const fill = $('bulk-status-fill');
    if (fill) fill.style.width = (pct ?? 0) + '%';
}
const bulkProgress = (u) => bulkStatus('working', u.detail ? `${u.label}: ${u.detail}` : u.label, u.percent);
const yieldToUi = () => new Promise(r => setTimeout(r, 0));
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

async function handleBulkFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    showMsg('bulk-msg', '');

    const t = window.UploadProgress.tracker([
        { id: 'read',  weight: 70, label: 'Reading the file' },
        { id: 'check', weight: 30, label: 'Checking the rows' },
    ]);
    bulkProgress(t.update('read', 0));
    await yieldToUi();                       // let the bar paint before the file is parsed

    try {
        const rows = await readBulkFile(file);
        bulkProgress(t.update('check', 0, plural(rows.length, 'row')));
        await yieldToUi();
        validateBulkRows(rows, file.name);
        bulkStatus('done', `${plural(rows.length, 'row')} read and checked${rows.sheetNote ? ' (' + rows.sheetNote + ')' : ''}`, t.finish().percent);
    } catch (err) {
        console.error('bulk parse failed:', err);
        bulkStatus('error', 'Could not read that file.');
        showMsg('bulk-msg', 'Could not read that file. ' + err.message);
    }
}

async function readBulkFile(file) {
    const fileIssue = CurriculogicUploadLimits.fileProblem(file, 'accounts');
    if (fileIssue) throw new Error(fileIssue);

    if (typeof XLSX === 'undefined') {
        await new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = '../../shared/js/vendor/xlsx.full.min.js';
            s.onload = resolve;
            s.onerror = () => reject(new Error('Spreadsheet library failed to load.'));
            document.head.appendChild(s);
        });
    }

    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array', raw: false, cellDates: false });
    if (!wb.SheetNames.length) throw new Error('File has no readable sheet.');

    // Use the sheet whose header looks like the account columns, not blindly the first one.
    const picked = CurriculogicBulkAccounts.pickSheet(wb.SheetNames.map(name => ({
        name,
        aoa: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', raw: false }).slice(0, 1),
    })));
    if (!picked) {
        throw new Error('No sheet in this file has the account columns (first_name, last_name, email, role...). Download the template and fill it in.');
    }
    const ws = wb.Sheets[picked.name];

    const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });
    if (rows.length === 0) throw new Error('File is empty.');

    const rowsIssue = CurriculogicUploadLimits.rowsProblem(rows.length, 'accounts');
    if (rowsIssue) throw new Error(rowsIssue);

    // Normalize headers
    const parsed = rows.map((r, i) => {
        const out = { __line: i + 2 };
        for (const [k, v] of Object.entries(r)) {
            out[normalizeHeader(k)] = String(v ?? '').trim();
        }
        return out;
    });
    // Which sheet was read, said on the status line when the file had others.
    parsed.sheetNote = picked.skipped.length
        ? `sheet "${picked.name}" used, ${plural(picked.skipped.length, 'other sheet')} skipped`
        : '';
    return parsed;
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
        const first = CurriculogicNameRules.clean(r.first_name);
        const last = CurriculogicNameRules.clean(r.last_name);
        const email = CurriculogicEmailRules.clean(r.email);
        const role = (r.role || '').toLowerCase();
        const employeeId = (r.employee_id || '').toUpperCase();
        const studentId = (r.student_id || '').replace(/[\s-]/g, '');
        const department = r.department || '';
        const yearLevel = r.year_level ? parseInt(r.year_level) : null;
        // A blank password column means "email a setup link" (db/072): the
        // person chooses their own and nobody has to be told one. A typed one
        // is still accepted, for when email is not set up.
        const password = String(r.password ?? '').trim();
        const viaLink  = password === '';
        const username = r.username || '';

        const base = { line: r.__line, first, last, email, role, employeeId, studentId, programCode: '', department, yearLevel, password, viaLink, username };

        // Basic validation
        const firstProblem = first ? CurriculogicNameRules.problem(first, 'first name') : 'Missing first name.';
        if (firstProblem) { bad.push({ ...base, why: firstProblem }); continue; }
        const lastProblem = last ? CurriculogicNameRules.problem(last, 'last name') : 'Missing last name.';
        if (lastProblem) { bad.push({ ...base, why: lastProblem }); continue; }
        if (!email) { bad.push({ ...base, why: 'Missing email.' }); continue; }
        const emailProblem = CurriculogicEmailRules.problem(email);
        if (emailProblem) { bad.push({ ...base, why: emailProblem }); continue; }
        if (!VALID_ROLES.includes(role)) { bad.push({ ...base, why: `"${role}" is not a valid role.` }); continue; }

        // With a programme chosen above the upload, a row for any other
        // programme is rejected here, with the reason, rather than skipped
        // later without a word. A row that leaves its programme blank takes
        // the chosen one.
        const roleCheck = CurriculogicBulkAccounts.roleGate(selectedRole, role);
        if (roleCheck.error) { bad.push({ ...base, why: roleCheck.error }); continue; }

        const gate = CurriculogicBulkAccounts.programmeGate(selectedProgram, role, r.program_code);
        if (gate.error) { bad.push({ ...base, programCode: String(r.program_code || '').trim().toUpperCase(), why: gate.error }); continue; }
        if (!viaLink) {
            const pwProblem = CurriculogicPasswordRules.problem(password, role);
            if (pwProblem) { bad.push({ ...base, why: pwProblem }); continue; }
        }

        // Role-specific validation
        if (role === 'student') {
            // A blank student_id is fine: the database issues the number.
            if (studentId) {
                if (!/^\d{7}$/.test(studentId)) { bad.push({ ...base, why: 'Student ID must be 7 digits, or left blank to be assigned automatically.' }); continue; }
                if (seenStudentIds.has(studentId)) { bad.push({ ...base, why: 'Duplicate student ID in file.' }); continue; }
                seenStudentIds.add(studentId);
            }
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
            if (role === 'admin') {
                if (!/^SYS-[A-Z0-9]{3,12}$/.test(employeeId)) { bad.push({ ...base, why: 'An admin needs an employee ID that starts with SYS- (for example SYS-ADMIN02).' }); continue; }
            } else if (employeeId) {
                bad.push({ ...base, why: 'Leave employee_id blank for faculty, registrar and department staff. It is assigned automatically.' }); continue;
            }
            if (employeeId) {
                if (seenEmployeeIds.has(employeeId)) { bad.push({ ...base, why: 'Duplicate employee ID in file.' }); continue; }
                seenEmployeeIds.add(employeeId);
            }
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
                    <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Program</th><th>ID</th><th>Sign-in</th></tr></thead>
                    <tbody>${filteredOk.slice(0, 10).map(r => `
                        <tr>
                            <td>${escapeHtml(r.first)} ${escapeHtml(r.last)}</td>
                            <td class="mono">${escapeHtml(r.email)}</td>
                            <td><span class="pill ${r.role === 'student' ? 'info' : r.role === 'admin' ? 'bad' : 'waiting'}">${escapeHtml(r.role)}</span></td>
                            <td class="mono">${escapeHtml(r.programCode || '—')}</td>
                            <td class="mono">${escapeHtml(r.studentId || r.employeeId || r.username || '—')}</td>
                            <td class="${r.viaLink ? '' : 'mono '}dim">${r.viaLink ? 'Setup link by email' : escapeHtml(r.password)}</td>
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

    const total = toCreate.length;
    const t = window.UploadProgress.tracker([
        { id: 'create',  weight: 55, label: 'Creating accounts' },
        { id: 'email',   weight: 40, label: 'Emailing setup links' },
        { id: 'history', weight: 5,  label: 'Saving the upload history' },
    ]);
    bulkProgress(t.update('create', 0, `0 of ${total}`));
    await yieldToUi();

    for (const [i, row] of toCreate.entries()) {
        // i accounts are finished before this one starts
        bulkProgress(t.update('create', window.UploadProgress.fraction(i, total), `${i} of ${total}`));
        try {
            if (PREVIEW) {
                // Just simulate success in preview, slowly enough to see the bar
                await new Promise(r => setTimeout(r, 120));
                success.push(row);
                continue;
            }

            const params = {
                p_first_name: row.first,
                p_last_name: row.last,
                p_email: row.email,
                p_password: row.viaLink ? null : row.password,
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

    bulkProgress(t.update('create', 1, `${total} of ${total}`));

    // Setup links, one email per account. A failed email never undoes an
    // account: it is shown in the result, and the person can ask for the link
    // again with "Forgot password". When the sender says its limit is reached
    // the rest are marked and skipped, instead of failing one by one.
    const toMail = success.filter(r => r.viaLink);
    if (toMail.length) {
        const redirectTo = CurriculogicPasswordReset.setPasswordUrl(window.location.href);
        let stopped = null;
        for (const [i, row] of toMail.entries()) {
            bulkProgress(t.update('email', window.UploadProgress.fraction(i, toMail.length), `${i} of ${toMail.length}`));
            if (stopped) { row.mail = { ok: false, message: stopped }; continue; }

            row.mail = PREVIEW
                ? { ok: true }
                : await CurriculogicPasswordReset.sendSetupLink(supabase, row.email, redirectTo);

            // Rate limit reached, or the sender itself is broken: every further
            // row would fail the same way, so mark them without trying.
            if (!row.mail.ok && /Too many emails|check the email settings/.test(row.mail.message)) stopped = row.mail.message;
            if (!PREVIEW) await new Promise(r => setTimeout(r, 700));
        }
    }
    bulkProgress(t.update('email', 1, `${toMail.length} of ${toMail.length}`));
    const mailed     = toMail.filter(r => r.mail?.ok).length;
    const notMailed  = toMail.length - mailed;

    // Save history (if not preview)
    if (!PREVIEW) {
        bulkProgress(t.update('history', 0));
        await saveBulkHistory(fileName, success.length, failed.length);
    }

    const finished = t.finish();
    bulkStatus(
        failed.length ? 'wait' : 'done',
        failed.length
            ? `Created ${success.length} of ${total}, ${failed.length} failed`
            : `Created ${plural(success.length, 'account')}`,
        finished.percent,
    );

    // Render results
    const box = $('bulk-preview');
    if (box) {
        box.innerHTML = `
            <div class="notice ${failed.length ? 'pending' : 'success'}">
                <i class="fa-solid ${failed.length ? 'fa-triangle-exclamation' : 'fa-circle-check'}" aria-hidden="true"></i>
                <div>
                    <strong>${success.length} account${success.length === 1 ? '' : 's'} created${failed.length ? `, ${failed.length} failed` : ''}</strong>
                    ${toMail.length ? `<br>${mailed} setup link${mailed === 1 ? '' : 's'} emailed${notMailed ? `, ${notMailed} not sent (the account exists; the person can use "Forgot password" on the login page)` : ''}.` : ''}
                </div>
            </div>
            ${success.length ? `
                <div class="table-wrap" style="margin-top:var(--s2);">
                    <table class="data-table">
                        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Sign-in</th></tr></thead>
                        <tbody>${success.map(s => `
                            <tr>
                                <td>${escapeHtml(s.first)} ${escapeHtml(s.last)}</td>
                                <td class="mono">${escapeHtml(s.email)}</td>
                                <td><span class="pill info">${escapeHtml(s.role)}</span></td>
                                ${s.viaLink
                                    ? (s.mail?.ok
                                        ? '<td><span class="pill ok">Link emailed</span></td>'
                                        : `<td><span class="pill waiting">Not sent</span> <span class="dim">${escapeHtml(s.mail?.message ?? '')}</span></td>`)
                                    : `<td class="mono dim">${escapeHtml(s.password)}</td>`}
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
            file_name: String(fileName ?? '').slice(0, 255),
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


/* ---------- EDP student list (db/084) ---------- */

/* The students the EDP office has confirmed. Self-registration is checked against this later. An upload
   adds new IDs and updates the ones already there; it never removes anyone. */

const EDP_PAGE_SIZE = 20;
const EDP_BATCH = 500;
let EDP = [];                  // rows as stored, each with program_code added
let EDP_OK = [];               // rows of the file that passed, waiting for "Save"
let EDP_BAD = [];
let EDP_FILE = '';
let EDP_PAGE = 1;
let EDP_ARMED = null;          // student_id whose Delete button is waiting for its second click
let edpInitialized = false;

function initEdpList() {
    if (!edpInitialized) {
        edpInitialized = true;
        $('edp-file')?.addEventListener('change', handleEdpFile);
        $('edp-template')?.addEventListener('click', downloadEdpTemplate);
        $('edp-search')?.addEventListener('input', () => { EDP_PAGE = 1; EDP_ARMED = null; renderEdpList(); });
        $('edp-body')?.addEventListener('click', onEdpBodyClick);
        $('edp-find')?.addEventListener('click', findEdpAccountsToCreate);
        $('edp-create-preview')?.addEventListener('click', onEdpCreateClick);
        setText('edp-batch-size', String(EDP_CREATE_BATCH));
    }
    loadEdpList();
}

async function loadEdpList() {
    if (PREVIEW) { renderEdpList(); return; }
    if (!supabase) return;

    if (!PROGRAMS_READY) {
        const prog = await supabase.from('program').select('id, code, name');
        if (!prog.error) { PROGRAMS = prog.data ?? []; PROGRAMS_READY = true; }
    }

    // The server returns at most 1000 rows a request, so read the list in pages of that size.
    const rows = [];
    for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase
            .from('expected_student')
            .select('student_id, first_name, last_name, program_id, email, year_level, updated_at')
            .order('student_id')
            .range(from, from + 999);
        if (error) {
            console.warn('EDP list load failed:', error.message);
            showMsg('edp-msg', 'Could not load the list. ' + error.message);
            return;
        }
        rows.push(...data);
        if (data.length < 1000) break;
    }
    EDP = rows.map(r => ({ ...r, program_code: PROGRAMS.find(p => p.id === r.program_id)?.code ?? '' }));
    renderEdpList();
}

const edpIds = () => new Set(EDP.map(r => r.student_id));
const edpRegistered = () => new Set(STUDENTS.map(s => s.student_id).filter(Boolean));

function renderEdpList() {
    const body  = $('edp-body');
    const count = $('edp-count');
    if (!body) return;

    const list = CurriculogicExpectedStudents.search(EDP, $('edp-search')?.value);
    const pages = Math.max(1, Math.ceil(list.length / EDP_PAGE_SIZE));
    EDP_PAGE = Math.min(Math.max(1, EDP_PAGE), pages);
    const from = (EDP_PAGE - 1) * EDP_PAGE_SIZE;
    const shown = list.slice(from, from + EDP_PAGE_SIZE);

    if (count) count.textContent = EDP.length ? `${list.length} of ${EDP.length}` : '';

    if (EDP.length === 0) {
        body.innerHTML = `
            <div class="empty">
                <i class="fa-solid fa-clipboard-list" aria-hidden="true"></i>
                <h3>The list is empty</h3>
                <p>Upload the file EDP sent you and the students will appear here.</p>
            </div>`;
        return;
    }
    if (list.length === 0) {
        body.innerHTML = `
            <div class="empty">
                <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
                <h3>No matches</h3>
                <p>No one on the list matches that search.</p>
            </div>`;
        return;
    }

    const registered = edpRegistered();
    body.innerHTML = `
        <div class="table-wrap">
            <table class="data-table">
                <thead>
                    <tr>
                        <th>Student ID</th>
                        <th>Name</th>
                        <th>Programme</th>
                        <th>Year</th>
                        <th>Email on file</th>
                        <th>Account</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody>
                    ${shown.map(s => `
                    <tr>
                        <td class="mono">${escapeHtml(s.student_id)}</td>
                        <td><strong>${escapeHtml(fullName(s))}</strong></td>
                        <td>${escapeHtml(s.program_code || '—')}</td>
                        <td>${s.year_level ? escapeHtml(String(s.year_level)) : '<span class="dim">—</span>'}</td>
                        <td class="dim">${escapeHtml(s.email)}</td>
                        <td>${registered.has(s.student_id) ? '<span class="pill ok">Registered</span>' : '<span class="pill waiting">Not yet</span>'}</td>
                        <td>
                            <button type="button" class="btn-small" data-edp-delete="${escapeHtml(s.student_id)}">
                                ${EDP_ARMED === s.student_id ? 'Click again to remove' : 'Remove'}
                            </button>
                        </td>
                    </tr>`).join('')}
                </tbody>
            </table>
        </div>
        ${pages > 1 ? `
        <div class="pager">
            <span class="dim">${from + 1}–${from + shown.length} of ${list.length}</span>
            <span class="pager-btns">
                <button type="button" class="btn-small" data-edp-page="prev" ${EDP_PAGE === 1 ? 'disabled' : ''}>Previous</button>
                <span class="pager-now">Page ${EDP_PAGE} of ${pages}</span>
                <button type="button" class="btn-small" data-edp-page="next" ${EDP_PAGE === pages ? 'disabled' : ''}>Next</button>
            </span>
        </div>` : ''}`;
}

async function onEdpBodyClick(e) {
    const pageBtn = e.target.closest('[data-edp-page]');
    if (pageBtn && !pageBtn.disabled) {
        EDP_PAGE += pageBtn.dataset.edpPage === 'next' ? 1 : -1;
        EDP_ARMED = null;
        renderEdpList();
        return;
    }

    const del = e.target.closest('[data-edp-delete]');
    if (!del) return;
    const id = del.dataset.edpDelete;

    // Removing someone is not undone by an upload, so it takes a second click.
    if (EDP_ARMED !== id) { EDP_ARMED = id; renderEdpList(); return; }
    EDP_ARMED = null;

    if (!PREVIEW) {
        const { error } = await supabase.from('expected_student').delete().eq('student_id', id);
        if (error) { showMsg('edp-msg', 'Could not remove that student. ' + error.message); renderEdpList(); return; }
    }
    EDP = EDP.filter(r => r.student_id !== id);
    forgetStudentEdp();
    showMsg('edp-msg', `Student ${id} removed from the list.`, 'success');
    renderEdpList();
}

function downloadEdpTemplate() {
    const code = PROGRAMS[0]?.code ?? '';
    const rows = [{ student_id: '2401187', first_name: 'Althea', last_name: 'Villanueva', program_code: code, email: 'althea.villanueva@uc.edu.ph', year_level: '2' }];
    const ws = XLSX.utils.json_to_sheet(rows, { header: CurriculogicExpectedStudents.COLUMNS });
    ws['!cols'] = [{ wch: 14 }, { wch: 16 }, { wch: 20 }, { wch: 14 }, { wch: 32 }, { wch: 12 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'EDP list');
    XLSX.writeFile(wb, 'edp-student-list-template.xlsx');
}

function edpStatus(state, text, percent = null) {
    const box = $('edp-status');
    if (!box) return;
    if (!state) { box.hidden = true; return; }
    box.hidden = false;
    box.className = 'gu-status' + (state === 'working' ? '' : ' is-' + state);
    setText('edp-status-text', text);
    const pct = percent == null ? null : Math.max(0, Math.min(100, Math.round(percent)));
    setText('edp-status-pct', pct == null ? '' : pct + '%');
    const fill = $('edp-status-fill');
    if (fill) fill.style.width = (pct ?? 0) + '%';
}
const edpProgress = (u) => edpStatus('working', u.detail ? `${u.label}: ${u.detail}` : u.label, u.percent);

async function handleEdpFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    showMsg('edp-msg', '');
    EDP_OK = []; EDP_BAD = [];
    $('edp-preview').innerHTML = '';

    const t = window.UploadProgress.tracker([
        { id: 'read',  weight: 70, label: 'Reading the file' },
        { id: 'check', weight: 30, label: 'Checking the rows' },
    ]);
    edpProgress(t.update('read', 0));
    await yieldToUi();

    try {
        const rows = await readEdpFile(file);
        edpProgress(t.update('check', 0, plural(rows.length, 'row')));
        await yieldToUi();
        const { ok, bad } = CurriculogicExpectedStudents.checkRows(rows, PROGRAMS, edpIds());
        EDP_OK = ok; EDP_BAD = bad; EDP_FILE = file.name;
        renderEdpPreview();
        edpStatus('done', `${plural(rows.length, 'row')} read and checked${rows.sheetNote ? ' (' + rows.sheetNote + ')' : ''}`, t.finish().percent);
    } catch (err) {
        console.error('EDP list parse failed:', err);
        edpStatus('error', 'Could not read that file.');
        showMsg('edp-msg', 'Could not read that file. ' + err.message);
    }
}

async function readEdpFile(file) {
    const fileIssue = CurriculogicUploadLimits.fileProblem(file, 'edplist');
    if (fileIssue) throw new Error(fileIssue);
    if (!PROGRAMS_READY && !PREVIEW && supabase) {
        const prog = await supabase.from('program').select('id, code, name');
        if (!prog.error) { PROGRAMS = prog.data ?? []; PROGRAMS_READY = true; }
    }

    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', raw: false, cellDates: false });
    if (!wb.SheetNames.length) throw new Error('File has no readable sheet.');

    const picked = CurriculogicExpectedStudents.pickSheet(wb.SheetNames.map(name => ({
        name,
        aoa: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', raw: false }).slice(0, 1),
    })));
    if (!picked) {
        throw new Error('No sheet in this file has the columns student_id and email. Download the template and fill it in.');
    }

    // raw:false returns what the cell shows, so a student ID stored as a number keeps its digits.
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[picked.name], { defval: '', raw: false });
    if (rows.length === 0) throw new Error('File is empty.');
    const rowsIssue = CurriculogicUploadLimits.rowsProblem(rows.length, 'edplist');
    if (rowsIssue) throw new Error(rowsIssue);

    const parsed = rows.map((r, i) => {
        const out = { __line: i + 2 };
        for (const [k, v] of Object.entries(r)) out[normalizeHeader(k)] = String(v ?? '').trim();
        return out;
    });
    parsed.sheetNote = picked.skipped.length
        ? `sheet "${picked.name}" used, ${plural(picked.skipped.length, 'other sheet')} skipped`
        : '';
    return parsed;
}

function renderEdpPreview() {
    const box = $('edp-preview');
    if (!box) return;
    const ok = EDP_OK, bad = EDP_BAD;
    const updates = ok.filter(r => r.isUpdate).length;
    const adds = ok.length - updates;

    box.innerHTML = `
        <div class="notice ${bad.length ? 'pending' : 'info'}">
            <i class="fa-solid ${bad.length ? 'fa-triangle-exclamation' : 'fa-circle-info'}" aria-hidden="true"></i>
            <div>
                <strong>${plural(ok.length, 'student')} ready${bad.length ? `, ${bad.length} rejected` : ''}</strong>
                <span class="dim"> · ${escapeHtml(EDP_FILE)}${ok.length ? ` · ${adds} new, ${updates} updated` : ''}</span>
            </div>
        </div>`;

    if (bad.length) {
        box.innerHTML += `
            <h3 class="group-head" style="margin-top:var(--s3);">Rejected rows</h3>
            <div class="table-wrap">
                <table class="data-table">
                    <thead><tr><th>Line</th><th>Student ID</th><th>Name</th><th>Reason</th></tr></thead>
                    <tbody>${bad.slice(0, 10).map(b => `
                        <tr>
                            <td class="num">${b.line}</td>
                            <td class="mono">${escapeHtml(b.studentId || '—')}</td>
                            <td>${escapeHtml(b.first)} ${escapeHtml(b.last)}</td>
                            <td>${escapeHtml(b.why)}</td>
                        </tr>`).join('')}</tbody>
                </table>
                ${bad.length > 10 ? `<p class="dim" style="margin-top:var(--s2);">and ${bad.length - 10} more</p>` : ''}
            </div>`;
    }

    if (ok.length) {
        box.innerHTML += `
            <h3 class="group-head" style="margin-top:var(--s3);">Ready to save (${ok.length})</h3>
            <div class="table-wrap">
                <table class="data-table">
                    <thead><tr><th>Student ID</th><th>Name</th><th>Programme</th><th>Email</th><th></th></tr></thead>
                    <tbody>${ok.slice(0, 10).map(r => `
                        <tr>
                            <td class="mono">${escapeHtml(r.studentId)}</td>
                            <td>${escapeHtml(r.first)} ${escapeHtml(r.last)}</td>
                            <td>${escapeHtml(r.programCode)}</td>
                            <td class="dim">${escapeHtml(r.email)}</td>
                            <td>${r.isUpdate ? '<span class="pill info">Update</span>' : '<span class="pill ok">New</span>'}</td>
                        </tr>`).join('')}</tbody>
                </table>
                ${ok.length > 10 ? `<p class="dim" style="margin-top:var(--s2);">and ${ok.length - 10} more</p>` : ''}
            </div>
            <button class="btn-accent" id="edp-commit" style="margin-top:var(--s3);">
                <i class="fa-solid fa-check" aria-hidden="true"></i>
                <span>Save ${plural(ok.length, 'student')} to the list</span>
            </button>`;
    }

    $('edp-commit')?.addEventListener('click', commitEdpList);
}

async function commitEdpList() {
    if (EDP_OK.length === 0) return;
    const btn = $('edp-commit');
    if (btn) btn.disabled = true;

    const total = EDP_OK.length;
    const t = window.UploadProgress.tracker([{ id: 'save', weight: 100, label: 'Saving the list' }]);
    edpProgress(t.update('save', 0, `0 of ${total}`));

    const now = new Date().toISOString();
    const records = EDP_OK.map(r => ({
        student_id: r.studentId, first_name: r.first, last_name: r.last,
        program_id: r.programId, email: r.email, year_level: r.yearLevel, updated_at: now,
    }));

    try {
        if (!PREVIEW) {
            for (let i = 0; i < records.length; i += EDP_BATCH) {
                const { error } = await supabase.from('expected_student').upsert(records.slice(i, i + EDP_BATCH), { onConflict: 'student_id' });
                if (error) throw new Error(error.message);
                edpProgress(t.update('save', window.UploadProgress.fraction(Math.min(i + EDP_BATCH, total), total), `${Math.min(i + EDP_BATCH, total)} of ${total}`));
            }
        }
    } catch (err) {
        console.error('EDP list save failed:', err);
        edpStatus('error', 'Saving stopped.');
        showMsg('edp-msg', 'Could not save the list. ' + err.message + ' Rows saved before the error stay saved; upload the file again to finish.');
        if (btn) btn.disabled = false;
        await loadEdpList();
        return;
    }

    const adds = EDP_OK.filter(r => !r.isUpdate).length;
    const updates = total - adds;
    if (PREVIEW) {
        const byId = new Map(EDP.map(r => [r.student_id, r]));
        for (const r of records) byId.set(r.student_id, { ...r, program_code: PROGRAMS.find(p => p.id === r.program_id)?.code ?? '' });
        EDP = [...byId.values()];
    }
    EDP_OK = []; EDP_BAD = [];
    forgetStudentEdp();
    $('edp-preview').innerHTML = '';
    $('edp-file').value = '';
    edpStatus('done', `${plural(total, 'student')} saved`, 100);
    showMsg('edp-msg', `Saved: ${adds} new, ${updates} updated.`, 'success');
    if (!PREVIEW) await loadEdpList(); else renderEdpList();
}


/* ---- create accounts from the list ----
   A listed student gets a pre-approved account (create_user_account, the same path as the bulk upload) and
   a setup link at the address EDP has on file. Opening that link and choosing a password is what proves
   the person is the student, so the Registrar's approval is not needed for them. Self-registration stays,
   for everyone who is not on the list. At most EDP_CREATE_BATCH accounts a go: the email sender has hourly
   and daily limits, and a second click picks up the rest. */

const EDP_CREATE_BATCH = 50;
let EDP_TODO = null;           // { create, skipped, later } from the last check
let EDP_CREATE_ARMED = false;  // the create button is waiting for its second click

/* Which of these students already have an account, by student ID or by email. Asked of the database, not
   of the Students list on screen, which may not hold everyone. */
async function findTakenAccounts(rows) {
    const ids = new Set(), emails = new Set();
    if (PREVIEW) {
        STUDENTS.forEach(s => { if (s.student_id) ids.add(s.student_id); if (s.email) emails.add(s.email.toLowerCase()); });
        return { ids, emails };
    }
    for (let i = 0; i < rows.length; i += 200) {
        const chunk = rows.slice(i, i + 200);
        const [byId, byEmail] = await Promise.all([
            supabase.from('university_student').select('student_id').in('student_id', chunk.map(r => r.student_id)),
            supabase.from('university_student').select('email').in('email', chunk.map(r => r.email.toLowerCase())),
        ]);
        if (byId.error) throw new Error(byId.error.message);
        if (byEmail.error) throw new Error(byEmail.error.message);
        byId.data.forEach(r => ids.add(r.student_id));
        byEmail.data.forEach(r => emails.add(String(r.email).toLowerCase()));
    }
    return { ids, emails };
}

async function findEdpAccountsToCreate() {
    const box = $('edp-create-preview');
    if (!box) return;
    EDP_CREATE_ARMED = false;
    showMsg('edp-msg', '');
    if (EDP.length === 0) { box.innerHTML = ''; return showMsg('edp-msg', 'The list is empty. Upload the EDP file first.'); }

    box.innerHTML = '<p class="dim" style="margin-top:var(--s2);">Checking…</p>';
    try {
        const taken = await findTakenAccounts(EDP);
        EDP_TODO = CurriculogicExpectedStudents.accountCandidates(EDP, taken.ids, taken.emails, EDP_CREATE_BATCH);
    } catch (err) {
        console.error('EDP account check failed:', err);
        box.innerHTML = '';
        return showMsg('edp-msg', 'Could not check the existing accounts. ' + err.message);
    }
    renderEdpCreatePreview();
}

function renderEdpCreatePreview() {
    const box = $('edp-create-preview');
    if (!box || !EDP_TODO) return;
    const { create, skipped, later } = EDP_TODO;

    let html = `
        <div class="notice ${create.length ? 'info' : 'pending'}" style="margin-top:var(--s2);">
            <i class="fa-solid ${create.length ? 'fa-circle-info' : 'fa-circle-check'}" aria-hidden="true"></i>
            <div>
                <strong>${create.length
                    ? `${plural(create.length, 'account')} can be created now`
                    : 'Nobody on the list needs an account'}</strong>
                <span class="dim">${skipped.length ? ` · ${skipped.length} skipped (already have one)` : ''}${later ? ` · ${later} more after this batch` : ''}</span>
            </div>
        </div>`;

    if (create.length) {
        html += `
            <div class="table-wrap">
                <table class="data-table">
                    <thead><tr><th>Student ID</th><th>Name</th><th>Programme</th><th>Year</th><th>Setup link goes to</th></tr></thead>
                    <tbody>${create.slice(0, 10).map(r => `
                        <tr>
                            <td class="mono">${escapeHtml(r.student_id)}</td>
                            <td>${escapeHtml(fullName(r))}</td>
                            <td>${escapeHtml(r.program_code || '—')}</td>
                            <td>${r.year_level ? escapeHtml(String(r.year_level)) : '<span class="dim">—</span>'}</td>
                            <td class="dim">${escapeHtml(r.email)}</td>
                        </tr>`).join('')}</tbody>
                </table>
                ${create.length > 10 ? `<p class="dim" style="margin-top:var(--s2);">and ${create.length - 10} more</p>` : ''}
            </div>
            <button class="btn-accent" id="edp-create" style="margin-top:var(--s3);">
                <i class="fa-solid fa-user-plus" aria-hidden="true"></i>
                <span>${EDP_CREATE_ARMED
                    ? `Click again to create ${plural(create.length, 'account')} and send ${plural(create.length, 'email')}`
                    : `Create ${plural(create.length, 'account')} and email the setup links`}</span>
            </button>`;
    }
    box.innerHTML = html;
}

async function onEdpCreateClick(e) {
    if (!e.target.closest('#edp-create')) return;
    // Creating accounts and sending email cannot be taken back, so it takes a second click.
    if (!EDP_CREATE_ARMED) { EDP_CREATE_ARMED = true; return renderEdpCreatePreview(); }
    EDP_CREATE_ARMED = false;
    await createEdpAccounts();
}

async function createEdpAccounts() {
    const todo = EDP_TODO?.create ?? [];
    if (todo.length === 0) return;
    const btn = $('edp-create');
    if (btn) btn.disabled = true;

    const dep = resolveDepartment('student', '');
    const total = todo.length;
    const t = window.UploadProgress.tracker([
        { id: 'create', weight: 55, label: 'Creating accounts' },
        { id: 'email',  weight: 40, label: 'Emailing setup links' },
        { id: 'history', weight: 5, label: 'Saving the history' },
    ]);
    edpProgress(t.update('create', 0, `0 of ${total}`));
    await yieldToUi();

    const success = [], failed = [];
    for (const [i, row] of todo.entries()) {
        edpProgress(t.update('create', window.UploadProgress.fraction(i, total), `${i} of ${total}`));
        if (PREVIEW) { await new Promise(r => setTimeout(r, 80)); success.push(row); continue; }
        try {
            const { error } = await supabase.rpc('create_user_account', {
                p_first_name: row.first_name,
                p_last_name: row.last_name,
                p_email: row.email,
                p_password: null,                       // a random one nobody sees; they choose their own
                p_role: 'student',
                p_student_id: row.student_id,
                p_department: dep.value ?? '',
                p_year_level: row.year_level ? String(row.year_level) : null,
                p_program_code: row.program_code,
                p_declared_path: 'existing',
            });
            if (error) failed.push({ ...row, why: error.message }); else success.push(row);
        } catch (err) {
            failed.push({ ...row, why: err.message });
        }
    }
    edpProgress(t.update('create', 1, `${total} of ${total}`));

    // One setup link per account. A failed email never undoes an account: the person can ask for the link
    // again with "Forgot password". When the sender says its limit is reached the rest are marked and skipped.
    const redirectTo = CurriculogicPasswordReset.setPasswordUrl(window.location.href);
    let stopped = null;
    for (const [i, row] of success.entries()) {
        edpProgress(t.update('email', window.UploadProgress.fraction(i, success.length), `${i} of ${success.length}`));
        if (stopped) { row.mail = { ok: false, message: stopped }; continue; }
        row.mail = PREVIEW ? { ok: true } : await CurriculogicPasswordReset.sendSetupLink(supabase, row.email, redirectTo);
        if (!row.mail.ok && /Too many emails|check the email settings/.test(row.mail.message)) stopped = row.mail.message;
        if (!PREVIEW) await new Promise(r => setTimeout(r, 700));
    }
    edpProgress(t.update('email', 1, `${success.length} of ${success.length}`));
    const mailed = success.filter(r => r.mail?.ok).length;
    const notMailed = success.length - mailed;

    edpProgress(t.update('history', 0));
    await saveBulkHistory('EDP list: create accounts', success.length, failed.length);

    edpStatus(failed.length ? 'wait' : 'done',
        failed.length ? `Created ${success.length} of ${total}, ${failed.length} failed` : `Created ${plural(success.length, 'account')}`,
        t.finish().percent);

    // What happened, and what to do about anything that did not work.
    const box = $('edp-create-preview');
    if (box) {
        box.innerHTML = `
            <div class="notice ${failed.length || notMailed ? 'pending' : 'success'}" style="margin-top:var(--s2);">
                <i class="fa-solid ${failed.length || notMailed ? 'fa-triangle-exclamation' : 'fa-circle-check'}" aria-hidden="true"></i>
                <div>
                    <strong>${plural(success.length, 'account')} created, ${mailed} emailed${failed.length ? `, ${failed.length} failed` : ''}</strong>
                    ${notMailed ? `<div>${plural(notMailed, 'person')} did not get the email${stopped ? ` (${escapeHtml(stopped)})` : ''}. They can use "Forgot password" on the sign-in page to get a link.</div>` : ''}
                </div>
            </div>
            ${failed.length ? `
            <div class="table-wrap">
                <table class="data-table">
                    <thead><tr><th>Student ID</th><th>Name</th><th>Reason</th></tr></thead>
                    <tbody>${failed.slice(0, 10).map(f => `
                        <tr><td class="mono">${escapeHtml(f.student_id)}</td><td>${escapeHtml(fullName(f))}</td><td>${escapeHtml(f.why)}</td></tr>`).join('')}</tbody>
                </table>
                ${failed.length > 10 ? `<p class="dim" style="margin-top:var(--s2);">and ${failed.length - 10} more</p>` : ''}
            </div>` : ''}`;
    }
    EDP_TODO = null;
    forgetStudentEdp();
    showMsg('edp-msg', `${plural(success.length, 'account')} created from the list.`, 'success');
    if (!PREVIEW) { await loadStudents(); renderEdpList(); } else renderEdpList();
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
        await loadTermConfig();
        await loadStopLog();
        renderStudents(); renderStaff();
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
    loadPhoto();
    syncEmailFromAuth(session.user.email);
    renderNotice(admin);
    window.CurriculogicForcePassword?.run(supabase, 'admin');

    await loadStaff();
    await loadStudents();
    await loadTermConfig();
    await loadStopLog();
    renderStudents(); renderStaff();
    renderSystemStatus();
    initBulkUpload();

    route();
})();

})();