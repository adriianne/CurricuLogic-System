// extractioncheck.js
//
// A check on what the curriculum reader (the AI) extracted from a PDF, that does not depend on how the PDF is laid out.
//
// WHY: the reader can miss a block of a document (on 17 Nov 2026 a whole summer term, 6 units, went missing from a
// 2023-2024 curriculum and nobody could tell from the screen), and a new university layout may show a new surprise.
// Instead of chasing every layout, the reader is also asked to report the totals the document PRINTS: a "Total" line
// under each semester or summer, and a grand total of units. This module adds up the subjects the reader returned
// and compares the two, so a missing block shows as a warning before anything is saved. It works for any layout that
// prints totals.
//
//   printed_totals (from the reader):
//     { grand_total_units: 176 | null, blocks: [{ year_level: 3, term: 3, total_units: 6 }, ...] }
//
//   check(subjects, printedTotals) -> { checked, warnings: [text], actualTotal, actualBlocks }
//     checked  true when the document printed at least one total that could be compared
//
// A document may count units differently from the rows (for example a grand total without NSTP), so the wording of every
// warning says "check", never "wrong". Pure functions only, so they are testable without a browser or the AI.

(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.CurriculogicExtractionCheck = factory();
}(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const YEAR = { 1: '1st year', 2: '2nd year', 3: '3rd year', 4: '4th year', 5: '5th year', 6: '6th year' };
const TERM = { 1: '1st semester', 2: '2nd semester', 3: 'summer' };

const label = (y, t) => `${YEAR[y] ?? `year ${y}`}, ${TERM[t] ?? `term ${t}`}`;
const units = (s) => (Number(s?.lecture_units) || 0) + (Number(s?.laboratory_units) || 0);
const whole = (n) => Number.isFinite(n) && n >= 0 && n <= 1000;
const num = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v));

/* "IT Elective 1", "Free Elective 2": placeholder rows that legitimately repeat the same code. */
const isPlaceholder = (s) => /\belective\b/i.test(String(s?.title ?? ''));

function check(subjects, printedTotals) {
    const subs = Array.isArray(subjects) ? subjects : [];
    const scheduled = subs.filter((s) => Number.isInteger(s?.year_level) && Number.isInteger(s?.term));

    const actualBlocks = {};
    for (const s of scheduled) {
        const k = `${s.year_level}:${s.term}`;
        actualBlocks[k] = (actualBlocks[k] ?? 0) + units(s);
    }
    const actualTotal = scheduled.reduce((a, s) => a + units(s), 0);

    const warnings = [];
    let checked = false;

    // ---- the printed totals ----
    const printed = printedTotals && typeof printedTotals === 'object' ? printedTotals : {};
    const grand = num(printed.grand_total_units);

    if (whole(grand) && grand > 0) {
        checked = true;
        if (actualTotal !== grand) {
            const diff = grand - actualTotal;
            warnings.push(
                `The subjects add up to ${actualTotal} units, but the document's total is ${grand} `
                + `(${Math.abs(diff)} unit${Math.abs(diff) === 1 ? '' : 's'} ${diff > 0 ? 'short' : 'over'}). `
                + `Check that no subject, or a whole block such as a summer term, is missing or counted twice.`);
        }
    }

    const seen = new Set();
    for (const b of Array.isArray(printed.blocks) ? printed.blocks : []) {
        const y = Number(b?.year_level), t = Number(b?.term), total = num(b?.total_units);
        if (!Number.isInteger(y) || !Number.isInteger(t) || !whole(total)) continue;
        const k = `${y}:${t}`;
        if (seen.has(k)) continue;           // the same block reported twice: the first one counts
        seen.add(k);
        checked = true;
        const actual = actualBlocks[k] ?? 0;
        if (actual !== total) {
            warnings.push(
                actual === 0
                    ? `The document prints a total of ${total} units for ${label(y, t)}, but no subjects were found there. The whole block may be missing.`
                    : `${label(y, t)} adds up to ${actual} units, but the document prints ${total}. Check its subjects.`);
        }
    }

    // ---- things that are wrong whatever the document prints ----
    const byCode = new Map();
    for (const s of subs) {
        const code = String(s?.code ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
        if (!code || isPlaceholder(s)) continue;
        byCode.set(code, (byCode.get(code) ?? 0) + 1);
    }
    for (const [code, n] of byCode) {
        if (n > 1) warnings.push(`The code ${code} appears ${n} times. Check for a repeated or mis-read row.`);
    }

    return { checked, warnings, actualTotal, actualBlocks };
}

/* ------------------------------------------------------------------------------------------------------------
   THE SCAN CHECK (the overview shown under the AI-assisted upload)

   check() above lists only what is wrong. The person uploading also wants to be told what went RIGHT, in plain words:
   "the units match the document", "no repeated codes", "every prerequisite points to a subject in this document".
   overview() turns the same facts, plus the counts the builder gathered while turning the reading into rows, into a
   short list of checks, each ok / warn / info, and one verdict. html() draws it. Both are pure.

     overview(subjects, printedTotals, extras) -> { verdict: 'ok' | 'warn', headline, sub, checks: [{ status, title, detail, items }],
                                                   blocks: [{ label, printed, read, ok }], note, passed, warned }
       extras: { prereqLinks, gates, coreqs, followUps: [text], interpreted: [text], rowsWithErrors }

   It can only compare the reading with what the document prints and with the builder's own rules. A prerequisite
   that was read wrongly but still names a real subject, or a mis-read title, is invisible to it: the note says so.
   ------------------------------------------------------------------------------------------------------------ */

const NOTE = 'These checks compare the scan with the totals printed in the document and with the builder’s own rules. '
    + 'They cannot tell whether a prerequisite or a title was read wrongly, so still skim the rows below before you save.';

const plural = (n, one, many) => (n === 1 ? one : many);
const UNRESOLVED = /is not a subject in this document/;

function overview(subjects, printedTotals, extras) {
    const x = extras && typeof extras === 'object' ? extras : {};
    const subs = Array.isArray(subjects) ? subjects : [];
    const base = check(subs, printedTotals);
    const scheduled = subs.filter((s) => Number.isInteger(s?.year_level) && Number.isInteger(s?.term));
    const catalogue = subs.length - scheduled.length;
    const printed = printedTotals && typeof printedTotals === 'object' ? printedTotals : {};
    const grand = num(printed.grand_total_units);
    const hasGrand = whole(grand) && grand > 0;

    const checks = [];
    // jump: which rows of the table this check is about, so the card can take the person to them: { kind: 'issues' } (every row
    // the builder flags) or { kind: 'codes', codes: [...] } (the rows with these codes). Null for a check about the whole file.
    const add = (status, title, detail, items, jump) => checks.push({
        status, title, detail: detail ?? '', items: Array.isArray(items) && items.length ? items : null, jump: jump ?? null });
    const codesOf = (texts) => [...new Set(texts.map((t) => (String(t).match(/^([^:]+):/) || [])[1]?.trim()).filter(Boolean))];

    // 1. what was found
    if (!subs.length) add('warn', 'No subjects were found', 'The document was accepted as a curriculum, but nothing could be read from it.');
    else add('ok', `${subs.length} ${plural(subs.length, 'subject', 'subjects')} read`,
        `${scheduled.length} in the year-by-year tables${catalogue ? ` and ${catalogue} in the elective lists` : ''}.`);

    // 2. units against the grand total
    if (hasGrand) {
        if (base.actualTotal === grand) {
            add('ok', 'Units match the document', `The subjects add up to ${base.actualTotal} of the ${grand} units the document prints.`);
        } else {
            const diff = grand - base.actualTotal;
            add('warn', 'Units do not match the document',
                `The subjects add up to ${base.actualTotal} units; the document prints ${grand} `
                + `(${Math.abs(diff)} ${plural(Math.abs(diff), 'unit', 'units')} ${diff > 0 ? 'short' : 'over'}).`);
        }
    }

    // 3. every printed semester total
    const blocks = [];
    const seen = new Set();
    for (const b of Array.isArray(printed.blocks) ? printed.blocks : []) {
        const y = Number(b?.year_level), t = Number(b?.term), total = num(b?.total_units);
        if (!Number.isInteger(y) || !Number.isInteger(t) || !whole(total)) continue;
        const k = `${y}:${t}`;
        if (seen.has(k)) continue;
        seen.add(k);
        const read = base.actualBlocks[k] ?? 0;
        blocks.push({ label: label(y, t), year: y, term: t, printed: total, read, ok: read === total });
    }
    const off = blocks.filter((b) => !b.ok);
    if (blocks.length) {
        if (!off.length) {
            add('ok', `All ${blocks.length} semester ${plural(blocks.length, 'total', 'totals')} match`, 'Each semester adds up to the total printed under it.');
        } else {
            add('warn', `${off.length} of ${blocks.length} semester totals differ`, 'A semester may be missing a subject, or have one counted twice.',
                off.map((b) => `${b.label}: document ${b.printed}, scan ${b.read}`));
        }
    }
    if (!hasGrand && !blocks.length) {
        add('info', 'The document prints no totals', 'The units could not be compared with the document. Add them up yourself from the tiles below.');
    } else if (!hasGrand) {
        add('info', 'No grand total printed', 'Only the semester totals could be compared.');
    }

    // 4. repeated codes
    const byCode = new Map();
    for (const s of subs) {
        const code = String(s?.code ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
        if (!code || isPlaceholder(s)) continue;
        byCode.set(code, (byCode.get(code) ?? 0) + 1);
    }
    const repeated = [...byCode].filter(([, n]) => n > 1).map(([c, n]) => `${c} appears ${n} times`);
    if (repeated.length) {
        add('warn', `${repeated.length} repeated ${plural(repeated.length, 'code', 'codes')}`, 'A row may have been read twice or read wrongly.', repeated,
            { kind: 'codes', codes: [...byCode].filter(([, n]) => n > 1).map(([c]) => c) });
    } else if (subs.length) {
        add('ok', 'No repeated subject codes');
    }

    // 5. subjects with no units
    const noUnits = scheduled.filter((s) => units(s) === 0).map((s) => String(s.code ?? '').trim() || '(no code)');
    if (noUnits.length) {
        add('warn', `${noUnits.length} ${plural(noUnits.length, 'subject shows', 'subjects show')} 0 units`,
            'Check that the lecture and laboratory units were read.', noUnits.slice(0, 12),
            { kind: 'codes', codes: noUnits.filter((c) => c !== '(no code)') });
    } else if (scheduled.length) {
        add('ok', 'Every scheduled subject has units');
    }

    // 6. prerequisites
    // A link to a code that is no subject here is often the SUBJECT's own code read differently from the link: they differ
    // only in the prefix ("CS-DISCRET12" in the links, "CC-DISCRET12" as the subject). Say so, and say which to check.
    const stem = (c) => String(c ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^[A-Z]{1,4}(?=[A-Z0-9]{4,})/, '');
    const hint = (text) => {
        const m = String(text).match(/prerequisite "([^"]+)"/) || String(text).match(/co-requisite "([^"]+)"/);
        if (!m) return text;
        const asLinked = m[1];
        const twin = subs.find((s) => stem(s?.code) && stem(s.code) === stem(asLinked)
            && String(s.code).toUpperCase().replace(/[^A-Z0-9]/g, '') !== asLinked.toUpperCase().replace(/[^A-Z0-9]/g, ''));
        return twin
            ? `${text}. The document may print the subject as "${asLinked}", not "${String(twin.code).trim()}": compare that code with the PDF.`
            : text;
    };
    const followUps = Array.isArray(x.followUps) ? x.followUps.map(String) : [];
    const unresolved = followUps.filter((t) => UNRESOLVED.test(t)).map(hint);
    const byHand = followUps.filter((t) => !UNRESOLVED.test(t));
    const links = Number(x.prereqLinks) || 0;
    if (unresolved.length) {
        add('warn', `${unresolved.length} ${plural(unresolved.length, 'link names', 'links name')} a subject that is not in this document`,
            'They were left out rather than guessed. Add them by hand if they are needed.', unresolved,
            { kind: 'codes', codes: codesOf(followUps.filter((t) => UNRESOLVED.test(t))) });
    } else if (links) {
        add('ok', `${links} prerequisite ${plural(links, 'link', 'links')} read`, 'Every one points to a subject in this document.');
    } else if (subs.length) {
        add('info', 'No prerequisites were found', 'If the document lists prerequisites, check that they were read.');
    }

    // 7. what the builder turned into rules
    if (Number(x.gates) > 0) {
        add('info', `${x.gates} year-standing ${plural(x.gates, 'gate', 'gates')} from the footnotes`,
            'For example “must finish all 1st to 2nd year courses”. Check that they sit on the right subjects.');
    }
    if (Number(x.coreqs) > 0) {
        add('info', `${x.coreqs} goes-with ${plural(x.coreqs, 'link', 'links')} from the co-requisite column`, 'These subjects must be taken in the same term.');
    }
    const interpreted = Array.isArray(x.interpreted) ? x.interpreted.map(String) : [];
    if (interpreted.length) {
        add('info', `${interpreted.length} ${plural(interpreted.length, 'note', 'notes')} turned into rules`, 'The wording was read as a rule. Check each one.', interpreted, { kind: 'codes', codes: codesOf(interpreted) });
    }
    if (byHand.length) {
        add('warn', `${byHand.length} ${plural(byHand.length, 'note needs', 'notes need')} adding by hand`, 'The document states these in words that have no rule form.', byHand, { kind: 'codes', codes: codesOf(byHand) });
    }

    // 8. the builder's own row checks
    const bad = Number(x.rowsWithErrors) || 0;
    if (bad) add('warn', `${bad} ${plural(bad, 'row has', 'rows have')} issues`, 'See the Issues tile and the tabs marked with a number.', null, { kind: 'issues' });
    else if (subs.length) add('ok', 'Every row passes the builder’s checks');

    const warned = checks.filter((c) => c.status === 'warn').length;
    const passed = checks.filter((c) => c.status === 'ok').length;
    const notes = checks.filter((c) => c.status === 'info').length;   // things to read, not to fix: they are in the list, not in "passed"
    const unchecked = !hasGrand && !blocks.length;

    // THE STEPS: the stages the file went through, one circle each in the card. A circle is ok (✓), needs a look (!) or
    // has nothing to compare with (i). Each is the summary of the checks above, so the two can never disagree.
    const steps = [
        { title: 'PDF read', status: 'ok', detail: 'Recognised as a curriculum' },
        {
            title: 'Subjects found', status: subs.length ? 'ok' : 'warn',
            detail: subs.length
                ? `${subs.length} found: ${scheduled.length} scheduled${catalogue ? `, ${catalogue} electives` : ''}`
                : 'Nothing could be read',
        },
        {
            title: 'Units checked', status: hasGrand ? (base.actualTotal === grand ? 'ok' : 'warn') : 'info',
            detail: hasGrand
                ? (base.actualTotal === grand ? `${base.actualTotal} of ${grand} units match` : `${base.actualTotal} read, ${grand} printed`)
                : 'No grand total printed',
        },
        {
            title: 'Semesters checked', status: blocks.length ? (off.length ? 'warn' : 'ok') : 'info',
            detail: blocks.length
                ? (off.length ? `${off.length} of ${blocks.length} differ` : `All ${blocks.length} totals match`)
                : 'No semester totals printed',
        },
        {
            title: 'Prerequisites linked', status: unresolved.length || byHand.length ? 'warn' : links ? 'ok' : 'info',
            detail: unresolved.length ? `${unresolved.length} point outside the document`
                : byHand.length ? `${byHand.length} to add by hand`
                : links ? `${links} read${Number(x.gates) > 0 ? `, ${x.gates} year ${plural(Number(x.gates), 'gate', 'gates')}` : ''}`
                : 'None found',
        },
        {
            title: 'Rows ready', status: repeated.length || noUnits.length || bad ? 'warn' : subs.length ? 'ok' : 'info',
            detail: repeated.length || noUnits.length || bad
                ? [repeated.length && `${repeated.length} repeated`, noUnits.length && `${noUnits.length} with no units`, bad && `${bad} with issues`].filter(Boolean).join(', ')
                : 'No repeats, every row valid',
        },
    ];

    return {
        verdict: warned ? 'warn' : 'ok', passed, warned, blocks, steps, note: NOTE,
        grand: hasGrand ? { printed: grand, read: base.actualTotal, ok: base.actualTotal === grand } : null,
        headline: warned
            ? `Check ${warned} ${plural(warned, 'thing', 'things')} before you save`
            : unchecked ? 'No problems found, but the units could not be checked' : 'The scan matches the document',
        sub: warned
            ? `${passed} ${plural(passed, 'check', 'checks')} passed. The ones that need a look are marked.`
            : unchecked ? 'The document prints no totals to compare with.'
            : `All ${passed} ${plural(passed, 'check', 'checks')} passed${notes ? `, plus ${notes} ${plural(notes, 'note', 'notes')} to read` : ''}. No mistakes found by the scan check.`,
        checks,
    };
}

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ICON = { ok: '✓', warn: '!', info: 'i' };

/* The card. Every piece of text goes through esc(): subject codes and notes come from a document. */
function html(report) {
    if (!report || !Array.isArray(report.checks)) return '';
    const items = report.checks.map((c) => {
        // A check about particular rows is a button that takes the person to them (the builder wires the click). One about the
        // whole file, or whose rows are not known, stays a plain card.
        const j = c.jump && (c.jump.kind === 'issues' || (Array.isArray(c.jump.codes) && c.jump.codes.length)) ? c.jump : null;
        const many = j && (j.kind === 'issues' || j.codes.length > 1);
        const hint = j ? (j.kind === 'issues' ? 'Go to the first issue' : many ? 'Go to the first row' : 'Go to the row') : '';
        return `
        <li class="cb-scan-item is-${esc(c.status)}${j ? ' is-jump' : ''}"${j
            ? ` role="button" tabindex="0" data-jump="${esc(j.kind)}" data-codes="${esc(JSON.stringify(j.codes ?? []))}" title="${esc(hint)}"` : ''}>
            <span class="cb-scan-ico" aria-hidden="true">${ICON[c.status] ?? 'i'}</span>
            <div class="cb-scan-txt">
                <strong>${esc(c.title)}</strong>${c.detail ? ` <span class="cb-scan-detail">${esc(c.detail)}</span>` : ''}
                ${c.items ? `<ul class="cb-scan-sub">${c.items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
                ${j ? `<span class="cb-jump-hint">${esc(hint)} ›</span>` : ''}
            </div>
        </li>`;
    }).join('');

    // One tile per printed total, laid out in a grid that uses the card's whole width (it was a narrow table with the
    // right half empty). The bar is the scan's units against the document's; it is full when they match.
    const tile = (name, printed, read, ok, extra = '') => {
        const pct = printed > 0 ? Math.max(0, Math.min(100, Math.round((read / printed) * 100))) : (read === 0 ? 100 : 0);
        return `
            <li class="cb-tot ${ok ? 'is-ok' : 'is-off'}${extra}">
                <span class="cb-tot-name">${esc(name)}</span>
                <span class="cb-tot-nums"><b>${esc(read)}</b><span> of ${esc(printed)} units</span></span>
                <span class="cb-tot-bar" aria-hidden="true"><i style="width:${pct}%"></i></span>
                <span class="cb-tot-mark">${ok ? '✓ Matches the document' : `! Document prints ${esc(printed)}`}</span>
            </li>`;
    };
    // One column per year, its semesters stacked in it (1st above 2nd, a summer below), and the whole programme last.
    const years = [];
    for (const b of Array.isArray(report.blocks) ? report.blocks : []) {
        let col = years.find((c) => c.year === b.year);
        if (!col) { col = { year: b.year, title: YEAR[b.year] ?? `year ${b.year}`, blocks: [] }; years.push(col); }
        col.blocks.push(b);
    }
    years.sort((a, b) => (a.year ?? 0) - (b.year ?? 0));
    const columns = years.map((c) => `
                <li class="cb-yr">
                    <span class="cb-yr-name">${esc(c.title)}</span>
                    <ul class="cb-yr-tiles">${c.blocks.sort((a, b) => (a.term ?? 0) - (b.term ?? 0))
                        .map((b) => tile(TERM[b.term] ?? `term ${b.term}`, b.printed, b.read, b.ok)).join('')}
                    </ul>
                </li>`).join('')
        + (report.grand && years.length ? `
                <li class="cb-yr is-grand-col">
                    <span class="cb-yr-name">All years</span>
                    <ul class="cb-yr-tiles">${tile('Whole programme', report.grand.printed, report.grand.read, report.grand.ok, ' is-grand')}
                    </ul>
                </li>` : '');
    const tiles = columns;
    const table = tiles ? `
        <details class="cb-scan-blocks" open>
            <summary>Semester totals, document against scan (${report.blocks.length})</summary>
            <ul class="cb-tots">${tiles}
            </ul>
        </details>` : '';

    // The circles: 0----0----0----0. One per stage the file went through, joined by a line that takes the colour of the
    // stage before it. The mark inside says how that stage went; the words under it say what it found.
    const steps = Array.isArray(report.steps) && report.steps.length ? `
        <ol class="cb-steps" aria-label="How the scan went">${report.steps.map((s, i) => `
            <li class="cb-step is-${esc(s.status)}">
                <span class="cb-step-dot" aria-hidden="true">${ICON[s.status] ?? 'i'}</span>
                <span class="cb-step-txt"><strong>${esc(s.title)}</strong><span>${esc(s.detail)}</span></span>
                <span class="cb-sr">${s.status === 'ok' ? 'Passed.' : s.status === 'warn' ? 'Needs a look.' : 'Not checked.'}</span>
            </li>`).join('')}
        </ol>` : '';

    return `<div class="cb-scan is-${esc(report.verdict)}" role="region" aria-label="Scan check">
        <div class="cb-scan-head">
            <span class="cb-scan-badge" aria-hidden="true">${report.verdict === 'ok' ? '✓' : '!'}</span>
            <div><strong>${esc(report.headline)}</strong><span class="cb-scan-sub-head">${esc(report.sub)}</span></div>
        </div>
        ${steps}
        <details class="cb-scan-all"${report.verdict === 'warn' || report.checks.some((c) => c.status !== 'ok') ? ' open' : ''}>
            <summary>All checks (${report.checks.length})</summary>
            <ul class="cb-scan-list">${items}</ul>
        </details>
        ${table}
        <p class="cb-scan-note">${esc(report.note)}</p>
    </div>`;
}

/* ------------------------------------------------------------------------------------------------------------
   THE CIRCLES WHILE THE SCAN RUNS

   The same row of circles as the result, but alive: each circle is a real stage of the scan, and the one in progress
   pulses with the seconds it has taken. The long wait is the AI reading the document (30 to 90 seconds), so that is the
   circle that shows elapsed time, and after a minute it says so in words instead of looking stuck.

     progress({ stage, failedAt, message, seconds }) -> [{ title, status, detail, mark }]
       stage     the circle in progress, 1 to 6; 7 = all six done
       failedAt  the circle that failed (1 to 6), or 0/absent
       message   why it failed, in plain words
       seconds   whole seconds the AI has been reading (circle 3)
       status    'ok' done, 'run' in progress, 'wait' not reached, 'fail' stopped here
   ------------------------------------------------------------------------------------------------------------ */

const STAGES = [
    ['PDF read', 'In your browser'],
    ['Sent', 'To the server'],
    ['AI reading', 'Reading the document'],
    ['Table built', 'Subjects and prerequisites'],
    ['Totals checked', 'Against the document'],
    ['Ready', 'Review the rows'],
];
const SLOW_AFTER = 60;

function progress(state) {
    const st = state && typeof state === 'object' ? state : {};
    const stage = Math.min(7, Math.max(1, Math.floor(Number(st.stage)) || 1));
    const failedAt = Math.floor(Number(st.failedAt)) || 0;
    const seconds = Math.max(0, Math.floor(Number(st.seconds)) || 0);

    return STAGES.map(([title, detail], i) => {
        const n = i + 1;
        let status;
        if (failedAt) status = n < failedAt ? 'ok' : n === failedAt ? 'fail' : 'wait';
        else status = n < stage ? 'ok' : n === stage ? 'run' : 'wait';

        let text = detail;
        if (status === 'fail') text = String(st.message || 'Did not finish');
        else if (status === 'run') {
            // what is happening NOW in the circle that is in progress; a finished circle keeps its result words
            const pct = Number.isFinite(Number(st.uploadPct)) ? Math.min(100, Math.max(0, Math.round(Number(st.uploadPct)))) : null;
            const retry = Math.floor(Number(st.retry)) || 0;
            const again = retry > 1 ? `Stalled. Trying again (${retry} of 3)…` : 'Uploading…';
            text = n === 1 ? 'Reading the file…'
                 : n === 2 ? (pct === null || (retry > 1 && pct === 0) ? again : `${retry > 1 ? 'Trying again' : 'Uploading'}… ${pct}%`)
                 : n === 3 ? (seconds >= SLOW_AFTER ? 'Still reading. Long documents can take a minute and a half.' : `Reading… ${seconds} s`)
                 : n === 4 ? 'Building the table…'
                 : n === 5 ? 'Comparing with the totals…'
                 : 'Getting the rows ready…';
        }
        const mark = status === 'ok' ? '✓' : status === 'fail' ? '✕' : status === 'wait' ? String(n) : '';
        return { title, status, detail: text, mark };
    });
}

/* The <li> items only: the builder keeps the <ol> and repaints just these every second. */
function progressItems(state) {
    const say = { ok: 'Done.', run: 'In progress.', wait: 'Waiting.', fail: 'Stopped.' };
    return progress(state).map((s) => `
            <li class="cb-step is-${esc(s.status)}">
                <span class="cb-step-dot" aria-hidden="true">${esc(s.mark)}</span>
                <span class="cb-step-txt"><strong>${esc(s.title)}</strong><span>${esc(s.detail)}</span></span>
                <span class="cb-sr">${say[s.status]}</span>
            </li>`).join('');
}

return { check, label, units, overview, html, progress, progressItems, SLOW_AFTER };
}));
