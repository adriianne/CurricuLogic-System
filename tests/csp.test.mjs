import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* The Content-Security-Policy on every page, and the rules that let the policy
   stay strict: no inline scripts, no inline event handlers, no eval, and every
   outside server a page uses named in the policy. If one of these fails, either the
   page is wrong, or the policy needs the new server (and docs/SECURITY-OPERATIONS.md). */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function htmlFiles(dir) {
    const skip = new Set(['node_modules', '.git', 'tests', 'docs', 'db', 'supabase', 'assets', 'workspace']);
    const out = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) { if (!skip.has(e.name)) out.push(...htmlFiles(path.join(dir, e.name))); }
        else if (e.name.endsWith('.html')) out.push(path.join(dir, e.name));
    }
    return out;
}

function jsFiles(dir) {
    const out = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'vendor') continue;
        if (e.isDirectory()) out.push(...jsFiles(path.join(dir, e.name)));
        else if (e.name.endsWith('.js')) out.push(path.join(dir, e.name));
    }
    return out;
}

const PAGES = htmlFiles(root).map(f => ({ file: path.relative(root, f).replaceAll('\\', '/'), html: fs.readFileSync(f, 'utf8') }));

const META = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"\s*>/gi;
const policyOf = (html) => [...html.matchAll(META)].map(m => m[1]);

function directives(policy) {
    const map = new Map();
    for (const part of policy.split(';')) {
        const [name, ...values] = part.trim().split(/\s+/);
        if (name) map.set(name, values);
    }
    return map;
}

const hostOf = (url) => new URL(url).origin;

test('there are pages to check', () => {
    assert.ok(PAGES.length >= 13, `found ${PAGES.length} pages`);
});

test('every page has exactly one Content-Security-Policy, and they are all identical', () => {
    const seen = new Set();
    for (const p of PAGES) {
        const found = policyOf(p.html);
        assert.equal(found.length, 1, `${p.file} has ${found.length} policies`);
        seen.add(found[0]);
    }
    assert.equal(seen.size, 1, 'the policy differs between pages');
});

test('the policy comes before anything the page loads', () => {
    for (const p of PAGES) {
        const at = p.html.search(META);
        assert.ok(at > 0, p.file);
        const firstLoad = p.html.search(/<(script|link|img)\b/i);
        assert.ok(firstLoad === -1 || at < firstLoad, `${p.file}: the policy is after a script, link or image`);
    }
});

test('the policy is strict where it matters', () => {
    const d = directives(policyOf(PAGES[0].html)[0]);
    assert.deepEqual(d.get('default-src'), ["'self'"]);
    for (const bad of ["'unsafe-inline'", "'unsafe-eval'", '*', 'data:', 'blob:', 'http:']) {
        assert.ok(!d.get('script-src').includes(bad), `script-src must not allow ${bad}`);
    }
    assert.deepEqual(d.get('object-src'), ["'none'"]);
    assert.deepEqual(d.get('base-uri'), ["'self'"]);
    assert.deepEqual(d.get('form-action'), ["'self'"]);
    assert.deepEqual(d.get('frame-src'), ["'none'"]);
    for (const [name, values] of d) {
        assert.ok(!values.includes('*'), `${name} allows everything`);
    }
});

test('no page has an inline script, an inline event handler or a javascript: link', () => {
    for (const p of PAGES) {
        const inline = [...p.html.matchAll(/<script\b([^>]*)>/gi)].filter(m => !/\bsrc\s*=/.test(m[1]));
        assert.equal(inline.length, 0, `${p.file}: inline <script>`);
        assert.equal(/\son[a-z]+\s*=\s*["']/i.test(p.html), false, `${p.file}: inline event handler`);
        assert.equal(/href\s*=\s*["']\s*javascript:/i.test(p.html), false, `${p.file}: javascript: link`);
    }
});

test('every outside script and stylesheet is on the policy', () => {
    const d = directives(policyOf(PAGES[0].html)[0]);
    const scriptHosts = d.get('script-src').filter(v => v.startsWith('https://'));
    const styleHosts  = d.get('style-src').filter(v => v.startsWith('https://'));

    for (const p of PAGES) {
        for (const m of p.html.matchAll(/<script\b[^>]*\bsrc\s*=\s*"(https?:[^"]+)"/gi)) {
            assert.ok(scriptHosts.includes(hostOf(m[1])), `${p.file}: script from ${hostOf(m[1])} is not allowed`);
        }
        for (const m of p.html.matchAll(/<link\b[^>]*\brel\s*=\s*"stylesheet"[^>]*\bhref\s*=\s*"(https?:[^"]+)"/gi)) {
            assert.ok(styleHosts.includes(hostOf(m[1])), `${p.file}: stylesheet from ${hostOf(m[1])} is not allowed`);
        }
    }
});

test('the Supabase project is allowed for network calls and photos', () => {
    const config = fs.readFileSync(path.join(root, 'shared/js/app/config.js'), 'utf8');
    const url = config.match(/SUPABASE_URL:\s*'([^']+)'/)?.[1];
    assert.ok(url, 'SUPABASE_URL not found in config.js');
    const d = directives(policyOf(PAGES[0].html)[0]);
    assert.ok(d.get('connect-src').includes(hostOf(url)), 'connect-src lacks the Supabase project');
    assert.ok(d.get('img-src').includes(hostOf(url)), 'img-src lacks the Supabase project');
});

test('our own JavaScript uses no eval, no Function constructor and no inline-handler markup', () => {
    for (const f of [...jsFiles(path.join(root, 'shared')), ...jsFiles(path.join(root, 'features'))]) {
        const rel = path.relative(root, f).replaceAll('\\', '/');
        const src = fs.readFileSync(f, 'utf8');
        // Comments out first, so a sentence that mentions eval is not a finding.
        const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
        assert.equal(/\beval\s*\(/.test(code), false, `${rel}: eval(`);
        assert.equal(/\bnew\s+Function\s*\(/.test(code), false, `${rel}: new Function(`);
        assert.equal(/set(Timeout|Interval)\(\s*["'`]/.test(code), false, `${rel}: a timer given a string`);
        // markup built in a string: <button onclick="...">
        assert.equal(/<[a-z][^>]*\son[a-z]+\s*=\s*["'\\]/i.test(code), false, `${rel}: inline handler in markup`);
    }
});
