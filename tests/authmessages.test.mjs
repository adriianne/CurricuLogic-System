// authmessages.test.mjs
// Every kind of message the sign-in, Register and password pages can show has a style that makes it visible.
// Found 29 Oct 2026: the Register page's "not found on the EDP list" warning used the kind "pending", the stylesheet only
// styled "error" and "success", and the box stayed display: none, so the student saw the button change and no explanation.
//
//   node --test tests/authmessages.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const css = read('features/auth/css/loginpage.css');
const SCRIPTS = ['shared/js/accounts/register.js', 'shared/js/accounts/auth.js', 'shared/js/accounts/passwordpages.js'];

/* The kinds of message a script asks for: showMsg(text, 'kind'), plus the default of its showMsg(text, type = 'kind'). */
function kindsUsedBy(source) {
    const kinds = new Set();
    for (const m of source.matchAll(/showMsg\([^;]*?,\s*'([a-z]+)'\s*\)/g)) kinds.add(m[1]);
    const def = source.match(/function showMsg\(text,\s*type\s*=\s*'([a-z]+)'\)/);
    if (def) kinds.add(def[1]);
    return kinds;
}

/* The rule for ".msg.<kind>": does it make the box appear? */
function ruleFor(kind) {
    const m = css.match(new RegExp(`\\.msg\\.${kind}\\s*\\{([^}]*)\\}`));
    return m ? m[1] : null;
}

describe('every message kind the pages use is visible', () => {
    test('the plain box is hidden until a kind is applied (so an unstyled kind is invisible, which is what this guards)', () => {
        assert.match(css, /\.msg\s*\{[^}]*display:\s*none/);
    });

    for (const file of SCRIPTS) {
        test(`${file}: each kind it asks for has a rule that shows the box`, () => {
            const kinds = kindsUsedBy(read(file));
            assert.ok(kinds.size > 0, 'no message kinds found: the pattern needs updating');
            for (const kind of kinds) {
                const rule = ruleFor(kind);
                assert.ok(rule, `"${kind}" is used in ${file} but loginpage.css has no .msg.${kind} rule`);
                assert.match(rule, /display:\s*block/, `.msg.${kind} must set display: block`);
            }
        });
    }

    test('the Register page asks for the warning kind, and it has an amber rule', () => {
        assert.ok(kindsUsedBy(read('shared/js/accounts/register.js')).has('pending'));
        const rule = ruleFor('pending');
        assert.match(rule, /var\(--amber-tint\)/);
        assert.match(rule, /var\(--amber-deep\)/);
    });

    test('every colour token the message rules use is defined', () => {
        for (const kind of ['error', 'success', 'pending']) {
            for (const token of ruleFor(kind).match(/--[a-z-]+/g) ?? []) {
                assert.match(css, new RegExp(`${token}:\\s*\\S`), `${token} (used by .msg.${kind}) is not defined`);
            }
        }
    });

    test('reduced motion covers every message kind that animates', () => {
        const block = css.slice(css.indexOf('prefers-reduced-motion'));
        for (const kind of ['error', 'success', 'pending']) assert.match(block, new RegExp(`\\.msg\\.${kind}`));
    });
});
