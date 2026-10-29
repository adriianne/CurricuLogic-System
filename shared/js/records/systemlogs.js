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

return {
    actionLabel, tableLabel, roleLabel, changesOf, shown, maskEmail,
    parseTime, agoLabel, durationLabel, curaSummary, statusPill, lastCleanup,
    CLEANUP_LATE_HOURS,
};

}));
