// studentdashboard.js
// Session guard, profile load, and honest empty states.
// The eligibility list stays empty until the prospectus is encoded and the
// student's record is verified by the Registrar.
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


/* ---------- preview mode (development only) ----------
   Renders the dashboard with mock data so layout can be worked on without
   a session. Gated to localhost and file:// — it cannot activate on a
   deployed host, so this block is safe to keep in the repo.

   Usage:  studentdashboard.html?preview=1
           studentdashboard.html?preview=unverified
           studentdashboard.html?preview=orphan                        */

const PREVIEW_HOSTS = ['localhost', '127.0.0.1', ''];

const PREVIEW_STATES = {
    /* Approved and verified — the target state. */
    ready: {
        first_name: 'Althea',
        last_name: 'Villanueva',
        student_id: '2024-01187',
        email: 'althea.villanueva@uc.edu.ph',
        year_level: 2,
        is_approved: true,
        record_verified: true,
    },
    /* Approved, but the Registrar has not confirmed the record. */
    unverified: {
        first_name: 'Althea',
        last_name: 'Villanueva',
        student_id: '2024-01187',
        email: 'althea.villanueva@uc.edu.ph',
        year_level: 2,
        is_approved: true,
        record_verified: false,
    },
    /* Signed in, but no student row is linked to the account. */
    orphan: null,
};

const PREVIEW_EMAIL = 'althea.villanueva@uc.edu.ph';

/* Returns undefined when preview is not requested — distinct from the
   `orphan` state, which is legitimately null. */
function previewStudent() {
    if (!PREVIEW_HOSTS.includes(window.location.hostname)) return undefined;
    const key = new URLSearchParams(window.location.search).get('preview');
    if (key === null) return undefined;
    return key in PREVIEW_STATES ? PREVIEW_STATES[key] : PREVIEW_STATES.ready;
}


/* ---------- mobile nav ---------- */

const shell = $('shell');

$('menu-toggle')?.addEventListener('click', () => shell.classList.toggle('nav-open'));
$('scrim')?.addEventListener('click', () => shell.classList.remove('nav-open'));

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') shell.classList.remove('nav-open');
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


/* ---------- render ---------- */

function renderProfile(student, authEmail) {
    const first = student?.first_name || '';
    const last  = student?.last_name  || '';
    const full  = [first, last].filter(Boolean).join(' ');
    const email = student?.email || authEmail || '—';

    $('avatar').textContent = initials(first, last, email);
    $('user-name').textContent = full || email;
    $('user-sub').textContent  = student?.student_id || '';

    $('greeting').textContent = first ? `Welcome back, ${first}` : 'Welcome back';

    setText('d-name',  full || '—');
    setText('d-sid',   student?.student_id || 'Not yet assigned', 'mono');
    setText('d-email', email, 'mono');
    setText('d-year',  ordinal(student?.year_level) || 'Pending verification');

    // Programme is fixed for the pilot. Once program_id is written on
    // registration and the program table exists, read it from the row.
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
                    Registrar confirms your record. You will be notified once this
                    is complete.
                </div>
            </div>`;
        return;
    }

    box.innerHTML = '';
}

/* Stat tiles. Until the inference engine exists there is nothing to count,
   so show an explicit dash with the reason rather than leaving them blank. */
function renderStats(student) {
    const pending = !student || !student.record_verified;

    ['stat-eligible', 'stat-locked', 'stat-done', 'stat-units'].forEach((id) => {
        setText(id, '—', 'stat-value muted');
    });

    const hint = pending ? 'Awaiting record verification' : 'Awaiting curriculum data';
    document.querySelectorAll('.stats .stat-hint').forEach((el, i) => {
        el.dataset.original = el.dataset.original || el.textContent;
        el.textContent = i === 0 ? hint : el.dataset.original;
    });
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

    // Record verified, but the knowledge base has not been encoded yet.
    if (note) note.textContent = 'Awaiting curriculum data';
    body.innerHTML = `
        <div class="empty">
            <i class="fa-solid fa-diagram-project" aria-hidden="true"></i>
            <h3>Curriculum not yet available</h3>
            <p>
                Your record is verified, but the BSIT prospectus has not been
                encoded in the system yet. Subject eligibility will appear here
                once the curriculum is published by Department Staff.
            </p>
        </div>`;
}

function render(student, email) {
    renderProfile(student, email);
    renderNotice(student);
    renderStats(student);
    renderEligibility(student);
}


/* ---------- boot ---------- */

(async function init() {

    const mock = previewStudent();
    if (mock !== undefined) {
        document.body.classList.add('is-preview');
        render(mock, PREVIEW_EMAIL);
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

    // The program_id join was removed: register.js never writes that column,
    // and a missing column or table errors the entire select — which made a
    // healthy row look like "no student record found".
    const { data: student, error } = await supabase
        .from('university_student')
        .select('first_name, last_name, student_id, email, year_level, is_approved, record_verified')
        .eq('user_id', session.user.id)
        .maybeSingle();

    if (error) console.warn('student load failed:', error.message);

    // Approved accounts only. An unapproved session should not have got here,
    // but guard anyway in case approval was revoked after sign-in.
    if (student && student.is_approved === false) {
        await supabase.auth.signOut();
        window.location.href = LOGIN_PAGE;
        return;
    }

    render(student, session.user.email);
})();

})();