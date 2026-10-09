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

    if (name === 'requests') renderRequests();
    if (name === 'students') renderStudents();
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

/* Password change. Same pattern as Department Staff's and Faculty's:
   re-authenticate with the current password first, then updateUser().
   Registrar had no self-service path for this before -- and given this
   role verifies every student's identity and record, that was arguably
   the more urgent of the two dashboards to fix. */
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

    const email = REGISTRAR?.email;
    if (!email) return finish('No email on record for this account.', 'error');

    const { error: authErr } = await supabase.auth.signInWithPassword({
        email,
        password: current,
    });
    if (authErr) return finish('Current password is incorrect.', 'error');

    const { error: upErr } = await supabase.auth.updateUser({ password: next });
    if (upErr) return finish(upErr.message || 'Could not change password.');

    if (REGISTRAR?.must_change_password && REGISTRAR_ID) {
        await supabase.rpc('clear_must_change_password');
        REGISTRAR = { ...REGISTRAR, must_change_password: false };
    }

    finish('Password updated.', 'success');
    setTimeout(close, 900);
}

$('p-change-password')?.addEventListener('click', openPasswordModal);


/* data */

const SELECT_COLS =
    'id, first_name, last_name, student_id, email, year_level, is_approved, ' +
    'record_verified, approval_status, declared_path, review_note, created_at, ' +
    'program_id, prospectus_id';

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
        ? window.CurriculogicAccountMatches.findMatches(request, STUDENTS)
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
        Object.assign(STUDENTS.find(s => s.id === id), patch);
        afterLoad();
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

    const student = STUDENTS.find(s => s.id === id);
    Object.assign(student, patch);
    if (saved?.student_id) student.student_id = saved.student_id;
    afterLoad();

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
        `${s.student_id || 'No ID'} · ${ordinal(s.year_level) || 'Year not set'} · ${programName(s)}`);

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
    // An unknown status is shown as it is, but as text: this goes into HTML.
    ({ PASSED: 'Passed', FAILED: 'Failed', ENROLLED: 'Enrolled', DROPPED: 'Dropped' })[s] || escapeHtml(s);

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

    const outcome = verified
        ? `${fullName(student)}'s record verified.${pinWarning ? '' : ' Eligibility can now be computed.'}`
        : `${fullName(student)}'s record marked unverified.`;

    showMsg('student-msg',
        pinWarning ? `${outcome} ${pinWarning}` : outcome,
        pinWarning ? 'error' : 'success');
}

$('student-search')?.addEventListener('input', renderStudents);
$('student-filter')?.addEventListener('change', renderStudents);


/* Approved plans. The adviser's approval is final (shared/js/requeststatus.js),
   so this is not a queue to decide: it lists the plans an adviser approved and
   lets the Registrar look one up and reprint its enrollment form. The
   Registrar's own checks come earlier: confirming who a student is (account
   requests) and that their record is right (verification). */

async function loadAdvisingQueue() {
    const queue   = $('adv-queue');
    const countEl = $('adv-queue-count');
    if (!queue) return;

    if (PREVIEW) {
        queue.innerHTML = `
            <div class="empty">
                <i class="fa-solid fa-flask" aria-hidden="true"></i>
                <h3>Preview mode</h3>
                <p>The approved plans read live data and are not simulated here.</p>
            </div>`;
        if (countEl) countEl.textContent = '';
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
    const list = (requests ?? []).filter(r => window.CurriculogicRequestStatus.finalApproved(r));
    if (countEl) countEl.textContent = list.length ? `${list.length} plan${list.length === 1 ? '' : 's'}` : '';

    if (!list.length) {
        queue.innerHTML = `
            <div class="empty">
                <i class="fa-solid fa-inbox" aria-hidden="true"></i>
                <h3>No approved plans yet</h3>
                <p>Plans appear here once a faculty adviser approves them.</p>
            </div>`;
        return;
    }

    queue.innerHTML = list.map(req => {
        const items = req.request_item ?? [];
        const approved = items.filter(i => i.status === 'approved');
        const units = approved.reduce((sum, i) => sum + Number(i.subject?.units || 0), 0);
        const termLbl = `${termLabel(req.requested_term)} ${req.requested_year || ''}`.trim();

        return `
        <div class="req-summary" data-view-plan="${req.id}">
            <div class="req-summary-main">
                <div class="req-summary-name">
                    <strong>${escapeHtml(fullName(req.student))}</strong>
                    <span class="mono">${escapeHtml(req.student?.student_id ?? '')}</span>
                </div>
                <p class="req-summary-meta">
                    ${approved.length} of ${items.length} subject${items.length === 1 ? '' : 's'} approved
                    · ${units} units
                    · ${escapeHtml(termLbl)}
                </p>
                <div class="req-summary-status">
                    ${req.status === 'partially_approved'
                        ? `<span class="req-badge warning">
                               <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
                               Partly approved by the adviser
                           </span>`
                        : `<span class="req-badge ok">
                               <i class="fa-solid fa-check" aria-hidden="true"></i>
                               Approved by the adviser
                           </span>`}
                </div>
            </div>
            <div class="req-summary-action">
                <span class="req-summary-date">submitted ${new Date(req.created_at).toLocaleDateString()}</span>
                <button class="btn-small adv-view-btn" type="button">
                    View
                    <i class="fa-solid fa-chevron-right" aria-hidden="true"></i>
                </button>
            </div>
        </div>`;
    }).join('');
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
            statusHtml = `<span class="req-status is-approved">
                <i class="fa-solid fa-check" aria-hidden="true"></i> Approved
            </span>`;
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
    setText('stat-advising', String(ADVISING_COUNT), 'stat-value');

    // Nothing is waiting on the Registrar any more, so the sidebar carries no badge.
    const badge = $('nav-advising');
    if (badge) badge.hidden = true;
}

$('view-advising')?.addEventListener('click', (e) => {
    const viewCard = e.target.closest('[data-view-plan]');
    if (viewCard) {
        window.location.hash = `#advising/${viewCard.dataset.viewPlan}`;
        return;
    }

    const printBtn = e.target.closest('[data-print-plan]');
    if (printBtn) return printApprovedPlan(printBtn.dataset.printPlan);
});

/* Reprints the enrollment form of an approved plan. The loading and the form
   itself are shared with the faculty adviser (advisingslip.js): both print
   the same snapshot of what the adviser approved. */
async function printApprovedPlan(requestId) {
    if (!supabase) return;

    if (typeof window.AdvisingSlip === 'undefined') {
        console.error('advisingslip.js not loaded — check script order');
        return showMsg('adv-detail-msg', 'Could not open the print view.');
    }

    const result = await window.AdvisingSlip.printApprovedRequest(supabase, requestId, {
        programName,
    });
    if (!result.ok) showMsg('adv-detail-msg', result.error);
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
        .select('id, user_id, first_name, last_name, employee_id, email, is_approved, must_change_password')
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

    await loadStudents();
    await loadAdvisingCount();
    route();
})();

})();