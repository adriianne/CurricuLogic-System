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

/* The term helper reads system_config with this signed-in client (db/052). */
window.CurriculogicTerm?.setClient(supabase);

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

const PREVIEW_PLANS = {
    s1: [{
        id: 'p1', status: 'approved', registrar_status: null, requested_term: 1, requested_year: 2023, created_at: '2026-10-01T03:00:00Z',
        request_item: [
            { id: 'i1', status: 'approved', subject: { code: 'CC-INTCOM11', title: 'Introduction to Computing', units: 3 }, offering: { section: 'BSIT-1A', schedule_days: 'MW', start_time: '10:00:00', end_time: '11:30:00' } },
            { id: 'i2', status: 'approved', subject: { code: 'MATH 101', title: 'Mathematics in the Modern World', units: 3 }, offering: { section: 'BSIT-1A', schedule_days: 'MW', start_time: '13:00:00', end_time: '14:30:00' } },
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

    if (name === 'students') {
        // #students/verified or #students/pending opens that tab; anything else is All
        LIST.filter = (param === 'verified' || param === 'pending') ? param : 'all';
        LIST.page = 1;
        openStudentList();
    }
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

/* The programme this account is assigned to, shown in the header next to the
   term (same field as the Department header). Static: it only changes when an
   admin reassigns the account. */
function paintProgramField() {
    const field = document.getElementById('topbar-program');
    if (!field) return;
    const id = FACULTY?.program_id;
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

    $('greeting').textContent = staff?.first_name
        ? `Welcome back, ${staff.first_name}`
        : 'Welcome back';

    setText('prof-name', full || email);
    setText('prof-sub',  [staff?.employee_id, 'Faculty adviser'].filter(Boolean).join(' \u00b7 '));

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

/* Password change, on the Profile page. Re-authenticate with the current
   password first (catches "left laptop open" and a mistyped current password in
   one step), then call updateUser(). */
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

    // 1. Verify current password by attempting a sign-in.
    const email = FACULTY?.email;
    if (!email) return finish('No email on record for this account.', 'error');

    const { error: authErr } = await supabase.auth.signInWithPassword({ email, password: current });
    if (authErr) return finish('Current password is incorrect.', 'error');

    // 2. Change it.
    const { error: upErr } = await supabase.auth.updateUser({ password: next });
    if (upErr) return finish(upErr.message || 'Could not change password.');

    // 3. Clear the must-change flag if it was set.
    if (FACULTY?.must_change_password && FACULTY?.id) {
        await supabase.rpc('clear_must_change_password');
        FACULTY = { ...FACULTY, must_change_password: false };
    }

    ['pw-current', 'pw-new', 'pw-confirm'].forEach(id => { const el = $(id); if (el) el.value = ''; });
    finish('Password updated.', 'success');
});


/* students */

/* An adviser can have a whole programme of students, so nothing here loads them
   all: counts come from the database as counts, the dashboard shows only the five
   newest, and the Students list fetches one page at a time. STUDENTS is a cache of
   every student shown so far. */

const STUDENT_COLS =
    'id, user_id, first_name, last_name, student_id, email, year_level, is_approved, ' +
    'record_verified, prospectus_id, program_id, created_at, verified_at';
const STUDENT_PAGE_SIZE = 20;

let COUNTS = { total: 0, verified: 0 };
let RECENT = [];

/* The Students list: which page, which filters, and what came back. `seq` makes
   sure a slow answer to an old search never overwrites a newer one. */
const LIST = { page: 1, filter: 'all', year: 'all', search: '', rows: [], total: 0, loaded: false, seq: 0 };

const SL = () => window.CurriculogicStudentList;

function cacheStudents(rows) {
    for (const row of rows ?? []) {
        const i = STUDENTS.findIndex(s => s.id === row.id);
        if (i >= 0) Object.assign(STUDENTS[i], row);
        else STUDENTS.push(row);
    }
}

function localCounts() {
    return { total: STUDENTS.length, verified: STUDENTS.filter(s => s.record_verified).length };
}

async function loadCounts() {
    if (PREVIEW || !supabase) return localCounts();
    const head = () => supabase.from('university_student').select('id', { count: 'exact', head: true });
    const [total, ver] = await Promise.all([head(), head().eq('record_verified', true)]);
    return { total: total.count ?? 0, verified: ver.count ?? 0 };
}

/* Boot: the numbers and the five newest students, for the dashboard and Profile. */
async function loadStudents() {
    if (PREVIEW) {
        STUDENTS = [...PREVIEW_STUDENTS];
        COUNTS = localCounts();
        RECENT = STUDENTS.slice(0, 5);
        renderRecent();
        renderStats();
        return;
    }

    if (!supabase) return;

    const [counts, recent] = await Promise.all([
        loadCounts(),
        supabase.from('university_student').select(STUDENT_COLS)
            .order('created_at', { ascending: false }).limit(5),
    ]);

    if (recent.error) {
        console.warn('student list failed:', recent.error.message);
        const body = $('recent-body');
        if (body) {
            body.innerHTML = `
                <div class="empty">
                    <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
                    <h3>Could not load students</h3>
                    <p>${escapeHtml(recent.error.message)}</p>
                    <p class="dim">If this says permission denied, run db/008_staff_read_access.sql.</p>
                </div>`;
        }
        return;
    }

    COUNTS = counts;
    RECENT = recent.data ?? [];
    cacheStudents(RECENT);
    renderRecent();
    renderStats();
}

function previewMatches(s) {
    if (LIST.filter === 'verified' && !s.record_verified) return false;
    if (LIST.filter === 'pending'  &&  s.record_verified) return false;
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

    let q = supabase.from('university_student').select(STUDENT_COLS, { count: 'exact' });
    if (LIST.filter === 'verified') q = q.eq('record_verified', true);
    if (LIST.filter === 'pending')  q = q.eq('record_verified', false);
    if (LIST.year !== 'all')        q = q.eq('year_level', Number(LIST.year));
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
                <p class="dim">If this says permission denied, run db/008_staff_read_access.sql.</p>
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
    loadStudentList();   // always fresh: a record may have been verified since
}

/* Filter buttons with their live counts. */
function renderStudentChips() {
    const box = $('student-chips');
    if (!box) return;
    const defs = [
        ['all',      'All',                   COUNTS.total],
        ['verified', 'Verified records',      COUNTS.verified],
        ['pending',  'Awaiting verification', Math.max(0, COUNTS.total - COUNTS.verified)],
    ];
    const title = $('students-title');
    if (title) title.textContent = LIST.filter === 'all' ? 'Student list'
        : defs.find(([key]) => key === LIST.filter)[1];
    box.innerHTML = defs.map(([key, label, n]) => `
        <button type="button" class="stu-chip${LIST.filter === key ? ' on' : ''}" data-student-filter="${key}"
                aria-pressed="${LIST.filter === key}">${escapeHtml(label)}<b>${n}</b></button>`).join('');
}

const recordPill = (s) => s.record_verified
    ? '<span class="pill ok">Verified</span>'
    : '<span class="pill waiting">Pending</span>';

function studentRowHtml(s) {
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
            ${s.record_verified
                ? '<span class="stu-bar"><i style="width:0"></i></span><span class="stu-bar-text">&nbsp;</span>'
                : `<span class="stu-bar-text dim">${escapeHtml(s.email || '')}</span>`}
        </span>
        <span class="stu-pills">${recordPill(s)}</span>
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
                <i class="fa-solid ${searching ? 'fa-magnifying-glass' : 'fa-users-slash'}" aria-hidden="true"></i>
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
   is. Cached; a couple of queries however many students are on screen. */
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
            if (!recs || !s.record_verified) continue;
            const p = SL().progress(recs.map(r => ({ subject_id: r.subject_code, status: r.status, units: r.units })), 161);
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

    // progress: passed units of the students with a verified record
    const shown = rows.filter(s => s.record_verified);
    if (!shown.length) return;
    try {
        // Ten students per request keeps every answer well under the row limit.
        const answers = await Promise.all(chunksOf(shown.map(s => s.id), 10).map(ids =>
            supabase.from('academic_record')
                .select('student_id, subject_id, status, subject:subject_id (units)')
                .in('student_id', ids).eq('status', 'PASSED')));
        const byStudent = new Map();
        for (const a of answers) for (const r of a.data ?? []) {
            if (!byStudent.has(r.student_id)) byStudent.set(r.student_id, []);
            byStudent.get(r.student_id).push(r);
        }
        const facts = await prospectusFacts(shown.map(s => s.prospectus_id));
        if (seq !== LIST.seq) return;
        for (const s of shown) {
            const total = facts.get(s.prospectus_id)?.units ?? 0;
            const p = SL().progress(byStudent.get(s.id) ?? [], total);
            setBar(s.id, p.percent, total ? `${p.units} of ${total} units` : `${p.units} units`);
        }
    } catch (err) {
        console.warn('progress bars failed:', err.message);
    }
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
    // Keep the link in step with the tab so Back and refresh land on it
    const key = b.dataset.studentFilter;
    window.location.hash = key === 'all' ? '#students' : `#students/${key}`;
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

$('print-slip')?.addEventListener('click', () => {
    if (!CURRENT_SLIP) return;
    if (typeof window.AdvisingSlip === 'undefined') {
        console.error('advisingslip.js not loaded — check script order');
        return;
    }
    window.AdvisingSlip.print(CURRENT_SLIP);
});

/* dashboard tiles */

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

function renderStats() {
    renderDashboardSummary();
    setStat('stat-students', COUNTS.total, 'stat-value');
    setStat('stat-verified', COUNTS.verified, 'stat-value');
    setStat('stat-pending',  Math.max(0, COUNTS.total - COUNTS.verified), 'stat-value');
    setText('stat-requests', '—', 'stat-value muted');

    // The same numbers on the Profile page.
    setStat('prof-stat-students', COUNTS.total);
    setStat('prof-stat-verified', COUNTS.verified);
    setStat('prof-stat-pending',  Math.max(0, COUNTS.total - COUNTS.verified));
}

let REQUEST_COUNT = null;   // plans waiting for this adviser; null until counted
let REQUEST_FAILED = false;  // the count could not be read

/* The header sentence and the "Needs attention" list for an adviser: plans waiting for review, and students whose
   record is not verified yet. Both are numbers this page already loads. */
function renderDashboardSummary() {
    const DS = window.DashboardSummary;
    if (!DS) return;

    const waiting = REQUEST_COUNT ?? 0;
    const unverified = Math.max(0, COUNTS.total - COUNTS.verified);

    const items = [];
    if (REQUEST_FAILED) {
        items.push({ level: 'info', title: 'The waiting plans could not be counted', detail: 'Try again in a moment.', go: '#requests', label: 'Open requests' });
    }
    if (waiting > 0) {
        items.push({
            level: 'near',
            title: DS.count(waiting, 'plan') + ' waiting for your review',
            detail: 'A student sent it for your approval.',
            go: '#requests', label: 'Review',
        });
    }
    if (unverified > 0) {
        items.push({
            level: 'info',
            title: DS.count(unverified, 'student record') + ' not verified yet',
            detail: 'Pending with the Registrar. Eligibility cannot be worked out until then.',
            go: '#students', label: 'Open students',
        });
    }

    const P = window.CurriculogicPrograms;
    setText('hero-eyebrow', ['Faculty adviser', P?.codeOf(FACULTY?.program_id, ''), P?.collegeOf(FACULTY?.program_id, '') || FACULTY?.department].filter(Boolean).join(' \u00b7 '));
    setText('hero-line', DS.sentence([
        waiting > 0 && DS.count(waiting, 'plan') + ' waiting for your review',
        unverified > 0 && DS.count(unverified, 'student record') + ' not verified yet',
    ], REQUEST_FAILED ? 'The waiting plans could not be counted. Try again in a moment.'
        : REQUEST_COUNT === null ? 'Checking what is waiting.' : 'Nothing is waiting for your review.'));

    setText('attention-note', items.length ? DS.count(items.length, 'item') : '');
    DS.render($('attention-body'), items, escapeHtml);
}

function renderRecent() {
    const body = $('recent-body');
    if (!body) return;

    if (RECENT.length === 0) {
        body.innerHTML = `
            <div class="empty">
                <i class="fa-solid fa-users-slash" aria-hidden="true"></i>
                <h3>No students yet</h3>
                <p>Student accounts will appear here once they have registered.</p>
            </div>`;
        return;
    }

    const rows = RECENT.map((s) => `
        <tr class="row-link" data-open="${escapeHtml(s.id)}" tabindex="0" role="button">
            <td class="mono">${escapeHtml(s.student_id || '—')}</td>
            <td><strong>${escapeHtml(fullName(s) || '—')}</strong></td>
            <td>${escapeHtml(ordinal(s.year_level) || '—')}</td>
            <td>${recordPill(s)}</td>
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

let DETAIL_SEQ = 0;

const longDate = (iso) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—'
        : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

async function fetchStudentById(id) {
    if (!supabase || PREVIEW) return null;
    const { data, error } = await supabase.from('university_student').select(STUDENT_COLS).eq('id', id).maybeSingle();
    if (error) { console.warn('student lookup failed:', error.message); return null; }
    if (data) cacheStudents([data]);
    return data ?? null;
}

function renderStudentHero(s) {
    window.CurriculogicPhoto.paint($('detail-avatar'), null, SL().initialsOf(s.first_name, s.last_name, s.email));
    setText('detail-name', fullName(s) || '—');
    setText('detail-sub',
        `${s.student_id || 'No ID'} · ${ordinal(s.year_level) || 'Year not set'} · ${programName(s)}`);
    $('detail-pills').innerHTML = recordPill(s);
    renderStudentDetails(s, '');
}

function renderStudentDetails(s, curriculum) {
    const record = s.record_verified
        ? `<span class="pill ok">Verified</span>${s.verified_at ? ` <span class="dim">${escapeHtml(longDate(s.verified_at))}</span>` : ''}`
        : '<span class="pill waiting">Awaiting the Registrar</span>';
    $('detail-status').innerHTML = `
        <div class="detail"><dt>University email</dt><dd class="mono">${escapeHtml(s.email || '—')}</dd></div>
        <div class="detail"><dt>Registered</dt><dd>${escapeHtml(longDate(s.created_at))}</dd></div>
        <div class="detail"><dt>Curriculum</dt><dd>${curriculum || '<span class="dim">Not assigned yet</span>'}</dd></div>
        <div class="detail"><dt>Record</dt><dd>${record}</dd></div>`;
}

async function paintDetailPhoto(s, seq) {
    if (PREVIEW || !supabase || !s.user_id) return;
    const url = await window.CurriculogicPhoto.signedUrl(supabase, s.user_id);
    if (seq !== DETAIL_SEQ || !url) return;
    window.CurriculogicPhoto.paint($('detail-avatar'), url, SL().initialsOf(s.first_name, s.last_name, s.email));
}

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
        : '<span class="pill waiting"><i class="fa-solid fa-clock"></i> Waiting for your review</span>';

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

/* How far through the degree, and which curriculum they follow. */
async function renderStudentProgress(s, records, seq) {
    const body = $('detail-progress-body');
    if (!body || seq !== DETAIL_SEQ) return;

    let total = 0;
    let curriculum = '';
    if (PREVIEW) {
        total = 161;
        curriculum = '2024–2025 <span class="pill ok">Active</span>';
    } else if (s.prospectus_id) {
        const facts = await prospectusFacts([s.prospectus_id]);
        if (seq !== DETAIL_SEQ) return;
        const f = facts.get(s.prospectus_id);
        total = f?.units ?? 0;
        if (f?.label) curriculum = `${escapeHtml(f.label)} ${f.active ? '<span class="pill ok">Active</span>' : '<span class="pill waiting">Older version</span>'}`;
    }
    renderStudentDetails(s, curriculum);

    const key = (r) => r.subject_id ?? r.subject_code;
    const kinds = (status) => new Set(records.filter(r => r.status === status).map(key));
    const passedSet = kinds('PASSED');
    const failed = [...kinds('FAILED')].filter(id => !passedSet.has(id)).length;
    const taking = kinds('ENROLLED').size;
    const p = SL().progress(records, total);

    body.innerHTML = `
        <div class="stu-big"><strong>${p.units}</strong><span>${total ? `of ${total} units` : 'units earned'}</span></div>
        <div class="stu-bar big"><i style="width:0"></i></div>
        <p class="stu-bar-text">${total ? `${p.percent}% of the degree` : 'No curriculum assigned yet'}</p>
        <div class="stu-mini">
            <div><strong>${passedSet.size}</strong><span>Passed</span></div>
            <div><strong>${failed}</strong><span>To retake</span></div>
            <div><strong>${taking}</strong><span>Taking</span></div>
        </div>`;
    const bar = body.querySelector('.stu-bar i');
    if (bar) requestAnimationFrame(() => { bar.style.width = `${p.percent}%`; });
}

async function openStudent(studentRowId) {
    const userId = studentRowId;   // university_student.id, not user_id
    const seq = ++DETAIL_SEQ;

    // Clear the slip action from any previous student before the
    // new one is evaluated. Any branch that actually computes a
    // result will set these back below.
    CURRENT_SLIP = null;
    const slipBtnReset = $('print-slip');
    if (slipBtnReset) slipBtnReset.hidden = true;

    const student = STUDENTS.find(s => s.id === userId) ?? await fetchStudentById(userId);
    if (seq !== DETAIL_SEQ) return;

    if (!student) {
        setText('detail-name', 'Student not found');
        setText('detail-sub', '');
        $('detail-pills').innerHTML = '';
        $('detail-term-body').innerHTML = '';
        $('detail-progress-body').innerHTML = '';
        $('detail-status').innerHTML = '';
        $('detail-elig-body').innerHTML = '';
        $('detail-record-body').innerHTML = `
            <div class="empty">
                <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
                <h3>No such student</h3>
                <p>That student could not be found in the list you can access.</p>
            </div>`;
        return;
    }

    renderStudentHero(student);
    paintDetailPhoto(student, seq);
    loadStudentPlan(student, seq);

    const eligNote = $('detail-elig-note');
    const eligBody = $('detail-elig-body');

    // Load once. The table below and the engine above read the same rows.
    const records = await fetchRecords(userId);
    if (seq !== DETAIL_SEQ) return;
    renderStudentRecord(records);
    renderStudentProgress(student, records ?? [], seq);

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

    // The Grade column comes from the same record rows the full table below uses.
    const statuses = window.CurriculogicRecordGrades
        ? window.CurriculogicRecordGrades.attach(statusMap(result), records ?? [])
        : statusMap(result);

    await window.ProspectusGrid.render(
        supabase, student.prospectus_id, eligBody, statuses);

    // The slip prints one semester block of this student's curriculum: their
    // year level, in the term being enrolled (the system's current term).
    const cfg = await window.CurriculogicTerm?.load();
    CURRENT_SLIP = {
        student,
        subjects: kb.subjects,
        rules: kb.rules,
        records,
        term: cfg
            ? { number: cfg.term, year: cfg.year }
            : { label: document.querySelector('.topbar-term')?.textContent?.trim() ?? '' },
        adviser: fullName(FACULTY) || 'Faculty adviser',
        program: {
            name: programName(student),
            code: window.CurriculogicPrograms?.codeOf(student.program_id, '') ?? '',
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

    // A transcript: one table per term, newest first. The term is in the heading,
    // so the rows do not repeat it.
    const RG = window.CurriculogicRecordGrades;
    const groups = RG.groupByTerm(records);

    body.innerHTML = groups.map((g) => {
        const rows = g.rows.map((r) => {
            const [chipClass, chipText] = RG.chipFor(r.status);
            const shown = r.status === 'DROPPED' ? null : RG.pick([r]);
            return `
            <tr>
                <td class="mono">${escapeHtml(r.subject_code)}</td>
                <td>${escapeHtml(r.subject_title || '—')}</td>
                <td class="num">${escapeHtml(r.units)}</td>
                <td class="num rec-grade ${shown ? escapeHtml(shown.tone) : ''}">${shown ? escapeHtml(shown.grade) : '—'}</td>
                <td><span class="pg-chip ${escapeHtml(chipClass)}">${escapeHtml(chipText)}</span></td>
            </tr>`;
        }).join('');

        return `
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
                    <tbody>${rows}</tbody>
                </table>
            </div>
        </section>`;
    }).join('');
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
                <button class="btn-icon btn-xs" data-approve-note-item="${item.id}" title="Approve with a note for the student and the Registrar">
                    <i class="fa-solid fa-pen" aria-hidden="true"></i>
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
            // The adviser's note for this subject, if one was left when approving it.
            statusHtml = `<span class="req-status is-approved">
                <i class="fa-solid fa-check" aria-hidden="true"></i> approved
            </span>${item.remarks ? `<span class="dim" style="display:block;font-size:12px;margin-top:2px;">${escapeHtml(item.remarks)}</span>` : ''}`;
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
    // would confuse the next reader. The exception is a note the adviser
    // writes on purpose when approving ("approve with a note"): that
    // replaces the old remarks and is shown to the student and the Registrar.
    const patch = { status: decision === 'approved' ? 'approved' : 'rejected' };
    if (decision === 'rejected' && note) patch.remarks = note;
    if (decision === 'approved')          patch.remarks = note || null;

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
        REQUEST_COUNT = 3;
        renderDashboardSummary();
        setStat('stat-requests', 3, 'stat-value');
        setStat('prof-stat-requests', 3);
        return;
    }
    const { count, error } = await supabase
        .from('request')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'submitted');

    if (error) {
        console.warn('request count failed:', error.message);
        REQUEST_FAILED = true;
        renderDashboardSummary();
        setText('stat-requests', '—', 'stat-value muted');
        return;
    }
    REQUEST_COUNT = count ?? 0;
    REQUEST_FAILED = false;
    renderDashboardSummary();
    setStat('stat-requests', count ?? 0, 'stat-value');
    setStat('prof-stat-requests', count ?? 0);
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

    // Approve, and leave a short note the student and the Registrar will see. Empty = a plain approval.
    const approveNote = e.target.closest('[data-approve-note-item]');
    if (approveNote) {
        const note = window.prompt('Note for the student and the Registrar (optional)?\n\nFor example: "Take this together with NCM 105" or "See me before enrolling".');
        if (note === null) return;
        const tooLong = remarkTooLong(note.trim());
        if (tooLong) return showMsg(parseHash().param ? 'req-detail-msg' : 'req-msg', tooLong);
        return reviewRequestItem(Number(approveNote.dataset.approveNoteItem), 'approved', note.trim() || null);
    }

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
        paintProgramField();
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
    loadPhoto();
    renderNotice(staff);
    window.CurriculogicForcePassword?.run(supabase, 'faculty');

    // Looked up, not typed: each student's line names their own degree.
    await window.CurriculogicPrograms?.load(supabase);
    paintProgramField();

    await loadStudents();
    loadRequestCount();
    route();
})();

})();