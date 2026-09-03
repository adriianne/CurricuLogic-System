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

const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.CURRICULOGIC ?? {};

const supabase = (window.supabase && SUPABASE_URL && SUPABASE_ANON_KEY)
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

const $ = (id) => document.getElementById(id);

const LOGIN_PAGE = 'staffloginpage.html';

let AUTH_UID = null;
let FACULTY  = null;
let STUDENTS = [];
let PREVIEW  = false;


/* preview mode (development only) */

const PREVIEW_HOSTS = ['localhost', '127.0.0.1', ''];

const PREVIEW_FACULTY = {
    first_name: 'Rhea', last_name: 'Lumactod',
    employee_id: 'EMP-00871', email: 'rhea.lumactod@uc.edu.ph',
    department: 'College of Computer Studies', is_approved: true,
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

    if (name === 'students') loadStudents();
    if (name === 'student' && param) openStudent(param);
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

function statusClass(s) {
    return { PASSED: 'ok', FAILED: 'bad', ENROLLED: 'info', DROPPED: 'waiting' }[s] || 'waiting';
}

function statusLabel(s) {
    return { PASSED: 'Passed', FAILED: 'Failed', ENROLLED: 'Enrolled', DROPPED: 'Dropped' }[s] || s;
}

function fullName(p) {
    return [p?.first_name, p?.last_name].filter(Boolean).join(' ');
}


/* profile */

function renderProfile(staff, authEmail) {
    const full  = fullName(staff);
    const email = staff?.email || authEmail || '—';

    $('avatar').textContent    = initials(staff?.first_name, staff?.last_name, email);
    $('user-name').textContent = full || email;
    $('user-sub').textContent  = staff?.employee_id || '';

    $('greeting').textContent = staff?.first_name
        ? `Welcome back, ${staff.first_name}`
        : 'Welcome back';

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


/* students */

let studentsLoaded = false;

async function loadStudents(force = false) {
    if (studentsLoaded && !force) return renderStudents();

    if (PREVIEW) {
        STUDENTS = [...PREVIEW_STUDENTS];
        studentsLoaded = true;
        renderStudents();
        renderRecent();
        renderStats();
        return;
    }

    if (!supabase) return;

    const { data, error } = await supabase
        .from('university_student')
        .select('id, user_id, first_name, last_name, student_id, email, year_level, is_approved, record_verified, prospectus_id')
        .order('last_name', { ascending: true });

    if (error) {
        console.warn('student list failed:', error.message);
        const body = $('students-body');
        if (body) {
            body.innerHTML = `
                <div class="empty">
                    <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
                    <h3>Could not load students</h3>
                    <p>${escapeHtml(error.message)}</p>
                    <p class="dim">If this says permission denied, run db/008_staff_read_access.sql.</p>
                </div>`;
        }
        return;
    }

    STUDENTS = data ?? [];
    studentsLoaded = true;
    renderStudents();
    renderRecent();
    renderStats();
}

function filteredStudents() {
    const term   = ($('student-search')?.value || '').trim().toLowerCase();
    const filter = $('student-filter')?.value || 'all';

    return STUDENTS.filter((s) => {
        if (filter === 'verified' && !s.record_verified) return false;
        if (filter === 'pending'  &&  s.record_verified) return false;

        if (!term) return true;

        const haystack = [
            s.first_name, s.last_name, s.student_id, s.email,
        ].filter(Boolean).join(' ').toLowerCase();

        return haystack.includes(term);
    });
}

function renderStudents() {
    const body  = $('students-body');
    const count = $('students-count');
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
                <i class="fa-solid fa-users-slash" aria-hidden="true"></i>
                <h3>No students yet</h3>
                <p>Student accounts will appear here once they have registered.</p>
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

    const rows = list.map((s) => `
        <tr class="row-link" data-open="${escapeHtml(s.id)}" tabindex="0" role="button">
            <td class="mono">${escapeHtml(s.student_id || '—')}</td>
            <td><strong>${escapeHtml(fullName(s) || '—')}</strong></td>
            <td class="dim">${escapeHtml(s.email || '—')}</td>
            <td>${escapeHtml(ordinal(s.year_level) || '—')}</td>
            <td>${s.record_verified
                ? '<span class="pill ok">Verified</span>'
                : '<span class="pill waiting">Pending</span>'}</td>
            <td class="num"><i class="fa-solid fa-chevron-right dim" aria-hidden="true"></i></td>
        </tr>`).join('');

    body.innerHTML = `
        <div class="table-wrap">
            <table class="data-table">
                <thead>
                    <tr>
                        <th>Student ID</th>
                        <th>Name</th>
                        <th>Email</th>
                        <th>Year</th>
                        <th>Record</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
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

$('student-search')?.addEventListener('input', renderStudents);
$('student-filter')?.addEventListener('change', renderStudents);


/* dashboard tiles */

function renderStats() {
    const verified = STUDENTS.filter(s => s.record_verified).length;

    setText('stat-students', String(STUDENTS.length), 'stat-value');
    setText('stat-verified', String(verified), 'stat-value');
    setText('stat-pending',  String(STUDENTS.length - verified), 'stat-value');
    setText('stat-requests', '—', 'stat-value muted');
}

function renderRecent() {
    const body = $('recent-body');
    if (!body) return;

    if (STUDENTS.length === 0) {
        body.innerHTML = `
            <div class="empty">
                <i class="fa-solid fa-users-slash" aria-hidden="true"></i>
                <h3>No students yet</h3>
                <p>Student accounts will appear here once they have registered.</p>
            </div>`;
        return;
    }

    const rows = STUDENTS.slice(0, 5).map((s) => `
        <tr class="row-link" data-open="${escapeHtml(s.id)}" tabindex="0" role="button">
            <td class="mono">${escapeHtml(s.student_id || '—')}</td>
            <td><strong>${escapeHtml(fullName(s) || '—')}</strong></td>
            <td>${escapeHtml(ordinal(s.year_level) || '—')}</td>
            <td>${s.record_verified
                ? '<span class="pill ok">Verified</span>'
                : '<span class="pill waiting">Pending</span>'}</td>
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

/* ============================================================
   Paste over the existing openStudent() and loadStudentRecord()
   in facultydashboard.js. loadStudentRecord's fetch has been split
   out so the record is loaded once and used twice — the engine
   needs the same rows the table renders.
   ============================================================ */


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
            .select('id, code, title, units, lec_units, lab_units, year_level, term, is_elective, category')
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

async function openStudent(studentRowId) {
    const userId = studentRowId;   // university_student.id, not user_id
    const student = STUDENTS.find(s => s.id === userId);

    // Deep link straight to a student, before the list has loaded.
    if (!student && !studentsLoaded) {
        await loadStudents();
        return openStudent(userId);
    }

    if (!student) {
        setText('detail-name', 'Student not found');
        setText('detail-sub', '');
        $('detail-record-body').innerHTML = `
            <div class="empty">
                <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
                <h3>No such student</h3>
                <p>That student could not be found in the list you can access.</p>
            </div>`;
        return;
    }

    setText('detail-name', fullName(student) || '—');
    setText('detail-sub',
        `${student.student_id || 'No ID'} · ${ordinal(student.year_level) || 'Year not set'} · BS Information Technology`);

    const eligNote = $('detail-elig-note');
    const eligBody = $('detail-elig-body');

    // Load once. The table below and the engine above read the same rows.
    const records = await fetchRecords(userId);
    renderStudentRecord(records);

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

    await window.ProspectusGrid.render(
        supabase, student.prospectus_id, eligBody, statusMap(result));
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

    const rows = records.map((r) => `
        <tr>
            <td class="mono">${escapeHtml(r.subject_code)}</td>
            <td>${escapeHtml(r.subject_title || '—')}</td>
            <td class="num">${escapeHtml(r.units)}</td>
            <td class="num">${r.grade_points != null ? escapeHtml(Number(r.grade_points).toFixed(2)) : escapeHtml(r.grade || '—')}</td>
            <td><span class="pill ${statusClass(r.status)}">${statusLabel(r.status)}</span></td>
            <td class="dim">${termLabel(r.taken_term)} · ${escapeHtml(r.taken_year || '—')}</td>
        </tr>`).join('');

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
                <tbody>${rows}</tbody>
            </table>
        </div>`;
}


/* boot */

(async function init() {

    if (previewRequested()) {
        PREVIEW = true;
        FACULTY = PREVIEW_FACULTY;
        document.body.classList.add('is-preview');
        renderProfile(FACULTY, PREVIEW_FACULTY.email);
        renderNotice(FACULTY);
        await loadStudents();
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
        .select('user_id, first_name, last_name, employee_id, email, department, is_approved')
        .eq('user_id', AUTH_UID)
        .maybeSingle();

    if (error) console.warn('faculty load failed:', error.message);

    // A student who lands here by editing the URL has no faculty row and
    // no read access. Send them back rather than showing an empty shell.
    if (staff && staff.is_approved === false) {
        await supabase.auth.signOut();
        window.location.href = LOGIN_PAGE;
        return;
    }

    FACULTY = staff;
    renderProfile(staff, session.user.email);
    renderNotice(staff);

    await loadStudents();
    route();
})();

})();