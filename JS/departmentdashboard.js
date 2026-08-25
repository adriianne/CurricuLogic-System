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
let PROSPECTUS = null;
let SUBJECTS   = [];
let RULES      = [];
let OFFERINGS  = [];
let PREVIEW    = false;


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

    const { data: pros } = await supabase
        .from('prospectus')
        .select('id, academic_year, academic_term, is_active, published_at')
        .eq('is_active', true)
        .maybeSingle();

    PROSPECTUS = pros;

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
        .eq('prospectus_id', pros.id)
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


/* schedule */

let scheduleReady = false;

function schedTerm() {
    return {
        year: Number($('sched-year')?.value) || new Date().getFullYear(),
        term: Number($('sched-term')?.value) || 1,
    };
}

function initSchedule() {
    if (!scheduleReady) {
        const y = $('sched-year');
        if (y && !y.value) y.value = PROSPECTUS?.academic_year ?? new Date().getFullYear();
        renderOfferingOptions();
        scheduleReady = true;
    }
    loadOfferings();
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


/* CSV upload — parsed and checked before anything is written */

const CSV_HEADERS = ['code','section','days','start_time','end_time','room','instructor','capacity'];

$('download-template')?.addEventListener('click', () => {
    const csv = CSV_HEADERS.join(',') + '\n' +
        'CC-INTCOM11,BSIT-1A,MWF,08:00,09:00,LAB 301,,40\n';
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'schedule-template.csv';
    a.click();
    URL.revokeObjectURL(url);
});

$('sched-file')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    previewUpload(text);
});

function parseCsv(text) {
    const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
    if (lines.length === 0) return { rows: [], error: 'The file is empty.' };

    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
    if (!headers.includes('code') || !headers.includes('section')) {
        return { rows: [], error: 'The header row must include at least code and section.' };
    }

    const rows = lines.slice(1).map((line, i) => {
        const cells = line.split(',');
        const row = { __line: i + 2 };
        headers.forEach((h, j) => { row[h] = (cells[j] ?? '').trim(); });
        return row;
    });

    return { rows, error: null };
}

const norm = (c) => (c || '').replace(/\s/g, '').toUpperCase();

let PENDING_ROWS = [];

/* Nothing is written until the operator has seen what will be written.
   The GradeFile design in the ERD implies the same pattern — validate,
   report, then commit — so schedule upload follows it. */
function previewUpload(text) {
    const box = $('upload-preview');
    const { rows, error } = parseCsv(text);

    if (error) {
        box.innerHTML = '';
        return showMsg('sched-msg', error);
    }

    const byCode = new Map(SUBJECTS.map(s => [norm(s.code), s]));
    const ok = [], bad = [];

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
        if (y && !y.value) y.value = PROSPECTUS?.academic_year ?? new Date().getFullYear();
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

    const ok = [], bad = [];

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