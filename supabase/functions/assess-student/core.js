// core.js -- what the assess-student function does once it has the data.
//
// Pure: no network, no database, no Deno. Given a student's records and their
// curriculum, it runs the SAME engine, preferences step and Cura summary the
// website runs, and shapes the result for a mobile client. Kept apart from
// index.ts so it can be tested in Node without a database.
//
// Nothing here decides anything. eligibility, ranking, gates and preferences
// all come from shared/engine/engine.js and shared/engine/preferences.js;
// this file only calls them and renames fields.

'use strict';

/* Meetings of one section, in a flat shape a client can print. */
function sectionOut(SC, group) {
    return {
        // The id a request names to say which section was picked.
        offeringId: group.offeringId ?? group.meetings?.[0]?.id ?? null,
        section: group.section,
        timeOfDay: SC.sectionTimeOfDay(group.meetings),
        meetings: group.meetings.map(m => ({
            type: m.meeting_type ?? 'LEC',
            days: m.schedule_days ?? '',
            start: m.start_time ?? null,
            end: m.end_time ?? null,
            room: m.room ?? null,
            // the school's EDP code for this meeting (a lecture and a lab have one each)
            edp: m.edp_code ?? null,
        })),
        // each EDP code of the section once, in meeting order: what a student writes on the form
        edp: [...new Set(group.meetings.map(m => String(m.edp_code ?? '').trim()).filter(Boolean))],
    };
}

function brief(engine, s) {
    return {
        id: s.id,
        code: s.code,
        title: s.title,
        units: Number(s.units) || 0,
        year: s.year_level ?? null,
        term: s.term ?? null,
        elective: engine.isElective(s),
        electiveType: s.elective_type ?? null,
    };
}

/* What Cura knows about the student's APPROVED plan, for "the EDP office turned this down, what else fits?":
   each approved subject with its section and EDP codes, anything the student reported, and other sections of the
   same subject that do not clash with the rest of the plan (shared/js/edpresult.js, the same rule as the website's
   and the app's "Switch a section"). Only the newest approved plan is used. null when there is none. */
function approvedPlanOut(deps, input, offerings) {
    const { SC, edp } = deps;
    if (!edp?.moveOptions) return null;
    const requests = (input.approvedRequests ?? [])
        .filter(r => (r.status === 'approved' || r.status === 'partially_approved') && r.registrar_status !== 'rejected')
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const request = requests[0];
    if (!request) return null;

    const byId = new Map(offerings.map(o => [o.id, o]));
    const full = new Set((input.reportedFullOfferingIds ?? []).map(id => byId.get(id)).filter(Boolean)
        .map(o => edp.sectionKey(o.subject_id, o.section)));

    const items = (request.request_item ?? []).filter(i => i.status === 'approved' && byId.has(i.offering_id)).map(i => {
        const current = byId.get(i.offering_id);
        const sameTerm = offerings.filter(o => o.subject_id === i.subject_id);
        const groups = SC.groupSections(edp.openRows(sameTerm, current.section));
        return { ...i, _section: groups.find(g => g.section === current.section) ?? null, _allSections: groups };
    }).filter(i => i._section);
    if (!items.length) return null;

    const plan = { request_item: items };
    return {
        subjects: items.map(i => ({
            code: i.subject?.code ?? null,
            title: i.subject?.title ?? null,
            section: i._section.section,
            edp: sectionOut(SC, i._section).edp,
            edpOffice: i.edp_result === 'rejected' ? 'turned down' : (i.edp_result ?? null),
            edpReason: i.edp_result === 'rejected' ? edp.reasonLabel(i.edp_reason) || null : null,
            otherSections: edp.moveOptions({ request: plan, item: i, fullKeys: full, max: 3 })
                .map(o => { const out = sectionOut(SC, o.group); return { section: out.section, edp: out.edp, meetings: out.meetings.map(m => ({ type: m.type, days: m.days, start: m.start, end: m.end })) }; }),
        })),
    };
}

/* deps:  { engine, preferences, explain, SC, edp? }   edp = shared/js/edpresult.js
   input: { student, program, records, subjects, rules, offerings, term, year, prefs,
            inRequestIds?, reportedFullOfferingIds? }
   reportedFullOfferingIds: offering ids of the plan items THIS student reported as full at the EDP office;
   those sections are not offered to them again (it never changes what anyone else sees). */
function assessStudent(deps, input) {
    const { engine, preferences, explain, SC } = deps;
    const { student, program, records, subjects, rules, term, year, prefs, inRequestIds } = input;
    // sections the Department closed (is_open = false) are not offered
    const open = input.offerings.filter(o => o.is_open !== false);
    const offerings = deps.edp && input.reportedFullOfferingIds?.length
        ? deps.edp.dropByOfferingIds(open, input.reportedFullOfferingIds)
        : open;

    const result = engine.assess(
        { id: student.id, year_level: student.year_level },
        records,
        { subjects, rules, offerings },
        {
            maxUnits: program?.max_units ?? 24,
            maxUnitsGraduating: program?.max_units_graduating ?? 27,
            term,
            respectOfferings: offerings.length > 0,
        },
    );
    const plan = preferences.apply(result, prefs);
    const summary = explain.summarizeForExplanation(plan, student.first_name, { inRequestIds });

    summary.approvedPlan = approvedPlanOut(deps, input, input.offerings);

    const sectionsOf = (e) => SC.groupSections(e.sections).map(g => sectionOut(SC, g));

    const recommended = plan.recommended.map(e => ({
        ...brief(engine, e.subject),
        reason: e.reason,
        retake: !!e.retake,
        unlocks: Math.round((e.unlocks ?? 0) * 10) / 10,
        scheduleState: e.scheduleState,
        section: e.chosenSection
            ? { ...sectionOut(SC, { section: e.chosenSection.section, meetings: e.chosenSection.meetings }),
                timeOfDay: e.chosenSection.timeOfDay }
            : null,
        sections: sectionsOf(e),
        timeMatch: e.timeMatch ?? null,
        sectionReason: e.preferenceReason ?? null,
        slotOptions: e.slotOptions ?? null,
        // codes of the subjects this one must be taken together with (empty for most)
        alongside: (e.alongside ?? []).map(a => a.code),
    }));

    const recommendedIds = new Set(plan.recommended.map(e => e.subject.id));
    const alsoOpen = result.eligible
        .filter(e => !recommendedIds.has(e.subject.id))
        .map(e => ({
            ...brief(engine, e.subject),
            scheduleState: e.scheduleState,
            retake: !!e.retake,
            alongside: (e.alongside ?? []).map(a => a.code),
            // Choosable in the plan builder too, so they carry their sections.
            sections: sectionsOf(e),
        }));

    const locked = result.locked.map(l => ({
        ...brief(engine, l.subject),
        reasons: (l.unmet ?? []).map(u => u.detail),
        termsAway: l.termsAway ?? null,
    }));

    // Every subject of the curriculum with where the student stands on it:
    // the same statuses the website's "My prospectus" grid shows.
    const grades = new Map();
    for (const r of records) if (r.status === 'PASSED' && r.subject_id) grades.set(r.subject_id, r.grade);

    const rows = [];
    for (const s of result.completed) {
        rows.push({
            ...brief(engine, s), status: 'passed',
            detail: s.filledBy ? `Filled by ${s.filledBy.code}` : (grades.get(s.id) ? `Grade ${grades.get(s.id)}` : 'Passed'),
            filledBy: s.filledBy ? { code: s.filledBy.code, title: s.filledBy.title } : null,
        });
    }
    for (const s of result.inProgress) rows.push({ ...brief(engine, s), status: 'enrolled', detail: 'Currently enrolled' });
    for (const e of result.eligible) {
        rows.push({
            ...brief(engine, e.subject),
            status: e.retake ? 'retake' : 'eligible',
            detail: e.retake ? 'Previously failed. Retake available.' : 'All requirements met.',
        });
    }
    for (const l of result.locked) {
        rows.push({ ...brief(engine, l.subject), status: 'blocked', detail: (l.unmet ?? []).map(u => u.detail).join(' ') });
    }
    // Catalogue electives have no year: they sort after the semesters.
    rows.sort((a, b) =>
        (a.year ?? 99) - (b.year ?? 99) || (a.term ?? 99) - (b.term ?? 99) || a.code.localeCompare(b.code));

    const totalUnits = result.totalUnits;
    const earned = result.facts.unitsEarned;

    return {
        assessed: true,
        student: {
            id: student.id,
            studentId: student.student_id,
            name: [student.first_name, student.last_name].filter(Boolean).join(' '),
            firstName: student.first_name ?? null,
            yearLevel: student.year_level ?? null,
            programCode: program?.code ?? null,
            programName: program?.name ?? null,
        },
        term: { term, year },
        progress: {
            unitsEarned: earned,
            totalUnits,
            percent: totalUnits > 0 ? Math.min(100, Math.round((earned / totalUnits) * 100)) : 0,
            passed: result.facts.passedCount,
            inProgress: result.inProgress.length,
            open: result.eligible.length,
            locked: result.locked.length,
        },
        load: {
            recommendedUnits: plan.recommendedUnits,
            maxUnits: plan.maxUnits,
            availableUnits: plan.availableUnits,
            enrolledUnits: plan.enrolledUnits,
            graduating: plan.graduating,
        },
        recommended,
        alsoOpen,
        locked,
        curriculum: rows,
        electives: result.electives ?? {},
        preferences: {
            timeOfDay: plan.preference.timeOfDay,
            load: plan.preference.load,
            // Fewest gaps: on or off, and the free time between classes in the plan, in minutes a week.
            compact: plan.preference.compact === true,
            freeMinutes: plan.preference.freeMinutes ?? null,
            freeMinutesBefore: plan.preference.freeMinutesBefore ?? null,
            ceiling: plan.preference.ceiling,
            movedToLaterTerm: plan.preference.deferred,
            notes: plan.preference.notes,
        },
        // What Cura reads. The client hands this straight to eligibility-chat.
        summary,
    };
}

module.exports = { assessStudent };
