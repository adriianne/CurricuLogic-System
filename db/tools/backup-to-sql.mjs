// backup-to-sql.mjs
// Turns a CurricuLogic backup file (Admin > Backup) into restore scripts: one .sql file per table, numbered in the order they must be
// run. Read docs/BACKUP-RESTORE.md first.
//
//   node db/tools/backup-to-sql.mjs <backup.json> [output folder]  [--force]
//
// The file is checked first (all tables present, row counts right, checksum unchanged). A file that fails the check is refused unless
// you pass --force. Nothing is sent anywhere: this only writes files.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';

const require = createRequire(import.meta.url);
const Backup = require('../../shared/js/reports/backup.js');

const args = process.argv.slice(2);
const force = args.includes('--force');
const [input, outArg] = args.filter((a) => !a.startsWith('--'));

if (!input) {
    console.error('Usage: node db/tools/backup-to-sql.mjs <backup.json> [output folder] [--force]');
    process.exit(2);
}

const text = readFileSync(resolve(input), 'utf8');
const check = await Backup.verify(text);
for (const w of check.warnings) console.warn('Note:', w);
if (!check.ok) {
    for (const p of check.problems) console.error('Problem:', p);
    if (!force) {
        console.error('This file did not pass the check, so no scripts were written. Use --force only if you understand the problems above.');
        process.exit(1);
    }
    console.error('--force given: writing the scripts anyway.');
}

const file = JSON.parse(text);
const out = resolve(outArg || 'restore-scripts');
mkdirSync(out, { recursive: true });

const scripts = Backup.backupSql(file);
for (const s of scripts) writeFileSync(join(out, s.name), s.sql);

const order = scripts.map((s) => `${s.name}  (${s.rows} rows)`).join('\n');
writeFileSync(join(out, '00_README.txt'),
`Restore scripts from a CurricuLogic backup made ${file.createdAt ?? 'at an unknown time'}.
Run the .sql files in the Supabase SQL editor, in this order, one after the other (docs/BACKUP-RESTORE.md explains the steps and
what must exist first: the Supabase sign-in users the account tables point at).

${order}
`);
console.log(`Wrote ${scripts.length} script${scripts.length === 1 ? '' : 's'} to ${out}`);
