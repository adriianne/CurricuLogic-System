// systemconfig.js
// Single source of truth for "what term/academic year is it right now."
//
// Before this file existed, that value was hardcoded independently in
// three places that had to be kept in sync by hand: every dashboard's
// static topbar text ("1st Sem · AY 2026–2027"), and CURRENT_TERM/
// CURRENT_YEAR inside studentdashboard.js (which is what actually gets
// sent when a student submits an advising request). They had already
// drifted -- the topbar said AY 2026–2027 while studentdashboard.js said
// 2026 and the only real subject_offering rows in the database are for
// AY 2023. Now there is one row in `system_config` and everything reads
// from it.
//
// Load this on every dashboard. It does two things, once the dashboard has
// handed over its client (see below):
//   1. Paints #topbar-term (if the page has one) with the live term.
//   2. Exposes window.CurriculogicTerm.load() for any page that needs the actual
//      term/year values, not just the display text (the advising-request
//      payload, the faculty advising slip, the schedule screens).
//
// It has no client of its own. system_config can only be read by a signed-in
// user (db/052 closed it to signed-out visitors), so each dashboard hands over
// the client it already signs in with: window.CurriculogicTerm.setClient(supabase),
// right after creating it. Until then load() answers null and the pages keep
// their fallbacks. Nothing here ever writes.

(function () {
'use strict';

let client = null;

const TERM_LABELS = { 1: '1st Sem', 2: '2nd Sem', 3: 'Summer' };

function formatLabel(term, year) {
    const t = TERM_LABELS[term] || `Term ${term}`;
    const y = Number.isFinite(year) ? `AY ${year}–${year + 1}` : 'AY —';
    return `${t} · ${y}`;
}

let cached = null;

/* Fetches {term, year} once per page load and caches it -- every
   dashboard calls this at most once (studentdashboard.js at boot,
   paintTopbar() below on every page), so one query per page is enough.
   Before setClient() it answers null and caches nothing, so a later call works. */
async function load() {
    if (cached) return cached;
    if (!client) return null;

    const { data, error } = await client
        .from('system_config')
        .select('current_term, current_academic_year')
        .eq('id', 1)
        .maybeSingle();

    if (error || !data) {
        console.warn('systemconfig: could not load current term/year.', error?.message);
        return null;
    }

    cached = { term: data.current_term, year: data.current_academic_year };
    return cached;
}

async function paintTopbar() {
    const el = document.getElementById('topbar-term');
    if (!el) return;

    const cfg = await load();
    // If this fails, leave whatever static text is already in the HTML
    // rather than blanking it -- a stale-but-present term beats an
    // empty topbar.
    if (!cfg) return;

    el.textContent = formatLabel(cfg.term, cfg.year);
}

/* The dashboard's own (signed-in) client. Paints the header term as soon as it
   arrives. */
function setClient(c) {
    client = c || null;
    cached = null;
    if (client) paintTopbar();
}

window.CurriculogicTerm = { load, formatLabel, setClient };

})();