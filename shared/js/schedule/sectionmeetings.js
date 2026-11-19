// sectionmeetings.js
//
// A request item stores ONE offering, the lecture. The laboratory of the same section is another schedule row with its own EDP code,
// so a page that lists a plan has to read it separately or the lab is missing from the table (18 Nov 2026: the adviser's and the
// Registrar's tables showed Computer Programming 2 without its Friday lab, while the student's page and the printed enrollment form
// had it). attach() reads the meetings of every item's subject and section for the request's term and keeps them on the item as
// item.meetings; ScheduleConflicts.describeMeetings turns them into the text.
//
// A failed read leaves every item untouched, so the table falls back to the lecture only, as before.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.CurriculogicSectionMeetings = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

/* client: the Supabase client. items: request_item rows with subject_id and offering { section }. */
async function attach(client, items, year, term) {
    if (!client || !items || !items.length) return;
    const subjectIds = [...new Set(items.map(i => i.subject_id).filter(Boolean))];
    if (!subjectIds.length || !year || !term) return;
    const { data, error } = await client.from('subject_offering')
        .select('subject_id, section, meeting_type, schedule_days, start_time, end_time')
        .in('subject_id', subjectIds).eq('academic_year', year).eq('term', term);
    if (error) { if (typeof console !== 'undefined') console.warn('section meetings could not be read:', error.message); return; }
    for (const it of items) {
        const section = it.offering && it.offering.section;
        it.meetings = section ? (data || []).filter(m => m.subject_id === it.subject_id && m.section === section) : [];
    }
}

/* The schedule text of one item: the section with its lecture and lab, or the old lecture-only text when nothing was read. */
function scheduleText(item, describeMeetings) {
    const o = item && item.offering;
    if (item && item.meetings && item.meetings.length && describeMeetings) return describeMeetings(o && o.section, item.meetings);
    if (!o) return '\u2014';
    const time = (o.start_time && o.end_time) ? String(o.start_time).slice(0, 5) + '\u2013' + String(o.end_time).slice(0, 5) : '';
    return [o.section, o.schedule_days, time].filter(Boolean).join(' \u00b7 ') || '\u2014';
}

return { attach, scheduleText };

}));
