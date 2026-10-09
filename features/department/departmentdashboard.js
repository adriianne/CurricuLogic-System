// departmentdashboard.js
// Department Staff: curriculum authoring.
//
// This is where the knowledge base is written. Every subject and rule
// created here is read by the inference engine at runtime — the engine has
// no built-in knowledge of any programme. That separation is what makes
// this an expert system rather than conditional logic, and it only holds
// if this module can actually write.
//
// Requires config.js to be loaded first.

(function () {
'use strict';

const { SUPABASE_URL, SUPABASE_ANON_KEY, authStorageKey, authOptions } = window.CURRICULOGIC ?? {};

// Bucketed storage key (see config.js) -- department, faculty and
// registrar share the "staff" bucket, since they already share one
// login page/form; this just keeps that bucket separate from student
// and admin sessions in other tabs.
const supabase = (window.supabase && SUPABASE_URL && SUPABASE_ANON_KEY)
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: authOptions ? authOptions(['department_staff']) : { storageKey: authStorageKey?.(['department_staff']) },
    })
    : null;

const $ = (id) => document.getElementById(id);

const LOGIN_PAGE = '../auth/html/staffloginpage.html';

let AUTH_UID    = null;
let STAFF       = null;
let STAFF_ID    = null;   // department_staff.id — the created_by target
let PROSPECTUS  = null;   /* the active version */
let VERSIONS    = [];
let EDITING     = null;   /* the version being edited — not always the active one */
let SUBJECTS    = [];
let RULES       = [];
let OFFERINGS   = [];
let PREVIEW     = false;
let PENDING     = [];
let DIRTY       = new Set();  /* section names with unsaved changes in the schedule */

/* Section prefix — BSIT today, BSN or BSCrim the day a second program
   lands in the DB. Read once from the active prospectus's program.code
   in loadCurriculum(). The default covers the window before that first
   fetch resolves, and the preview branch. */
let PROGRAM_CODE = 'BSIT';

/* ---- working programme ----

   With one programme (BSIT today) none of this does anything: the selector
   is hidden and every variable above holds what it always held. With more
   than one, the page works on ONE programme at a time, chosen in the top
   bar, and the variables above are narrowed to it:

     ALL_VERSIONS  every prospectus version of every programme (the data)
     VERSIONS      the versions of the chosen programme (what the page reads)
     PROSPECTUS    that programme's active version
     PROGRAM_CODE  its code, which prefixes section names (BSN-1A)

   Keeping VERSIONS / PROSPECTUS / PROGRAM_CODE as the names the page
   already reads is deliberate: every place that used "the active version"
   now follows the chosen programme without being touched. */
let ALL_VERSIONS = [];
let PROGRAM_LIST = [];   // every programme, by code
let PROGRAM      = null; // the one being worked on: { id, code, name, college }
const PROGRAM_KEY = 'cl.dept.program';

/* A department account belongs to one programme (db/030), so its list is
   narrowed to that one and the selector stays hidden. The page is still
   programme-scoped in that case: new work is created under that programme. */
let PINNED = false;
const programScoped = () => PROGRAM_LIST.length > 1 || PINNED;

/* Pure. Which programme to work on: the saved choice if it still exists,
   else the programme of the first active version, else the first
   programme. Null when there are none. */
function pickProgram(programs, savedId, versions) {
    if (!programs.length) return null;
    const byId = (id) => programs.find(p => p.id === id) ?? null;
    return byId(savedId)
        ?? byId((versions ?? []).find(v => v.is_active)?.program_id)
        ?? programs[0];
}

/* Pure. The versions belonging to a programme. Every version when no
   programme is given, which is the single-programme case. */
function versionsFor(program, all) {
    return program ? (all ?? []).filter(v => v.program_id === program.id) : (all ?? []);
}

function savedProgramId() {
    try {
        const v = Number(localStorage.getItem(PROGRAM_KEY));
        return Number.isInteger(v) && v > 0 ? v : null;
    } catch (_) { return null; }
}

function saveProgramId(id) {
    try { localStorage.setItem(PROGRAM_KEY, String(id)); } catch (_) { /* private mode */ }
}

/* Called once at boot, before anything reads the variables above. */
function initPrograms() {
    PROGRAM_LIST = window.CurriculogicPrograms?.list() ?? [];
    if (STAFF?.program_id) {
        PROGRAM_LIST = PROGRAM_LIST.filter(p => p.id === STAFF.program_id);
        PINNED = true;
    } else if (!PREVIEW) {
        // No programme assigned: there is nothing to work on, and the page
        // must not fall back to some other programme's data.
        PROGRAM_LIST = [];
        PINNED = true;
    }
    PROGRAM = pickProgram(PROGRAM_LIST, savedProgramId(), ALL_VERSIONS);
    renderProgramSelector();
}

/* The one place versions are assigned, so the two loaders below cannot
   disagree about which programme they describe. */
function setVersions(all) {
    ALL_VERSIONS = all ?? [];

    if (programScoped()) {
        PROGRAM = pickProgram(PROGRAM_LIST, PROGRAM?.id ?? savedProgramId(), ALL_VERSIONS);
    }
    VERSIONS   = versionsFor(programScoped() ? PROGRAM : null, ALL_VERSIONS);
    PROSPECTUS = VERSIONS.find(v => v.is_active) ?? null;

    // Only ever set from a version that carries its programme join, or from
    // the chosen programme. The versions list query has no join, so it must
    // not reset the code to a default.
    if (programScoped() && PROGRAM) PROGRAM_CODE = PROGRAM.code;
    else {
        const derived = PROSPECTUS?.program?.code || VERSIONS[0]?.program?.code;
        if (derived) PROGRAM_CODE = derived;
    }
    renderProgramSelector();
}

/* The topbar shows the programme this account works on. It is a read-only
   field, not a chooser: a department account belongs to exactly one
   programme, and the field follows whichever programme that is. */
function renderProgramSelector() {
    const field = $('dept-program');
    if (!field) return;

    field.value = PROGRAM ? `${PROGRAM.code} — ${PROGRAM.name}` : 'No programme assigned';
    field.title = field.value;
}

/* What exists yet. Schedule and grade upload both write rows that
   reference subject.id, so neither can run against an empty curriculum —
   the FK would reject every row and the operator would see a wall of
   rejections with no cause. */
let READY = {
    prospectus: false,
    subjects:   0,
    students:   0,
    offerings:  0,
    gradeFiles: 0,
};

/* preview mode (development only) */

const PREVIEW_HOSTS = ['localhost', '127.0.0.1', ''];

const PREVIEW_STAFF = {
    id: 'ds1', first_name: 'Department', last_name: 'Staff',
    employee_id: 'EMP-DEPT01', email: 'deptstaff@gmail.com',
    department: 'College of Computer Studies', is_approved: true,
};

const PREVIEW_SUBJECTS = [
    { id: 1, code: 'CC-INTCOM11',  title: 'Introduction to Computing', units: 3, year_level: 1, term: 1, is_elective: false },
    { id: 2, code: 'CC-COMPROG11', title: 'Computer Programming 1',    units: 3, year_level: 1, term: 1, is_elective: false },
    { id: 3, code: 'CC-COMPROG12', title: 'Computer Programming 2',    units: 3, year_level: 1, term: 2, is_elective: false },
    { id: 4, code: 'IT-OOPROG21',  title: 'Object Oriented Programming', units: 3, year_level: 2, term: 1, is_elective: false },
    { id: 5, code: 'IT-CPSTONE30', title: 'Capstone Project 1',        units: 3, year_level: 3, term: 3, is_elective: false },
];

const PREVIEW_RULES = [
    { id: 1, subject_id: 3, prerequisite_subject_id: 2, requirement_type: 'prerequisite', rule_type: 'and', rule_group: 1, threshold_value: null },
    { id: 2, subject_id: 4, prerequisite_subject_id: 3, requirement_type: 'prerequisite', rule_type: 'and', rule_group: 1, threshold_value: null },
    { id: 3, subject_id: 5, prerequisite_subject_id: null, requirement_type: 'standing',  rule_type: 'and', rule_group: 1, threshold_value: 32 },
];

const previewRequested = () =>
    PREVIEW_HOSTS.includes(window.location.hostname) &&
    new URLSearchParams(window.location.search).has('preview');

/* view routing */

const VIEWS = {
    dashboard:  'Dashboard',
    prospectus: 'Prospectus',
    curriculum: 'Curriculum',
    subject:    'Subject',
    schedule:   'Schedule',
    grades:     'Grade upload',
    profile:    'Profile',
};

const shell = $('shell');

function parseHash() {
    const [name, param] = window.location.hash.replace('#', '').split('/');
    return { name: name in VIEWS ? name : 'dashboard', param: param || null };
}

function showView(name, param) {
    Object.keys(VIEWS).forEach((key) => {
        const el = $(`view-${key}`);
        if (el) el.hidden = key !== name;
    });

    document.querySelectorAll('.side-nav a').forEach((link) => {
        const target = name === 'subject' ? 'curriculum' : name;
        link.classList.toggle('active', link.dataset.view === target);
    });

    const title = $('topbar-title');
    if (title) title.textContent = VIEWS[name];

    shell?.classList.remove('nav-open');

    if (name === 'prospectus') loadProspectusList();
    if (name === 'curriculum') renderSubjects();
    if (name === 'subject' && param) openSubject(Number(param));
    if (name === 'schedule') initSchedule();
    if (name === 'grades') initGrades();
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
    ({ 1: '1st Year', 2: '2nd Year', 3: '3rd Year', 4: '4th Year' })[n] || `Year ${n}`;

const termLabel = (t) => ({ 1: '1st Sem', 2: '2nd Sem', 3: 'Summer' })[t] || '—';

const fullName = (p) => [p?.first_name, p?.last_name].filter(Boolean).join(' ');

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* Empty text means "clear the message" — do not apply a status class,
   or the box renders as a colored bar with no content (display: block
   beats the base .msg { display: none } rule). */
function showMsg(boxId, text, type = 'error') {
    const box = $(boxId);
    if (!box) return;
    box.textContent = text;
    box.className = text ? 'msg ' + type : 'msg';
}

/* Grouped rejection display. One block per unique reason, ordered by
   count descending, so a wall of identical errors reads as one problem
   rather than a scattershot list. A single distinct error among many
   duplicates stays visible instead of getting buried.

   `bad`  is [{ kind, line, detail }, ...]
   `meta` maps kind -> { label, mode: 'chips' | 'lines', hint? }

   Returns the inner HTML of a notice block's text side. The caller
   wraps it in .notice .pending with the icon. */
function renderRejectionGroups(bad, meta) {
    if (!bad?.length) return '';

    const groups = new Map();
    for (const b of bad) {
        const key = b.kind || 'other';
        if (!groups.has(key)) {
            groups.set(key, {
                key,
                label: meta[key]?.label ?? 'Other',
                mode:  meta[key]?.mode  ?? 'lines',
                hint:  meta[key]?.hint  ?? '',
                items: [],
            });
        }
        groups.get(key).items.push(b);
    }

    const ordered = [...groups.values()]
        .sort((a, b) => b.items.length - a.items.length);

    return `
        <strong>${bad.length} row${bad.length === 1 ? '' : 's'} need${bad.length === 1 ? 's' : ''} attention</strong>
        <div class="reject-groups">
            ${ordered.map(g => `
                <div class="reject-group">
                    <p class="reject-head">
                        <span class="reject-count">${g.items.length}</span>
                        ${escapeHtml(g.label)}
                    </p>
                    ${g.mode === 'chips'
                        ? `<p class="reject-chips">${
                            [...new Set(g.items.map(i => i.detail))]
                                .map(d => `<code>${escapeHtml(d)}</code>`)
                                .join(' ')
                          }</p>`
                        : `<ul class="reject-lines">${
                            g.items.map(i => `<li>Line ${i.line}: ${escapeHtml(i.detail)}</li>`).join('')
                          }</ul>`}
                    ${g.hint ? `<p class="reject-hint">${escapeHtml(g.hint)}</p>` : ''}
                </div>
            `).join('')}
        </div>`;
}

const subjectById = (id) => SUBJECTS.find(s => s.id === id);
const rulesFor    = (id) => RULES.filter(r => r.subject_id === id);

/* profile */

/* Renders the profile hero avatar. When a URL is present the image
   covers the initials; when it isn't, the initials show through the
   indigo circle. Same pattern as the topbar, just larger. */
function renderAvatar(url) {
    const hero = $('p-avatar');
    const initials_el = $('p-avatar-initials');
    const topbar = $('avatar');

    if (url) {
        hero.style.backgroundImage = `url("${url}")`;
        if (initials_el) initials_el.style.visibility = 'hidden';

        // Topbar avatar becomes the same image, at 34px.
        topbar.style.backgroundImage = `url("${url}")`;
        topbar.style.backgroundSize = 'cover';
        topbar.style.backgroundPosition = 'center';
        topbar.textContent = '';
    } else {
        hero.style.backgroundImage = '';
        if (initials_el) initials_el.style.visibility = 'visible';

        topbar.style.backgroundImage = '';
        topbar.textContent = initials(STAFF?.first_name, STAFF?.last_name, STAFF?.email);
    }
}

function renderProfile(staff, authEmail) {
    const full  = fullName(staff);
    const email = staff?.email || authEmail || '—';
    const initialText = initials(staff?.first_name, staff?.last_name, email);

    // Topbar avatar
    $('avatar').textContent    = initialText;
    $('user-name').textContent = full || email;
    $('user-sub').textContent  = staff?.employee_id || '';
    $('greeting').textContent  = staff?.first_name ? `Welcome back, ${staff.first_name}` : 'Welcome back';

    // Profile hero
    setText('p-name', full || '—');
    setText('p-employee-id', staff?.employee_id || '—');
    setText('p-avatar-initials', initialText);
    renderAvatar(staff?.avatar_url);

    $('p-status-pill').innerHTML = staff?.is_approved
        ? '<span class="pill ok"><i class="fa-solid fa-check"></i> Approved</span>'
        : '<span class="pill waiting"><i class="fa-solid fa-clock"></i> Awaiting approval</span>';

    // Account card
    setText('p-account-employee-id', staff?.employee_id || '—');
    setText('p-account-email', email);
    setText('p-account-created', staff?.created_at
        ? new Date(staff.created_at).toLocaleDateString('en-US', {
              year: 'numeric', month: 'short', day: 'numeric'
          })
        : '—');
}

/* Editable copy of the same fields shown in Account details above.
   Employee ID and email stay read-only — those are identifiers other
   records point at, and changing them here would not be a profile edit,
   it would be a different person's account. */
function fillProfileForm(staff) {
    const set = (id, v) => { const el = $(id); if (el) el.value = v ?? ''; };
    set('p-first', staff?.first_name);
    set('p-last',  staff?.last_name);
    set('p-dept',  staff?.department);
}

async function saveProfile() {
    if (!STAFF_ID) return;

    const first = $('p-first')?.value.trim();
    const last  = $('p-last')?.value.trim();
    const dept  = $('p-dept')?.value.trim();

    if (!first || !last) {
        return showMsg('profile-msg', 'First and last name are required.');
    }

    const btn = $('p-save');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving\u2026'; }

    const finish = (msg, type) => {
        if (btn) { btn.disabled = false; btn.textContent = 'Save changes'; }
        showMsg('profile-msg', msg, type);
    };

    if (PREVIEW) {
        STAFF = { ...STAFF, first_name: first, last_name: last, department: dept };
        renderProfile(STAFF, STAFF.email);
        return finish('Saved (preview only \u2014 not stored).', 'success');
    }

    console.log('DEBUG: about to update where id =', STAFF_ID);
    const { error } = await supabase.from('department_staff')
        .update({ first_name: first, last_name: last, department: dept || null })
        .eq('id', STAFF_ID);
    console.log('DEBUG: update finished, error =', error);

    if (error) {
        console.error('profile update failed:', error.message);
        return finish('Could not save changes. ' + error.message);
    }

    STAFF = { ...STAFF, first_name: first, last_name: last, department: dept };
    renderProfile(STAFF, STAFF.email);
    finish('Profile updated.', 'success');
}

/* Password change. Supabase's updateUser does not require the current
   password by default, but re-authenticating first is the right
   behaviour — it catches "left laptop open" and "typo'd email domain"
   in one step. signInWithPassword also refreshes the session token,
   which is a harmless side effect. */
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

    // 1. Verify current password by attempting a sign-in.
    const email = STAFF?.email;
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
    if (STAFF?.must_change_password && STAFF_ID) {
        await supabase.from('department_staff')
            .update({ must_change_password: false })
            .eq('id', STAFF_ID);
        STAFF = { ...STAFF, must_change_password: false };
    }

    finish('Password updated.', 'success');
    setTimeout(close, 900);
}

$('p-change-password')?.addEventListener('click', openPasswordModal);

$('p-save')?.addEventListener('click', saveProfile);

/* Avatar upload. Downscales to 400px square-ish before sending so a
   phone photo doesn't land in storage at 4 MB. Path is
   {user_id}/avatar-{timestamp}.jpg — the folder is the auth user's
   UUID, which the storage RLS policies enforce. The timestamp suffix
   busts any CDN cache on replace. */
$('p-avatar-file')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    if (!AUTH_UID) return showMsg('profile-msg', 'Not signed in.');

    if (file.size > 5 * 1024 * 1024) {
        return showMsg('profile-msg', 'Image is too large — 5 MB max.');
    }

    const btn = $('p-avatar-edit') ?? document.querySelector('.profile-avatar-edit');
    btn?.classList.add('is-busy');

    try {
        const dataUrl = await downscaleImage(file, 400, 0.85);
        const blob = await (await fetch(dataUrl)).blob();
        const path = `${AUTH_UID}/avatar-${Date.now()}.jpg`;

        const { error: upErr } = await supabase.storage
            .from('staff-avatars')
            .upload(path, blob, { contentType: 'image/jpeg', upsert: true });
        if (upErr) throw upErr;

        const { data: pub } = supabase.storage
            .from('staff-avatars')
            .getPublicUrl(path);
        const url = pub?.publicUrl;
        if (!url) throw new Error('Could not build a public URL.');

        const { error: dbErr } = await supabase
            .from('department_staff')
            .update({ avatar_url: url })
            .eq('id', STAFF_ID);
        if (dbErr) throw dbErr;

        STAFF = { ...STAFF, avatar_url: url };
        renderAvatar(url);

        showMsg('profile-msg', 'Profile picture updated.', 'success');
    } catch (err) {
        console.error('avatar upload failed:', err);
        showMsg('profile-msg', 'Could not upload that image. ' + (err.message || ''));
    } finally {
        btn?.classList.remove('is-busy');
    }
});

function renderNotice(staff) {
    const box = $('status-notice');
    if (!box) return;
    box.innerHTML = staff ? '' : `
        <div class="notice pending">
            <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
            <div>
                <strong>No department record found</strong>
                Your sign-in worked, but no department record is linked to this
                account. Please contact the System Administrator.
            </div>
        </div>`;
}

/* data */

async function loadCurriculum() {
    if (PREVIEW) {
        PROSPECTUS = { id: 3, academic_year: 2023, is_active: true };
        SUBJECTS = [...PREVIEW_SUBJECTS];
        RULES    = [...PREVIEW_RULES];
        PROGRAM_CODE = 'BSIT';
        return afterLoad();
    }

    if (!supabase) return;

    /* Load every version here, not just the active one. loadCurriculum()
       can run before a user ever visits the Prospectus tab -- it fires
       directly on page load -- so it cannot assume loadProspectusList()
       has already populated VERSIONS. Without this, the builder mounted
       with VERSIONS still at its initial empty array, and every year in
       the dropdown showed "New" even when real Active/Draft versions
       existed, because there was nothing to compare against yet.

       program.code is pulled in the same query: it is the source for the
       section prefix (BSIT- today, BSN- or BSCrim- when a second program
       lands), and there is no reason to fetch it separately. */
    const { data: allVersions, error: versionsError } = await supabase
        .from('prospectus')
        .select('id, program_id, academic_year, academic_term, is_active, published_at, program:program_id(code)')
        .order('academic_year', { ascending: false });

    if (versionsError) {
        console.warn('version list failed:', versionsError.message);
    } else {
        setVersions(allVersions);
    }

    const active = PROSPECTUS;

    /* If the join didn't come back with a code (RLS, missing program row,
       PostgREST version quirk), fall back to the first version's code, and
       finally to BSIT. The dashboard has to render regardless. With several
       programmes the code comes from the chosen one instead (setVersions). */
    if (!programScoped()) {
        PROGRAM_CODE = active?.program?.code
                    || VERSIONS[0]?.program?.code
                    || 'BSIT';
    }

    /* A draft can be edited without being active, so the curriculum view
       follows EDITING rather than assuming the active version. Defaulting
       to active keeps the common case one click shorter. If the programme
       has just changed, what was being edited belongs to the old one. */
    if (!EDITING || (programScoped() && EDITING.program_id !== PROGRAM?.id)) {
        EDITING = active ?? VERSIONS[0] ?? null;
    }
    mountCurriculumBuilder();

    const pros = EDITING;

    if (!pros) {
        // Nothing of a previously chosen programme may linger: with several
        // programmes this is what a new one looks like before its first
        // curriculum exists.
        SUBJECTS = [];
        RULES    = [];
        const grid = $('cb-grid');
        if (grid) grid.innerHTML = '';
        afterLoad();

        $('prospectus-body').innerHTML = `
            <div class="empty">
                <i class="fa-solid fa-diagram-project" aria-hidden="true"></i>
                <h3>No active prospectus${programScoped() && PROGRAM ? ' for ' + escapeHtml(PROGRAM.code) : ''}</h3>
                <p>Create one before adding subjects.</p>
            </div>`;
        return;
    }

    const { data: subs, error: subErr } = await supabase
        .from('subject')
        .select('id, code, title, units, lec_units, lab_units, year_level, term, is_elective, elective_type, is_active')
        .eq('prospectus_id', EDITING.id)
        .order('year_level').order('term').order('code');

    if (subErr) {
        console.warn('subject load failed:', subErr.message);
        return;
    }

    // Every prerequisite in the database is fetched in the single-programme
    // case, as it always was. With several programmes that would fold
    // another programme's rules into this one's counts and integrity
    // check, so only the rules of THIS curriculum's subjects are read.
    let rulesQuery = supabase
        .from('prerequisite')
        .select('id, subject_id, prerequisite_subject_id, requirement_type, rule_type, rule_group, threshold_value');
    if (programScoped()) {
        const ids = (subs ?? []).map(s => s.id);
        rulesQuery = ids.length ? rulesQuery.in('subject_id', ids) : null;
    }
    const { data: rules } = rulesQuery ? await rulesQuery : { data: [] };

    // An elective type marks a slot even if is_elective was saved false.
    SUBJECTS = (subs ?? []).map(s =>
        ({ ...s, is_elective: s.is_elective === true || s.elective_type != null }));
    RULES    = rules ?? [];
    afterLoad();
}

function afterLoad() {
    renderEditingSelector();
    READY.prospectus = !!PROSPECTUS;
    READY.subjects   = SUBJECTS.length;

    renderSetupBadge();
    renderTiles();
    renderProspectus();
    renderIntegrity();
    renderSubjects();
    renderSubjectOptions();
}

/* dashboard */

/* The four themed tiles at the top of the dashboard. Each one carries
   a headline number, a short status line, and links to the page where
   the operator can act on it. */
function renderTiles() {
    // ── Curriculum ────────────────────────────────────────────────
    const rulesCount = RULES.length;
    const unitsTotal = SUBJECTS
        .filter(s => s.term != null)
        .reduce((t, s) => t + Number(s.units || 0), 0);
    const ungated = SUBJECTS
        .filter(s => s.year_level >= 2 && !RULES.some(r => r.subject_id === s.id))
        .length;

    setText('tile-curriculum-number', String(SUBJECTS.length));
    setText('tile-curriculum-status',
        `${rulesCount} rule${rulesCount === 1 ? '' : 's'} · ` +
        `${unitsTotal} units` +
        (ungated ? ` · ${ungated} unconstrained` : ''));

    // ── Schedule ──────────────────────────────────────────────────
    const offeringsCount = READY.offerings;
    setText('tile-schedule-number', String(offeringsCount));
    setText('tile-schedule-status',
        offeringsCount > 0
            ? `offering${offeringsCount === 1 ? '' : 's'} published`
            : 'nothing published yet');

    // ── Grade uploads ─────────────────────────────────────────────
    const gradeFiles = READY.gradeFiles;
    setText('tile-grades-number', String(gradeFiles));
    setText('tile-grades-status',
        gradeFiles > 0
            ? `upload${gradeFiles === 1 ? '' : 's'} recorded`
            : 'no uploads yet');
}

function renderProspectus() {
    const body = $('prospectus-body');
    const note = $('prospectus-note');
    if (!body || !PROSPECTUS) return;

    if (note) note.textContent = `${SUBJECTS.length} subjects`;

    const byTerm = new Map();
    for (const s of SUBJECTS) {
        const k = `${s.year_level}-${s.term}`;
        if (!byTerm.has(k)) byTerm.set(k, []);
        byTerm.get(k).push(s);
    }

    body.innerHTML = `
        <dl>
            <div class="detail"><dt>Programme</dt><dd>${escapeHtml(
                window.CurriculogicPrograms?.nameOf(PROSPECTUS.program_id, PREVIEW ? 'BS Information Technology' : '—') ?? '—')}</dd></div>
            <div class="detail"><dt>Effective year</dt><dd>${escapeHtml(PROSPECTUS.academic_year)}</dd></div>
            <div class="detail"><dt>Status</dt><dd>${PROSPECTUS.is_active
                ? '<span class="pill ok">Active</span>'
                : '<span class="pill waiting">Draft</span>'}</dd></div>
        </dl>
        <div class="table-wrap" style="margin-top: var(--s3)">
            <table class="data-table">
                <thead><tr><th>Year</th><th>Term</th><th class="num">Subjects</th><th class="num">Units</th></tr></thead>
                <tbody>${[...byTerm.entries()].map(([k, list]) => {
                    const [y, t] = k.split('-');
                    const u = list.reduce((sum, s) => sum + Number(s.units || 0), 0);
                    return `<tr>
                        <td>${ordinal(Number(y))}</td>
                        <td>${termLabel(Number(t))}</td>
                        <td class="num">${list.length}</td>
                        <td class="num">${u}</td>
                    </tr>`;
                }).join('')}</tbody>
            </table>
        </div>`;
}

/* Integrity checks run client-side on every load. A cycle would make the
   forward-chaining engine spin rather than fail, so it is worth catching
   the moment a rule is added. */
function renderIntegrity() {
    const body = $('integrity-body');
    const card = $('integrity-card');
    if (!body) return;

    const issues = [];
    const pos = (s) => s.year_level * 10 + s.term;

    for (const r of RULES) {
        if (r.subject_id === r.prerequisite_subject_id) {
            const s = subjectById(r.subject_id);
            issues.push(`${s?.code ?? r.subject_id} requires itself.`);
        }
    }

    for (const r of RULES) {
        if (!r.prerequisite_subject_id) continue;
        const g = subjectById(r.subject_id);
        const q = subjectById(r.prerequisite_subject_id);
        // A "taken alongside" condition may share the same term; only a
        // later one is an error.
        const co = r.requirement_type === 'co_requisite';
        if (g && q && (co ? pos(q) > pos(g) : pos(q) >= pos(g))) {
            issues.push(`${g.code} requires ${q.code}, which is scheduled at the same time or later.`);
        }
    }

    const adj = new Map();
    for (const r of RULES) {
        if (!r.prerequisite_subject_id) continue;
        if (r.requirement_type === 'co_requisite') continue;
        if (!adj.has(r.subject_id)) adj.set(r.subject_id, []);
        adj.get(r.subject_id).push(r.prerequisite_subject_id);
    }
    const seen = new Map();
    const visit = (n, path) => {
        seen.set(n, 1);
        for (const m of adj.get(n) ?? []) {
            if (seen.get(m) === 1) {
                issues.push('Cycle: ' + [...path, m].map(i => subjectById(i)?.code ?? i).join(' → '));
            } else if (!seen.has(m)) {
                visit(m, [...path, m]);
            }
        }
        seen.set(n, 2);
    };
    for (const s of SUBJECTS) if (!seen.has(s.id)) visit(s.id, [s.id]);

    const unique = [...new Set(issues)];
    const count  = unique.length;

    // Tile — reflects count, tinted amber when issues exist.
    const tile = document.querySelector('[data-tile="integrity"]');
    if (tile) tile.classList.toggle('is-clean', count === 0);
    setText('tile-integrity-number', count === 0 ? '✓' : String(count));
    setText('tile-integrity-status',
        count === 0
            ? 'no cycles, self-refs, or ordering issues'
            : `${count} issue${count === 1 ? '' : 's'} to review`);

    // Detail card — only visible when there is something to show.
    // Detail card — only visible when there is something to show.
    if (card) card.hidden = count === 0;
    if (count === 0) return;

    // The vast majority of issues are "prerequisite at same or later
    // term". Emit them as structured rows instead of a prose wall, so
    // the operator can see the pattern (usually a whole elective
    // sequence) and jump straight to the offending subject.
    const rows = [];
    for (const r of RULES) {
        if (!r.prerequisite_subject_id) continue;

        const g = subjectById(r.subject_id);
        const q = subjectById(r.prerequisite_subject_id);
        if (!g || !q) continue;

        const pos = (s) => s.year_level * 10 + s.term;
        const sameOrLater = r.requirement_type === 'co_requisite'
            ? pos(q) > pos(g)
            : pos(q) >= pos(g);
        const self = r.subject_id === r.prerequisite_subject_id;

        if (!sameOrLater && !self) continue;

        const gTerm = g.year_level != null
            ? `${ordinal(g.year_level)} · ${termLabel(g.term)}`
            : '—';
        const qTerm = q.year_level != null
            ? `${ordinal(q.year_level)} · ${termLabel(q.term)}`
            : '—';

        rows.push({
            subjectId: g.id,
            subjectCode: g.code,
            subjectTerm: gTerm,
            prereqCode: self ? g.code : q.code,
            prereqTerm: self ? gTerm : qTerm,
            self,
        });
    }

    const preview = rows.slice(0, 10);
    const rest    = rows.slice(10);

    const rowHtml = (r) => `
        <tr class="row-link" data-open="${r.subjectId}" tabindex="0" role="button">
            <td class="mono">${escapeHtml(r.subjectCode)}</td>
            <td class="dim">${escapeHtml(r.subjectTerm)}</td>
            <td class="mono">${r.self ? '—' : escapeHtml(r.prereqCode)}</td>
            <td class="dim">${r.self ? 'requires itself' : escapeHtml(r.prereqTerm)}</td>
            <td class="num"><i class="fa-solid fa-chevron-right dim" aria-hidden="true"></i></td>
        </tr>`;

    body.innerHTML = `
        <p class="review-hint" style="margin-bottom: var(--s2);">
            These rules point at a prerequisite scheduled at the same
            time or later than the subject that requires it. Open a
            subject to fix its term, or remove the rule from its detail
            page.
        </p>

        <div class="table-wrap">
            <table class="data-table">
                <thead>
                    <tr>
                        <th>Subject</th>
                        <th>Current term</th>
                        <th>Requires</th>
                        <th>Prerequisite term</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody>
                    ${preview.map(rowHtml).join('')}
                    ${rest.length ? `
                        <tr class="integrity-more" hidden>
                            ${rest.map(rowHtml).join('')}
                        </tr>` : ''}
                </tbody>
            </table>
        </div>

        ${rest.length ? `
            <button class="btn-small" id="integrity-show-all" style="margin-top: var(--s2);">
                Show all ${rows.length}
            </button>` : ''}
    `;

    body.querySelectorAll('tr[data-open]').forEach(row => {
        const go = () => { window.location.hash = `#subject/${row.dataset.open}`; };
        row.addEventListener('click', go);
        row.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
        });
    });

    $('integrity-show-all')?.addEventListener('click', () => {
        body.querySelectorAll('.integrity-more').forEach(el => { el.hidden = false; });
        $('integrity-show-all')?.remove();
    }); 
}

/* curriculum */

function filteredSubjects() {
    const term = ($('subject-search')?.value || '').trim().toLowerCase();
    const year = $('year-filter')?.value || 'all';

    return SUBJECTS.filter((s) => {
        if (year !== 'all' && String(s.year_level) !== year) return false;
        if (!term) return true;
        return `${s.code} ${s.title}`.toLowerCase().includes(term);
    });
}

function renderSubjects() {
    const body  = $('subjects-body');
    const count = $('subjects-count');
    if (!body) return;

    const list = filteredSubjects();
    if (count) count.textContent = SUBJECTS.length ? `${list.length} of ${SUBJECTS.length}` : '';

    if (list.length === 0) {
        body.innerHTML = `
            <div class="empty">
                <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
                <h3>${SUBJECTS.length === 0 ? 'No subjects yet' : 'No matches'}</h3>
                <p>${SUBJECTS.length === 0
                    ? 'Add the first subject using the form above.'
                    : 'No subject matches that search or filter.'}</p>
            </div>`;
        return;
    }

    body.innerHTML = `
        <div class="table-wrap">
            <table class="data-table">
                <thead>
                    <tr><th>Code</th><th>Descriptive title</th><th class="num">Units</th>
                        <th>Term</th><th class="num">Rules</th><th></th></tr>
                </thead>
                <tbody>${list.map(s => {
                    const n = rulesFor(s.id).length;
                    return `<tr class="row-link" data-open="${s.id}" tabindex="0" role="button">
                        <td class="mono">${escapeHtml(s.code)}</td>
                        <td>
                            ${escapeHtml(s.title)}
                            ${s.is_elective ? '<span class="pill info">Elective</span>' : ''}
                        </td>
                        <td class="num">${escapeHtml(s.units)}</td>
                        <td class="dim">${ordinal(s.year_level)} · ${termLabel(s.term)}</td>
                        <td class="num">${n === 0
                            ? '<span class="dim">none</span>'
                            : n}</td>
                        <td class="num"><i class="fa-solid fa-chevron-right dim" aria-hidden="true"></i></td>
                    </tr>`;
                }).join('')}</tbody>
            </table>
        </div>`;

    body.querySelectorAll('[data-open]').forEach((row) => {
        const go = () => { window.location.hash = `#subject/${row.dataset.open}`; };
        row.addEventListener('click', go);
        row.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
        });
    });
}

$('subject-search')?.addEventListener('input', renderSubjects);
$('year-filter')?.addEventListener('change', renderSubjects);

$('toggle-add')?.addEventListener('click', () => {
    const pane = $('add-subject-pane');
    pane.hidden = !pane.hidden;
    $('toggle-add').textContent = pane.hidden ? 'Show form' : 'Hide form';
});

/* Two forms appear in the prospectus: hyphenated professional codes
   (CC-INTCOM11, IT-OOPROG21) and space-separated GenEd codes (ENGL 100,
   PE 101, LIT 11). Both must be accepted — a pattern requiring the
   hyphen rejects twenty of the fifty-eight subjects. */
const SUBJECT_CODE_PATTERN = /^[A-Z]{2,6}[- ][A-Z0-9]{1,10}$/;

async function addSubject() {
    showMsg('curriculum-msg', '');

    const code  = $('s-code').value.trim().toUpperCase();
    const title = $('s-title').value.trim();
    const units = Number($('s-units').value);
    const year  = Number($('s-year').value);
    const term  = Number($('s-term').value);
    const elective = $('s-elective').value === 'true';

    if (!code)  return showMsg('curriculum-msg', 'Enter a course code.');
    if (!title) return showMsg('curriculum-msg', 'Enter a descriptive title.');
    if (!units) return showMsg('curriculum-msg', 'Enter the number of units.');

    if (!SUBJECT_CODE_PATTERN.test(code)) {
        return showMsg('curriculum-msg',
            'Code must look like CC-INTCOM11 or ENGL 100 — letters, then a hyphen or space, then the number.');
    }

    if (units > 6) return showMsg('curriculum-msg', 'Maximum units is 6.');
    if (units < 0.5) return showMsg('curriculum-msg', 'Minimum units is 0.5.');
    if (!Number.isInteger(units) && !Number.isInteger(units * 2)) {
        return showMsg('curriculum-msg', 'Units must be in 0.5 increments (e.g., 1.0, 1.5, 2.0)');
    }

    const clash = SUBJECTS.find(s =>
        s.code.replace(/\s/g, '').toUpperCase() === code.replace(/\s/g, ''));
    if (clash) return showMsg('curriculum-msg', `${clash.code} already exists.`);

    const titleClash = SUBJECTS.find(s => s.title.toLowerCase() === title.toLowerCase());
    if (titleClash) {
        return showMsg('curriculum-msg', `"${title}" already exists as a subject title.`);
    }

    const row = {
        prospectus_id: PROSPECTUS.id,
        code, title, units,
        year_level: year,
        term: term,
        is_elective: elective,
        created_by: STAFF_ID,
    };

    if (PREVIEW) {
        SUBJECTS.push({ ...row, id: Date.now() });
        afterLoad();
        clearSubjectForm();
        return showMsg('curriculum-msg', `${code} added (preview).`, 'success');
    }

    const { data, error } = await supabase.from('subject').insert([row]).select().single();

    if (error) {
        console.error('subject insert failed:', error.message);
        return showMsg('curriculum-msg', 'Could not add that subject. ' + error.message);
    }

    SUBJECTS.push(data);
    SUBJECTS.sort((a, b) =>
        a.year_level - b.year_level || a.term - b.term || a.code.localeCompare(b.code));
    afterLoad();
    clearSubjectForm();
    showMsg('curriculum-msg', `${code} added.`, 'success');
}

function clearSubjectForm() {
    ['s-code', 's-title', 's-units'].forEach(id => { $(id).value = ''; });
    $('s-year').value = '1';
    $('s-term').value = '1';
    $('s-elective').value = 'false';
    $('s-code').focus();
}

$('add-subject')?.addEventListener('click', addSubject);

/* subject detail — the prerequisite editor */

let CURRENT_SUBJECT = null;

function openSubject(id) {
    const s = subjectById(id);
    CURRENT_SUBJECT = s ?? null;

    if (!s) {
        setText('detail-code', 'Subject not found');
        setText('detail-sub', '');
        $('rules-body').innerHTML = '';
        return;
    }

    setText('detail-code', s.code);
    setText('detail-sub',
        `${s.title} · ${s.units} units · ${ordinal(s.year_level)} ${termLabel(s.term)}` +
        (s.is_elective ? ' · Elective' : ''));

    fillEditForm(s);
    renderRules();
    renderSubjectOptions();
}

/* edit and retire */

function fillEditForm(s) {
    const set = (id, v) => { const el = $(id); if (el) el.value = v ?? ''; };

    set('e-code',  s.code);
    set('e-title', s.title);
    set('e-lec',   s.lec_units ?? '');
    set('e-lab',   s.lab_units || '');
    set('e-year',  s.year_level ?? '');
    set('e-term',  s.term ?? '');

    const state  = $('subject-state');
    const retire = $('e-retire');

    if (state) {
        state.textContent = s.is_active === false ? 'Inactive' : '';
    }
    if (retire) {
        retire.textContent = s.is_active === false
            ? 'Set active'
            : 'Set inactive';
    }
}

async function saveSubjectEdit() {
    if (!CURRENT_SUBJECT) return;

    if (PREVIEW) {
        return showMsg('rule-msg', 'Saved (preview only \u2014 not stored).', 'success');
    }

    const num = (id) => {
        const v = $(id)?.value.trim();
        return v === '' || v == null ? null : Number(v);
    };

    const { data, error } = await supabase.rpc('update_subject', {
        target_id:  CURRENT_SUBJECT.id,
        p_code:     $('e-code')?.value ?? '',
        p_title:    $('e-title')?.value ?? '',
        p_lec:      num('e-lec') ?? 0,
        p_lab:      num('e-lab') ?? 0,
        p_year:     num('e-year'),
        p_term:     num('e-term'),
        p_category: null,
    });

    if (error) {
        console.error('update_subject failed:', error.message);
        return showMsg('rule-msg', error.message);
    }

    /* Renaming a subject that students have already taken is worth
       flagging: prerequisites resolve by id and survive, but grade files
       and schedule templates match on the printed code. */
    let msg = `${data.code} saved.`;
    if (data.code_changed && data.records) {
        msg += ` The code changed and ${data.records} academic record` +
               `${data.records === 1 ? '' : 's'} reference it \u2014 any grade file ` +
               'prepared against the old code will no longer match.';
    }

    showMsg('rule-msg', msg, 'success');
    await loadCurriculum();
    openSubject(CURRENT_SUBJECT.id);
}

async function retireSubject() {
    if (!CURRENT_SUBJECT) return;

    if (PREVIEW) {
        return showMsg('rule-msg', 'Set inactive (preview only \u2014 not stored).', 'success');
    }

    const restoring = CURRENT_SUBJECT.is_active === false;

    if (restoring) {
        const { error } = await supabase.rpc('retire_subject', {
            target_id: CURRENT_SUBJECT.id, restore: true, confirm: true,
        });
        if (error) return showMsg('rule-msg', error.message);

        showMsg('rule-msg', `${CURRENT_SUBJECT.code} is active again.`, 'success');
        await loadCurriculum();
        return openSubject(CURRENT_SUBJECT.id);
    }

    // First call reports what retiring would affect; it does not act.
    const { data: check, error: e1 } = await supabase.rpc('retire_subject', {
        target_id: CURRENT_SUBJECT.id, restore: false, confirm: false,
    });

    if (e1) {
        console.error('retire check failed:', e1.message);
        return showMsg('rule-msg', e1.message);
    }

    const lines = [`Set ${check.code} inactive?`, ''];

    if (check.records) {
        lines.push(`${check.records} academic record${check.records === 1 ? '' : 's'} ` +
                   'reference it. Those grades stay readable.');
    }
    if (check.dependents?.length) {
        lines.push('',
            `These subjects require it: ${check.dependents.join(', ')}.`,
            'They will be left with a condition no student can satisfy, so ' +
            'remove or change those rules first.');
    }
    if (check.offerings) {
        lines.push('', `${check.offerings} scheduled offering${
            check.offerings === 1 ? '' : 's'} reference it.`);
    }

    lines.push('', 'It stops appearing in the prospectus and stops being ' +
                   'recommended. Nothing is deleted \u2014 grades already ' +
                   'recorded against it stay readable.');

    if (!window.confirm(lines.join('\n'))) return;

    const { error: e2 } = await supabase.rpc('retire_subject', {
        target_id: CURRENT_SUBJECT.id, restore: false, confirm: true,
    });

    if (e2) {
        console.error('retire failed:', e2.message);
        return showMsg('rule-msg', e2.message);
    }

    showMsg('rule-msg', `${check.code} is now inactive.`, 'success');
    await loadCurriculum();
    openSubject(CURRENT_SUBJECT.id);
}

$('e-save')?.addEventListener('click', saveSubjectEdit);
$('e-retire')?.addEventListener('click', retireSubject);

function renderRules() {
    const body  = $('rules-body');
    const count = $('rules-count');
    if (!body || !CURRENT_SUBJECT) return;

    const rules = rulesFor(CURRENT_SUBJECT.id);
    if (count) count.textContent = rules.length ? `${rules.length} condition${rules.length === 1 ? '' : 's'}` : '';

    if (rules.length === 0) {
        body.innerHTML = `
            <div class="empty">
                <i class="fa-solid fa-unlock" aria-hidden="true"></i>
                <h3>No conditions</h3>
                <p>
                    Any student can take ${escapeHtml(CURRENT_SUBJECT.code)}. If that
                    is not intended, add a condition below.
                </p>
            </div>`;
        return;
    }

    const groups = new Map();
    for (const r of rules) {
        const g = r.rule_group ?? 1;
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g).push(r);
    }

    body.innerHTML = [...groups.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([g, list], i) => `
            ${i > 0 ? '<p class="rule-join">and</p>' : ''}
            <div class="rule-group">
                <span class="rule-group-label">Group ${g}${list.length > 1 ? ' — any one of' : ''}</span>
                ${list.map(r => `
                    <div class="rule-row">
                        <span>${describeRule(r)}</span>
                        <button class="btn-icon" data-drop="${r.id}"
                                aria-label="Remove condition">
                            <i class="fa-solid fa-trash-can" aria-hidden="true"></i>
                        </button>
                    </div>`).join('')}
            </div>`).join('');

    body.querySelectorAll('[data-drop]').forEach(b =>
        b.addEventListener('click', () => dropRule(Number(b.dataset.drop))));
}

function describeRule(r) {
    if (r.requirement_type === 'standing') {
        // threshold_value is a position (22 = 2nd year, 2nd sem); the engine
        // reads it the same way, so the text and the check cannot disagree.
        const E = window.CurricuLogicEngine;
        const pos = E.standingPosition(r.threshold_value);
        return `Must have completed all subjects through ${E.describePosition(pos)}`;
    }
    const s = subjectById(r.prerequisite_subject_id);
    const label = s ? `<strong>${escapeHtml(s.code)}</strong> ${escapeHtml(s.title)}` : 'unknown subject';
    return r.requirement_type === 'co_requisite'
        ? `Must be taken alongside ${label}`
        : `Must have passed ${label}`;
}

/* The subject picker excludes the subject being edited and anything
   scheduled at or after it — a prerequisite in a later term is always a
   transcription error, so it should not be offerable. */
function renderSubjectOptions() {
    const sel = $('r-subject');
    if (!sel || !CURRENT_SUBJECT) return;

    const pos = (s) => s.year_level * 10 + s.term;
    const options = SUBJECTS
        .filter(s => s.id !== CURRENT_SUBJECT.id && pos(s) < pos(CURRENT_SUBJECT))
        .map(s => `<option value="${s.id}">${escapeHtml(s.code)} — ${escapeHtml(s.title)}</option>`);

    sel.innerHTML = options.length
        ? options.join('')
        : '<option value="">No earlier subject available</option>';
}

$('r-type')?.addEventListener('change', () => {
    const standing = $('r-type').value === 'standing';
    $('field-subject').hidden   = standing;
    $('field-threshold').hidden = !standing;
});

async function addRule() {
    showMsg('rule-msg', '');
    if (!CURRENT_SUBJECT) return;

    const type  = $('r-type').value;
    const group = Number($('r-group').value) || 1;

    const row = {
        subject_id:              CURRENT_SUBJECT.id,
        requirement_type:        type,
        rule_type:               'and',
        rule_group:              group,
        prerequisite_subject_id: null,
        threshold_value:         null,
        created_by:              STAFF_ID,
    };

    if (type === 'standing') {
        row.threshold_value = Number($('r-threshold').value);
    } else {
        const sid = Number($('r-subject').value);
        if (!sid) return showMsg('rule-msg', 'Choose the required subject.');
        row.prerequisite_subject_id = sid;

        const dupe = rulesFor(CURRENT_SUBJECT.id)
            .find(r => r.prerequisite_subject_id === sid);
        if (dupe) return showMsg('rule-msg', 'That subject is already a condition here.');
    }

    if (PREVIEW) {
        RULES.push({ ...row, id: Date.now() });
        renderRules(); renderStats(); renderIntegrity();
        return showMsg('rule-msg', 'Condition added (preview only — not saved).', 'success');
    }

    const { data, error } = await supabase.from('prerequisite').insert([row]).select().single();

    if (error) {
        console.error('rule insert failed:', error.message);
        return showMsg('rule-msg', 'Could not add that condition. ' + error.message);
    }

    RULES.push(data);
    renderRules(); renderStats(); renderIntegrity(); renderSubjects();
    showMsg('rule-msg', 'Condition added. The engine applies it immediately.', 'success');
}

async function dropRule(id) {
    if (PREVIEW) {
        RULES = RULES.filter(r => r.id !== id);
        renderRules(); renderStats(); renderIntegrity();
        return;
    }

    const { error } = await supabase.from('prerequisite').delete().eq('id', id);

    if (error) {
        console.error('rule delete failed:', error.message);
        return showMsg('rule-msg', 'Could not remove that condition.');
    }

    RULES = RULES.filter(r => r.id !== id);
    renderRules(); renderStats(); renderIntegrity(); renderSubjects();
    showMsg('rule-msg', 'Condition removed.', 'success');
}

$('add-rule')?.addEventListener('click', addRule);

/* curriculum upload */

/* Which version the Curriculum tab is editing. Defaults to the active
   one; a draft has to be selectable or a new version could never be
   filled in. */
/* The year picker lives inside the builder now — it can also offer years
   that have no prospectus row yet, which the card-head select could not.
   This keeps only the warning about editing a live curriculum. */
function renderEditingSelector() {
    const warn = $('editing-warning');
    if (!warn) return;

    warn.textContent = !EDITING ? ''
        : EDITING.is_active
            ? 'This is the active version. Changes affect student recommendations immediately.'
            : 'This is a draft. Changes do not affect students until it is made active.';
}

/* prospectus versions */

async function loadProspectusList() {
    const body = $('pros-body');
    if (!body) return;

    if (PREVIEW) {
        VERSIONS = [{ id: 3, academic_year: 2023, academic_term: 1, is_active: true,
                      published_at: null, subject_count: 58, student_count: 1 }];
        return renderVersions();
    }

    const { data, error } = await supabase
        .from('prospectus')
        .select('id, program_id, academic_year, academic_term, is_active, published_at, created_at')
        .order('academic_year', { ascending: false });

    if (error) {
        console.warn('prospectus list failed:', error.message);
        body.innerHTML = `
            <div class="empty">
                <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
                <h3>Could not load versions</h3>
                <p>${escapeHtml(error.message)}</p>
            </div>`;
        return;
    }

    setVersions(data);

    /* Subject counts are fetched per version rather than joined — a
       version with no subjects is a draft nobody has filled in, and that
       distinction matters more than the extra queries cost at this
       scale. */
    await Promise.all(VERSIONS.map(async (v) => {
        const { data: subs } = await supabase
            .from('subject').select('id').eq('prospectus_id', v.id).eq('is_active', true);
        v.subject_count = subs?.length ?? 0;

        /* Students pinned to this version. "Active" says where new
           students go; this says who is still on it, which is the number
           that decides whether a version can be retired. */
        const { count: stud } = await supabase
            .from('university_student')
            .select('id', { count: 'exact', head: true })
            .eq('prospectus_id', v.id);

        v.student_count = stud ?? 0;
    }));

    renderVersions();
    renderSourceOptions();
}

function renderSourceOptions() {
    const sel = $('p-source');
    if (!sel) return;

    sel.innerHTML = [
        '<option value="">Nothing — start empty</option>',
        ...VERSIONS
            .filter(v => v.subject_count > 0)
            .map(v => `<option value="${v.id}">Copy ${escapeHtml(v.academic_year)}` +
                      ` — ${v.subject_count} subjects</option>`),
    ].join('');

    const y = $('p-year');
    if (y && !y.value) y.value = currentAcademicYear();
}

function versionStatus(v) {
    if (v.is_active)   return '<span class="pill ok">Active</span>';
    if (v.published_at) return '<span class="pill info">Published</span>';
    return '<span class="pill waiting">Draft</span>';
}

function renderVersions() {
    const body  = $('pros-body');
    const count = $('pros-count');
    if (!body) return;

    if (count) {
        count.textContent = VERSIONS.length
            ? `${VERSIONS.length} version${VERSIONS.length === 1 ? '' : 's'}`
            : '';
    }

    if (VERSIONS.length === 0) {
        body.innerHTML = `
            <div class="empty">
                <i class="fa-solid fa-layer-group" aria-hidden="true"></i>
                <h3>No prospectus yet</h3>
                <p>Create the first version above, then encode its subjects.</p>
            </div>`;
        return;
    }

    body.innerHTML = `
        <div class="table-wrap">
            <table class="data-table">
                <thead>
                    <tr><th>Effective year</th><th>Starts</th>
                        <th class="num">Subjects</th><th class="num">Students</th>
                        <th>Status</th><th></th></tr>
                </thead>
                <tbody>${VERSIONS.map(v => `
                    <tr>
                        <td class="mono">${escapeHtml(v.academic_year)}</td>
                        <td class="dim">${termLabel(v.academic_term)}</td>
                        <td class="num">${v.subject_count}</td>
                        <td class="num">${v.student_count
                            ? escapeHtml(v.student_count)
                            : '<span class="dim">\u2014</span>'}</td>
                        <td>${versionStatus(v)}</td>
                        <td class="num">
                            ${v.is_active
                                ? '<span class="dim">Default</span>'
                                : `<div style="display:flex; gap:6px; justify-content:flex-end;">
                                    <button class="btn-small" data-activate="${v.id}"
                                    ${v.subject_count === 0 ? 'disabled title="Encode subjects first"' : ''}>
                                    Make active
                                    </button>
                                    <button class="btn-small" data-delete="${v.id}"
                                    style="color:#b91c1c; border-color:#fecaca;">
                                    Delete
                                    </button>
                                </div>`}
                        </td>
                    </tr>`).join('')}
                </tbody>
            </table>
        </div>`;

    body.querySelectorAll('[data-activate]').forEach(b =>
        b.addEventListener('click', () => activateVersion(Number(b.dataset.activate))));

    body.querySelectorAll('[data-delete]').forEach(b =>
        b.addEventListener('click', () => deleteVersion(Number(b.dataset.delete))));

    // Curriculum grid, switchable by version.
    const sel = $('pg-version');
    if (!sel || !window.ProspectusGrid || !VERSIONS.length) return;

    sel.innerHTML = VERSIONS
        .map(v => `<option value="${v.id}">${v.academic_year}–${v.academic_year + 1}` +
        `${v.is_active ? ' · Active' : ' · Draft'}</option>`)
        .join('');

    const active = VERSIONS.find(v => v.is_active) ?? VERSIONS[0];
    sel.value = active.id;

    const draw = () => window.ProspectusGrid.render(
        supabase, Number(sel.value), $('prospectus-grid'));

    sel.onchange = draw;
    draw();

    window.ProspectusGrid.render(supabase, active.id, $('prospectus-grid'));
}

$('toggle-new-pros')?.addEventListener('click', () => {
    const pane = $('new-pros-pane');
    pane.hidden = !pane.hidden;
    $('toggle-new-pros').textContent = pane.hidden ? 'Show' : 'Hide';
    if (!pane.hidden) renderSourceOptions();
});

async function createVersion() {
    showMsg('pros-msg', '');

    const year   = Number($('p-year').value);
    const term   = Number($('p-term').value);
    const source = $('p-source').value;

    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
        return showMsg('pros-msg', 'Enter a four-digit effective year.');
    }

    if (VERSIONS.some(v => v.academic_year === year)) {
        return showMsg('pros-msg', `A ${year} version already exists.`);
    }

    const btn = $('create-pros');
    btn.disabled = true;

    if (PREVIEW) {
        btn.disabled = false;
        return showMsg('pros-msg', 'Version created (preview only — not saved).', 'success');
    }

    let error;

    if (source) {
        /* Copying happens server-side: the prerequisite rows have to point
        at the NEW subject ids, and doing that in pieces over the
           network risks a curriculum whose rules and subjects disagree. */
        ({ error } = await supabase.rpc('copy_prospectus', {
            source_id: Number(source),
            new_year:  year,
            new_term:  term,
            author:    STAFF_ID,
        }));
    } else {
        // Resolve the programme id at insert time. The old fallback
        // hardcoded 1, which was only ever right because BSIT happened
        // to be the first row in a fresh database. After a reset the
        // sequence advances and that guess points at nothing.
        // The programme being worked on, not whichever version is listed
        // first: with two programmes that would file a BSN draft under BSIT.
        let programId = (programScoped() ? PROGRAM?.id : null) ?? VERSIONS[0]?.program_id;
        if (!programId) {
            const { data: prog, error: progErr } = await supabase
                .from('program')
                .select('id')
                .order('id')
                .limit(1)
                .maybeSingle();

            if (progErr || !prog) {
                btn.disabled = false;
                return showMsg('pros-msg',
                    'No programme row found. Create one in the database first.');
            }
            programId = prog.id;
        }

        ({ error } = await supabase.from('prospectus').insert([{
            program_id: programId,
            academic_year: year,
            academic_term: term,
            is_active: false,
            created_by: STAFF_ID,
        }]));
    }

    btn.disabled = false;

    if (error) {
        console.error('create version failed:', error.message);
        return showMsg('pros-msg', 'Could not create that version. ' + error.message);
    }

    await loadProspectusList();

    showMsg('pros-msg',
        source
            ? `${year} created from the ${VERSIONS.find(v => v.id === Number(source))?.academic_year ?? 'source'} version. ` +
            'It is a draft until you make it active.'
            : `${year} created. Encode its subjects under Curriculum.`,
        'success');
}

$('create-pros')?.addEventListener('click', createVersion);

async function activateVersion(id) {
    const v = VERSIONS.find(x => x.id === id);
    const current = VERSIONS.find(x => x.is_active);
    

    /* "Active" means the version a newly registered student is placed on,
    and the one this dashboard opens by default. It does not move
    anyone: students carry their own prospectus_id and are assessed
    against that, which is how a returnee stays on the curriculum they
    enrolled under. Several versions are legitimately in use at once.

    The old wording claimed every student would be reassessed against
    the new version. That was never true and it made the action look
       far more dangerous than it is. */
    const ok = await confirmActivateVersion(v, current);
    if (!ok) return;

    if (PREVIEW) return showMsg('pros-msg', 'Activated (preview only).', 'success');

    const { error } = await supabase.rpc('activate_prospectus', { target_id: id });

    if (error) {
        console.error('activate failed:', error.message);
        return showMsg('pros-msg', 'Could not activate that version. ' + error.message);
    }

    /* The curriculum in memory belongs to the version that was active a
       moment ago, so it has to be reloaded rather than reused. */
    scheduleReady = false;
    await loadProspectusList();
    await loadCurriculum();

    showMsg('pros-msg',
        `New students will be placed on ${v.academic_year}\u2013${v.academic_year + 1}.`,
        'success');
}

/* Confirmation for activating a version. Same shell as the delete
   modal, but activation is reversible -- no typed-year gate, no red
   warning panel. The bullet list describes what will change rather
   than what will be destroyed. */
function confirmActivateVersion(version, current) {
    return new Promise((resolve) => {
        const modal     = $('activate-draft-modal');
        const yearRange = `${version.academic_year}\u2013${version.academic_year + 1}`;

        $('act-year-range').textContent = yearRange;

        $('act-desc').textContent = current
            ? `New students will be placed on this version. ` +
              `${current.academic_year}\u2013${current.academic_year + 1} ` +
              `stops being the default but remains in use by the students already on it.`
            : `New students will be placed on this version.`;

        const notes = [];
        if (current) {
            notes.push(`${current.academic_year}\u2013${current.academic_year + 1} moves to Published`);
        }
        notes.push('Students already enrolled keep their current curriculum');
        notes.push('Takes effect immediately for new registrations');

        $('act-notes').innerHTML = notes.map(n => `<li>${n}</li>`).join('');

        modal.hidden = false;
        setTimeout(() => $('act-go').focus(), 60);

        const close = (result) => {
            modal.hidden = true;
            document.removeEventListener('keydown', onKey);
            $('act-cancel').removeEventListener('click', onCancel);
            $('act-go').removeEventListener('click', onConfirm);
            modal.removeEventListener('click', onBackdrop);
            resolve(result);
        };

        const onConfirm  = () => close(true);
        const onCancel   = () => close(false);
        const onKey      = (e) => { if (e.key === 'Escape') close(false); };
        const onBackdrop = (e) => { if (e.target === modal) close(false); };

        $('act-go').addEventListener('click', onConfirm);
        $('act-cancel').addEventListener('click', onCancel);
        modal.addEventListener('click', onBackdrop);
        document.addEventListener('keydown', onKey);
    });
}

/* Two-phase delete of a draft prospectus. The first RPC call reports
   what would be removed without touching anything; only after the
   operator confirms does the second call actually write. Refused
   server-side if the version is active, has students, or has requests
   pointing at it — those are dependencies a staff member cannot
   silently destroy. */
async function deleteVersion(id) {
    const v = VERSIONS.find(x => x.id === id);
    if (!v) return;

    showMsg('pros-msg', '');

    if (PREVIEW) {
        return showMsg('pros-msg', 'Deleted (preview only).', 'success');
    }

    // ── Phase 1: what would be removed? ──────────────────────────
    const { data: check, error: e1 } = await supabase.rpc(
        'delete_draft_prospectus',
        { target_id: id, confirm: false }
    );

    if (e1) {
        console.error('delete check failed:', e1.message);
        return showMsg('pros-msg', 'Could not check: ' + e1.message);
    }

    if (!check?.ok) {
        return showMsg('pros-msg', check?.error || 'Cannot delete this version.');
    }

    // ── Phase 2: typed confirmation ──────────────────────────────
    const ok = await confirmDeleteDraft(v, check);
    if (!ok) return;

    const yearRange = `${check.academic_year}\u2013${check.academic_year + 1}`;

    // ── Phase 3: actually delete ─────────────────────────────────
    const { data: result, error: e2 } = await supabase.rpc(
        'delete_draft_prospectus',
        { target_id: id, confirm: true }
    );

    if (e2) {
        console.error('delete failed:', e2.message);
        return showMsg('pros-msg', 'Could not delete: ' + e2.message);
    }

    if (!result?.ok) {
        return showMsg('pros-msg', result?.error || 'Delete was refused.');
    }

    // If the deleted version was what we were editing, clear it so the
    // builder falls back to a blank state rather than pointing at a
    // prospectus that no longer exists.
    if (EDITING && EDITING.id === id) EDITING = null;

    await loadProspectusList();
    await loadCurriculum();

    showMsg('pros-msg',
        `Deleted ${yearRange}: ${result.subjects} subjects, ` +
        `${result.prerequisites} rules removed.`,
        'success');
}

/* Populate and open the delete-draft modal defined in the HTML.
   Returns a Promise<boolean> that resolves true if the operator typed
   the year and pressed Delete, false on any other exit.

   The typed-year check is the point: window.confirm() accepts Enter
   the moment it opens, so a stray keystroke can wipe a draft. Here,
   Enter does nothing until the input matches the year being deleted —
   and the year sits in front of the operator as they type it. */
function confirmDeleteDraft(version, check) {
    return new Promise((resolve) => {
        const modal     = $('delete-draft-modal');
        const yearRange = `${check.academic_year}\u2013${check.academic_year + 1}`;
        const yearStr   = String(check.academic_year);

        // ── Populate ────────────────────────────────────────────
        $('del-year-range').textContent = yearRange;
        $('del-year-code').textContent  = yearStr;

        const bullets = [
            check.subjects           ? `${check.subjects} subject(s)` : '',
            check.prerequisites      ? `${check.prerequisites} prerequisite rule(s)` : '',
            check.elective_groups    ? `${check.elective_groups} elective group(s)` : '',
        ].filter(Boolean);

        const list = $('del-removal-list');
        if (bullets.length) {
            list.classList.remove('is-empty');
            list.innerHTML = bullets.map(b => `<li>${b}</li>`).join('');
        } else {
            list.classList.add('is-empty');
            list.innerHTML = '<li>No data attached — just the version row.</li>';
        }

        const input = $('del-confirm-input');
        const goBtn = $('del-go');
        input.value = '';
        input.classList.remove('is-match');
        goBtn.disabled = true;
        goBtn.classList.remove('is-armed');

        modal.hidden = false;
        setTimeout(() => input.focus(), 60);

        // ── Wire up ─────────────────────────────────────────────
        const close = (result) => {
            modal.hidden = true;
            document.removeEventListener('keydown', onKey);
            input.removeEventListener('input', onInput);
            input.removeEventListener('keydown', onKeyInput);
            goBtn.removeEventListener('click', onGo);
            $('del-cancel').removeEventListener('click', onCancel);
            modal.removeEventListener('click', onBackdrop);
            resolve(result);
        };

        const onInput = () => {
            const match = input.value.trim() === yearStr;
            input.classList.toggle('is-match', match);
            goBtn.disabled = !match;
            goBtn.classList.toggle('is-armed', match);
        };

        const onKeyInput = (e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            if (!goBtn.disabled) close(true);
        };

        const onGo = () => {
            if (goBtn.disabled) return;
            close(true);
        };

        const onCancel = () => close(false);

        const onKey = (e) => {
            if (e.key === 'Escape') close(false);
        };

        const onBackdrop = (e) => {
            if (e.target === modal) close(false);
        };

        input.addEventListener('input', onInput);
        input.addEventListener('keydown', onKeyInput);
        goBtn.addEventListener('click', onGo);
        $('del-cancel').addEventListener('click', onCancel);
        modal.addEventListener('click', onBackdrop);
        document.addEventListener('keydown', onKey);
    });
}   

/* setup readiness */

/*
 * The curriculum is the root of everything else. subject_offering and
 * academic_record both carry a foreign key to subject, so a schedule or a
 * grade file cannot be loaded until subjects exist — the database would
 * reject every row, and the operator would be left reading a list of
 * rejections with no stated cause.
 *
 * This is a real constraint, not an imposed workflow order. Grades and
 * schedules do not depend on each other and are not sequenced.
 */
async function loadReadiness() {
    if (PREVIEW) {
        READY.students = 4;
        READY.gradeFiles = 3;
        return;
    }

    /* Rows are fetched rather than counted with head:true. An exact count
       can come back null when the request is shaped slightly differently
       than expected, and a null read as zero would tell the operator that
       setup is incomplete when it is not. At the scale of one programme
       the ids cost nothing.

       An error is reported rather than silently treated as empty — "no
       students" and "cannot read students" need different responses. */
    const [students, offerings, gradeFiles] = await Promise.all([
        supabase.from('university_student').select('id, program_id'),
        supabase.from('subject_offering').select('id, section'),
        supabase.from('grade_file').select('id'),
    ]);

    if (students.error) {
        console.warn('student count failed:', students.error.message);
    }
    if (offerings.error) {
        console.warn('offering count failed:', offerings.error.message);
    }
    if (gradeFiles.error) {
        console.warn('grade file count failed:', gradeFiles.error.message);
    }

    // With several programmes the setup counts describe the chosen one, so
    // "3 offerings published" is not somebody else's schedule.
    // This runs BEFORE the curriculum loads, so PROGRAM and PROGRAM_CODE are not
    // set yet: PROGRAM_CODE still holds its built-in default ('BSIT'). Counting
    // sections by that prefix is right for a BSIT department by accident, and
    // always 0 for BSN or BSCRIM. The account's own programme is already known
    // here (STAFF.program_id), so it is used instead.
    const myProgramId = STAFF?.program_id ?? PROGRAM?.id ?? null;
    const myCode = window.CurriculogicPrograms?.codeOf(myProgramId, '') || PROGRAM?.code || PROGRAM_CODE;
    const scoped = programScoped() && myProgramId != null;
    const mine = (rows, keep) => scoped ? (rows ?? []).filter(keep) : (rows ?? []);
    const prefix = `${myCode}-`.toLowerCase();

    READY.students   = mine(students.data, s => s.program_id === myProgramId).length;
    READY.offerings  = mine(offerings.data, o => String(o.section ?? '').toLowerCase().startsWith(prefix)).length;
    READY.gradeFiles = gradeFiles.data?.length ?? 0;
}

/* Compact setup indicator in the page header. Four dots, one per
   setup step. Disappears entirely once all four are done. */
function renderSetupBadge() {
    const badge = $('setup-badge');
    if (!badge) return;

    const done = [
        READY.prospectus,
        READY.subjects > 0,
        READY.offerings > 0,
        READY.students > 0,
    ];

    const complete = done.filter(Boolean).length;
    const total    = done.length;

    if (complete === total) {
        badge.hidden = true;
        return;
    }

    badge.hidden = false;
    badge.innerHTML = `
        ${done.map(on => `<span class="setup-badge-dot${on ? ' on' : ''}"></span>`).join('')}
        <span class="setup-badge-text">Setup ${complete}/${total}</span>
    `;
}

/* Shown in place of a module that cannot run yet. Says what is missing
   and links to the page that fixes it, rather than presenting a form that
   would reject everything submitted to it. */
function blockedPanel(what, because, href, hrefLabel) {
    return `
        <div class="empty">
            <i class="fa-solid fa-lock" aria-hidden="true"></i>
            <h3>${escapeHtml(what)}</h3>
            <p>${escapeHtml(because)}</p>
            <a class="btn-accent" href="${href}" style="margin-top: var(--s3); display: inline-flex">
                <i class="fa-solid fa-arrow-right" aria-hidden="true"></i>
                <span>${escapeHtml(hrefLabel)}</span>
            </a>
        </div>`;
}

/* One-file curriculum upload. Re-mounted whenever the editing version
   changes, because prospectusId is baked into the commit. */
function mountCurriculumBuilder() {
    if (!window.CurriculumBuilder || !EDITING) return;

    window.CurriculumBuilder.mount(supabase, {
        mountEl:      $('cb-grid'),
        prospectusId: EDITING.id,
        programId:    EDITING.program_id,
        versions:     VERSIONS,
        staffId:      STAFF_ID,
        userId:       AUTH_UID,
        onVersionChange: (id) => {
            if (id) EDITING = VERSIONS.find(v => v.id === id) ?? EDITING;
            renderEditingSelector();
            loadCurriculum();
        },
        onError: (m) => showMsg('curriculum-msg', m),
        onDone:  (m) => {
            showMsg('curriculum-msg', m, 'success');
            loadProspectusList();
            loadCurriculum();
        },
    });
}

/* schedule */

let scheduleReady = false;

/* The academic year now, not the year the prospectus takes effect. Those
   are different: the active prospectus is effective 2023 and is still what
   a 2026 cohort follows, but a schedule or a grade file belongs to the
   term being run. Defaulting to the prospectus year put schedules three
   years in the past.

   The Philippine academic year opens in August, so anything before then
   still belongs to the year that started the previous August. */
function currentAcademicYear() {
    const now = new Date();
    return now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
}

function schedTerm() {
    const year = Number($('sched-year')?.value) || null;
    const term = Number($('sched-term')?.value) || null;
    return { year, term };
}

/* Why one bad row got in: a time typed as "1:00" with no AM/PM is stored
   as 01:00, so NSTP 101 ended up running from 1 AM to 2 PM and passed the
   "start before end" check. Classes run 6:00 AM to 10:00 PM. Times are
   zero-padded 24-hour "HH:MM", so plain string comparison is correct.
   Returns a sentence describing the problem, or null if the times are
   fine (or not both set yet: missing times are reported separately). */
const CLASS_DAY_START = '06:00';
const CLASS_DAY_END   = '22:00';

function scheduleTimeProblem(start, end) {
    const s = String(start ?? '').slice(0, 5);
    const e = String(end ?? '').slice(0, 5);
    if (!s || !e) return null;
    if (s >= e) return 'the start must be before the end.';
    if (s < CLASS_DAY_START) {
        return `starts at ${s}, before 6:00 AM. Check AM/PM (1:00 may mean 13:00).`;
    }
    if (e > CLASS_DAY_END) {
        return `ends at ${e}, after 10:00 PM. Check AM/PM.`;
    }
    return null;
}

/* The term the system is currently on (set by the administrator). Kept so
   the Schedule view can default to it and say when the operator is
   working on a different one. Null until loaded, or if it failed. */
let SYSTEM_TERM = null;

function updateSchedTermNote() {
    const note = $('sched-term-note');
    if (!note) return;

    const { year, term } = schedTerm();
    if (!SYSTEM_TERM || !year || !term) {
        note.className = 'review-hint';   // .msg.error would override [hidden]
        note.hidden = true;
        return;
    }

    const label = window.CurriculogicTerm.formatLabel(SYSTEM_TERM.term, SYSTEM_TERM.year);
    if (year === SYSTEM_TERM.year && term === SYSTEM_TERM.term) {
        note.hidden = false;
        note.className = 'review-hint';
        note.textContent = `This is the current term (${label}). Students see this schedule.`;
    } else {
        note.hidden = false;
        note.className = 'msg error';
        note.textContent =
            `The system is on ${label}. Students only see offerings for that term, ` +
            'so a schedule saved here will not show up for them until the term changes.';
    }
}

/* The section the operator is working on, composed from the two
   dropdowns (Year + Section letter) and the program code. Returns null
   when either dropdown is unset, so callers that gate on "is a section
   chosen?" behave the same as before the split. */
function currentSection() {
    const level  = $('sched-year-level')?.value;
    const letter = $('sched-section-letter')?.value;
    if (!level || !letter) return null;
    return `${PROGRAM_CODE}-${level}${letter}`;
}

/* Derive the year level from a section name: BSIT-2A → 2, BSCrim-3A → 3.
   Prefix-agnostic — the letters before the dash are the program code and
   are not assumed. Returns null when the shape isn't recognised. */
function sectionYear(section) {
    const m = String(section || '').match(/^[A-Z]+-(\d)/i);
    return m ? Number(m[1]) : null;
}

/* BSIT-2A → { course: 'BSIT', yearSection: '2-A' }.
   BSCrim-1B → { course: 'BSCrim', yearSection: '1-B' }.
   Falls back to the raw string when the shape isn't recognised, so a
   non-standard name still renders something readable in the form header. */
function splitSection(section) {
    const m = String(section || '').match(/^([A-Z]+)-(\d+)([A-Z]+)$/i);
    if (!m) return { course: '', yearSection: String(section || '') };
    return { course: m[1], yearSection: `${m[2]}-${m[3]}` };
}

/* 2026 → '2026–27' for the form header. */
function shortYear(y) {
    const n = Number(y);
    if (!Number.isFinite(n)) return String(y ?? '');
    return `${n}\u2013${String(n + 1).slice(-2)}`;
}

async function initSchedule() {
    if (READY.subjects === 0) {
        renderScheduleBlocked();
        return;
    }

    showScheduleForm(true);

    if (!scheduleReady) {
        // The term the system is on comes from system_config; if it cannot
        // be read the page still works, it just does not pre-select one.
        try { SYSTEM_TERM = await window.CurriculogicTerm?.load() ?? null; }
        catch (_) { SYSTEM_TERM = null; }

        renderYearOptions();
        renderSectionLetterOptions();
        bindScheduleTableInputs();
        scheduleReady = true;

        // Start on the current term, so an operator who does nothing is
        // scheduling the term students are looking at.
        if (SYSTEM_TERM) {
            const y = $('sched-year'), t = $('sched-term');
            if (y) y.value = String(SYSTEM_TERM.year);
            if (t) t.value = String(SYSTEM_TERM.term);
        }
    }
    updateSchedTermNote();

    // No forced load. Whether offerings load depends on whether the
    // operator has picked a term and section — the dropdown listeners
    // handle that. loadOfferings() short-circuits to the waiting state
    // when either is blank.
    loadOfferings();
}

/* Every card below the heading is hidden rather than disabled — a form
   that submits nothing useful is worse than no form. */
function showScheduleForm(show) {
    document.querySelectorAll('#view-schedule .card')
        .forEach(c => { c.hidden = !show; });
    const blocked = $('schedule-blocked');
    if (blocked) blocked.hidden = show;
}

function renderScheduleBlocked() {
    showScheduleForm(false);
    const box = $('schedule-blocked');
    if (!box) return;
    box.hidden = false;
    box.innerHTML = blockedPanel(
        'No curriculum to schedule',
        'A schedule assigns sections and meeting times to subjects, so the ' +
        'curriculum has to be encoded first. Every row uploaded now would be ' +
        'rejected for referencing a subject that does not exist.',
        '#curriculum', 'Encode the curriculum');
}

/* Only years that have a prospectus. A free-typed year is how a stray
   keystroke files a term under 2092, where no query will ever find it. */
function renderYearOptions() {
    const sel = $('sched-year');
    if (!sel) return;

    // A curriculum written in 2023 keeps running: the schedule for AY 2026
    // is filed under 2026, not under the year the prospectus was made. So
    // the year the system is currently on is always offered too, even with
    // no prospectus of that year; otherwise the current term could never
    // be scheduled at all.
    const yearSet = new Set(VERSIONS.map(v => v.academic_year));
    if (SYSTEM_TERM?.year) yearSet.add(SYSTEM_TERM.year);
    const years = [...yearSet].filter(Number.isInteger).sort((a, b) => b - a);

    sel.innerHTML = ['<option value="">Select year</option>']
        .concat(years.map(y => `<option value="${y}">${y}\u2013${y + 1}</option>`))
        .join('');

}

/* Populates the year-level dropdown from what exists in OFFERINGS. The
   section-letter dropdown is rebuilt right after. Called after
   loadOfferings() resolves, since both depend on what the query
   returned. */
function renderTopSectionOptions() {
    const existing = new Set(OFFERINGS.map(o => o.section));

    const yearSel = $('sched-year-level');
    if (yearSel) {
        const prev = yearSel.value;
        yearSel.innerHTML = [
            '<option value="">Select year</option>',
            ...[1, 2, 3, 4].map(n => {
                const hasAny = SECTION_LETTERS.some(l =>
                    existing.has(`${PROGRAM_CODE}-${n}${l}`));
                return `<option value="${n}">${n}${hasAny ? '' : ' (new)'}</option>`;
            }),
        ].join('');

        if (prev && ['1', '2', '3', '4'].includes(prev)) yearSel.value = prev;
    }

    renderSectionLetterOptions(existing);
}

/* The two section dropdowns, populated together because they answer one
   question between them. */

function renderSectionLetterOptions(existing) {
    const sel = $('sched-section-letter');
    if (!sel) return;

    existing = existing ?? new Set(OFFERINGS.map(o => o.section));
    const level = Number($('sched-year-level')?.value) || 1;
    const options = [];

    for (const letter of SECTION_LETTERS) {
        const name = `${PROGRAM_CODE}-${level}${letter}`;
        if (existing.has(name)) options.push({ letter, isNew: false });
    }
    // Offer only the FIRST missing letter for this year.
    for (const letter of SECTION_LETTERS) {
        const name = `${PROGRAM_CODE}-${level}${letter}`;
        if (!existing.has(name)) {
            options.push({ letter, isNew: true });
            break;
        }
    }

    const prev = sel.value;
    sel.innerHTML = options
        .map(o => `<option value="${o.letter}">${o.letter}${o.isNew ? ' (new)' : ''}</option>`)
        .join('');

    if (options.some(o => o.letter === prev)) {
        sel.value = prev;
    } else {
        const preferred = options.find(o => !o.isNew) ?? options[0];
        if (preferred) sel.value = preferred.letter;
    }
}


async function loadOfferings() {
    const body = $('offerings-body');
    if (!body) return;

    const { year, term } = schedTerm();

    // No term selected → show the waiting state. PostgREST rejects
    // `.eq('academic_year', null)` with a 400, so the query must not
    // run at all until both dropdowns have real values.
    if (!year || !term) {
        OFFERINGS = [];
        PENDING = [];
        DIRTY.clear();
        body.innerHTML = `
            <div class="empty">
                <i class="fa-solid fa-filter" aria-hidden="true"></i>
                <h3>Choose a term and section</h3>
                <p>Pick the dropdowns above, or upload a photo and the
                   section will fill in automatically.</p>
            </div>`;
        return;
    }

    body.innerHTML = `
        <div class="empty">
            <i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i>
            <h3>Loading</h3>
            <p>Fetching offerings.</p>
        </div>`;

    if (PREVIEW) {
        OFFERINGS = OFFERINGS.filter(o => o.academic_year === year && o.term === term);
        return renderOfferings();
    }

    let offeringQuery = supabase
        .from('subject_offering')
        .select('id, edp_code, subject_id, meeting_type, section, schedule_days, start_time, end_time, room, instructor, capacity, is_open')
        .eq('academic_year', year)
        .eq('term', term)
        .order('section');

    // Sections are named after their programme (BSN-1A), so with several
    // programmes only this one's are listed; otherwise every programme's
    // sections would appear as if they were its own.
    if (programScoped()) offeringQuery = offeringQuery.ilike('section', `${PROGRAM_CODE}-%`);

    const { data, error } = await offeringQuery;

    if (error) {
        console.warn('offering load failed:', error.message);
        body.innerHTML = `
            <div class="empty">
                <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
                <h3>Could not load offerings</h3>
                <p>${escapeHtml(error.message)}</p>
            </div>`;
        return;
    }

    OFFERINGS = data ?? [];
    PENDING = OFFERINGS.map(o => ({ ...o }));
    DIRTY.clear();
    tagPendingKeys();

    renderOfferings();
}

/* Two events: 'input' for typing, 'change' for selects and time
   pickers. Both write back into PENDING and mark the form dirty. No
   re-render — that would drop focus mid-keystroke. */
function bindScheduleTableInputs() {
    const mount = $('offerings-body');
    if (!mount || mount.dataset.bound) return;
    mount.dataset.bound = '1';

    const write = (row, field, value) => {
        if (field === 'subject_id') {
            row.subject_id = Number(value);
            // Changing the subject resets the meeting type if the new
            // subject has no lab, otherwise the row would carry a LAB
            // type that the subject cannot support.
            const s = subjectById(row.subject_id);
            if (Number(s?.lab_units) <= 0) row.meeting_type = 'LEC';
        } else if (field === 'meeting_type') {
            row.meeting_type = value;
        } else {
            row[field] = value;
        }
        DIRTY.add(row.section);
    };

    mount.addEventListener('input', (e) => {
        const field = e.target.closest('[data-field]');
        const tr    = e.target.closest('tr[data-row]');
        if (!field || !tr) return;
        const row = PENDING.find(r => r.__key === tr.dataset.row);
        if (!row) return;
        write(row, field.dataset.field, field.value);
        updateSaveButton();
    });

    mount.addEventListener('change', (e) => {
        const field = e.target.closest('[data-field]');
        const tr    = e.target.closest('tr[data-row]');
        if (!field || !tr) return;
        const row = PENDING.find(r => r.__key === tr.dataset.row);
        if (!row) return;
        write(row, field.dataset.field, field.value);
        updateSaveButton();

        // Subject or type changed — the row needs a repaint because the
        // units column and the meeting-type options both depend on them.
        if (field.dataset.field === 'subject_id' || field.dataset.field === 'meeting_type') {
            renderOfferings();
        }
    });
}

/* Dirty is per-section, not global. A Set keyed by section name lets
   the Save / Discard buttons and the "Unsaved" stat card answer for the
   section actually on screen, without leaking into other sections that
   may be sitting in PENDING with their own edits. */
function updateSaveButton() {
    const section = currentSection();
    const isDirty = section ? DIRTY.has(section) : false;

    const btn = $('sched-save');
    if (btn) btn.disabled = !isDirty;

    const discard = $('sched-discard');
    if (discard) discard.disabled = !isDirty;

    const stat = document.querySelector('#schedule-stats .upload-stat:last-child');
    if (stat) {
        stat.classList.toggle('is-issues', isDirty);
        stat.querySelector('.k').textContent = isDirty ? 'Unsaved' : 'Saved';
        stat.querySelector('.v').textContent = isDirty ? '●' : '✓';
        stat.querySelector('.u').textContent = isDirty ? 'changes pending' : 'no changes';
    }
}

function timeRange(a, b) {
    if (!a && !b) return '—';
    const t = (x) => x ? x.slice(0, 5) : '';
    return `${t(a)}–${t(b)}`;
}

/* Re-fetches offerings for whatever the four dropdowns currently say
   and rebuilds everything that depends on them. Same sequence the
   year/term 'change' listeners already run -- this is what a caller
   reaches for after setting the dropdowns some other way (a save that
   needs a fresh read from the database, or the photo-scan mismatch
   banner switching to the detected section programmatically). */
async function reloadScheduleView() {
    await loadOfferings();
    renderTopSectionOptions();
    refreshTemplateCount();
    renderOfferings();
}

function renderOfferings() {
    const body  = $('offerings-body');
    const stats = $('schedule-stats');
    const count = $('offerings-count');
    if (!body) return;

    const { year, term } = schedTerm();
    const section = currentSection();

    const visible = section
        ? PENDING.filter(o => o.section === section)
        : [];
    if (count) {
        count.textContent = section
            ? `${visible.length} offering${visible.length === 1 ? '' : 's'} · ${section}`
            : '';
    }

    // Stats. Lab rows carry no units of their own — the subject's full
    // unit value belongs to the LEC row, so only LEC rows count.
    const subjects   = new Set(visible.map(o => o.subject_id));
    const totalUnits = visible.reduce((sum, o) => {
        if (o.meeting_type === 'LAB') return sum;
        const s = subjectById(o.subject_id);
        return sum + Number(s?.units || 0);
    }, 0);

    const isDirty = section ? DIRTY.has(section) : false;

    if (stats) {
        stats.innerHTML = `
            <div class="upload-stat">
                <p class="k">Subjects</p>
                <p class="v">${subjects.size}</p>
                <p class="u">scheduled</p>
            </div>
            <div class="upload-stat">
                <p class="k">Offerings</p>
                <p class="v">${visible.length}</p>
                <p class="u">lecture + lab</p>
            </div>
            <div class="upload-stat">
                <p class="k">Units</p>
                <p class="v">${totalUnits}</p>
                <p class="u">lecture only</p>
            </div>
            <div class="upload-stat${isDirty ? ' is-issues' : ''}">
                <p class="k">${isDirty ? 'Unsaved' : 'Saved'}</p>
                <p class="v">${isDirty ? '●' : '✓'}</p>
                <p class="u">${isDirty ? 'changes pending' : 'no changes'}</p>
            </div>
        `;
    }

    if (!section) {
        body.innerHTML = `
            <div class="empty">
                <i class="fa-solid fa-layer-group" aria-hidden="true"></i>
                <h3>Choose a section</h3>
                <p>Select a year and section above to see the schedule.</p>
            </div>`;
        return;
    }

    // Form header — COURSE / YEAR & SECTION / AY · term.
    const { course, yearSection } = splitSection(section);
    const ayLabel = `${shortYear(year)} · ${termLabel(term)}`;

    body.innerHTML = `
        <div class="sched-form">
            <div class="sched-form-head">
                <div class="sched-form-head-group">
                    <span class="sched-form-label">COURSE:</span>
                    <span class="sched-form-value">${escapeHtml(course || '—')}</span>
                </div>
                <div class="sched-form-head-group">
                    <span class="sched-form-label">YEAR &amp; SECTION:</span>
                    <span class="sched-form-value">${escapeHtml(yearSection)}</span>
                </div>
                <div class="sched-form-head-ay">${escapeHtml(ayLabel)}</div>
            </div>

            <div class="table-wrap">
                <table class="data-table sched-edit-table">
                    <thead>
                        <tr>
                            <th class="col-edp">EDP CODE</th>
                            <th>SUBJECT</th>
                            <th class="col-type">TYPE</th>
                            <th class="col-units num">UNITS</th>
                            <th class="col-time">START TIME</th>
                            <th class="col-time">END TIME</th>
                            <th class="col-days">DAYS</th>
                            <th class="col-room">ROOM</th>
                            <th class="col-drop"></th>
                        </tr>
                    </thead>
                    <tbody>
                        ${visible.map(o => rowHtmlFor(o, section, year, term)).join('')}
                        <tr class="sched-add-row">
                            <td colspan="9">
                                <button class="btn-small" data-add-row>
                                    <i class="fa-solid fa-plus" aria-hidden="true"></i>
                                    Add a row
                                </button>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <div class="sched-form-actions">
                <button class="btn-secondary" id="sched-discard"
                        ${isDirty ? '' : 'disabled'}>
                    Discard
                </button>
                <button class="btn-primary" id="sched-save"
                        ${isDirty ? '' : 'disabled'}>
                    Save ${escapeHtml(section)}
                </button>
            </div>
        </div>
    `;

    $('sched-save')?.addEventListener('click', commitPending);
    $('sched-discard')?.addEventListener('click', discardPending);
    body.querySelectorAll('[data-drop]').forEach(b =>
        b.addEventListener('click', () => dropPendingRow(b.dataset.drop)));
    body.querySelector('[data-add-row]')?.addEventListener('click', () => addPendingRow(section));
}

let NEXT_KEY = 1;
const nextKey = () => `r${NEXT_KEY++}`;

function addPendingRow(section) {
    const year = sectionYear(section);
    const term = schedTerm().term;

    // No pre-selected subject. The dropdown shows a "Select subject"
    // placeholder and the operator must pick one. Auto-picking the
    // first eligible subject hid the fact that a choice needed to be
    // made — rows could be saved with a wrong subject if the operator
    // tabbed through without noticing the pre-filled value.
    PENDING.push({
        __key:        nextKey(),
        id:           null,             // null = not yet in the DB
        edp_code:     '',
        subject_id:   null,
        meeting_type: 'LEC',
        section,
        academic_year: year,
        term,
        schedule_days: '',
        start_time:   '',
        end_time:     '',
        room:         '',
        instructor:   '',
    });

    DIRTY.add(section);
    renderOfferings();
}

function dropPendingRow(key) {
    const row = PENDING.find(r => r.__key === key);
    if (row) DIRTY.add(row.section);
    PENDING = PENDING.filter(r => r.__key !== key);
    renderOfferings();
}

/* Discard reverts the visible section to whatever is in OFFERINGS —
   the last state we know the database agrees with. Rows for other
   sections in PENDING are left untouched: those may hold edits the
   operator made earlier and has not yet saved. */
function discardPending() {
    const section = currentSection();
    if (!section) return;
    if (!DIRTY.has(section)) return;

    const ok = window.confirm(
        `Discard unsaved changes for ${section}?\n\n` +
        'Rows revert to the last saved state. Other sections are not affected.'
    );
    if (!ok) return;

    // Drop this section's rows entirely, then re-add fresh copies
    // straight from OFFERINGS. Rows for other sections stay in PENDING.
    PENDING = PENDING.filter(r => r.section !== section);
    for (const o of OFFERINGS) {
        if (o.section !== section) continue;
        PENDING.push({ ...o, __key: nextKey() });
    }

    DIRTY.delete(section);
    renderOfferings();
    showMsg('sched-msg', `Discarded unsaved changes for ${section}.`, 'success');
}

async function commitPending() {
    const section = currentSection();
    if (!section) return;

    const { year, term } = schedTerm();
    const btn = $('sched-save');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

    // ── Only rows for the currently selected section ─────────────
    // PENDING holds every section for the term, so tab-switching
    // keeps edits for other sections in memory. But the Save button
    // commits one section at a time — the whole workflow is "one
    // file per section," and mixing sections in a single insert
    // would file rows under the wrong section name.
    const sectionRows = PENDING.filter(r => r.section === section);

    // ── Validate ────────────────────────────────────────────────
    const problems = [];
    const seenEdps = new Set();

    // The same limits the database enforces (db/050). Rows reach this grid
    // from the file upload and the photo as well as from typing, so this one
    // check covers all three; a value over the limit is named here instead of
    // failing the whole save.
    const OFFERING_LIMITS = { edp_code: 20, schedule_days: 20, room: 50, instructor: 150 };
    const OFFERING_LABEL  = { edp_code: 'EDP code', schedule_days: 'Days', room: 'Room', instructor: 'Instructor' };

    for (const r of sectionRows) {
        for (const field of Object.keys(OFFERING_LIMITS)) {
            const v = String(r[field] ?? '').trim();
            if (v.length > OFFERING_LIMITS[field]) {
                problems.push(`${OFFERING_LABEL[field]} "${v.slice(0, 20)}…" is too long (${OFFERING_LIMITS[field]} characters at most).`);
            }
        }
        if (!r.edp_code?.trim()) problems.push('Every row needs an EDP code.');
        if (seenEdps.has(r.edp_code)) problems.push(`EDP ${r.edp_code} is used more than once.`);
        seenEdps.add(r.edp_code);
        if (!r.subject_id)            problems.push('Every row needs a subject.');
        if (!r.schedule_days?.trim()) problems.push('Every row needs days.');
        if (!r.start_time || !r.end_time) problems.push('Every row needs start and end times.');
        const timeProblem = scheduleTimeProblem(r.start_time, r.end_time);
        if (timeProblem) problems.push(`${r.edp_code}: ${timeProblem}`);
        if (!r.room?.trim())          problems.push('Every row needs a room.');
    }

    if (problems.length) {
        if (btn) { btn.disabled = false; btn.textContent = `Save ${section}`; }
        return showMsg('sched-msg', problems[0]);
    }

    // ── Diff against what was loaded, for this section only ─────
    const sectionOfferings = OFFERINGS.filter(o => o.section === section);
    const originalIds = new Set(sectionOfferings.map(o => o.id));
    const pendingIds  = new Set(sectionRows.filter(r => r.id).map(r => r.id));
    const toDelete    = [...originalIds].filter(id => !pendingIds.has(id));

    // ── Delete removed rows ─────────────────────────────────────
    if (toDelete.length) {
        const { error } = await supabase
            .from('subject_offering')
            .delete()
            .in('id', toDelete);
        if (error) {
            if (btn) { btn.disabled = false; btn.textContent = `Save ${section}`; }
            return showMsg('sched-msg', 'Could not remove rows: ' + error.message);
        }
    }

    // ── Upsert the current section's rows ───────────────────────
    if (sectionRows.length) {
        const payload = sectionRows.map(r => {
            const row = {
                edp_code:      r.edp_code.trim(),
                subject_id:    r.subject_id,
                meeting_type:  r.meeting_type,
                academic_year: year,
                term,
                section,
                schedule_days: r.schedule_days?.trim() || null,
                start_time:    r.start_time || null,
                end_time:      r.end_time || null,
                room:          r.room?.trim() || null,
                instructor:    r.instructor?.trim() || null,
            };
            if (r.id) row.id = r.id;
            else row.created_by = STAFF_ID;
            return row;
        });

        const { error } = await supabase
            .from('subject_offering')
            .upsert(payload, {
                onConflict: 'subject_id,academic_year,term,section,meeting_type',
            });

        if (error) {
            if (btn) { btn.disabled = false; btn.textContent = `Save ${section}`; }
            if (error.code === '23505' && String(error.details || '').includes('uq_offering_edp')) {
                return showMsg('sched-msg', 'One of the EDP codes is already used by another offering in this term.');
            }
            return showMsg('sched-msg', 'Could not save: ' + error.message);
        }
    }

    showMsg('sched-msg',
        `${sectionRows.length} offering${sectionRows.length === 1 ? '' : 's'} saved for ${section}.`,
        'success');
    await reloadScheduleView();
}

/* Assign keys to any row that arrived without one (fresh from the DB,
   or freshly added by the upload path). Called from loadOfferings. */
function tagPendingKeys() {
    for (const o of PENDING) {
        if (!o.__key) o.__key = nextKey();
    }
}

/* One editable row. Inputs carry data-field so the input handler can
   write straight back into PENDING without re-rendering the table —
   a full render on every keystroke would steal focus mid-word.

   The subject cell wraps its content in a <div class="sched-subject-cell">
   rather than styling the <td> directly: `display: flex` on a table cell
   would pull it out of the table layout and break column widths. The
   wrapper gets the flex treatment from CSS. */
function rowHtmlFor(o, section, year, term) {
    const s       = subjectById(o.subject_id);
    const hasLab  = Number(s?.lab_units) > 0;
    const isLab   = o.meeting_type === 'LAB';
    const units   = isLab ? '—' : (s?.units ?? '—');

    const subjectOptions = subjectOptionsFor(section, term, o.subject_id);

    return `<tr data-row="${o.__key}"${isLab ? ' class="sched-row-lab"' : ''}>
        <td><input data-field="edp_code" value="${escapeHtml(o.edp_code || '')}"
                   placeholder="61251" autocomplete="off" maxlength="20"></td>
        <td>
            <div class="sched-subject-cell">
                ${isLab ? '<span class="sched-lab-arrow" aria-hidden="true">↳</span>' : ''}
                <select data-field="subject_id" class="sched-subject-pick">
                    ${subjectOptions}
                </select>
            </div>
        </td>
        <td>
            <select data-field="meeting_type">
                <option value="LEC"${o.meeting_type === 'LEC' ? ' selected' : ''}>LEC</option>
                ${hasLab ? `<option value="LAB"${isLab ? ' selected' : ''}>LAB</option>` : ''}
            </select>
        </td>
        <td class="num">${units}</td>
        <td><input type="time" data-field="start_time" value="${(o.start_time || '').slice(0, 5)}"></td>
        <td><input type="time" data-field="end_time"   value="${(o.end_time   || '').slice(0, 5)}"></td>
        <td><input data-field="schedule_days" value="${escapeHtml(o.schedule_days || '')}" placeholder="MW" maxlength="20"></td>
        <td><input data-field="room" value="${escapeHtml(o.room || '')}" placeholder="215" maxlength="50"></td>
        <td class="num">
            <button class="btn-icon" data-drop="${o.__key}" aria-label="Remove row">
                <i class="fa-solid fa-trash-can" aria-hidden="true"></i>
            </button>
        </td>
    </tr>`;
}

function subjectOptionsFor(section, term, currentId) {
    const year = sectionYear(section);
    const eligible = SUBJECTS.filter(s => {
        if (s.id === currentId) return true;
        if (s.is_active === false) return false;
        if (s.year_level === null) return true;   // elective
        return s.year_level === year && s.term === term;
    });

    // Placeholder first. Selected when no subject has been chosen yet,
    // so a fresh row reads "Select subject" instead of silently landing
    // on the first eligible code. Not disabled — the operator can
    // return here to clear a row if they change their mind.
    const placeholder = `<option value=""${currentId ? '' : ' selected'}>Select subject</option>`;

    const options = eligible.map(s => {
        const hasLab = Number(s.lab_units) > 0;
        const dot    = hasLab ? '🟢' : '🔵';
        const sel    = s.id === currentId ? ' selected' : '';
        return `<option value="${s.id}"${sel}>` +
               `${dot} ${escapeHtml(s.code)} — ${escapeHtml(s.title)}` +
               `</option>`;
    }).join('');

    return placeholder + options;
}

/* Every one of the four dropdowns participates in the "is the section
   ready?" question. When both year and term are set, offerings load;
   otherwise loadOfferings() shows the waiting state. Year level only
   affects which section letters are offered. */
$('sched-year')?.addEventListener('change', () => {
    updateSchedTermNote();
    loadOfferings().then(() => {
        renderTopSectionOptions();
        refreshTemplateCount();
        renderOfferings();
    });
});

$('sched-term')?.addEventListener('change', () => {
    updateSchedTermNote();
    loadOfferings().then(() => {
        renderTopSectionOptions();
        refreshTemplateCount();
        renderOfferings();
    });
});

$('sched-year-level')?.addEventListener('change', () => {
    renderSectionLetterOptions();
    refreshTemplateCount();
    renderOfferings();
});

$('sched-section-letter')?.addEventListener('change', () => {
    refreshTemplateCount();
    renderOfferings();
});


/* Template and upload. Nothing is written until the operator has seen
   what will be written — the GradeFile design in the ERD implies the same
   pattern, so schedule upload follows it. */

/* edp_code is the registrar's identifier for an offering and is filled in
   by hand. capacity was dropped — it is not enforced anywhere, and an
   unused column in a sheet invites someone to fill it in expecting it to
   mean something. */
const CSV_HEADERS = ['edp_code','subject','type','section',
                    'start_time','end_time','days','room','instructor'];

const SECTION_LETTERS = ['A','B','C','D'];

/* The template contains subjects for ONE section — the one currently
   selected on the page. Uploading is done one section at a time,
   matching how the registrar's office schedules. Sections are added to
   the term over time, not all at once.

   Lab subjects produce TWO rows: a LEC row and a LAB row. The LEC row
   carries the subject's full unit value; the LAB row shows an em dash
   in the printed form, and blank in the CSV. This matches the physical
   form exactly. */
function buildTemplateRows() {
    const section = currentSection();
    const term    = schedTerm().term;
    const year    = sectionYear(section);

    if (!section || !year) return [];

    const isElective = (s) => s.year_level === null;

    return SUBJECTS
        .filter(s => s.is_active !== false)
        .filter(s => isElective(s) || (s.year_level === year && s.term === term))
        .filter(s => !isElective(s))
        .sort((a, b) => String(a.code).localeCompare(String(b.code)))
        .flatMap(s => {
            const base = {
                edp_code:   '',
                subject:    s.code,
                section,
                start_time: '',
                end_time:   '',
                days:       '',
                room:       '',
                instructor: '',
            };
            const rows = [{ ...base, type: 'LEC' }];
            if (Number(s.lab_units) > 0) {
                rows.push({ ...base, type: 'LAB' });
            }
            return rows;
        });
}

function refreshTemplateCount() {
    const label   = $('tpl-count');
    const summary = $('tpl-summary');
    if (!label) return;

    const section = currentSection();
    const rows    = buildTemplateRows();
    const n       = rows.length;

    label.textContent = n === 0
        ? 'Nothing to download'
        : `Download template (${n} row${n === 1 ? '' : 's'})`;

    if (summary) {
        const year  = sectionYear(section);
        const term  = termLabel(schedTerm().term);
        const label2 = year ? `Year ${year} · ${term}` : term;
        summary.textContent = section
            ? `Template for ${section} · ${label2}. Pre-filled with ${n} row${n === 1 ? '' : 's'}.`
            : 'Choose a section above to generate a template.';
    }
}

$('download-template')?.addEventListener('click', async () => {
    const section = currentSection();
    if (!section) {
        return showMsg('sched-msg', 'Choose a section before downloading a template.');
    }

    if (typeof ExcelJS === 'undefined') {
        return showMsg('sched-msg', 'The spreadsheet library did not load. Check your connection.');
    }

    const rows = buildTemplateRows();
    if (rows.length === 0) {
        return showMsg('sched-msg', `No subjects for ${section} in this term.`);
    }

    const wb = new ExcelJS.Workbook();
    wb.creator = 'CurricuLogic';
    wb.created = new Date();

    const ws = wb.addWorksheet('Schedule', {
        views: [{ state: 'frozen', ySplit: 2 }],   // freeze the guide + header rows
    });

    // ── Row 1 — guide row, merged across all columns ────────────
    ws.mergeCells('A1:I1');
    const guide = ws.getCell('A1');
    guide.value = 'Fill in EDP CODE, START, END, DAYS, ROOM, and INSTRUCTOR for each row. ' +
                  'Delete any subject not running this term. Rows left blank are treated as skipped.';
    guide.font = { italic: true, size: 10, color: { argb: 'FF64748B' } };
    guide.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
    guide.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    ws.getRow(1).height = 30;

    // ── Row 2 — header ──────────────────────────────────────────
    const headerRow = ws.getRow(2);
    headerRow.values = CSV_HEADERS.map(h => h.toUpperCase().replace(/_/g, ' '));
    headerRow.font = { bold: true, color: { argb: 'FF0F172A' } };
    headerRow.height = 22;
    headerRow.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
        cell.alignment = { vertical: 'middle', horizontal: 'left' };
        cell.border = {
            bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        };
    });

    // ── Rows 3+ — one per template row ──────────────────────────
    rows.forEach((r, i) => {
        const rowNum = i + 3;
        const row = ws.getRow(rowNum);
        row.values = CSV_HEADERS.map(h => r[h]);
        row.height = 18;

        // LAB rows get the amber tint so the pair is obvious. LEC rows
        // stay white. The subject cell renders as plain text — Excel
        // will keep it left-aligned.
        const isLab = String(r.type).toUpperCase() === 'LAB';
        if (isLab) {
            row.eachCell({ includeEmpty: true }, cell => {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFBEB' } };
            });
        }

        row.eachCell({ includeEmpty: true }, cell => {
            cell.alignment = { vertical: 'middle', horizontal: 'left' };
            cell.font = { size: 11 };
        });
    });

    // ── Column widths ───────────────────────────────────────────
    ws.columns = [
        { width: 12 },  // edp_code
        { width: 20 },  // subject
        { width:  8 },  // type
        { width: 12 },  // section
        { width: 12 },  // start_time
        { width: 12 },  // end_time
        { width:  8 },  // days
        { width: 10 },  // room
        { width: 22 },  // instructor
    ];

    // ── Download ────────────────────────────────────────────────
    const { year, term } = schedTerm();
    const fileName = `schedule-${section}-${year}-term${term}.xlsx`;

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);

    showMsg('sched-msg',
        `Template for ${section} with ${rows.length} row${rows.length === 1 ? '' : 's'} downloaded.`,
        'success');
});

$('sched-file')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    showMsg('sched-msg', '');

    try {
        const rows = await readScheduleFile(file);
        await previewUpload(rows);
    } catch (err) {
        console.error('schedule parse failed:', err);
        showMsg('sched-msg', 'Could not read that file. ' + err.message);
    }
});

/* Photo upload follows the same three-step pattern as the AI-assisted
   curriculum upload: idle drop zone → staged file card → reading with
   progress → preview below. The file is not sent until the operator
   presses "Read form", so a mis-tap is one click to undo. */

let PHOTO_FILE    = null;    /* staged, not yet sent */
let PHOTO_READING = false;   /* guards against double-submit */

function renderPhotoStage(state = 'idle', meta = {}) {
    const stage = $('photo-stage');
    if (!stage) return;

    const formatSize = (bytes) => {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    if (state === 'idle') {
        stage.innerHTML = `
            <button type="button" class="photo-drop" id="photo-drop">
                <i class="fa-solid fa-cloud-arrow-up" aria-hidden="true"></i>
                <span>Choose photo</span>
                <span class="photo-drop-hint">jpg, png, webp · one section per photo</span>
            </button>`;
        $('photo-drop')?.addEventListener('click', () => $('sched-photo')?.click());
        return;
    }

    if (state === 'staged' || state === 'reading') {
        const file    = meta.file ?? PHOTO_FILE;
        const pct     = meta.pct ?? 0;
        const reading = state === 'reading';

        stage.innerHTML = `
            <div class="photo-card">
                <div class="photo-thumb">
                    ${meta.preview
                        ? `<img src="${meta.preview}" alt="">`
                        : '<i class="fa-solid fa-image" aria-hidden="true"></i>'}
                </div>
                <div class="photo-meta">
                    <p class="photo-name">${escapeHtml(file?.name ?? 'Photo')}</p>
                    <p class="photo-size">${formatSize(file?.size ?? 0)}</p>
                </div>
                ${reading ? '' : `
                    <button type="button" class="btn-icon" id="photo-clear"
                            aria-label="Remove photo">
                        <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                    </button>`}
                ${reading ? `
                    <div class="photo-progress">
                        <span class="photo-pct">${pct}%</span>
                        <div class="photo-track">
                            <div class="photo-fill" style="width:${pct}%"></div>
                        </div>
                    </div>` : ''}
            </div>
            ${reading ? '' : `
                <div class="photo-actions">
                    <button type="button" class="btn-accent" id="photo-read">
                        <i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i>
                        <span>Read form</span>
                    </button>
                </div>`}`;

        if (!reading) {
            $('photo-clear')?.addEventListener('click', () => {
                PHOTO_FILE = null;
                const inp = $('sched-photo');
                if (inp) inp.value = '';
                renderPhotoStage('idle');
            });
            $('photo-read')?.addEventListener('click', () => runPhotoRead());
        }
    }
}

$('sched-photo')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const photoIssue = CurriculogicUploadLimits.fileProblem(file, 'photo');
    if (photoIssue) {
        e.target.value = '';
        return showMsg('sched-msg', photoIssue);
    }

    PHOTO_FILE = file;

    // Small thumbnail for the file card. The real payload is downscaled
    // again at 2000px inside readSchedulePhoto(); this is only what the
    // operator sees.
    let preview = null;
    try {
        preview = await downscaleImage(file, 200, 0.7);
    } catch {
        /* unreadable file still gets a card, just no thumbnail */
    }
    renderPhotoStage('staged', { file, preview });
});

async function runPhotoRead() {
    if (!PHOTO_FILE || PHOTO_READING) return;

    // A photo can set the section itself — don't require one upfront.
    const section = currentSection();

    PHOTO_READING = true;
    showMsg('sched-msg', '');

    let pct = 3;
    const tick = setInterval(() => {
        pct += Math.max(1, Math.round((90 - pct) * 0.08));
        if (pct > 90) pct = 90;
        const el  = document.querySelector('.photo-pct');
        const bar = document.querySelector('.photo-fill');
        if (el)  el.textContent = `${pct}%`;
        if (bar) bar.style.width = `${pct}%`;
    }, 350);

    renderPhotoStage('reading', { file: PHOTO_FILE, pct });

    try {
        const { rows, warnings, detected } = await readSchedulePhoto(PHOTO_FILE, section);

        clearInterval(tick);
        const el  = document.querySelector('.photo-pct');
        const bar = document.querySelector('.photo-fill');
        if (el)  el.textContent = '100%';
        if (bar) bar.style.width = '100%';

        await previewUpload(rows, warnings, detected);

        PHOTO_FILE = null;
        const inp = $('sched-photo');
        if (inp) inp.value = '';
        renderPhotoStage('idle');
    } catch (err) {
        clearInterval(tick);
        console.error('schedule photo failed:', err);
        const box = $('upload-preview');
        if (box) {
            box.innerHTML = `
                <div class="notice pending">
                    <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
                    <div>
                        <strong>Could not read that photo</strong>
                        ${escapeHtml(err.message || 'Unknown error.')}
                        You can still use the template upload.
                    </div>
                </div>`;
        }
        renderPhotoStage('staged', { file: PHOTO_FILE });
    } finally {
        PHOTO_READING = false;
    }
}

// First paint.
renderPhotoStage('idle');

/* Excel and CSV go through the same path so the operator can fill the
   template in whichever they have. Cells are read as text: a start time
   of 08:00 must not come back as a fraction of a day, and a section of
   1A must not be coerced to a number. */
async function readScheduleFile(file) {
    const fileIssue = CurriculogicUploadLimits.fileProblem(file, 'schedule');
    if (fileIssue) throw new Error(fileIssue);

    if (typeof XLSX === 'undefined') {
        throw new Error('The spreadsheet library did not load. Check your connection.');
    }

    const buf = await file.arrayBuffer();
    const wb  = XLSX.read(buf, { type: 'array', raw: false, cellDates: false });
    const ws  = wb.Sheets[wb.SheetNames[0]];
    if (!ws) throw new Error('The file has no readable sheet.');

    // Read as arrays so the header row can be located rather than
    // assumed. The template has a merged guide row above the header;
    // an operator may also leave blank rows or notes at the top. Find
    // the first row that contains 'edp_code' in any cell and treat
    // that as the header.
    const aoa = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false, header: 1 });
    // Minus the header row, so the number named is the number of schedule rows.
    const rowsIssue = CurriculogicUploadLimits.rowsProblem(
        Math.max(0, CurriculogicUploadLimits.dataRows(aoa) - 1), 'schedule');
    if (rowsIssue) throw new Error(rowsIssue);
    if (aoa.length === 0) throw new Error('The sheet is empty.');

    const normalize = (v) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, '_');

    let headerIdx = -1;
    for (let i = 0; i < aoa.length; i++) {
        const row = aoa[i].map(normalize);
        if (row.includes('edp_code')) { headerIdx = i; break; }
    }

    if (headerIdx === -1) {
        throw new Error(
            "Could not find a header row containing 'edp_code'. " +
            'Expected headers: edp_code, subject, type, section, ' +
            'start_time, end_time, days, room, instructor.'
        );
    }

    const headers = aoa[headerIdx].map(normalize);

    const required = ['edp_code', 'subject', 'type', 'section'];
    const missing  = required.filter(r => !headers.includes(r));
    if (missing.length) {
        throw new Error(
            `Missing column${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}. ` +
            'Expected headers: edp_code, subject, type, section, ' +
            'start_time, end_time, days, room, instructor.'
        );
    }

    // Excel hands back times in whatever form the operator typed —
    // "9:00", "9:00 AM", "9:00:00". The browser's <input type="time">
    // only accepts zero-padded 24-hour HH:MM and silently blanks
    // anything else, so a "9:00" cell renders as empty in the editable
    // table even though it parsed fine. Normalize here.
    const normalizeTime = (v) => {
        const s = String(v ?? '').trim();
        if (!s) return '';
        const m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i);
        if (!m) return s;
        let h = Number(m[1]);
        const min = m[2];
        const ampm = (m[3] || '').toUpperCase();
        if (ampm === 'PM' && h !== 12) h += 12;
        if (ampm === 'AM' && h === 12) h = 0;
        return String(h).padStart(2, '0') + ':' + min;
    };

    const data = aoa
        .slice(headerIdx + 1)
        .filter(row => row.some(c => String(c ?? '').trim() !== ''))
        .map((row, i) => {
            const out = { __line: headerIdx + i + 2 };
            headers.forEach((h, j) => {
                out[h] = String(row[j] ?? '').trim();
            });
            if (out.start_time !== undefined) out.start_time = normalizeTime(out.start_time);
            if (out.end_time   !== undefined) out.end_time   = normalizeTime(out.end_time);
            return out;
        });

    // Backward compat: guide rows written with a leading '#' in the EDP
    // column are still dropped, so the older template format keeps
    // working.
    const filtered = data.filter(r => !String(r.edp_code || '').startsWith('#'));

    if (filtered.length === 0) {
        throw new Error('The file has a header but no data rows.');
    }

    return filtered;
}

/* Downscale the photo to a max long edge of 2000px before upload. A
   modern phone photo is 4–12 MB; a 2000px JPEG at q=0.85 is roughly
   400 KB — enough for the model to read, small enough to move on a
   slow link. */
function downscaleImage(file, maxEdge, quality) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();

        img.onload = () => {
            URL.revokeObjectURL(url);
            const { width, height } = img;
            const scale = Math.min(1, maxEdge / Math.max(width, height));
            const w = Math.round(width * scale);
            const h = Math.round(height * scale);

            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);

            resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('That file is not a readable image.'));
        };
        img.src = url;
    });
}

/* Sends the photo to the Edge Function and returns rows in the same
   shape the CSV path produces — plus any warnings Gemini emitted, and
   the section it read from the form's header, for cross-checking
   against what the operator has selected. */
async function readSchedulePhoto(file, section) {
    const dataUrl = await downscaleImage(file, 2000, 0.85);

    const { year, term } = schedTerm();
    const subjects = SUBJECTS
        .filter(s => s.is_active !== false)
        .map(s => s.code);

    const { data: { session } } = await supabase.auth.getSession();

    const res = await fetch(`${SUPABASE_URL}/functions/v1/analyze-schedule-document`, {
        method: 'POST',
        headers: {
            'Content-Type':  'application/json',
            'apikey':        SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${session?.access_token ?? SUPABASE_ANON_KEY}`,
        },
            body: JSON.stringify({
            image: dataUrl,
            section: section ?? null,
            subjects,
            term: term ?? null,
            year: year ?? null,
        }),
    });

    if (!res.ok) {
        throw new Error(CurriculogicUploadLimits.aiProblem(res.status) || `The scanner returned ${res.status}.`);
    }
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'The scanner could not read that photo.');

    // The photo has no section column — the form's header names the
    // section, and the operator has already chosen it on the page. Tag
    // every row with it so previewUpload() sees the same shape the CSV
    // path produces.
    const rows = (data.rows ?? []).map((r, i) => ({
        ...r,
        section,
        __line: i + 1,
    }));

    return {
        rows,
        warnings: data.warnings ?? [],
        detected: {
            section: data.detected_section ?? null,
            course:  data.detected_course  ?? null,
            year:    data.detected_year    ?? null,
            term:    data.detected_term    ?? null,
        },
    };
}

const norm = (c) => (c || '').replace(/\s/g, '').toUpperCase();

let PENDING_ROWS = [];


const GRADE_REJECT_META = {
    unknown_student:  { label: 'Student ID not registered',        mode: 'chips' },
    unknown_subject:  { label: 'Subject not in the prospectus',    mode: 'chips',
                        hint: 'Add it under Curriculum, or correct the code and re-upload.' },
    bad_grade:        { label: 'Grade out of range (1.0–5.0)',     mode: 'lines' },
    invalid_status:   { label: 'Invalid status value',             mode: 'lines' },
    bad_term:         { label: 'Invalid term',                     mode: 'lines' },
    bad_year:         { label: 'Invalid academic year',            mode: 'lines' },
    missing_fields:   { label: 'Missing required fields',          mode: 'lines' },
};

async function previewUpload(rows, warnings = [], detected = null) {
    const box = $('upload-preview');
    if (!box) return;

    const expectedSection = currentSection();
    const byCode = new Map(SUBJECTS.map(s => [norm(s.code), s]));

    const reject = (msg) => {
        PENDING_ROWS = [];
        box.innerHTML = `
            <div class="notice pending">
                <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
                <div><strong>Upload rejected</strong>${escapeHtml(msg)}</div>
            </div>`;
    };

    // ── Whole-file checks ────────────────────────────────────────
    // A file carries one section's rows, and that section must match
    // what the operator has selected at the top of the page. Two files
    // for two sections means two uploads, not one mixed file.

    const sectionsInFile = new Set(
        rows.map(r => String(r.section || '').trim().toUpperCase()).filter(Boolean)
    );

    if (sectionsInFile.size === 0) {
        return reject('Every row is missing a section. The section column must name the section each row belongs to.');
    }
    if (sectionsInFile.size > 1) {
        const list = [...sectionsInFile].join(', ');
        return reject(`This file contains rows for ${sectionsInFile.size} sections (${list}). Upload one section at a time.`);
    }

    let fileSection = [...sectionsInFile][0];

    // When nothing is selected, the row's section is unknown — the photo
    // path tags rows with null. Take the detected section if the caller
    // passed one, otherwise refuse (the CSV path always names one).
    if (!fileSection && detected?.section) {
        fileSection = detected.section;
    }
    if (!fileSection) {
        return reject('No section could be determined from the upload. Choose one above, or check the file.');
    }
    if (expectedSection && fileSection !== expectedSection) {
        return reject(`This file is for ${fileSection}, but ${expectedSection} is selected at the top of the page. Switch the section, or upload the correct file.`);
    }

    // ── Existing EDP codes in this term ─────────────────────────
    // A duplicate inside the file would fail the whole insert with a
    // raw Postgres error. Catching it here names the offending row.
    const existingEdps = await fetchExistingEdps();

    // ── Per-row validation ──────────────────────────────────────
    const ok = [], bad = [], skipped = [];
    const seenEdps = new Set();
    const year     = sectionYear(fileSection);
    const term     = schedTerm().term;

    for (const r of rows) {
        const edp  = String(r.edp_code || '').trim();
        const code = norm(r.subject || '');
        const type = String(r.type || '').trim().toUpperCase();

        if (!edp) {
            bad.push({ kind: 'missing_edp', line: r.__line, detail: 'no EDP code' });
            continue;
        }
        if (seenEdps.has(edp)) {
            bad.push({ kind: 'duplicate_in_file', line: r.__line, detail: edp });
            continue;
        }
        if (existingEdps.has(edp)) {
            bad.push({ kind: 'edp_taken', line: r.__line, detail: edp });
            continue;
        }

        const subject = byCode.get(code);
        if (!subject) {
            bad.push({ kind: 'unknown_subject', line: r.__line, detail: r.subject || code });
            continue;
        }

        if (type !== 'LEC' && type !== 'LAB') {
            bad.push({ kind: 'bad_type', line: r.__line, detail: r.type });
            continue;
        }

        const hasLab = Number(subject.lab_units) > 0;
        if (type === 'LAB' && !hasLab) {
            bad.push({ kind: 'lab_without_lab_units', line: r.__line, detail: subject.code });
            continue;
        }

        // Year and term must match the section. Electives exempt.
        if (subject.year_level !== null) {
            const sectionLevel = sectionYear(fileSection);
            const sectionTerm  = schedTerm().term;

            if (subject.year_level !== sectionLevel) {
                bad.push({ kind: 'wrong_year', line: r.__line,
                    detail: `${subject.code} is Year ${subject.year_level}, section is Year ${sectionLevel}` });
                continue;
            }
            if (subject.term !== sectionTerm) {
                bad.push({ kind: 'wrong_term', line: r.__line,
                    detail: `${subject.code} is ${termLabel(subject.term)}, section is ${termLabel(sectionTerm)}` });
                continue;
            }
        }

        // A wholly empty row means the subject is not running — skip.
        if (!r.days && !r.start_time && !r.room) {
            skipped.push({ line: r.__line, subject: subject.code, type });
            continue;
        }

        const missing = [];
        if (!r.days)       missing.push('days');
        if (!r.start_time) missing.push('start time');
        if (!r.end_time)   missing.push('end time');
        if (!r.room)       missing.push('room');
        if (missing.length) {
            bad.push({ kind: 'missing_fields', line: r.__line, detail: missing.join(', ') });
            continue;
        }

        const timeProblem = scheduleTimeProblem(r.start_time, r.end_time);
        if (timeProblem) {
            bad.push({ kind: 'bad_time', line: r.__line, detail: `${subject.code}: ${timeProblem}` });
            continue;
        }

        seenEdps.add(edp);
        ok.push({ subject, row: { ...r, section: fileSection, type } });
    }

    PENDING_ROWS = ok;

    // ── Render ──────────────────────────────────────────────────
    const totalUnits = ok.reduce((sum, { subject, row }) => {
        return row.type === 'LAB' ? sum : sum + Number(subject.units || 0);
    }, 0);

    box.innerHTML = `
        <div class="upload-stats">
            <div class="upload-stat">
                <p class="k">Rows</p>
                <p class="v">${rows.length}</p>
                <p class="u">parsed from the source</p>
            </div>
            <div class="upload-stat${ok.length ? ' is-ready' : ''}">
                <p class="k">Ready</p>
                <p class="v">${ok.length}</p>
                <p class="u">ready to add</p>
            </div>
            <div class="upload-stat${bad.length ? ' is-issues' : ''}">
                <p class="k">Issues</p>
                <p class="v">${bad.length}</p>
                <p class="u">${bad.length ? 'need to be fixed' : 'none found'}</p>
            </div>
            <div class="upload-stat">
                <p class="k">Units</p>
                <p class="v">${totalUnits}</p>
                <p class="u">lecture only</p>
            </div>
        </div>

                ${warnings.length ? `
            <div class="notice pending">
                <i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i>
                <div>
                    <strong>${warnings.length} note${warnings.length === 1 ? '' : 's'} from the scan</strong>
                    ${warnings.map(w => escapeHtml(w)).join('<br>')}
                </div>
            </div>` : ''}

    ${(detected && detected.section) && (
    !expectedSection ||
    (expectedSection && detected.section !== expectedSection)
    ) ? (() => {
    const { year: curYear, term: curTerm } = schedTerm();
    const haveCurrent = expectedSection && curYear && curTerm;
    const detLabel = detected.year && detected.term
        ? `${detected.section} · ${termLabel(detected.term)} · ${detected.year}\u2013${String(detected.year + 1).slice(-2)}`
        : detected.section;

    const canSwitch = Number.isFinite(detected.year)
        && Number.isFinite(detected.term)
        && String(detected.section).split('-')[0].toUpperCase() === PROGRAM_CODE
        && [...($('sched-year')?.options ?? [])].some(o => o.value === String(detected.year));

    // Blank-state path: nothing was selected before the scan. Offer
    // to fill the four dropdowns from the photo, then apply.
    if (!haveCurrent && canSwitch) {
        return `
        <div class="notice info">
            <i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i>
            <div>
                <strong>The photo shows ${escapeHtml(detLabel)}</strong>
                Nothing is selected above. Use the photo's section, or pick
                one manually.
                <div style="display:flex; gap:8px; margin-top:10px; flex-wrap:wrap;">
                    <button class="btn-small" data-use-detected>
                        <i class="fa-solid fa-check" aria-hidden="true"></i>
                        Use ${escapeHtml(detected.section)}
                    </button>
                </div>
            </div>
        </div>`;
    }

    // Photo's term isn't available in the dropdowns — can't switch.
    if (!canSwitch) {
        return `
        <div class="notice pending">
            <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
            <div>
                <strong>The photo shows ${escapeHtml(detLabel)}</strong>
                That term is not in your prospectus versions — add the
                rows under a term you have, or add the version on the
                Prospectus tab first.
            </div>
        </div>`;
    }

    // Mismatch: something was selected and the photo disagrees.
    const curLabel = `${expectedSection} · ${termLabel(curTerm)} · ${curYear}\u2013${String(curYear + 1).slice(-2)}`;
    return `
    <div class="notice pending">
        <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
        <div>
            <strong>The photo shows ${escapeHtml(detLabel)}</strong>
            You have <strong>${escapeHtml(curLabel)}</strong> selected.
            Switch to match the photo, or add the rows here.
            <div style="display:flex; gap:8px; margin-top:10px; flex-wrap:wrap;">
                <button class="btn-small" data-switch-apply>
                    <i class="fa-solid fa-right-left" aria-hidden="true"></i>
                    Switch to ${escapeHtml(detected.section)} and add rows
                </button>
                <button class="btn-small" data-stay-apply>
                    Add under ${escapeHtml(expectedSection)}
                </button>
            </div>
        </div>
    </div>`;
    })() : ''}

        ${bad.length ? (() => {
            // Group rejections by reason so eleven identical EDP
            // conflicts read as one problem, not eleven lines of
            // noise with the one genuinely-different error buried at
            // the bottom.
            const META = {
                missing_edp:          { label: 'Missing an EDP code',        mode: 'lines' },
                duplicate_in_file:    { label: 'EDP code appears twice in this file', mode: 'chips' },
                edp_taken:            { label: 'EDP code already in use this term',  mode: 'chips',
                                        hint: 'If you just saved this section and are re-uploading to fix a typo, edit the rows in the table below instead.' },
                unknown_subject:      { label: 'Subject not in the prospectus', mode: 'chips' },
                bad_type:             { label: 'Invalid meeting type',       mode: 'lines' },
                lab_without_lab_units:{ label: 'Subject has no lab units',   mode: 'chips' },
                wrong_year:           { label: 'Wrong year level for this section', mode: 'lines' },
                wrong_term:           { label: 'Scheduled for the wrong term',      mode: 'lines' },
                missing_fields:       { label: 'Missing required fields',    mode: 'lines' },
                bad_time:             { label: 'Implausible class time',     mode: 'lines',
                                        hint: 'Classes run between 6:00 AM and 10:00 PM. A time typed as "1:00" with no AM/PM is read as 1 AM; write 1:00 PM or 13:00.' },
            };

            const groups = new Map();
            for (const b of bad) {
                const key = b.kind || 'other';
                if (!groups.has(key)) {
                    groups.set(key, {
                        key,
                        label: META[key]?.label ?? 'Other',
                        mode:  META[key]?.mode  ?? 'lines',
                        hint:  META[key]?.hint  ?? '',
                        items: [],
                    });
                }
                groups.get(key).items.push(b);
            }

            const ordered = [...groups.values()]
                .sort((a, b) => b.items.length - a.items.length);

            return `
            <div class="notice pending">
                <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
                <div>
                    <strong>${bad.length} row${bad.length === 1 ? '' : 's'} need${bad.length === 1 ? 's' : ''} attention</strong>
                    <div class="reject-groups">
                        ${ordered.map(g => `
                            <div class="reject-group">
                                <p class="reject-head">
                                    <span class="reject-count">${g.items.length}</span>
                                    ${escapeHtml(g.label)}
                                </p>
                                ${g.mode === 'chips'
                                    ? `<p class="reject-chips">${
                                        [...new Set(g.items.map(i => i.detail))]
                                            .map(d => `<code>${escapeHtml(d)}</code>`)
                                            .join(' ')
                                    }</p>`
                                    : `<ul class="reject-lines">${
                                        g.items.map(i => `<li>Line ${i.line}: ${escapeHtml(i.detail)}</li>`).join('')
                                    }</ul>`}
                                ${g.hint ? `<p class="reject-hint">${escapeHtml(g.hint)}</p>` : ''}
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>`;
        })() : ''}

        ${skipped.length ? `
            <div class="notice info">
                <i class="fa-solid fa-circle-minus" aria-hidden="true"></i>
                <div>
                    <strong>${skipped.length} row${skipped.length === 1 ? '' : 's'} left blank, not offered</strong>
                    Rows with no days, time, or room are treated as subjects not running this term.
                </div>
            </div>` : ''}

        ${ok.length ? `
            <div class="table-wrap">
                <table class="data-table">
                    <thead><tr>
                        <th>EDP</th><th>Subject</th><th>Type</th>
                        <th>Days</th><th>Time</th><th>Room</th>
                    </tr></thead>
                    <tbody>${ok.slice(0, 12).map(({ subject, row }) => `
                        <tr>
                            <td class="mono">${escapeHtml(row.edp_code)}</td>
                            <td class="mono">${escapeHtml(subject.code)}</td>
                            <td>${row.type === 'LAB'
                                ? '<span class="pill lab">LAB</span>'
                                : '<span class="pill lec">LEC</span>'}</td>
                            <td>${escapeHtml(row.days)}</td>
                            <td class="dim">${timeRange(row.start_time, row.end_time)}</td>
                            <td class="dim">${escapeHtml(row.room)}</td>
                        </tr>`).join('')}
                    </tbody>
                </table>
                ${ok.length > 12 ? `<p class="dim">and ${ok.length - 12} more</p>` : ''}
            </div>
            <div class="preview-actions">
                <button class="btn-accent" id="apply-upload">
                    <i class="fa-solid fa-arrow-down" aria-hidden="true"></i>
                    <span>Add ${ok.length} row${ok.length === 1 ? '' : 's'} to the schedule</span>
                </button>
                <button class="btn-secondary" id="discard-upload">
                    Discard upload
                </button>
            </div>` : ''}`;

    $('apply-upload')?.addEventListener('click', applyUploadToPending);
    $('discard-upload')?.addEventListener('click', discardPreview);

    // The mismatch banner (when present) offers a second path: flip the
    // dropdowns to match the photo, then apply. $() only looks up by id
    // -- these are attribute selectors, so they need querySelector.
    document.querySelector('[data-use-detected]')?.addEventListener('click', () => fillFromDetected(detected, rows, warnings));
    document.querySelector('[data-switch-apply]')?.addEventListener('click', () => switchAndApply(detected, rows, warnings));
    document.querySelector('[data-stay-apply]')?.addEventListener('click', applyUploadToPending);
}

/* EDP codes already used by another offering in this term. Fetched
   fresh at preview time so a re-upload after edits catches the case
   where a code was taken between the first preview and the second. */
async function fetchExistingEdps() {
    if (PREVIEW) return new Set();
    const { year, term } = schedTerm();
    if (!year || !term) return new Set();
    const { data, error } = await supabase
        .from('subject_offering')
        .select('edp_code')
        .eq('academic_year', year)
        .eq('term', term);
    if (error) {
        console.warn('could not read existing EDP codes:', error.message);
        return new Set();
    }
    return new Set((data ?? []).map(r => String(r.edp_code || '').trim()).filter(Boolean));
}

/* Merge the previewed rows into PENDING for the current section. This is
   where the scanned or uploaded rows become editable: they land in the
   same table the operator builds by hand, so a misread from the scan is
   one keystroke to fix rather than a re-upload.

   Slot matching uses (subject_id, meeting_type) — the same natural key
   the DB enforces — so re-applying a corrected source updates existing
   rows rather than duplicating them.

   EDP uniqueness is checked twice: once against every other row already
   in PENDING for this section (excluding slots we are about to replace),
   and once inside the batch itself. The DB has the same constraint, but
   catching it here lets the operator see the offending row in the table
   rather than as a Save-time error. */
function applyUploadToPending() {
    const section = currentSection();
    if (!section) return showMsg('sched-msg', 'Choose a section first.');
    if (PENDING_ROWS.length === 0) return;

    const { year, term } = schedTerm();

    const slotsToReplace = new Set(
        PENDING_ROWS.map(({ subject, row }) => `${subject.id}|${row.type}`)
    );

    const claimedEdps = new Set();
    for (const p of PENDING) {
        if (p.section !== section) continue;
        if (slotsToReplace.has(`${p.subject_id}|${p.meeting_type}`)) continue;
        if (p.edp_code) claimedEdps.add(String(p.edp_code).trim());
    }

    let added = 0, replaced = 0;
    const rejected = [];

    for (const { subject, row } of PENDING_ROWS) {
        const edp = String(row.edp_code || '').trim();

        if (claimedEdps.has(edp)) {
            rejected.push(`${subject.code} ${row.type}: EDP ${edp} already used by another row.`);
            continue;
        }

        const existing = PENDING.find(p =>
            p.section === section &&
            p.subject_id === subject.id &&
            p.meeting_type === row.type
        );

        const next = {
            __key:         existing?.__key ?? nextKey(),
            id:            existing?.id ?? null,
            edp_code:      edp,
            subject_id:    subject.id,
            meeting_type:  row.type,
            section,
            academic_year: year,
            term,
            schedule_days: row.days || '',
            start_time:    row.start_time || '',
            end_time:      row.end_time || '',
            room:          row.room || '',
            instructor:    row.instructor || '',
        };

        if (existing) {
            Object.assign(existing, next);
            replaced++;
        } else {
            PENDING.push(next);
            added++;
        }
        claimedEdps.add(edp);
    }

    if (added + replaced > 0) DIRTY.add(section);

    // Clear the preview — the rows now live in the table below.
    PENDING_ROWS = [];
    const box = $('upload-preview');
    if (box) box.innerHTML = '';
    const file = $('sched-file');  if (file)  file.value = '';
    const photo = $('sched-photo'); if (photo) photo.value = '';

    renderOfferings();

    const parts = [];
    if (added)    parts.push(`${added} added`);
    if (replaced) parts.push(`${replaced} updated`);
    const summary = parts.join(', ') || 'No rows applied';
    const tail = rejected.length
        ? ` ${rejected.length} row${rejected.length === 1 ? '' : 's'} skipped: ${rejected[0]}`
        : '';
    showMsg('sched-msg',
        `${summary} to ${section}. Review the table, then Save ${section}.${tail}`,
        rejected.length ? 'error' : 'success');
}

/* Throws away a preview without applying it. Used when the scan came
   back wrong, or the operator changed their mind — the rows never
   touched PENDING, so nothing in the schedule table needs touching.
   Clears both upload inputs so a re-pick starts clean. */
function discardPreview() {
    PENDING_ROWS = [];

    const box = $('upload-preview');
    if (box) box.innerHTML = '';

    const file  = $('sched-file');  if (file)  file.value = '';
    const photo = $('sched-photo'); if (photo) photo.value = '';

    PHOTO_FILE = null;
    renderPhotoStage('idle');

    showMsg('sched-msg', '');
}

/* Flips the four dropdowns to whatever the photo's header says, waits
   for the reload, then re-validates and applies the rows into that
   section's PENDING. Only reachable from the mismatch banner, where
   the operator has already seen both labels and chosen to switch.

   rows arrived tagged with whatever section was selected BEFORE the
   switch (previewUpload's caller stamps every photo-scanned row with
   the page's section, since the photo itself has no section column --
   see the "photo has no section column" comment near the fetch). That
   tag doesn't update itself just because the dropdowns did, so PENDING_
   ROWS from the first previewUpload() call is validated against the
   OLD section and must not be reused: retag rows with the detected
   section and run previewUpload() again once the switch has landed,
   so "wrong year for this section" etc. gets judged against the
   section the operator actually switched to. */
async function switchAndApply(detected, rows, warnings) {
    if (!detected?.section || !detected.year || !detected.term) return;

    const m = String(detected.section).match(/^([A-Z]+)-(\d+)([A-Z]+)$/i);
    if (!m) return showMsg('sched-msg', 'The photo section is not in the expected shape.');

    const [, , levelStr, letter] = m;

    // Program prefix is set from the active prospectus — if the photo
    // disagrees, warn rather than fight it. Not a blocker.
    const detectedPrefix = m[1].toUpperCase();
    if (detectedPrefix !== PROGRAM_CODE) {
        showMsg('sched-msg',
            `The photo is for ${detectedPrefix}, but this dashboard is scoped to ${PROGRAM_CODE}.`);
        return;
    }

    // reloadScheduleView() below rebuilds PENDING from OFFERINGS and
    // clears DIRTY. Any unsaved edits — on the current section or on
    // any other section the operator has touched — would vanish. Warn
    // before that happens.
    if (DIRTY.size > 0) {
        const n = DIRTY.size;
        const ok = window.confirm(
            `Switching reloads the schedule from the database.\n\n` +
            `Unsaved changes on ${n === 1 ? 'one section' : `${n} sections`} ` +
            `will be discarded. Continue?`
        );
        if (!ok) return;
    }

    // All four dropdowns get set before any reload happens.
    const setSel = (id, value) => {
        const el = $(id);
        if (!el) return false;
        const ok = [...el.options].some(o => o.value === String(value));
        if (ok) el.value = String(value);
        return ok;
    };

    setSel('sched-year', detected.year);
    setSel('sched-term', detected.term);
    setSel('sched-year-level', Number(levelStr));

    // reloadScheduleView() re-fetches offerings for the new year/term
    // and rebuilds the section dropdowns. Must be awaited — PENDING is
    // reset by loadOfferings(), and applying before it resolves would
    // write the rows into the wrong (stale) section.
    await reloadScheduleView();

    // renderTopSectionOptions() preserves the year-level if it survived
    // the reload; the letter dropdown is rebuilt from the new OFFERINGS.
    setSel('sched-section-letter', letter);

    for (const r of rows) r.section = detected.section;
    await previewUpload(rows, warnings, detected);
    applyUploadToPending();
}

/* Populates all four dropdowns from the scan's header, then re-validates
   and applies the rows. Used when nothing was selected before the scan
   — the photo becomes the source of truth.

   Order: set four dropdowns → reload offerings → set letter → retag
   rows with the now-current section → re-run previewUpload() → apply.
   Same shape as switchAndApply (see its comment for why the retag and
   re-validate are necessary), but there are no unsaved edits to lose
   when nothing was selected, so no confirm. */
async function fillFromDetected(detected, rows, warnings) {
    if (!detected?.section || !detected.year || !detected.term) {
        return showMsg('sched-msg', 'The scan did not report a full section.');
    }

    const m = String(detected.section).match(/^([A-Z]+)-(\d+)([A-Z]+)$/i);
    if (!m) return showMsg('sched-msg', 'The photo section is not in the expected shape.');
    const [, prefix, levelStr, letter] = m;

    if (prefix.toUpperCase() !== PROGRAM_CODE) {
        return showMsg('sched-msg',
            `The photo is for ${prefix}, but this dashboard is scoped to ${PROGRAM_CODE}.`);
    }

    const setSel = (id, value) => {
        const el = $(id);
        if (!el) return false;
        const ok = [...el.options].some(o => o.value === String(value));
        if (ok) el.value = String(value);
        return ok;
    };

    setSel('sched-year', detected.year);
    setSel('sched-term', detected.term);
    setSel('sched-year-level', Number(levelStr));

    await reloadScheduleView();

    setSel('sched-section-letter', letter);

    for (const r of rows) r.section = detected.section;
    await previewUpload(rows, warnings, detected);
    applyUploadToPending();
}

/* ============================================================
   GRADE UPLOAD – Part A: File Reading + Validation
   ============================================================ */

let gradeState = {
    ready: false,
    rows: [],
    studentMap: null,
    subjectMap: null,
    subjectChoices: null,   // the programme's subjects, for the picker
    lastFile: null,         // the chosen file; kept until it is removed or saved
    busy: false,            // a check or a save is running
};

/* ---- the status bar ----
   state: 'working' | 'done' | 'wait' | 'error' | null (hide). The percentage is
   measured, not estimated: see shared/js/uploadprogress.js. */
function gradeStatus(state, text, percent = null) {
    const box = $('grade-status');
    if (!box) return;
    if (!state) { box.hidden = true; return; }
    box.hidden = false;
    box.className = 'gu-status' + (state === 'working' ? '' : ' is-' + state);
    setText('grade-status-text', text);
    const pct = percent == null ? null : Math.max(0, Math.min(100, Math.round(percent)));
    setText('grade-status-pct', pct == null ? '' : pct + '%');
    const fill = $('grade-status-fill');
    if (fill) fill.style.width = (pct ?? 0) + '%';
}
const gradeProgress = (u) => gradeStatus('working', u.detail ? `${u.label}: ${u.detail}` : u.label, u.percent);
const yieldToUi = () => new Promise(r => setTimeout(r, 0));
const chunksOf = (list, n) => { const out = []; for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n)); return out; };

function termChosen() {
    const [y, t] = String($('g-period')?.value || '').split('-').map(Number);
    return Number.isInteger(y) && y >= 2000 && y <= 2100 && [1, 2, 3].includes(t);
}
const previewShowing = () => $('grade-preview-card') && !$('grade-preview-card').hidden;

/* The chosen file, and the button that checks it. The button waits for a term:
   without one, nothing could be checked, and the reason is said where the eye is. */
function renderGradeFileCard() {
    const file = gradeState.lastFile;
    const card = $('grade-file-card'), btn = $('grade-check'), term = $('g-period');
    if (card) card.hidden = !file;
    if (btn) btn.hidden = !file;
    if (!file) { term?.classList.remove('is-attn'); return; }

    setText('grade-file-name', file.name);
    setText('grade-file-size', file.size < 1048576 ? (file.size / 1024).toFixed(1) + ' KB' : (file.size / 1048576).toFixed(1) + ' MB');

    const ready = termChosen();
    if (btn) btn.disabled = !ready || gradeState.busy;
    term?.classList.toggle('is-attn', !ready);
    if (!ready && !gradeState.busy) {
        gradeStatus('wait', 'Choose a term above first. Your file is kept; press Check file once a term is chosen.', 0);
    } else if (ready && !gradeState.busy && !previewShowing()) {
        gradeStatus(null);
    }
}

/* Term options — only years that have a prospectus version in the
   database. A term with no curriculum behind it can't validate a
   grade file: no subject in the file would ever match. Offering such
   terms would let the operator pick something that fails on every
   row and produce a wall of "not in prospectus" rejections.

   When a new prospectus version is created, the term appears here on
   the next page load — no code change needed. */
function renderPeriodOptions() {
    const sel = $('g-period');
    if (!sel) return;

    const years = [...new Set(VERSIONS.map(v => v.academic_year))]
        .filter(y => Number.isInteger(y))
        .sort((a, b) => b - a);

    if (!years.length) {
        sel.innerHTML = '<option value="">No prospectus versions</option>';
        return;
    }

    const termNames = { 1: '1st Sem', 2: '2nd Sem', 3: 'Summer' };
    const options = ['<option value="">Select term</option>'];
    for (const y of years) {
        const range = `${y}\u2013${String(y + 1).slice(-2)}`;
        for (const t of [1, 2, 3]) {
            options.push(`<option value="${y}-${t}">${termNames[t]} ${range}</option>`);
        }
    }
    sel.innerHTML = options.join('');
}

function initGrades() {
    if (!gradeState.ready) {
        // Populate once per page load. No pre-selection — the operator
        // must choose a term deliberately, same reason a blank year
        // field is better than a wrong default.
        renderPeriodOptions();
        renderSubjectOptions();
        gradeState.ready = true;
    }
    loadGradeHistory();
}

function padStudentId(v) {
    const raw = String(v ?? '').trim().replace(/[\s-]/g, '');
    if (!raw) return '';
    if (/^\d+$/.test(raw) && raw.length < 7) return raw.padStart(7, '0');
    return raw.toUpperCase();
}

/* Spaces, case and dash variants ignored — see shared/js/gradefile.js. */
function normCode(v) {
    return window.GradeFile.normCode(v);
}

async function loadStudentMap() {
    if (gradeState.studentMap) return gradeState.studentMap;
    if (PREVIEW) {
        gradeState.studentMap = new Map([
            ['2401187', { id: 'stu1', student_id: '2401187', first_name: 'Althea', last_name: 'Villanueva' }],
            ['2401188', { id: 'stu2', student_id: '2401188', first_name: 'Marco', last_name: 'Deveza' }],
        ]);
        return gradeState.studentMap;
    }
    const { data } = await supabase
        .from('university_student')
        .select('id, student_id, first_name, last_name, prospectus_id, program_id')
        .not('student_id', 'is', null);
    gradeState.studentMap = new Map((data ?? []).map(s => [padStudentId(s.student_id), s]));
    return gradeState.studentMap;
}

/* A grade row has to resolve to a subject in the curriculum the STUDENT is
   on, not the version Department Staff happens to be viewing: the student
   engine matches academic_record.subject_id against their own prospectus,
   so a record pointing at a subject in another version never counts toward
   a prerequisite. A student with no prospectus_id is assessed against the
   active version FOR THEIR PROGRAMME (see effectiveProspectusId in the
   student dashboard), so the same fallback is used here, through the
   shared CurriculogicPrograms.fallbackProspectus rule.

   Returns { actives, byProspectus: Map<prospectusId, Map<code, subject>> }.
   `actives` is every active prospectus as { id, program_id }: with more
   than one programme there is one each, so "the" active version does not
   exist. */
async function loadSubjectMap(students) {
    if (gradeState.subjectMap) return gradeState.subjectMap;
    if (PREVIEW) {
        gradeState.subjectMap = {
            actives: [{ id: 'preview', program_id: null }],
            byProspectus: new Map([['preview', new Map([
                ['CC-COMPROG12', { id: 'sub1', code: 'CC-COMPROG12', title: 'Computer Programming 2', units: 3 }],
                ['SOCIO101', { id: 'sub2', code: 'SOCIO101', title: 'Sociology', units: 3 }],
                ['RIZAL101', { id: 'sub3', code: 'RIZAL101', title: 'Rizal Course', units: 3 }],
            ])]]),
        };
        return gradeState.subjectMap;
    }

    const { data: activeRows } = await supabase
        .from('prospectus')
        .select('id, program_id')
        .eq('is_active', true);
    const actives = activeRows ?? [];

    // Load the subjects of every prospectus a row could resolve to: each
    // student's own, and every active one (a possible fallback).
    const ids = new Set(actives.map(a => a.id));
    for (const s of students?.values?.() ?? []) ids.add(s.prospectus_id);
    ids.delete(null);
    ids.delete(undefined);

    const { data } = ids.size
        ? await supabase
            .from('subject')
            .select('id, code, title, units, prospectus_id')
            .in('prospectus_id', [...ids])
        : { data: [] };

    const byProspectus = new Map();
    // Separator-free fallback index ("CRIM-111" finds "CRIM 111"). A key two
    // subjects share is stored as null, so it never guesses between them.
    const loose = new Map();
    for (const s of data ?? []) {
        if (!byProspectus.has(s.prospectus_id)) byProspectus.set(s.prospectus_id, new Map());
        byProspectus.get(s.prospectus_id).set(normCode(s.code), s);

        if (!loose.has(s.prospectus_id)) loose.set(s.prospectus_id, new Map());
        const lk = window.GradeFile.looseCode(s.code);
        const bucket = loose.get(s.prospectus_id);
        bucket.set(lk, bucket.has(lk) ? null : s);
    }

    gradeState.subjectMap = { actives, byProspectus, loose };
    return gradeState.subjectMap;
}

async function readGradeFile(file, options = {}) {
    const fileIssue = window.CurriculogicUploadLimits.fileProblem(file, 'grades');
    if (fileIssue) throw new Error(fileIssue);

    if (typeof XLSX === 'undefined') {
        await new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = '../../shared/js/vendor/xlsx.full.min.js';
            s.onload = resolve;
            s.onerror = () => reject(new Error('SheetJS failed to load.'));
            document.head.appendChild(s);
        });
    }
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array', raw: false, cellDates: false });
    if (!wb.SheetNames.length) throw new Error('File has no readable sheet.');

    // The sheet, the header row and the column names are worked out from
    // the data (shared/js/gradefile.js), not assumed to be sheet 1 / row 1.
    const sheets = wb.SheetNames.map(name => ({
        name,
        aoa: XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: '', raw: false, header: 1 }),
    }));
    if (sheets.every(s => s.aoa.length < 2)) throw new Error('File is empty.');

    // Minus the header row, so the number named is the number of grade rows.
    const gradeRows = Math.max(0, Math.max(...sheets.map(s => window.CurriculogicUploadLimits.dataRows(s.aoa))) - 1);
    const rowsIssue = window.CurriculogicUploadLimits.rowsProblem(gradeRows, 'grades');
    if (rowsIssue) throw new Error(rowsIssue);

    const picked = window.GradeFile.pickSheet(sheets, options);
    if (!picked) throw new Error(`Could not find the grade table. ${window.GradeFile.ACCEPTED_HEADERS_HELP}`);
    if (!picked.dataRows) throw new Error('The header was found but there are no grade rows under it.');
    return window.GradeFile.readRows(picked);
}

async function processGradeFile(file) {
    if (gradeState.busy || !file) return;
    if (!termChosen()) return renderGradeFileCard();

    gradeState.busy = true;
    renderGradeFileCard();
    showMsg('grade-msg', '');

    const t = window.UploadProgress.tracker([
        { id: 'read',     weight: 5,  label: 'Reading the file' },
        { id: 'students', weight: 15, label: 'Loading students' },
        { id: 'subjects', weight: 15, label: 'Loading the curriculum' },
        { id: 'rows',     weight: 35, label: 'Checking rows' },
        { id: 'compare',  weight: 30, label: 'Comparing with saved records' },
    ]);
    const report = (id, f, detail) => gradeProgress(t.update(id, f, detail));

    try {
        report('read', 0);
        const rows = await readGradeFile(file, { subjectChosen: !!$('g-subject')?.value });
        report('read', 1, `${rows.length} row${rows.length === 1 ? '' : 's'}`);
        await validateGrades(rows, file.name, report);
        t.finish();
        gradeStatus('done', `Checked ${rows.length} row${rows.length === 1 ? '' : 's'}. Review the preview below; nothing is saved yet.`, 100);
    } catch (err) {
        gradeStatus('error', err.message, t.percent);
        showMsg('grade-msg', err.message);
    } finally {
        gradeState.busy = false;
        renderGradeFileCard();
    }
}

// Choosing a file shows it and waits for the Check button; nothing runs by itself.
$('grade-file')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    gradeState.lastFile = file;
    gradeState.rows = [];
    const card = $('grade-preview-card');
    if (card) card.hidden = true;
    if ($('grade-preview')) $('grade-preview').innerHTML = '';
    gradeStatus(null);
    renderGradeFileCard();
});

$('grade-check')?.addEventListener('click', () => processGradeFile(gradeState.lastFile));

$('grade-file-clear')?.addEventListener('click', () => {
    if (gradeState.busy) return;
    gradeState.lastFile = null;
    gradeState.rows = [];
    $('grade-file').value = '';
    const card = $('grade-preview-card');
    if (card) card.hidden = true;
    if ($('grade-preview')) $('grade-preview').innerHTML = '';
    gradeStatus(null);
    renderGradeFileCard();
});

// A term is needed before a file can be checked, and the result depends on it.
$('g-period')?.addEventListener('change', () => {
    renderGradeFileCard();
    if (gradeState.lastFile && previewShowing()) processGradeFile(gradeState.lastFile);
});

/* ---- Subject picker and class list ---- */

async function renderSubjectOptions() {
    const sel = $('g-subject');
    if (!sel) return;

    let list = [];
    if (PREVIEW) {
        list = [
            { id: 'sub1', code: 'CC-COMPROG12', title: 'Computer Programming 2' },
            { id: 'sub2', code: 'SOCIO101',     title: 'Sociology' },
            { id: 'sub3', code: 'RIZAL101',     title: 'Rizal Course' },
        ];
    } else {
        // The department sees only its own programme's curriculum, so this is
        // the list of subjects it can actually grade.
        const { data: actives } = await supabase.from('prospectus').select('id').eq('is_active', true);
        const ids = (actives ?? []).map(a => a.id);
        if (ids.length) {
            const { data } = await supabase
                .from('subject')
                .select('id, code, title, year_level, term')
                .in('prospectus_id', ids)
                .order('year_level', { ascending: true, nullsFirst: false })
                .order('term', { ascending: true })
                .order('code', { ascending: true });
            list = data ?? [];
        }
    }

    gradeState.subjectChoices = list;
    sel.innerHTML = '<option value="">Not needed: my file has a subject column</option>' +
        list.map(s => `<option value="${escapeHtml(s.code)}">${escapeHtml(s.code)} \u2014 ${escapeHtml(s.title ?? '')}</option>`).join('');
}

$('g-subject')?.addEventListener('change', () => {
    const chosen = !!$('g-subject').value;
    const btn = $('grade-classlist');
    if (btn) btn.disabled = !chosen;
    // The same file may now read differently (a class list needs a subject),
    // so a file already checked is checked again with the new choice.
    renderGradeFileCard();
    if (gradeState.lastFile && previewShowing()) processGradeFile(gradeState.lastFile);
});

/* The students whose enrollment in this subject, for this term, was approved
   by the adviser. This is a lookup, not a guess: the approved requests are
   the system's record of who is taking what. */
async function fetchClassList(subject, year, term) {
    if (PREVIEW) {
        return [
            { student_id: '2401187', first_name: 'Althea', last_name: 'Villanueva' },
            { student_id: '2401188', first_name: 'Marco',  last_name: 'Deveza' },
        ];
    }
    // Matched on the subject's CODE, not its row id: a curriculum has a new set
    // of subject rows for every version, and a student enrolled under the
    // previous version still holds the older row's id.
    const { data, error } = await supabase
        .from('request_item')
        .select('subject:subject_id!inner(code), request!inner(status, registrar_status, requested_year, requested_term, student:student_id(student_id, first_name, last_name))')
        .eq('subject.code', subject.code)
        .neq('status', 'rejected')
        .in('request.status', ['approved', 'partially_approved'])
        .eq('request.requested_year', year)
        .eq('request.requested_term', term);
    if (error) throw new Error('Could not read the enrollment list. ' + error.message);
    // Approved by the adviser, which is final; an old plan the Registrar once
    // sent back stays closed (shared/js/requeststatus.js).
    return (data ?? [])
        .filter(row => window.CurriculogicRequestStatus.finalApproved(row.request))
        .map(row => row.request?.student)
        .filter(Boolean);
}

$('grade-classlist')?.addEventListener('click', async () => {
    if (typeof XLSX === 'undefined') {
        return showMsg('grade-msg', 'The spreadsheet library did not load. Check your connection.');
    }
    const code = $('g-subject')?.value;
    const subject = (gradeState.subjectChoices ?? []).find(s => s.code === code);
    if (!subject) return showMsg('grade-msg', 'Choose a subject first.');

    const [yearStr, termStr] = String($('g-period')?.value || '').split('-');
    const year = Number(yearStr), term = Number(termStr);
    if (!Number.isInteger(year) || ![1, 2, 3].includes(term)) {
        return showMsg('grade-msg', 'Choose a term first: the class list is for one term.');
    }

    showMsg('grade-msg', '');
    try {
        const people = await fetchClassList(subject, year, term);
        const aoa = window.GradeFile.classListRows(subject, people);

        const ws = XLSX.utils.aoa_to_sheet(aoa);
        ws['!cols'] = [{ wch: 12 }, { wch: 28 }, { wch: 18 }, { wch: 8 }, { wch: 10 }];
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Class list');
        XLSX.writeFile(wb, `class-list-${subject.code}-${year}-${term}.xlsx`.replace(/\s+/g, ''));

        const n = aoa.length - 1;
        showMsg('grade-msg', n
            ? `Class list downloaded: ${n} student${n === 1 ? '' : 's'} with an approved enrollment in ${subject.code}. Fill in the grades and upload it here.`
            : `No approved enrollments were found for ${subject.code} in that term, so the sheet has only the headings. ` +
              'If students are enrolled, the Registrar may not have approved their requests yet.',
            n ? 'success' : 'error');
    } catch (err) {
        showMsg('grade-msg', err.message);
    }
});

async function validateGrades(rows, fileName, report = () => {}) {
    report('students', 0);
    const students = await loadStudentMap();
    report('students', 1, `${students.size} students`);
    report('subjects', 0);
    const subjects = await loadSubjectMap(students);
    report('subjects', 1);

    // 3.0 is UC's passing mark. It is not configurable — a program
    // setting a tighter threshold would fail students who passed under
    // the university's own scale. Files that need a different
    // classification per row use the status column.
    const passing = 3.0;

    // The dropdown value carries both halves: "2026-1" → year 2026,
    // term 1 (1st Sem). One field, one choice, one source.
    const period = String($('g-period')?.value || '');
    const [yearStr, termStr] = period.split('-');
    const year = Number(yearStr);
    const term = Number(termStr);

    if (!Number.isInteger(year) || year < 2000 || year > 2100
        || ![1, 2, 3].includes(term)) {
        return showMsg('grade-msg', 'Choose a term before uploading.');
    }

    const ok = [], bad = [], skipped = [];
    // A subject chosen on the page applies to the whole file (see the Subject card).
    const chosenSubject = $('g-subject')?.value || '';
    const seenAttempts = new Map();   // student+subject+term -> first line, to catch a repeat in one file
    let checked = 0;

    for (const r of rows) {
        // Let the bar repaint every few rows, so the percentage moves with the work.
        if (checked > 0 && checked % 25 === 0) {
            report('rows', checked / rows.length, `${checked} of ${rows.length}`);
            await yieldToUi();
        }
        checked++;
        const rawId = r.student_id;
        let rawCode = r.subject_code;
        const rawGrade = r.grade;
        let wrongSubject = null;
        if (chosenSubject) {
            if (!rawCode) rawCode = chosenSubject;
            else if (window.GradeFile.looseCode(rawCode) !== window.GradeFile.looseCode(chosenSubject)) {
                wrongSubject = `This row is for ${rawCode}, but you selected ${chosenSubject}. ` +
                    'Change the subject above, or correct the row.';
            }
        }
        const rawStatus = window.GradeFile.normStatus(r.status);

        const base = {
            line: r.__line,
            raw_student_id: rawId,
            raw_student_name: r.student_name || '',
            raw_subject_code: rawCode,
            raw_grade: rawGrade,
        };

        if (wrongSubject) { bad.push({ ...base, why: wrongSubject }); continue; }
        if (!rawId) { bad.push({ ...base, why: 'No student ID.' }); continue; }
        const cleanId = padStudentId(rawId);
        if (/^\d+$/.test(cleanId) && cleanId.length !== 7) {
            bad.push({ ...base, why: `"${rawId}" should be 7 digits. Check Excel formatting.` });
            continue;
        }
        const student = students.get(cleanId);
        if (!student) { bad.push({ ...base, why: `ID "${cleanId}" not registered.` }); continue; }

        if (!rawCode) { bad.push({ ...base, why: 'No subject code.' }); continue; }
        const cleanCode = normCode(rawCode);
        const prospectusId = student.prospectus_id
            ?? window.CurriculogicPrograms.fallbackProspectus(student.program_id, subjects.actives)?.id
            ?? null;
        if (prospectusId === null) {
            bad.push({ ...base, why: 'This student has no curriculum: their programme has none published, or no programme is set.' });
            continue;
        }
        const subject = subjects.byProspectus.get(prospectusId)?.get(cleanCode)
            ?? subjects.loose?.get(prospectusId)?.get(window.GradeFile.looseCode(rawCode))
            ?? null;
        if (!subject) {
            bad.push({ ...base, why: `"${rawCode}" not in this student's prospectus.` });
            continue;
        }

        const parsed = window.GradeFile.parseGrade(rawGrade);
        if (parsed.error) { bad.push({ ...base, why: parsed.error }); continue; }
        const points = parsed.points;

        // An explicit status column wins; otherwise a grade cell that said
        // "DRP" or the like sets it.
        let status = rawStatus || parsed.status || '';

        if (!status) {
            if (points === null) status = 'ENROLLED';
            else status = points <= passing ? 'PASSED' : 'FAILED';
        }

        if (!['PASSED','FAILED','ENROLLED','DROPPED'].includes(status)) {
            bad.push({ ...base, why: `Status "${status}" invalid.` });
            continue;
        }

        const parsedTerm = window.GradeFile.parseTerm(r.term, term);
        const parsedYear = window.GradeFile.parseYear(r.academic_year, year);
        if (isNaN(parsedTerm) || parsedTerm < 1 || parsedTerm > 3) {
            bad.push({ ...base, why: `Term "${r.term}" must be 1, 2, or 3.` });
            continue;
        }
        if (isNaN(parsedYear) || parsedYear < 2000 || parsedYear > 2100) {
            bad.push({ ...base, why: `Year "${r.academic_year}" invalid.` });
            continue;
        }

        let nameWarn = null;
        if (!window.GradeFile.nameMatches(base.raw_student_name, student.first_name, student.last_name)) {
            nameWarn = `Name mismatch: "${base.raw_student_name}" vs ${student.first_name} ${student.last_name}`;
        }

        // The same student and subject twice for one term in one file would make
        // the save fail halfway (the database refuses a row twice in one batch).
        const attempt = window.GradeFile.attemptKey(student.id, subject.id, parsedTerm, parsedYear);
        if (seenAttempts.has(attempt)) {
            bad.push({ ...base, why: `Appears twice in this file: line ${seenAttempts.get(attempt)} already has this student and subject for this term.` });
            continue;
        }
        seenAttempts.set(attempt, r.__line);

        ok.push({
            ...base,
            student,
            subject,
            grade_points: points,
            status,
            term: parsedTerm,
            academic_year: parsedYear,
            name_warning: nameWarn,
        });
    }

    // Say which rows are already recorded, which would replace a grade, and which are new.
    report('rows', 1, `${rows.length} of ${rows.length}`);
    const existing = await loadExistingRecords(ok, report);
    const compared = window.GradeFile.flagRepeats(window.GradeFile.compareWithRecords(ok, existing), existing);
    gradeState.rows = compared;
    renderGradePreview(compared, bad, fileName, passing);
}

/* The records already saved for the students in this file. Fails closed: if
   they cannot be read, the upload stops with a message rather than calling
   every row "new". */
async function loadExistingRecords(rows, report = () => {}) {
    if (PREVIEW || !rows.length) { report('compare', 1); return []; }
    const ids = [...new Set(rows.map(r => r.student.id))];
    const found = [];
    const batches = chunksOf(ids, 200);
    for (let i = 0; i < batches.length; i++) {
        report('compare', i / batches.length, `${Math.min(i * 200, ids.length)} of ${ids.length} students`);
        const { data, error } = await supabase
            .from('academic_record')
            .select('student_id, subject_id, taken_term, taken_year, grade_points, status')
            .in('student_id', batches[i]);
        if (error) throw new Error('Could not check the file against the records already saved. ' + error.message);
        found.push(...(data ?? []));
    }
    report('compare', 1);
    return found;
}

function renderGradePreview(ok, bad, fileName, passing) {
    const card = $('grade-preview-card');
    const box  = $('grade-preview');
    const note = $('grade-preview-note');
    if (!card || !box) return;

    card.hidden = false;
    if (note) note.textContent = fileName;

    const warned = ok.filter(r => r.name_warning);
    const changes = window.GradeFile.summarizeChanges(ok);
    const repeats = ok.filter(r => r.repeat);
    const termName = { 1: '1st Sem', 2: '2nd Sem', 3: 'Summer' };

    // Outcome breakdown — the strip's four values.
    const statusCount = (s) => ok.filter(r => r.status === s).length;
    const passed   = statusCount('PASSED');
    const failed   = statusCount('FAILED');
    const enrolled = statusCount('ENROLLED');
    const dropped  = statusCount('DROPPED');

    let html = '';

    // Four stat cards — same shape as Schedule's upload stats.
    html += `
        <div class="upload-stats">
            <div class="upload-stat">
                <p class="k">Rows</p>
                <p class="v">${ok.length + bad.length}</p>
                <p class="u">parsed from the file</p>
            </div>
            <div class="upload-stat${ok.length ? ' is-ready' : ''}">
                <p class="k">Valid</p>
                <p class="v">${ok.length}</p>
                <p class="u">ready to submit</p>
            </div>
            <div class="upload-stat${bad.length ? ' is-issues' : ''}">
                <p class="k">Rejected</p>
                <p class="v">${bad.length}</p>
                <p class="u">${bad.length ? 'need to be fixed' : 'none found'}</p>
            </div>
            <div class="upload-stat${warned.length ? ' is-issues' : ''}">
                <p class="k">Warnings</p>
                <p class="v">${warned.length}</p>
                <p class="u">${warned.length ? 'soft — still accepted' : 'none found'}</p>
            </div>
        </div>

        <div class="grade-status-strip">
            <span class="grade-status-item is-passed">
                <span class="k">Passed</span><span class="v">${passed}</span>
            </span>
            <span class="grade-status-item is-failed">
                <span class="k">Failed</span><span class="v">${failed}</span>
            </span>
            <span class="grade-status-item is-enrolled">
                <span class="k">Enrolled</span><span class="v">${enrolled}</span>
            </span>
            <span class="grade-status-item is-dropped">
                <span class="k">Dropped</span><span class="v">${dropped}</span>
            </span>
        </div>
    `;

    if (ok.length) {
        const parts = [];
        if (changes.new)       parts.push(`${changes.new} new`);
        if (changes.changed)   parts.push(`${changes.changed} correction${changes.changed === 1 ? '' : 's'}`);
        if (changes.unchanged) parts.push(`${changes.unchanged} already recorded`);
        const nothing = changes.toSave === 0;
        html += `
            <div class="notice ${nothing || changes.changed ? 'pending' : 'info'}">
                <i class="fa-solid ${nothing ? 'fa-circle-exclamation' : 'fa-clock-rotate-left'}" aria-hidden="true"></i>
                <div>
                    <strong>${parts.join(' · ')}</strong>
                    ${nothing
                        ? '<span class="dim">Every row is already recorded exactly as it is in this file, so there is nothing to save. This looks like a file that was uploaded before.</span>'
                        : `<span class="dim">${changes.changed ? 'A correction replaces the grade already on record for that student, subject and term. ' : ''}${changes.unchanged ? 'Rows already recorded as they are will be skipped.' : ''}</span>`}
                </div>
            </div>`;
    }

    if (repeats.length) {
        html += `
            <div class="notice pending">
                <i class="fa-solid fa-rotate" aria-hidden="true"></i>
                <div>
                    <strong>${repeats.length} grade${repeats.length > 1 ? 's are' : ' is'} for a subject the student already passed</strong>
                    ${repeats.slice(0, 5).map(r =>
                        `<span class="dim">Line ${r.line}: ${escapeHtml(r.student.first_name)} ${escapeHtml(r.student.last_name)}, ${escapeHtml(r.subject.code)}, passed in ${r.repeat.year} ${termName[r.repeat.term] ?? ''}${r.repeat.grade_points == null ? '' : ' (' + Number(r.repeat.grade_points).toFixed(2) + ')'}</span>`
                    ).join('<br>')}
                    ${repeats.length > 5 ? `<span class="dim">and ${repeats.length - 5} more</span>` : ''}
                    <span class="dim">A retake of a failed subject is normal, but this often means the file was uploaded under the wrong term. Check the term above. These rows are still accepted if you submit.</span>
                </div>
            </div>`;
    }

    if (warned.length) {
        html += `
            <div class="notice pending">
                <i class="fa-solid fa-user-check"></i>
                <div>
                    <strong>${warned.length} name warning${warned.length > 1 ? 's' : ''}</strong>
                    ${warned.slice(0, 5).map(r =>
                        `<span class="dim">Line ${r.line}: ${escapeHtml(r.name_warning)}</span>`
                    ).join('<br>')}
                    ${warned.length > 5 ? `<span class="dim">and ${warned.length - 5} more</span>` : ''}
                    <span class="dim">These are soft — the rows were still accepted.</span>
                </div>
            </div>
        `;
    }

    if (bad.length) {
        html += `
            <h3 class="group-head">Rejected rows (${bad.length})</h3>
            <div class="table-wrap">
                <table class="data-table">
                    <thead><tr><th>Line</th><th>Student</th><th>Subject</th><th>Reason</th></tr></thead>
                    <tbody>${bad.map(b => `
                        <tr>
                            <td class="num">${b.line}</td>
                            <td class="mono">${escapeHtml(b.raw_student_id || '—')}</td>
                            <td class="mono">${escapeHtml(b.raw_subject_code || '—')}</td>
                            <td>${escapeHtml(b.why)}</td>
                        </tr>
                    `).join('')}</tbody>
                </table>
            </div>
        `;
    }

    if (ok.length) {
        html += `
            <h3 class="group-head">${changes.toSave ? 'Rows in this file' : 'Rows in this file (nothing to save)'} (${ok.length})</h3>
            <div class="table-wrap">
                <table class="data-table">
                    <thead><tr><th>ID</th><th>Name</th><th>Subject</th><th class="num">Grade</th><th>Status</th><th>Record</th></tr></thead>
                    <tbody>${ok.slice(0, 15).map(r => `
                        <tr>
                            <td class="mono">${escapeHtml(r.student.student_id)}</td>
                            <td>${escapeHtml(r.student.first_name)} ${escapeHtml(r.student.last_name)}</td>
                            <td class="mono">${escapeHtml(r.subject.code)}</td>
                            <td class="num">${r.grade_points == null ? '—' : r.grade_points.toFixed(2)}</td>
                            <td><span class="pill ${r.status === 'PASSED' ? 'ok' : r.status === 'FAILED' ? 'bad' : r.status === 'DROPPED' ? 'waiting' : 'info'}">${escapeHtml(r.status)}</span></td>
                            <td>${r.change === 'unchanged'
                                ? '<span class="pill waiting">Already recorded</span>'
                                : r.change === 'changed'
                                    ? `<span class="pill bad">Correction</span> <span class="dim">was ${r.prev?.grade_points == null ? '\u2014' : Number(r.prev.grade_points).toFixed(2)} ${escapeHtml(r.prev?.status ?? '')}</span>`
                                    : '<span class="pill info">New</span>' + (r.repeat
                                        ? ` <span class="pill waiting" title="Already passed in ${r.repeat.year} ${termName[r.repeat.term] ?? ''}">Already passed ${r.repeat.year}</span>`
                                        : '')}</td>
                        </tr>
                    `).join('')}</tbody>
                </table>
                ${ok.length > 15 ? `<p class="dim">and ${ok.length - 15} more</p>` : ''}
            </div>

            <div class="preview-actions">
                ${changes.toSave ? `
                <button class="btn-accent" id="commit-grades">
                    <i class="fa-solid fa-check" aria-hidden="true"></i>
                    <span>Submit ${changes.toSave} Grade${changes.toSave === 1 ? '' : 's'}</span>
                </button>` : ''}
                <button class="btn-secondary" id="discard-grades">
                    Discard upload
                </button>
            </div>
        `;
    }

    box.innerHTML = html;

    $('commit-grades')?.addEventListener('click', () => {
        commitGrades(fileName, bad, passing);
    });
    $('discard-grades')?.addEventListener('click', discardGradePreview);
}

/* Throws away a grade preview without saving. Mirrors discardPreview()
   in the schedule section — clears the local state, resets the file
   picker, hides the preview card. Nothing was written to the DB, so
   there is nothing to roll back. */
function discardGradePreview() {
    gradeState.rows = [];

    const box = $('grade-preview');
    if (box) box.innerHTML = '';

    const card = $('grade-preview-card');
    if (card) card.hidden = true;

    const note = $('grade-preview-note');
    if (note) note.textContent = '';

    const file = $('grade-file');
    if (file) file.value = '';

    showMsg('grade-msg', '');
}

async function commitGrades(fileName, bad, passing) {
    if (gradeState.rows.length === 0) {
        return showMsg('grade-msg', 'No valid rows to save.');
    }

    // Rows already recorded exactly as in the file are not written again.
    const toWrite = gradeState.rows.filter(r => r.change !== 'unchanged');
    const alreadyRecorded = gradeState.rows.length - toWrite.length;
    if (toWrite.length === 0) {
        return showMsg('grade-msg', 'Nothing to save: every row is already recorded exactly as in this file.');
    }

    const btn = $('commit-grades');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving…';
    }

    const save = window.UploadProgress.tracker([
        { id: 'audit',   weight: 5,  label: 'Recording the upload' },
        { id: 'log',     weight: 20, label: 'Saving the row log' },
        { id: 'records', weight: 65, label: 'Saving grades' },
        { id: 'finish',  weight: 10, label: 'Finishing' },
    ]);
    const saveReport = (id, f, detail) => gradeProgress(save.update(id, f, detail));
    gradeState.busy = true;
    saveReport('audit', 0);
    let savedSoFar = 0;

    const period = String($('g-period')?.value || '');
    const [yearStr, termStr] = period.split('-');
    const year = Number(yearStr);
    const term = Number(termStr);

    if (PREVIEW) {
        $('grade-preview').innerHTML = '';
        const previewCard = $('grade-preview-card');
        if (previewCard) previewCard.hidden = true;
        $('grade-file').value = '';
        showMsg('grade-msg', `${toWrite.length} grades submitted (preview).`, 'success');

        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-check"></i> Save records';
        }
        gradeState.rows = [];
        gradeState.busy = false;
        return;
    }

    try {
        const { data: file, error: fe } = await supabase
            .from('grade_file')
            .insert([{
                uploaded_by: STAFF_ID,
                file_name: String(fileName ?? '').slice(0, 255),
                status: 'processing',
                row_count: gradeState.rows.length + bad.length,
                matched_count: toWrite.length,
                error_count: bad.length,
                passing_grade: passing,
                term: term,
                academic_year: year,
            }])
            .select()
            .single();

        if (fe) throw new Error('Audit failed: ' + fe.message);

        // The row log keeps what the file said, cut to the database's limits
        // (db/050): one long cell must not fail a whole upload's audit log.
        const clip = (v, n) => (v == null ? v : String(v).slice(0, n));

        const rowPayload = [
            ...toWrite.map(r => ({
                grade_file_id: file.id,
                row_number: r.line,
                raw_student_id: r.raw_student_id,
                raw_student_name: clip(r.raw_student_name, 200),
                raw_subject_code: clip(r.raw_subject_code, 60),
                raw_grade: clip(r.raw_grade, 20),
                student_id: r.student.id,
                subject_id: r.subject.id,
                grade_points: r.grade_points,
                status: r.status,
                term: r.term,
                academic_year: r.academic_year,
                validation_status: 'matched',
                error_message: clip(r.name_warning, 500),
            })),
            ...bad.map(b => ({
                grade_file_id: file.id,
                row_number: b.line,
                raw_student_id: b.raw_student_id,
                raw_student_name: clip(b.raw_student_name, 200),
                raw_subject_code: clip(b.raw_subject_code, 60),
                raw_grade: clip(b.raw_grade, 20),
                validation_status: 'rejected',
                error_message: clip(b.why, 500),
            })),
        ];

        // The row log is audit detail: in batches, so the bar moves, and a failure
        // here is reported in the console without stopping the grades being saved.
        saveReport('audit', 1);
        const logBatches = chunksOf(rowPayload, 100);
        for (let i = 0; i < logBatches.length; i++) {
            saveReport('log', i / logBatches.length, `${Math.min(i * 100, rowPayload.length)} of ${rowPayload.length} rows`);
            const { error: le } = await supabase.from('grade_file_row').insert(logBatches[i]);
            if (le) console.warn('row log batch failed:', le.message);
        }
        saveReport('log', 1);

        const records = toWrite.map(r => ({
            student_id: r.student.id,
            subject_id: r.subject.id,
            grade: r.raw_grade || null,
            grade_points: r.grade_points,
            status: r.status,
            taken_term: r.term,
            taken_year: r.academic_year,
        }));

        // Keyed on the attempt, not the subject. Re-uploading a corrected grade
        // for the same term updates that attempt; a retake in a later term becomes
        // a new row, so the earlier failure stays on the transcript.
        // Saved in batches so the percentage is the share really saved. If a batch
        // fails, the earlier ones are kept, and running the same file again
        // finishes the job: the rows already saved show as "already recorded".
        const batches = chunksOf(records, 100);
        for (let i = 0; i < batches.length; i++) {
            saveReport('records', savedSoFar / records.length, `${savedSoFar} of ${records.length} grades`);
            const { error: re } = await supabase
                .from('academic_record')
                .upsert(batches[i], { onConflict: 'student_id,subject_id,taken_term,taken_year' });
            if (re) {
                throw new Error(`Record save failed after ${savedSoFar} of ${records.length} grades: ${re.message}. ` +
                    'Check the same file again to finish: grades already saved will show as already recorded.');
            }
            savedSoFar += batches[i].length;
        }
        saveReport('records', 1, `${records.length} of ${records.length} grades`);
        saveReport('finish', 0);

        await supabase
            .from('grade_file')
            .update({ status: 'completed', processed_at: new Date().toISOString() })
            .eq('id', file.id);

        await supabase
            .from('grade_file_row')
            .update({ validation_status: 'applied', processed_at: new Date().toISOString() })
            .eq('grade_file_id', file.id)
            .eq('validation_status', 'matched');

        gradeState.rows = [];
        $('grade-preview').innerHTML = '';
        const previewCard = $('grade-preview-card');
        if (previewCard) previewCard.hidden = true;
        $('grade-file').value = '';
        gradeState.lastFile = null;
        renderGradeFileCard();

        await loadGradeHistory();

        const corrected = toWrite.filter(r => r.change === 'changed').length;
        let msg = `${records.length} grade${records.length === 1 ? '' : 's'} saved` +
            (corrected ? ` (${corrected} replaced an earlier grade)` : '') + '.';
        if (alreadyRecorded > 0) {
            msg += ` ${alreadyRecorded} already recorded and skipped.`;
        }
        if (bad.length > 0) {
            msg += ` ${bad.length} row${bad.length === 1 ? '' : 's'} rejected.`;
        }
        save.finish();
        gradeStatus('done', msg, 100);
        showMsg('grade-msg', msg, 'success');

    } catch (err) {
        console.error('commit failed:', err);
        gradeStatus('error', err.message || 'An error occurred while saving.', save.percent);
        showMsg('grade-msg', err.message || 'An error occurred while saving.');
    } finally {
        gradeState.busy = false;
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-check"></i> Save records';
        }
    }
}

async function loadGradeHistory() {
    const body = $('history-body');
    if (!body) return;

    if (PREVIEW) {
        body.innerHTML = `
            <div class="empty">
                <i class="fa-solid fa-clock-rotate-left"></i>
                <h3>No history in preview</h3>
                <p>Preview mode does not save upload history.</p>
            </div>
        `;
        return;
    }

    const { data, error } = await supabase
        .from('grade_file')
        .select('file_name, status, row_count, matched_count, error_count, term, academic_year, uploaded_at')
        .order('uploaded_at', { ascending: false })
        .limit(50);

    if (error) {
        body.innerHTML = `
            <div class="empty">
                <i class="fa-solid fa-triangle-exclamation"></i>
                <h3>Could not load history</h3>
                <p>${escapeHtml(error.message)}</p>
            </div>
        `;
        return;
    }

    const files = data ?? [];
    $('history-count').textContent = files.length ? `${files.length} uploads` : '';

    if (!files.length) {
        body.innerHTML = `
            <div class="empty">
                <i class="fa-solid fa-inbox"></i>
                <h3>No uploads yet</h3>
                <p>Grade uploads will appear here once you upload a file.</p>
            </div>
        `;
        return;
    }

    body.innerHTML = `
        <div class="table-wrap">
            <table class="data-table">
                <thead>
                    <tr>
                        <th>File</th>
                        <th>Term</th>
                        <th class="num">Rows</th>
                        <th class="num">Applied</th>
                        <th class="num">Errors</th>
                        <th>Status</th>
                    </tr>
                </thead>
                <tbody>
                    ${files.map(f => `
                        <tr>
                            <td>${escapeHtml(f.file_name)}</td>
                            <td class="dim">${termLabel(f.term)} ${f.academic_year}</td>
                            <td class="num">${f.row_count ?? '—'}</td>
                            <td class="num">${f.matched_count ?? '—'}</td>
                            <td class="num">${f.error_count ? `<span class="pill bad">${f.error_count}</span>` : '0'}</td>
                            <td><span class="pill ${f.status === 'completed' ? 'ok' : f.status === 'failed' ? 'bad' : 'waiting'}">${escapeHtml(f.status)}</span></td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

$('grade-template')?.addEventListener('click', () => {
    if (typeof XLSX === 'undefined') {
        return showMsg('grade-msg', 'The spreadsheet library did not load. Check your connection.');
    }

    const rows = [
        ['student_id', 'student_name', 'subject_code', 'grade', 'status'],
        ['2401187',    'Althea Villanueva', 'CC-COMPROG12', 2.25, ''],
        ['2401187',    'Althea Villanueva', 'SOCIO101',     1.75, ''],
        ['2401187',    'Althea Villanueva', 'RIZAL101',     2.00, ''],
    ];

    const ws = XLSX.utils.aoa_to_sheet(rows);

    // Column widths — character units, not pixels. Roughly px/7.
    // Tuned to match the sample: wide enough for a subject code and a
    // full name without the operator having to drag anything.
    ws['!cols'] = [
        { wch: 12 },  // student_id
        { wch: 24 },  // student_name
        { wch: 18 },  // subject_code
        { wch:  8 },  // grade
        { wch: 10 },  // status
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Grades');
    XLSX.writeFile(wb, 'grade-template.xlsx');
});

/* boot */

(async function init() {

    if (previewRequested()) {
        PREVIEW = true;
        STAFF = PREVIEW_STAFF;
        STAFF_ID = PREVIEW_STAFF.id;
        document.body.classList.add('is-preview');
        renderProfile(STAFF, PREVIEW_STAFF.email);
        renderNotice(STAFF);
        await loadReadiness();
        await loadCurriculum();
        route();
        return;
    }

    if (!supabase) {
        setText('greeting', 'Cannot reach the service');
        console.error('departmentdashboard.js: Supabase client not created. Is config.js loaded?');
        return;
    }

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { window.location.href = LOGIN_PAGE; return; }

    AUTH_UID = session.user.id;

    const { data: staff, error } = await supabase
        .from('department_staff')
        .select('id, user_id, first_name, last_name, employee_id, email, department, program_id, is_approved, avatar_url, created_at')
        .eq('user_id', AUTH_UID)
        .maybeSingle();

    if (error) {
        // A failed lookup is not proof this is the wrong kind of account;
        // do not bounce a real staff member because the network blinked.
        console.warn('department staff load failed:', error.message);
        setText('greeting', 'Could not load your account');
        return;
    }

    if (staff && staff.is_approved === false) {
        await supabase.auth.signOut();
        window.location.href = LOGIN_PAGE;
        return;
    }

    // A signed-in user with no department row (a student or faculty member
    // who edited the URL) has no business here. Send them back instead of
    // showing an empty shell. Not signed out: they are validly signed in,
    // just somewhere else.
    if (!staff) {
        window.location.href = LOGIN_PAGE;
        return;
    }

    STAFF = staff;
    STAFF_ID = staff?.id ?? null;

    renderProfile(staff, session.user.email);
    fillProfileForm(staff);
    renderNotice(staff);
    window.CurriculogicForcePassword?.run(supabase, 'department');

    // Programme names are looked up, not typed. The working programme has to
    // be known before anything reads a version or counts a schedule.
    await window.CurriculogicPrograms?.load(supabase);
    initPrograms();

    // Readiness (students, offerings, grade files) has to be in before the
    // curriculum load renders the tiles and the setup badge. It only ran in
    // preview, so a real login always showed 0 offerings and 0 uploads and
    // a setup badge that could never complete.
    await loadReadiness();
    await loadCurriculum();
    route();
})();

})();