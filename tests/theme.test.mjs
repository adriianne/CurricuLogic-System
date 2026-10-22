// theme.test.mjs
// Which theme a page opens in: the saved choice, else the system setting.
//
//   node --test tests/theme.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve as resolvePath, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const T = require('../shared/js/app/theme.js');
const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');

describe('resolve', () => {
    test('a saved choice wins over the system', () => {
        assert.equal(T.resolve('light', true), 'light');
        assert.equal(T.resolve('dark', false), 'dark');
    });

    test('with no saved choice the system decides', () => {
        assert.equal(T.resolve(null, true), 'dark');
        assert.equal(T.resolve(null, false), 'light');
        assert.equal(T.resolve(undefined, false), 'light');
    });

    test('anything else that was stored is ignored', () => {
        assert.equal(T.resolve('purple', true), 'dark');
        assert.equal(T.resolve('', false), 'light');
        assert.equal(T.resolve('DARK', false), 'light');
    });
});

describe('other', () => {
    test('flips the theme', () => {
        assert.equal(T.other('light'), 'dark');
        assert.equal(T.other('dark'), 'light');
    });
});

describe('the page', () => {
    // The head script (shared/js/app/themeinit.js, a file rather than an inline
    // script so the Content-Security-Policy can forbid inline scripts) must use
    // the same key and the same two values as theme.js, and run before the
    // stylesheet loads.
    const html = readFileSync(resolvePath(ROOT, 'features/admin/admindashboard.html'), 'utf8');
    const init = readFileSync(resolvePath(ROOT, 'shared/js/app/themeinit.js'), 'utf8');

    test('applies the theme before the page is drawn, with the same key', () => {
        assert.ok(init.includes(`'${T.KEY}'`), 'themeinit.js does not read the saved theme');
        assert.ok(init.includes("'light'") && init.includes("'dark'"), 'themeinit.js lost one of the two values');

        const script = html.indexOf('shared/js/app/themeinit.js');
        const stylesheet = html.indexOf('shared/css/dashboard.css');
        assert.ok(script > 0 && script < html.indexOf('</head>'), 'themeinit.js is not in the head');
        assert.ok(script < stylesheet, 'themeinit.js must run before the stylesheet loads');
        assert.ok(!/<script\b[^>]*\bdefer\b|<script\b[^>]*\basync\b/.test(html.slice(script - 20, script + 80)),
            'themeinit.js must be a plain blocking script, or the page flashes white');
    });

    test('every dashboard loads it in the head, not inline', () => {
        for (const p of ['admin/admindashboard', 'department/departmentdashboard', 'faculty/facultydashboard',
                         'registrar/registrardashboard', 'student/studentdashboard']) {
            const page = readFileSync(resolvePath(ROOT, `features/${p}.html`), 'utf8');
            assert.ok(page.includes('<script src="../../shared/js/app/themeinit.js"></script>'), `${p} does not load themeinit.js`);
            assert.equal(page.includes(`'${T.KEY}'`), false, `${p} still has the theme code inline`);
        }
    });

    test('has the toggle button and loads theme.js', () => {
        assert.ok(html.includes('id="theme-toggle"'));
        assert.ok(html.includes('shared/js/app/theme.js'));
    });
});
