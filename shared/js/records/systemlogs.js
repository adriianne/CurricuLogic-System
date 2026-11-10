// systemlogs.js
//
// What the Administrator's "System logs" page shows, worked out from rows the page has already read from the
// project's own log tables (audit_log, account_stop_log, bulk_upload_history, maintenance_log, cura_usage).
// Pure functions: no page, no database, so every rule is tested (tests/systemlogs.test.mjs).
//
//   actionLabel / tableLabel / roleLabel   plain words for the codes the tables store
//   changesOf(row)                         what an audit entry changed, with private values masked
//   agoLabel / durationLabel               "3 hours ago", "37.7 s"
//   curaSummary(rows, nowMs, hours)        requests, success rate, times, models, tries
//   lastCleanup(rows, nowMs)               when the nightly cleanup last really ran, and whether that is on time
//   statusPill(status)                     the colour and word for a Cura request's outcome
//
// Masking: an audit entry for a removed or created account holds the whole row. The Administrator may see it, but the
// page still shows passwords and tokens as dots and an email as j***@host, and cuts long values, so a screenshot of
// this page does not spread more personal data than it has to.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.CurriculogicSystemLogs = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const TABLE_LABELS = {
    university_student: 'Student',
    faculty_staff: 'Faculty',
    registrar_staff: 'Registrar',
    department_staff: 'Department',
    system_administrator: 'Administrator',
    prospectus: 'Prospectus',
    program: 'Programme',
    subject: 'Subject',
    subject_offering: 'Section',
    request: 'Request',
    request_item: 'Request item',
    system_config: 'System setting',
    expected_student: 'EDP list',
};

const ROLE_LABELS = {
    system_administrator: 'Administrator',
    registrar_staff: 'Registrar',
    faculty_staff: 'Faculty',
    department_staff: 'Department',
    student: 'Student',
    system: 'System (automatic)',
};

const VERBS = {
    PROVISION: 'Created account',
    INSERT: 'Added',
    UPDATE: 'Changed',
    DELETE: 'Deleted',
    COPY: 'Copied',
    ACTIVATE: 'Activated',
    RETIRE: 'Retired',
};

const MAX_VALUE = 60;       // longest value shown before it is cut
const MAX_FIELDS = 8;       // most fields listed for a whole-row entry

/*
 * A time as milliseconds. Some log tables (audit_log) store a time WITHOUT a zone, and the database clock is UTC, so a
 * time with no zone on it is read as UTC. Left to the browser it would be read as local time and show hours off.
 */
function parseTime(value) {
    if (value === null || value === undefined || value === '') return NaN;
    if (value instanceof Date) return value.getTime();
    let text = String(value).trim().replace(' ', 'T');
    // The database writes a zone as "+00"; JavaScript needs "+00:00".
    if (/[+-]\d{2}$/.test(text)) text += ':00';
    const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text);
    return new Date(hasZone ? text : text + 'Z').getTime();
}

const titleCase = (s) => String(s ?? '').toLowerCase().replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());

function actionLabel(action) {
    const a = String(action ?? '');
    const verb = a.split('_')[0];
    return VERBS[verb] ?? (a ? titleCase(a) : 'Unknown');
}

function tableLabel(table) {
    const t = String(table ?? '');
    return TABLE_LABELS[t] ?? (t ? titleCase(t) : '');
}

function roleLabel(role) {
    const r = String(role ?? '');
    return ROLE_LABELS[r] ?? (r ? titleCase(r) : 'Unknown');
}

/* ---- private values ---- */

const HIDDEN_FIELD = /pass(word)?|token|secret|hash|otp|photo|avatar|api_?key/i;

function maskEmail(value) {
    const m = String(value).match(/^([^@]{1,})@(.+)$/);
    return m ? `${m[1][0]}***@${m[2]}` : String(value);
}

/* One value as the page may show it. Returns a short string. */
function shown(field, value) {
    if (value === null || value === undefined) return '(empty)';
    if (HIDDEN_FIELD.test(field)) return '••••';
    let text = typeof value === 'object' ? JSON.stringify(value) : String(value);
    if (/e[-_]?mail/i.test(field)) text = maskEmail(text);
    return text.length > MAX_VALUE ? text.slice(0, MAX_VALUE - 1) + '…' : text;
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/*
 * What an audit entry did, as { fields: [{ field, from, to }], more }.
 *   an update lists only the fields whose value is in the entry (the table records just what changed);
 *   a created or removed row lists its first few fields, from or to "(empty)", and counts the rest in "more".
 */
function changesOf(row) {
    const oldV = isObject(row?.old_values) ? row.old_values : null;
    const newV = isObject(row?.new_values) ? row.new_values : null;

    if (oldV && newV) {
        const keys = [...new Set([...Object.keys(oldV), ...Object.keys(newV)])].sort();
        const fields = keys
            .filter(k => JSON.stringify(oldV[k]) !== JSON.stringify(newV[k]))
            .map(k => ({ field: k, from: shown(k, oldV[k]), to: shown(k, newV[k]) }));
        return { fields: fields.slice(0, MAX_FIELDS), more: Math.max(0, fields.length - MAX_FIELDS) };
    }

    const whole = newV ?? oldV;
    if (!whole) return { fields: [], more: 0 };
    // "id" and the sign-in link are noise in a whole-row entry; the record is already named in its own column.
    const keys = Object.keys(whole).filter(k => k !== 'id' && k !== 'user_id').sort();
    const fields = keys.slice(0, MAX_FIELDS).map(k => (
        newV ? { field: k, from: '(empty)', to: shown(k, whole[k]) } : { field: k, from: shown(k, whole[k]), to: '(empty)' }
    ));
    return { fields, more: Math.max(0, keys.length - MAX_FIELDS) };
}

/* ---- times ---- */

function agoLabel(iso, nowMs = Date.now()) {
    const t = parseTime(iso);
    if (!Number.isFinite(t)) return '';
    const s = Math.max(0, Math.round((nowMs - t) / 1000));
    if (s < 60) return 'just now';
    const m = Math.floor(s / 60);
    if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
    const d = Math.floor(h / 24);
    return `${d} day${d === 1 ? '' : 's'} ago`;
}

function durationLabel(ms) {
    const n = Number(ms);
    if (!Number.isFinite(n) || n < 0) return '';
    if (n < 1000) return `${Math.round(n)} ms`;
    return `${(n / 1000).toFixed(n < 10000 ? 1 : 0)} s`;
}

/* ---- Cura usage ---- */

function percentile(sorted, p) {
    if (!sorted.length) return null;
    const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
    return sorted[i];
}

/*
 * The rows of cura_usage from the last `hours` hours, summed up.
 *   successRate is a whole percent, or null when there were no requests.
 */
function curaSummary(rows, nowMs = Date.now(), hours = 24) {
    const since = nowMs - hours * 3600 * 1000;
    const list = (rows ?? []).filter(r => {
        const t = parseTime(r.created_at);
        return Number.isFinite(t) && t >= since && t <= nowMs + 60000;
    });

    const count = (status) => list.filter(r => r.status === status).length;
    // A missing time is not 0 ms: Number(null) is 0, so it is left out before it is read.
    const times = list.filter(r => r.duration_ms !== null && r.duration_ms !== undefined)
        .map(r => Number(r.duration_ms)).filter(Number.isFinite).sort((a, b) => a - b);
    const tries = list.map(r => r.attempts).filter(Number.isInteger);
    const models = new Map();
    for (const r of list) if (r.model) models.set(r.model, (models.get(r.model) ?? 0) + 1);

    const ok = count('ok');
    return {
        total: list.length,
        ok,
        busy: count('busy'),
        error: count('error'),
        badRequest: count('bad_request'),
        successRate: list.length ? Math.round(ok / list.length * 100) : null,
        avgMs: times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null,
        p95Ms: percentile(times, 0.95),
        maxMs: times.length ? times[times.length - 1] : null,
        avgAttempts: tries.length ? Math.round(tries.reduce((a, b) => a + b, 0) / tries.length * 10) / 10 : null,
        retried: list.filter(r => Number.isInteger(r.attempts) && r.attempts > 1).length,
        withWishes: list.filter(r => r.had_wishes === true).length,
        byModel: [...models].map(([model, n]) => ({ model, count: n })).sort((a, b) => b.count - a.count),
    };
}

function statusPill(status) {
    switch (status) {
        case 'ok': return { cls: 'ok', label: 'OK' };
        case 'busy': return { cls: 'waiting', label: 'Busy' };
        case 'error': return { cls: 'bad', label: 'Error' };
        case 'bad_request': return { cls: 'info', label: 'Refused' };
        default: return { cls: 'info', label: String(status ?? '') };
    }
}

/* ---- the nightly cleanup ---- */

const CLEANUP_LATE_HOURS = 26;     // the job runs every 24 hours; a little slack before it is called late

/*
 * rows of maintenance_log. Only a real run counts (a dry run is someone counting by hand), and one run writes one
 * line per rule at the same moment, so the latest ran_at is "the last run".
 *   -> { state: 'ok' | 'late' | 'none', ranAt, hoursAgo, tasks: [{ task, rowsFound }] (that run's lines) }
 */
function lastCleanup(rows, nowMs = Date.now()) {
    const real = (rows ?? []).filter(r => r.dry_run === false && Number.isFinite(parseTime(r.ran_at)));
    if (!real.length) return { state: 'none', ranAt: null, hoursAgo: null, tasks: [] };

    const latest = Math.max(...real.map(r => parseTime(r.ran_at)));
    // The lines of one run share a moment, to within a second.
    const run = real.filter(r => latest - parseTime(r.ran_at) < 1000);
    const hoursAgo = Math.max(0, (nowMs - latest) / 3600000);
    return {
        state: hoursAgo > CLEANUP_LATE_HOURS ? 'late' : 'ok',
        ranAt: new Date(latest).toISOString(),
        hoursAgo: Math.round(hoursAgo * 10) / 10,
        tasks: run.map(r => ({ task: r.task, rowsFound: r.rows_found })).sort((a, b) => a.task.localeCompare(b.task)),
    };
}

/* ---- the activity chart and the colours on the Activity table ---- */

const pad2 = (n) => String(n).padStart(2, '0');
const dayKey = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };

/*
 * How many activity rows fall on each of the last `days` days (today included), oldest first, for the bar chart.
 * Days are the viewer's own calendar days. A row with no readable time is left out.
 *   -> [{ key: '2026-10-28', label: 'Wed', dayNumber: 28, full: 'Wed, Oct 28', count,
 *         kinds: { Changed: 30, Added: 2 },          what was done that day, by plain word
 *         startIso, endIso }]                        the day as exact instants, to filter the table by
 */
function perDay(rows, nowMs = Date.now(), days = 7) {
    const out = [];
    for (let i = days - 1; i >= 0; i--) {
        const d = new Date(nowMs);
        d.setHours(12, 0, 0, 0);
        d.setDate(d.getDate() - i);
        const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
        out.push({
            key: dayKey(d.getTime()),
            label: d.toLocaleDateString('en', { weekday: 'short' }),
            dayNumber: d.getDate(),
            full: d.toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' }),
            count: 0,
            kinds: {},
            startIso: start.toISOString(),
            endIso: next.toISOString(),
        });
    }
    const slot = new Map(out.map(o => [o.key, o]));
    for (const r of rows ?? []) {
        const t = parseTime(r?.created_at);
        if (!Number.isFinite(t)) continue;
        const s = slot.get(dayKey(t));
        if (!s) continue;
        s.count += 1;
        const kind = actionLabel(r.action);
        s.kinds[kind] = (s.kinds[kind] ?? 0) + 1;
    }
    return out;
}

/* The sentence under the chart when a day is picked: "Thu, Oct 29: 33 changes (30 changed, 2 added, 1 deleted)." */
function dayNote(day) {
    if (!day) return '';
    if (!day.count) return `No changes on ${day.full}.`;
    const parts = Object.entries(day.kinds).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${k.toLowerCase()}`);
    return `${day.full}: ${day.count} ${day.count === 1 ? 'change' : 'changes'} (${parts.join(', ')}).`;
}

/*
 * A tidy top for the chart's scale: whole numbers only, at most 5 steps above zero.
 *   axisMax(33) -> { max: 40, step: 10, ticks: [0, 10, 20, 30, 40] }      axisMax(3) -> { max: 3, step: 1, ticks: [0, 1, 2, 3] }
 */
function axisMax(highest) {
    const n = Math.max(1, Math.ceil(Number(highest) || 0));
    let step = 1;
    if (n > 5) {
        const mag = Math.pow(10, Math.floor(Math.log10(n)));
        step = [0.1, 0.2, 0.5, 1, 2, 5, 10].map(f => Math.max(1, Math.round(f * mag))).find(st => Math.ceil(n / st) <= 5) ?? mag * 10;
    }
    const max = Math.ceil(n / step) * step;
    const ticks = [];
    for (let t = 0; t <= max; t += step) ticks.push(t);
    return { max, step, ticks };
}

/*
 * One short line for the Activity table, from changesOf(row): the first field that changed, and how many more there are.
 *   -> { text: 'approval_status: pending → approved +2 more', total: 3 }      total = every field in the entry
 *   -> { text: '', total: 0 } when the entry recorded no fields
 */
function changeSummary(changes) {
    const fields = changes?.fields ?? [];
    if (!fields.length) return { text: '', total: 0 };
    const total = fields.length + (changes.more ?? 0);
    const first = fields[0];
    const extra = total - 1;
    return { text: first.field + ': ' + first.from + ' → ' + first.to + (extra > 0 ? ' +' + extra + ' more' : ''), total };
}

/* ---- the User status page ---- */

const USER_ROLES = ['student', 'faculty', 'registrar', 'department'];
const USER_STATES = ['active', 'stopped', 'pending', 'declined'];
const ROLE_ORDER = { student: 0, faculty: 1, registrar: 2, department: 3 };

/*
 * One row per account for the table, from the lists the page already has.
 *   students / staff   rows as the Admin pages read them (staff rows carry their own `role`)
 *   signIns            Map of 'role:id' -> a time (text or milliseconds) for when that account last signed in
 *   stateOf(role, row) 'active' | 'stopped' | 'pending' | 'declined' (accountstop.js decides)
 * Newest sign-in first; accounts that never signed in come last, by name.
 *   -> [{ key, role, id, name, ident, email, programId, state, lastSignIn (ms or null), createdAt }]
 */
function buildUsers({ students = [], staff = [], signIns = new Map(), stateOf }) {
    const nameOf = (r) => [r.first_name, r.last_name].filter(Boolean).join(' ').trim() || 'Unnamed';
    const make = (role, r) => {
        const key = role + ':' + r.id;
        const t = signIns.has(key) ? parseTime(signIns.get(key)) : NaN;
        return {
            key, role, id: r.id, name: nameOf(r),
            ident: (role === 'student' ? r.student_id : r.employee_id) ?? '',
            email: r.email ?? '',
            programId: r.program_id ?? null,
            state: stateOf(role, r),
            lastSignIn: Number.isFinite(t) ? t : null,
            createdAt: r.created_at ?? null,
        };
    };
    const rows = [
        ...students.map(r => make('student', r)),
        ...staff.filter(r => USER_ROLES.includes(r.role)).map(r => make(r.role, r)),
    ];
    return rows.sort((a, b) => {
        if ((a.lastSignIn === null) !== (b.lastSignIn === null)) return a.lastSignIn === null ? 1 : -1;
        if (a.lastSignIn !== b.lastSignIn && a.lastSignIn !== null) return b.lastSignIn - a.lastSignIn;
        return (ROLE_ORDER[a.role] - ROLE_ORDER[b.role]) || a.name.localeCompare(b.name);
    });
}

/* How many accounts of each kind are in each state. -> { student: { active, stopped, pending, declined, total }, ..., all: {...} } */
function statusCounts(rows) {
    const blank = () => ({ active: 0, stopped: 0, pending: 0, declined: 0, total: 0 });
    const out = { all: blank() };
    for (const r of USER_ROLES) out[r] = blank();
    for (const row of rows ?? []) {
        const bucket = out[row.role];
        if (!bucket || !USER_STATES.includes(row.state)) continue;
        for (const b of [bucket, out.all]) { b[row.state] += 1; b.total += 1; }
    }
    return out;
}

/* The table's filters: a role ('' for all), a state ('' for all) and words that must all appear in the name, ID or email. */
function filterUsers(rows, { role = '', state = '', term = '' } = {}) {
    const words = String(term).toLowerCase().split(/\s+/).filter(Boolean);
    return (rows ?? []).filter((r) => {
        if (role && r.role !== role) return false;
        if (state && r.state !== state) return false;
        if (!words.length) return true;
        const hay = (r.name + ' ' + r.ident + ' ' + r.email).toLowerCase();
        return words.every(w => hay.includes(w));
    });
}

/*
 * What the User status filters become when a card, a pill or the Active accounts tile is pressed.
 *   current  { role, state }    what the filters are now ('' means any)
 *   pick     { role, state }    what the pressed thing stands for
 * Pressing the same thing twice goes back to showing everything.
 *   -> { role, state }
 */
function toggleUserFilter(current, pick) {
    const cur = { role: current?.role ?? '', state: current?.state ?? '' };
    const want = { role: pick?.role ?? '', state: pick?.state ?? '' };
    return cur.role === want.role && cur.state === want.state ? { role: '', state: '' } : want;
}

/* The sentence under the filters when a card or tile is in use: 'Showing 26 active Student accounts.' */
function userFilterNote(filter, shown, total) {
    const role = filter?.role ?? '', state = filter?.state ?? '';
    if (!role && !state) return '';
    const kind = role ? role.charAt(0).toUpperCase() + role.slice(1) : '';
    // 'active Student', 'stopped Faculty', 'Student' or 'active', then 'account' or 'accounts'.
    const what = [state, kind].filter(Boolean).join(' ');
    return 'Showing ' + shown + ' ' + what + (shown === 1 ? ' account' : ' accounts') + ' (of ' + total + ').';
}

/* The last sign-in as the table words it: "3 hours ago", or "Never signed in". */
function signInText(ms, nowMs = Date.now()) {
    if (ms === null || ms === undefined || !Number.isFinite(Number(ms))) return { text: 'Never signed in', never: true };
    return { text: agoLabel(new Date(Number(ms)).toISOString(), nowMs), never: false };
}

/* The colour of an action pill: green for new things, amber for changes, red for removals, blue for the rest. */
function actionTone(action) {
    switch (String(action ?? '').split('_')[0]) {
        case 'PROVISION':
        case 'INSERT':   return 'ok';
        case 'UPDATE':   return 'waiting';
        case 'DELETE':   return 'bad';
        default:         return 'info';
    }
}

/* Up to two capital letters for a person's avatar: "Juan Dela Cruz" -> "JD", "Removed account" -> "RA". */
function initials(name) {
    const parts = String(name ?? '').replace(/\(.*?\)/g, ' ').match(/\p{L}[\p{L}'’-]*/gu) ?? [];
    if (!parts.length) return '?';
    const first = parts[0][0];
    const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
    return (first + last).toUpperCase();
}

/* "Juan Dela Cruz (Student)" -> { name: 'Juan Dela Cruz', role: 'Student' }; a plain label has no role. */
function splitPerson(label) {
    const m = String(label ?? '').match(/^(.*?)\s*\(([^()]*)\)\s*$/);
    return m ? { name: m[1], role: m[2] } : { name: String(label ?? ''), role: '' };
}

return {
    actionLabel, tableLabel, roleLabel, changesOf, shown, maskEmail,
    parseTime, agoLabel, durationLabel, curaSummary, statusPill, lastCleanup,
    perDay, dayNote, axisMax, changeSummary, actionTone, initials, splitPerson,
    buildUsers, statusCounts, filterUsers, signInText, toggleUserFilter, userFilterNote, USER_ROLES, USER_STATES,
    CLEANUP_LATE_HOURS,
};

}));
