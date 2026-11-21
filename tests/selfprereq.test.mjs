// selfprereq.test.mjs
// A subject never requires itself (21 Nov 2026). The BSCS 2023-2024 PDF prints ELDNET1 for both .NET modules; the scan linked Module 2's
// prerequisite "ELDNET1" to Module 2 itself, and it was saved that way, so Module 2 could never be taken.
//
//   node --test tests/selfprereq.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const builder = readFileSync(new URL('../features/department/curriculum-builder.js', import.meta.url), 'utf8');
const between = (a, b) => builder.slice(builder.indexOf(a), builder.indexOf(b, builder.indexOf(a)));

describe('linking a scanned prerequisite', () => {
    const scan = between('const rowsByKey = new Map();', 'const FN = window.CurriculogicFootnotes;');
    const resolve = between('for (const prereqCode of row._aiPrereqCodes) {', 'const co = window.CurriculogicCorequisites.resolve(');
    test('every scanned row is remembered under its code, so two rows with one code are both known', () => {
        assert.ok(scan.length > 100, 'found the scan loop');
        assert.match(scan, /const same = rowsByKey\.get\(SC\.key\(row\.code\)\) \?\? \[\];\s+same\.push\(row\);\s+rowsByKey\.set\(SC\.key\(row\.code\), same\);/);
    });
    test('a prerequisite that resolves to the row itself goes to its namesake instead', () => {
        assert.match(resolve, /let target = byCode\.get\(SC\.key\(prereqCode\)\);/);
        assert.match(resolve, /if \(target === row\) \{\s+target = \(rowsByKey\.get\(SC\.key\(prereqCode\)\) \?\? \[\]\)\.find\(r => r !== row\) \?\? null;/);
    });
    test('with no namesake it is not linked, and says so on the scan card', () => {
        assert.match(resolve, /followUps\.push\(`\$\{row\.code\}: prerequisite "\$\{prereqCode\}" is the subject itself, so it was not linked`\);\s+continue;/);
    });
    test('the lookup rule itself, as the builder applies it', () => {
        // Two rows share a code; the later one names that code as its prerequisite.
        const rows = [{ id: 'm1', code: 'ELDNET1' }, { id: 'm2', code: 'ELDNET1' }];
        const key = (c) => c.replace(/[^A-Z0-9]/gi, '').toUpperCase();
        const byCode = new Map(); const rowsByKey = new Map();
        for (const r of rows) { byCode.set(key(r.code), r); rowsByKey.set(key(r.code), [...(rowsByKey.get(key(r.code)) ?? []), r]); }
        const link = (row, code) => {
            let target = byCode.get(key(code));
            if (target === row) target = (rowsByKey.get(key(code)) ?? []).find(r => r !== row) ?? null;
            return target;
        };
        assert.equal(link(rows[1], 'ELDNET1'), rows[0], 'Module 2 links to Module 1');
        assert.equal(link(rows[0], 'ELDNET1'), rows[1], 'and the other way round is also never itself');
        const solo = [{ id: 's', code: 'A1' }];
        byCode.set('A1', solo[0]); rowsByKey.set('A1', solo);
        assert.equal(link(solo[0], 'A1'), null, 'a lone row naming its own code gets no link');
        assert.equal(link(rows[0], 'ZZZ9'), undefined);
    });
});

describe('Create refuses a subject that requires itself', () => {
    const pf = between('function preflight', 'The file\'s own claims');
    test('it is a "must be fixed" item that names the subject', () => {
        assert.match(pf, /if \(r\.prereqs\.some\(p => p\.uid && p\.uid === r\.uid\)\) \{\s+blockers\.push\(`\$\{r\.code \|\| 'A subject'\} requires itself, so it could never be taken\. Remove that prerequisite\.`\);/);
    });
    test('it sits in the same loop as the check for a prerequisite on a deleted row', () => {
        assert.ok(pf.indexOf('requires itself') < pf.indexOf('const dangling'));
        assert.ok(pf.indexOf('for (const r of rows) {') < pf.indexOf('requires itself'));
    });
    test('a standing mark ({ standing: n }) has no uid, so it is never mistaken for a self link', () => {
        assert.ok(pf.includes('p.uid && p.uid === r.uid'));
    });
});
