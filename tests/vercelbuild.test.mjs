// vercelbuild.test.mjs
// The files that put the website on Vercel: scripts/build-static.mjs copies only what a browser needs into a folder,
// vercel.json serves it with security headers, and .vercelignore keeps the private folders out of uploads. These tests
// BUILD the folder for real and check it: nothing private inside, and every file a page points to is there.
//
//   node --test tests/vercelbuild.test.mjs

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

let dist;
before(() => {
    dist = join(mkdtempSync(join(tmpdir(), 'curriculogic-dist-')), 'site');
    execFileSync(process.execPath, [join(root, 'scripts', 'build-static.mjs'), dist], { cwd: root, stdio: 'pipe' });
});
after(() => rmSync(dirname(dist), { recursive: true, force: true }));

function walk(dir, out = []) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p, out); else out.push(p);
    }
    return out;
}

describe('what is published', () => {
    test('the start page and the four folders the pages load from', () => {
        for (const name of ['index.html', 'assets', 'cura', 'features', 'shared']) {
            assert.ok(existsSync(join(dist, name)), name + ' is missing from the build');
        }
    });

    test('nothing private is published: no database scripts, notes, tests, function sources or local files', () => {
        const top = readdirSync(dist).sort();
        assert.deepEqual(top, ['assets', 'cura', 'features', 'index.html', 'shared']);
        for (const name of ['db', 'docs', 'tests', 'supabase', 'knowledge', 'data', 'workspace', 'secrets', '.claude', '.git', 'scripts', 'README.md']) {
            assert.ok(!existsSync(join(dist, name)), name + ' must not be published');
        }
    });

    test('no secret-looking file ends up inside the published folders', () => {
        const bad = walk(dist).filter(f => /(^|[\\/])(\.env[^\\/]*|.*\.(pem|key|p12|pfx|jks|keystore)|local\.properties|keystore\.properties|e2e-accounts[^\\/]*)$/i.test(f));
        assert.deepEqual(bad, []);
        assert.ok(!walk(dist).some(f => /[\\/]tests[\\/]fixtures[\\/]/.test(f)));
    });

    test('the only key published is the public (anon) one', () => {
        const config = readFileSync(join(dist, 'shared', 'js', 'app', 'config.js'), 'utf8');
        const jwt = config.match(/eyJ[\w-]{15,}\.([\w-]{15,})\.[\w-]{10,}/);
        assert.ok(jwt, 'the page config holds the anon key');
        assert.equal(JSON.parse(Buffer.from(jwt[1], 'base64url').toString()).role, 'anon');
        // and no service key anywhere in what is published
        const all = walk(dist).filter(f => /\.(js|html|css|json)$/.test(f)).map(f => readFileSync(f, 'utf8')).join('\n');
        const roles = [...all.matchAll(/eyJ[\w-]{15,}\.([\w-]{15,})\.[\w-]{10,}/g)].map(m => JSON.parse(Buffer.from(m[1], 'base64url').toString()).role);
        assert.ok(roles.length > 0 && roles.every(r => r === 'anon'), 'every key in the published site is the anon one, found: ' + [...new Set(roles)]);
    });
});

describe('every file a page points to is there', () => {
    test('each relative src and href in every published HTML page resolves inside the published folder', () => {
        const pages = walk(dist).filter(f => f.endsWith('.html'));
        assert.ok(pages.length >= 13, 'found ' + pages.length + ' pages');
        const missing = [];
        for (const page of pages) {
            const html = readFileSync(page, 'utf8');
            for (const m of html.matchAll(/\b(?:src|href)="([^"]+)"/g)) {
                const ref = m[1].trim();
                if (!ref || /^(https?:|data:|mailto:|tel:|javascript:|blob:|#|\/\/)/i.test(ref)) continue;
                const target = normalize(join(dirname(page), ref.split(/[?#]/)[0]));
                if (!target.startsWith(normalize(dist))) { missing.push(page + ' -> ' + ref + ' (outside the site)'); continue; }
                if (!existsSync(target) || (statSync(target).isDirectory() && !existsSync(join(target, 'index.html')))) {
                    missing.push(page.replace(dist, '') + ' -> ' + ref);
                }
            }
        }
        assert.deepEqual(missing, []);
    });
});

describe('vercel.json', () => {
    const config = JSON.parse(read('vercel.json'));

    test('builds with the script and serves the folder it writes', () => {
        assert.equal(config.buildCommand, 'node scripts/build-static.mjs');
        assert.equal(config.outputDirectory, 'dist');
        assert.ok(existsSync(join(root, 'scripts', 'build-static.mjs')));
    });

    test('sets the security headers on every page', () => {
        const all = config.headers.find(h => h.source === '/(.*)').headers.reduce((o, h) => ({ ...o, [h.key]: h.value }), {});
        assert.equal(all['X-Content-Type-Options'], 'nosniff');
        assert.equal(all['Referrer-Policy'], 'strict-origin-when-cross-origin');
        assert.match(all['Content-Security-Policy'], /frame-ancestors 'none'/);
        assert.match(all['Permissions-Policy'], /geolocation=\(\)/);
        assert.match(all['Permissions-Policy'], /microphone=\(\)/);
    });

    test('keeps the camera allowed for the page itself, because the schedule upload takes a photo', () => {
        const all = config.headers.find(h => h.source === '/(.*)').headers.find(h => h.key === 'Permissions-Policy').value;
        assert.match(all, /camera=\(self\)/);
    });

    test('never caches pages and scripts for long: only the images in assets/ get a day', () => {
        const rules = config.headers.filter(h => h.headers.some(x => x.key === 'Cache-Control'));
        assert.deepEqual(rules.map(r => r.source), ['/assets/(.*)']);
    });

    test('the header policy adds to, and does not replace, the policy the pages already carry', () => {
        // The pages set their own Content-Security-Policy in a <meta> tag; the header here only adds frame-ancestors.
        const home = read('index.html');
        assert.match(home, /http-equiv="Content-Security-Policy"/);
        assert.doesNotMatch(config.headers.map(h => JSON.stringify(h)).join(''), /script-src|default-src/);
    });
});

describe('.vercelignore and .gitignore', () => {
    test('the private folders are listed, and the build script is not', () => {
        const ignore = read('.vercelignore').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
        for (const name of ['db/', 'docs/', 'tests/', 'supabase/', 'workspace/', 'secrets/', '.env']) assert.ok(ignore.includes(name), name);
        assert.ok(!ignore.some(l => /^scripts\/?$/.test(l)), 'scripts/ must still be uploaded: the build needs it');
        assert.ok(!ignore.some(l => /^(shared|features|assets|cura)\/?$/.test(l)), 'the published folders must not be ignored');
    });

    test('the build output is not committed', () => {
        assert.match(read('.gitignore'), /^dist\/$/m);
    });
});
