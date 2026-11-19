// databasebackup.test.mjs
// The System administrator's manual backup (Admin > Backup): building the file, checking it, turning it into restore SQL, the Admin
// page wiring, the tool and the migration (db/127).
//   node --test tests/databasebackup.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const B = require('../shared/js/reports/backup.js');
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

// A stand-in for the Supabase client: admin_backup_tables lists tables, admin_backup_page pages through them.
function fakeClient(data, { failOn = null, drift = {} } = {}) {
    const calls = [];
    return {
        calls,
        rpc: async (name, args) => {
            calls.push([name, args]);
            if (failOn === name) return { data: null, error: { message: 'denied' } };
            if (name === 'admin_backup_tables') return { data: B.TABLES.map((t) => ({ table_name: t, row_count: (data[t] ?? []).length + (drift[t] ?? 0) })), error: null };
            if (name === 'admin_backup_page') {
                if (failOn === args.p_table) return { data: null, error: { message: 'boom' } };
                return { data: (data[args.p_table] ?? []).slice(args.p_from, args.p_from + args.p_size), error: null };
            }
            return { data: null, error: { message: 'unknown rpc' } };
        },
    };
}

const sample = () => ({
    program: [{ id: 1, code: 'BSIT', name: 'BS Information Technology – Cura' }],
    university_student: [{ id: '5e3f2c5f-d0e5-4e29-becc-3efbc050c290', student_id: '24001188', year_level: 2, gpa: 2.5, notes: { a: [1, 2], b: null } }],
    subject: Array.from({ length: 1203 }, (_, i) => ({ id: i + 1, code: 'S' + i, units: 3 })),   // more than two pages of 500
});

describe('create', () => {
    test('reads every table, page by page, and keeps every row', async () => {
        const c = fakeClient(sample());
        const made = await B.create(c, { pageSize: 500 });
        assert.equal(made.file.format, 'curriculogic-backup');
        assert.equal(made.file.tables.subject.length, 1203);
        assert.equal(made.file.counts.subject, 1203);
        assert.equal(made.rows, 1 + 1 + 1203);
        assert.deepEqual(Object.keys(made.file.tables), B.TABLES);      // every table, in restore order, empty ones too
        const subjectPages = c.calls.filter((x) => x[0] === 'admin_backup_page' && x[1].p_table === 'subject').map((x) => x[1].p_from);
        assert.deepEqual(subjectPages, [0, 500, 1000]);
    });
    test('asks for the tables once, first', async () => {
        const c = fakeClient(sample());
        await B.create(c);
        assert.equal(c.calls.filter((x) => x[0] === 'admin_backup_tables').length, 1);
        assert.equal(c.calls[0][0], 'admin_backup_tables');
    });
    test('the page size is held to 1..1000', async () => {
        const c = fakeClient(sample());
        await B.create(c, { pageSize: 99999 });
        assert.ok(c.calls.filter((x) => x[0] === 'admin_backup_page').every((x) => x[1].p_size === 1000));
    });
    test('progress is reported per page, ending at the total', async () => {
        const seen = [];
        await B.create(fakeClient(sample()), { onProgress: (p) => seen.push(p) });
        const last = seen[seen.length - 1];
        assert.equal(last.done, last.total);
        assert.ok(seen.every((p) => p.tables === B.TABLES.length));
    });
    test('a table that changed while the backup ran is warned about, not hidden', async () => {
        const made = await B.create(fakeClient(sample(), { drift: { program: 2 } }));
        assert.equal(made.warnings.length, 1);
        assert.match(made.warnings[0], /program: 1 rows read, 3 counted at the start/);
        assert.deepEqual(made.file.warnings, made.warnings);
    });
    test('a refused or failed read stops the backup with the reason', async () => {
        await assert.rejects(B.create(fakeClient(sample(), { failOn: 'admin_backup_tables' })), /denied/);
        await assert.rejects(B.create(fakeClient(sample(), { failOn: 'subject' })), /subject: boom/);
    });
    test('the file name carries the date and time', () => {
        assert.equal(B.fileName(new Date('2026-11-19T10:30:00Z')), 'curriculogic-backup-2026-11-19-1030.json');
    });
});

describe('verify', () => {
    test('a fresh backup passes, including numbers, unicode and nested JSON', async () => {
        const made = await B.create(fakeClient(sample()));
        const v = await B.verify(made.text);
        assert.equal(v.ok, true, JSON.stringify(v.problems));
        assert.equal(v.info.rows, 1205);
        assert.equal(v.info.tables, 32);
    });
    test('not JSON, and JSON that is not a backup', async () => {
        assert.equal((await B.verify('hello')).ok, false);
        assert.match((await B.verify('hello')).problems[0], /not valid JSON/);
        assert.match((await B.verify('{"a":1}')).problems[0], /not a CurricuLogic backup/);
        assert.equal((await B.verify('null')).ok, false);
    });
    test('a changed value is caught by the checksum', async () => {
        const made = await B.create(fakeClient(sample()));
        const f = JSON.parse(made.text);
        f.tables.university_student[0].year_level = 4;
        const v = await B.verify(JSON.stringify(f));
        assert.equal(v.ok, false);
        assert.ok(v.problems.some((p) => /checksum/.test(p)));
    });
    test('a deleted row is caught by the count and the checksum', async () => {
        const f = JSON.parse((await B.create(fakeClient(sample()))).text);
        f.tables.subject.pop();
        const v = await B.verify(JSON.stringify(f));
        assert.equal(v.ok, false);
        assert.ok(v.problems.some((p) => /subject: the file says 1203 rows but holds 1202/.test(p)));
    });
    test('a missing table is named', async () => {
        const f = JSON.parse((await B.create(fakeClient(sample()))).text);
        delete f.tables.request;
        delete f.counts.request;
        const v = await B.verify(JSON.stringify(f));
        assert.equal(v.ok, false);
        assert.ok(v.problems.some((p) => /table request is missing/.test(p)));
    });
    test('a newer file version and a table that is not a list are refused', async () => {
        const f = JSON.parse((await B.create(fakeClient(sample()))).text);
        f.version = 99;
        f.tables.program = 'nope';
        const v = await B.verify(JSON.stringify(f));
        assert.ok(v.problems.some((p) => /newer version/.test(p)));
        assert.ok(v.problems.some((p) => /program is not a list/.test(p)));
    });
    test('warnings from when it was made, and unknown tables, are reported but do not fail it', async () => {
        const made = await B.create(fakeClient(sample(), { drift: { program: 1 } }));
        const f = JSON.parse(made.text);
        f.tables.extra_table = [];
        f.counts.extra_table = 0;
        const v = await B.verify(JSON.stringify(f));
        assert.ok(v.warnings.some((w) => /When it was made: program/.test(w)));
        assert.ok(v.warnings.some((w) => /extra_table/.test(w)));
        assert.ok(v.problems.some((p) => /checksum/.test(p)));              // adding a table changed the data: a real problem
    });
});

describe('restore SQL', () => {
    test('one insert per chunk, rows go in as JSON, existing rows are skipped', () => {
        const rows = Array.from({ length: 450 }, (_, i) => ({ id: i + 1 }));
        const sql = B.restoreSql('subject', rows, { chunk: 200 });
        assert.equal(sql.length, 3);
        assert.ok(sql[0].startsWith('insert into public.subject overriding system value\nselect * from jsonb_populate_recordset(null::public.subject, $bk$['));
        assert.ok(sql[0].endsWith(']$bk$::jsonb)\non conflict do nothing;'));
        assert.equal(JSON.parse(sql[2].split('$bk$')[1]).length, 50);
    });
    test('a row that contains the quote tag cannot break out of the statement', () => {
        const rows = [{ id: 1, note: 'x $bk$ ; drop table subject; --' }];
        const [stmt] = B.restoreSql('subject', rows);
        const tag = /jsonb_populate_recordset\(null::public\.subject, (\$[a-z]+\$)/.exec(stmt)[1];
        assert.notEqual(tag, '$bk$');
        const body = stmt.split(tag)[1];
        assert.equal(JSON.parse(body)[0].note, 'x $bk$ ; drop table subject; --');
    });
    test('only tables of a backup, and plain schema names', () => {
        assert.throws(() => B.restoreSql('pg_user', [{}]), /not a table of a backup/);
        assert.throws(() => B.restoreSql('subject; drop table x', [{}]), /not a table of a backup/);
        assert.throws(() => B.restoreSql('subject', [{}], { schema: 'public; drop' }), /Bad schema/);
        assert.deepEqual(B.restoreSql('subject', []), []);
    });
    test('the counter fix is only for tables whose numeric key is a sequence, with the right column', () => {
        assert.equal(B.sequenceSql('university_student'), '');            // uuid key: max(id) would not compile
        assert.match(B.sequenceSql('subject'), /pg_get_serial_sequence\('public\.subject', 'id'\).*max\(id\)/s);
        assert.match(B.sequenceSql('account_stop_log'), /'seq'.*max\(seq\)/s);
        for (const t of Object.keys(B.SEQUENCES)) assert.ok(B.TABLES.includes(t), t);
        assert.equal(Object.keys(B.SEQUENCES).length, 18);
    });
    test('backupSql: numbered in restore order, empty tables skipped, triggers switched off first', () => {
        const out = B.backupSql({ tables: { program: [{ id: 1 }], subject: [{ id: 1 }], university_student: [{ id: 'a' }], request: [] } });
        assert.deepEqual(out.map((o) => o.name), ['01_program.sql', '07_subject.sql', '11_university_student.sql']);
        assert.ok(out[0].sql.includes('session_replication_role = replica'));
        assert.ok(out[0].sql.includes('setval'));
        assert.ok(!out[2].sql.includes('setval'));
    });
});

describe('the command-line tool', () => {
    const tool = new URL('../db/tools/backup-to-sql.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
    const run = (...args) => spawnSync(process.execPath, [decodeURIComponent(tool), ...args], { encoding: 'utf8' });

    test('writes one script per non-empty table and a README, from a good file', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'bk-'));
        const made = await B.create(fakeClient(sample()));
        writeFileSync(join(dir, 'b.json'), made.text);
        const r = run(join(dir, 'b.json'), join(dir, 'out'));
        assert.equal(r.status, 0, r.stderr);
        assert.deepEqual(readdirSync(join(dir, 'out')).sort(), ['00_README.txt', '01_program.sql', '07_subject.sql', '11_university_student.sql']);
        assert.match(readFileSync(join(dir, 'out', '00_README.txt'), 'utf8'), /07_subject\.sql {2}\(1203 rows\)/);
    });
    test('refuses a changed file, unless --force', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'bk-'));
        const f = JSON.parse((await B.create(fakeClient(sample()))).text);
        f.tables.program[0].name = 'tampered';
        writeFileSync(join(dir, 'b.json'), JSON.stringify(f));
        const r = run(join(dir, 'b.json'), join(dir, 'out'));
        assert.equal(r.status, 1);
        assert.match(r.stderr, /checksum/);
        assert.ok(!existsSync(join(dir, 'out')));
        const forced = run(join(dir, 'b.json'), join(dir, 'out'), '--force');
        assert.equal(forced.status, 0);
        assert.ok(existsSync(join(dir, 'out', '01_program.sql')));
    });
    test('no file given: a usage message', () => {
        const r = run();
        assert.equal(r.status, 2);
        assert.match(r.stderr, /Usage/);
    });
});

describe('the Admin page and the migration', () => {
    const html = read('features/admin/admindashboard.html');
    const js = read('features/admin/admindashboard.js');
    const sql = read('db/127_admin_backup.sql');

    test('the Admin has a Backup page with the create button and the file check', () => {
        assert.match(html, /data-view="backup"/);
        assert.match(html, /id="view-backup"/);
        assert.match(html, /id="backup-create"/);
        assert.match(html, /id="backup-check-file"/);
        assert.match(html, /reports\/reportfile\.js"><\/script>\s*<script src="\.\.\/\.\.\/shared\/js\/reports\/backup\.js"><\/script>/);
        assert.match(html, /paid Supabase plan/);
    });
    test('the page starts the backup, saves JSON without a byte-order mark, and records it', () => {
        assert.match(js, /if \(name === 'backup'\)\s+initBackup\(\);/);
        assert.ok(js.includes("window.ReportFile?.setClient(supabase);"));
        assert.ok(js.includes("made.text, 'application/json', { bom: false }"));
        assert.ok(js.includes("window.ReportFile.logExport('backup', 'file', null, made.rows)"));
        assert.ok(js.includes("eq('new_values->>report', 'backup')"));
    });
    test('the table list is the same in the page module and in the database function', () => {
        const m = /_backup_table_list\(\)[\s\S]*?select array\[([\s\S]*?)\]::text\[\]/.exec(sql);
        const fromSql = [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
        assert.deepEqual(fromSql, B.TABLES);
    });
    test('the list holds none of the private or temporary tables', () => {
        for (const t of ['ai_chat_message', 'ai_chat_conversation', 'ai_chat_reset', 'login_attempt', 'cura_usage', 'stg_subject', 'stg_prerequisite']) {
            assert.ok(!B.TABLES.includes(t), t);
        }
    });
    test('the functions are for a signed-in System administrator only, over a fixed list, and closed to the public', () => {
        assert.equal((sql.match(/auth\.uid\(\) is null or not is_system_admin\(\)/g) || []).length, 2);
        assert.ok(sql.includes('p_table = any (_backup_table_list())'));
        assert.ok(sql.includes('format(\'public.%I\', p_table)'));              // the name is quoted as an identifier, never pasted in
        assert.ok(sql.includes('revoke all on function public.admin_backup_tables() from public, anon, authenticated, service_role;'));
        assert.ok(sql.includes('revoke all on function public.admin_backup_page(text, integer, integer) from public, anon, authenticated, service_role;'));
        assert.ok(sql.includes('least(greatest(coalesce(p_size, 500), 1), 1000)'));
    });
    test('starting a backup is on the record', () => {
        assert.ok(sql.includes("'BACKUP_DATA_READ'"));
    });
});

describe('what is inside a file (summarize and preview)', () => {
    const file = () => ({
        format: 'curriculogic-backup', version: 1, createdAt: '2026-11-19T13:51:00.000Z', sha256: 'abcdef0123456789abcdef', warnings: ['x'],
        tables: {
            university_student: [
                { id: 'u1', email: 'jose@uc.edu.ph', phone: '09171234567', first_name: 'Jose', avatar_url: 'http://x/y.png', password_hash: 'zzz', created_at: '2026-11-17 01:02:03' },
                { id: 'u2', email: 'a@b.c', first_name: 'Ana', created_at: '2026-11-18T00:00:00+00' },
            ],
            faculty_staff: Array.from({ length: 10 }, (_, i) => ({ id: i })),
            registrar_staff: [{ id: 1 }, { id: 2 }],
            department_staff: [{ id: 1 }],
            subject: [{ id: 1 }, { id: 2 }, { id: 3 }],
            prospectus: [{ id: 1 }, { id: 2 }, { id: 3 }],
            audit_log: [{ id: 1, created_at: '2026-11-16 08:00:00.5' }, { id: 2, created_at: '2026-11-19 03:17:37' }],
            request: [{ id: 1 }], request_item: [{ id: 1 }, { id: 2 }],
        },
    });

    test('every table is in exactly one area, and every table has a plain name', () => {
        const all = B.AREAS.flatMap((a) => a.tables);
        assert.equal(all.length, 32);
        assert.equal(new Set(all).size, 32);
        for (const t of B.TABLES) {
            assert.ok(all.includes(t), t);
            assert.ok(B.TABLE_LABELS[t], t);
            assert.equal(B.areaOf(t).tables.includes(t), true);
        }
        assert.equal(B.AREAS.length, 6);
    });
    test('the summary lists all 32 tables, in area order, with their row counts', () => {
        const s = B.summarize(file(), { bytes: 4096 });
        assert.equal(s.tables.length, 32);
        assert.equal(s.tables.find((t) => t.name === 'university_student').rows, 2);
        assert.equal(s.tables.find((t) => t.name === 'university_student').label, 'Students');
        assert.equal(s.tables.find((t) => t.name === 'subject_offering').rows, 0);            // a table the file does not hold is empty, not missing
        assert.equal(s.totalRows, 2 + 10 + 2 + 1 + 3 + 3 + 2 + 1 + 2);
        assert.equal(s.bytes, 4096);
        assert.equal(s.checksum, 'abcdef012345');
        assert.deepEqual(s.warnings, ['x']);
    });
    test('the areas add up to the total', () => {
        const s = B.summarize(file());
        assert.equal(s.areas.reduce((n, a) => n + a.rows, 0), s.totalRows);
        assert.equal(s.areas.find((a) => a.key === 'accounts').rows, 2 + 10 + 2 + 1);
        assert.equal(s.areas.find((a) => a.key === 'curriculum').rows, 6);
        assert.equal(s.areas.find((a) => a.key === 'settings').rows, 2);
    });
    test('date ranges use the first date column the table has, in UTC days, and are empty where there is none', () => {
        const s = B.summarize(file());
        const by = Object.fromEntries(s.tables.map((t) => [t.name, t]));
        assert.deepEqual([by.university_student.oldest, by.university_student.newest], ['2026-11-17', '2026-11-18']);
        assert.deepEqual([by.audit_log.oldest, by.audit_log.newest], ['2026-11-16', '2026-11-19']);
        assert.deepEqual([by.subject.oldest, by.subject.newest], [null, null]);
    });
    test('plain-words facts mention only what exists, with the right singular and plural', () => {
        const facts = B.summarize(file()).facts;
        assert.ok(facts.includes('2 students'));
        assert.ok(facts.includes('13 staff accounts (10 faculty, 2 registrar, 1 department)'));
        assert.ok(facts.includes('3 subjects in 3 curricula'));
        assert.ok(facts.includes('1 advising request with 2 subjects'));
        assert.ok(facts.includes('2 audit log entries from 2026-11-16 to 2026-11-19'));
        assert.ok(!facts.some((f) => /grade record|scheduled|EDP/.test(f)));                // none of those in this file
        const one = B.summarize({ tables: { university_student: [{ id: 1 }], prospectus: [{ id: 1 }], subject: [{ id: 1 }] } }).facts;
        assert.deepEqual(one, ['1 student', '1 subject in 1 curriculum']);
    });
    test('an empty or odd file gives an empty summary, never an error', () => {
        for (const f of [null, {}, { tables: null }, { tables: { subject: 'nope' } }]) {
            const s = B.summarize(f);
            assert.equal(s.totalRows, 0);
            assert.deepEqual(s.facts, []);
            assert.equal(s.tables.length, 32);
        }
    });

    test('previews show the first rows only, and say how many there are', () => {
        const f = file();
        f.tables.subject = Array.from({ length: 40 }, (_, i) => ({ id: i + 1, code: 'S' + i }));
        const p = B.preview(f, 'subject');
        assert.equal(p.rows.length, 5);
        assert.equal(p.total, 40);
        assert.deepEqual(p.columns, ['id', 'code']);
        assert.deepEqual(p.rows[0], ['1', 'S0']);
    });
    test('previews hide passwords and photo links, mask phones and emails', () => {
        const p = B.preview(file(), 'university_student');
        const row = Object.fromEntries(p.columns.map((c, i) => [c, p.rows[0][i]]));
        assert.equal(row.password_hash, '••••');
        assert.equal(row.avatar_url, '••••');
        assert.equal(row.email, 'j***@uc.edu.ph');
        assert.equal(row.phone, '•'.repeat(9) + '67');
        const flat = JSON.stringify(p);
        for (const secret of ['jose@uc.edu.ph', '09171234567', 'http://x/y.png', 'zzz']) assert.ok(!flat.includes(secret), secret);
    });
    test('missing values show a dash, long values are cut, and columns beyond the limit are counted', () => {
        const f = { tables: { subject: [{ id: 1, a: null, b: 'x'.repeat(200), c: 1, d: 2, e: 3 }] } };
        const p = B.preview(f, 'subject', { maxColumns: 4 });
        assert.deepEqual(p.columns, ['id', 'a', 'b', 'c']);
        assert.equal(p.more, 2);
        assert.equal(p.rows[0][1], '—');
        assert.ok(p.rows[0][2].length <= 60);
    });
    test('a table that is not in the file previews as nothing', () => {
        const p = B.preview({ tables: {} }, 'subject');
        assert.deepEqual([p.columns, p.rows, p.total], [[], [], 0]);
    });
});

describe('the Check a backup file page shows what is inside', () => {
    const js = read('features/admin/admindashboard.js');
    const css = read('shared/css/dashboard.css');
    test('after the check it draws tiles, facts, the chart, every table and the previews', () => {
        for (const part of ['function backupContents(', 'function backupChart(', 'function backupTable(', 'function toggleBackupPreview(']) assert.ok(js.includes(part), part);
        assert.ok(js.includes('window.DatabaseBackup.summarize(parsed, { bytes: text.length })'));
        assert.ok(js.includes('window.DatabaseBackup.preview(BK_FILE, name)'));
        assert.ok(js.includes("e.target.closest('[data-bk-preview]')"));
    });
    test('a backup that fails the check still shows what it holds, a file that is not a backup does not', () => {
        assert.ok(js.includes('parsed.format === window.DatabaseBackup.FORMAT'));
        assert.ok(js.includes('A file that is a backup but fails the check still shows what it holds'));
    });
    test('the page says the file stayed on this computer, and that previews hide private values', () => {
        assert.ok(js.includes('nothing was sent anywhere'));
        assert.ok(js.includes('Previews hide passwords, photo links and phone numbers'));
    });
    test('the chart and list have styles', () => {
        for (const c of ['.bk-chart', '.bk-track', '.bk-preview', '.bk-facts', '.bk-bar']) assert.ok(css.includes(c), c);
    });
    test('the systemlogs helper that masks values loads before the backup module', () => {
        const html = read('features/admin/admindashboard.html');
        const tag = (name) => html.indexOf(`<script src="../../shared/js/${name}"></script>`);
        assert.ok(tag('records/systemlogs.js') > 0 && tag('reports/backup.js') > 0);
        assert.ok(tag('records/systemlogs.js') < tag('reports/backup.js'));
    });
});
