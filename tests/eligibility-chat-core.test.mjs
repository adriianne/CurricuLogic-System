import { test, describe } from 'node:test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const core = require('../supabase/functions/eligibility-chat/core.js');

const summary = { studentName: 'Athea', recommended: [], locked: [] };

test('a normal assessment gives the server-built summary', () => {
    const r = core.interpretAssessment(200, { assessed: true, summary, student: { id: 1 } });
    assert.deepEqual(r, { ok: true, summary });
});

test('a record that is not verified is explained, not treated as an error', () => {
    const r = core.interpretAssessment(200, { assessed: false, reason: 'record_not_verified' });
    assert.equal(r.ok, false);
    assert.equal(r.status, 409);
    assert.match(r.error, /not been verified/);
    assert.match(r.error, /Registrar/);
});

test('no curriculum has its own sentence, and an unknown reason still has one', () => {
    assert.match(core.interpretAssessment(200, { assessed: false, reason: 'no_curriculum' }).error, /No curriculum/);
    const other = core.interpretAssessment(200, { assessed: false, reason: 'something_new' });
    assert.equal(other.status, 409);
    assert.ok(other.error.length > 10);
});

test('a curriculum that has not started uses the server sentence, or its own when there is none', () => {
    const said = core.interpretAssessment(200, { assessed: false, reason: 'curriculum_not_started', message: 'Takes effect in 2050.' });
    assert.equal(said.status, 409);
    assert.equal(said.error, 'Takes effect in 2050.');
    const bare = core.interpretAssessment(200, { assessed: false, reason: 'curriculum_not_started' });
    assert.match(bare.error, /has not started yet/);
    assert.match(bare.error, /department/);
    const blank = core.interpretAssessment(200, { assessed: false, reason: 'curriculum_not_started', message: '  ' });
    assert.match(blank.error, /has not started yet/);
});

test('sign-in, approval and missing-student answers are passed on with their own status', () => {
    assert.deepEqual(core.interpretAssessment(401, null), { ok: false, status: 401, error: 'Not signed in.' });
    assert.equal(core.interpretAssessment(403, { error: 'x' }).status, 403);
    assert.equal(core.interpretAssessment(404, { error: 'x' }).status, 404);
});

test('a failed or unreachable assess-student is a temporary failure, never a fallback', () => {
    for (const [status, body] of [[0, null], [500, { error: 'x' }], [502, null], [200, null], [200, 'text']]) {
        const r = core.interpretAssessment(status, body);
        assert.equal(r.ok, false, `${status}`);
        assert.equal(r.status, 502, `${status}`);
        assert.equal(r.error, core.TRY_AGAIN);
    }
});

test('an answer without a usable summary is refused', () => {
    for (const body of [{ assessed: true }, { assessed: true, summary: null }, { assessed: true, summary: 'x' }, { assessed: true, summary: [1] }, {}]) {
        const r = core.interpretAssessment(200, body);
        assert.equal(r.ok, false, JSON.stringify(body));
        assert.equal(r.status, 502);
    }
});

test('the chat function no longer reads a summary from the request body', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../supabase/functions/eligibility-chat/index.ts', import.meta.url), 'utf8');
    assert.equal(/const\s*\{[^}]*\bsummary\b[^}]*\}\s*=\s*await req\.json\(\)/.test(src), false,
        'index.ts takes the summary from the client again');
    assert.match(src, /functions\/v1\/assess-student/);
});

describe('the adviser note in the system instruction', () => {
    // index.ts holds the instruction Cura is given; the note is only useful if Cura is told to repeat it faithfully.
    const source = fs.readFileSync(new URL('../supabase/functions/eligibility-chat/index.ts', import.meta.url), 'utf8');

    test('tells Cura to pass on the adviser note, as written, from the adviser', () => {
        assert.match(source, /"adviserNote"/);
        assert.match(source, /pass the note on in plain words, as it is written/);
        assert.match(source, /Never invent, add to or soften a note/);
    });

    test('tells Cura to say nothing about a note when there is none, and not to name the field', () => {
        assert.match(source, /when "adviserNote" is null there is no note/);
        assert.match(source, /Never mention the field name "adviserNote"/);
    });
});

// ---- cleanWishes: what Cura writes down about a plan, checked before anyone uses it ----

const wishSummary = {
    unitLimit: 24,
    recommended: [{ code: 'MATH 101' }, { code: 'CC-COMPROG11' }],
    leftOutForClash: [{ code: 'SOCIO 101' }],
};

test('nothing asked gives no wishes', () => {
    for (const raw of [null, undefined, 'mornings', 7, [], {}, { avoidDays: [], keepSubjects: [] }]) {
        const r = core.cleanWishes(raw, wishSummary);
        assert.equal(r.wishes, null);
        assert.deepEqual(r.ignored, []);
    }
});

test('a normal wish is kept and tidied', () => {
    const r = core.cleanWishes({
        earliestStart: '9:00', latestEnd: '15:30',
        avoidDays: ['fri', 'Saturday', 'FRI'], maxUnits: 15.9, keepSubjects: ['math-101', 'SOCIO101'],
    }, wishSummary);
    assert.deepEqual(r.wishes, {
        earliestStart: '09:00', latestEnd: '15:30', avoidDays: ['FRI', 'SAT'], maxUnits: 15, keepSubjects: ['MATH 101', 'SOCIO 101'],
    });
    assert.deepEqual(r.ignored, []);
});

test('a subject the student cannot take is dropped with a reason, never kept', () => {
    const r = core.cleanWishes({ keepSubjects: ['MATH 101', 'PHYS 999'] }, wishSummary);
    assert.deepEqual(r.wishes.keepSubjects, ['MATH 101']);
    assert.equal(r.ignored.length, 1);
    assert.equal(r.ignored[0].field, 'keepSubjects');
    assert.equal(r.ignored[0].value, 'PHYS 999');
});

test('only a made-up subject gives no wishes at all', () => {
    const r = core.cleanWishes({ keepSubjects: ['NOPE 1'] }, wishSummary);
    assert.equal(r.wishes, null);
    assert.equal(r.ignored.length, 1);
});

test('bad times and days are dropped one by one', () => {
    const r = core.cleanWishes({ earliestStart: '25:00', latestEnd: 'noon', avoidDays: ['Funday', 5, 'mon'] }, wishSummary);
    assert.deepEqual(r.wishes, { earliestStart: null, latestEnd: null, avoidDays: ['MON'], maxUnits: null, keepSubjects: [] });
    assert.equal(r.ignored.length, 4);
});

test('a start that is not before the end drops both times', () => {
    const r = core.cleanWishes({ earliestStart: '16:00', latestEnd: '09:00', maxUnits: 12 }, wishSummary);
    assert.equal(r.wishes.earliestStart, null);
    assert.equal(r.wishes.latestEnd, null);
    assert.equal(r.wishes.maxUnits, 12);
    assert.equal(r.ignored.length, 2);
});

test('units above the student limit are cut to it, and nonsense units are dropped', () => {
    const over = core.cleanWishes({ maxUnits: 40 }, wishSummary);
    assert.equal(over.wishes.maxUnits, 24);
    assert.match(over.ignored[0].why, /24/);
    for (const bad of [0, -3, 'lots', NaN]) {
        const r = core.cleanWishes({ maxUnits: bad }, wishSummary);
        assert.equal(r.wishes, null, String(bad));
    }
});

test('with no known limit the units are kept as asked', () => {
    assert.equal(core.cleanWishes({ maxUnits: 40 }, { recommended: [] }).wishes.maxUnits, 40);
});

test('wishes cannot be forced past the checker by odd input', () => {
    const r = core.cleanWishes({
        earliestStart: { x: 1 }, avoidDays: 'FRI', keepSubjects: 'MATH 101', maxUnits: '12',
    }, wishSummary);
    assert.equal(r.wishes.maxUnits, 12);
    assert.deepEqual(r.wishes.avoidDays, []);
    assert.deepEqual(r.wishes.keepSubjects, []);
});

test('avoiding every weekday is not a wish a plan can follow', () => {
    const r = core.cleanWishes({ avoidDays: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'], maxUnits: 12 }, wishSummary);
    assert.deepEqual(r.wishes.avoidDays, []);
    assert.equal(r.wishes.maxUnits, 12);
    assert.equal(r.ignored.length, 7);
    // four of five weekdays is fine
    assert.deepEqual(core.cleanWishes({ avoidDays: ['MON', 'TUE', 'WED', 'THU'] }, wishSummary).wishes.avoidDays, ['MON', 'TUE', 'WED', 'THU']);
});

test('at most twelve subjects can be kept', () => {
    const many = { recommended: Array.from({ length: 15 }, (_, i) => ({ code: `S ${i}` })) };
    const r = core.cleanWishes({ keepSubjects: many.recommended.map(s => s.code) }, many);
    assert.equal(r.wishes.keepSubjects.length, 12);
    assert.equal(r.ignored.length, 3);
});

describe('the wishes instruction', () => {
    const src = fs.readFileSync(new URL('../supabase/functions/eligibility-chat/index.ts', import.meta.url), 'utf8');
    test('asks for a wishes field and checks it with cleanWishes before it is returned', () => {
        assert.match(src, /"wishes": null or \{/);
        assert.match(src, /core\.cleanWishes\(parsed\.wishes, summary\)/);
    });
    test('tells Cura to only note a wish, never claim it changed the plan, and not name the fields', () => {
        assert.match(src, /never say you have changed, built or applied a plan/);
        assert.match(src, /Look ONLY at the student's latest message/);
        assert.match(src, /Never mention the field names "wishes"/);
    });
});
