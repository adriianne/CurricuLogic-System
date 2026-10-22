// registrardashboard.js
// Registrar Staff: account approval and record verification.
//
// This module removes the manual bottleneck — until now, approving a
// student account required someone running SQL by hand.
//
// Requires config.js to be loaded first.

(function () {
'use strict';

const { SUPABASE_URL, SUPABASE_ANON_KEY, authStorageKey, authOptions } = window.CURRICULOGIC ?? {};

// Bucketed storage key (see config.js) -- registrar, faculty and
// department share the "staff" bucket, since they already share one
// login page/form; this just keeps that bucket separate from student
// and admin sessions in other tabs.
const supabase = (window.supabase && SUPABASE_URL && SUPABASE_ANON_KEY)
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: authOptions ? authOptions(['registrar_staff']) : { storageKey: authStorageKey?.(['registrar_staff']) },
    })
    : null;

/* The term helper reads system_config with this signed-in client (db/052). */
window.CurriculogicTerm?.setClient(supabase);

const $ = (id) => document.getElementById(id);

const LOGIN_PAGE = '../auth/html/staffloginpage.html';

let AUTH_UID      = null;
let REGISTRAR     = null;   // registrar_staff row
let REGISTRAR_ID  = null;   // registrar_staff.id — the FK target, not user_id
let STUDENTS      = [];
let PREVIEW       = false;
let ADVISING_COUNT = 0;   // requests approved by Faculty, awaiting Registrar


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

const PREVIEW_PLANS = {
    s1: [{
        id: 'p1', status: 'approved', registrar_status: null, requested_term: 1, requested_year: 2023, created_at: '2026-10-01T03:00:00Z',
        request_item: [
            { id: 'i1', status: 'approved', subject: { code: 'CC-INTCOM11', title: 'Introduction to Computing', units: 3 }, offering: { section: 'BSIT-1A', schedule_days: 'MW', start_time: '10:00:00', end_time: '11:30:00' } },
            { id: 'i2', status: 'approved', subject: { code: 'ENTREP 101', title: 'The Entrepreneurial Mind', units: 3 }, offering: { section: 'BSIT-1A', schedule_days: 'TTH', start_time: '08:00:00', end_time: '09:30:00' } },
            { id: 'i3', status: 'approved', subject: { code: 'MATH 101', title: 'Mathematics in the Modern World', units: 3 }, offering: { section: 'BSIT-1A', schedule_days: 'MW', start_time: '13:00:00', end_time: '14:30:00' } },
        ],
    }],
};

function previewRequested() {
    if (!PREVIEW_HOSTS.includes(window.location.hostname)) return false;
    return new URLSearchParams(window.location.search).has('preview');
}


/* view routing */

const VIEWS = {
    dashboard: 'Dashboard',
    advising:  'Approved plans',
    requests:  'Account requests',
    students:  'Students',
    student:   'Student detail',
    prospectus:'Prospectus',
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

    if (name === 'requests') { renderRequests(); ensureMatchPool(); }
    if (name === 'students') openStudentList();
    if (name === 'student' && param) openStudent(param);
    if (name === 'prospectus') loadProspectus();

    if (name === 'advising') {
        const inDetail = !!param;
        const queueEl  = $('adv-sub-queue');
        const detailEl = $('adv-sub-detail');
        if (queueEl)  queueEl.hidden  = inDetail;
        if (detailEl) detailEl.hidden = !inDetail;
        if (inDetail) loadAdvisingDetail(param);
        else          loadAdvisingQueue();
    }
}

/* prospectus */

/* Read-only. The Registrar verifies academic records, and a record only
   means something against the curriculum it is measured by — so the
   version picker matters here as much as the grid. Authoring stays with
   Department Staff; there is no write path on this page. */


async function loadProspectus() {
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

    // Every published version, active or older: a student may still be on an
    // older curriculum. Drafts are the department's work in progress and are
    // never requested (see ProspectusGrid.mountVersions).
    await window.ProspectusGrid.mountVersions(supabase, {
        select: sel, body, title: $('pros-title'),
    });
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

/* One number on the dashboard: set as usual, then counted up from what is
   shown (or from 0 the first time). See shared/js/motion.js. */
function setStat(id, n, className) {
    const el = $(id);
    if (!el) return;
    const before = el.textContent.trim();
    setText(id, String(n), className);
    el.textContent = /^\d+$/.test(before) ? before : '0';
    window.CurriculogicMotion?.countUp(el, n);
}

/* A student's degree, looked up from their program_id rather than typed.
   No programme set reads "—". Preview has no database, so it shows the
   sample programme its fixtures describe. */
function programName(row) {
    return window.CurriculogicPrograms?.nameOf(row?.program_id, PREVIEW ? 'BS Information Technology' : '—')
        ?? '—';
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
    // An empty message must never carry error styling (same fix already
    // applied on Faculty/Department's showMsg).
    box.className = text ? 'msg ' + type : 'msg';
}


/* profile */

/* Profile photo: stored privately per account (db/064), helpers in
   shared/js/profilephoto.js. Preview has no storage, so a picture chosen there
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

function renderProfile(staff, authEmail) {
    const full  = fullName(staff);
    const email = staff?.email || authEmail || '—';

    PHOTO_INITIALS = initials(staff?.first_name, staff?.last_name, email);
    window.CurriculogicPhoto.paint($('avatar'), PHOTO_URL, PHOTO_INITIALS);
    window.CurriculogicPhoto.paint($('prof-avatar'), PHOTO_URL, PHOTO_INITIALS);
    $('user-name').textContent = full || email;
    $('user-sub').textContent  = staff?.employee_id || '';
    $('greeting').textContent  = staff?.first_name ? `Welcome back, ${staff.first_name}` : 'Welcome back';

    setText('prof-name', full || email);
    setText('prof-sub',  [staff?.employee_id, 'Registrar staff'].filter(Boolean).join(' \u00b7 '));

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

/* Password change, on the Profile page. Re-authenticate with the current
   password first, then updateUser(). */
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

    const email = REGISTRAR?.email;
    if (!email) return finish('No email on record for this account.', 'error');

    const { error: authErr } = await supabase.auth.signInWithPassword({ email, password: current });
    if (authErr) return finish('Current password is incorrect.', 'error');

    const { error: upErr } = await supabase.auth.updateUser({ password: next });
    if (upErr) return finish(upErr.message || 'Could not change password.');

    if (REGISTRAR?.must_change_password && REGISTRAR_ID) {
        await supabase.rpc('clear_must_change_password');
        REGISTRAR = { ...REGISTRAR, must_change_password: false };
    }

    ['pw-current', 'pw-new', 'pw-confirm'].forEach(id => { const el = $(id); if (el) el.value = ''; });
    finish('Password updated.', 'success');
});


/* data */

const SELECT_COLS =
    'id, first_name, last_name, student_id, email, year_level, is_approved, ' +
    'record_verified, approval_status, declared_path, review_note, created_at, ' +
    'program_id, prospectus_id, user_id, verified_by, verified_at';

/* A student needs a prospectus to be assessed against. Admin provisioning
   sets one, but a self-registered student arrives with none, and Faculty
   cannot compute eligibility for a student who has none (the Student view
   falls back to the active version; Faculty does not). Pin the active
   version when the Registrar approves or verifies, so a returnee also
   stays on the curriculum they entered under if a newer one is published
   later.

   Returns { patch, warning }. The prospectus is the active one for the
   STUDENT'S OWN programme; a student with no programme only gets one when
   there is exactly one active curriculum, because with several, guessing
   would put them on another programme's curriculum. When nothing can be
   attached the patch is empty and `warning` says why, so the Registrar is
   told rather than left with a student who silently has no curriculum. */
let ACTIVE_PROSPECTUSES = null;

async function prospectusPatchFor(student) {
    const none = { patch: {}, warning: null };
    if (!student || student.prospectus_id || PREVIEW || !supabase) return none;

    if (!ACTIVE_PROSPECTUSES) {
        const { data, error } = await supabase
            .from('prospectus')
            .select('id, program_id')
            .eq('is_active', true);
        if (error) {
            console.warn('active prospectus lookup failed:', error.message);
            return { patch: {}, warning: 'The curriculum could not be looked up, so none was attached.' };
        }
        ACTIVE_PROSPECTUSES = data ?? [];
    }

    const pick = window.CurriculogicPrograms.fallbackProspectus(student.program_id, ACTIVE_PROSPECTUSES);
    if (pick) return { patch: { prospectus_id: pick.id, program_id: pick.program_id }, warning: null };

    const why = student.program_id != null
        ? 'No curriculum is published for this student’s programme yet.'
        : ACTIVE_PROSPECTUSES.length === 0
            ? 'No curriculum is published yet.'
            : 'This student has no programme set and more than one programme is active.';
    return { patch: {}, warning: `${why} No curriculum was attached, so eligibility cannot be computed until one is.` };
}

/* The Registrar can have thousands of students, so nothing here loads them all.
   Counts come from the database as counts; the account-request queue is only the
   students still waiting; the Students list fetches one page at a time. STUDENTS
   is a cache of every student shown so far (queue, list pages, detail). */

const PENDING_FILTER = 'approval_status.is.null,approval_status.eq.pending';
const PENDING_LIMIT  = 200;

let COUNTS = { total: 0, pending: 0, approved: 0, declined: 0, verified: 0 };

function localCounts() {
    return {
        total:    STUDENTS.length,
        pending:  STUDENTS.filter(s => (s.approval_status ?? 'pending') === 'pending').length,
        approved: STUDENTS.filter(s => s.approval_status === 'approved').length,
        declined: STUDENTS.filter(s => s.approval_status === 'declined').length,
        verified: STUDENTS.filter(s => s.record_verified).length,
    };
}

async function loadCounts() {
    if (PREVIEW || !supabase) return localCounts();
    const head = () => supabase.from('university_student').select('id', { count: 'exact', head: true });
    const [total, pend, appr, decl, ver] = await Promise.all([
        head(),
        head().or(PENDING_FILTER),
        head().eq('approval_status', 'approved'),
        head().eq('approval_status', 'declined'),
        head().eq('record_verified', true),
    ]);
    const n = (r) => r.count ?? 0;
    return { total: n(total), pending: n(pend), approved: n(appr), declined: n(decl), verified: n(ver) };
}

/* Put students into the cache (newer data wins). */
function cacheStudents(rows) {
    for (const row of rows ?? []) {
        const i = STUDENTS.findIndex(s => s.id === row.id);
        if (i >= 0) Object.assign(STUDENTS[i], row);
        else STUDENTS.push(row);
    }
}

/* A change made to one student, applied to every copy this page holds. */
function patchKnown(id, patch) {
    for (const list of [STUDENTS, MATCH_POOL, LIST.rows]) {
        const hit = list?.find(s => s.id === id);
        if (hit) Object.assign(hit, patch);
    }
}

async function loadActiveProspectuses() {
    if (ACTIVE_PROSPECTUSES) return ACTIVE_PROSPECTUSES;
    if (PREVIEW || !supabase) return [];
    const { data, error } = await supabase.from('prospectus').select('id, program_id').eq('is_active', true);
    if (error) { console.warn('active prospectus lookup failed:', error.message); return []; }
    ACTIVE_PROSPECTUSES = data ?? [];
    return ACTIVE_PROSPECTUSES;
}

async function loadStudents() {
    if (PREVIEW) {
        STUDENTS = [...PREVIEW_STUDENTS];
        COUNTS = localCounts();
        return afterLoad();
    }

    if (!supabase) return;

    const [counts, res] = await Promise.all([
        loadCounts(),
        supabase
            .from('university_student')
            .select(SELECT_COLS)
            .or(PENDING_FILTER)
            .order('created_at', { ascending: true })
            .limit(PENDING_LIMIT),
    ]);

    if (res.error) {
        console.warn('student load failed:', res.error.message);
        const body = $('requests-body');
        if (body) body.innerHTML = `
            <div class="empty">
                <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
                <h3>Could not load students</h3>
                <p>${escapeHtml(res.error.message)}</p>
                <p class="dim">If this mentions approval_status, run db/022.</p>
            </div>`;
        return;
    }

    COUNTS = counts;
    STUDENTS = res.data ?? [];
    afterLoad();
}

function afterLoad() {
    renderStats();
    renderRecent();
    renderDashboardSummary();
    renderRequests();
    renderStudentChips();
}

/* After an approval, a decline or a verification: fresh counts, fresh screens. */
async function refreshAfterChange() {
    COUNTS = await loadCounts();
    afterLoad();
    if (LIST.loaded) loadStudentList();
}

const pending = () => STUDENTS
    .filter(s => (s.approval_status ?? 'pending') === 'pending')
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));


/* dashboard */

function renderStats() {
    const p = COUNTS.pending;

    setStat('stat-pending',  p, 'stat-value');
    setStat('stat-approved', COUNTS.approved, 'stat-value');
    setStat('stat-verified', COUNTS.verified, 'stat-value');
    setStat('stat-declined', COUNTS.declined, 'stat-value');

    setStat('prof-stat-students', COUNTS.total);
    setStat('prof-stat-verified', COUNTS.verified);
    setStat('prof-stat-pending',  p);

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


/* The header sentence and the "Needs attention" list: what is waiting for the Registrar, from numbers this page
   already has (the counts, the oldest pending request, the approved plans). */
function renderDashboardSummary() {
    const DS = window.DashboardSummary;
    if (!DS) return;

    const waiting = COUNTS.pending;
    const oldest = pending()[0] ?? null;
    const oldestDays = oldest ? DS.ageDays(oldest.created_at) : 0;
    const unverified = Math.max(0, COUNTS.approved - COUNTS.verified);

    const items = [];
    if (waiting > 0) {
        items.push({
            level: oldestDays >= 7 ? 'full' : 'near',
            title: DS.count(waiting, 'account request') + ' awaiting review',
            detail: oldest ? 'Oldest: ' + (fullName(oldest) || oldest.student_id || 'a student') + ', ' + daysAgo(oldest.created_at) + '.' : '',
            go: '#requests', label: 'Review',
        });
    }
    if (unverified > 0) {
        items.push({
            level: 'info',
            title: DS.count(unverified, 'approved student') + ' without a verified record',
            detail: 'Their eligibility cannot be worked out until the record is verified.',
            go: '#students', label: 'Open students',
        });
    }
    if (ADVISING_COUNT > 0) {
        items.push({
            level: 'info',
            title: DS.count(ADVISING_COUNT, 'approved plan'),
            detail: 'Approved by an adviser, ready to print.',
            go: '#advising', label: 'Open plans',
        });
    }

    const P = window.CurriculogicPrograms;
    setText('hero-eyebrow', ['Registrar', P?.codeOf(REGISTRAR?.program_id, ''), P?.collegeOf(REGISTRAR?.program_id, '') || REGISTRAR?.department].filter(Boolean).join(' \u00b7 '));
    setText('hero-line', DS.sentence([
        waiting > 0 && DS.count(waiting, 'account request') + ' waiting',
        waiting > 0 && oldestDays >= 2 && 'the oldest has waited ' + DS.count(oldestDays, 'day'),
        unverified > 0 && DS.count(unverified, 'approved student') + ' without a verified record',
    ], ADVISING_COUNT > 0 ? 'Nothing is waiting for you. ' + DS.count(ADVISING_COUNT, 'approved plan') + ' ready.' : 'Nothing is waiting for you right now.'));
    $('hero-line')?.classList.toggle('is-alert', items.some(i => i.level === 'full'));

    setText('attention-note', items.length ? DS.count(items.length, 'item') : '');
    DS.render($('attention-body'), items, escapeHtml);
}

/* account requests */

function renderRequests() {
    const body  = $('requests-body');
    const count = $('requests-count');
    if (!body) return;

    const list = pending();
    if (count) count.textContent = COUNTS.pending > list.length
        ? `${COUNTS.pending} awaiting review (showing the first ${list.length})`
        : (list.length ? `${list.length} awaiting review` : '');

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
                        ${s.declared_path === 'new'
                            ? '' /* a new student has no ID until this request is approved */
                            : `<span class="mono">${escapeHtml(s.student_id || 'No ID given')}</span> · `}
                        ${escapeHtml(s.email || '—')}
                        · requested ${daysAgo(s.created_at)}
                    </p>
                </div>
                <span class="pill ${s.declared_path === 'new' ? 'info' : 'waiting'}">
                    ${s.declared_path === 'new' ? 'New student' : 'Existing record'}
                </span>
            </div>

            <p class="review-hint">
                ${s.declared_path === 'new'
                    ? 'Confirm this person appears on the incoming student list. Their student ID is assigned automatically when you approve.'
                    : 'Match the student ID above against the official student list before approving.'}
            </p>

            ${matchesHtml(s)}

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

/* Other accounts that look like the same person (same ID, e-mail or name). It
   only covers accounts this Registrar can see, so it is a prompt to look
   closer, not proof: the decision still rests on the school's own records. */
function matchesHtml(request) {
    const found = window.CurriculogicAccountMatches
        ? window.CurriculogicAccountMatches.findMatches(request, MATCH_POOL ?? STUDENTS)
        : [];

    if (found.length === 0) {
        return '<p class="review-matches none">No other account here has this name, ID or e-mail.</p>';
    }

    const items = found.slice(0, 5).map(({ account, reasons }) => {
        const status = account.approval_status === 'approved' ? 'already has an account'
                     : account.approval_status === 'declined' ? 'was declined earlier'
                     : 'another pending request';
        return '<li><strong>' + escapeHtml(fullName(account) || '—') + '</strong>'
            + (account.student_id ? ' <span class="mono">' + escapeHtml(account.student_id) + '</span>' : '')
            + ' · ' + escapeHtml(status)
            + ' <span class="dim">(' + escapeHtml(window.CurriculogicAccountMatches.reasonText(reasons)) + ')</span></li>';
    }).join('');
    const more = found.length > 5 ? '<li class="dim">and ' + (found.length - 5) + ' more</li>' : '';

    return '<div class="review-matches"><p><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> '
        + 'Possible match' + (found.length === 1 ? '' : 'es') + ' with an existing account:</p><ul>' + items + more + '</ul></div>';
}

/* A NEW student's ID is issued by the database at the moment of approval
   (db/045): the registrar types nothing, and anything sent here is ignored.
   An EXISTING student typed their own ID at registration, and it is approved
   as it stands. */

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
    // The database refuses a longer reason (db/050); a prompt() box has no
    // limit of its own, so it is checked here, before saving.
    if (note.trim().length > 500) {
        return showMsg('request-msg',
            `That reason is ${note.trim().length} characters. Please keep it under 500.`);
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

    let pinWarning = null;
    if (status === 'approved') {
        const pin = await prospectusPatchFor(STUDENTS.find(s => s.id === id));
        Object.assign(patch, pin.patch);
        pinWarning = pin.warning;
    }

    if (PREVIEW) {
        patchKnown(id, patch);
        await refreshAfterChange();
        return showMsg('request-msg', `Request ${status} (preview only — not saved).`, 'success');
    }

    // The ID of a new student is set by the database during this update, so
    // it is read back from the saved row rather than assumed.
    const { data: saved, error } = await supabase
        .from('university_student')
        .update(patch)
        .eq('id', id)
        .select('student_id')
        .maybeSingle();

    if (error) {
        console.error('decision failed:', error.message);
        return showMsg('request-msg', 'Could not save that decision. Please try again.');
    }

    const student = STUDENTS.find(s => s.id === id) ?? {};
    patchKnown(id, patch);
    if (saved?.student_id) patchKnown(id, { student_id: saved.student_id });
    Object.assign(student, patch);
    if (saved?.student_id) student.student_id = saved.student_id;
    await refreshAfterChange();

    const idNote = (status === 'approved' && student.declared_path === 'new' && saved?.student_id)
        ? ` Student ID ${saved.student_id} was assigned (they sign in with uc-${saved.student_id}).`
        : '';
    const outcome = status === 'approved'
        ? `${fullName(student)} approved.${idNote} They can now sign in.`
        : `${fullName(student)} declined.`;

    // The approval itself succeeded; a warning is an addition, shown in the
    // error style so it is not missed.
    showMsg('request-msg',
        pinWarning ? `${outcome} ${pinWarning}` : outcome,
        pinWarning ? 'error' : 'success');
}


/* students */

function statusPill(s) {
    const status = s.approval_status ?? 'pending';
    if (status === 'approved') return '<span class="pill ok">Approved</span>';
    if (status === 'declined') return '<span class="pill bad">Declined</span>';
    return '<span class="pill waiting">Pending</span>';
}

const recordPill = (s) => s.record_verified
    ? '<span class="pill ok">Verified</span>'
    : '<span class="pill waiting">Unverified</span>';

const STUDENT_PAGE_SIZE = 20;

/* The Students list: which page, which filters, and what came back. `seq` makes
   sure a slow answer to an old search never overwrites a newer one. */
const LIST = { page: 1, filter: 'all', year: 'all', search: '', rows: [], total: 0, loaded: false, seq: 0 };

const SL = () => window.CurriculogicStudentList;

function previewMatches(s) {
    const status = s.approval_status ?? 'pending';
    if (LIST.filter === 'approved'   && status !== 'approved') return false;
    if (LIST.filter === 'pending'    && status !== 'pending')  return false;
    if (LIST.filter === 'declined'   && status !== 'declined') return false;
    if (LIST.filter === 'unverified' && s.record_verified)     return false;
    if (LIST.year !== 'all' && String(s.year_level) !== LIST.year) return false;
    const hay = [s.first_name, s.last_name, s.student_id, s.email].filter(Boolean).join(' ').toLowerCase();
    return SL().searchTokens(LIST.search).every(t => hay.includes(t.toLowerCase()));
}

/* One page of students from the database (or from the sample set in preview). */
async function fetchStudentPage() {
    const { from, to } = SL().rangeFor(LIST.page, STUDENT_PAGE_SIZE);

    if (PREVIEW) {
        const all = STUDENTS.filter(previewMatches)
            .sort((a, b) => fullName(a).localeCompare(fullName(b)));
        return { rows: all.slice(from, to + 1), total: all.length };
    }

    let q = supabase.from('university_student').select(SELECT_COLS, { count: 'exact' });
    if (LIST.filter === 'approved')   q = q.eq('approval_status', 'approved');
    if (LIST.filter === 'pending')    q = q.or(PENDING_FILTER);
    if (LIST.filter === 'declined')   q = q.eq('approval_status', 'declined');
    if (LIST.filter === 'unverified') q = q.eq('record_verified', false);
    if (LIST.year !== 'all')          q = q.eq('year_level', Number(LIST.year));
    // Every word of the search must match the name, the ID or the e-mail.
    for (const token of SL().searchTokens(LIST.search)) q = q.or(SL().searchClause(token));

    const { data, error, count } = await q
        .order('last_name', { ascending: true })
        .order('first_name', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to);
    if (error) throw error;
    return { rows: data ?? [], total: count ?? 0 };
}

async function loadStudentList() {
    const body = $('students-body');
    if (!body) return;
    const seq = ++LIST.seq;
    body.classList.add('is-loading');

    let result;
    try {
        result = await fetchStudentPage();
        // A page past the end (the last student of the last page was removed): go back.
        const pages = SL().pageCount(result.total, STUDENT_PAGE_SIZE);
        if (LIST.page > pages) { LIST.page = pages; result = await fetchStudentPage(); }
    } catch (err) {
        if (seq !== LIST.seq) return;
        console.warn('student list failed:', err.message);
        body.classList.remove('is-loading');
        body.innerHTML = `
            <div class="empty">
                <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
                <h3>Could not load students</h3>
                <p>${escapeHtml(err.message)}</p>
            </div>`;
        return;
    }
    if (seq !== LIST.seq) return;

    LIST.rows = result.rows;
    LIST.total = result.total;
    LIST.loaded = true;
    cacheStudents(result.rows);
    body.classList.remove('is-loading');
    renderStudentList();
    enrichStudentRows(result.rows, seq);
}

function openStudentList() {
    renderStudentChips();
    if (!LIST.loaded) { loadStudentList(); return; }
    loadStudentList();   // always fresh: a student may have been verified since
}

/* Filter buttons with their live counts. */
function renderStudentChips() {
    const box = $('student-chips');
    if (!box) return;
    const unverified = Math.max(0, COUNTS.total - COUNTS.verified);
    const defs = [
        ['all',        'All',             COUNTS.total],
        ['approved',   'Approved',        COUNTS.approved],
        ['pending',    'Awaiting review', COUNTS.pending],
        ['declined',   'Declined',        COUNTS.declined],
        ['unverified', 'Unverified',      unverified],
    ];
    box.innerHTML = defs.map(([key, label, n]) => `
        <button type="button" class="stu-chip${LIST.filter === key ? ' on' : ''}" data-student-filter="${key}"
                aria-pressed="${LIST.filter === key}">${escapeHtml(label)}<b>${n}</b></button>`).join('');
}

function studentRowHtml(s) {
    const approved = (s.approval_status ?? 'pending') === 'approved';
    const initials = SL().initialsOf(s.first_name, s.last_name, s.email);
    return `
    <div class="stu-row" data-open="${escapeHtml(s.id)}" tabindex="0" role="link"
         aria-label="Open ${escapeHtml(fullName(s) || 'student')}">
        <span class="stu-avatar" data-avatar="${escapeHtml(s.id)}">${escapeHtml(initials)}</span>
        <span class="stu-who">
            <strong>${escapeHtml(fullName(s) || '—')}</strong>
            <span class="stu-meta"><span class="mono">${escapeHtml(s.student_id || 'No ID yet')}</span>
                · ${escapeHtml(ordinal(s.year_level) || 'Year not set')} · ${escapeHtml(programName(s))}</span>
        </span>
        <span class="stu-prog" data-prog="${escapeHtml(s.id)}">
            ${approved
                ? '<span class="stu-bar"><i style="width:0"></i></span><span class="stu-bar-text">&nbsp;</span>'
                : `<span class="stu-bar-text dim">${escapeHtml(s.email || '')}</span>`}
        </span>
        <span class="stu-pills">${statusPill(s)}${approved ? recordPill(s) : ''}</span>
        <i class="fa-solid fa-chevron-right dim" aria-hidden="true"></i>
    </div>`;
}

function renderStudentList() {
    const body  = $('students-body');
    const count = $('students-count');
    if (!body) return;

    const pages = SL().pageCount(LIST.total, STUDENT_PAGE_SIZE);
    const { from } = SL().rangeFor(LIST.page, STUDENT_PAGE_SIZE);
    const searching = LIST.search.trim() !== '' || LIST.filter !== 'all' || LIST.year !== 'all';
    if (count) count.textContent = LIST.total
        ? (searching ? `${LIST.total} match${LIST.total === 1 ? '' : 'es'}` : `${LIST.total} students`)
        : '';

    if (LIST.rows.length === 0) {
        body.innerHTML = `
            <div class="empty">
                <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
                <h3>${searching ? 'No matches' : 'No students yet'}</h3>
                <p>${searching
                    ? 'No student matches that search or filter.'
                    : 'Student accounts will appear here once they have registered.'}</p>
            </div>`;
        return;
    }

    body.innerHTML = `
        <div class="stu-list">${LIST.rows.map(studentRowHtml).join('')}</div>
        ${pages > 1 ? `
        <div class="pager">
            <span class="dim">${from + 1}–${from + LIST.rows.length} of ${LIST.total}</span>
            <span class="pager-btns">
                <button type="button" class="btn-small" data-student-page="prev" ${LIST.page === 1 ? 'disabled' : ''}>Previous</button>
                <span class="pager-now">Page ${LIST.page} of ${pages}</span>
                <button type="button" class="btn-small" data-student-page="next" ${LIST.page === pages ? 'disabled' : ''}>Next</button>
            </span>
        </div>` : ''}`;
}

/* Prospectus facts: how many units the whole curriculum has, and which year it
   is. Cached; a few queries however many students are on screen. */
const PROSPECTUS_FACTS = new Map();

async function prospectusFacts(ids) {
    const want = [...new Set(ids.filter(x => x != null))].filter(id => !PROSPECTUS_FACTS.has(id));
    if (want.length && supabase && !PREVIEW) {
        const [subs, pros] = await Promise.all([
            supabase.from('subject').select('prospectus_id, units')
                .in('prospectus_id', want).not('year_level', 'is', null).eq('is_active', true),
            supabase.from('prospectus').select('id, academic_year, is_active').in('id', want),
        ]);
        const units = new Map();
        for (const r of subs.data ?? []) units.set(r.prospectus_id, (units.get(r.prospectus_id) || 0) + Number(r.units || 0));
        for (const p of pros.data ?? []) {
            PROSPECTUS_FACTS.set(p.id, {
                units: units.get(p.id) || 0,
                label: p.academic_year ? `${p.academic_year}–${Number(p.academic_year) + 1}` : '',
                active: !!p.is_active,
            });
        }
    }
    return PROSPECTUS_FACTS;
}

/* The curriculum a student is measured against: the one they are pinned to, or
   their programme's active one. */
async function prospectusIdOf(s) {
    if (s.prospectus_id) return s.prospectus_id;
    const pick = window.CurriculogicPrograms?.fallbackProspectus(s.program_id, await loadActiveProspectuses());
    return pick?.id ?? null;
}

const chunksOf = (list, n) => {
    const out = [];
    for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
    return out;
};

function setBar(id, percent, text) {
    const cell = document.querySelector(`[data-prog="${CSS.escape(id)}"]`);
    if (!cell) return;
    const bar = cell.querySelector('.stu-bar i');
    const label = cell.querySelector('.stu-bar-text');
    if (label) label.textContent = text;
    if (bar) requestAnimationFrame(() => { bar.style.width = `${percent}%`; });
}

/* The photos and the progress bars arrive after the rows, so the page is never
   waiting on them. */
async function enrichStudentRows(rows, seq) {
    const Photo = window.CurriculogicPhoto;

    if (PREVIEW) {
        for (const s of rows) {
            const recs = PREVIEW_RECORDS[s.id];
            if (!recs || (s.approval_status ?? 'pending') !== 'approved') continue;
            const p = SL().progress(recs.map(r => ({ subject_id: r.subject?.code, status: r.status, units: r.subject?.units })), 161);
            setBar(s.id, p.percent, `${p.units} of ${p.total} units`);
        }
        return;
    }

    // photos: one request for the whole page
    Photo.signedUrls(supabase, rows.map(s => s.user_id)).then((urls) => {
        if (seq !== LIST.seq) return;
        for (const s of rows) {
            const url = urls.get(s.user_id);
            if (!url) continue;
            const el = document.querySelector(`[data-avatar="${CSS.escape(s.id)}"]`);
            if (el) Photo.paint(el, url, SL().initialsOf(s.first_name, s.last_name, s.email));
        }
    }).catch(() => {});

    // progress: passed units of the approved students on the page
    const approved = rows.filter(s => (s.approval_status ?? 'pending') === 'approved');
    if (!approved.length) return;
    try {
        // Ten students per request keeps every answer well under the row limit.
        const answers = await Promise.all(chunksOf(approved.map(s => s.id), 10).map(ids =>
            supabase.from('academic_record')
                .select('student_id, subject_id, status, subject:subject_id (units)')
                .in('student_id', ids).eq('status', 'PASSED')));
        const byStudent = new Map();
        for (const a of answers) for (const r of a.data ?? []) {
            if (!byStudent.has(r.student_id)) byStudent.set(r.student_id, []);
            byStudent.get(r.student_id).push(r);
        }
        const pids = new Map();
        for (const s of approved) pids.set(s.id, await prospectusIdOf(s));
        const facts = await prospectusFacts([...pids.values()]);
        if (seq !== LIST.seq) return;
        for (const s of approved) {
            const total = facts.get(pids.get(s.id))?.units ?? 0;
            const p = SL().progress(byStudent.get(s.id) ?? [], total);
            setBar(s.id, p.percent, total ? `${p.units} of ${total} units` : `${p.units} units`);
        }
    } catch (err) {
        console.warn('progress bars failed:', err.message);
    }
}


/* student detail */

let DETAIL_SEQ = 0;

const longDate = (iso) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—'
        : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

async function fetchStudentById(id) {
    if (!supabase || PREVIEW) return null;
    const { data, error } = await supabase.from('university_student').select(SELECT_COLS).eq('id', id).maybeSingle();
    if (error) { console.warn('student lookup failed:', error.message); return null; }
    if (data) cacheStudents([data]);
    return data ?? null;
}

async function openStudent(studentRowId) {
    const seq = ++DETAIL_SEQ;
    let s = STUDENTS.find(x => x.id === studentRowId) ?? await fetchStudentById(studentRowId);
    if (seq !== DETAIL_SEQ) return;

    if (!s) {
        setText('detail-name', 'Student not found');
        setText('detail-sub', '');
        $('detail-pills').innerHTML = '';
        $('detail-actions').innerHTML = '';
        $('detail-term-body').innerHTML = '';
        $('detail-progress-body').innerHTML = '';
        $('detail-status').innerHTML = '';
        $('detail-record-body').innerHTML = `
            <div class="empty">
                <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
                <h3>No such student</h3>
                <p>That student could not be found.</p>
            </div>`;
        return;
    }

    renderStudentHero(s);
    paintDetailPhoto(s, seq);

    // Everything else arrives on its own, so a slow one never holds up the rest.
    const records = loadStudentRecord(s, seq);
    loadStudentPlan(s, seq);
    records.then(list => renderStudentProgress(s, list, seq));
    records.then(list => renderDegreeAudit(s, list, seq));
    loadVerifiedBy(s, seq);
}

function renderStudentHero(s) {
    const initials = SL().initialsOf(s.first_name, s.last_name, s.email);
    const avatar = $('detail-avatar');
    window.CurriculogicPhoto.paint(avatar, null, initials);

    setText('detail-name', fullName(s) || '—');
    setText('detail-sub',
        `${s.student_id || 'No ID yet'} · ${ordinal(s.year_level) || 'Year not set'} · ${programName(s)}`);
    $('detail-pills').innerHTML =
        `${statusPill(s)}${(s.approval_status ?? 'pending') === 'approved' ? recordPill(s) : ''}
         <span class="pill info">${s.declared_path === 'new' ? 'New student' : 'Existing record'}</span>`;

    renderStudentDetails(s, null);

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
            openStudent(s.id);
        }));
}

function renderStudentDetails(s, verifiedBy, curriculum) {
    const verifiedLine = s.record_verified
        ? `<span class="pill ok">Verified</span>${s.verified_at
            ? ` <span class="dim">${escapeHtml(longDate(s.verified_at))}${verifiedBy ? ` · by ${escapeHtml(verifiedBy)}` : ''}</span>` : ''}`
        : '<span class="pill waiting">Unverified</span>';
    $('detail-status').innerHTML = `
        <div class="detail"><dt>University email</dt><dd class="mono">${escapeHtml(s.email || '—')}</dd></div>
        <div class="detail"><dt>Registered</dt><dd>${escapeHtml(longDate(s.created_at))}</dd></div>
        <div class="detail"><dt>Curriculum</dt><dd>${curriculum || '<span class="dim">Not assigned yet</span>'}</dd></div>
        <div class="detail"><dt>Account</dt><dd>${statusPill(s)}</dd></div>
        <div class="detail"><dt>Record</dt><dd>${verifiedLine}</dd></div>
        ${s.review_note ? `<div class="detail"><dt>Review note</dt><dd>${escapeHtml(s.review_note)}</dd></div>` : ''}`;
}

async function paintDetailPhoto(s, seq) {
    if (PREVIEW || !supabase || !s.user_id) return;
    const url = await window.CurriculogicPhoto.signedUrl(supabase, s.user_id);
    if (seq !== DETAIL_SEQ || !url) return;
    window.CurriculogicPhoto.paint($('detail-avatar'), url, SL().initialsOf(s.first_name, s.last_name, s.email));
}

async function loadVerifiedBy(s, seq) {
    if (PREVIEW || !supabase || !s.record_verified || !s.verified_by) return;
    const { data } = await supabase.from('registrar_staff')
        .select('first_name, last_name').eq('id', s.verified_by).maybeSingle();
    if (seq !== DETAIL_SEQ || !data) return;
    renderStudentDetails(s, fullName(data), CURRICULUM_HTML.get(s.id));
}

const CURRICULUM_HTML = new Map();

/* This term's plan. */
async function loadStudentPlan(s, seq) {
    const body = $('detail-term-body');
    const label = $('detail-term-label');
    if (!body) return;
    body.innerHTML = '<div class="empty"><i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i><h3>Loading</h3></div>';

    const RS = window.CurriculogicRequestStatus;
    let requests;
    if (PREVIEW) {
        requests = PREVIEW_PLANS[s.id] ?? [];
    } else {
        const { data, error } = await supabase
            .from('request')
            .select(`
                id, status, registrar_status, requested_term, requested_year, created_at,
                request_item (
                    id, status, remarks,
                    subject:subject_id (code, title, units),
                    offering:offering_id (section, schedule_days, start_time, end_time, room)
                )`)
            .eq('student_id', s.id)
            .order('created_at', { ascending: false })
            .limit(20);
        if (seq !== DETAIL_SEQ) return;
        if (error) {
            console.warn('plan load failed:', error.message);
            body.innerHTML = `<div class="empty"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
                <h3>Could not load the plan</h3><p>${escapeHtml(error.message)}</p></div>`;
            return;
        }
        requests = data ?? [];
    }

    const cfg = await window.CurriculogicTerm?.load();
    if (seq !== DETAIL_SEQ) return;
    const termText = cfg ? window.CurriculogicTerm.formatLabel(cfg.term, cfg.year) : '';
    if (label) label.textContent = termText;

    const plan = SL().pickPlan(requests, cfg, RS.finalApproved);
    if (!plan) {
        body.innerHTML = `
            <div class="empty">
                <i class="fa-solid fa-calendar-xmark" aria-hidden="true"></i>
                <h3>No plan for this term</h3>
                <p>The student has not submitted a subject plan${termText ? ` for ${escapeHtml(termText)}` : ''} yet.</p>
            </div>`;
        return;
    }

    const final = RS.finalApproved(plan);
    const items = (plan.request_item ?? []).filter(i => !final || i.status === 'approved');
    const units = items.reduce((t, i) => t + Number(i.subject?.units || 0), 0);
    const stage = final ? '<span class="pill ok"><i class="fa-solid fa-check"></i> Approved for enrollment</span>'
        : RS.sentBack(plan) ? '<span class="pill bad">Closed</span>'
        : plan.status === 'rejected' ? '<span class="pill bad">Not approved</span>'
        : '<span class="pill waiting"><i class="fa-solid fa-clock"></i> Waiting for the adviser</span>';

    const sched = (o) => {
        if (!o) return '—';
        const time = (o.start_time && o.end_time) ? `${o.start_time.slice(0, 5)}–${o.end_time.slice(0, 5)}` : '';
        return [o.section, o.schedule_days, time].filter(Boolean).join(' · ') || '—';
    };

    body.innerHTML = `
        <div class="stu-plan-head">${stage}
            <span class="dim">${items.length} subject${items.length === 1 ? '' : 's'} · ${units} units · submitted ${escapeHtml(longDate(plan.created_at))}</span>
        </div>
        <div class="table-wrap">
            <table class="data-table">
                <thead><tr><th>Code</th><th>Descriptive title</th><th class="num">Units</th></tr></thead>
                <tbody>${items.map(i => `
                    <tr>
                        <td class="mono">${escapeHtml(i.subject?.code ?? '')}</td>
                        <td>${escapeHtml(i.subject?.title ?? '')}
                            <span class="row-sub">${escapeHtml(sched(i.offering))}</span></td>
                        <td class="num">${escapeHtml(i.subject?.units ?? '—')}</td>
                    </tr>`).join('')}
                </tbody>
            </table>
        </div>`;
}

/* The grades, one table per term (newest first), like the transcript the
   Faculty adviser sees. Resolves to the flat records for the progress card. */
async function loadStudentRecord(s, seq) {
    const body  = $('detail-record-body');
    const count = $('detail-record-count');
    if (!body) return [];

    body.innerHTML = `
        <div class="empty">
            <i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i>
            <h3>Loading</h3>
            <p>Fetching grades.</p>
        </div>`;

    let rows = [];

    if (PREVIEW) {
        rows = PREVIEW_RECORDS[s.id] ?? [];
    } else {
        const { data, error } = await supabase
            .from('academic_record')
            .select('id, subject_id, grade, grade_points, status, taken_term, taken_year, subject:subject_id (code, title, units)')
            .eq('student_id', s.id)
            .order('taken_year', { ascending: true })
            .order('taken_term', { ascending: true });
        if (seq !== DETAIL_SEQ) return [];

        if (error) {
            console.warn('record load failed:', error.message);
            body.innerHTML = `
                <div class="empty">
                    <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
                    <h3>Could not load grades</h3>
                    <p>${escapeHtml(error.message)}</p>
                </div>`;
            return [];
        }
        rows = data ?? [];
    }

    const records = rows.map(r => ({
        ...r,
        subject_code: r.subject?.code, subject_title: r.subject?.title, units: r.subject?.units,
    }));

    const units = SL().passedUnits(records);
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
        return records;
    }

    const RG = window.CurriculogicRecordGrades;
    body.innerHTML = RG.groupByTerm(records).map((g) => `
        <section class="rec-group">
            <h4 class="rec-term">${escapeHtml(g.label)}
                <span>${g.subjects} subject${g.subjects === 1 ? '' : 's'} · ${g.passed} passed · ${g.unitsEarned} units earned</span>
            </h4>
            <div class="table-wrap">
                <table class="data-table rec-table">
                    <thead>
                        <tr>
                            <th>Code</th><th>Descriptive title</th>
                            <th class="num">Units</th><th class="num">Grade</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>${g.rows.map((r) => {
                        const [chipClass, chipText] = RG.chipFor(r.status);
                        const shown = r.status === 'DROPPED' ? null : RG.pick([r]);
                        return `
                        <tr>
                            <td class="mono">${escapeHtml(r.subject_code ?? '—')}</td>
                            <td>${escapeHtml(r.subject_title || '—')}</td>
                            <td class="num">${escapeHtml(r.units ?? '—')}</td>
                            <td class="num rec-grade ${shown ? escapeHtml(shown.tone) : ''}">${shown ? escapeHtml(shown.grade) : '—'}</td>
                            <td><span class="pg-chip ${escapeHtml(chipClass)}">${escapeHtml(chipText)}</span></td>
                        </tr>`;
                    }).join('')}</tbody>
                </table>
            </div>
        </section>`).join('');
    return records;
}

/* How far through the degree, and which curriculum they follow. */
async function renderStudentProgress(s, records, seq) {
    const body = $('detail-progress-body');
    if (!body || seq !== DETAIL_SEQ) return;

    let total = 0;
    let curriculum = '';
    if (PREVIEW) {
        total = 161;
        curriculum = '2024–2025 <span class="pill ok">Active</span>';
    } else {
        const pid = await prospectusIdOf(s);
        const facts = await prospectusFacts([pid]);
        if (seq !== DETAIL_SEQ) return;
        const f = pid != null ? facts.get(pid) : null;
        total = f?.units ?? 0;
        if (f?.label) curriculum = `${escapeHtml(f.label)} ${f.active ? '<span class="pill ok">Active</span>' : '<span class="pill waiting">Older version</span>'}`;
    }
    CURRICULUM_HTML.set(s.id, curriculum);
    renderStudentDetails(s, null, curriculum);

    const p = SL().progress(records, total);
    const subjects = (status) => new Set(records.filter(r => r.status === status).map(r => r.subject_id ?? r.subject_code)).size;
    const passed = subjects('PASSED');
    const failed = [...new Set(records.filter(r => r.status === 'FAILED').map(r => r.subject_id ?? r.subject_code))]
        .filter(id => !records.some(r => r.status === 'PASSED' && (r.subject_id ?? r.subject_code) === id)).length;
    const taking = subjects('ENROLLED');

    body.innerHTML = `
        <div class="stu-big"><strong>${p.units}</strong><span>${total ? `of ${total} units` : 'units earned'}</span></div>
        <div class="stu-bar big"><i style="width:0"></i></div>
        <p class="stu-bar-text">${total ? `${p.percent}% of the degree` : 'No curriculum assigned yet'}</p>
        <div class="stu-mini">
            <div><strong>${passed}</strong><span>Passed</span></div>
            <div><strong>${failed}</strong><span>To retake</span></div>
            <div><strong>${taking}</strong><span>Taking</span></div>
        </div>`;
    const bar = body.querySelector('.stu-bar i');
    if (bar) requestAnimationFrame(() => { bar.style.width = `${p.percent}%`; });
}

/* ---- degree audit ----
   The student's whole curriculum with each subject's standing and grade, the way the Faculty adviser sees it, so
   the record can be compared with the transcript on one screen. Read-only: the same engine run on the records
   already on file, against the curriculum the student follows. */

const AUDIT_KB = new Map();   // prospectus id -> { subjects, rules }, kept while the page is open

async function auditKbFor(prospectusId) {
    if (AUDIT_KB.has(prospectusId)) return AUDIT_KB.get(prospectusId);
    const [subs, rules] = await Promise.all([
        supabase.from('subject')
            .select('id, code, title, units, lec_units, lab_units, year_level, term, is_elective, elective_type, category, is_active')
            .eq('prospectus_id', prospectusId),
        supabase.from('prerequisite')
            .select('subject_id, prerequisite_subject_id, requirement_type, rule_type, rule_group, threshold_value'),
    ]);
    if (subs.error) console.warn('audit: subject load failed:', subs.error.message);
    if (rules.error) console.warn('audit: rule load failed:', rules.error.message);
    // Offerings are not consulted: an audit is about what the student has done, not what runs this term.
    const kb = { subjects: subs.data ?? [], rules: rules.data ?? [], offerings: [] };
    AUDIT_KB.set(prospectusId, kb);
    return kb;
}

/* assess() output -> the grid's status map. */
function auditStatusMap(result) {
    const map = new Map();
    if (!result) return map;
    for (const s of result.completed) map.set(s.id, { state: 'passed', detail: 'Passed' });
    for (const s of result.inProgress) map.set(s.id, { state: 'enrolled', detail: 'Currently enrolled' });
    for (const e of result.eligible) {
        map.set(e.subject.id, {
            state: e.retake ? 'retake' : 'eligible',
            detail: e.retake ? 'Previously failed. Eligible to retake.' : 'All requirements met.',
        });
    }
    for (const l of result.locked) {
        map.set(l.subject.id, { state: 'blocked', detail: l.unmet.map(u => u.detail).join(' ') });
    }
    return map;
}

const auditEmpty = (icon, heading, text) => `
    <div class="empty">
        <i class="fa-solid ${icon}" aria-hidden="true"></i>
        <h3>${escapeHtml(heading)}</h3>
        <p>${escapeHtml(text)}</p>
    </div>`;

async function renderDegreeAudit(s, records, seq) {
    const body = $('detail-audit-body');
    const note = $('detail-audit-note');
    if (!body || seq !== DETAIL_SEQ) return;
    if (note) note.textContent = '';

    if (PREVIEW || !supabase) {
        body.innerHTML = auditEmpty('fa-eye-slash', 'Not shown in preview', 'The degree audit reads the live curriculum.');
        return;
    }
    if (typeof CurricuLogicEngine === 'undefined' || typeof window.ProspectusGrid === 'undefined') {
        console.error('engine.js or prospectusgrid.js not loaded: check script order');
        body.innerHTML = auditEmpty('fa-triangle-exclamation', 'Could not run the audit', 'The inference engine did not load.');
        return;
    }

    body.innerHTML = auditEmpty('fa-spinner fa-spin', 'Auditing', 'Checking this student against the curriculum.');

    const pid = await prospectusIdOf(s);
    if (seq !== DETAIL_SEQ) return;
    if (pid == null) {
        body.innerHTML = auditEmpty('fa-triangle-exclamation', 'No curriculum assigned', 'This student is not linked to a curriculum version yet.');
        return;
    }

    const kb = await auditKbFor(pid);
    if (seq !== DETAIL_SEQ) return;
    if (!kb.subjects.length) {
        body.innerHTML = auditEmpty('fa-diagram-project', 'Curriculum not yet encoded', 'This curriculum version has no subjects.');
        return;
    }

    const result = CurricuLogicEngine.assess(
        { id: s.id, year_level: s.year_level }, records, kb, { respectOfferings: false });
    if (note && result) {
        note.textContent = `${result.completed.length} passed · ${result.inProgress.length} taking · ${result.locked.length} locked`;
    }
    const RG = window.CurriculogicRecordGrades;
    const statuses = RG ? RG.attach(auditStatusMap(result), records) : auditStatusMap(result);

    // Printed in the look of the curriculum, with this student's name, ID and grades filled in.
    const { data: version } = await supabase.from('prospectus').select('academic_year').eq('id', pid).maybeSingle();
    if (seq !== DETAIL_SEQ) return;
    const P = window.CurriculogicPrograms;
    await window.ProspectusGrid.render(supabase, pid, body, statuses, null, {
        label: 'Print degree audit (1 page)',
        program: programName(s),
        college: P?.collegeOf(s.program_id, '') ?? '',
        effective: version?.academic_year ? `${version.academic_year}–${version.academic_year + 1}` : '',
        student: { name: fullName(s), id: s.student_id ?? '' },
    });
}

const statusClass = (s) =>
    ({ PASSED: 'ok', FAILED: 'bad', ENROLLED: 'info', DROPPED: 'waiting' })[s] || 'waiting';

const statusLabel = (s) =>
    // An unknown status is shown as it is, but as text: this goes into HTML.
    ({ PASSED: 'Passed', FAILED: 'Failed', ENROLLED: 'Enrolled', DROPPED: 'Dropped' })[s] || escapeHtml(s);

/* The programme this account is assigned to, shown in the header next to the
   term (same field as the Department header). Static: it only changes when an
   admin reassigns the account. */
function paintProgramField() {
    const field = document.getElementById('topbar-program');
    if (!field) return;
    const id = REGISTRAR?.program_id;
    const P = window.CurriculogicPrograms;
    const code = id == null ? '' : P?.codeOf(id, '');
    field.value = code
        ? `${code} — ${P.nameOf(id, '')}`
        : (PREVIEW ? 'BSIT — BS Information Technology' : 'No programme assigned');
    field.title = field.value;

    // The same programme on the Profile page.
    setText('d-program', field.value);
    const pill = $('prof-program-pill');
    if (pill) {
        pill.textContent = code || (PREVIEW ? 'BSIT' : '');
        pill.hidden = !pill.textContent;
    }
}

const termLabel = (t) => ({ 1: '1st Sem', 2: '2nd Sem', 3: 'Summer' })[t] || '—';

async function setVerified(id, verified) {
    const patch = {
        record_verified: verified,
        verified_by:     verified ? REGISTRAR_ID : null,
        verified_at:     verified ? new Date().toISOString() : null,
    };

    let pinWarning = null;
    if (verified) {
        const pin = await prospectusPatchFor(STUDENTS.find(s => s.id === id));
        Object.assign(patch, pin.patch);
        pinWarning = pin.warning;

        // Verifying a student with nothing on file gives them an empty
        // eligibility run that looks like "everything is open". Department
        // Staff uploads the grades; make the Registrar confirm they mean it.
        // A new student (declared_path 'new') has no history by definition.
        const isNew = STUDENTS.find(s => s.id === id)?.declared_path === 'new';
        if (!PREVIEW && supabase && !isNew) {
            const { count } = await supabase
                .from('academic_record')
                .select('id', { count: 'exact', head: true })
                .eq('student_id', id);

            if (count === 0 && !window.confirm(
                'This student has no grades on file yet. Verifying now means ' +
                'eligibility will be computed from an empty record.\n\n' +
                'Verify anyway?')) {
                return;
            }
        }
    }

    if (PREVIEW) {
        patchKnown(id, patch);
        await refreshAfterChange();
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

    const student = STUDENTS.find(s => s.id === id) ?? {};
    patchKnown(id, patch);
    Object.assign(student, patch);
    await refreshAfterChange();

    const outcome = verified
        ? `${fullName(student)}'s record verified.${pinWarning ? '' : ' Eligibility can now be computed.'}`
        : `${fullName(student)}'s record marked unverified.`;

    showMsg('student-msg',
        pinWarning ? `${outcome} ${pinWarning}` : outcome,
        pinWarning ? 'error' : 'success');
}

let searchTimer = null;
$('student-search')?.addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
        LIST.search = e.target.value;
        LIST.page = 1;
        loadStudentList();
    }, 250);
});
$('student-year')?.addEventListener('change', (e) => {
    LIST.year = e.target.value;
    LIST.page = 1;
    loadStudentList();
});
$('student-chips')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-student-filter]');
    if (!b) return;
    LIST.filter = b.dataset.studentFilter;
    LIST.page = 1;
    renderStudentChips();
    loadStudentList();
});
$('students-body')?.addEventListener('click', (e) => {
    const pager = e.target.closest('[data-student-page]');
    if (pager) {
        if (pager.disabled) return;
        LIST.page += pager.dataset.studentPage === 'next' ? 1 : -1;
        loadStudentList();
        return;
    }
    const row = e.target.closest('[data-open]');
    if (row) window.location.hash = `#student/${row.dataset.open}`;
});
$('students-body')?.addEventListener('keydown', (e) => {
    const row = e.target.closest?.('[data-open]');
    if (row && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        window.location.hash = `#student/${row.dataset.open}`;
    }
});

/* Every account on file (just names, IDs and e-mails), used only to warn that a
   request looks like someone who already has an account. Loaded the first time
   the Account requests page is opened, a thousand at a time. */
let MATCH_POOL = null;

async function ensureMatchPool() {
    if (MATCH_POOL || PREVIEW || !supabase) return;
    const rows = [];
    for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase
            .from('university_student')
            .select('id, first_name, last_name, student_id, email, approval_status')
            .order('id', { ascending: true })
            .range(from, from + 999);
        if (error) { console.warn('account match list failed:', error.message); return; }
        rows.push(...(data ?? []));
        if ((data ?? []).length < 1000) break;
    }
    MATCH_POOL = rows;
    renderRequests();
}

/* Approved plans. The adviser's approval is final (shared/js/enrolment/requeststatus.js),
   so this is not a queue to decide: it lists the plans an adviser approved and
   lets the Registrar look one up and reprint its enrollment form. The
   Registrar's own checks come earlier: confirming who a student is (account
   requests) and that their record is right (verification). */

const ADV_PAGE_SIZE = 20;
let ADV_PLANS = [];            // every plan the adviser approved, as loaded
let ADV_PAGE = 1;
let ADV_SORT = { key: 'date', dir: 'desc' };
let ADV_DEFAULT_TERM = null;   // "term|year" of the current term, if any plan is in it
let ADV_TERM_SET = false;      // the term filter is only defaulted once

const planTermKey = (r) => `${r.requested_term ?? ''}|${r.requested_year ?? ''}`;

function planFacts(req) {
    const items = req.request_item ?? [];
    const approved = items.filter(i => i.status === 'approved');
    return {
        approved: approved.length,
        total: items.length,
        units: approved.reduce((sum, i) => sum + Number(i.subject?.units || 0), 0),
    };
}

function filteredPlans() {
    const q = ($('adv-search')?.value || '').trim().toLowerCase();
    const termSel = $('adv-term')?.value || 'all';
    const statusSel = $('adv-status')?.value || 'all';

    const list = ADV_PLANS.filter((r) => {
        if (termSel !== 'all' && planTermKey(r) !== termSel) return false;
        if (statusSel === 'approved' && r.status !== 'approved') return false;
        if (statusSel === 'partial' && r.status !== 'partially_approved') return false;
        if (q && !`${fullName(r.student)} ${r.student?.student_id ?? ''}`.toLowerCase().includes(q)) return false;
        return true;
    });

    const dir = ADV_SORT.dir === 'asc' ? 1 : -1;
    const val = {
        id:    (r) => String(r.student?.student_id ?? ''),
        name:  (r) => fullName(r.student).toLowerCase(),
        term:  (r) => `${r.requested_year ?? 0}-${r.requested_term ?? 0}`,
        units: (r) => planFacts(r).units,
        date:  (r) => new Date(r.created_at).getTime(),
    }[ADV_SORT.key] || (() => 0);
    return list.sort((a, b) => {
        const x = val(a), y = val(b);
        return (x < y ? -1 : x > y ? 1 : 0) * dir;
    });
}

function fillTermFilter() {
    const sel = $('adv-term');
    if (!sel) return;
    const seen = new Map();
    ADV_PLANS.forEach((r) => {
        const k = planTermKey(r);
        if (!seen.has(k)) seen.set(k, `${termLabel(r.requested_term)} ${r.requested_year || ''}`.trim());
    });
    const keys = [...seen.keys()].sort().reverse();
    sel.innerHTML = '<option value="all">All terms</option>' +
        keys.map(k => `<option value="${escapeHtml(k)}">${escapeHtml(seen.get(k))}</option>`).join('');
    if (!ADV_TERM_SET) {
        ADV_TERM_SET = true;
        if (ADV_DEFAULT_TERM && seen.has(ADV_DEFAULT_TERM)) sel.value = ADV_DEFAULT_TERM;
    }
}

function renderAdvisingList() {
    const queue   = $('adv-queue');
    const countEl = $('adv-queue-count');
    if (!queue) return;

    const list = filteredPlans();
    const partial = ADV_PLANS.filter(r => r.status === 'partially_approved').length;
    if (countEl) {
        countEl.textContent = ADV_PLANS.length
            ? `${list.length} of ${ADV_PLANS.length} · ${partial} partly approved`
            : '';
    }

    if (list.length === 0) {
        queue.innerHTML = ADV_PLANS.length === 0
            ? `<div class="empty">
                   <i class="fa-solid fa-inbox" aria-hidden="true"></i>
                   <h3>No approved plans yet</h3>
                   <p>Plans appear here once a faculty adviser approves them.</p>
               </div>`
            : `<div class="empty">
                   <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
                   <h3>No matches</h3>
                   <p>No plan matches that search or filter.</p>
               </div>`;
        return;
    }

    const pages = Math.max(1, Math.ceil(list.length / ADV_PAGE_SIZE));
    ADV_PAGE = Math.min(Math.max(1, ADV_PAGE), pages);
    const from = (ADV_PAGE - 1) * ADV_PAGE_SIZE;
    const shown = list.slice(from, from + ADV_PAGE_SIZE);

    const th = (key, label, cls = '') => {
        const on = ADV_SORT.key === key;
        const arrow = on ? (ADV_SORT.dir === 'asc' ? ' ▲' : ' ▼') : '';
        return `<th class="${cls}" aria-sort="${on ? (ADV_SORT.dir === 'asc' ? 'ascending' : 'descending') : 'none'}">
            <button type="button" class="sort-btn" data-adv-sort="${key}">${escapeHtml(label)}${arrow}</button></th>`;
    };

    queue.innerHTML = `
        <div class="table-wrap">
            <table class="data-table">
                <thead>
                    <tr>
                        ${th('id', 'Student ID')}${th('name', 'Name')}${th('term', 'Term')}
                        <th class="num">Subjects</th>${th('units', 'Units', 'num')}
                        <th>Status</th>${th('date', 'Submitted')}
                        <th></th>
                    </tr>
                </thead>
                <tbody>${shown.map((r) => {
                    const f = planFacts(r);
                    const termLbl = `${termLabel(r.requested_term)} ${r.requested_year || ''}`.trim();
                    return `
                    <tr class="row-link" data-view-plan="${escapeHtml(r.id)}" tabindex="0" role="link">
                        <td class="mono">${escapeHtml(r.student?.student_id || '—')}</td>
                        <td><strong>${escapeHtml(fullName(r.student) || '—')}</strong></td>
                        <td>${escapeHtml(termLbl)}</td>
                        <td class="num">${f.approved} of ${f.total}</td>
                        <td class="num">${f.units}</td>
                        <td>${r.status === 'partially_approved'
                            ? '<span class="pill waiting"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> Partly approved</span>'
                            : '<span class="pill ok"><i class="fa-solid fa-check" aria-hidden="true"></i> Approved</span>'}</td>
                        <td class="dim">${escapeHtml(new Date(r.created_at).toLocaleDateString())}</td>
                        <td class="num">
                            <button type="button" class="btn-small" data-print-plan="${escapeHtml(r.id)}"
                                    aria-label="Print enrollment form for ${escapeHtml(fullName(r.student))}" title="Print enrollment form">
                                <i class="fa-solid fa-print" aria-hidden="true"></i>
                            </button>
                            <i class="fa-solid fa-chevron-right dim" aria-hidden="true"></i>
                        </td>
                    </tr>`;
                }).join('')}
                </tbody>
            </table>
        </div>
        ${pages > 1 ? `
        <div class="pager">
            <span class="dim">${from + 1}–${from + shown.length} of ${list.length}</span>
            <span class="pager-btns">
                <button type="button" class="btn-small" data-adv-page="prev" ${ADV_PAGE === 1 ? 'disabled' : ''}>Previous</button>
                <span class="pager-now">Page ${ADV_PAGE} of ${pages}</span>
                <button type="button" class="btn-small" data-adv-page="next" ${ADV_PAGE === pages ? 'disabled' : ''}>Next</button>
            </span>
        </div>` : ''}`;

    queue.querySelectorAll('tr[data-view-plan]').forEach((row) => {
        row.addEventListener('keydown', (e) => {
            if (e.target !== row) return;
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); window.location.hash = `#advising/${row.dataset.viewPlan}`; }
        });
    });
}

$('adv-search')?.addEventListener('input', () => { ADV_PAGE = 1; renderAdvisingList(); });
$('adv-term')?.addEventListener('change', () => { ADV_PAGE = 1; renderAdvisingList(); });
$('adv-status')?.addEventListener('change', () => { ADV_PAGE = 1; renderAdvisingList(); });
$('adv-queue')?.addEventListener('click', (e) => {
    const sort = e.target.closest('[data-adv-sort]');
    if (sort) {
        const key = sort.dataset.advSort;
        ADV_SORT = { key, dir: ADV_SORT.key === key && ADV_SORT.dir === 'asc' ? 'desc' : (key === 'date' || key === 'units' ? 'desc' : 'asc') };
        ADV_PAGE = 1;
        return renderAdvisingList();
    }
    const pager = e.target.closest('[data-adv-page]');
    if (pager && !pager.disabled) {
        ADV_PAGE += pager.dataset.advPage === 'next' ? 1 : -1;
        return renderAdvisingList();
    }
});

async function loadAdvisingQueue() {
    const queue = $('adv-queue');
    if (!queue) return;

    if (PREVIEW) {
        queue.innerHTML = `
            <div class="empty">
                <i class="fa-solid fa-flask" aria-hidden="true"></i>
                <h3>Preview mode</h3>
                <p>The approved plans read live data and are not simulated here.</p>
            </div>`;
        const c = $('adv-queue-count');
        if (c) c.textContent = '';
        return;
    }

    if (!supabase) return;

    // Includes partially_approved: the subjects the adviser rejected are simply
    // left off the printed form, not brought back.
    const { data: requests, error } = await supabase
        .from('request')
        .select(`
            id, status, registrar_status, requested_term, requested_year, created_at,
            student:student_id (id, first_name, last_name, student_id, year_level, program_id),
            request_item (id, status, subject:subject_id (units))
        `)
        .in('status', ['approved', 'partially_approved'])
        .order('created_at', { ascending: false });

    if (error) {
        console.warn('loadAdvisingQueue failed:', error.message);
        queue.innerHTML = `
            <div class="empty">
                <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
                <h3>Could not load the plans</h3>
                <p>${escapeHtml(error.message)}</p>
            </div>`;
        return;
    }

    // Old plans the Registrar once sent back stay closed and are not listed.
    ADV_PLANS = (requests ?? []).filter(r => window.CurriculogicRequestStatus.finalApproved(r));

    // Open on the current term when there are plans in it, otherwise on all terms.
    const cfg = await window.CurriculogicTerm?.load();
    ADV_DEFAULT_TERM = cfg ? `${cfg.term}|${cfg.year}` : null;
    fillTermFilter();
    ADV_PAGE = 1;
    renderAdvisingList();
}

async function loadAdvisingDetail(requestId) {
    const nameEl    = $('adv-detail-name');
    const countEl   = $('adv-detail-count');
    const actionsEl = $('adv-detail-actions');
    const bodyEl    = $('adv-detail-body');
    if (!bodyEl) return;

    bodyEl.innerHTML = `
        <div class="empty">
            <i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i>
            <h3>Loading</h3>
        </div>`;
    if (actionsEl) actionsEl.innerHTML = '';

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
        console.warn('loadAdvisingDetail failed:', error?.message);
        bodyEl.innerHTML = `
            <div class="empty">
                <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
                <h3>Could not load that plan</h3>
                <p>It may have been reviewed on another device.</p>
            </div>`;
        return;
    }

    const items = req.request_item ?? [];
    const units = items.reduce((sum, i) =>
        i.status === 'approved' ? sum + Number(i.subject?.units || 0) : sum, 0);

    setText('adv-detail-name', fullName(req.student) || '—');

    const subParts = [
        req.student?.student_id || 'No ID',
        ordinal(req.student?.year_level) || 'Year not set',
        [termLabel(req.requested_term), req.requested_year].filter(Boolean).join(' ') || null,
        `submitted ${new Date(req.created_at).toLocaleDateString()}`,
    ].filter(Boolean);
    setText('adv-detail-sub', subParts.join(' · '));

    if (countEl) {
        countEl.textContent =
            `${items.length} subject${items.length === 1 ? '' : 's'} · ${units} units`;
    }

    if (actionsEl) {
        const RS = window.CurriculogicRequestStatus;
        if (RS.finalApproved(req)) {
            actionsEl.innerHTML = `
                <span class="pill ok"><i class="fa-solid fa-check"></i> Approved for enrollment</span>
                <button class="btn-small" data-print-plan="${req.id}">
                    <i class="fa-solid fa-print" aria-hidden="true"></i>
                    Print enrollment form
                </button>`;
        } else if (RS.sentBack(req)) {
            actionsEl.innerHTML =
                '<span class="pill bad"><i class="fa-solid fa-xmark"></i> Sent back earlier (closed)</span>';
        } else {
            actionsEl.innerHTML = '';
        }
    }

    // Read-only: the adviser's per-subject decisions are shown as they were made.
    bodyEl.innerHTML = renderAdvisingTable(items);
}

function renderAdvisingTable(items) {
    const rows = items.map(item => {
        const o = item.offering;
        const time = (o?.start_time && o?.end_time)
            ? `${o.start_time.slice(0, 5)}–${o.end_time.slice(0, 5)}`
            : '';
        const sched = o
            ? [o.section, o.schedule_days, time].filter(Boolean).join(' · ')
            : '—';

        let statusHtml;
        if (item.status === 'approved') {
            // The adviser's note for this subject, if they left one when approving it.
            statusHtml = `<span class="req-status is-approved">
                <i class="fa-solid fa-check" aria-hidden="true"></i> Approved
            </span>${item.remarks ? `<span class="dim" style="display:block;font-size:12px;margin-top:2px;">${escapeHtml(item.remarks)}</span>` : ''}`;
        } else if (item.status === 'rejected') {
            statusHtml = `<span class="req-status is-rejected" title="${escapeHtml(item.remarks || '')}">
                <i class="fa-solid fa-xmark" aria-hidden="true"></i> Not approved
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

async function loadAdvisingCount() {
    if (PREVIEW) {
        setText('stat-advising', '—', 'stat-value muted');
        setText('prof-stat-plans', '—');
        return;
    }
    if (!supabase) return;

    // Approved plans, not counting the old ones the Registrar sent back.
    const { count, error } = await supabase
        .from('request')
        .select('id', { count: 'exact', head: true })
        .in('status', ['approved', 'partially_approved'])
        .or('registrar_status.is.null,registrar_status.neq.rejected');

    if (error) {
        console.warn('advising count failed:', error.message);
        setText('stat-advising', '—', 'stat-value muted');
        return;
    }

    ADVISING_COUNT = count ?? 0;
    setStat('stat-advising', ADVISING_COUNT, 'stat-value');
    setStat('prof-stat-plans', ADVISING_COUNT);
    renderDashboardSummary();

    // Nothing is waiting on the Registrar any more, so the sidebar carries no badge.
    const badge = $('nav-advising');
    if (badge) badge.hidden = true;
}

$('view-advising')?.addEventListener('click', (e) => {
    const printBtn = e.target.closest('[data-print-plan]');
    if (printBtn) return printApprovedPlan(printBtn.dataset.printPlan);

    const viewCard = e.target.closest('[data-view-plan]');
    if (viewCard) {
        window.location.hash = `#advising/${viewCard.dataset.viewPlan}`;
        return;
    }
});

/* Reprints the enrollment form of an approved plan. The loading and the form
   itself are shared with the faculty adviser (advisingslip.js): both print
   the same snapshot of what the adviser approved. */
async function printApprovedPlan(requestId) {
    if (!supabase) return;
    // The list and the detail page each have their own message line.
    const msgBox = $('adv-sub-detail')?.hidden === false ? 'adv-detail-msg' : 'adv-msg';

    if (typeof window.AdvisingSlip === 'undefined') {
        console.error('advisingslip.js not loaded — check script order');
        return showMsg(msgBox, 'Could not open the print view.');
    }

    const result = await window.AdvisingSlip.printApprovedRequest(supabase, requestId, {
        programName,
    });
    if (!result.ok) showMsg(msgBox, result.error);
}


/* boot */

(async function init() {

    if (previewRequested()) {
        PREVIEW = true;
        REGISTRAR = PREVIEW_REGISTRAR;
        REGISTRAR_ID = PREVIEW_REGISTRAR.id;
        document.body.classList.add('is-preview');
        renderProfile(REGISTRAR, PREVIEW_REGISTRAR.email);
        renderNotice(REGISTRAR);
        paintProgramField();
        await loadStudents();
        await loadAdvisingCount();
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
        .select('id, user_id, first_name, last_name, employee_id, email, program_id, is_approved, must_change_password')
        .eq('user_id', AUTH_UID)
        .maybeSingle();

    if (error) {
        // A failed lookup is not proof this is the wrong kind of account;
        // do not bounce a real registrar because the network blinked.
        console.warn('registrar load failed:', error.message);
        setText('greeting', 'Could not load your account');
        return;
    }

    if (staff && staff.is_approved === false) {
        await supabase.auth.signOut();
        window.location.href = LOGIN_PAGE;
        return;
    }

    // A signed-in user with no registrar row (a student or faculty member
    // who edited the URL) has no business here. Send them back instead of
    // showing an empty shell. Not signed out: they are validly signed in,
    // just somewhere else.
    if (!staff) {
        window.location.href = LOGIN_PAGE;
        return;
    }

    REGISTRAR = staff;
    // reviewed_by / verified_by reference registrar_staff.id, not user_id.
    REGISTRAR_ID = staff?.id ?? null;

    renderProfile(staff, session.user.email);
    renderNotice(staff);
    window.CurriculogicForcePassword?.run(supabase, 'registrar');

    // Looked up, not typed: each student's line names their own degree.
    await window.CurriculogicPrograms?.load(supabase);
    paintProgramField();
    loadPhoto();

    await loadStudents();
    await loadAdvisingCount();
    route();
})();

})();