// chatsuggestions.js
//
// The questions offered under Cura's chat box: at the start, and after every
// answer. Pure functions, so they are testable without a browser.
//
// Every suggestion is built from the same summary Cura reads (the student's
// own recommended subjects, locked subjects, clashes and preferences), so it is
// always something Cura can really answer about THIS student, and nothing here
// is written by the AI. A question already asked (or already answered by an
// earlier one on the same topic) is not offered again, and what is offered
// follows what was just said: after a plan table, "how do I send it to my
// adviser?" and "do any of these clash?" come first.
//
//   const questions = CurriculogicChatSuggestions.followUps({
//       summary,                       // the object eligibility-explanation.js builds
//       asked: ['What should I take next semester?'],   // what the student has sent
//       lastReply: { table: true },    // the answer just shown (null at the start)
//       max: 3,
//   });

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.CurriculogicChatSuggestions = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const MAX_LENGTH = 120;

/* The subject code at the front of a label like "CC-INTCOM11 (BSIT-1A)". */
const codeOf = (label) => String(label ?? '').trim().split(/\s+/)[0];

/* Which topics a question the student typed (or clicked) is about. */
function topicsOf(text, summary) {
    const t = String(text ?? '');
    const topics = new Set();
    if (/(take|enrol|enroll|recommend).*(next|semester|term)|what should i take|next semester/i.test(t)) topics.add('next');
    if (/how many units|unit (limit|cap)|units can i|maximum units/i.test(t)) topics.add('units');
    if (/morning|afternoon|evening|section|schedule|start(s|ing)? (time|at)|class[- ]time/i.test(t)) topics.add('time');
    if (/clash|conflict|overlap|same time|together/i.test(t)) topics.add('clash');
    if (/which (subject|one).*first|priority|bottleneck|take first/i.test(t)) topics.add('priority');
    if (/retake|re-take|failed|repeat/i.test(t)) topics.add('retake');
    if (/elective|slot/i.test(t)) topics.add('slot');
    if (/later term|left out|moved|deferred|why was/i.test(t)) topics.add('deferred');
    if (/lighter|light load|fewer units|less units|heavier|load/i.test(t)) topics.add('load');
    if (/adviser|advisor|submit|send (it|my|the)|how do i enrol|how do i enroll/i.test(t)) topics.add('submit');
    if (/units? (have )?i('ve)? (earned|passed)|how many units have|earned so far|progress/i.test(t)) topics.add('progress');
    if (/lock|unlock|why can'?t i|what do i need/i.test(t)) {
        const named = (summary?.locked ?? []).filter((l) => t.toLowerCase().includes(String(l.code).toLowerCase()));
        if (named.length) named.forEach((l) => topics.add('locked:' + l.code));
        else topics.add('locked-any');
    }
    return topics;
}

/* Every question that could be offered right now, with how much it matters. */
function candidates(summary, lastReply) {
    const recs = summary?.recommended ?? [];
    const locked = summary?.locked ?? [];
    const clashes = summary?.scheduleConflicts ?? [];
    const pref = summary?.preferences ?? null;
    const afterTable = !!lastReply?.table;
    const list = [];
    const add = (topic, text, score) => list.push({ topic, text, score });

    if (recs.length) add('next', 'What should I take next semester?', 100);
    add('units', 'How many units can I take?', 90);

    if (recs.some((r) => r.sections?.length)) {
        add('time', pref?.timeOfDay ? 'Do my sections match my class-time preference?' : 'Which of my recommended subjects have morning sections?',
            80 + (afterTable ? 5 : 0));
    }

    if (clashes.length) {
        const a = codeOf(clashes[0].a), b = codeOf(clashes[0].b);
        add('clash', a && b && a !== b ? `Do ${a} and ${b} clash?` : 'Do any of my recommended subjects clash?',
            85 + (afterTable ? 10 : 0));
    }

    if (recs.some((r) => r.slotOptions?.length)) add('slot', 'What can I choose for my elective slot?', 78);
    if (recs.some((r) => r.retake)) add('retake', 'Which subjects do I need to retake?', 75);
    if (recs.length > 1) add('priority', 'Which subject should I take first?', 65);

    if (pref?.movedToLaterTerm?.length) {
        add('deferred', `Why was ${pref.movedToLaterTerm[0]} left for a later term?`, 72);
    } else if ((summary?.recommendedUnits ?? 0) >= 21) {
        add('load', 'What if I want a lighter load?', 55);
    }

    if (locked[0]) add('locked:' + locked[0].code, `Why is ${locked[0].code} locked?`, 70);
    if (locked[1]) add('locked:' + locked[1].code, `What do I need to unlock ${locked[1].code}?`, 60);

    // Once a plan has been shown, the natural next step is sending it.
    if (afterTable) add('submit', 'How do I send my plan to my adviser?', 96);

    add('progress', 'How many units have I earned so far?', 40);
    return list;
}

/* Up to `max` questions to offer, most useful first; [] when nothing is left. */
function followUps({ summary, asked = [], lastReply = null, max = 3 } = {}) {
    if (!summary) return [];

    const done = new Set();
    for (const q of asked) for (const t of topicsOf(q, summary)) done.add(t);
    const askedText = new Set(asked.map((q) => String(q ?? '').trim().toLowerCase()));

    const out = [];
    const seen = new Set();
    // sort by score; the stable sort keeps the order above for ties
    for (const c of candidates(summary, lastReply).sort((x, y) => y.score - x.score)) {
        if (done.has(c.topic) || seen.has(c.topic)) continue;
        // "Why is X locked?" is also answered once the student asked about locked subjects in general
        if (c.topic.startsWith('locked:') && done.has('locked-any')) continue;
        const text = c.text.slice(0, MAX_LENGTH);
        if (askedText.has(text.toLowerCase())) continue;
        seen.add(c.topic);
        out.push(text);
        if (out.length >= max) break;
    }
    return out;
}

return { followUps, topicsOf, candidates, MAX_LENGTH };
}));
