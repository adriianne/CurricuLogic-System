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
