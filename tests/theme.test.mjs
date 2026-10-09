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
const T = require('../shared/js/theme.js');
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
    // The head snippet must use the same key and the same two values as theme.js.
    const html = readFileSync(resolvePath(ROOT, 'features/admin/admindashboard.html'), 'utf8');

    test('applies the theme before the page is drawn, with the same key', () => {
        assert.ok(html.includes(`'${T.KEY}'`), 'the head snippet does not read the saved theme');
        const snippet = html.indexOf(`'${T.KEY}'`);
        const stylesheet = html.indexOf('shared/css/dashboard.css');
        assert.ok(snippet > 0 && snippet < html.indexOf('</head>'), 'the snippet is not in the head');
        assert.ok(snippet < stylesheet, 'the snippet must run before the stylesheet loads');
    });

    test('has the toggle button and loads theme.js', () => {
        assert.ok(html.includes('id="theme-toggle"'));
        assert.ok(html.includes('shared/js/theme.js'));
    });
});
