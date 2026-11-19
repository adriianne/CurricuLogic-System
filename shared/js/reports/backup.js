// backup.js
// The System administrator's manual database backup (Admin > Backup): build one file from the system's tables, check a file, and
// turn a file back into SQL to restore it. No page code here, so it is unit-tested.
//
//   DatabaseBackup.create(client, { onProgress })  -> { file, text, rows, warnings }   reads through admin_backup_tables / admin_backup_page (db/127)
//   DatabaseBackup.verify(text)                    -> { ok, problems, warnings, info }  is this file complete and unchanged?
//   DatabaseBackup.summarize(file, { bytes }) -> what is inside, for the page: areas, tables, row counts, date ranges, plain-words facts
//   DatabaseBackup.preview(file, table)         -> the first rows of one table, with private values masked
//   DatabaseBackup.fileName(date)                  -> 'curriculogic-backup-2026-11-19-1030.json'
//   DatabaseBackup.backupSql(file)                 -> [{ table, name, sql }]            restore scripts, in dependency order (docs/BACKUP-RESTORE.md)
//   DatabaseBackup.restoreSql(table, rows, opts)   -> [statement, ...]                  the INSERTs for one table
//
// The file is one JSON document:
//   { format: 'curriculogic-backup', version: 1, createdAt, counts: { table: rowCount }, sha256, warnings, tables: { table: [row, ...] } }
// sha256 is the SHA-256 of JSON.stringify(tables): any change to the data after the backup was made shows in verify().
//
// What a backup does NOT hold (db/127): Supabase's login users (emails, password hashes), Cura's chat messages, login-attempt and
// AI-usage counters, staging tables.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('../records/systemlogs.js'));
    else root.DatabaseBackup = factory(root.CurriculogicSystemLogs);
}(typeof self !== 'undefined' ? self : this, function (SL) {
'use strict';

const FORMAT = 'curriculogic-backup';
const VERSION = 1;
const PAGE = 500;

/* Every table in a backup, in RESTORE order: a table comes after every table it points at. Kept equal to
   _backup_table_list() in db/127 (a test compares them). */
const TABLES = [
    'program', 'department_staff', 'faculty_staff', 'registrar_staff', 'system_administrator',
    'prospectus', 'subject', 'prerequisite', 'elective_group', 'elective_group_member',
    'university_student', 'subject_offering', 'academic_record', 'grade_file', 'grade_file_row',
    'request', 'request_item', 'request_review', 'form_print', 'notification',
    'student_preference', 'advisee_assignment', 'department_program', 'faculty_program', 'registrar_program',
    'expected_student', 'bulk_upload_history', 'system_config', 'student_id_counter',
    'audit_log', 'account_stop_log', 'maintenance_log',
];

/* The tables whose numeric key is counted by a sequence (serial or identity), and the column that holds it. Only these get the
   counter fix after a restore: the others use uuid or natural keys, where max() would not even compile. Read from the live schema
   on 19 Nov 2026 (a test checks every name is in TABLES). */
const SEQUENCES = {
    academic_record: 'id', account_stop_log: 'seq', audit_log: 'id', elective_group: 'id', elective_group_member: 'id',
    form_print: 'id', grade_file: 'id', grade_file_row: 'id', maintenance_log: 'id', notification: 'id', prerequisite: 'id',
    program: 'id', prospectus: 'id', request: 'id', request_item: 'id', request_review: 'id', subject: 'id', subject_offering: 'id',
};

async function sha256(text) {
    const subtle = (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.subtle) || null;
    if (!subtle) throw new Error('This browser cannot compute the checksum.');
    const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function create(client, { onProgress = () => {}, pageSize = PAGE, now = () => new Date() } = {}) {
    const size = Math.min(Math.max(Number(pageSize) || PAGE, 1), 1000);
    const { data: list, error } = await client.rpc('admin_backup_tables');
    if (error) throw new Error(error.message);
    const names = list ?? [];
    const total = names.reduce((t, x) => t + (Number(x.row_count) || 0), 0);

    const tables = {};
    const counts = {};
    const warnings = [];
    let done = 0;
    for (const [i, t] of names.entries()) {
        const rows = [];
        for (let from = 0; ; from += size) {
            const { data, error: pageError } = await client.rpc('admin_backup_page', { p_table: t.table_name, p_from: from, p_size: size });
            if (pageError) throw new Error(`${t.table_name}: ${pageError.message}`);
            const part = data ?? [];
            rows.push(...part);
            onProgress({ table: t.table_name, tableIndex: i, tables: names.length, tableRows: rows.length, tableTotal: Number(t.row_count) || 0, done: done + rows.length, total });
            if (part.length < size) break;
        }
        if (rows.length !== (Number(t.row_count) || 0)) {
            warnings.push(`${t.table_name}: ${rows.length} rows read, ${t.row_count} counted at the start (the data changed while the backup ran)`);
        }
        tables[t.table_name] = rows;
        counts[t.table_name] = rows.length;
        done += rows.length;
    }
    const checksum = await sha256(JSON.stringify(tables));
    const file = { format: FORMAT, version: VERSION, createdAt: now().toISOString(), counts, sha256: checksum, warnings, tables };
    return { file, text: JSON.stringify(file), rows: done, warnings };
}

/* Is this text a complete, unchanged backup? Never throws: the answer is in the result. */
async function verify(text) {
    const problems = [];
    const warnings = [];
    let file;
    try { file = JSON.parse(text); } catch (e) { return { ok: false, problems: ['This is not a backup file (it is not valid JSON).'], warnings, info: null }; }
    if (!file || file.format !== FORMAT) return { ok: false, problems: ['This is not a CurricuLogic backup file.'], warnings, info: null };
    if (Number(file.version) > VERSION) problems.push(`This file is from a newer version (${file.version}) than this page understands (${VERSION}).`);

    const tables = file.tables && typeof file.tables === 'object' ? file.tables : {};
    const counts = file.counts && typeof file.counts === 'object' ? file.counts : {};
    for (const t of TABLES) if (!(t in tables)) problems.push(`The table ${t} is missing.`);
    let rows = 0;
    for (const [name, list] of Object.entries(tables)) {
        if (!Array.isArray(list)) { problems.push(`The table ${name} is not a list of rows.`); continue; }
        rows += list.length;
        if (counts[name] !== list.length) problems.push(`${name}: the file says ${counts[name] ?? 'nothing'} rows but holds ${list.length}.`);
        if (!TABLES.includes(name)) warnings.push(`The file holds a table this page does not know: ${name}.`);
    }
    try {
        if ((await sha256(JSON.stringify(tables))) !== file.sha256) problems.push('The data was changed after the backup was made (the checksum does not match).');
    } catch (e) {
        warnings.push(e.message);
    }
    for (const w of Array.isArray(file.warnings) ? file.warnings : []) warnings.push(`When it was made: ${w}`);
    return { ok: problems.length === 0, problems, warnings, info: { createdAt: file.createdAt ?? null, tables: Object.keys(tables).length, rows } };
}

/* ---- what is inside a file (Admin > Backup > Check a backup file) ---- */

/* The 32 tables in six plain areas, for the chart and the list. */
const AREAS = [
    { key: 'accounts', label: 'Accounts', tables: ['university_student', 'faculty_staff', 'registrar_staff', 'department_staff', 'system_administrator', 'advisee_assignment', 'department_program', 'faculty_program', 'registrar_program'] },
    { key: 'curriculum', label: 'Curriculum', tables: ['program', 'prospectus', 'subject', 'prerequisite', 'elective_group', 'elective_group_member'] },
    { key: 'schedule', label: 'Schedule', tables: ['subject_offering'] },
    { key: 'grades', label: 'Grades', tables: ['academic_record', 'grade_file', 'grade_file_row'] },
    { key: 'requests', label: 'Requests', tables: ['request', 'request_item', 'request_review', 'form_print', 'notification', 'student_preference'] },
    { key: 'settings', label: 'Lists, settings and logs', tables: ['expected_student', 'bulk_upload_history', 'system_config', 'student_id_counter', 'audit_log', 'account_stop_log', 'maintenance_log'] },
];

const TABLE_LABELS = {
    program: 'Programmes', department_staff: 'Department staff', faculty_staff: 'Faculty staff', registrar_staff: 'Registrar staff',
    system_administrator: 'Administrators', prospectus: 'Curricula', subject: 'Subjects', prerequisite: 'Prerequisite rules',
    elective_group: 'Elective groups', elective_group_member: 'Elective group members', university_student: 'Students',
    subject_offering: 'Scheduled class meetings', academic_record: 'Grade records', grade_file: 'Grade uploads', grade_file_row: 'Grade upload rows',
    request: 'Advising requests', request_item: 'Request subjects', request_review: 'Request reviews', form_print: 'Form prints',
    notification: 'Notifications', student_preference: 'Student preferences', advisee_assignment: 'Adviser assignments',
    department_program: 'Department programmes', faculty_program: 'Faculty programmes', registrar_program: 'Registrar programmes',
    expected_student: 'EDP list', bulk_upload_history: 'Upload history', system_config: 'System settings', student_id_counter: 'Student ID counter',
    audit_log: 'Audit log', account_stop_log: 'Account stop log', maintenance_log: 'Cleanup log',
};

const areaOf = (table) => AREAS.find((a) => a.tables.includes(table)) ?? null;

/* The column that says when a row was made, if the table has one. */
const DATE_COLUMNS = ['created_at', 'ran_at', 'printed_at', 'sent_at', 'updated_at'];

function dayOf(value) {
    if (value === null || value === undefined || value === '') return null;
    let text = String(value).trim().replace(' ', 'T');
    if (/[+-]\d{2}$/.test(text)) text += ':00';
    const ms = new Date(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text) ? text : text + 'Z').getTime();
    return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : null;
}

function dateRange(rows) {
    const col = DATE_COLUMNS.find((c) => (rows ?? []).some((r) => r && r[c] !== undefined && r[c] !== null));
    if (!col) return { oldest: null, newest: null };
    const days = rows.map((r) => dayOf(r?.[col])).filter(Boolean).sort();
    return days.length ? { oldest: days[0], newest: days[days.length - 1] } : { oldest: null, newest: null };
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/* What the file holds, in plain words. Only things that exist are mentioned. */
function factsOf(counts, ranges) {
    const c = (t) => Number(counts[t]) || 0;
    const out = [];
    if (c('university_student')) out.push(plural(c('university_student'), 'student', 'students'));
    const staff = c('faculty_staff') + c('registrar_staff') + c('department_staff');
    if (staff) out.push(`${plural(staff, 'staff account', 'staff accounts')} (${c('faculty_staff')} faculty, ${c('registrar_staff')} registrar, ${c('department_staff')} department)`);
    if (c('system_administrator')) out.push(plural(c('system_administrator'), 'administrator', 'administrators'));
    if (c('program')) out.push(plural(c('program'), 'programme', 'programmes'));
    if (c('subject')) out.push(`${plural(c('subject'), 'subject', 'subjects')}${c('prospectus') ? ` in ${plural(c('prospectus'), 'curriculum', 'curricula')}` : ''}`);
    if (c('prerequisite')) out.push(plural(c('prerequisite'), 'prerequisite rule', 'prerequisite rules'));
    if (c('academic_record')) out.push(plural(c('academic_record'), 'grade record', 'grade records'));
    if (c('subject_offering')) out.push(plural(c('subject_offering'), 'scheduled class meeting', 'scheduled class meetings'));
    if (c('request')) out.push(`${plural(c('request'), 'advising request', 'advising requests')}${c('request_item') ? ` with ${plural(c('request_item'), 'subject', 'subjects')}` : ''}`);
    if (c('expected_student')) out.push(plural(c('expected_student'), 'entry on the EDP list', 'entries on the EDP list'));
    const log = ranges.audit_log;
    if (c('audit_log')) out.push(`${plural(c('audit_log'), 'audit log entry', 'audit log entries')}${log?.oldest ? ` from ${log.oldest} to ${log.newest}` : ''}`);
    return out;
}

/*
 * A summary of a backup file for the page, from the parsed file (verify() has already said whether it can be trusted):
 *   { createdAt, bytes, checksum, warnings, totalRows,
 *     tables: [{ name, label, area, areaLabel, rows, oldest, newest }]  (in area order),
 *     areas:  [{ key, label, rows, tables }],  facts: ['32 students', ...] }
 */
function summarize(file, { bytes = null } = {}) {
    const data = file && typeof file.tables === 'object' && file.tables ? file.tables : {};
    const tables = [];
    const ranges = {};
    const counts = {};
    for (const area of AREAS) {
        for (const name of area.tables) {
            const rows = Array.isArray(data[name]) ? data[name] : [];
            const range = dateRange(rows);
            ranges[name] = range;
            counts[name] = rows.length;
            tables.push({ name, label: TABLE_LABELS[name] ?? name, area: area.key, areaLabel: area.label, rows: rows.length, oldest: range.oldest, newest: range.newest });
        }
    }
    const areas = AREAS.map((a) => ({
        key: a.key, label: a.label,
        tables: a.tables.length,
        rows: tables.filter((t) => t.area === a.key).reduce((n, t) => n + t.rows, 0),
    }));
    return {
        createdAt: file?.createdAt ?? null,
        bytes,
        checksum: typeof file?.sha256 === 'string' ? file.sha256.slice(0, 12) : '',
        warnings: Array.isArray(file?.warnings) ? file.warnings : [],
        totalRows: tables.reduce((n, t) => n + t.rows, 0),
        tables, areas,
        facts: factsOf(counts, ranges),
    };
}

const PHONE = /phone|mobile|contact_?no/i;

/* One value of a preview, as the screen may show it: passwords, tokens and photos hidden, an email as j***@host (shown() in
   systemlogs.js), a phone number as dots with its last two digits, long values cut. */
function previewCell(field, value) {
    if (value === null || value === undefined || value === '') return '—';
    if (PHONE.test(field)) {
        const t = String(value);
        return t.length > 4 ? '•'.repeat(t.length - 2) + t.slice(-2) : '••••';
    }
    const shown = SL.shown(field, value);
    return shown === '(empty)' ? '—' : shown;
}

/* The first rows of one table, masked: { columns: [...], rows: [[...]], more: columns not shown, total: rows in the table }. */
function preview(file, table, { limit = 5, maxColumns = 10 } = {}) {
    const rows = Array.isArray(file?.tables?.[table]) ? file.tables[table] : [];
    const first = rows.slice(0, limit);
    const all = [...new Set(first.flatMap((r) => Object.keys(r ?? {})))];
    const columns = all.slice(0, maxColumns);
    return {
        columns,
        rows: first.map((r) => columns.map((c) => previewCell(c, r?.[c]))),
        more: Math.max(0, all.length - columns.length),
        total: rows.length,
    };
}

function fileName(date = new Date()) {
    const iso = new Date(date).toISOString();            // 2026-11-19T10:30:00.000Z
    return `curriculogic-backup-${iso.slice(0, 10)}-${iso.slice(11, 13)}${iso.slice(14, 16)}.json`;
}

const IDENT = /^[a-z_][a-z0-9_]*$/;

/* The INSERTs for one table: rows go in as JSON through jsonb_populate_recordset, so every column keeps its type. A row that is
   already there is skipped (on conflict do nothing), so running a script twice does no harm. */
function restoreSql(table, rows, { schema = 'public', chunk = 200 } = {}) {
    if (!TABLES.includes(table)) throw new Error(`${table} is not a table of a backup.`);
    if (!IDENT.test(schema)) throw new Error('Bad schema name.');
    const out = [];
    for (let i = 0; i < (rows ?? []).length; i += chunk) {
        const json = JSON.stringify(rows.slice(i, i + chunk));
        let tag = '$bk$';
        while (json.includes(tag)) tag = tag.slice(0, -1) + 'k$';
        out.push(`insert into ${schema}.${table} overriding system value\nselect * from jsonb_populate_recordset(null::${schema}.${table}, ${tag}${json}${tag}::jsonb)\non conflict do nothing;`);
    }
    return out;
}

/* After rows with their own ids went in, the id counter of a table must be moved past them, or the next new row collides. */
function sequenceSql(table, { schema = 'public' } = {}) {
    const col = SEQUENCES[table];
    if (!col) return '';
    return `select setval(pg_get_serial_sequence('${schema}.${table}', '${col}'), (select max(${col}) from ${schema}.${table}))\n where exists (select 1 from ${schema}.${table});`;
}

const PREFIX = `-- Restore script made by CurricuLogic (docs/BACKUP-RESTORE.md). Run the files in order, in the Supabase SQL editor.
-- Triggers are switched off for this session so the restore does not write new audit rows or recompute data.
do $$ begin set session_replication_role = replica; exception when others then raise notice 'could not switch triggers off: %', sqlerrm; end $$;
`;

/* One script per non-empty table, in restore order: [{ table, name: '04_university_student.sql', sql, rows }]. */
function backupSql(file, options = {}) {
    const out = [];
    let n = 0;
    for (const table of TABLES) {
        n++;
        const rows = file?.tables?.[table] ?? [];
        if (!rows.length) continue;
        const counter = sequenceSql(table, options);
        const sql = [PREFIX, `-- ${table}: ${rows.length} row${rows.length === 1 ? '' : 's'}`, ...restoreSql(table, rows, options), ...(counter ? [counter] : []), ''].join('\n');
        out.push({ table, name: `${String(n).padStart(2, '0')}_${table}.sql`, sql, rows: rows.length });
    }
    return out;
}

return { create, verify, fileName, restoreSql, sequenceSql, backupSql, sha256, summarize, preview, previewCell, areaOf, AREAS, TABLE_LABELS, TABLES, SEQUENCES, FORMAT, VERSION, PAGE };
}));
