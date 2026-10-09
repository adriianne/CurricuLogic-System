// externalscripts.test.mjs
// A guard on the code the pages load from other people's servers.
//
// A script or stylesheet from a CDN runs with the page's full power, so a
// compromised or silently changed file would run inside the Registrar's and
// admin's dashboards. Every one therefore has to be:
//   - pinned to an exact version (not "@2" or "@latest"), and
//   - covered by an integrity hash, so the browser refuses a changed file.
// The one exception is the Google Fonts stylesheet, which is different for each
// browser and cannot be hashed.
//
// The spreadsheet library is not loaded from a CDN at all: it is kept in
// shared/js/vendor/ so the version in use is the one that was checked. If you
// update it, change EXPECTED_XLSX_SHA256 on purpose.
//
//   node --test tests/externalscripts.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/* sha256 of shared/js/vendor/xlsx.full.min.js: SheetJS 0.20.3 from cdn.sheetjs.com */
const EXPECTED_XLSX_SHA256 = 'cc015130aa8521e7f088f88898eba949ccdcbfb38df0bd129b44b7273c3a6f41';

const UNHASHABLE = new Set(['fonts.googleapis.com']);

/* Every file git would commit, minus things that are not pages. */
const listed = (...patterns) => execFileSync(
    'git', ['ls-files', '--cached', '--others', '--exclude-standard', ...patterns],
    { cwd: ROOT, encoding: 'utf8' },
).split('\n').filter(Boolean);

const HTML = listed('*.html').filter(f => !f.startsWith('progress log/') && !f.startsWith('tests/UI inspo/'));
const JS   = listed('*.js').filter(f => !f.includes('/dist/') && !f.includes('/vendor/') && !f.startsWith('tests/'));

/* The external <script src> and <link rel=stylesheet href> tags of a page. */
function externalTags(html) {
    const tags = html.match(/<(?:script|link)\b[^>]*>/gi) ?? [];
    return tags
        .map(tag => {
            const url = tag.match(/\b(?:src|href)\s*=\s*"(https?:\/\/[^"]+)"/i)?.[1];
            const isCode = /^<script/i.test(tag) || /rel\s*=\s*"stylesheet"/i.test(tag);
            return url && isCode ? { tag, url, host: new URL(url).host } : null;
        })
        .filter(Boolean);
}

/* "@2", "@latest" and no version at all are moving targets. */
const isPinned = (url) => /@\d+\.\d+\.\d+/.test(url) || /\/\d+\.\d+\.\d+\//.test(url);

describe('the scanner itself', () => {
    test('finds an external script and stylesheet, ignores images and local files', () => {
        const found = externalTags(
            '<script src="https://a.example/x@1.2.3/y.js"></script>' +
            '<link rel="stylesheet" href="https://b.example/s.css">' +
            '<link rel="preconnect" href="https://c.example">' +
            '<script src="../../shared/js/z.js"></script>');
        assert.deepEqual(found.map(f => f.host), ['a.example', 'b.example']);
    });

    test('knows a pinned version from a moving one', () => {
        assert.ok(isPinned('https://cdn.jsdelivr.net/npm/pkg@2.117.2/dist/x.js'));
        assert.ok(isPinned('https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css'));
        assert.ok(!isPinned('https://cdn.jsdelivr.net/npm/pkg@2'));
        assert.ok(!isPinned('https://cdn.jsdelivr.net/npm/pkg@latest/x.js'));
    });
});

describe('external code in the pages', () => {
    test('there are pages to check', () => assert.ok(HTML.length >= 10, `only ${HTML.length} html files`));

    for (const file of HTML) {
        const tags = externalTags(readFileSync(resolve(ROOT, file), 'utf8'));
        for (const { tag, url, host } of tags) {
            if (UNHASHABLE.has(host)) continue;

            test(`${file}: ${url} is pinned`, () => {
                assert.ok(isPinned(url), `${url} is not pinned to an exact version`);
            });

            test(`${file}: ${url} has an integrity hash`, () => {
                assert.match(tag, /\bintegrity\s*=\s*"sha(?:256|384|512)-[A-Za-z0-9+/=]{20,}"/, 'no integrity="sha384-..."');
                assert.match(tag, /\bcrossorigin\s*=\s*"anonymous"/, 'integrity needs crossorigin="anonymous"');
            });
        }
    }
});

describe('scripts added to a page from code', () => {
    for (const file of JS) {
        test(`${file} does not load a script from another server`, () => {
            const src = readFileSync(resolve(ROOT, file), 'utf8');
            const hits = src.match(/\.src\s*=\s*['"`]https?:\/\/[^'"`]+/g) ?? [];
            const scripts = hits.filter(h => !/\.src\s*=\s*['"`]https?:\/\/[^'"`]*\.(png|jpe?g|webp|svg|gif)\b/i.test(h));
            assert.deepEqual(scripts, [], 'load it from shared/js/vendor/ or put a hashed tag in the page');
        });
    }
});

describe('the spreadsheet library', () => {
    const file = resolve(ROOT, 'shared/js/vendor/xlsx.full.min.js');

    test('is the checked copy (SheetJS 0.20.3)', () => {
        const sha = createHash('sha256').update(readFileSync(file)).digest('hex');
        assert.equal(sha, EXPECTED_XLSX_SHA256,
            'xlsx.full.min.js changed. If that was on purpose, check the new version and update EXPECTED_XLSX_SHA256.');
    });

    test('no page loads it from a CDN', () => {
        for (const f of HTML) {
            const html = readFileSync(resolve(ROOT, f), 'utf8');
            assert.ok(!/https?:\/\/[^"']*xlsx[^"']*\.js/i.test(html), `${f} loads xlsx from a server`);
        }
    });

    test('the pages that read spreadsheets point at the local copy', () => {
        for (const f of ['features/admin/admindashboard.html', 'features/department/departmentdashboard.html',
                         'features/admin/admindashboard.js', 'features/department/departmentdashboard.js']) {
            assert.match(readFileSync(resolve(ROOT, f), 'utf8'), /\.\.\/\.\.\/shared\/js\/vendor\/xlsx\.full\.min\.js/, f);
        }
    });
});
