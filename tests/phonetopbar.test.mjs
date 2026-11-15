// phonetopbar.test.mjs
// A registrar (or adviser) with several programmes has the programme switch in the top bar. At 390 px the switch, the
// menu button, the title, the avatar and the two buttons added up to about 470 px and pushed Log out off the screen
// (a real registrar measured 481 px on a 375 px phone, 14 Nov). On a phone the switch now takes only the room left over
// and cuts its text with an ellipsis.
//
//   node --test tests/phonetopbar.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const css = read('shared/css/dashboard.css');

/* The "max-width: 560px" block that already hides the read-only programme field. */
const phone = (() => {
    const at = css.indexOf('.topbar-program-field { display: none; }');
    assert.ok(at > 0, 'the phone block exists');
    return css.slice(at, css.indexOf('\n}', at));
})();

describe('programme switch on a phone', () => {
    test('only a top bar that has a visible switch gets the tighter spacing', () => {
        assert.match(phone, /\.topbar:has\(\.pswitch:not\(\[hidden\]\)\) \{ gap: 0\.6rem; padding-left: 0\.75rem; padding-right: 0\.75rem; \}/);
    });
    test('the switch is the stretchy part: it takes the leftover room and may shrink to nothing', () => {
        assert.match(phone, /\.topbar:has\(\.pswitch:not\(\[hidden\]\)\) \.pswitch \{ flex: 1 1 0; min-width: 0; justify-content: flex-end; \}/);
        assert.match(phone, /\.topbar \.pswitch-btn \{ min-width: 0; max-width: 100%;/);
    });
    test('its text is cut with an ellipsis, not wrapped', () => {
        assert.match(css, /\.pswitch-value \{ overflow: hidden; text-overflow: ellipsis; white-space: nowrap; \}/);
    });
    test('the read-only programme field is still hidden on a phone (it is not a control)', () => {
        assert.match(css, /@media \(max-width: 560px\) \{\s*\.topbar-program-field \{ display: none; \}/);
    });
});
