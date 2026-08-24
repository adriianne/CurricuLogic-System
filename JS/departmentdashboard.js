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

async function addSubject() {
    showMsg('curriculum-msg', '');

    const code  = $('s-code').value.trim().toUpperCase();
    const title = $('s-title').value.trim();
    const units = Number($('s-units').value);

    if (!code)  return showMsg('curriculum-msg', 'Enter a course code.');
    if (!title) return showMsg('curriculum-msg', 'Enter a descriptive title.');
    if (!Number.isFinite(units) || units <= 0) return showMsg('curriculum-msg', 'Enter the number of units.');

    const clash = SUBJECTS.find(s =>
        s.code.replace(/\s/g, '').toUpperCase() === code.replace(/\s/g, ''));
    if (clash) return showMsg('curriculum-msg', `${clash.code} already exists in this prospectus.`);

    const row = {
        prospectus_id: PROSPECTUS.id,
        code, title, units,
        year_level:  Number($('s-year').value),
        term:        Number($('s-term').value),
        is_elective: $('s-elective').value === 'true',
        created_by:  STAFF_ID,
    };

    if (PREVIEW) {
        SUBJECTS.push({ ...row, id: Date.now() });
        afterLoad();
        clearSubjectForm();
        return showMsg('curriculum-msg', `${code} added (preview only — not saved).`, 'success');
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
    showMsg('curriculum-msg', `${code} added to the prospectus.`, 'success');
}

function clearSubjectForm() {
    ['s-code', 's-title', 's-units'].forEach(id => { $(id).value = ''; });
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
    // created_by references department_staff.id, not user_id.
    STAFF_ID = staff?.id ?? null;

    renderProfile(staff, session.user.email);
    renderNotice(staff);

    await loadCurriculum();
    route();
})();

})();