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

const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.CURRICULOGIC ?? {};

const supabase = (window.supabase && SUPABASE_URL && SUPABASE_ANON_KEY)
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
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
    { id: 3, subject_id: 5, prerequisite_subject_id: null, requirement_type: 'standing',  rule_type: 'and', rule_group: 1, threshold_value: 3 },
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
    if (next.length < 8) return showMsg('pw-msg', 'New password must be at least 8 characters.');
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
        VERSIONS = allVersions ?? [];
    }

    const active = VERSIONS.find(v => v.is_active) ?? null;
    PROSPECTUS = active;

    /* If the join didn't come back with a code (RLS, missing program row,
       PostgREST version quirk), fall back to the first version's code, and
       finally to BSIT. The dashboard has to render regardless. */
    PROGRAM_CODE = active?.program?.code
                || VERSIONS[0]?.program?.code
                || 'BSIT';

    /* A draft can be edited without being active, so the curriculum view
       follows EDITING rather than assuming the active version. Defaulting
       to active keeps the common case one click shorter. */
    if (!EDITING) EDITING = active;
    mountCurriculumBuilder();

    const pros = EDITING;

    if (!pros) {
        $('prospectus-body').innerHTML = `
            <div class="empty">
                <i class="fa-solid fa-diagram-project" aria-hidden="true"></i>
                <h3>No active prospectus</h3>
                <p>Create one before adding subjects.</p>
            </div>`;
        return;
    }

    const { data: subs, error: subErr } = await supabase
        .from('subject')
        .select('id, code, title, units, lec_units, lab_units, year_level, term, is_elective, is_active')
        .eq('prospectus_id', EDITING.id)
        .order('year_level').order('term').order('code');

    if (subErr) {
        console.warn('subject load failed:', subErr.message);
        return;
    }

    const { data: rules } = await supabase
        .from('prerequisite')
        .select('id, subject_id, prerequisite_subject_id, requirement_type, rule_type, rule_group, threshold_value');

    SUBJECTS = subs ?? [];
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
            <div class="detail"><dt>Programme</dt><dd>BS Information Technology</dd></div>
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
        if (g && q && pos(q) >= pos(g)) {
            issues.push(`${g.code} requires ${q.code}, which is scheduled at the same time or later.`);
        }
    }

    const adj = new Map();
    for (const r of RULES) {
        if (!r.prerequisite_subject_id) continue;
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
        const sameOrLater = pos(q) >= pos(g);
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
        const y = Number(r.threshold_value);
        return `Must have completed all subjects through ${ordinal(y).toLowerCase()}`;
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

    VERSIONS = data ?? [];

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
        const programId = VERSIONS[0]?.program_id ?? 1;
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
            check.ai_recommendations ? `${check.ai_recommendations} AI recommendation(s)` : '',
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
        supabase.from('university_student').select('id'),
        supabase.from('subject_offering').select('id'),
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

    READY.students   = students.data?.length   ?? 0;
    READY.offerings  = offerings.data?.length  ?? 0;
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

function initSchedule() {
    if (READY.subjects === 0) {
        renderScheduleBlocked();
        return;
    }

    showScheduleForm(true);

    if (!scheduleReady) {
        renderYearOptions();
        renderSectionLetterOptions();
        bindScheduleTableInputs();
        scheduleReady = true;
    }

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

    const years = [...new Set(VERSIONS.map(v => v.academic_year))].sort((a, b) => b - a);

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

    const { data, error } = await supabase
        .from('subject_offering')
    .select('id, edp_code, subject_id, meeting_type, section, schedule_days, start_time, end_time, room, instructor, capacity, is_open')
        .eq('academic_year', year)
        .eq('term', term)
        .order('section');

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

    OFFERINGS = data ?? [];
    // Working copy. Edits land here; the table reads from PENDING so
    // changes are visible immediately without another fetch. Save diffs
    // PENDING against OFFERINGS to know what to insert, update, delete.
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

    for (const r of sectionRows) {
        if (!r.edp_code?.trim()) problems.push('Every row needs an EDP code.');
        if (seenEdps.has(r.edp_code)) problems.push(`EDP ${r.edp_code} is used more than once.`);
        seenEdps.add(r.edp_code);
        if (!r.subject_id)            problems.push('Every row needs a subject.');
        if (!r.schedule_days?.trim()) problems.push('Every row needs days.');
        if (!r.start_time || !r.end_time) problems.push('Every row needs start and end times.');
        if (r.start_time && r.end_time && r.start_time >= r.end_time) {
            problems.push(`Start must be before end on ${r.edp_code}.`);
        }
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
                   placeholder="61251" autocomplete="off"></td>
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
        <td><input data-field="schedule_days" value="${escapeHtml(o.schedule_days || '')}" placeholder="MW"></td>
        <td><input data-field="room" value="${escapeHtml(o.room || '')}" placeholder="215"></td>
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
    loadOfferings().then(() => {
        renderTopSectionOptions();
        refreshTemplateCount();
        renderOfferings();
    });
});

$('sched-term')?.addEventListener('change', () => {
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

$('download-template')?.addEventListener('click', () => {
    const section = currentSection();
    if (!section) {
        return showMsg('sched-msg', 'Choose a section before downloading a template.');
    }

    const rows = buildTemplateRows();
    if (rows.length === 0) {
        return showMsg('sched-msg', `No subjects for ${section} in this term.`);
    }

    // Quote every cell — a title with a comma would shift every column
    // after it on re-import.
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [
        CSV_HEADERS.join(','),
        ...rows.map(r => CSV_HEADERS.map(h => esc(r[h])).join(',')),
    ].join('\n');

    const { year, term } = schedTerm();
    const name = `schedule-${section}-${year}-term${term}.csv`;

    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
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
    if (typeof XLSX === 'undefined') {
        throw new Error('The spreadsheet library did not load. Check your connection.');
    }

    const buf = await file.arrayBuffer();
    const wb  = XLSX.read(buf, { type: 'array', raw: false, cellDates: false });
    const ws  = wb.Sheets[wb.SheetNames[0]];

    if (!ws) throw new Error('The file has no readable sheet.');

    const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });
    if (rows.length === 0) throw new Error('The sheet is empty.');

    const mapped = rows.map((r, i) => {
        const out = { __line: i + 2 };
        for (const [k, v] of Object.entries(r)) {
            out[String(k).trim().toLowerCase().replace(/\s+/g, '_')] = String(v ?? '').trim();
        }
        return out;
    });

    // The template's guide row starts with "#" in the EDP column.
    // Drop it before anything else runs.
    const data = mapped.filter(r => !String(r.edp_code || '').startsWith('#'));

    if (data.length === 0) {
        throw new Error('The file has a header but no data rows.');
    }

    const required = ['edp_code', 'subject', 'type', 'section'];
    const missing  = required.filter(r => !(r in data[0]));
    if (missing.length) {
        throw new Error(
            `Missing column${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}. ` +
            'Expected headers: edp_code, subject, type, section, ' +
            'start_time, end_time, days, room, instructor.'
        );
    }

    return data;
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

    if (!res.ok) throw new Error(`The scanner returned ${res.status}.`);
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
            bad.push({ line: r.__line, why: 'EDP code is required.' });
            continue;
        }
        if (seenEdps.has(edp)) {
            bad.push({ line: r.__line, why: `EDP ${edp} appears more than once in this file.` });
            continue;
        }
        if (existingEdps.has(edp)) {
            bad.push({ line: r.__line, why: `EDP ${edp} is already assigned to another offering in this term.` });
            continue;
        }

        const subject = byCode.get(code);
        if (!subject) {
            bad.push({ line: r.__line, why: `${r.subject} is not in the prospectus.` });
            continue;
        }

        if (type !== 'LEC' && type !== 'LAB') {
            bad.push({ line: r.__line, why: `Type must be LEC or LAB (got "${r.type}").` });
            continue;
        }

        const hasLab = Number(subject.lab_units) > 0;
        if (type === 'LAB' && !hasLab) {
            bad.push({ line: r.__line, why: `${subject.code} has no laboratory units — it cannot have a LAB meeting.` });
            continue;
        }

        // A wholly empty row (no days, no time, no room) means the
        // section is not running that subject — treated as skipped,
        // matching how the physical form handles unoffered subjects.
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
            bad.push({ line: r.__line, why: `Missing ${missing.join(', ')}.` });
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

        ${bad.length ? `
            <div class="notice pending">
                <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
                <div>
                    <strong>${bad.length} row${bad.length === 1 ? '' : 's'} rejected</strong>
                    ${bad.map(b => `Line ${b.line}: ${escapeHtml(b.why)}`).join('<br>')}
                </div>
            </div>` : ''}

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
    // dropdowns to match the photo, then apply.
    $('[data-use-detected]')?.addEventListener('click', () => fillFromDetected(detected));
    $('[data-switch-apply]')?.addEventListener('click', () => switchAndApply(detected));
    $('[data-stay-apply]')?.addEventListener('click', applyUploadToPending);
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
   for the reload, then applies the previewed rows into that section's
   PENDING. Only reachable from the mismatch banner, where the operator
   has already seen both labels and chosen to switch.

   Order matters. reloadScheduleView() re-fetches offerings and rebuilds
   the section dropdowns; PENDING_ROWS is untouched across that, so the
   scan result survives the switch. Only after everything has settled do
   we call applyUploadToPending(). */
async function switchAndApply(detected) {
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

    applyUploadToPending();
}

/* Populates all four dropdowns from the scan's header, then applies the
   previewed rows. Used when nothing was selected before the scan — the
   photo becomes the source of truth.

   Order: set four dropdowns → reload offerings → set letter → apply.
   Same shape as switchAndApply, but there are no unsaved edits to lose
   when nothing was selected, so no confirm. */
async function fillFromDetected(detected) {
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

    applyUploadToPending();
}

/* ============================================================
   GRADE UPLOAD – Part A: File Reading + Validation
   ============================================================ */

let gradeState = {
    ready: false,
    rows: [],
    studentMap: null,
    subjectMap: null
};

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

function normCode(v) {
    return String(v ?? '').trim().replace(/\s/g, '').toUpperCase();
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
        .select('id, student_id, first_name, last_name')
        .not('student_id', 'is', null);
    gradeState.studentMap = new Map((data ?? []).map(s => [padStudentId(s.student_id), s]));
    return gradeState.studentMap;
}

async function loadSubjectMap() {
    if (gradeState.subjectMap) return gradeState.subjectMap;
    if (PREVIEW) {
        gradeState.subjectMap = new Map([
            ['CC-COMPROG12', { id: 'sub1', code: 'CC-COMPROG12', title: 'Computer Programming 2', units: 3 }],
            ['SOCIO101', { id: 'sub2', code: 'SOCIO101', title: 'Sociology', units: 3 }],
            ['RIZAL101', { id: 'sub3', code: 'RIZAL101', title: 'Rizal Course', units: 3 }],
        ]);
        return gradeState.subjectMap;
    }
    const { data } = await supabase
        .from('subject')
        .select('id, code, title, units')
        .eq('prospectus_id', PROSPECTUS?.id);
    gradeState.subjectMap = new Map((data ?? []).map(s => [normCode(s.code), s]));
    return gradeState.subjectMap;
}

async function readGradeFile(file) {
    if (typeof XLSX === 'undefined') {
        await new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
            s.onload = resolve;
            s.onerror = () => reject(new Error('SheetJS failed to load.'));
            document.head.appendChild(s);
        });
    }
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array', raw: false, cellDates: false });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) throw new Error('File has no readable sheet.');
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false, header: 1 });
    if (rows.length < 2) throw new Error('File is empty.');
    const headers = rows[0].map(h => String(h ?? '').trim().toLowerCase().replace(/\s+/g, '_'));
    const required = ['student_id', 'subject_code'];
    const missing = required.filter(r => !headers.includes(r));
    if (missing.length) throw new Error(`Missing columns: ${missing.join(', ')}`);
    return rows.slice(1)
        .filter(row => row.some(c => String(c ?? '').trim() !== ''))
        .map((row, i) => {
            const obj = { __line: i + 2 };
            headers.forEach((h, j) => { obj[h] = String(row[j] ?? '').trim(); });
            return obj;
        });
}

$('grade-file')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    showMsg('grade-msg', '');
    try {
        const rows = await readGradeFile(file);
        await validateGrades(rows, file.name);
    } catch (err) {
        showMsg('grade-msg', err.message);
    }
});

async function validateGrades(rows, fileName) {
    const students = await loadStudentMap();
    const subjects = await loadSubjectMap();

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

    for (const r of rows) {
        const rawId = r.student_id;
        const rawCode = r.subject_code;
        const rawGrade = r.grade;
        const rawStatus = (r.status || '').toUpperCase();

        const base = {
            line: r.__line,
            raw_student_id: rawId,
            raw_student_name: r.student_name || '',
            raw_subject_code: rawCode,
            raw_grade: rawGrade,
        };

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
        const subject = subjects.get(cleanCode);
        if (!subject) { bad.push({ ...base, why: `"${rawCode}" not in prospectus.` }); continue; }

        let points = null;
        let status = rawStatus;

        if (rawGrade !== '' && rawGrade !== '-') {
            points = parseFloat(rawGrade);
            if (!Number.isFinite(points) || points < 1 || points > 5) {
                bad.push({ ...base, why: `Grade "${rawGrade}" must be 1.0–5.0.` });
                continue;
            }
            points = Math.round(points * 100) / 100;
        }

        if (!status) {
            if (points === null) status = 'ENROLLED';
            else status = points <= passing ? 'PASSED' : 'FAILED';
        }

        if (!['PASSED','FAILED','ENROLLED','DROPPED'].includes(status)) {
            bad.push({ ...base, why: `Status "${status}" invalid.` });
            continue;
        }

        const parsedTerm = parseInt(r.term || term);
        const parsedYear = parseInt(r.academic_year || year);
        if (isNaN(parsedTerm) || parsedTerm < 1 || parsedTerm > 3) {
            bad.push({ ...base, why: `Term "${r.term}" must be 1, 2, or 3.` });
            continue;
        }
        if (isNaN(parsedYear) || parsedYear < 2000 || parsedYear > 2100) {
            bad.push({ ...base, why: `Year "${r.academic_year}" invalid.` });
            continue;
        }

        const expected = `${student.first_name} ${student.last_name}`.toLowerCase();
        const provided = base.raw_student_name.toLowerCase();
        let nameWarn = null;
        if (provided && !expected.includes(provided) && !provided.includes(expected)) {
            nameWarn = `Name mismatch: "${base.raw_student_name}" vs ${student.first_name} ${student.last_name}`;
        }

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

    gradeState.rows = ok;
    renderGradePreview(ok, bad, fileName, passing);
}

function renderGradePreview(ok, bad, fileName, passing) {
    const card = $('grade-preview-card');
    const box  = $('grade-preview');
    const note = $('grade-preview-note');
    if (!card || !box) return;

    card.hidden = false;
    if (note) note.textContent = fileName;

    const warned = ok.filter(r => r.name_warning);

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

    if (warned.length) {
        html += `
            <div class="notice pending">
                <i class="fa-solid fa-user-check"></i>
                <div>
                    <strong>${warned.length} name warning${warned.length > 1 ? 's' : ''}</strong>
                    ${warned.slice(0, 5).map(r =>
                        `<span class="dim">Line ${r.line}: ${r.name_warning}</span>`
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
            <h3 class="group-head">Ready to submit (${ok.length})</h3>
            <div class="table-wrap">
                <table class="data-table">
                    <thead><tr><th>ID</th><th>Name</th><th>Subject</th><th class="num">Grade</th><th>Status</th></tr></thead>
                    <tbody>${ok.slice(0, 15).map(r => `
                        <tr>
                            <td class="mono">${escapeHtml(r.student.student_id)}</td>
                            <td>${escapeHtml(r.student.first_name)} ${escapeHtml(r.student.last_name)}</td>
                            <td class="mono">${escapeHtml(r.subject.code)}</td>
                            <td class="num">${r.grade_points == null ? '—' : r.grade_points.toFixed(2)}</td>
                            <td><span class="pill ${r.status === 'PASSED' ? 'ok' : r.status === 'FAILED' ? 'bad' : r.status === 'DROPPED' ? 'waiting' : 'info'}">${r.status}</span></td>
                        </tr>
                    `).join('')}</tbody>
                </table>
                ${ok.length > 15 ? `<p class="dim">and ${ok.length - 15} more</p>` : ''}
            </div>

            <div class="preview-actions">
                <button class="btn-accent" id="commit-grades">
                    <i class="fa-solid fa-check" aria-hidden="true"></i>
                    <span>Submit ${ok.length} Grades</span>
                </button>
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

    const btn = $('commit-grades');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving…';
    }

    const period = String($('g-period')?.value || '');
    const [yearStr, termStr] = period.split('-');
    const year = Number(yearStr);
    const term = Number(termStr);

    if (PREVIEW) {
        $('grade-preview').innerHTML = '';
        const previewCard = $('grade-preview-card');
        if (previewCard) previewCard.hidden = true;
        $('grade-file').value = '';
        showMsg('grade-msg', `${gradeState.rows.length} grades submitted (preview).`, 'success');

        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-check"></i> Save records';
        }
        gradeState.rows = [];
        return;
    }

    try {
        const { data: file, error: fe } = await supabase
            .from('grade_file')
            .insert([{
                uploaded_by: STAFF_ID,
                file_name: fileName,
                status: 'processing',
                row_count: gradeState.rows.length + bad.length,
                matched_count: gradeState.rows.length,
                error_count: bad.length,
                passing_grade: passing,
                term: term,
                academic_year: year,
            }])
            .select()
            .single();

        if (fe) throw new Error('Audit failed: ' + fe.message);

        const rowPayload = [
            ...gradeState.rows.map(r => ({
                grade_file_id: file.id,
                row_number: r.line,
                raw_student_id: r.raw_student_id,
                raw_student_name: r.raw_student_name,
                raw_subject_code: r.raw_subject_code,
                raw_grade: r.raw_grade,
                student_id: r.student.id,
                subject_id: r.subject.id,
                grade_points: r.grade_points,
                status: r.status,
                term: r.term,
                academic_year: r.academic_year,
                validation_status: 'matched',
                error_message: r.name_warning,
            })),
            ...bad.map(b => ({
                grade_file_id: file.id,
                row_number: b.line,
                raw_student_id: b.raw_student_id,
                raw_student_name: b.raw_student_name,
                raw_subject_code: b.raw_subject_code,
                raw_grade: b.raw_grade,
                validation_status: 'rejected',
                error_message: b.why,
            })),
        ];

        await supabase.from('grade_file_row').insert(rowPayload);

        const records = gradeState.rows.map(r => ({
            student_id: r.student.id,
            subject_id: r.subject.id,
            grade: r.raw_grade || null,
            grade_points: r.grade_points,
            status: r.status,
            taken_term: r.term,
            taken_year: r.academic_year,
        }));

        const { error: re } = await supabase
            .from('academic_record')
            // Keyed on the attempt, not the subject. Re-uploading a
            // corrected grade for the same term updates that attempt; a
            // retake in a later term becomes a new row, so the earlier
            // failure stays on the transcript.
            .upsert(records, { onConflict: 'student_id,subject_id,taken_term,taken_year' });

        if (re) throw new Error('Record save failed: ' + re.message);

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

        await loadGradeHistory();

        let msg = `${records.length} grade${records.length === 1 ? '' : 's'} submitted.`;
        if (bad.length > 0) {
            msg += ` ${bad.length} row${bad.length === 1 ? '' : 's'} rejected.`;
        }
        showMsg('grade-msg', msg, 'success');

    } catch (err) {
        console.error('commit failed:', err);
        showMsg('grade-msg', err.message || 'An error occurred while saving.');
    } finally {
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
                            <td><span class="pill ${f.status === 'completed' ? 'ok' : f.status === 'failed' ? 'bad' : 'waiting'}">${f.status}</span></td>
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
        .select('id, user_id, first_name, last_name, employee_id, email, department, is_approved, avatar_url, created_at')
        .eq('user_id', AUTH_UID)
        .maybeSingle();

    if (error) console.warn('department staff load failed:', error.message);

    if (staff && staff.is_approved === false) {
        await supabase.auth.signOut();
        window.location.href = LOGIN_PAGE;
        return;
    }

    STAFF = staff;
    STAFF_ID = staff?.id ?? null;

    renderProfile(staff, session.user.email);
    fillProfileForm(staff);
    renderNotice(staff);

    await loadCurriculum();
    route();
})();

})();