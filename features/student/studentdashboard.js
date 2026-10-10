// studentdashboard.js
// Session guard, hash-routed views, read-only academic record.
//
// Eligibility stays empty until the prospectus is encoded. The academic
// record is read-only: grades arrive through the validated GradeFile
// upload performed by Department Staff, not student self-report.
// See db/013_enforce_erd_record_flow.sql.
//
// Requires config.js to be loaded first. In preview mode (?preview on
// localhost) also requires studentpreview.js loaded first — see the
// PREVIEW block below.

(function () {
'use strict';

const { SUPABASE_URL, SUPABASE_ANON_KEY, authStorageKey, authOptions } = window.CURRICULOGIC ?? {};

// Bucketed storage key (see config.js) -- keeps a student session in
// this tab from colliding with a different role signed in in another
// tab.
const supabase = (window.supabase && SUPABASE_URL && SUPABASE_ANON_KEY)
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: authOptions ? authOptions(['university_student']) : { storageKey: authStorageKey?.(['university_student']) },
    })
    : null;

const $ = (id) => document.getElementById(id);

const LOGIN_PAGE = '../auth/html/loginpage.html';

/* Session state, populated at boot. */
let AUTH_UID        = null;   // auth.users.id  == university_student.user_id
let STUDENT_ROW_ID  = null;   // university_student.id — the FK target
let STUDENT  = null;
let RECORDS  = [];
let PREVIEW  = false;

/* Knowledge base and the engine's verdict, loaded once per session. */
let KB     = null;
let RESULT = null;

/* The student's own preferences (time of day, load). They never change what
   the engine says a student MAY take; shared/engine/preferences.js applies
   them on top, as a visible step, to pick sections and trim the load. */
let PREFS        = { timeOfDay: null, load: null };
let PREF_STORAGE = 'browser';   // 'account' once student_preference is reachable

/* Set students curriculum to default prospectus if not set */
let ACTIVE_PROSPECTUS_ID = null;

/* The term the recommendation is for. These are fallback defaults only
   -- loadCurrentTermYear() below overwrites both from the new
   system_config table (shared/js/systemconfig.js) before either is
   ever read, so the topbar and this file can no longer drift out of
   sync with each other or with the actual scheduled term. */
let CURRENT_TERM   = 1;
let CURRENT_YEAR   = 2023;
const MAX_UNITS    = 24;   // fallback only; per-programme limits come from unitLimits()

/* The student's programme decides the caps (program.max_units etc.). */
function unitLimits(student) {
    return window.CurriculogicPrograms?.limitsOf(student?.program_id)
        ?? { maxUnits: MAX_UNITS, maxUnitsGraduating: 27, targetUnits: 176 };
}

/* Reads the live term/year once, at boot, before loadKB() or
   submitAdvisingRequest() ever consult CURRENT_TERM/CURRENT_YEAR.
   Falls back to the defaults above (rather than leaving them
   undefined) if systemconfig.js did not load or the query failed --
   an advising request should still be submittable, just possibly
   against a stale term, rather than crashing outright. */
async function loadCurrentTermYear() {
    const cfg = await window.CurriculogicTerm?.load?.();
    if (cfg?.term && cfg?.year) {
        CURRENT_TERM = cfg.term;
        CURRENT_YEAR = cfg.year;
    } else {
        console.warn('studentdashboard.js: could not load system_config, using fallback term/year.');
    }
}


/* preview mode (development only) */

const PREVIEW_HOSTS = ['localhost', '127.0.0.1', ''];

/* Fixture data lives in studentpreview.js (window.CL_PREVIEW) — real
   subject/rule ids from the live prospectus, built specifically so the
   engine has something to match against. This used to be a second,
   separate set of fixtures defined here with fake codes ("IT 111",
   "MATH 101") that do not exist in the actual subject table, which meant
   every assessment matched nothing. Read from CL_PREVIEW instead of
   duplicating it. */
const PREVIEW_STATES = {
    ready: window.CL_PREVIEW ? window.CL_PREVIEW.STUDENT : null,
    unverified: window.CL_PREVIEW
        ? { ...window.CL_PREVIEW.STUDENT, record_verified: false }
        : null,
    orphan: null,
};

const PREVIEW_EMAIL = window.CL_PREVIEW?.EMAIL ?? 'preview@example.com';

function previewStudent() {
    if (!PREVIEW_HOSTS.includes(window.location.hostname)) return undefined;
    const params = new URLSearchParams(window.location.search);
    if (!params.has('preview')) return undefined;
    const key = params.get('preview');
    return key in PREVIEW_STATES ? PREVIEW_STATES[key] : PREVIEW_STATES.ready;
}


/* view routing */

const VIEWS = {
    dashboard:   'Dashboard',
    prospectus:  'My prospectus',
    record:      'Academic record',
    plan:        'Build your plan',
    myrequests:  'My requests',
    'ask-ai':    'Ask AI',
    profile:     'Profile',
};

const shell = $('shell');

function currentView() {
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

    // Close the mobile drawer on navigation, or the new view is hidden
    // behind it on small screens.
    shell?.classList.remove('nav-open');

    // Views that fetch on first visit rather than at boot.
    if (name === 'prospectus')  loadProspectus();
    if (name === 'record')      loadRecords();
    if (name === 'ask-ai')      initChatIfNeeded();
    if (name === 'plan')        loadRequestPicker();
    if (name === 'myrequests')  loadRequestHistory();
    if (name === 'profile')     renderProfileExtras();
}

function route() {
    showView(currentView());
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

function ordinal(n) {
    const map = { 1: '1st Year', 2: '2nd Year', 3: '3rd Year', 4: '4th Year', 5: '5th Year' };
    return map[n] || null;
}

function termLabel(t) {
    return { 1: '1st Sem', 2: '2nd Sem', 3: 'Summer' }[t] || '—';
}

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

/* Message box helper, same shape as the one on the staff dashboards.
   An empty text means "clear the message" — do not apply a status
   class, or the box renders as a colored bar with no content. */
function showMsg(id, text, type = 'error') {
    const box = $(id);
    if (!box) return;
    box.textContent = text;
    box.className = text ? 'msg ' + type : 'msg';
}

/* The student's degree, looked up from their program_id. A student with no
   programme set reads "—", never somebody else's degree. Preview has no
   database, so it shows the sample programme its fixtures describe. */
const PREVIEW_PROGRAM = 'BS Information Technology';

function programName(student) {
    return window.CurriculogicPrograms?.nameOf(student?.program_id, PREVIEW ? PREVIEW_PROGRAM : '—')
        ?? '—';
}

function programCode(student) {
    return window.CurriculogicPrograms?.codeOf(student?.program_id, PREVIEW ? 'BSIT' : '')
        ?? '';
}

/* profile + dashboard render */

function renderProfile(student, authEmail) {
    const first = student?.first_name || '';
    const last  = student?.last_name  || '';
    const full  = [first, last].filter(Boolean).join(' ');
    const email = student?.email || authEmail || '—';

    PHOTO_INITIALS = initials(first, last, email);
    $('avatar').textContent    = PHOTO_INITIALS;
    $('user-name').textContent = full || email;
    $('user-sub').textContent  = student?.student_id || '';

    $('greeting').textContent = first ? `Welcome back, ${first}` : 'Welcome back';

    setText('d-name',  full || '—');
    setText('d-sid',   student?.student_id || 'Not yet assigned', 'mono');
    setText('d-email', email, 'mono');
    setText('d-year',  ordinal(student?.year_level) || 'Pending verification');
    setText('d-program', programName(student));
    setText('pros-program', programName(student));

    $('d-status').innerHTML = student?.is_approved
        ? '<span class="pill ok"><i class="fa-solid fa-check"></i> Approved</span>'
        : '<span class="pill waiting"><i class="fa-solid fa-clock"></i> Awaiting approval</span>';

    $('d-verified').innerHTML = student?.record_verified
        ? '<span class="pill ok"><i class="fa-solid fa-check"></i> Verified</span>'
        : '<span class="pill waiting"><i class="fa-solid fa-clock"></i> Pending with Registrar</span>';

    // Profile header: the same facts again, given a face.
    setText('prof-avatar', PHOTO_INITIALS);
    setText('prof-name', full || email);
    setText('prof-sub', [student?.student_id, programName(student), ordinal(student?.year_level)]
        .filter(Boolean).join(' · '));
}

/* Profile photo. Stored privately per account (db/064); everything the page
   needs is in shared/js/profilephoto.js. Preview has no storage, so a picture
   chosen there is only held in memory until the page is closed. */
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

$('photo-file')?.addEventListener('change', async (e) => {
    const input = e.target;
    const file = input.files?.[0];
    input.value = '';                      // choosing the same file again must still fire
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

/* The parts of Profile that need data beyond the student row: progress
   from the assessment already computed at boot, and the curriculum
   version's academic year (one small query, cached). Runs each time the
   view opens, so it reflects a plan approved since the page loaded. */
let CURRICULUM_LABEL = null;

async function renderProfileExtras() {
    renderProfileProgress();

    if (CURRICULUM_LABEL === null) {
        CURRICULUM_LABEL = '—';
        const pid = effectiveProspectusId(STUDENT);
        if (!PREVIEW && supabase && pid) {
            const { data } = await supabase
                .from('prospectus')
                .select('academic_year')
                .eq('id', pid)
                .maybeSingle();
            if (data?.academic_year) {
                const code = programCode(STUDENT);
                CURRICULUM_LABEL =
                    `${code ? code + ' prospectus' : 'Prospectus'}, AY ${data.academic_year}–${data.academic_year + 1}`;
            }
        } else if (PREVIEW) {
            CURRICULUM_LABEL = `${programCode(STUDENT)} prospectus, AY 2023–2024`;
        }
    }
    setText('d-curriculum', CURRICULUM_LABEL);
}

function renderProfileProgress() {
    const box = $('prof-progress');
    const note = $('prof-progress-note');
    if (!box) return;

    if (!RESULT) {
        if (note) note.textContent = '';
        box.innerHTML = `<p class="dim">Your progress will appear here once the
            Registrar has verified your record.</p>`;
        return;
    }

    const earned = Number(RESULT.facts.unitsEarned) || 0;
    const total  = Number(RESULT.totalUnits) || 0;
    const pct    = total > 0 ? Math.min(100, Math.round((earned / total) * 100)) : 0;

    if (note) note.textContent = `${pct}% complete`;

    // Counts come straight from the assessment: nothing here is a second
    // opinion on what the dashboard already says.
    const stat = (n, label) => `
        <div class="prof-stat"><strong>${n}</strong><span>${label}</span></div>`;

    box.innerHTML = `
        <div class="prof-bar-head">
            <span><strong>${earned}</strong> of ${total} units earned</span>
        </div>
        <div class="unit-meter" role="img" aria-label="${pct} percent of units earned">
            <div class="unit-meter-fill" style="width:${pct}%"></div>
        </div>
        <div class="prof-stats">
            ${stat(RESULT.facts.passedCount, 'Subjects passed')}
            ${stat(RESULT.inProgress.length, 'In progress')}
            ${stat(RESULT.eligible.length, 'Open to you now')}
            ${stat(RESULT.locked.length, 'Still locked')}
        </div>`;
}

/* Password change. Same steps as the Faculty and Registrar pages —
   re-authenticate with the current password (which also catches a
   mistyped one), then updateUser() — but inline on the page rather than
   in a modal. Unlike theirs it does not clear must_change_password:
   students have no UPDATE permission on their own row, so that write
   would fail; the flag is not read anywhere on this dashboard. */
$('prof-pw-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();

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

    const email = STUDENT?.email;
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

/* The prospectus to assess this student against. Their own if it was
   set at registration (a returnee stays on their original curriculum),
   otherwise whatever is currently active. Returns null only when
   neither exists — a fresh system with no versions at all. */
function effectiveProspectusId(student) {
    return student?.prospectus_id ?? ACTIVE_PROSPECTUS_ID;
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
                    Registrar confirms your record and uploads your subject history.
                </div>
            </div>`;
        return;
    }

    box.innerHTML = '';
}

/* Counts derived from the academic record. These are real numbers even
   with no curriculum encoded — completed subjects and units earned do not
   depend on the knowledge base. Eligible and locked do, and stay dashed. */
function renderStats() {
    const passed = RECORDS.filter(r => r.status === 'PASSED');
    const units  = passed.reduce((sum, r) => sum + Number(r.units || 0), 0);

    setText('stat-done',  String(passed.length), 'stat-value');
    setText('stat-units', String(units),         'stat-value');

    const hint = $('stat-eligible-hint');

    if (!RESULT) {
        setText('stat-eligible', '—', 'stat-value muted');
        setText('stat-locked',   '—', 'stat-value muted');
        if (hint) hint.textContent = 'Awaiting curriculum data';
        return;
    }

    setText('stat-eligible', String(RESULT.eligible.length), 'stat-value');
    setText('stat-locked',   String(RESULT.locked.length),   'stat-value');
    if (hint) hint.textContent = `${(personalised()?.recommended ?? RESULT.recommended).length} suggested this term`;
}

/* assess() output -> the grid's status map.
   A failed subject that is eligible again is a retake, not merely
   available — the distinction is what a student most needs to see. */
function statusMap(result, records) {
    const map = new Map();
    if (!result) return map;

    const graded = new Map();
    for (const r of records) {
        if (r.status === 'PASSED' && r.subject_id) graded.set(r.subject_id, r.grade);
    }

    for (const s of result.completed) {
        // An elective slot filled by a catalogue subject: say which one.
        map.set(s.id, s.filledBy
            ? { state: 'passed', detail: `Filled by ${s.filledBy.code}`,
                filledBy: { code: s.filledBy.code, title: s.filledBy.title } }
            : { state: 'passed', detail: graded.get(s.id) ? `Grade ${graded.get(s.id)}` : 'Passed' });
    }
    for (const s of result.inProgress) map.set(s.id, { state: 'enrolled', detail: 'Currently enrolled' });

    for (const e of result.eligible) {
        map.set(e.subject.id, {
            state: e.retake ? 'retake' : 'eligible',
            detail: e.retake ? 'Previously failed. Retake available.' : 'All requirements met.',
        });
    }

    for (const l of result.locked) {
        map.set(l.subject.id, {
            state: 'blocked',
            detail: l.unmet.map(u => u.detail).join(' '),
        });
    }

    // A subject already in a live request is no longer just "Can take".
    // Only eligible/retake rows are overridden: passed, enrolled and
    // locked subjects keep the status the engine gave them.
    for (const [id, lock] of SUBJECT_LOCKS.locked) {
        const cur = map.get(id);
        if (!cur || (cur.state !== 'eligible' && cur.state !== 'retake')) continue;
        map.set(id, {
            state: lock.itemStatus === 'approved' ? 'approved' : 'pending',
            detail: requestChipFor(id)?.label ?? 'In a request',
        });
    }

    return map;
}

/* eligibility */

async function loadKnowledgeBase(student) {
    if (KB) return KB;

    if (PREVIEW) {
        // The old preview branch returned an empty KB unconditionally,
        // which meant the engine always had zero subjects and zero rules
        // to reason over — every "if-then" check matched nothing. Use the
        // real fixture from studentpreview.js instead.
        KB = window.CL_PREVIEW?.KB ?? { subjects: [], rules: [], offerings: [] };
        return KB;
    }

    if (!supabase) return;

    const [subs, rules, offerings] = await Promise.all([
        supabase.from('subject')
            .select('id, code, title, units, year_level, term, is_elective, elective_type, is_active')
            .eq('prospectus_id', effectiveProspectusId(student)),
        supabase.from('prerequisite')
            .select('subject_id, prerequisite_subject_id, requirement_type, rule_type, rule_group, threshold_value'),
        supabase.from('subject_offering')
            .select('id, subject_id, section, meeting_type, schedule_days, start_time, end_time, room')
            .eq('academic_year', CURRENT_YEAR)
            .eq('term', CURRENT_TERM),
    ]);

    console.log('[kb] prospectus', student.prospectus_id,
                'subjects', subs.data?.length, subs.error?.message,
                'rules', rules.data?.length, rules.error?.message,
                'offerings', offerings.data?.length, offerings.error?.message);

    if (subs.error)  console.warn('subject load failed:', subs.error.message);
    if (rules.error) console.warn('rule load failed:', rules.error.message);

    KB = {
        subjects:  subs.data  ?? [],
        rules:     rules.data ?? [],
        /* An empty offering table means nothing has been scheduled yet.
           Treating that as "nothing is available" would show a student an
           empty recommendation for a reason they cannot see, so the engine
           is told to ignore availability until a schedule exists. */
        offerings: offerings.data ?? [],
    };

    return KB;
}

async function runAssessment(student) {
    if (!student || !student.record_verified) return null;

    // Preview is fully self-contained — loadKnowledgeBase() ignores the
    // prospectus id entirely and returns the CL_PREVIEW fixture — so it
    // should not bail just because the mock student has no real
    // prospectus_id and no live "active prospectus" was fetched.
    if (!PREVIEW) {
        const pid = effectiveProspectusId(student);
        if (!pid) {
            console.warn('no prospectus available — cannot assess');
            return null;
        }
    }

    const kb = await loadKnowledgeBase(student);

    return CurricuLogicEngine.assess(
        { id: STUDENT_ROW_ID, year_level: student.year_level },
        RECORDS,
        kb,
        { maxUnits: unitLimits(student).maxUnits, maxUnitsGraduating: unitLimits(student).maxUnitsGraduating, term: CURRENT_TERM, respectOfferings: kb.offerings.length > 0 },
    );
}

/* ---- preferences ---- */

const prefKey = () => `cl-pref-${STUDENT_ROW_ID ?? 'guest'}`;

function readLocalPrefs() {
    try {
        const raw = JSON.parse(localStorage.getItem(prefKey()) || 'null');
        return window.CurricuLogicPreferences.clean(raw);
    } catch { return window.CurricuLogicPreferences.clean(null); }
}

function writeLocalPrefs() {
    try { localStorage.setItem(prefKey(), JSON.stringify(PREFS)); } catch { /* private mode */ }
}

/* Account storage (db/037) when it exists, this browser otherwise. Either
   way the page works; the bar says which one it is. */
async function loadPreferences() {
    PREFS = readLocalPrefs();
    if (!supabase || !STUDENT_ROW_ID || PREVIEW) return;

    const { data, error } = await supabase
        .from('student_preference')
        .select('time_of_day, load')
        .eq('student_id', STUDENT_ROW_ID)
        .maybeSingle();

    if (error) {
        console.warn('preferences: account storage unavailable, using this browser:', error.message);
        PREF_STORAGE = 'browser';
        return;
    }
    PREF_STORAGE = 'account';
    if (data) {
        PREFS = window.CurricuLogicPreferences.clean({ timeOfDay: data.time_of_day, load: data.load });
        writeLocalPrefs();
    }
}

async function savePreferences() {
    writeLocalPrefs();
    if (PREF_STORAGE !== 'account' || !supabase || !STUDENT_ROW_ID) return;

    const { error } = await supabase.from('student_preference').upsert({
        student_id:  STUDENT_ROW_ID,
        time_of_day: PREFS.timeOfDay,
        load:        PREFS.load,
        updated_at:  new Date().toISOString(),
    }, { onConflict: 'student_id' });

    if (error) {
        console.warn('preferences: could not save to the account, kept in this browser:', error.message);
        PREF_STORAGE = 'browser';
    }
}

/* The engine's verdict with the student's preferences applied. Falls back
   to the plain verdict if the preference module is not there. */
function personalised() {
    if (!RESULT) return RESULT;
    return window.CurricuLogicPreferences
        ? window.CurricuLogicPreferences.apply(RESULT, PREFS)
        : RESULT;
}

/* Whether "See details" under the preference summary is open. It survives the
   re-render that every preference pick causes. */
let PREF_DETAILS_OPEN = false;

/* The short version of what the preferences did to the suggested load. The
   engine's own one-line-per-subject notes still go to Cura, unchanged. */
function prefNoteHtml(plan) {
    const P = window.CurricuLogicPreferences;
    const s = P?.summarize ? P.summarize(plan) : null;
    if (!s) return '';
    const hasAny = s.headline || s.leftOut || s.loadNotes.length;
    if (!hasAny) return '';

    return `
        <div class="pref-note">
            ${s.headline ? `<p><strong>${escapeHtml(s.headline)}</strong>${s.body ? ` ${escapeHtml(s.body)}` : ''}</p>` : ''}
            ${s.leftOut ? `<p>${escapeHtml(s.leftOut)}</p>` : ''}
            ${s.loadNotes.map(n => `<p>${escapeHtml(n)}</p>`).join('')}
            ${s.details.length ? `
            <button type="button" class="why-toggle ${PREF_DETAILS_OPEN ? 'is-open' : ''}" id="pref-details-toggle"
                    aria-expanded="${PREF_DETAILS_OPEN}" aria-controls="pref-details">
                <i class="fa-solid fa-chevron-right" aria-hidden="true"></i> See details
            </button>
            <ul class="pref-notes" id="pref-details" ${PREF_DETAILS_OPEN ? '' : 'hidden'}>
                ${s.details.map(d => `<li>${escapeHtml(d)}</li>`).join('')}
            </ul>` : ''}
        </div>`;
}

function renderPrefBar(plan) {
    const bar = $('pref-bar');
    if (!bar) return;
    bar.hidden = false;

    const cap = Number(RESULT.maxUnits) || 24;
    const L = window.CurricuLogicPreferences.LOAD_UNITS;
    const pressed = (kind, value) => (PREFS[kind] ?? (kind === 'load' ? 'full' : '')) === value;
    const choice = (kind, value, label) => `
        <button type="button" class="pref-choice" data-pref="${kind}" data-value="${value}"
                aria-pressed="${pressed(kind, value)}">${label}</button>`;

    bar.innerHTML = `
        <div class="pref-row">
            <span class="pref-label">Class time</span>
            <div class="pref-choices" role="group" aria-label="Preferred class time">
                ${choice('timeOfDay', '', 'Any time')}
                ${choice('timeOfDay', 'morning', 'Morning')}
                ${choice('timeOfDay', 'afternoon', 'Afternoon')}
                ${choice('timeOfDay', 'evening', 'Evening')}
            </div>
        </div>
        <div class="pref-row">
            <span class="pref-label">Load</span>
            <div class="pref-choices" role="group" aria-label="Preferred load">
                ${choice('load', 'full', `Full · up to ${cap} units`)}
                ${choice('load', 'regular', `Regular · up to ${Math.min(cap, L.regular)}`)}
                ${choice('load', 'light', `Light · up to ${Math.min(cap, L.light)}`)}
            </div>
        </div>
        ${prefNoteHtml(plan)}
        <span class="pref-hint">
            Preferences only choose between sections and how much to take.
            They never unlock a subject you are not eligible for.
            ${PREF_STORAGE === 'account' ? 'Saved to your account.' : 'Saved on this device only.'}
        </span>`;

    $('pref-details-toggle')?.addEventListener('click', (e) => {
        PREF_DETAILS_OPEN = !PREF_DETAILS_OPEN;
        e.currentTarget.classList.toggle('is-open', PREF_DETAILS_OPEN);
        e.currentTarget.setAttribute('aria-expanded', String(PREF_DETAILS_OPEN));
        $('pref-details').hidden = !PREF_DETAILS_OPEN;
    });

    bar.querySelectorAll('[data-pref]').forEach(b => b.addEventListener('click', async () => {
        const kind = b.dataset.pref;
        PREFS = { ...PREFS, [kind]: b.dataset.value === '' ? null : b.dataset.value };
        await savePreferences();
        renderEligibility(STUDENT);

        // If Cura is already open, give it the new picture (keeping the
        // conversation) so its next answer matches what the page now shows.
        if (chatInitialized) {
            const summary = summarizeForExplanation(personalised(), STUDENT?.first_name, { inRequestIds: [...SUBJECT_LOCKS.locked.keys()] });
            window.EligibilityChat?.updateSummary(summary);
            CHAT_SUMMARY = summary;
            renderChatContext(summary);
            showChatFollowUps(null);     // the questions follow the new picture too
        }
    }));
}

function renderEligibility(student) {
    const body = $('elig-body');
    const note = $('elig-note');
    const laterCard = $('elig-later-card');
    const prefBar = $('pref-bar');
    if (!body) return;
    if (laterCard) laterCard.hidden = true;
    if (prefBar) prefBar.hidden = true;

    if (!student || !student.record_verified) {
        if (note) note.textContent = '';
        body.innerHTML = `
            <div class="empty">
                <i class="fa-solid fa-hourglass-half" aria-hidden="true"></i>
                <h3>Nothing to show yet</h3>
                <p>
                    Once the Office of the Registrar verifies your record, this
                    panel will list what you can take and the specific requirement
                    behind anything you cannot.
                </p>
            </div>`;
        return;
    }

    if (!RESULT) {
        if (note) note.textContent = 'Awaiting curriculum data';
        body.innerHTML = `
            <div class="empty">
                <i class="fa-solid fa-diagram-project" aria-hidden="true"></i>
                <h3>Curriculum not yet available</h3>
                <p>
                    The prospectus has not been published yet. Subject eligibility
                    will appear here once it is.
                </p>
            </div>`;
        return;
    }

    const plan = personalised();
    const { recommended, recommendedUnits, maxUnits } = plan;
    const { eligible, locked } = RESULT;
    const alsoEligible = eligible.filter(e => !recommended.some(r => r.subject.id === e.subject.id));

    if (note) note.textContent = `${recommendedUnits} of ${maxUnits} units`;

    if (window.CurricuLogicPreferences) renderPrefBar(plan);
    body.innerHTML = renderRecommended(recommended, recommendedUnits, maxUnits);

    // What is not for this term lives in its own card below, folded.
    const later = $('elig-later');
    if (later && laterCard) {
        later.innerHTML = renderAlsoEligible(alsoEligible) + renderLocked(locked);
        laterCard.hidden = !later.innerHTML.trim();
        bindWhyToggles(later);

        later.querySelector('[data-show-all]')?.addEventListener('click', (e) => {
            later.querySelectorAll('.lock-row.is-extra').forEach(r => { r.hidden = false; });
            e.currentTarget.remove();
        });
    }
}

/* Where a subject already sitting in a request stands, in the student's
   words. Null when it is not in a live request. */
function requestChipFor(subjectId) {
    const lock = SUBJECT_LOCKS.locked.get(subjectId);
    if (!lock) return null;

    // The adviser's approval is final (shared/js/requeststatus.js).
    if (lock.itemStatus === 'approved') {
        return { chip: 'ok', label: 'Approved for enrollment' };
    }
    return { chip: 'open', label: 'In review with your adviser' };
}

/* One line of schedule for a suggested-load row: the first section, and a
   count if there are others. The plan builder is where a section is chosen. */
function scheduleLine(sections) {
    const groups = groupSections(sections);
    if (!groups.length) return '';
    const more = groups.length > 1
        ? ` · +${groups.length - 1} more section${groups.length > 2 ? 's' : ''}`
        : '';
    return fmtSection(groups[0]) + more;
}

function termRow(e) {
    const inRequest = requestChipFor(e.subject.id);
    const chip = inRequest
        ? `<span class="pg-chip ${inRequest.chip}">${escapeHtml(inRequest.label)}</span>`
        : (e.retake ? '<span class="pg-chip danger">Retake</span>' : '');
    // With a preference applied the section shown is the one it picked, and
    // the reason is stated; otherwise the first section, as before.
    const chosen = e.chosenSection
        ? fmtSection({ section: e.chosenSection.section, meetings: e.chosenSection.meetings })
        : '';
    const extraSections = e.chosenSection
        ? Math.max(0, groupSections(e.sections).length - 1)
        : 0;
    const when = chosen
        ? chosen + (extraSections ? ` · +${extraSections} more section${extraSections > 1 ? 's' : ''}` : '')
        : scheduleLine(e.sections);
    const prefReason = (PREFS.timeOfDay && e.preferenceReason) ? e.preferenceReason : '';
    // An open elective slot lists what it can be filled with.
    const opts = e.slotOptions ?? [];
    const optionsLine = opts.length
        ? `Options: ${opts.slice(0, 4).map(o => o.code).join(', ')}${opts.length > 4 ? ` +${opts.length - 4} more` : ''}`
        : '';
    // Recommended from the curriculum because nothing in this semester has
    // been scheduled yet: say so rather than imply a section exists.
    const pending = e.scheduleState === 'pending' && !when;

    return `
        <article class="term-row">
            <span class="term-code mono">${escapeHtml(e.subject.code)}</span>
            <div class="term-main">
                <span class="term-title">${escapeHtml(e.subject.title)}</span>
                <span class="term-why">${escapeHtml(e.reason)}</span>
                ${when ? `<span class="term-when"><i class="fa-regular fa-clock" aria-hidden="true"></i> ${escapeHtml(when)}</span>` : ''}
                ${pending ? `<span class="term-when"><i class="fa-regular fa-clock" aria-hidden="true"></i> Schedule not published yet</span>` : ''}
                ${prefReason && !pending ? `<span class="term-pref">${escapeHtml(prefReason)}</span>` : ''}
                ${optionsLine ? `<span class="term-pref">${escapeHtml(optionsLine)}</span>` : ''}
            </div>
            <div class="term-side">
                <span class="term-units">${escapeHtml(e.subject.units)} units</span>
                ${chip}
            </div>
        </article>`;
}

function renderRecommended(list, units, maxUnits) {
    if (list.length === 0) {
        return `
            <div class="empty">
                <i class="fa-solid fa-circle-check" aria-hidden="true"></i>
                <h3>Nothing to recommend</h3>
                <p>
                    There is no subject you can take right now. Anything still
                    outstanding is listed under Later in your degree.
                </p>
            </div>`;
    }

    // Subjects already in a request are part of the plan, not something
    // left to decide, so the load is split: units already in the plan, and
    // units still to plan. Counting them all as "suggested" made a plan
    // that was already approved look like unfinished work.
    const inPlan       = list.filter(e => requestChipFor(e.subject.id));
    const plannedUnits = inPlan.reduce((t, e) => t + (Number(e.subject.units) || 0), 0);
    const toPlanUnits  = Math.max(0, units - plannedUnits);
    const pctOf = (n) => maxUnits > 0 ? Math.min(100, Math.round((n / maxUnits) * 100)) : 0;

    const headline = inPlan.length
        ? `<strong>${plannedUnits}</strong> units in your plan${toPlanUnits ? ` · <strong>${toPlanUnits}</strong> still to plan` : ''}
           <span class="dim">(limit ${maxUnits})</span>`
        : `<strong>${units}</strong> of ${maxUnits} units suggested`;

    return `
        <div class="term-load">
            <div class="term-load-head">
                <span>${headline}</span>
                ${inPlan.length ? `<span class="dim">${inPlan.length} of ${list.length} subjects already in your plan</span>` : ''}
            </div>
            <div class="unit-meter is-split" role="img"
                 aria-label="${plannedUnits} units in your plan, ${toPlanUnits} still to plan, of ${maxUnits}">
                <div class="unit-meter-fill is-planned" style="width:${pctOf(plannedUnits)}%"></div>
                <div class="unit-meter-fill" style="width:${pctOf(toPlanUnits)}%"></div>
            </div>
        </div>
        <div class="term-list">${list.map(termRow).join('')}</div>`;
}

function renderAlsoEligible(list) {
    if (list.length === 0) return '';

    return `
        <details class="fold">
            <summary>Also open to you <span class="fold-n">${list.length}</span></summary>
            <p class="prose">
                You meet the requirements for these, but they did not fit within the
                unit limit or your load preference, are not being run this term, or
                have no schedule published yet.
            </p>
            <div class="table-wrap">
                <table class="data-table">
                    <thead><tr><th>Code</th><th>Descriptive title</th>
                               <th class="num">Units</th><th>Scheduled</th></tr></thead>
                    <tbody>${list.map(e => `
                        <tr>
                            <td class="mono">${escapeHtml(e.subject.code)}</td>
                            <td>${escapeHtml(e.subject.title)}</td>
                            <td class="num">${escapeHtml(e.subject.units)}</td>
                            <td>${e.scheduleState === 'offered'
                                ? '<span class="pill ok">Offered</span>'
                                : e.scheduleState === 'not-run'
                                    ? '<span class="pill waiting">Not this term</span>'
                                    : '<span class="pill waiting">Schedule pending</span>'}</td>
                        </tr>`).join('')}
                    </tbody>
                </table>
            </div>
        </details>`;
}

/* Every locked subject still carries its reasoning. A refusal without a
   reason is the situation this system replaces — a student turned away at
   the counter with no idea what to do about it. What changed is only how
   much of it is on screen at once: nearest first, the rest one click away. */
const LOCKED_VISIBLE = 8;

function renderLocked(list) {
    if (list.length === 0) return '';

    const sorted = [...list].sort((a, b) =>
        (a.termsAway ?? 99) - (b.termsAway ?? 99) ||
        a.subject.year_level - b.subject.year_level);

    const row = (e, i) => `
        <article class="lock-row${i >= LOCKED_VISIBLE ? ' is-extra' : ''}"${i >= LOCKED_VISIBLE ? ' hidden' : ''}>
            <div class="lock-line">
                <span class="term-code mono">${escapeHtml(e.subject.code)}</span>
                <span class="lock-title">${escapeHtml(e.subject.title)}</span>
                ${e.termsAway
                    ? `<span class="pill info">${e.termsAway} term${e.termsAway === 1 ? '' : 's'} away</span>`
                    : ''}
                <button class="why-toggle" data-why="${i}" aria-expanded="false">
                    <i class="fa-solid fa-chevron-right" aria-hidden="true"></i>
                    Why?
                </button>
            </div>
            <div class="why-body" id="why-${i}" hidden>
                <ul class="why-list">
                    ${CurricuLogicEngine.explain(e).map(line => {
                        const met = line.startsWith('✓');
                        return `<li class="why-line ${met ? 'is-met' : 'is-unmet'}">
                            ${escapeHtml(line.slice(2))}
                        </li>`;
                    }).join('')}
                </ul>
            </div>
        </article>`;

    const extra = sorted.length - LOCKED_VISIBLE;

    return `
        <details class="fold">
            <summary>Not yet available <span class="fold-n">${sorted.length}</span></summary>
            <p class="prose">Nearest to opening first. Open “Why?” to see exactly what is missing.</p>
            <div class="lock-list">${sorted.map(row).join('')}</div>
            ${extra > 0 ? `<button type="button" class="link-btn" data-show-all>Show all ${sorted.length}</button>` : ''}
        </details>`;
}

function renderSections(sections) {
    if (!sections || sections.length === 0) return '';

    return `
        <div class="subject-sections">
            ${sections.map(o => `
                <span class="section-chip">
                    <strong>${escapeHtml(o.section)}</strong>
                    ${escapeHtml(o.schedule_days || '')}
                    ${o.start_time ? escapeHtml(o.start_time.slice(0, 5)) : ''}
                    ${o.room ? '· ' + escapeHtml(o.room) : ''}
                </span>`).join('')}
        </div>`;
}

/* ---- section choice for the plan builder ----

   subject_offering holds one row per MEETING, so a section with a lecture
   and a lab is two rows sharing a section name. A student chooses a
   section, not a meeting: group by section name, and send the section's
   first meeting (lecture preferred) as the offering, since the request
   carries a single offeringId per subject. */

const { groupSections, parseDays, minutesOf, meetingsClash, formatClock: fmtClock } = window.ScheduleConflicts;

function fmtMeeting(m) {
    const kind = m.meeting_type && m.meeting_type !== 'LEC' ? `${m.meeting_type} ` : '';
    const span = m.start_time ? `${fmtClock(m.start_time)}–${fmtClock(m.end_time)}` : '';
    return [kind + (m.schedule_days || ''), span].filter(Boolean).join(' ');
}

function fmtSection(g) {
    return `${g.section} · ${g.meetings.map(fmtMeeting).join(' + ')}`;
}

function bindWhyToggles(scope) {
    scope.querySelectorAll('[data-why]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const panel = $(`why-${btn.dataset.why}`);
            const open = btn.getAttribute('aria-expanded') === 'true';
            btn.setAttribute('aria-expanded', String(!open));
            btn.classList.toggle('is-open', !open);
            panel.hidden = open;
        });
    });
}


/* academic record */

let recordsLoaded = false;

async function loadRecords(force = false) {
    if (recordsLoaded && !force) return;

    const body = $('record-body');
    if (!body) return;

    if (PREVIEW) {
        // Was PREVIEW_RECORDS — hand-typed rows keyed on fake subject
        // codes ("IT 111", "MATH 101") that don't exist in the real
        // subject table and carried no subject_id at all, so the engine
        // could never match them against a rule. CL_PREVIEW.RECORDS uses
        // real subject ids on purpose.
        RECORDS = window.CL_PREVIEW ? [...window.CL_PREVIEW.RECORDS] : [];
        recordsLoaded = true;
        renderRecords();
        renderStats();
        return;
    }

    if (!supabase || !STUDENT_ROW_ID) return;

    const { data, error } = await supabase
        .from('academic_record')
        .select('id, subject_id, grade, grade_points, status, taken_term, taken_year, subject:subject_id (code, title, units, year_level, term)')
        .eq('student_id', STUDENT_ROW_ID)
        .order('taken_year', { ascending: true })
        .order('taken_term', { ascending: true });

    if (error) {
        console.warn('record load failed:', error.message);
        body.innerHTML = `
            <div class="empty">
                <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
                <h3>Could not load your record</h3>
                <p>${escapeHtml(error.message)}</p>
            </div>`;
        return;
    }

    // academic_record identifies the subject by FK, not by text code. The
    // subject_code / subject_title / units columns added during the
    // self-report experiment are null on seeded and uploaded rows, so read
    // through the join and fall back to the text columns only if the FK is
    // unresolved.
    RECORDS = (data ?? []).map((r) => ({
        ...r,
        subject_code:  r.subject?.code  ?? r.subject_code  ?? '—',
        subject_title: r.subject?.title ?? r.subject_title ?? '—',
        units:         r.subject?.units ?? r.units         ?? 0,
    }));

    recordsLoaded = true;
    renderRecords();
    renderStats();
}

/* Grades are deliberately not shown to the student. CurricuLogic is an
   advising tool, not a records portal — the engine needs the grade to
   decide passed or failed, but a student reading this page needs the
   outcome, not the number. Showing marks would duplicate the university's
   own system and invite the question of which one is authoritative.
   Faculty and Registrar views keep grades: advising and verification are
   the cases where the actual mark matters. */
let RECORD_FILTER = 'all';

const RECORD_FILTERS = [
    ['all',      'All'],
    ['PASSED',   'Passed'],
    ['ENROLLED', 'In progress'],
    ['FAILED',   'Failed'],
    ['DROPPED',  'Dropped'],
];

function renderRecords() {
    const body  = $('record-body');
    const count = $('record-count');
    if (!body) return;

    const earned = RECORDS
        .filter(r => r.status === 'PASSED')
        .reduce((s, r) => s + Number(r.units || 0), 0);

    if (count) {
        count.textContent = RECORDS.length
            ? `${RECORDS.length} subject${RECORDS.length === 1 ? '' : 's'} · ${earned} units earned`
            : '';
    }

    if (RECORDS.length === 0) {
        body.innerHTML = `
            <div class="empty">
                <i class="fa-solid fa-file-circle-plus" aria-hidden="true"></i>
                <h3>Nothing recorded yet</h3>
                <p>
                    Subjects you have taken appear here once Department Staff
                    upload your grades each term. If you are a new student, this
                    is expected: your first term will be listed after it ends.
                </p>
            </div>`;
        return;
    }

    const counts = { all: RECORDS.length };
    for (const r of RECORDS) counts[r.status] = (counts[r.status] || 0) + 1;

    // Only offer a filter that has something behind it, so a student with
    // no failures is not shown a "Failed 0" button.
    const chips = RECORD_FILTERS
        .filter(([key]) => key === 'all' || counts[key])
        .map(([key, label]) => `
            <button type="button" class="rec-chip ${RECORD_FILTER === key ? 'is-active' : ''}"
                    data-rec-filter="${key}" aria-pressed="${RECORD_FILTER === key}">
                ${label} <span class="rec-chip-n">${counts[key] ?? 0}</span>
            </button>`).join('');

    // If the chosen filter no longer matches anything (a reload after the
    // last failure was cleared), fall back to All rather than show nothing.
    if (RECORD_FILTER !== 'all' && !counts[RECORD_FILTER]) RECORD_FILTER = 'all';

    const shown = RECORD_FILTER === 'all'
        ? RECORDS
        : RECORDS.filter(r => r.status === RECORD_FILTER);

    // Laid out like the degree itself: a header for each year, and under it
    // two panels side by side, the 1st semester on the left and the 2nd on the
    // right (a summer, if there is one, below them). Only years the student has
    // records in are shown. A subject the curriculum does not place in a year
    // (an elective, say) goes in a last section.
    const SEMESTER = { 1: '1st Semester', 2: '2nd Semester', 3: 'Summer' };

    const placement = (r) => {
        const year = Number(r.subject?.year_level ?? KB?.subjects?.find(s => s.id === r.subject_id)?.year_level);
        const term = Number(r.subject?.term ?? KB?.subjects?.find(s => s.id === r.subject_id)?.term);
        return { year: Number.isInteger(year) && year > 0 ? year : null, term: [1, 2, 3].includes(term) ? term : null };
    };

    const years = new Map();          // year level -> { 1: [], 2: [], 3: [] }
    const unplaced = [];
    for (const r of shown) {
        const { year, term } = placement(r);
        if (!year || !term) { unplaced.push(r); continue; }
        if (!years.has(year)) years.set(year, { 1: [], 2: [], 3: [] });
        years.get(year)[term].push(r);
    }

    const rowNote = (r) =>
        r.status === 'FAILED'   ? '<span class="rec-note bad">Retake required</span>' :
        r.status === 'ENROLLED' ? '<span class="rec-note">In progress</span>' : '';

    const earnedOf = (rows) => rows
        .filter(r => r.status === 'PASSED')
        .reduce((s, r) => s + Number(r.units || 0), 0);

    const countLine = (rows) => {
        const units = earnedOf(rows);
        return `${rows.length} subject${rows.length === 1 ? '' : 's'}${units ? ` \u00b7 ${units} units earned` : ''}`;
    };

    const panel = (title, rows) => `
        <section class="rec-panel">
            <header class="rec-panel-head">
                <h4>${escapeHtml(title)}</h4>
                <span class="dim">${rows.length ? escapeHtml(countLine(rows)) : ''}</span>
            </header>
            ${rows.length ? `
            <div class="table-wrap">
                <table class="data-table">
                    <thead>
                        <tr><th>Code</th><th>Descriptive title</th><th class="num">Units</th><th>Status</th></tr>
                    </thead>
                    <tbody>
                        ${[...rows].sort((a, b) => String(a.subject_code).localeCompare(String(b.subject_code))).map(r => `
                        <tr class="${r.status === 'FAILED' ? 'rec-row-failed' : ''}">
                            <td class="mono">${escapeHtml(r.subject_code)}</td>
                            <td>
                                ${escapeHtml(r.subject_title || '\u2014')}${rowNote(r)}
                                ${r.taken_year ? `<span class="rec-taken">Taken ${escapeHtml(termLabel(r.taken_term))} \u00b7 ${escapeHtml(r.taken_year)}</span>` : ''}
                            </td>
                            <td class="num">${escapeHtml(r.units)}</td>
                            <td><span class="pill ${statusClass(r.status)}">${statusLabel(r.status)}</span></td>
                        </tr>`).join('')}
                    </tbody>
                </table>
            </div>` : '<p class="rec-empty">Nothing recorded for this semester.</p>'}
        </section>`;

    const yearSection = ([year, terms]) => {
        const all = [...terms[1], ...terms[2], ...terms[3]];
        return `
        <section class="rec-year">
            <header class="rec-year-head">
                <h3>${escapeHtml(ordinal(year) ?? `Year ${year}`)}</h3>
                <span class="dim">${escapeHtml(countLine(all))}</span>
            </header>
            <div class="rec-split">
                ${panel(SEMESTER[1], terms[1])}
                ${panel(SEMESTER[2], terms[2])}
            </div>
            ${terms[3].length ? `<div class="rec-summer">${panel(SEMESTER[3], terms[3])}</div>` : ''}
        </section>`;
    };

    const orderedYears = [...years.entries()].sort((a, b) => a[0] - b[0]);

    body.innerHTML = `
        <div class="rec-filters" role="group" aria-label="Filter subjects by status">${chips}</div>
        ${orderedYears.map(yearSection).join('')}
        ${unplaced.length ? `
        <section class="rec-year">
            <header class="rec-year-head">
                <h3>Other subjects</h3>
                <span class="dim">${escapeHtml(countLine(unplaced))}</span>
            </header>
            <div class="rec-summer">${panel('Not placed in a year', unplaced)}</div>
        </section>` : ''}
        ${shown.length === 0 ? '<p class="rec-empty">No subjects match that filter.</p>' : ''}`;
}

$('record-body')?.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-rec-filter]');
    if (!chip) return;
    RECORD_FILTER = chip.dataset.recFilter;
    renderRecords();
});


function statusClass(s) {
    return { PASSED: 'ok', FAILED: 'bad', ENROLLED: 'info', DROPPED: 'waiting' }[s] || 'waiting';
}

function statusLabel(s) {
    // An unknown status is shown as it is, but as text: this goes into HTML.
    return { PASSED: 'Passed', FAILED: 'Failed', ENROLLED: 'Enrolled', DROPPED: 'Dropped' }[s] || escapeHtml(s);
}

/* Record entry was removed on 21 Aug to match the ERD: grades reach
   academic_record through the validated GradeFile upload performed by
   Department Staff, not through student self-report. The student view is
   read-only. See db/013_enforce_erd_record_flow.sql. */


/* prospectus */

let prospectusLoaded = false;
let prospectusSig = '';

/* What the grid's request statuses were drawn from. Comparing it lets a
   later visit redraw only when a request actually moved. */
function lockSignature() {
    return JSON.stringify([...SUBJECT_LOCKS.locked].map(([id, l]) =>
        [id, l.itemStatus, l.registrarStatus]));
}

async function loadProspectus() {
    const body = $('prospectus-body');
    const note = $('prospectus-note');
    if (!body) return;

    if (prospectusLoaded) {
        // The grid is built once, but a plan submitted or decided since
        // would leave its statuses stale. Re-check the requests (one
        // small query) and redraw only if something changed.
        if (PREVIEW || !supabase || !STUDENT_ROW_ID) return;
        await fetchMyRequests();
        SUBJECT_LOCKS = computeSubjectLocks(MY_REQUESTS);
        if (lockSignature() === prospectusSig) return;
    }

    prospectusLoaded = true;

    if (typeof window.ProspectusGrid === 'undefined') {
        console.error('prospectusgrid.js not loaded — check the script tag');
        return renderProspectusEmpty();
    }

    if (PREVIEW) {
        // ProspectusGrid normally queries Supabase directly for the
        // subject/rule rows it renders — it has no reason to duplicate the
        // fixture, since Faculty and Department dashboards never run in
        // preview. Pass the CL_PREVIEW knowledge base straight through as
        // `offline` data instead, so the grid renders from memory with no
        // live database involved.
        const kb = await loadKnowledgeBase(STUDENT);
        if (!kb.subjects.length) return renderProspectusEmpty();

        const result = await runAssessment(STUDENT);
        const sm = statusMap(result, RECORDS);

        if (note && result) {
            note.textContent =
                `${result.completed.length} passed · ${result.eligible.length} available`;
        }

        return window.ProspectusGrid.render(null, null, body, sm, kb);
    }

    const pid = effectiveProspectusId(STUDENT);
    if (!supabase || !pid) {
        return renderProspectusEmpty();
    }

    await fetchMyRequests();
    SUBJECT_LOCKS = computeSubjectLocks(MY_REQUESTS);
    prospectusSig = lockSignature();

    const result = await runAssessment(STUDENT);
    const sm = statusMap(result, RECORDS);

    if (note && result) {
        note.textContent =
            `${result.completed.length} passed · ${result.eligible.length} available`;
    }

    await window.ProspectusGrid.render(supabase, pid, body, sm);
}

function renderProspectusEmpty() {
    const body = $('prospectus-body');
    if (!body) return;
    body.innerHTML = `
        <div class="empty">
            <i class="fa-solid fa-diagram-project" aria-hidden="true"></i>
            <h3>Curriculum not yet available</h3>
            <p>
                The prospectus has not been published yet, or your account is
                not yet linked to one. Check back once the Office of the
                Registrar has finished verification.
            </p>
        </div>`;
}


/* Ask AI chat */

let chatInitialized = false;
let CHAT_SUMMARY = null;     // what Cura reads; the follow-up questions are built from it

async function initChatIfNeeded() {
    if (chatInitialized) return;
    if (!RESULT || typeof window.EligibilityChat === 'undefined') return;
    chatInitialized = true;

    // Uses the exact same RESULT the rest of the dashboard already
    // computed -- never a second, separate call to the engine. The
    // chat can only ever discuss what the real assessment already
    // decided.
    const summary = summarizeForExplanation(personalised(), STUDENT?.first_name, { inRequestIds: [...SUBJECT_LOCKS.locked.keys()] });
    CHAT_SUMMARY = summary;
    window.EligibilityChat.initEligibilityChat(summary);

    renderChatContext(summary);

    const priorMessages = (supabase && STUDENT_ROW_ID)
        ? await window.EligibilityChat.loadChatHistory(supabase, STUDENT_ROW_ID)
        : [];

    if (priorMessages.length) {
        // Any table shown is rebuilt from the current summary, same as a
        // live reply -- it reflects what's recommended now, not a snapshot
        // frozen at send time.
        for (const m of priorMessages) {
            appendChatMessage(
                m.role, m.text,
                m.show_recommended_table ? window.EligibilityChat.tableFor(summary) : null,
                m.show_schedule_table ? window.EligibilityChat.scheduleFor(summary, m.schedule_option ?? null) : null,
            );
        }
        // Pick the conversation up where it was left: questions that have not
        // been asked yet, shaped by the last answer.
        const last = priorMessages[priorMessages.length - 1];
        showChatFollowUps({ table: !!(last?.role === 'model' && last.show_recommended_table) });
    } else {
        showChatFollowUps(null);
    }
}

/* A line saying what Cura is looking at. Every number comes from the same
   summary the chat sends, so what the student reads here is exactly the
   ground the answers are built on. */
function renderChatContext(summary) {
    const box = $('chat-context');
    if (!box) return;

    box.innerHTML = `
        <i class="fa-solid fa-circle-info" aria-hidden="true"></i>
        <span>Cura is reading your record:
            <strong>${summary.unitsEarned}</strong> units earned ·
            <strong>${summary.recommended.length}</strong> subjects suggested
            (${summary.recommendedUnits} units) ·
            <strong>${summary.lockedCount}</strong> locked</span>`;
    box.hidden = false;
}

/* The questions offered under the chat: four to start with, then up to three
   after every answer, built from this student's own record by
   ai-assist/chatsuggestions.js. A question already asked is not offered
   again, and what was just answered shapes what comes next (after a plan
   table: "how do I send it to my adviser?"). They go away when none is left.
   `lastReply` is { table } for the answer just shown, null at the start. */
function showChatFollowUps(lastReply) {
    const box = $('chat-suggestions');
    if (!box) return;

    const asked = (window.EligibilityChat?.getChatHistory?.() ?? [])
        .filter(m => m.role === 'user')
        .map(m => m.text);

    const questions = window.CurriculogicChatSuggestions && CHAT_SUMMARY
        ? window.CurriculogicChatSuggestions.followUps({ summary: CHAT_SUMMARY, asked, lastReply, max: asked.length ? 3 : 4 })
        : [];

    box.innerHTML = questions.map(q =>
        `<button type="button" class="chat-chip" data-q="${escapeHtml(q)}">${escapeHtml(q)}</button>`
    ).join('');
    box.hidden = questions.length === 0;
}

function appendChatMessage(role, text, table, schedule, scheduleLayout) {
    const log = $('chat-log');
    if (!log) return null;

    const bubble = document.createElement('div');
    bubble.className = 'chat-msg chat-msg-' + role;

    if (role === 'pending') {
        // Three dots rather than the word "Thinking", so the wait reads
        // as activity, not as a message the assistant sent.
        bubble.innerHTML = '<span class="typing" aria-label="Cura is typing"><i></i><i></i><i></i></span>';
    } else {
        bubble.innerHTML = `<p>${escapeHtml(text)}</p>` + renderChatTable(table) + renderScheduleTable(schedule && { ...schedule, layout: scheduleLayout });
    }

    // The assistant gets its avatar; the student's own messages do not
    // need one. The returned node is the row, so callers can remove the
    // whole thing (avatar included) when a pending bubble is replaced.
    const row = document.createElement('div');
    row.className = 'chat-row chat-row-' + (role === 'user' ? 'user' : 'model');
    if (role !== 'user') {
        row.innerHTML = '<span class="chat-avatar" aria-hidden="true"><img src="../../assets/CurriculogicLogo.png" alt="" width="34" height="34"></span>';
    }
    row.appendChild(bubble);

    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
    return row;
}

/* Subject, section and when it meets, from shared/js/scheduletable.js. Everything
   shown comes from the student's real plan; text is escaped. */
function renderScheduleTable(schedule) {
    if (!schedule || (!schedule.rows?.length && !schedule.notInPlan?.length)) return '';

    const rows = (schedule.rows ?? []).map(r => `
        <tr>
            <td class="mono">${escapeHtml(r.code)}</td>
            <td>${escapeHtml(r.section ?? '—')}</td>
            <td>${r.meetings.length
                ? r.meetings.map(m => `<span class="sched-line${m.kind === 'LAB' ? ' is-lab' : ''}">${escapeHtml(m.text)}</span>`).join('')
                : '<span class="dim">No schedule yet</span>'}</td>
        </tr>`).join('');

    const left = (schedule.notInPlan ?? []).length
        ? `<p class="chat-notinplan"><strong>Not in your plan:</strong> ${schedule.notInPlan.map(n =>
            `${escapeHtml(n.code)} (${escapeHtml(n.reason)})`).join('; ')}.</p>`
        : '';

    const head = schedule.label
        ? `<p class="chat-notinplan"><strong>${escapeHtml(schedule.label)}</strong>${(schedule.changes ?? []).length
            ? ' — ' + (schedule.changes ?? []).map(escapeHtml).join('; ') : ''}.</p>`
        : '';

    // The same plan laid out by day, Monday first (shared/js/scheduletable.js). Both views are
    // drawn; the toggle only switches which one shows, so nothing is fetched or recomputed.
    const T = window.CurriculogicScheduleTable;
    const grouped = T?.byDay ? T.byDay(schedule.rows ?? []) : null;
    const dayRows = grouped ? grouped.days.map(d => `
        <tr>
            <th scope="row" class="sched-day">${escapeHtml(d.name)}</th>
            <td>${d.items.length
                ? d.items.map(i => `<span class="sched-line${i.kind === 'LAB' ? ' is-lab' : ''}"><span class="mono">${escapeHtml(i.code)}</span>${i.section ? ` <span class="dim">${escapeHtml(i.section)}</span>` : ''} &middot; ${escapeHtml(i.span || 'time not set')}${i.kind === 'LAB' ? ' (lab)' : ''}</span>`).join('')
                : '<span class="dim">No classes</span>'}</td>
        </tr>`).join('') : '';
    const noTime = grouped?.unscheduled.length
        ? `<p class="chat-notinplan"><strong>No meeting time yet:</strong> ${grouped.unscheduled.map(u => escapeHtml(u.code)).join(', ')}.</p>`
        : '';

    const layout = schedule.layout === 'byDay' && grouped ? 'byDay' : 'bySubject';
    const toggle = grouped
        ? `<div class="chat-sched-toggle" role="group" aria-label="Schedule layout">
            <button type="button" data-sched-layout="bySubject" aria-pressed="${layout === 'bySubject'}">By subject</button>
            <button type="button" data-sched-layout="byDay" aria-pressed="${layout === 'byDay'}">By day</button>
        </div>` : '';

    return `${head}${toggle}
        <div class="chat-sched" data-layout="${layout}">
            <table class="chat-table chat-schedule chat-sched-subject">
                <thead><tr><th>Code</th><th>Section</th><th>When</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
            <table class="chat-table chat-schedule chat-sched-day">
                <thead><tr><th>Day</th><th>Classes</th></tr></thead>
                <tbody>${dayRows}</tbody>
            </table>
            <div class="chat-sched-day">${noTime}</div>
        </div>${left}`;
}

/* The By subject / By day switch under a schedule table. */
document.addEventListener('click', (e) => {
    const btn = e.target.closest?.('[data-sched-layout]');
    if (!btn) return;
    const wrap = btn.closest('.chat-msg')?.querySelector('.chat-sched');
    if (!wrap) return;
    wrap.dataset.layout = btn.dataset.schedLayout;
    btn.parentElement.querySelectorAll('[data-sched-layout]').forEach(b =>
        b.setAttribute('aria-pressed', String(b === btn)));
});

function renderChatTable(entries) {
    if (!entries || !entries.length) return '';

    const totalUnits = entries.reduce((sum, e) => sum + (Number(e.units) || 0), 0);

    // Once a schedule is published the table also says which section and when each subject
    // meets; until then it stays as it was.
    const withTimes = entries.some(e => e.when);

    const rows = entries.map(e => `
        <tr>
            <td class="mono">${escapeHtml(e.code)}</td>
            <td>${escapeHtml(e.title)}</td>
            ${withTimes ? `<td>${e.when
                ? `${e.section ? `<span class="dim">${escapeHtml(e.section)}</span> ` : ''}${(e.meetings ?? []).map(m =>
                    `<span class="sched-line${m.kind === 'LAB' ? ' is-lab' : ''}">${escapeHtml(m.text)}</span>`).join('')}`
                : '<span class="dim">No schedule yet</span>'}</td>` : ''}
            <td class="n">${e.units ?? ''}</td>
            <td>${e.retake ? 'Retake' : ''}</td>
        </tr>`).join('');

    return `
        <table class="chat-table">
            <thead>
                <tr><th>Code</th><th>Title</th>${withTimes ? '<th>When</th>' : ''}<th class="n">Units</th><th></th></tr>
            </thead>
            <tbody>${rows}</tbody>
            <tfoot>
                <tr><td colspan="${withTimes ? 3 : 2}">Total</td><td class="n">${totalUnits}</td><td></td></tr>
            </tfoot>
        </table>`;
}

$('chat-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const input = $('chat-input');
    const text = input?.value.trim();
    if (!text || !supabase) return;

    appendChatMessage('user', text);
    input.value = '';

    // The suggestions step aside while Cura answers; fresh ones follow the reply.
    const suggestions = $('chat-suggestions');
    if (suggestions) suggestions.hidden = true;

    const sendBtn = $('chat-send');
    if (sendBtn) sendBtn.disabled = true;
    input.disabled = true;

    const pending = appendChatMessage('pending', 'Thinking…');

    try {
        const result = await window.EligibilityChat.sendChatMessage(supabase, text);
        pending?.remove();
        appendChatMessage('model', result.text, result.table, result.schedule, result.scheduleLayout);
        showChatFollowUps({ table: !!result.table?.length });
    } catch (err) {
        console.warn('chat send failed:', err);
        pending?.remove();
        appendChatMessage('model', 'Sorry, I could not reach the assistant just now. Please try again.');
        showChatFollowUps(null);
    } finally {
        if (sendBtn) sendBtn.disabled = false;
        input.disabled = false;
        input.focus();
    }
});

$('chat-suggestions')?.addEventListener('click', (e) => {
    const chip = e.target.closest('.chat-chip');
    if (!chip) return;

    const input = $('chat-input');
    if (!input || input.disabled) return;

    input.value = chip.dataset.q;
    $('chat-form')?.requestSubmit();
});

/* Advising requests */

let SELECTED_SUBJECT_IDS = new Set();
let SELECTED_SECTIONS = new Map();   // subjectId -> section name, where the student chose
let requestsInitialized = false;

/* The section the student is signed up for on a subject: their choice,
   else the first one offered. Null when nothing is scheduled. */
function chosenSection(entry) {
    const groups = groupSections(entry?.sections);
    if (!groups.length) return null;
    // The student's own pick, else the section the planner chose (so the default
    // selection is already clash-free), else the first one offered.
    return groups.find(g => g.section === SELECTED_SECTIONS.get(entry.subject.id))
        ?? groups.find(g => g.section === entry.chosenSection?.section)
        ?? groups[0];
}

/* All of the student's own requests, fetched once per Build-Your-Plan
   or My-Requests visit and shared by both -- one query, two consumers,
   so the picker's exclusions and the status page's history can never
   disagree about what state a subject is actually in. */
let MY_REQUESTS = [];
let SUBJECT_LOCKS = { locked: new Map(), resubmittable: new Map() };

async function fetchMyRequests() {
    if (PREVIEW) {
        // Sample requests only when the preview is opened with ?requests
        MY_REQUESTS = window.CL_PREVIEW?.REQUESTS ?? [];
        return MY_REQUESTS;
    }
    if (!supabase || !STUDENT_ROW_ID) {
        MY_REQUESTS = [];
        return MY_REQUESTS;
    }

    const { data, error } = await supabase
        .from('request')
        .select(`
            id, status, registrar_status, registrar_notes,
            requested_term, requested_year, created_at,
            request_item(id, subject_id, status, remarks, offering_id, subject:subject_id(code, title, units))
        `)
        .eq('student_id', STUDENT_ROW_ID)
        .order('created_at', { ascending: false });

    if (error) {
        console.warn('fetchMyRequests failed:', error.message);
        MY_REQUESTS = [];
        return MY_REQUESTS;
    }

    MY_REQUESTS = data ?? [];
    return MY_REQUESTS;
}

/* The actual root-cause fix. The old picker only asked the engine "is
   this subject eligible right now" -- it never asked "do I already have
   an outstanding request for it." Since assess() only reads
   academic_record (passed/failed/enrolled), a submitted-but-not-yet-
   graded subject stays "eligible" forever and kept reappearing every
   time the picker re-rendered after a successful submit.

   For each subject, only the MOST RECENT request that touched it
   matters (requests are already sorted newest-first) -- an old
   rejected attempt must not re-unlock a subject that has since been
   resubmitted and is once again mid-flight.

   A subject lands in exactly one of two buckets:
     - locked: still awaiting the adviser, or approved by them (done: the
       adviser's approval is final). Neither is pickable again right now --
       hidden from Build Your Plan entirely.
     - resubmittable: Faculty rejected this specific subject, OR the
       Registrar sent the whole plan back (regardless of what this
       item's own status was) -- shown in the picker again, flagged
       with the reason, since the architecture's only path to "fix and
       resend" is a brand new submission (submit-advising-request only
       ever INSERTs; there is no edit-in-place). */
function computeSubjectLocks(myRequests) {
    const latestBySubject = new Map();

    for (const req of myRequests) {
        for (const item of req.request_item ?? []) {
            if (latestBySubject.has(item.subject_id)) continue;
            latestBySubject.set(item.subject_id, { req, item });
        }
    }

    const locked = new Map();
    const resubmittable = new Map();

    for (const [subjectId, { req, item }] of latestBySubject) {
        const wholePlanSentBack = req.registrar_status === 'rejected';
        const facultyRejectedItem = item.status === 'rejected';

        if (wholePlanSentBack) {
            resubmittable.set(subjectId,
                req.registrar_notes || 'Sent back by the Registrar.');
        } else if (facultyRejectedItem) {
            resubmittable.set(subjectId,
                item.remarks || 'Rejected by your adviser.');
        } else {
            locked.set(subjectId, {
                requestStatus: req.status,
                itemStatus: item.status,
                registrarStatus: req.registrar_status,
            });
        }
    }

    return { locked, resubmittable };
}

/* Shared by the picker, the count/unit display, and submission itself
   -- these three used to each recompute recommended+eligible
   separately (three chances to drift out of sync). Now there is one
   source of truth, filtered down to what's actually pickable. */
function pickerCandidates() {
    // The planned suggestion: sections already chosen so that nothing clashes.
    const recommended = personalised()?.recommended ?? [];
    const alsoEligible = (RESULT?.eligible ?? [])
        .filter(e => !recommended.some(r => r.subject.id === e.subject.id));
    const all = [...recommended, ...alsoEligible];

    // Only what can really be enrolled in this semester: eligible alone is not enough
    // (the department may not run it, or it belongs to the other semester).
    return all.filter(entry => entry.availableThisTerm !== false
        && !SUBJECT_LOCKS.locked.has(entry.subject.id));
}

/* Built from the same RESULT the rest of the dashboard already
   computed -- students choose from their real eligible/recommended
   list, never a separate, hand-typed set. The actual valid/flagged
   verdict on submission still comes from the server-side engine run
   in submit-advising-request -- this picker only decides what gets
   sent, not whether it will be accepted. */
async function loadRequestPicker() {
    const picker = $('req-picker');
    if (!picker) return;

    if ($('auto-plan')) $('auto-plan').hidden = true;      // shown below, once there is something to select

    if (!RESULT) {
        picker.innerHTML = '<p class="dim">Your eligibility has not loaded yet.</p>';
        return;
    }

    await fetchMyRequests();
    SUBJECT_LOCKS = computeSubjectLocks(MY_REQUESTS);

    const candidates = pickerCandidates();

    if (!candidates.length) {
        const hasLocked = SUBJECT_LOCKS.locked.size > 0;
        picker.innerHTML = hasLocked
            ? `<p class="dim">
                 Nothing new to request right now -- everything eligible is
                 already part of a request awaiting a decision. Check
                 <a href="#myrequests">My requests</a> for status.
               </p>`
            : '<p class="dim">Nothing is currently eligible to request.</p>';
        return;
    }

    // SELECTED_SUBJECT_IDS never carries a subject that just became
    // locked (e.g. it was checked, then a page refresh picked up a
    // decision made elsewhere) -- drop anything no longer pickable
    // before rendering, so a stale selection can't be submitted.
    for (const id of [...SELECTED_SUBJECT_IDS]) {
        if (!candidates.some(c => c.subject.id === id)) SELECTED_SUBJECT_IDS.delete(id);
    }

    // The engine's own picks come first, with the reason it gave. The rest
    // of the eligible list is still choosable, just not vouched for.
    const suggestedIds = new Set((personalised()?.recommended ?? []).map(r => r.subject.id));
    const suggested = candidates.filter(c => suggestedIds.has(c.subject.id));
    const others    = candidates.filter(c => !suggestedIds.has(c.subject.id));

    const renderSchedule = (entry) => {
        const groups = groupSections(entry.sections);
        if (!groups.length) {
            return '<span class="req-sched is-none">No schedule posted yet</span>';
        }
        // One section: state it. Several: let the student choose.
        if (groups.length === 1) {
            return `<span class="req-sched">${escapeHtml(fmtSection(groups[0]))}</span>`;
        }
        // The section that will actually be sent: the student's pick, else the
        // planner's, else the first. (It used to show the first section even when
        // the planner had chosen another, so the box and the submission disagreed.)
        const chosen = chosenSection(entry)?.section ?? groups[0].section;
        return `
            <select class="req-section-pick" data-section-for="${entry.subject.id}"
                    aria-label="Section for ${escapeHtml(entry.subject.code)}">
                ${groups.map(g => `
                    <option value="${escapeHtml(g.section)}" ${g.section === chosen ? 'selected' : ''}>
                        ${escapeHtml(fmtSection(g))}
                    </option>`).join('')}
            </select>`;
    };

    const renderRow = (entry) => {
        const s = entry.subject;
        const rejected = SUBJECT_LOCKS.resubmittable.get(s.id);
        const why = suggestedIds.has(s.id) ? entry.reason : '';
        return `
            <label class="req-row" data-row-for="${s.id}">
                <input type="checkbox" data-subject-id="${s.id}"
                    ${SELECTED_SUBJECT_IDS.has(s.id) ? 'checked' : ''}>
                <span class="req-code">${escapeHtml(s.code)}</span>
                <span class="req-main">
                    <span class="req-title">${escapeHtml(s.title)}</span>
                    ${why ? `<span class="req-why">${escapeHtml(why)}</span>` : ''}
                    ${rejected ? `<span class="req-reject-reason">Sent back: ${escapeHtml(rejected)}</span>` : ''}
                    ${renderSchedule(entry)}
                    <span class="req-clash" hidden></span>
                </span>
                <span class="req-units">${s.units ?? ''} units</span>
                ${entry.retake ? '<span class="pg-chip danger">Retake</span>' : ''}
                ${rejected ? `<span class="pg-chip danger">Previously rejected</span>` : ''}
            </label>`;
    };

    const suggestedUnits = suggested
        .reduce((t, c) => t + (Number(c.subject.units) || 0), 0);

    picker.innerHTML = [
        suggested.length ? `
            <div class="req-group-head">
                <span><strong>Suggested for you</strong>
                    <span class="dim"> · ${suggested.length} subject${suggested.length === 1 ? '' : 's'}, ${suggestedUnits} units</span></span>
                <button type="button" class="link-btn" data-select-suggested>Select all suggested</button>
            </div>
            ${suggested.map(renderRow).join('')}` : '',
        others.length ? `
            <div class="req-group-head">
                <span><strong>${suggested.length ? 'Also eligible' : 'Eligible'}</strong>
                    <span class="dim"> · you can add these, but they are not part of your suggested load</span></span>
            </div>
            ${others.map(renderRow).join('')}` : '',
    ].join('');

    if (!requestsInitialized) {
        picker.addEventListener('change', (e) => {
            const pick = e.target.closest('select[data-section-for]');
            if (pick) {
                SELECTED_SECTIONS.set(Number(pick.dataset.sectionFor), pick.value);
                updateRequestCount();
                return;
            }

            const box = e.target.closest('input[type="checkbox"]');
            if (!box) return;

            const id = Number(box.dataset.subjectId);
            if (box.checked) SELECTED_SUBJECT_IDS.add(id);
            else SELECTED_SUBJECT_IDS.delete(id);

            updateRequestCount();
        });

        picker.addEventListener('click', (e) => {
            if (!e.target.closest('[data-select-suggested]')) return;

            // Only the rows in the suggested group, not everything on screen.
            const head = e.target.closest('.req-group-head');
            for (let el = head?.nextElementSibling; el && !el.classList.contains('req-group-head'); el = el.nextElementSibling) {
                const box = el.querySelector?.('input[type="checkbox"]');
                if (!box) continue;
                box.checked = true;
                SELECTED_SUBJECT_IDS.add(Number(box.dataset.subjectId));
            }
            updateRequestCount();
        });

        $('req-submit')?.addEventListener('click', submitAdvisingRequest);
        $('auto-plan-btn')?.addEventListener('click', runAutoPlan);
        requestsInitialized = true;
    }

    // The button is offered only when the engine suggests something to select.
    if ($('auto-plan')) {
        $('auto-plan').hidden = suggested.length === 0;
        if ($('auto-plan-result')) $('auto-plan-result').hidden = true;
    }

    updateRequestCount();
}

/* ---- Auto-select my plan ----
   shared/js/autoplan.js does the choosing and the checking; this only feeds it
   what is on screen and shows the result. The checkboxes and section boxes are
   the same ones the student could have used by hand, so everything stays
   editable, and nothing is sent until Submit for review is pressed. */
let autoPlanBusy = false;

async function runAutoPlan() {
    if (!window.CurriculogicAutoPlan || !window.ScheduleConflicts) return;
    if (autoPlanBusy) return;
    autoPlanBusy = true;

    // A short "scanning" screen so the tap visibly does something; the choosing
    // itself is instant. Skipped down to a blink when motion is reduced.
    const btn = $('auto-plan-btn');
    const box = $('auto-plan-result');
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (btn) btn.disabled = true;
    if (box) {
        box.className = 'auto-plan-result is-scanning';
        box.innerHTML = '<span class="auto-plan-spinner" aria-hidden="true"></span><p>Scanning, please wait…</p>';
        box.hidden = false;
    }
    await new Promise(r => setTimeout(r, reduce ? 250 : 1600));
    if (btn) btn.disabled = false;
    autoPlanBusy = false;

    const suggestedIds = new Set((personalised()?.recommended ?? []).map(r => r.subject.id));
    const cap = RESULT?.availableUnits ?? unitLimits(STUDENT).maxUnits;

    const plan = window.CurriculogicAutoPlan.buildAutoPlan({
        entries: pickerCandidates(),
        suggestedIds,
        cap,
        conflicts: window.ScheduleConflicts,
    });

    // The plan replaces whatever was picked before.
    SELECTED_SUBJECT_IDS.clear();
    for (const p of plan.picks) {
        SELECTED_SUBJECT_IDS.add(p.subjectId);
        if (p.section) SELECTED_SECTIONS.set(p.subjectId, p.section);
    }

    // Show it in the boxes the student already knows.
    document.querySelectorAll('#req-picker input[type="checkbox"][data-subject-id]').forEach(box => {
        box.checked = SELECTED_SUBJECT_IDS.has(Number(box.dataset.subjectId));
    });
    document.querySelectorAll('#req-picker select[data-section-for]').forEach(sel => {
        const section = SELECTED_SECTIONS.get(Number(sel.dataset.sectionFor));
        if (section) sel.value = section;
    });
    updateRequestCount();
    renderAutoPlanResult(plan);

    // Ready to read and submit.
    if (plan.picks.length) $('req-submit')?.focus({ preventScroll: false });
}

function renderAutoPlanResult(plan) {
    const box = $('auto-plan-result');
    if (!box) return;

    const left = plan.skipped.length ? `
        <p class="auto-plan-left-head">Left out</p>
        <ul class="auto-plan-left">${plan.skipped.map(s =>
            `<li><strong>${escapeHtml(s.code)}</strong> ${escapeHtml(s.reason)}</li>`).join('')}</ul>` : '';

    box.className = 'auto-plan-result ' + (plan.picks.length ? 'is-ok' : 'is-none');
    box.innerHTML = `<p>${escapeHtml(window.CurriculogicAutoPlan.summarize(plan))}</p>${left}`;
    box.hidden = false;
}

function updateRequestCount() {
    const count = SELECTED_SUBJECT_IDS.size;
    const label = $('req-count');
    const btn = $('req-submit');

    // Same filtered candidate list the picker rendered -- never a
    // separate lookup, so this can never disagree with what's checked.
    const candidates = pickerCandidates();
    const units = candidates
        .filter(entry => SELECTED_SUBJECT_IDS.has(entry.subject.id))
        .reduce((sum, entry) => sum + (Number(entry.subject.units) || 0), 0);

    // The engine works out the cap for this student (24, or 27 in the
    // final stretch) net of units already being carried.
    const cap = RESULT?.availableUnits ?? unitLimits(STUDENT).maxUnits;
    const overCap = units > cap;

    if (label) {
        label.textContent = count
            ? `${count} subject${count === 1 ? '' : 's'} selected · ${units} of ${cap} units`
            : `Nothing selected yet · up to ${cap} units this term`;
        label.classList.toggle('over-cap', overCap);
    }

    const clashes = markScheduleClashes(candidates);

    const meter = $('req-meter');
    if (meter) {
        meter.style.width = (cap > 0 ? Math.min(100, (units / cap) * 100) : 0) + '%';
        meter.classList.toggle('over-cap', overCap);
    }
    // One banner for both warnings. A clash warns but does not block:
    // the unit cap is a hard rule, a timetable overlap is the student's
    // call (and Faculty can still see it), so only the cap disables Submit.
    const box = $('req-msg');
    if (overCap) {
        showMsg('req-msg', `That is ${units - cap} unit${units - cap === 1 ? '' : 's'} over your ${cap}-unit limit for this term. Deselect a subject to submit.`);
    } else if (clashes > 0) {
        showMsg('req-msg', `${clashes} schedule clash${clashes === 1 ? '' : 'es'} in your picks. Choose a different section, or check with your adviser.`);
    } else if (box?.dataset.planMsg) {
        showMsg('req-msg', '');
    }
    if (box) box.dataset.planMsg = (overCap || clashes > 0) ? '1' : '';
    if (btn) btn.disabled = count === 0 || overCap;
}

/* Marks each selected subject that overlaps another selected one, and
   returns how many pairs clash. Reads the DOM rows the picker rendered,
   so it needs no state of its own. */
function markScheduleClashes(candidates) {
    const picked = candidates
        .filter(c => SELECTED_SUBJECT_IDS.has(c.subject.id))
        .map(c => ({ entry: c, section: chosenSection(c) }))
        .filter(p => p.section);

    const clashWith = new Map();   // subjectId -> [codes it overlaps]
    let pairs = 0;

    for (let i = 0; i < picked.length; i++) {
        for (let j = i + 1; j < picked.length; j++) {
            const overlap = picked[i].section.meetings.some(a =>
                picked[j].section.meetings.some(b => meetingsClash(a, b)));
            if (!overlap) continue;

            pairs++;
            for (const [x, y] of [[picked[i], picked[j]], [picked[j], picked[i]]]) {
                const id = x.entry.subject.id;
                if (!clashWith.has(id)) clashWith.set(id, []);
                clashWith.get(id).push(y.entry.subject.code);
            }
        }
    }

    document.querySelectorAll('#req-picker [data-row-for]').forEach(row => {
        const id = Number(row.dataset.rowFor);
        const note = row.querySelector('.req-clash');
        const hit = clashWith.get(id);
        row.classList.toggle('has-clash', !!hit);
        if (!note) return;
        note.hidden = !hit;
        note.textContent = hit ? `Overlaps with ${hit.join(', ')}` : '';
    });

    return pairs;
}

async function submitAdvisingRequest() {
    if (!SELECTED_SUBJECT_IDS.size || !supabase) return;

    const btn = $('req-submit');
    if (btn) { btn.disabled = true; btn.textContent = 'Submitting…'; }

    // The live submit-advising-request function reads `items` (objects
    // with subjectId/offeringId) plus `term`/`year` -- it does NOT read
    // a flat `subjectIds` array. Sending the wrong shape doesn't error
    // loudly; the function's own `Array.isArray(selections)` guard just
    // sees undefined and returns "Select at least one subject." for
    // every submission, no matter what was actually checked. Built from
    // the same filtered candidates the picker rendered, so the offering
    // sent always matches what was shown on screen, and a locked
    // subject can never be included even from a stale selection.
    const candidates = pickerCandidates();

    const items = [...SELECTED_SUBJECT_IDS]
        .filter(id => candidates.some(c => c.subject.id === id))
        .map(subjectId => {
            const entry = candidates.find(c => c.subject.id === subjectId);
            // The offering sent is the section the student chose in the
            // picker (the first one if only one exists). A subject with no
            // offering this term goes through with offeringId: null -- the
            // server accepts that; Faculty just sees no schedule attached
            // and would need to follow up.
            return { subjectId, offeringId: chosenSection(entry)?.offeringId ?? null };
        });

    if (!items.length) {
        // Everything checked became locked between render and click --
        // someone else (another tab, a decision made elsewhere) moved
        // faster than this page. Refresh rather than send an empty
        // request the server would just reject anyway.
        showMsg('req-msg', 'Those subjects are no longer available to request. Refreshing…');
        SELECTED_SUBJECT_IDS.clear();
        if (btn) { btn.disabled = true; btn.textContent = 'Submit for review'; }
        return loadRequestPicker();
    }

    try {
        const { data, error } = await supabase.functions.invoke('submit-advising-request', {
            body: { items, term: CURRENT_TERM, year: CURRENT_YEAR },
        });

        if (error) {
            let serverMessage = null;
            try {
                const body = await error.context?.json?.();
                serverMessage = body?.error ?? null;
            } catch (_) {}
            showMsg('req-msg', serverMessage || 'Could not submit your request. Please try again.');
            return;
        }

        const flagged = data.flaggedCount ?? 0;
        const total = data.items?.length ?? 0;

        showMsg(
            'req-msg',
            flagged
                ? `Submitted. ${flagged} of ${total} subject${total === 1 ? '' : 's'} were flagged for your adviser to review.`
                : `Submitted. All ${total} subject${total === 1 ? '' : 's'} checked out cleanly.`,
            'success',
        );

        SELECTED_SUBJECT_IDS.clear();
        await loadRequestPicker();

        // What was just submitted is now with the adviser: Cura's picture of the
        // student follows, so it stops suggesting those subjects.
        if (chatInitialized) {
            const summary = summarizeForExplanation(personalised(), STUDENT?.first_name, { inRequestIds: [...SUBJECT_LOCKS.locked.keys()] });
            window.EligibilityChat?.updateSummary(summary);
            CHAT_SUMMARY = summary;
            renderChatContext(summary);
            showChatFollowUps(null);
        }

    } catch (err) {
        console.warn('submitAdvisingRequest threw:', err);
        showMsg('req-msg', 'Could not reach the server. Please try again.');
    } finally {
        if (btn) { btn.disabled = SELECTED_SUBJECT_IDS.size === 0; btn.textContent = 'Submit for review'; }
    }
}

/* One-stage status: the adviser reviews per subject, and once every item has a
   decision the whole request is approved, partly approved or rejected. That
   is final: the Registrar is not a second approval (shared/js/requeststatus.js).
   An old plan the Registrar once sent back keeps a second, red chip. */
function requestStages(r) {
    return window.CurriculogicRequestStatus.stages(r);
}

// request_item.status is 'valid'/'flagged' from the engine's own
// verdict at submission, then becomes 'approved'/'rejected' once
// Faculty actually reviews it -- the old check here only recognized
// 'valid', so a Faculty-approved item was rendered in the same red
// "danger" chip as a rejected one.
function itemStatusChip(status) {
    if (status === 'valid' || status === 'approved') return 'ok';
    if (status === 'rejected') return 'danger';
    return 'info';   // 'flagged' -- awaiting Faculty's decision
}

/* Full-page status view (the "My requests" nav item) -- reuses the
   same fetchMyRequests() query the picker uses, rather than a second,
   separately-limited query that could show a different set of requests
   than what the picker just used to decide locks. Not capped to 5:
   this is now its own page, not a small dashboard card, so the
   student's whole history is the point of visiting it. */
/* How an item reads to the student. The engine's own words (valid, flagged)
   mean "waiting for the adviser", so that is what is said. */
function requestItemChip(status) {
    switch (status) {
        case 'approved': return { cls: 'ok',   label: 'Approved' };
        case 'rejected': return { cls: 'bad',  label: 'Sent back' };
        case 'flagged':  return { cls: 'info', label: 'In review \u00b7 flagged' };
        default:         return { cls: 'info', label: 'In review' };
    }
}

const REQ_PILL = { ok: 'ok', info: 'info', danger: 'bad' };   // requeststatus.js chip -> pill

function requestTitle(r) {
    const y = Number(r.requested_year);
    if (!r.requested_term) return 'Advising request';
    return termLabel(r.requested_term) + (y ? ` \u00b7 AY ${y}\u2013${y + 1}` : '');
}

const longDate = (iso) => new Date(iso).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });

/* The three steps of a request, and where it has got to. */
function requestSteps(r) {
    const RS = window.CurriculogicRequestStatus;
    let last = { label: 'Decision', cls: '' };
    if (RS.sentBack(r))                      last = { label: 'Sent back by the Registrar', cls: 'is-bad' };
    else if (r.status === 'rejected')        last = { label: 'Sent back', cls: 'is-bad' };
    else if (r.status === 'partially_approved') last = { label: 'Partly approved', cls: 'is-done' };
    else if (r.status === 'approved')        last = { label: 'Approved', cls: 'is-done' };
    return [
        { label: 'Submitted', cls: 'is-done' },
        { label: 'Adviser review', cls: RS.waiting(r) ? 'is-current' : 'is-done' },
        last,
    ];
}

/* Fills item._section (the section the subject was submitted with, with all of
   its meetings) for every item that has an offering. Two small reads: the
   offering each item points at, then every meeting of that section. */
async function attachRequestSections(requests) {
    const items = requests.flatMap(r => r.request_item ?? []).filter(i => i.offering_id && !i._section);
    if (!items.length || !window.ScheduleConflicts) return;

    let rows = [];
    let picked = [];
    if (PREVIEW) {
        rows = window.CL_PREVIEW?.OFFERINGS ?? [];
        picked = rows;
    } else if (supabase) {
        const ids = [...new Set(items.map(i => i.offering_id))];
        const first = await supabase.from('subject_offering')
            .select('id, subject_id, section, academic_year, term').in('id', ids);
        picked = first.data ?? [];
        const subjectIds = [...new Set(picked.map(o => o.subject_id))];
        if (subjectIds.length) {
            const all = await supabase.from('subject_offering')
                .select('id, subject_id, section, academic_year, term, meeting_type, schedule_days, start_time, end_time')
                .in('subject_id', subjectIds);
            rows = all.data ?? [];
        }
    }

    const byId = new Map(picked.map(o => [o.id, o]));
    for (const item of items) {
        const o = byId.get(item.offering_id);
        if (!o) continue;
        // the same section in the same term: a section name comes back every term
        const meetings = rows.filter(x => x.subject_id === o.subject_id && x.section === o.section
            && x.academic_year === o.academic_year && x.term === o.term);
        item._section = window.ScheduleConflicts.groupSections(meetings)[0] ?? null;
    }
}

/* Full-page status view (the "My requests" nav item) -- reuses the
   same fetchMyRequests() query the picker uses, rather than a second,
   separately-limited query that could show a different set of requests
   than what the picker just used to decide locks. Not capped: this is
   its own page, so the student's whole history is the point of visiting it.
   The newest request is open; older ones are folded away. */
async function loadRequestHistory() {
    const body = $('myrequests-body');
    if (!body || !STUDENT) return;
    if (!PREVIEW && !supabase) return;

    body.innerHTML = `
        <div class="empty">
            <i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i>
            <h3>Loading</h3>
        </div>`;

    const requests = await fetchMyRequests();
    await attachRequestSections(requests);

    const sum = $('myrequests-summary');
    if (!requests.length) {
        if (sum) sum.hidden = true;
        body.innerHTML = `
            <div class="empty">
                <i class="fa-solid fa-inbox" aria-hidden="true"></i>
                <h3>No requests yet</h3>
                <p>Once you submit a plan from <a href="#plan">Build your plan</a>, its
                   status will show up here.</p>
            </div>`;
        return;
    }

    const RS = window.CurriculogicRequestStatus;
    const hasSentBackItems = (r) => (r.request_item ?? []).some(i => i.status === 'rejected');
    const counts = {
        all:      requests.length,
        waiting:  requests.filter(r => RS.waiting(r)).length,
        approved: requests.filter(r => RS.finalApproved(r)).length,
        sentBack: requests.filter(r => r.status === 'rejected' || RS.sentBack(r) || hasSentBackItems(r)).length,
    };
    if (sum) {
        sum.hidden = false;
        sum.innerHTML = [
            ['Requests',                 counts.all,      'Submitted so far'],
            ['Awaiting adviser',         counts.waiting,  'Waiting for a decision'],
            ['Approved for enrollment',  counts.approved, 'Your adviser\u2019s approval is final'],
            ['Sent back',                counts.sentBack, 'Need a change from you'],
        ].map(([label, n, hint]) => `
            <div class="stat">
                <span class="stat-label">${escapeHtml(label)}</span>
                <span class="stat-value">${n}</span>
                <span class="stat-hint">${escapeHtml(hint)}</span>
            </div>`).join('');
    }

    body.innerHTML = requests.map((r, index) => {
        const { faculty, registrar } = requestStages(r);
        const items = r.request_item ?? [];
        const kept = items.filter(i => i.status !== 'rejected');
        const units = kept.reduce((t, i) => t + (Number(i.subject?.units) || 0), 0);
        const sentBackItems = items.filter(i => i.status === 'rejected');

        const steps = requestSteps(r).map(st => `
            <li class="${st.cls}"><span class="req-step-dot" aria-hidden="true"></span>${escapeHtml(st.label)}</li>`).join('');

        const rows = items.map(item => {
            const chip = requestItemChip(item.status);
            const sectionText = item._section ? fmtSection(item._section) : '';
            return `
                <tr>
                    <td>
                        <span class="req-code">${escapeHtml(item.subject?.code ?? '')}</span>
                        <span class="req-item-title">${escapeHtml(item.subject?.title ?? '')}</span>
                        ${item.remarks ? `<span class="req-item-note ${item.status === 'rejected' ? 'is-bad' : ''}">${escapeHtml(item.remarks)}</span>` : ''}
                    </td>
                    <td class="dim req-item-section">${sectionText ? escapeHtml(sectionText) : '—'}</td>
                    <td class="num">${escapeHtml(item.subject?.units ?? '')}</td>
                    <td><span class="pill ${chip.cls}">${escapeHtml(chip.label)}</span></td>
                </tr>`;
        }).join('');

        const meta = [
            `Submitted ${longDate(r.created_at)}`,
            `${kept.length} subject${kept.length === 1 ? '' : 's'}`,
            `${units} unit${units === 1 ? '' : 's'}`,
        ].join(' \u00b7 ');

        return `
        <details class="req-card" ${index === 0 ? 'open' : ''}>
            <summary class="req-card-head">
                <span class="req-card-title">
                    <strong>${escapeHtml(requestTitle(r))}</strong>
                    <span class="dim">${escapeHtml(meta)}</span>
                </span>
                <span class="pill ${REQ_PILL[faculty.chip] ?? 'info'}">${escapeHtml(faculty.label)}</span>
            </summary>
            <div class="req-card-body">
                <ol class="req-steps" aria-label="Progress of this request">${steps}</ol>

                ${r.registrar_status === 'rejected' && r.registrar_notes ? `
                    <div class="notice pending">
                        <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
                        <div>
                            <strong>Sent back by the Registrar</strong>
                            ${escapeHtml(r.registrar_notes)} Submit a new request with the
                            needed changes -- this one is closed.
                        </div>
                    </div>` : ''}

                <div class="table-wrap">
                    <table class="data-table my-req-table">
                        <thead><tr><th>Subject</th><th>Section and time</th><th class="num">Units</th><th>Status</th></tr></thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>

                ${RS.finalApproved(r) ? `
                    <p class="req-foot is-ok"><i class="fa-solid fa-circle-check" aria-hidden="true"></i>
                        ${r.status === 'partially_approved'
                            ? 'The approved subjects are approved for enrollment. Your adviser\u2019s decision is final.'
                            : 'Approved for enrollment. Your adviser\u2019s approval is final.'}</p>` : ''}
                ${sentBackItems.length ? `
                    <div class="notice pending">
                        <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
                        <div>
                            <strong>${sentBackItems.length} subject${sentBackItems.length === 1 ? ' was' : 's were'} sent back</strong>
                            ${sentBackItems.length === 1 ? 'It appears' : 'They appear'} again in
                            <a href="#plan">Build your plan</a> with the adviser\u2019s reason, so you can fix
                            ${sentBackItems.length === 1 ? 'it' : 'them'} and send ${sentBackItems.length === 1 ? 'it' : 'them'} again.
                        </div>
                    </div>` : ''}
                ${RS.waiting(r) ? `
                    <p class="req-foot"><i class="fa-regular fa-clock" aria-hidden="true"></i>
                        With your adviser. You will be notified when there is a decision.</p>` : ''}
            </div>
        </details>`;
    }).join('');
}

/* Dashboard summary cards: a compact request overview and the
   student's own notifications. Nothing in this file previously read
   the `notification` table at all -- every notice Faculty or the
   Registrar wrote all session was invisible to the student it was
   meant for. Both cards reuse fetchMyRequests()/MY_REQUESTS rather
   than issuing their own separate query, same reasoning as the picker
   and the My Requests page: one source of truth for "what state is
   this student's request in". */

async function loadDashboardRequestSummary() {
    const body = $('dash-requests-body');
    if (!body) return;

    if (PREVIEW || !supabase || !STUDENT_ROW_ID) {
        body.innerHTML = '<p class="dim">Not available in preview.</p>';
        return;
    }

    const requests = await fetchMyRequests();

    // The suggested-load cards above were drawn before this fetch finished.
    // Now that the requests are known, redraw them so a subject that is
    // already approved (or in review) says so instead of looking untouched.
    SUBJECT_LOCKS = computeSubjectLocks(requests);
    if (SUBJECT_LOCKS.locked.size && STUDENT) renderEligibility(STUDENT);

    if (!requests.length) {
        body.innerHTML = `
            <div class="empty">
                <i class="fa-solid fa-inbox" aria-hidden="true"></i>
                <h3>No requests yet</h3>
                <p>Head to <a href="#plan">Build your plan</a> to submit one.</p>
            </div>`;
        return;
    }

    // Most recent request only -- this is a glance card, not the full
    // history (that's My Requests). Same requestStages() logic as the
    // full page, so the two can never disagree about what a status
    // means.
    const latest = requests[0];
    const { faculty, registrar } = requestStages(latest);
    const pending = requests.filter(r => window.CurriculogicRequestStatus.waiting(r)).length;

    body.innerHTML = `
        <div class="req-history-entry">
            <div class="req-history-head">
                <span>Most recent · ${new Date(latest.created_at).toLocaleDateString()}</span>
                <div class="req-history-stages">
                    <span class="pg-chip ${faculty.chip}">${escapeHtml(faculty.label)}</span>
                    ${registrar ? `
                        <i class="fa-solid fa-chevron-right dim" aria-hidden="true"></i>
                        <span class="pg-chip ${registrar.chip}">${escapeHtml(registrar.label)}</span>
                    ` : ''}
                </div>
            </div>
        </div>
        <p class="dim">${pending} of ${requests.length} request${requests.length === 1 ? '' : 's'} still awaiting a decision.</p>`;
}

let notifsLoaded = false;

async function loadNotifications() {
    const body = $('notif-body');
    const note = $('notif-note');
    if (!body) return;

    if (PREVIEW || !supabase || !AUTH_UID) {
        body.innerHTML = '<p class="dim">Not available in preview.</p>';
        return;
    }

    const { data, error } = await supabase
        .from('notification')
        .select('id, message, is_read, created_at, related_request_id')
        .eq('user_id', AUTH_UID)
        .order('created_at', { ascending: false })
        .limit(10);

    if (error) {
        console.warn('notification load failed:', error.message);
        body.innerHTML = `
            <div class="empty">
                <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
                <h3>Could not load notifications</h3>
            </div>`;
        return;
    }

    const notifs = data ?? [];
    const unread = notifs.filter(n => !n.is_read).length;

    if (note) note.textContent = unread ? `${unread} unread` : '';

    const markBtn = $('notif-mark-read');
    if (markBtn) markBtn.hidden = unread === 0;

    if (!notifs.length) {
        body.innerHTML = `
            <div class="empty">
                <i class="fa-solid fa-bell-slash" aria-hidden="true"></i>
                <h3>No notifications</h3>
                <p>Anything Faculty or the Registrar sends you shows up here.</p>
            </div>`;
        return;
    }

    body.innerHTML = notifs.map(n => `
        <div class="req-history-item ${n.is_read ? '' : 'is-unread'}">
            <span>${escapeHtml(n.message)}</span>
            <span class="dim">${new Date(n.created_at).toLocaleDateString()}</span>
        </div>`).join('');

    notifsLoaded = true;
}

$('notif-mark-read')?.addEventListener('click', async () => {
    if (!supabase || !AUTH_UID) return;
    const { error } = await supabase
        .from('notification')
        .update({ is_read: true })
        .eq('user_id', AUTH_UID)
        .eq('is_read', false);
    if (error) { console.warn('mark-read failed:', error.message); return; }
    loadNotifications();
});

/* boot */

function render(student, email) {
    renderProfile(student, email);
    loadPhoto();
    renderNotice(student);
    renderStats();
    renderEligibility(student);
    loadDashboardRequestSummary();
    loadNotifications();
}

(async function init() {

    // Load the real current term/year before anything below reads
    // CURRENT_TERM/CURRENT_YEAR (loadKB()'s offering query, and the
    // advising-request submission payload) -- preview mode included,
    // so a preview session's picker reflects the same term a real one
    // would.
    await loadCurrentTermYear();

    const mock = previewStudent();
    if (mock !== undefined) {
        PREVIEW = true;
        STUDENT = mock;
        document.body.classList.add('is-preview');

        render(mock, PREVIEW_EMAIL);

        // The old preview branch stopped here: it drew the profile chrome
        // and returned, so RECORDS stayed [] and RESULT stayed null for
        // the whole session — the eligibility card, the "why is this
        // locked" reasoning, and My Prospectus all sat on their empty
        // state permanently, regardless of what studentpreview.js's
        // fixture contained. Mirror the real boot path instead: load the
        // records, run the actual assessment against CL_PREVIEW's
        // knowledge base, then render again with real data.
        await loadRecords();
        RESULT = await runAssessment(mock);
        renderStats();
        renderEligibility(mock);

        route();
        return;
    }

    if (!supabase) {
        setText('greeting', 'Cannot reach the service', 'is-error');
        console.error('studentdashboard.js: Supabase client not created. Is config.js loaded?');
        return;
    }

    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
        window.location.href = LOGIN_PAGE;
        return;
    }

    AUTH_UID = session.user.id;

    const { data: student, error } = await supabase
        .from('university_student')
        .select('id, user_id, student_id, first_name, last_name, email, year_level, is_approved, record_verified, prospectus_id, program_id')
        .eq('user_id', AUTH_UID)
        .maybeSingle();

    if (error) console.warn('student load failed:', error.message);

    if (student && student.is_approved === false) {
        await supabase.auth.signOut();
        window.location.href = LOGIN_PAGE;
        return;
    }

    STUDENT = student;
    STUDENT_ROW_ID = student?.id ?? null;

    // Programme names are looked up, not typed: the page must say the
    // student's own degree, whatever it is.
    await window.CurriculogicPrograms?.load(supabase);
    render(student, session.user.email);
    window.CurriculogicForcePassword?.run(supabase, 'student');

        // Resolve the active prospectus once. Used as a fallback for any
    // student whose own prospectus_id is null — which happens when
    // they were registered before the first curriculum was activated.
    if (supabase) {
        // Every active prospectus, not "the" active one: with more than one
        // programme there is one per programme, and asking for a single row
        // errors as soon as a second programme is published. The student
        // falls back to the one for THEIR programme (or the only one, if no
        // programme is set and there is just one).
        const { data: actives, error: activeError } = await supabase
            .from('prospectus')
            .select('id, program_id')
            .eq('is_active', true);
        if (activeError) console.warn('active prospectus lookup failed:', activeError.message);

        ACTIVE_PROSPECTUS_ID =
            window.CurriculogicPrograms.fallbackProspectus(student?.program_id, actives)?.id ?? null;
    }

    // The record loads at boot regardless of the active view — the stat
    // tiles and the assessment both derive from it.
    await loadRecords();

    RESULT = await runAssessment(student);
    await loadPreferences();

    renderStats();
    renderEligibility(student);

    route();
})();

})();