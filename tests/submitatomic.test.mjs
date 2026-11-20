// submitatomic.test.mjs
// Two submissions at the same instant (found 20 Nov 2026, fixed in db/128 + submit-advising-request).
//
//   node --test tests/submitatomic.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const core = require('../supabase/functions/submit-advising-request/core.js');
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const sql = read('db/128_submit_request_atomic.sql');
const index = read('supabase/functions/submit-advising-request/index.ts');

describe('the database function (db/128)', () => {
    test('it takes a lock for the student before it checks anything', () => {
        const lock = sql.indexOf('pg_advisory_xact_lock');
        assert.ok(lock > 0);
        assert.ok(lock < sql.indexOf("raise exception 'ALREADY_SUBMITTED"));
        assert.ok(lock < sql.indexOf("raise exception 'RATE_GAP"));
        assert.ok(lock < sql.indexOf('insert into request '));
    });
    test('the lock is per student and ends with the transaction', () => {
        assert.ok(sql.includes("'submit_advising_request:' || sid::text"));
        assert.ok(sql.includes('pg_advisory_xact_lock'));     // the xact form: released at commit or rollback
        assert.ok(!sql.includes('pg_advisory_lock('));        // never the session form, which would stay held
    });
    test('the request and its subjects are written by the same function', () => {
        assert.ok(sql.indexOf('insert into request ') > 0);
        assert.ok(sql.indexOf('insert into request_item') > sql.indexOf('insert into request '));
    });
    test('it runs as the student, so row-level security still applies', () => {
        assert.ok(/security invoker/i.test(sql));
        assert.ok(!/security definer/i.test(sql));
    });
    test('anonymous callers cannot run it, signed-in ones can', () => {
        assert.ok(sql.includes('revoke all on function public.submit_advising_request(integer, integer, integer, jsonb) from public, anon;'));
        assert.ok(sql.includes('grant execute on function public.submit_advising_request(integer, integer, integer, jsonb) to authenticated;'));
    });
    test('it states the same numbers as the early check in core.js', () => {
        assert.ok(sql.includes('if n_day >= ' + core.MAX_PER_DAY));
        assert.ok(sql.includes('30 - ceil(') && core.MIN_GAP_SECONDS === 30);
        assert.ok(sql.includes("interval '24 hours'"));
    });
    test('a withdrawn plan holds nothing, and a sent-back plan or rejected item frees the subject', () => {
        assert.ok(sql.includes("coalesce(r.status, '') <> 'withdrawn'"));
        assert.ok(sql.includes("coalesce(l.registrar_status, '') <> 'rejected'"));
        assert.ok(sql.includes("coalesce(l.item_status, '') <> 'rejected'"));
    });
});

describe('the edge function uses it', () => {
    test('one database call replaces the two separate inserts', () => {
        assert.ok(index.includes('db.rpc("submit_advising_request"'));
        assert.ok(!index.includes('.from("request")\n      .insert('));
        assert.ok(!index.includes('from("request_item").insert('));
    });
    test('it still checks first with core.js, so the early answer and the dry run are unchanged', () => {
        assert.ok(index.includes('core.lockedSubjectIds('));
        assert.ok(index.includes('core.submissionLimit('));
        assert.ok(index.indexOf('core.submissionLimit(') < index.indexOf('db.rpc("submit_advising_request"'));
    });
    test('a refusal from the database becomes a plain sentence, and anything else is a 500 without the raw text', () => {
        assert.ok(index.includes('core.describeSubmitError(submitError.message)'));
        assert.ok(index.includes('"Could not create the request."'));
        assert.ok(!/error:\s*submitError\.message/.test(index));
    });
});

describe('describeSubmitError turns what the database says into what the student reads', () => {
    test('a subject sent at the same moment: 409 with the codes', () => {
        const r = core.describeSubmitError('ALREADY_SUBMITTED:HUM 101, PSYCH 101');
        assert.equal(r.status, 409);
        assert.equal(r.error, 'Already submitted and awaiting a decision: HUM 101, PSYCH 101. Refresh Build Your Plan and try again.');
    });
    test('the same sentences as the early check', () => {
        // core.js early check (index.ts) says exactly this for the same case
        assert.ok(index.includes('Already submitted and awaiting a decision: ${codes.join(", ")}. Refresh Build Your Plan and try again.'));
    });
    test('too soon: 429 with the seconds', () => {
        assert.deepEqual(core.describeSubmitError('RATE_GAP:12'), { status: 429, error: 'Please wait 12 seconds before sending another request.' });
        assert.deepEqual(core.describeSubmitError('RATE_GAP:1'), { status: 429, error: 'Please wait 1 second before sending another request.' });
    });
    test('too many in a day: 429 with the hours, same sentence as submissionLimit', () => {
        const day = core.describeSubmitError('RATE_DAY:18');
        assert.equal(day.status, 429);
        assert.equal(day.error, 'You have already sent 5 requests in the last 24 hours. Try again in about 18 hours, or talk to your adviser.');
        const now = Date.now();
        const early = core.submissionLimit(Array.from({ length: 5 }, (_, i) => ({ created_at: new Date(now - (6 + i) * 3600 * 1000).toISOString() })), now);
        assert.equal(early.error.replace(/about \d+ hours?/, 'about N hours'), day.error.replace(/about \d+ hours?/, 'about N hours'));
    });
    test('the other codes, and a message that is not ours', () => {
        assert.equal(core.describeSubmitError('NOT_A_STUDENT').status, 403);
        assert.equal(core.describeSubmitError('NO_ITEMS').status, 400);
        assert.equal(core.describeSubmitError('permission denied for table request'), null);
        assert.equal(core.describeSubmitError(undefined), null);
    });
    test('the raw database text never reaches the student', () => {
        const r = core.describeSubmitError('P0001: ALREADY_SUBMITTED:HUM 101');
        assert.ok(!/P0001|ALREADY_SUBMITTED/.test(r.error));
    });
});
