// secrets.test.mjs
// A guard against committing a secret.
//
// Scans every file git would commit (tracked files plus new files that are not
// ignored) for the things that must never be in this repository: a Supabase
// service-role key, an AI or mail provider key, a private key, a file called
// .env. The ONE key allowed is the public anon key (it is in the browser for
// every visitor by design; row-level security is what protects the data).
//
//   node --test tests/secrets.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { resolve, dirname, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SELF = 'tests/secrets.test.mjs';

const BINARY = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.xlsx', '.xls',
                        '.apk', '.zip', '.woff', '.woff2', '.ttf', '.mp4']);
const MAX_BYTES = 2 * 1024 * 1024;

/* Roles a Supabase JWT may carry in this repo: only the public one. */
const ALLOWED_JWT_ROLES = new Set(['anon']);

const PATTERNS = [
    ['Google API key',            /AIza[0-9A-Za-z_-]{30,}/],
    ['OpenAI-style secret key',   /\bsk-[A-Za-z0-9_-]{20,}/],
    ['Supabase secret key',       /\bsb_secret_[A-Za-z0-9_-]{10,}/],
    ['Resend API key',            /\bre_[A-Za-z0-9]{28,}\b/],
    ['private key block',         /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
    ['secret assigned in code',   /\b(SERVICE_ROLE_KEY|GEMINI_API_KEY|RESEND_API_KEY|SMTP_PASS(?:WORD)?)\s*[:=]\s*['"][^'"\s]{12,}['"]/i],
];

const JWT = /eyJ[A-Za-z0-9_-]{15,}\.([A-Za-z0-9_-]{15,})\.[A-Za-z0-9_-]{10,}/g;

/* Everything wrong with one file's text: a list of plain sentences. */
export function problemsIn(text) {
    const found = [];
    for (const [label, rx] of PATTERNS) if (rx.test(text)) found.push(label);
    for (const m of text.matchAll(JWT)) {
        let role = '(unreadable)';
        try {
            const json = Buffer.from(m[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
            role = JSON.parse(json).role ?? '(no role claim)';
        } catch { /* leave as unreadable */ }
        if (!ALLOWED_JWT_ROLES.has(role)) found.push(`a JWT with role "${role}"`);
    }
    return found;
}

/* Files git would commit: tracked, plus new and not ignored. */
function committableFiles() {
    const out = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'],
                             { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    return out.split('\0').filter(Boolean);
}

describe('the detector itself', () => {
    // Built from pieces at run time, so this file never contains a whole secret.
    const jwt = (role) => {
        const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
        return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iss: 'supabase', role })}.${'x'.repeat(30)}`;
    };

    test('the public anon key is allowed', () => {
        assert.deepEqual(problemsIn(`key: '${jwt('anon')}'`), []);
    });
    test('a service-role key is caught', () => {
        assert.deepEqual(problemsIn(`key: '${jwt('service_role')}'`), ['a JWT with role "service_role"']);
    });
    test('a token with no role claim is caught', () => {
        assert.match(problemsIn(`x = ${jwt(undefined)}`)[0], /no role claim/);
    });
    test('provider keys are caught', () => {
        assert.ok(problemsIn('AI' + 'za' + 'A'.repeat(35)).length);
        assert.ok(problemsIn('sk' + '-' + 'a'.repeat(30)).length);
        assert.ok(problemsIn('sb_' + 'secret_' + 'a'.repeat(20)).length);
        assert.ok(problemsIn('re' + '_' + 'a'.repeat(32)).length);
        assert.ok(problemsIn('-----BEGIN ' + 'PRIVATE KEY-----').length);
    });
    test('a secret assigned in code is caught, an empty read is not', () => {
        assert.ok(problemsIn('const GEMINI_API_KEY = "' + 'a'.repeat(30) + '"').length);
        assert.deepEqual(problemsIn('const k = Deno.env.get("GEMINI_API_KEY");'), []);
    });
    test('ordinary code is not flagged', () => {
        assert.deepEqual(problemsIn('const re_requests = 1; function resolve_login_identifier() {}'), []);
    });
});

describe('the repository', () => {
    const files = committableFiles();

    test('no environment or key file would be committed', () => {
        const bad = files.filter((f) => {
            const name = basename(f).toLowerCase();
            return (name === '.env' || (name.startsWith('.env.') && name !== '.env.example')) ||
                   /\.(pem|key|p12|pfx|jks|keystore)$/.test(name) || name === 'local.properties';
        });
        assert.deepEqual(bad, [], `files that must not be committed: ${bad.join(', ')}`);
    });

    test('no file contains a secret', () => {
        const report = [];
        for (const f of files) {
            if (f === SELF || BINARY.has(extname(f).toLowerCase())) continue;
            let size; try { size = statSync(resolve(ROOT, f)).size; } catch { continue; }
            if (size > MAX_BYTES) continue;
            let text; try { text = readFileSync(resolve(ROOT, f), 'utf8'); } catch { continue; }
            for (const p of problemsIn(text)) report.push(`${f}: ${p}`);
        }
        assert.deepEqual(report, [], 'secrets found:\n' + report.join('\n'));
    });

    test('the anon key is where it should be, and is the only key there', () => {
        const text = readFileSync(resolve(ROOT, 'shared/js/config.js'), 'utf8');
        const roles = [...text.matchAll(JWT)].map((m) =>
            JSON.parse(Buffer.from(m[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')).role);
        assert.deepEqual(roles, ['anon']);
    });
});
