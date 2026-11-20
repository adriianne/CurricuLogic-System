// versionlabels.test.mjs
// Two wording fixes found in the live role tests of 20 Nov 2026.
//   1. Department > Curriculum: the year selector called every version that is not active "Draft", even a published one.
//   2. Student > Ask AI: the line above the chat said "0 subjects suggested" when the plan was already submitted.
//
//   node --test tests/versionlabels.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const dept = read('features/department/departmentdashboard.js');
const student = read('features/student/studentdashboard.js');

describe('the curriculum year selector names a version the way the Prospectus table does', () => {
    test('active, retired, published, then draft, in that order', () => {
        const line = dept.split('\n').find(l => l.includes("' · Active'"));
        assert.ok(line, 'selector label line not found');
        assert.ok(line.indexOf("' · Active'") < line.indexOf("' · Retired'"));
        assert.ok(line.indexOf("' · Retired'") < line.indexOf("' · Published'"));
        assert.ok(line.indexOf("' · Published'") < line.indexOf("' · Draft'"));
    });
    test('it reads the same two fields the table pill reads', () => {
        const pill = dept.slice(dept.indexOf('if (v.retired_at)'), dept.indexOf('if (v.retired_at)') + 400);
        assert.ok(pill.includes('v.published_at'));
        const line = dept.split('\n').find(l => l.includes("' · Active'"));
        assert.ok(line.includes('v.retired_at') && line.includes('v.published_at'));
    });
});

describe('the line above Cura says "already submitted" when that is the case', () => {
    const body = student.slice(student.indexOf('function renderChatContext('), student.indexOf('function renderChatContext(') + 1600);
    test('a plan already sent is counted from summary.inReview', () => {
        assert.ok(body.includes('summary.inReview'));
        assert.ok(body.includes('already submitted'));
        assert.ok(body.includes('summary.inReviewUnits'));
    });
    test('with nothing sent, the old "suggested" wording is unchanged', () => {
        assert.ok(body.includes('subjects suggested'));
        assert.ok(body.includes('summary.recommended.length'));
    });
    test('"0 subjects suggested" can no longer be shown beside a submitted plan', () => {
        // the "already submitted" branch is taken first when something was sent and nothing is left to suggest
        assert.ok(body.indexOf('sent.length && !summary.recommended.length') > 0);
    });
});
