// sectionmeetings.test.mjs
// The adviser's and the Registrar's plan tables show a section's lecture AND its lab (18 Nov 2026). A request item stores only the
// lecture's offering, so the pages read the section's other meetings (shared/js/schedule/sectionmeetings.js) and describe them
// with ScheduleConflicts.describeMeetings.
//   node --test tests/sectionmeetings.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SC = require('../shared/js/schedule/scheduleconflicts.js');
const SM = require('../shared/js/schedule/sectionmeetings.js');
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

const lec = { meeting_type: 'LEC', schedule_days: 'F', start_time: '07:30:00', end_time: '09:30:00' };
const lab = { meeting_type: 'LAB', schedule_days: 'F', start_time: '13:00:00', end_time: '16:00:00' };

describe('describeMeetings', () => {
    test('a lecture and its lab: lecture first, the lab labelled', () => {
        assert.equal(SC.describeMeetings('BSIT-1A', [lec, lab]), 'BSIT-1A · F 07:30–09:30 + LAB F 13:00–16:00');
    });
    test('the order of the rows does not matter', () => {
        assert.equal(SC.describeMeetings('BSIT-1A', [lab, lec]), SC.describeMeetings('BSIT-1A', [lec, lab]));
    });
    test('a lecture only has no label', () => {
        assert.equal(SC.describeMeetings('BSIT-1A', [{ ...lec, schedule_days: 'MW' }]), 'BSIT-1A · MW 07:30–09:30');
    });
    test('no meetings gives an empty string', () => {
        assert.equal(SC.describeMeetings('BSIT-1A', []), '');
        assert.equal(SC.describeMeetings('BSIT-1A', undefined), '');
    });
});

// A stand-in for the Supabase client: records the filters it was given and answers with the rows it was built with.
function fakeClient(rows, error = null) {
    const calls = { filters: {} };
    const q = {
        select: () => q,
        in: (col, vals) => { calls.filters[col] = vals; return q; },
        eq: (col, val) => { calls.filters[col] = val; return q; },
        // awaiting the query gives { data, error }, as the real client does
        then: (resolve, reject) => Promise.resolve({ data: rows, error }).then(resolve, reject),
    };
    return { from: (t) => { calls.table = t; return q; }, calls };
}

describe('attach', () => {
    const rows = [
        { subject_id: 7, section: 'BSIT-1A', ...lec },
        { subject_id: 7, section: 'BSIT-1A', ...lab },
        { subject_id: 7, section: 'BSIT-1B', ...lec },     // another section of the same subject
        { subject_id: 8, section: 'BSIT-1A', meeting_type: 'LEC', schedule_days: 'MW', start_time: '07:30:00', end_time: '09:00:00' },
    ];
    const items = () => [
        { subject_id: 7, offering: { section: 'BSIT-1A' } },
        { subject_id: 8, offering: { section: 'BSIT-1A' } },
        { subject_id: 9, offering: null },
    ];

    test('keeps on each item the meetings of ITS subject and ITS section only', async () => {
        const it = items();
        const c = fakeClient(rows);
        await SM.attach(c, it, 2024, 2);
        assert.equal(it[0].meetings.length, 2);                              // lecture + lab, not the 1B lecture
        assert.deepEqual(it[0].meetings.map(m => m.meeting_type).sort(), ['LAB', 'LEC']);
        assert.equal(it[1].meetings.length, 1);
        assert.deepEqual(it[2].meetings, []);                                // no offering, nothing to read
    });
    test('asks for the request\'s own term and only the subjects on the plan', async () => {
        const c = fakeClient(rows);
        await SM.attach(c, items(), 2024, 2);
        assert.equal(c.calls.table, 'subject_offering');
        assert.deepEqual(c.calls.filters.subject_id, [7, 8, 9]);
        assert.equal(c.calls.filters.academic_year, 2024);
        assert.equal(c.calls.filters.term, 2);
    });
    test('a failed read leaves every item untouched', async () => {
        const it = items();
        await SM.attach(fakeClient(null, { message: 'denied' }), it, 2024, 2);
        assert.equal(it[0].meetings, undefined);
    });
    test('nothing to read, nothing asked', async () => {
        const c = fakeClient(rows);
        await SM.attach(c, [], 2024, 2);
        await SM.attach(c, items(), null, 2);
        assert.equal(c.calls.table, undefined);
    });
});

describe('scheduleText', () => {
    test('with meetings: the section with its lecture and lab', async () => {
        const it = { subject_id: 7, offering: { section: 'BSIT-1A' }, meetings: [lec, lab] };
        assert.equal(SM.scheduleText(it, SC.describeMeetings), 'BSIT-1A · F 07:30–09:30 + LAB F 13:00–16:00');
    });
    test('without meetings: the old lecture-only text', () => {
        const it = { offering: { section: 'BSIT-1A', schedule_days: 'MW', start_time: '07:30:00', end_time: '09:00:00' } };
        assert.equal(SM.scheduleText(it, SC.describeMeetings), 'BSIT-1A · MW · 07:30–09:00');
    });
    test('without an offering: a dash', () => {
        assert.equal(SM.scheduleText({}, SC.describeMeetings), '—');
    });
});

describe('the pages', () => {
    const faculty = read('features/faculty/facultydashboard.js');
    const registrar = read('features/registrar/registrardashboard.js');
    test('both HTML pages load the module after scheduleconflicts.js', () => {
        for (const f of ['features/faculty/facultydashboard.html', 'features/registrar/registrardashboard.html']) {
            const h = read(f);
            assert.match(h, /scheduleconflicts\.js"><\/script>\s*<script src="\.\.\/\.\.\/shared\/js\/schedule\/sectionmeetings\.js"><\/script>/);
        }
    });
    test('the adviser reads the section meetings before drawing the request', () => {
        assert.match(faculty, /CurriculogicSectionMeetings\.attach\(supabase, items, req\.requested_year, req\.requested_term\)/);
        assert.match(faculty, /CurriculogicSectionMeetings\.scheduleText\(item, window\.ScheduleConflicts\.describeMeetings\)/);
    });
    test('the adviser also sees the lab on a student\'s plan (the Students page)', () => {
        assert.match(faculty, /CurriculogicSectionMeetings\.attach\(supabase, items, plan\.requested_year, plan\.requested_term\)/);
        assert.equal((faculty.match(/CurriculogicSectionMeetings\.scheduleText\(/g) || []).length, 2);
        assert.match(faculty, /id, status, remarks, subject_id,\s+subject:subject_id/);
    });
    test('the Registrar does the same on the approved plan and on a student\'s plan', () => {
        assert.match(registrar, /CurriculogicSectionMeetings\.attach\(supabase, items, req\.requested_year, req\.requested_term\)/);
        assert.match(registrar, /CurriculogicSectionMeetings\.attach\(supabase, items, plan\.requested_year, plan\.requested_term\)/);
        assert.equal((registrar.match(/CurriculogicSectionMeetings\.scheduleText\(/g) || []).length, 2);
    });
    test('the queries that feed it select subject_id', () => {
        assert.match(registrar, /id, status, remarks, subject_id,\s+subject:subject_id/);
        assert.match(registrar, /id, status, remarks, offering_id, subject_id,/);
    });
});
