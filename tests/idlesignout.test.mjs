// idlesignout.test.mjs
// When an unattended dashboard signs itself out.
//
//   node --test tests/idlesignout.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const I = require('../shared/js/idlesignout.js');

const MIN = 60 * 1000;

describe('limitMs', () => {
    test('each role has its own limit', () => {
        assert.equal(I.limitMs('system_administrator'), 15 * MIN);
        for (const r of ['registrar_staff', 'department_staff', 'faculty_staff']) assert.equal(I.limitMs(r), 30 * MIN, r);
        assert.equal(I.limitMs('university_student'), 60 * MIN);
    });
    test('an unknown role gets the default', () => assert.equal(I.limitMs('nobody'), 30 * MIN));
    test('an explicit number of minutes wins, a bad one is ignored', () => {
        assert.equal(I.limitMs('university_student', '10'), 10 * MIN);
        assert.equal(I.limitMs('university_student', 0.5), 30 * 1000);
        assert.equal(I.limitMs('system_administrator', 'abc'), 15 * MIN);
        assert.equal(I.limitMs('system_administrator', -3), 15 * MIN);
        assert.equal(I.limitMs('system_administrator', undefined), 15 * MIN);
    });
    test('the admin is the shortest of all', () => {
        const all = Object.values(I.LIMIT_MINUTES);
        assert.equal(Math.min(...all), I.LIMIT_MINUTES.system_administrator);
    });
});

describe('stateAt', () => {
    const limit = 10 * MIN, warn = MIN;
    test('active, then warning in the last minute, then expired', () => {
        assert.equal(I.stateAt(0, 0, limit, warn).state, 'active');
        assert.equal(I.stateAt(8 * MIN, 0, limit, warn).state, 'active');
        assert.equal(I.stateAt(9 * MIN - 1, 0, limit, warn).state, 'active');
        assert.equal(I.stateAt(9 * MIN, 0, limit, warn).state, 'warn');
        assert.equal(I.stateAt(10 * MIN - 1, 0, limit, warn).state, 'warn');
        assert.equal(I.stateAt(10 * MIN, 0, limit, warn).state, 'expired');
        assert.equal(I.stateAt(99 * MIN, 0, limit, warn).state, 'expired');
    });
    test('reports how long is left', () => {
        assert.equal(I.stateAt(9.5 * MIN, 0, limit, warn).msLeft, 0.5 * MIN);
        assert.equal(I.stateAt(0, 0, limit, warn).msLeft, limit);
    });
    test('a clock that went backwards is not idle time', () => {
        assert.equal(I.stateAt(5, 100, limit, warn).state, 'active');
    });
});

/* A watch with a fake clock, fake storage and fake screen. */
function watch(extra = {}) {
    const clock = { t: 1_000_000 };
    const data = new Map();
    const store = { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)) };
    const shown = [];
    const ui = { show: (ms) => shown.push(Math.ceil(ms / 1000)), hide: () => shown.push('hidden') };
    let expired = 0;
    const w = I.start({
        win: null, doc: null, store, ui, role: 'registrar_staff',
        now: () => clock.t, limitMs: 10 * MIN, warnMs: MIN, tickMs: 1e9,
        onExpire: () => { expired++; }, ...extra,
    });
    const advance = (ms) => { clock.t += ms; };
    return { w, clock, data, shown, advance, expired: () => expired };
}

describe('start', () => {
    test('quiet until the last minute, warns, then signs out once', () => {
        const s = watch();
        s.advance(8 * MIN); s.w.tick();
        assert.deepEqual(s.shown, []);
        assert.equal(s.expired(), 0);
        s.advance(1.5 * MIN); s.w.tick();                 // 9.5 min: 30 s left
        assert.deepEqual(s.shown, [30]);
        assert.equal(s.expired(), 0);
        s.advance(MIN); s.w.tick();                        // 10.5 min
        assert.equal(s.expired(), 1);
        s.w.tick(); s.w.tick();
        assert.equal(s.expired(), 1, 'signed out once, not repeatedly');
    });

    test('activity during the warning cancels it', () => {
        const s = watch();
        s.advance(9.5 * MIN); s.w.tick();
        assert.deepEqual(s.shown, [30]);
        s.w.touch();
        assert.deepEqual(s.shown, [30, 'hidden']);
        s.advance(5 * MIN); s.w.tick();
        assert.equal(s.expired(), 0, 'the clock restarted at the touch');
    });

    test('activity resets the clock', () => {
        const s = watch();
        s.advance(9 * MIN - 1); s.w.touch();
        s.advance(9 * MIN - 1); s.w.tick();
        assert.equal(s.expired(), 0);
        assert.deepEqual(s.shown, []);
    });

    test('activity in another tab (shared storage) keeps this one signed in', () => {
        const s = watch();
        s.advance(9.5 * MIN); s.w.tick();
        assert.deepEqual(s.shown, [30]);
        s.data.set('cl-last-active-registrar_staff', String(s.clock.t));   // the other tab wrote "now"
        s.advance(1000); s.w.tick();
        assert.equal(s.expired(), 0);
        assert.equal(s.shown.at(-1), 'hidden');
    });

    test('a computer that slept past the limit signs out on waking', () => {
        const s = watch();
        s.advance(3 * 60 * MIN); s.w.tick();
        assert.equal(s.expired(), 1);
    });

    test('stop() ends the watch', () => {
        const s = watch();
        s.w.stop();
        s.advance(60 * MIN); s.w.tick();
        assert.equal(s.expired(), 0);
    });

    test('the warning window never exceeds half the limit', () => {
        const s = watch({ limitMs: 20 * 1000, warnMs: 60 * 1000 });   // asked for 60 s warning on a 20 s limit
        s.advance(5 * 1000); s.w.tick();
        assert.deepEqual(s.shown, [], 'still active at 5 s: warning starts at 10 s');
        s.advance(6 * 1000); s.w.tick();
        assert.equal(s.shown.length, 1);
    });
});

describe('autoStart', () => {
    const fakeWin = (hostname, search) => ({ location: { hostname, search }, localStorage: null });
    const fakeDoc = (dataset) => ({ body: { dataset }, addEventListener() {}, removeEventListener() {}, getElementById: () => null, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, addEventListener() {} }) });

    test('does nothing without a role attribute', () => {
        assert.equal(I.autoStart(fakeDoc({}), fakeWin('example.edu', '')), null);
    });
    test('does nothing in localhost preview mode', () => {
        assert.equal(I.autoStart(fakeDoc({ idleRole: 'registrar_staff' }), fakeWin('127.0.0.1', '?preview')), null);
    });
    test('starts for a role, and replaces an earlier watch', () => {
        const win = fakeWin('example.edu', '');
        const first = I.autoStart(fakeDoc({ idleRole: 'registrar_staff' }), win);
        assert.ok(first && typeof first.stop === 'function');
        const second = I.autoStart(fakeDoc({ idleRole: 'registrar_staff', idleMinutes: '5' }), win);
        assert.notEqual(first, second);
        second.stop();
    });
});
