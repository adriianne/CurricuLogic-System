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

const LOGIN_PAGE = 'staffloginpage.html';

let AUTH_UID   = null;
let STAFF      = null;
let STAFF_ID   = null;   // department_staff.id — the created_by target
let PROSPECTUS = null;   /* the active version */
let VERSIONS   = [];
let EDITING    = null;   /* the version being edited — not always the active one */
let SUBJECTS   = [];
let RULES      = [];
let OFFERINGS  = [];
let PREVIEW    = false;

/* What exists yet. Schedule and grade upload both write rows that
   reference subject.id, so neither can run against an empty curriculum —
   the FK would reject every row and the operator would see a wall of
   rejections with no cause. */
let READY = {
    prospectus: false,
    subjects:   0,
    students:   0,
    offerings:  0,
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

function showMsg(boxId, text, type = 'error') {
    const box = $(boxId);
    if (!box) return;
    box.textContent = text;
    box.className = 'msg ' + type;
}

const subjectById = (id) => SUBJECTS.find(s => s.id === id);
const rulesFor    = (id) => RULES.filter(r => r.subject_id === id);


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
    setText('d-dept',  staff?.department || '—');

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
        return afterLoad();
    }

    if (!supabase) return;

    const { data: active } = await supabase
        .from('prospectus')
        .select('id, program_id, academic_year, academic_term, is_active, published_at')
        .eq('is_active', true)
        .maybeSingle();

    PROSPECTUS = active;

    /* A draft can be edited without being active, so the curriculum view
       follows EDITING rather than assuming the active version. Defaulting
       to active keeps the common case one click shorter. */
    if (!EDITING) EDITING = active;

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
        .select('id, code, title, units, year_level, term, is_elective')
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

    renderSetup();
    renderStats();
    renderProspectus();
    renderIntegrity();
    renderSubjects();
    renderSubjectOptions();
}


/* dashboard */

function renderStats() {
    const units   = SUBJECTS.reduce((t, s) => t + Number(s.units || 0), 0);
    const gated   = new Set(RULES.map(r => r.subject_id));
    const ungated = SUBJECTS.filter(s => s.year_level >= 2 && !gated.has(s.id)).length;

    setText('stat-subjects', String(SUBJECTS.length), 'stat-value');
    setText('stat-rules',    String(RULES.length),    'stat-value');
    setText('stat-units',    String(units),           'stat-value');
    setText('stat-ungated',  String(ungated),
        ungated > 0 ? 'stat-value' : 'stat-value muted');
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
                : '<span class="pill waiting">Inactive</span>'}</dd></div>
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

    if (issues.length === 0) {
        body.innerHTML = `
            <div class="empty">
                <i class="fa-solid fa-circle-check" aria-hidden="true"></i>
                <h3>No issues found</h3>
                <p>No cycles, self-references, or rules pointing at a later term.</p>
            </div>`;
        return;
    }

    body.innerHTML = `
        <div class="notice pending">
            <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
            <div>
                <strong>${issues.length} issue${issues.length === 1 ? '' : 's'} to review</strong>
                ${[...new Set(issues)].map(i => escapeHtml(i)).join('<br>')}
            </div>
        </div>`;
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

    renderRules();
    renderSubjectOptions();
}

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

const SUBJ_HEADERS   = ['code','title','units','year_level','term','is_elective'];
const PREREQ_HEADERS = ['subject_code','prerequisite_code','requirement_type',
                        'rule_group','threshold_value'];

let PENDING_SUBJECTS = [];
let PENDING_RULES    = [];

/* Which version the Curriculum tab is editing. Defaults to the active
   one; a draft has to be selectable or a new version could never be
   filled in. */
function renderEditingSelector() {
    const sel = $('edit-prospectus');
    if (!sel) return;

    if (VERSIONS.length === 0) {
        sel.innerHTML = EDITING
            ? `<option value="${EDITING.id}">${escapeHtml(EDITING.academic_year)}</option>`
            : '<option value="">No prospectus</option>';
    } else {
        sel.innerHTML = VERSIONS.map(v =>
            `<option value="${v.id}" ${EDITING?.id === v.id ? 'selected' : ''}>` +
            `${escapeHtml(v.academic_year)}${v.is_active ? ' — active' : ''}` +
            `</option>`).join('');
    }

    const note = $('editing-note');
    if (note) note.textContent = EDITING ? `${SUBJECTS.length} subjects` : '';

    const warn = $('editing-warning');
    if (warn) {
        warn.textContent = EDITING?.is_active
            ? 'This is the active version. Changes affect student recommendations immediately.'
            : 'This is a draft. Changes do not affect students until it is made active.';
    }
}

$('edit-prospectus')?.addEventListener('change', async (e) => {
    const picked = VERSIONS.find(v => v.id === Number(e.target.value));
    if (!picked) return;
    EDITING = picked;
    clearCurriculumUploads();
    await loadCurriculum();
});

$('toggle-curr-upload')?.addEventListener('click', () => {
    const pane = $('curr-upload-pane');
    pane.hidden = !pane.hidden;
    $('toggle-curr-upload').textContent = pane.hidden ? 'Show' : 'Hide';
});

function clearCurriculumUploads() {
    PENDING_SUBJECTS = [];
    PENDING_RULES = [];
    ['subj-preview','prereq-preview'].forEach(id => { const b = $(id); if (b) b.innerHTML = ''; });
    ['subj-file','prereq-file'].forEach(id => { const f = $(id); if (f) f.value = ''; });
}

function downloadCsv(name, headers, rows) {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [headers.join(','), ...rows.map(r => headers.map(h => esc(r[h])).join(','))].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
}

$('subj-template')?.addEventListener('click', () => {
    downloadCsv('subjects-template.csv', SUBJ_HEADERS, [
        { code: 'CC-INTCOM11', title: 'Introduction to Computing',
          units: 3, year_level: 1, term: 1, is_elective: 'false' },
    ]);
});

$('prereq-template')?.addEventListener('click', () => {
    downloadCsv('prerequisites-template.csv', PREREQ_HEADERS, [
        { subject_code: 'CC-COMPROG12', prerequisite_code: 'CC-COMPROG11',
          requirement_type: 'prerequisite', rule_group: 1, threshold_value: '' },
        { subject_code: 'IT-CPSTONE30', prerequisite_code: '',
          requirement_type: 'standing', rule_group: 1, threshold_value: 3 },
    ]);
});


/* subjects */

$('subj-file')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    showMsg('curriculum-msg', '');

    try {
        const rows = await readScheduleFile(file);   // same reader, any sheet
        validateSubjects(rows);
    } catch (err) {
        console.error(err);
        showMsg('curriculum-msg', 'Could not read that file. ' + err.message);
    }
});

function validateSubjects(rows) {
    const existing = new Set(SUBJECTS.map(s => norm(s.code)));
    const seen = new Set();
    const ok = [], bad = [];

    for (const r of rows) {
        const code = (r.code || '').trim().toUpperCase();

        if (!code)      { bad.push({ line: r.__line, why: 'No course code.' }); continue; }
        if (!r.title)   { bad.push({ line: r.__line, code, why: 'No descriptive title.' }); continue; }

        if (!SUBJECT_CODE_PATTERN.test(code)) {
            bad.push({ line: r.__line, code,
                why: 'Code must look like CC-INTCOM11 or ENGL 100.' });
            continue;
        }

        if (existing.has(norm(code))) {
            bad.push({ line: r.__line, code, why: 'Already in this prospectus.' });
            continue;
        }

        /* A file repeating a code would insert it twice — the unique
           constraint is per prospectus, and both rows would be new. */
        if (seen.has(norm(code))) {
            bad.push({ line: r.__line, code, why: 'Repeated earlier in this file.' });
            continue;
        }
        seen.add(norm(code));

        const units = Number(r.units);
        const year  = Number(r.year_level);
        const term  = Number(r.term);

        if (!Number.isFinite(units) || units <= 0) {
            bad.push({ line: r.__line, code, why: 'Units must be a positive number.' });
            continue;
        }
        if (!Number.isInteger(year) || year < 1 || year > 5) {
            bad.push({ line: r.__line, code, why: 'year_level must be 1 to 5.' });
            continue;
        }
        if (!Number.isInteger(term) || term < 1 || term > 3) {
            bad.push({ line: r.__line, code, why: 'term must be 1, 2, or 3.' });
            continue;
        }

        ok.push({
            code, title: r.title.trim(), units,
            year_level: year, term,
            is_elective: String(r.is_elective).toLowerCase() === 'true',
        });
    }

    PENDING_SUBJECTS = ok;
    renderUploadPreview('subj-preview', ok, bad, 'subject', commitSubjects, (r) => `
        <td class="mono">${escapeHtml(r.code)}</td>
        <td>${escapeHtml(r.title)}</td>
        <td class="num">${r.units}</td>
        <td class="dim">${ordinal(r.year_level)} · ${termLabel(r.term)}</td>`,
        ['Code','Descriptive title','Units','Term']);
}

async function commitSubjects() {
    if (PENDING_SUBJECTS.length === 0) return;

    const payload = PENDING_SUBJECTS.map(r => ({
        ...r, prospectus_id: EDITING.id, created_by: STAFF_ID,
    }));

    if (PREVIEW) {
        clearCurriculumUploads();
        return showMsg('curriculum-msg', `${payload.length} subjects added (preview only).`, 'success');
    }

    const { error } = await supabase.from('subject').insert(payload);

    if (error) {
        console.error('subject upload failed:', error.message);
        return showMsg('curriculum-msg', 'Could not save those subjects. ' + error.message);
    }

    const n = payload.length;
    clearCurriculumUploads();
    await loadCurriculum();
    showMsg('curriculum-msg',
        `${n} subject${n === 1 ? '' : 's'} added. Prerequisites can be uploaded now.`, 'success');
}


/* prerequisites */

$('prereq-file')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    showMsg('curriculum-msg', '');

    if (SUBJECTS.length === 0) {
        return showMsg('curriculum-msg',
            'Upload the subjects first — a rule refers to subjects by code.');
    }

    try {
        const rows = await readScheduleFile(file);
        validateRules(rows);
    } catch (err) {
        console.error(err);
        showMsg('curriculum-msg', 'Could not read that file. ' + err.message);
    }
});

function validateRules(rows) {
    const byCode = new Map(SUBJECTS.map(s => [norm(s.code), s]));
    const ok = [], bad = [];

    for (const r of rows) {
        const type = (r.requirement_type || 'prerequisite').trim().toLowerCase();
        const gated = byCode.get(norm(r.subject_code));

        if (!gated) {
            bad.push({ line: r.__line, code: r.subject_code,
                why: `${r.subject_code} is not in this prospectus.` });
            continue;
        }

        if (!['prerequisite','co_requisite','standing'].includes(type)) {
            bad.push({ line: r.__line, code: r.subject_code,
                why: `"${type}" is not a condition type.` });
            continue;
        }

        const group = Number(r.rule_group) || 1;

        if (type === 'standing') {
            const threshold = Number(r.threshold_value);
            if (!Number.isFinite(threshold)) {
                bad.push({ line: r.__line, code: r.subject_code,
                    why: 'A standing rule needs the year that must be completed.' });
                continue;
            }
            ok.push({ subject_id: gated.id, prerequisite_subject_id: null,
                requirement_type: type, rule_type: 'and', rule_group: group,
                threshold_value: threshold, _code: gated.code, _needs: `through year ${threshold}` });
            continue;
        }

        const required = byCode.get(norm(r.prerequisite_code));
        if (!required) {
            bad.push({ line: r.__line, code: r.subject_code,
                why: `${r.prerequisite_code || '(blank)'} is not in this prospectus.` });
            continue;
        }

        /* A subject cannot require itself, and a prerequisite scheduled at
           or after its dependent can never be satisfied in sequence. Both
           are transcription errors rather than curriculum decisions. */
        if (required.id === gated.id) {
            bad.push({ line: r.__line, code: r.subject_code, why: 'A subject cannot require itself.' });
            continue;
        }

        const pos = (x) => x.year_level * 10 + x.term;
        if (pos(required) >= pos(gated)) {
            bad.push({ line: r.__line, code: r.subject_code,
                why: `${required.code} runs at the same time or later than ${gated.code}.` });
            continue;
        }

        ok.push({ subject_id: gated.id, prerequisite_subject_id: required.id,
            requirement_type: type, rule_type: 'and', rule_group: group,
            threshold_value: null, _code: gated.code, _needs: required.code });
    }

    PENDING_RULES = ok;
    renderUploadPreview('prereq-preview', ok, bad, 'condition', commitRules, (r) => `
        <td class="mono">${escapeHtml(r._code)}</td>
        <td>${escapeHtml(r.requirement_type)}</td>
        <td class="mono">${escapeHtml(r._needs)}</td>
        <td class="num">${r.rule_group}</td>`,
        ['Subject','Type','Requires','Group']);
}

async function commitRules() {
    if (PENDING_RULES.length === 0) return;

    const payload = PENDING_RULES.map(({ _code, _needs, ...r }) => ({
        ...r, created_by: STAFF_ID,
    }));

    if (PREVIEW) {
        clearCurriculumUploads();
        return showMsg('curriculum-msg', `${payload.length} conditions added (preview only).`, 'success');
    }

    const { error } = await supabase.from('prerequisite').insert(payload);

    if (error) {
        console.error('rule upload failed:', error.message);
        return showMsg('curriculum-msg', 'Could not save those conditions. ' + error.message);
    }

    const n = payload.length;
    clearCurriculumUploads();
    await loadCurriculum();
    showMsg('curriculum-msg', `${n} condition${n === 1 ? '' : 's'} added.`, 'success');
}


/* Shared preview. Nothing is written until the operator has seen what
   will be written and what was refused. */
function renderUploadPreview(boxId, ok, bad, noun, onCommit, cellsFor, headers) {
    const box = $(boxId);
    if (!box) return;

    const btnId = boxId + '-commit';

    box.innerHTML = `
        <div class="notice ${bad.length ? 'pending' : 'info'}">
            <i class="fa-solid ${bad.length ? 'fa-triangle-exclamation' : 'fa-circle-info'}" aria-hidden="true"></i>
            <div>
                <strong>${ok.length} ready${bad.length ? `, ${bad.length} rejected` : ''}</strong>
                ${bad.length
                    ? bad.slice(0, 10).map(b =>
                        `Line ${b.line}${b.code ? ' (' + escapeHtml(b.code) + ')' : ''}: ${escapeHtml(b.why)}`).join('<br>')
                      + (bad.length > 10 ? `<br>and ${bad.length - 10} more` : '')
                    : 'Every row checked out.'}
            </div>
        </div>

        ${ok.length ? `
            <div class="table-wrap">
                <table class="data-table">
                    <thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
                    <tbody>${ok.slice(0, 12).map(r => `<tr>${cellsFor(r)}</tr>`).join('')}</tbody>
                </table>
                ${ok.length > 12 ? `<p class="dim">and ${ok.length - 12} more</p>` : ''}
            </div>
            <button class="btn-accent" id="${btnId}" style="margin-top: var(--s2)">
                <i class="fa-solid fa-check" aria-hidden="true"></i>
                <span>Save ${ok.length} ${noun}${ok.length === 1 ? '' : 's'}</span>
            </button>` : ''}`;

    $(btnId)?.addEventListener('click', onCommit);
}


/* prospectus versions */

async function loadProspectusList() {
    const body = $('pros-body');
    if (!body) return;

    if (PREVIEW) {
        VERSIONS = [{ id: 3, academic_year: 2023, academic_term: 1, is_active: true,
                      published_at: null, subject_count: 58 }];
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
            .from('subject').select('id').eq('prospectus_id', v.id);
        v.subject_count = subs?.length ?? 0;
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
                        <th class="num">Subjects</th><th>Status</th><th></th></tr>
                </thead>
                <tbody>${VERSIONS.map(v => `
                    <tr>
                        <td class="mono">${escapeHtml(v.academic_year)}</td>
                        <td class="dim">${termLabel(v.academic_term)}</td>
                        <td class="num">${v.subject_count}</td>
                        <td>${versionStatus(v)}</td>
                        <td class="num">
                            ${v.is_active
                                ? '<span class="dim">In use</span>'
                                : `<button class="btn-small" data-activate="${v.id}"
                                     ${v.subject_count === 0 ? 'disabled title="Encode subjects first"' : ''}>
                                     Make active
                                   </button>`}
                        </td>
                    </tr>`).join('')}
                </tbody>
            </table>
        </div>`;

    body.querySelectorAll('[data-activate]').forEach(b =>
        b.addEventListener('click', () => activateVersion(Number(b.dataset.activate))));

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
                        <th class="num">Subjects</th><th>Status</th><th></th></tr>
                </thead>
                <tbody>${VERSIONS.map(v => `
                    <tr>
                        <td class="mono">${escapeHtml(v.academic_year)}</td>
                        <td class="dim">${termLabel(v.academic_term)}</td>
                        <td class="num">${v.subject_count}</td>
                        <td>${versionStatus(v)}</td>
                        <td class="num">
                            ${v.is_active
                                ? '<span class="dim">In use</span>'
                                : `<button class="btn-small" data-activate="${v.id}"
                                     ${v.subject_count === 0 ? 'disabled title="Encode subjects first"' : ''}>
                                     Make active
                                   </button>`}
                        </td>
                    </tr>`).join('')}
                </tbody>
            </table>
        </div>`;
    body.querySelectorAll('[data-activate]').forEach(b =>
        b.addEventListener('click', () => activateVersion(Number(b.dataset.activate))));
    }
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
              'It is inactive until you make it active.'
            : `${year} created. Encode its subjects under Curriculum.`,
        'success');
}

$('create-pros')?.addEventListener('click', createVersion);

async function activateVersion(id) {
    const v = VERSIONS.find(x => x.id === id);
    const current = VERSIONS.find(x => x.is_active);

    /* Switching the active version changes what every student is assessed
       against. Worth a confirmation rather than a single click. */
    const ok = window.confirm(
        `Make the ${v.academic_year} prospectus active?\n\n` +
        (current ? `${current.academic_year} becomes inactive. ` : '') +
        'Every student will be assessed against the new version from now on.');

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

    showMsg('pros-msg', `${v.academic_year} is now the active prospectus.`, 'success');
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
        return;
    }

    /* Rows are fetched rather than counted with head:true. An exact count
       can come back null when the request is shaped slightly differently
       than expected, and a null read as zero would tell the operator that
       setup is incomplete when it is not. At the scale of one programme
       the ids cost nothing.

       An error is reported rather than silently treated as empty — "no
       students" and "cannot read students" need different responses. */
    const [students, offerings] = await Promise.all([
        supabase.from('university_student').select('id'),
        supabase.from('subject_offering').select('id'),
    ]);

    if (students.error) {
        console.warn('student count failed:', students.error.message);
    }
    if (offerings.error) {
        console.warn('offering count failed:', offerings.error.message);
    }

    READY.students  = students.data?.length  ?? 0;
    READY.offerings = offerings.data?.length ?? 0;
}

function renderSetup() {
    const box = $('setup-notice');
    if (!box) return;

    const steps = [
        {
            done: READY.prospectus,
            label: 'A prospectus exists',
            detail: 'Everything else attaches to it.',
        },
        {
            done: READY.subjects > 0,
            label: `Curriculum encoded${READY.subjects ? ` — ${READY.subjects} subjects` : ''}`,
            detail: 'Schedules and grades both reference subjects, so this comes first.',
            action: '#curriculum',
            actionLabel: 'Go to Curriculum',
        },
        {
            done: READY.offerings > 0,
            label: `Schedule published${READY.offerings ? ` — ${READY.offerings} offerings` : ''}`,
            detail: 'Without it the engine cannot tell which subjects actually run.',
            action: '#schedule',
            actionLabel: 'Go to Schedule',
            blocked: READY.subjects === 0,
        },
        {
            done: READY.students > 0,
            label: 'Students registered',
            detail: 'Grade rows are matched to a student record.',
        },
    ];

    const outstanding = steps.filter(s => !s.done);

    if (outstanding.length === 0) {
        box.innerHTML = '';
        return;
    }

    const next = outstanding.find(s => !s.blocked);

    box.innerHTML = `
        <div class="notice pending">
            <i class="fa-solid fa-list-check" aria-hidden="true"></i>
            <div>
                <strong>Setup is incomplete</strong>
                <ul class="setup-list">
                    ${steps.map(s => `
                        <li class="${s.done ? 'is-done' : s.blocked ? 'is-blocked' : ''}">
                            ${escapeHtml(s.label)}
                            ${s.done ? '' : `<span class="setup-detail">${escapeHtml(s.detail)}</span>`}
                        </li>`).join('')}
                </ul>
                ${next?.action
                    ? `<a class="setup-action" href="${next.action}">${escapeHtml(next.actionLabel)}</a>`
                    : ''}
            </div>
        </div>`;
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
    return {
        year: Number($('sched-year')?.value) || currentAcademicYear(),
        term: Number($('sched-term')?.value) || 1,
    };
}

function initSchedule() {
    if (READY.subjects === 0) {
        renderScheduleBlocked();
        return;
    }

    showScheduleForm(true);

    if (!scheduleReady) {
        const y = $('sched-year');
        if (y && !y.value) y.value = currentAcademicYear();
        renderOfferingOptions();
        scheduleReady = true;
    }
    refreshTemplateCount();
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

function renderOfferingOptions() {
    const sel = $('o-subject');
    if (!sel) return;
    sel.innerHTML = SUBJECTS
        .map(s => `<option value="${s.id}">${escapeHtml(s.code)} — ${escapeHtml(s.title)}</option>`)
        .join('');
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
        .select('id, subject_id, section, schedule_days, start_time, end_time, room, instructor, capacity, is_open')
        .eq('academic_year', year)
        .eq('term', term)
        .order('section');

    if (error) {
        console.warn('offering load failed:', error.message);
        body.innerHTML = `
            <div class="empty">
                <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
                <h3>Could not load offerings</h3>
                <p>${escapeHtml(error.message)}</p>
                <p class="dim">If this mentions subject_offering, run db/024.</p>
            </div>`;
        return;
    }

    OFFERINGS = data ?? [];
    renderOfferings();
}

function timeRange(a, b) {
    if (!a && !b) return '—';
    const t = (x) => x ? x.slice(0, 5) : '';
    return `${t(a)}–${t(b)}`;
}

function renderOfferings() {
    const body  = $('offerings-body');
    const count = $('offerings-count');
    if (!body) return;

    const { year, term } = schedTerm();

    if (count) {
        count.textContent = OFFERINGS.length
            ? `${OFFERINGS.length} offering${OFFERINGS.length === 1 ? '' : 's'}`
            : '';
    }

    if (OFFERINGS.length === 0) {
        body.innerHTML = `
            <div class="empty">
                <i class="fa-solid fa-calendar-xmark" aria-hidden="true"></i>
                <h3>Nothing scheduled</h3>
                <p>
                    No subject is offered in ${termLabel(term)} ${year}. Until
                    something is scheduled, the engine has nothing available to
                    recommend for this term.
                </p>
            </div>`;
        return;
    }

    body.innerHTML = `
        <div class="table-wrap">
            <table class="data-table">
                <thead>
                    <tr><th>Code</th><th>Descriptive title</th><th>Section</th>
                        <th>Days</th><th>Time</th><th>Room</th><th>Instructor</th><th></th></tr>
                </thead>
                <tbody>${OFFERINGS.map(o => {
                    const s = subjectById(o.subject_id);
                    return `<tr>
                        <td class="mono">${escapeHtml(s?.code ?? '—')}</td>
                        <td>${escapeHtml(s?.title ?? '—')}</td>
                        <td class="mono">${escapeHtml(o.section)}</td>
                        <td>${escapeHtml(o.schedule_days || '—')}</td>
                        <td class="dim">${timeRange(o.start_time, o.end_time)}</td>
                        <td class="dim">${escapeHtml(o.room || '—')}</td>
                        <td class="dim">${escapeHtml(o.instructor || '—')}</td>
                        <td class="num">
                            <button class="btn-icon" data-drop-offering="${o.id}"
                                    aria-label="Remove offering">
                                <i class="fa-solid fa-trash-can" aria-hidden="true"></i>
                            </button>
                        </td>
                    </tr>`;
                }).join('')}</tbody>
            </table>
        </div>`;

    body.querySelectorAll('[data-drop-offering]').forEach(b =>
        b.addEventListener('click', () => dropOffering(Number(b.dataset.dropOffering))));
}

$('sched-year')?.addEventListener('change', loadOfferings);
$('sched-term')?.addEventListener('change', loadOfferings);

$('toggle-upload')?.addEventListener('click', () => {
    const p = $('upload-pane');
    p.hidden = !p.hidden;
    $('toggle-upload').textContent = p.hidden ? 'Show' : 'Hide';
});

$('toggle-offering')?.addEventListener('click', () => {
    const p = $('offering-pane');
    p.hidden = !p.hidden;
    $('toggle-offering').textContent = p.hidden ? 'Show' : 'Hide';
});


/* Template and upload. Nothing is written until the operator has seen
   what will be written — the GradeFile design in the ERD implies the same
   pattern, so schedule upload follows it. */

const CSV_HEADERS = ['code','title','year_level','term','section',
                     'days','start_time','end_time','room','instructor','capacity'];

const SECTION_LETTERS = ['A','B','C','D'];

/* The template is generated from the prospectus rather than shipped as a
   fixed file. Typing 58 subject codes by hand is where transcription
   errors come from, and a code that does not match is a row the upload
   silently drops. Pre-filling them removes the whole class of mistake —
   the operator fills in days, times, and rooms only.

   title and year_level are included for readability while filling the
   sheet in. Both are ignored on import; the subject is resolved by code. */
function buildTemplateRows() {
    const year     = $('tpl-year')?.value ?? 'all';
    const termPick = $('tpl-term')?.value ?? 'current';
    const sections = Number($('tpl-sections')?.value) || 1;
    const electives = $('tpl-electives')?.value === 'true';

    const term = termPick === 'current' ? schedTerm().term : termPick;

    return SUBJECTS
        .filter(s => year === 'all' || String(s.year_level) === year)
        .filter(s => term === 'all' || String(s.term) === String(term))
        .filter(s => electives || !s.is_elective)
        .flatMap(s => SECTION_LETTERS.slice(0, sections).map(letter => ({
            code:       s.code,
            title:      s.title,
            year_level: s.year_level,
            term:       s.term,
            section:    `BSIT-${s.year_level}${letter}`,
            days: '', start_time: '', end_time: '', room: '', instructor: '', capacity: '',
        })));
}

function refreshTemplateCount() {
    const label = $('tpl-count');
    if (!label) return;
    const n = buildTemplateRows().length;
    label.textContent = n === 0
        ? 'Nothing to download'
        : `Download template (${n} row${n === 1 ? '' : 's'})`;
}

['tpl-year','tpl-term','tpl-sections','tpl-electives','sched-term']
    .forEach(id => $(id)?.addEventListener('change', refreshTemplateCount));

$('download-template')?.addEventListener('click', () => {
    const rows = buildTemplateRows();

    if (rows.length === 0) {
        return showMsg('sched-msg', 'No subject matches those template settings.');
    }

    // Quote every cell — titles contain commas ("Life, Works & Writings…")
    // and an unquoted one shifts every column after it.
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [
        CSV_HEADERS.join(','),
        ...rows.map(r => CSV_HEADERS.map(h => esc(r[h])).join(',')),
    ].join('\n');

    const year = $('tpl-year').value;
    const name = `schedule-${year === 'all' ? 'all-years' : 'year-' + year}-${schedTerm().year}.csv`;

    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);

    showMsg('sched-msg', `Template with ${rows.length} rows downloaded.`, 'success');
});

$('sched-file')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    showMsg('sched-msg', '');

    try {
        const rows = await readScheduleFile(file);
        previewUpload(rows);
    } catch (err) {
        console.error('schedule parse failed:', err);
        showMsg('sched-msg', 'Could not read that file. ' + err.message);
    }
});

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

    if (!('code' in mapped[0]) || !('section' in mapped[0])) {
        throw new Error('The header row must include at least code and section.');
    }

    return mapped;
}

const norm = (c) => (c || '').replace(/\s/g, '').toUpperCase();

let PENDING_ROWS = [];

/* Nothing is written until the operator has seen what will be written.
   The GradeFile design in the ERD implies the same pattern — validate,
   report, then commit — so schedule upload follows it. */
function previewUpload(rows) {
    const box = $('upload-preview');
    const byCode = new Map(SUBJECTS.map(s => [norm(s.code), s]));
    const ok = [], bad = [], skipped = [];

    for (const r of rows) {
        if (!r.code || !r.section) {
            bad.push({ line: r.__line, why: 'Missing code or section.' });
            continue;
        }
        const subject = byCode.get(norm(r.code));
        if (!subject) {
            bad.push({ line: r.__line, why: `${r.code} is not in the prospectus.` });
            continue;
        }

        // A template row left entirely blank means that section is not
        // being offered. Saving it would create an offering with no
        // meeting time, which the engine would treat as available.
        if (!r.days && !r.start_time && !r.room) {
            skipped.push({ line: r.__line, code: r.code, section: r.section });
            continue;
        }

        ok.push({ subject, row: r });
    }

    PENDING_ROWS = ok;

    box.innerHTML = `
        <div class="notice ${bad.length ? 'pending' : 'info'}">
            <i class="fa-solid ${bad.length ? 'fa-triangle-exclamation' : 'fa-circle-info'}" aria-hidden="true"></i>
            <div>
                <strong>${ok.length} row${ok.length === 1 ? '' : 's'} ready${bad.length ? `, ${bad.length} rejected` : ''}</strong>
                ${bad.length
                    ? bad.map(b => `Line ${b.line}: ${escapeHtml(b.why)}`).join('<br>')
                    : 'Every code matched a subject in the prospectus.'}
            </div>
        </div>

        ${skipped.length ? `
            <div class="notice info">
                <i class="fa-solid fa-circle-minus" aria-hidden="true"></i>
                <div>
                    <strong>${skipped.length} row${skipped.length === 1 ? '' : 's'} left blank, not offered</strong>
                    Template rows with no days, time, or room are treated as
                    sections that are not running this term.
                </div>
            </div>` : ''}
        ${ok.length ? `
            <div class="table-wrap">
                <table class="data-table">
                    <thead><tr><th>Code</th><th>Section</th><th>Days</th><th>Time</th><th>Room</th></tr></thead>
                    <tbody>${ok.slice(0, 10).map(({ subject, row }) => `
                        <tr>
                            <td class="mono">${escapeHtml(subject.code)}</td>
                            <td class="mono">${escapeHtml(row.section)}</td>
                            <td>${escapeHtml(row.days || '—')}</td>
                            <td class="dim">${timeRange(row.start_time, row.end_time)}</td>
                            <td class="dim">${escapeHtml(row.room || '—')}</td>
                        </tr>`).join('')}
                    </tbody>
                </table>
                ${ok.length > 10 ? `<p class="dim">and ${ok.length - 10} more</p>` : ''}
            </div>
            <button class="btn-accent" id="commit-upload" style="margin-top: var(--s2)">
                <i class="fa-solid fa-check" aria-hidden="true"></i>
                <span>Save ${ok.length} offering${ok.length === 1 ? '' : 's'}</span>
            </button>` : ''}`;

    $('commit-upload')?.addEventListener('click', commitUpload);
}

async function commitUpload() {
    if (PENDING_ROWS.length === 0) return;

    const { year, term } = schedTerm();

    const payload = PENDING_ROWS.map(({ subject, row }) => ({
        subject_id:     subject.id,
        academic_year:  year,
        term,
        section:        row.section.toUpperCase(),
        schedule_days:  row.days || null,
        start_time:     row.start_time || null,
        end_time:       row.end_time || null,
        room:           row.room || null,
        instructor:     row.instructor || null,
        capacity:       row.capacity ? Number(row.capacity) : null,
        created_by:     STAFF_ID,
    }));

    if (PREVIEW) {
        OFFERINGS.push(...payload.map((p, i) => ({ ...p, id: Date.now() + i })));
        renderOfferings();
        $('upload-preview').innerHTML = '';
        $('sched-file').value = '';
        return showMsg('sched-msg', `${payload.length} offerings added (preview only — not saved).`, 'success');
    }

    // upsert so re-uploading a corrected file updates rather than failing
    const { error } = await supabase
        .from('subject_offering')
        .upsert(payload, { onConflict: 'subject_id,academic_year,term,section' });

    if (error) {
        console.error('offering upload failed:', error.message);
        return showMsg('sched-msg', 'Could not save the schedule. ' + error.message);
    }

    $('upload-preview').innerHTML = '';
    $('sched-file').value = '';
    PENDING_ROWS = [];
    await loadOfferings();
    showMsg('sched-msg', `${payload.length} offering${payload.length === 1 ? '' : 's'} saved.`, 'success');
}


/* single offering */

async function addOffering() {
    showMsg('sched-msg', '');

    const subjectId = Number($('o-subject').value);
    const section   = $('o-section').value.trim().toUpperCase();

    if (!subjectId) return showMsg('sched-msg', 'Choose a subject.');
    if (!section)   return showMsg('sched-msg', 'Enter a section.');

    const { year, term } = schedTerm();

    const row = {
        subject_id:    subjectId,
        academic_year: year,
        term,
        section,
        schedule_days: $('o-days').value.trim() || null,
        start_time:    $('o-start').value || null,
        end_time:      $('o-end').value || null,
        room:          $('o-room').value.trim() || null,
        instructor:    $('o-instructor').value.trim() || null,
        capacity:      $('o-capacity').value ? Number($('o-capacity').value) : null,
        created_by:    STAFF_ID,
    };

    if (PREVIEW) {
        OFFERINGS.push({ ...row, id: Date.now() });
        renderOfferings();
        clearOfferingForm();
        return showMsg('sched-msg', 'Offering added (preview only — not saved).', 'success');
    }

    const { error } = await supabase.from('subject_offering').insert([row]);

    if (error) {
        console.error('offering insert failed:', error.message);
        return showMsg('sched-msg',
            error.code === '23505'
                ? 'That section already exists for this subject and term.'
                : 'Could not add that offering. ' + error.message);
    }

    await loadOfferings();
    clearOfferingForm();
    showMsg('sched-msg', 'Offering added.', 'success');
}

function clearOfferingForm() {
    ['o-section','o-days','o-start','o-end','o-room','o-instructor','o-capacity']
        .forEach(id => { $(id).value = ''; });
}

async function dropOffering(id) {
    if (PREVIEW) {
        OFFERINGS = OFFERINGS.filter(o => o.id !== id);
        return renderOfferings();
    }

    const { error } = await supabase.from('subject_offering').delete().eq('id', id);

    if (error) {
        console.error('offering delete failed:', error.message);
        return showMsg('sched-msg', 'Could not remove that offering.');
    }

    await loadOfferings();
    showMsg('sched-msg', 'Offering removed.', 'success');
}

$('add-offering')?.addEventListener('click', addOffering);


/* ============================================================
   GRADE UPLOAD – Part A: File Reading + Validation
   ============================================================ */

let gradeState = {
    ready: false,
    rows: [],
    studentMap: null,
    subjectMap: null
};

function initGrades() {
    if (!gradeState.ready) {
        const y = $('g-year');
        if (y && !y.value) y.value = currentAcademicYear();
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
    const passing = Number($('g-passing').value) || 3.0;
    const year = Number($('g-year').value);
    const term = Number($('g-term').value);

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
    const box = $('grade-preview');
    if (!box) return;

    box.style.display = 'block';

    const warned = ok.filter(r => r.name_warning);
    let html = '';

    html += `
        <div class="notice ${bad.length ? 'pending' : 'info'}">
            <i class="fa-solid ${bad.length ? 'fa-triangle-exclamation' : 'fa-circle-check'}"></i>
            <div>
                <strong>${ok.length} valid${bad.length ? `, ${bad.length} rejected` : ''}</strong>
                <span class="dim"> · ${fileName} · Passing: ${passing.toFixed(1)}</span>
            </div>
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
                </div>
            </div>
        `;
    }

    if (bad.length) {
        html += `
            <h3 class="group-head" style="margin-top:var(--s3);">Rejected rows</h3>
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
            <h3 class="group-head" style="margin-top:var(--s3);">Ready to save (${ok.length})</h3>
            <div class="table-wrap">
                <table class="data-table">
                    <thead><tr><th>ID</th><th>Name</th><th>Subject</th><th class="num">Grade</th><th>Status</th></tr></thead>
                    <tbody>${ok.slice(0, 15).map(r => `
                        <tr>
                            <td class="mono">${escapeHtml(r.student.student_id)}</td>
                            <td>${escapeHtml(r.student.first_name)} ${escapeHtml(r.student.last_name)}</td>
                            <td class="mono">${escapeHtml(r.subject.code)}</td>
                            <td class="num">${r.grade_points == null ? '—' : r.grade_points.toFixed(2)}</td>
                            <td><span class="pill ${r.status === 'PASSED' ? 'ok' : r.status === 'FAILED' ? 'bad' : 'info'}">${r.status}</span></td>
                        </tr>
                    `).join('')}</tbody>
                </table>
                ${ok.length > 15 ? `<p class="dim">and ${ok.length - 15} more</p>` : ''}
            </div>
            <button class="btn-accent" id="commit-grades" style="margin-top:var(--s3);">
                <i class="fa-solid fa-check"></i> Save ${ok.length} record${ok.length > 1 ? 's' : ''}
            </button>
        `;
    }

    box.innerHTML = html;

    $('commit-grades')?.addEventListener('click', () => {
        commitGrades(fileName, bad, passing);
    });
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

    const year = Number($('g-year').value);
    const term = Number($('g-term').value);

    if (PREVIEW) {
        $('grade-preview').innerHTML = `
            <div class="notice info">
                <i class="fa-solid fa-check"></i>
                <div>
                    <strong>${gradeState.rows.length} records saved (preview)</strong>
                    <p class="dim">No changes were written to the database.</p>
                </div>
            </div>
        `;
        $('grade-file').value = '';
        showMsg('grade-msg', `${gradeState.rows.length} records saved (preview).`, 'success');
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
        $('grade-file').value = '';

        await loadGradeHistory();

        let msg = `${records.length} record${records.length === 1 ? '' : 's'} saved.`;
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
    const csv = [
        'student_id,student_name,subject_code,grade,status,term,academic_year',
        '2401187,Althea Villanueva,CC-COMPROG12,2.25,,1,2026',
        '2401187,Althea Villanueva,SOCIO101,1.75,,1,2026',
        '2401187,Althea Villanueva,RIZAL101,2.00,,1,2026',
    ].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'grade-template.csv';
    a.click();
    URL.revokeObjectURL(url);
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
        .select('id, user_id, first_name, last_name, employee_id, email, department, is_approved')
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
    renderNotice(staff);

    await loadCurriculum();
    route();
})();

})();