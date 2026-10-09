// htmlescape.test.mjs
// A guard against showing typed text without escaping it.
//
// The pages build HTML from template strings. A value a person (or an uploaded
// file, or the AI) supplied must go through esc() / escapeHtml() before it is
// put in one, or a name like  <img src=x onerror=alert(1)>  runs as code.
//
// This test reads the page scripts and checks two things:
//   1. every copy of the escaping helper really escapes & < > " '
//   2. no ${ ... } inside a template names a free-text field without one of
//      those helpers around it
//
// It reads source, it does not run the pages, so it can be fooled by a value
// that is escaped somewhere else. When it flags something that is in fact
// safe, add it to SAFE below with the reason; do not weaken the rule.
//
//   node --test tests/htmlescape.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const FILES = [
    'features/admin/admindashboard.js',
    'features/curriculum/curriculum_builder.js',
    'features/department/departmentdashboard.js',
    'features/faculty/facultydashboard.js',
    'features/registrar/registrardashboard.js',
    'features/student/studentdashboard.js',
    'shared/js/advisingslip.js',
    'shared/js/prospectusgrid.js',
];

/* Property names that hold text somebody typed, uploaded or generated. */
const FREE_TEXT = [
    'first_name', 'last_name', 'firstName', 'lastName', 'full_name', 'fullName',
    'email', 'username', 'title', 'code', 'remarks', 'notes', 'note', 'reason',
    'message', 'instructor', 'room', 'section', 'department', 'registrar_notes',
    'review_note', 'file_name', 'fileName', 'name', 'label', 'text', 'summary',
    'description', 'prerequisite_evidence', 'raw_student_name', 'raw_subject_code',
    'error_message',
];
const FREE_TEXT_RE = new RegExp('\\b(?:' + FREE_TEXT.join('|') + ')\\b');
const ESCAPED_RE   = /\b(?:esc|escapeHtml)\s*\(/;

/* Values the scanner flags that are safe, and why. An expression is matched by
   what it starts with, after its spaces are collapsed. */
const CONSTANT = 'a fixed label written in the code, never typed or uploaded';
const SAFE = [
    ['features/admin/admindashboard.js',          'capCell(',                'a number and a role limit'],
    ['features/curriculum/curriculum_builder.js', 'o.label',                 'built from academic-year numbers and fixed words'],
    ['features/curriculum/curriculum_builder.js', 'hasFile ?',               'a fixed button; the file name is escaped inside it'],
    ['features/curriculum/curriculum_builder.js', 'scheduled()',             'a count of subjects, a number'],
    ['features/department/departmentdashboard.js', 'visible.map(o => rowHtmlFor(', 'rowHtmlFor escapes its own fields'],
    ['features/department/departmentdashboard.js', 'reading ?',              'a fixed button'],
    ['features/student/studentdashboard.js',      'label',                   CONSTANT + ' (stat, choice, record filter); the term label escapes its year'],
    ['features/student/studentdashboard.js',      'summary.',                'counts from the rule engine, numbers'],
    ['features/student/studentdashboard.js',      'g.section === chosen',    'a comparison that prints "selected"'],
    ['shared/js/prospectusgrid.js',               'label',                   CONSTANT + ' (status chip, category names)'],
    ['shared/js/prospectusgrid.js',               'label(v)',                'academic-year numbers and fixed words'],
    ['shared/js/prospectusgrid.js',               'slug(',                   'slug() keeps only letters and digits'],
    ['shared/js/prospectusgrid.js',               'summary(',                'summary() builds its own rows from fixed category names and numbers'],
    ['shared/js/prospectusgrid.js',               'text',                    'empty() is only ever called with fixed sentences'],
];
const isSafe = (file, expr) => {
    const e = expr.replace(/\s+/g, ' ').trim();
    return SAFE.some(([f, start]) => f === file && e.startsWith(start));
};

/* Every innermost ${ ... } of a source file (one with no ${ inside it), with
   its line number. A ${ ... } that holds a nested template is not listed: the
   values inside it are. */
function templateExpressions(src) {
    const out = [];
    for (let i = 0; i < src.length; i++) {
        if (src[i] !== '$' || src[i + 1] !== '{') continue;
        let depth = 1, j = i + 2;
        while (j < src.length && depth) {
            if (src[j] === '{') depth++;
            else if (src[j] === '}') depth--;
            j++;
        }
        const expr = src.slice(i + 2, j - 1);
        if (expr.includes('${')) continue;
        // The template text before this ${ : if it holds no tag, the value is
        // going into a plain string (a message, a label), not into HTML.
        const before = src.slice(src.lastIndexOf('`', i - 1) + 1, i);
        out.push({
            line: src.slice(0, i).split('\n').length,
            expr,
            inHtml: /<[a-zA-Z/]/.test(before),
        });
    }
    return out;
}

/* The expression with its quoted strings removed: words inside a literal
   ('title="..."') are not property names. */
const withoutLiterals = (expr) => expr.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, "''");

/* The ${ ... } that name free text and are not escaped. */
function unescaped(src) {
    return templateExpressions(src)
        .filter(({ expr, inHtml }) => inHtml && FREE_TEXT_RE.test(withoutLiterals(expr)) && !ESCAPED_RE.test(expr)
            && !/.lengths*$/.test(expr.trim()));
}

describe('the scanner itself', () => {
    test('flags an unescaped free-text value', () => {
        const hits = unescaped('x = `<td>${s.first_name}</td><b>${r.remarks || ""}</b>`');
        assert.equal(hits.length, 2);
    });

    test('accepts an escaped one', () => {
        assert.equal(unescaped('x = `<td>${esc(s.first_name)}</td>${escapeHtml(r.title)}`').length, 0);
    });

    test('ignores values that are not free text', () => {
        assert.equal(unescaped('x = `${rows.length} subjects, ${units} units, ${s.id}`').length, 0);
    });

    test('reads nested braces', () => {
        const hits = unescaped('x = `${list.map(s => `<i>${s.title}</i>`).join("")}`');
        assert.ok(hits.length >= 1);
    });
});

describe('the escaping helpers', () => {
    const HOSTILE = `<img src=x onerror=alert(1)> "quoted" 'single' & more`;

    for (const file of FILES) {
        const src = readFileSync(resolve(ROOT, file), 'utf8');
        // function escapeHtml(s) { ... }   or   const esc = (s) => ...;
        const fn = src.match(/function (escapeHtml|esc)\s*\(s\)\s*\{[\s\S]*?\n\}/);
        const arrow = src.match(/const (escapeHtml|esc)\s*=\s*\(s\)\s*=>[\s\S]*?\[c\]\)\);/);
        const def = fn?.[0] ?? arrow?.[0];

        test(`${file} defines one`, () => assert.ok(def, 'no esc / escapeHtml found'));

        if (def) {
            test(`${file}: it escapes & < > " '`, () => {
                const name = fn ? fn[1] : arrow[1];
                const helper = new Function(`${def}\nreturn ${name};`)();
                const out = helper(HOSTILE);
                assert.ok(!/[<>"']/.test(out), out);
                assert.match(out, /&lt;img/);
                assert.match(out, /&quot;quoted&quot;/);
                assert.match(out, /&#39;single&#39;/);
                assert.match(out, /&amp; more/);
                assert.equal(helper(null), '');
                assert.equal(helper(undefined), '');
            });
        }
    }
});

describe('templates in the page scripts', () => {
    for (const file of FILES) {
        test(`${file}: free text is escaped`, () => {
            const src = readFileSync(resolve(ROOT, file), 'utf8');
            const hits = unescaped(src)
                .filter(({ expr }) => !isSafe(file, expr))
                .map(({ line, expr }) => `  line ${line}: \${${expr.replace(/\s+/g, ' ').trim().slice(0, 100)}}`);
            assert.equal(hits.length, 0,
                `${hits.length} unescaped free-text value(s) in ${file}:\n${hits.join('\n')}\n` +
                'Wrap each in esc() / escapeHtml(), or add it to SAFE with the reason.');
        });
    }
});
