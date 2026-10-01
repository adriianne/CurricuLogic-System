// requeststatus.test.mjs
// Where an enrollment request stands: the adviser's approval is final.
//
//   node --test tests/requeststatus.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const RS = require('../shared/js/requeststatus.js');

const req = (status, registrar_status = null) => ({ status, registrar_status });

describe('finalApproved', () => {
    test('an adviser-approved plan is approved for enrollment, with nothing from the Registrar', () => {
        assert.equal(RS.finalApproved(req('approved')), true);
        assert.equal(RS.finalApproved(req('partially_approved')), true);
    });

    test('plans the Registrar approved under the old flow still count', () => {
        assert.equal(RS.finalApproved(req('approved', 'approved')), true);
    });

    test('a plan the Registrar sent back stays closed', () => {
        assert.equal(RS.finalApproved(req('approved', 'rejected')), false);
        assert.equal(RS.finalApproved(req('partially_approved', 'rejected')), false);
    });

    test('a plan still with the adviser, or rejected by them, is not approved', () => {
        assert.equal(RS.finalApproved(req('submitted')), false);
        assert.equal(RS.finalApproved(req('rejected')), false);
    });

    test('missing data is not approval', () => {
        assert.equal(RS.finalApproved(null), false);
        assert.equal(RS.finalApproved({}), false);
    });
});

describe('waiting', () => {
    test('only a submitted plan is waiting, and only on the adviser', () => {
        assert.equal(RS.waiting(req('submitted')), true);
        assert.equal(RS.waiting(req('approved')), false);
        assert.equal(RS.waiting(req('approved', null)), false, 'no longer waits for the Registrar');
        assert.equal(RS.waiting(req('rejected')), false);
    });
});

describe('stages', () => {
    test('one step for a plan the adviser approved', () => {
        const s = RS.stages(req('approved'));
        assert.deepEqual(s.faculty, { label: 'Approved for enrollment', chip: 'ok' });
        assert.equal(s.registrar, null);
    });

    test('a partly approved plan says so', () => {
        assert.equal(RS.stages(req('partially_approved')).faculty.label, 'Partly approved for enrollment');
    });

    test('waiting and rejected', () => {
        assert.deepEqual(RS.stages(req('submitted')).faculty, { label: 'Awaiting adviser', chip: 'info' });
        assert.deepEqual(RS.stages(req('rejected')).faculty, { label: 'Rejected by adviser', chip: 'danger' });
        assert.equal(RS.stages(req('rejected')).registrar, null);
    });

    test('no "Awaiting Registrar" step exists any more', () => {
        for (const status of ['submitted', 'approved', 'partially_approved', 'rejected']) {
            const s = RS.stages(req(status));
            assert.ok(!/registrar/i.test(s.faculty.label));
            assert.ok(s.registrar === null);
        }
    });

    test('an old sent-back plan keeps its second, red step', () => {
        const s = RS.stages(req('approved', 'rejected'));
        assert.equal(s.registrar.label, 'Sent back by Registrar');
        assert.equal(s.registrar.chip, 'danger');
        assert.equal(s.faculty.label, 'Approved by adviser', 'not "approved for enrollment" beside a red step');
    });

    test('an unknown status is shown, not hidden', () => {
        assert.equal(RS.stages(req('mystery')).faculty.label, 'mystery');
    });
});
