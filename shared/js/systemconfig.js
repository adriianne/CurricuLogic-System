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
// Load this after config.js on every dashboard. It does two things:
//   1. On its own, paints #topbar-term (if the page has one) as soon as
//      the DOM is ready -- no other file needs to call anything for
//      this to work.
//   2. Exposes window.CurriculogicTerm.load() for any page that needs
//      the actual term/year values, not just the display text
//      (currently just studentdashboard.js, for the advising-request
//      submission payload).
//
// This deliberately creates its own Supabase client rather than reusing
// a dashboard's own `supabase` variable -- that variable lives inside
// each dashboard's own IIFE and is not reachable from here. The anon
// key is public by design (same one every dashboard already ships to
// the browser), so a second client built from it has no security effect.

(function () {
'use strict';

const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.CURRICULOGIC ?? {};

const client = (window.supabase && SUPABASE_URL && SUPABASE_ANON_KEY)
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

const TERM_LABELS = { 1: '1st Sem', 2: '2nd Sem', 3: 'Summer' };

function formatLabel(term, year) {
    const t = TERM_LABELS[term] || `Term ${term}`;
    const y = Number.isFinite(year) ? `AY ${year}–${year + 1}` : 'AY —';
    return `${t} · ${y}`;
}

let cached = null;

/* Fetches {term, year} once per page load and caches it -- every
   dashboard calls this at most once (studentdashboard.js at boot,
   paintTopbar() below on every page), so one query per page is enough. */
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

window.CurriculogicTerm = { load, formatLabel };

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', paintTopbar);
} else {
    // This script is loaded at the end of <body> on every dashboard, so
    // DOMContentLoaded has usually already fired by the time it runs.
    paintTopbar();
}

})();