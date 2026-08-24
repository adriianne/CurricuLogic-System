// studentdashboard.js
// Session guard, profile load, and honest empty states.
// The eligibility list stays empty until the prospectus is encoded and the
// student's record is verified by the Registrar.

(function () {
'use strict';

const SUPABASE_URL = 'https://kibleqlooeaetpbelhve.supabase.co';
const SUPABASE_ANON_KEY = 'PASTE_YOUR_ANON_KEY_HERE';

const supabase = window.supabase
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

const $ = (id) => document.getElementById(id);

const LOGIN_PAGE = 'loginpage.html';


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
    setText('d-program', student?.program?.name || 'BS Information Technology');

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

function renderEligibility(student) {
    const body = $('elig-body');
    const note = $('elig-note');
    if (!body) return;

    if (!student || !student.record_verified) {
        note.textContent = '';
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
    note.textContent = 'Awaiting curriculum data';
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


/* ---------- boot ---------- */

(async function init() {
    if (!supabase) {
        setText('greeting', 'Cannot reach the service');
        return;
    }

    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
        window.location.href = LOGIN_PAGE;
        return;
    }

    const { data: student, error } = await supabase
        .from('university_student')
        .select('first_name, last_name, student_id, email, year_level, is_approved, record_verified, program:program_id (name)')
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

    renderProfile(student, session.user.email);
    renderNotice(student);
    renderEligibility(student);
})();

})();