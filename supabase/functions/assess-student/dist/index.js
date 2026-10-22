var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// supabase/functions/assess-student/core.js
var require_core = __commonJS({
  "supabase/functions/assess-student/core.js"(exports, module) {
    "use strict";
    function sectionOut(SC2, group) {
      return {
        // The id a request names to say which section was picked.
        offeringId: group.offeringId ?? group.meetings?.[0]?.id ?? null,
        section: group.section,
        timeOfDay: SC2.sectionTimeOfDay(group.meetings),
        meetings: group.meetings.map((m) => ({
          type: m.meeting_type ?? "LEC",
          days: m.schedule_days ?? "",
          start: m.start_time ?? null,
          end: m.end_time ?? null,
          room: m.room ?? null,
          // the school's EDP code for this meeting (a lecture and a lab have one each)
          edp: m.edp_code ?? null
        })),
        // each EDP code of the section once, in meeting order: what a student writes on the form
        edp: [...new Set(group.meetings.map((m) => String(m.edp_code ?? "").trim()).filter(Boolean))]
      };
    }
    function brief(engine2, s) {
      return {
        id: s.id,
        code: s.code,
        title: s.title,
        units: Number(s.units) || 0,
        year: s.year_level ?? null,
        term: s.term ?? null,
        elective: engine2.isElective(s),
        electiveType: s.elective_type ?? null
      };
    }
    function approvedPlanOut(deps, input, offerings) {
      const { SC: SC2, edp: edp2 } = deps;
      if (!edp2?.moveOptions) return null;
      const requests = (input.approvedRequests ?? []).filter((r) => (r.status === "approved" || r.status === "partially_approved") && r.registrar_status !== "rejected").sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      const request = requests[0];
      if (!request) return null;
      const byId = new Map(offerings.map((o) => [o.id, o]));
      const full = new Set((input.reportedFullOfferingIds ?? []).map((id) => byId.get(id)).filter(Boolean).map((o) => edp2.sectionKey(o.subject_id, o.section)));
      const items = (request.request_item ?? []).filter((i) => i.status === "approved" && byId.has(i.offering_id)).map((i) => {
        const current = byId.get(i.offering_id);
        const sameTerm = offerings.filter((o) => o.subject_id === i.subject_id);
        const groups = SC2.groupSections(edp2.openRows(sameTerm, current.section));
        return { ...i, _section: groups.find((g) => g.section === current.section) ?? null, _allSections: groups };
      }).filter((i) => i._section);
      if (!items.length) return null;
      const plan = { request_item: items };
      return {
        subjects: items.map((i) => ({
          code: i.subject?.code ?? null,
          title: i.subject?.title ?? null,
          section: i._section.section,
          edp: sectionOut(SC2, i._section).edp,
          // What the adviser wrote when approving this subject ("approve with a note"), or null. Cura repeats it.
          adviserNote: String(i.remarks ?? "").trim().slice(0, 500) || null,
          edpOffice: i.edp_result === "rejected" ? "turned down" : i.edp_result ?? null,
          edpReason: i.edp_result === "rejected" ? edp2.reasonLabel(i.edp_reason) || null : null,
          otherSections: edp2.moveOptions({ request: plan, item: i, fullKeys: full, max: 3 }).map((o) => {
            const out = sectionOut(SC2, o.group);
            return { section: out.section, edp: out.edp, meetings: out.meetings.map((m) => ({ type: m.type, days: m.days, start: m.start, end: m.end })) };
          })
        }))
      };
    }
    function assessStudent(deps, input) {
      const { engine: engine2, preferences: preferences2, explain: explain2, SC: SC2 } = deps;
      const { student, program, records, subjects, rules, term, year, prefs, inRequestIds } = input;
      const open = input.offerings.filter((o) => o.is_open !== false);
      const offerings = deps.edp && input.reportedFullOfferingIds?.length ? deps.edp.dropByOfferingIds(open, input.reportedFullOfferingIds) : open;
      const result = engine2.assess(
        { id: student.id, year_level: student.year_level },
        records,
        { subjects, rules, offerings },
        {
          maxUnits: program?.max_units ?? 24,
          maxUnitsGraduating: program?.max_units_graduating ?? 27,
          term,
          respectOfferings: offerings.length > 0
        }
      );
      const plan = preferences2.apply(result, prefs);
      const summary = explain2.summarizeForExplanation(plan, student.first_name, { inRequestIds });
      summary.approvedPlan = approvedPlanOut(deps, input, input.offerings);
      const sectionsOf = (e) => SC2.groupSections(e.sections).map((g) => sectionOut(SC2, g));
      const recommended = plan.recommended.map((e) => ({
        ...brief(engine2, e.subject),
        reason: e.reason,
        retake: !!e.retake,
        unlocks: Math.round((e.unlocks ?? 0) * 10) / 10,
        scheduleState: e.scheduleState,
        section: e.chosenSection ? {
          ...sectionOut(SC2, { section: e.chosenSection.section, meetings: e.chosenSection.meetings }),
          timeOfDay: e.chosenSection.timeOfDay
        } : null,
        sections: sectionsOf(e),
        timeMatch: e.timeMatch ?? null,
        sectionReason: e.preferenceReason ?? null,
        slotOptions: e.slotOptions ?? null,
        // codes of the subjects this one must be taken together with (empty for most)
        alongside: (e.alongside ?? []).map((a) => a.code)
      }));
      const recommendedIds = new Set(plan.recommended.map((e) => e.subject.id));
      const alsoOpen = result.eligible.filter((e) => !recommendedIds.has(e.subject.id)).map((e) => ({
        ...brief(engine2, e.subject),
        scheduleState: e.scheduleState,
        retake: !!e.retake,
        alongside: (e.alongside ?? []).map((a) => a.code),
        // Choosable in the plan builder too, so they carry their sections.
        sections: sectionsOf(e)
      }));
      const locked = result.locked.map((l) => ({
        ...brief(engine2, l.subject),
        reasons: (l.unmet ?? []).map((u) => u.detail),
        termsAway: l.termsAway ?? null
      }));
      const grades = /* @__PURE__ */ new Map();
      for (const r of records) if (r.status === "PASSED" && r.subject_id) grades.set(r.subject_id, r.grade);
      const rows = [];
      for (const s of result.completed) {
        rows.push({
          ...brief(engine2, s),
          status: "passed",
          detail: s.filledBy ? `Filled by ${s.filledBy.code}` : grades.get(s.id) ? `Grade ${grades.get(s.id)}` : "Passed",
          filledBy: s.filledBy ? { code: s.filledBy.code, title: s.filledBy.title } : null
        });
      }
      for (const s of result.inProgress) rows.push({ ...brief(engine2, s), status: "enrolled", detail: "Currently enrolled" });
      for (const e of result.eligible) {
        rows.push({
          ...brief(engine2, e.subject),
          status: e.retake ? "retake" : "eligible",
          detail: e.retake ? "Previously failed. Retake available." : "All requirements met."
        });
      }
      for (const l of result.locked) {
        rows.push({ ...brief(engine2, l.subject), status: "blocked", detail: (l.unmet ?? []).map((u) => u.detail).join(" ") });
      }
      rows.sort((a, b) => (a.year ?? 99) - (b.year ?? 99) || (a.term ?? 99) - (b.term ?? 99) || a.code.localeCompare(b.code));
      const totalUnits = result.totalUnits;
      const earned = result.facts.unitsEarned;
      return {
        assessed: true,
        student: {
          id: student.id,
          studentId: student.student_id,
          name: [student.first_name, student.last_name].filter(Boolean).join(" "),
          firstName: student.first_name ?? null,
          yearLevel: student.year_level ?? null,
          programCode: program?.code ?? null,
          programName: program?.name ?? null
        },
        term: { term, year },
        progress: {
          unitsEarned: earned,
          totalUnits,
          percent: totalUnits > 0 ? Math.min(100, Math.round(earned / totalUnits * 100)) : 0,
          passed: result.facts.passedCount,
          inProgress: result.inProgress.length,
          open: result.eligible.length,
          locked: result.locked.length
        },
        load: {
          recommendedUnits: plan.recommendedUnits,
          maxUnits: plan.maxUnits,
          availableUnits: plan.availableUnits,
          enrolledUnits: plan.enrolledUnits,
          graduating: plan.graduating
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
          notes: plan.preference.notes
        },
        // What Cura reads. The client hands this straight to eligibility-chat.
        summary
      };
    }
    module.exports = { assessStudent };
  }
});

// supabase/functions/submit-advising-request/core.js
var require_core2 = __commonJS({
  "supabase/functions/submit-advising-request/core.js"(exports, module) {
    "use strict";
    function lockedSubjectIds(requests) {
      const latest = /* @__PURE__ */ new Map();
      for (const req of requests ?? []) {
        for (const item of req.request_item ?? []) {
          if (!latest.has(item.subject_id)) latest.set(item.subject_id, { req, item });
        }
      }
      const locked = /* @__PURE__ */ new Set();
      for (const [subjectId, { req, item }] of latest) {
        const sentBack = req.registrar_status === "rejected";
        const rejected = item.status === "rejected";
        if (!sentBack && !rejected) locked.add(subjectId);
      }
      return locked;
    }
    var MAX_PER_DAY = 5;
    var MIN_GAP_SECONDS = 30;
    var DAY_MS = 24 * 60 * 60 * 1e3;
    function submissionLimit(requests, now = Date.now()) {
      const times = (requests ?? []).map((r) => new Date(r.created_at).getTime()).filter((t) => Number.isFinite(t) && t <= now).sort((a, b) => b - a);
      const sinceLast = times.length ? Math.ceil((now - times[0]) / 1e3) : Infinity;
      if (sinceLast < MIN_GAP_SECONDS) {
        const wait = MIN_GAP_SECONDS - sinceLast;
        return {
          ok: false,
          retryAfterSeconds: wait,
          error: `Please wait ${wait} second${wait === 1 ? "" : "s"} before sending another request.`
        };
      }
      const recent = times.filter((t) => now - t < DAY_MS);
      if (recent.length >= MAX_PER_DAY) {
        const oldest = recent[MAX_PER_DAY - 1];
        const wait = Math.ceil((oldest + DAY_MS - now) / 1e3);
        const hours = Math.ceil(wait / 3600);
        return {
          ok: false,
          retryAfterSeconds: wait,
          error: `You have already sent ${MAX_PER_DAY} requests in the last 24 hours. Try again in about ${hours} hour${hours === 1 ? "" : "s"}, or talk to your adviser.`
        };
      }
      return { ok: true };
    }
    function evaluateSelections(deps, input) {
      const { engine: engine2 } = deps;
      const { student, program, records, subjects, rules, term, selections } = input;
      const offerings = input.offerings.filter((o) => o.is_open !== false);
      const result = engine2.assess(
        { id: student.id, year_level: student.year_level },
        records,
        { subjects, rules, offerings },
        {
          maxUnits: program?.max_units ?? 24,
          maxUnitsGraduating: program?.max_units_graduating ?? 27,
          term,
          respectOfferings: offerings.length > 0
        }
      );
      const open = new Map(result.eligible.map((e) => [e.subject.id, e]));
      const locked = new Map(result.locked.map((l) => [l.subject.id, l]));
      const passed = new Set(result.completed.map((s) => s.id));
      const taking = new Set(result.inProgress.map((s) => s.id));
      const offeringSubject = new Map(offerings.map((o) => [o.id, o.subject_id]));
      const picked = new Set(selections.map((sel) => sel.subjectId));
      return selections.map((sel) => {
        const base = { subjectId: sel.subjectId, offeringId: sel.offeringId ?? null };
        const no = (reason) => ({ ...base, valid: false, reason });
        if (passed.has(sel.subjectId)) return no("This subject is already passed.");
        if (taking.has(sel.subjectId)) return no("This subject is already in progress.");
        if (locked.has(sel.subjectId)) {
          const unmet = (locked.get(sel.subjectId).unmet ?? []).map((u) => u.detail).join(" ");
          return no(unmet || "Requirements for this subject are not met.");
        }
        if (!open.has(sel.subjectId)) return no("Subject not found in the current curriculum.");
        const entry = open.get(sel.subjectId);
        if (entry.availableThisTerm === false) {
          const why = entry.scheduleState === "not-run" ? "The department is not running this subject this term." : entry.subject.year_level == null ? "No section is open for this elective this term." : "This subject belongs to another semester and has no section this term.";
          return { ...no(why), unavailable: true };
        }
        const missing = (entry.alongside ?? []).filter((a) => !picked.has(a.id));
        if (missing.length) {
          return no(`${entry.subject.code} must be taken together with ${missing.map((m) => m.code).join(" and ")}. Add it to the same request.`);
        }
        if (base.offeringId != null && offeringSubject.get(base.offeringId) !== sel.subjectId) {
          return no("The chosen section is not offered for this subject this term.");
        }
        return { ...base, valid: true, reason: null };
      });
    }
    module.exports = { lockedSubjectIds, evaluateSelections, submissionLimit, MAX_PER_DAY, MIN_GAP_SECONDS };
  }
});

// shared/engine/engine.js
var require_engine = __commonJS({
  "shared/engine/engine.js"(exports, module) {
    (function(root, factory) {
      if (typeof module === "object" && module.exports) module.exports = factory();
      else root.CurricuLogicEngine = factory();
    })(typeof self !== "undefined" ? self : exports, function() {
      "use strict";
      const PASSED = "PASSED";
      const FAILED = "FAILED";
      const ENROLLED = "ENROLLED";
      const PREREQUISITE = "prerequisite";
      const CO_REQUISITE = "co_requisite";
      const STANDING = "standing";
      const DEFAULTS = {
        maxUnits: 24,
        maxUnitsGraduating: 27,
        /* First year level held back by the year gate (see assess). */
        gateFromYear: 3,
        /* Guard only. With an acyclic graph the fixpoint is reached in far
           fewer passes; this stops a cycle that slipped past the integrity
           checks from spinning forever. */
        maxIterations: 20
      };
      const isElective = (s) => s.is_elective === true || s.elective_type != null;
      function buildFacts(student, records, subjects) {
        const byId = new Map(subjects.map((s) => [s.id, s]));
        const passed = /* @__PURE__ */ new Set();
        const failed = /* @__PURE__ */ new Set();
        const enrolled = /* @__PURE__ */ new Set();
        for (const r of records) {
          if (r.subject_id == null) continue;
          if (r.status === PASSED) passed.add(r.subject_id);
          if (r.status === FAILED) failed.add(r.subject_id);
          if (r.status === ENROLLED) enrolled.add(r.subject_id);
        }
        for (const id of passed) failed.delete(id);
        let unitsEarned = 0;
        for (const id of passed) unitsEarned += Number(byId.get(id)?.units || 0);
        return {
          studentId: student?.id ?? null,
          yearLevel: Number(student?.year_level) || null,
          passed,
          failed,
          enrolled,
          unitsEarned,
          completedThroughPosition: highestCompletedPosition(passed, subjects),
          firstIncompletePosition: firstIncompletePosition(passed, subjects)
        };
      }
      function highestCompletedPosition(passed, subjects) {
        const positions = [...new Set(
          subjects.filter((s) => !isElective(s) && s.year_level != null && s.term != null).map((s) => s.year_level * 10 + s.term)
        )].sort((a, b) => a - b);
        let highest = 0;
        for (const pos of positions) {
          const upto = subjects.filter(
            (s) => !isElective(s) && s.year_level != null && s.term != null && s.year_level * 10 + s.term <= pos
          );
          if (upto.every((s) => passed.has(s.id))) highest = pos;
          else break;
        }
        return highest;
      }
      function firstIncompletePosition(passed, subjects) {
        let first = Infinity;
        for (const s of subjects) {
          if (isElective(s) || s.year_level == null || s.term == null) continue;
          if (passed.has(s.id)) continue;
          first = Math.min(first, s.year_level * 10 + s.term);
        }
        return first;
      }
      function standingPosition(value) {
        const n = Number(value);
        if (!Number.isFinite(n) || n <= 0) return 0;
        return n < 10 ? n * 10 + 2 : n;
      }
      function describePosition(pos) {
        if (!pos) return "nothing yet";
        const y = Math.floor(pos / 10);
        const t = pos % 10;
        const ord = { 1: "1st", 2: "2nd", 3: "3rd", 4: "4th" }[y] || `${y}th`;
        const term = { 1: "1st Semester", 2: "2nd Semester", 3: "Summer" }[t] || "";
        return `${ord} Year, ${term}`;
      }
      function evaluateSubject(subject, rules, facts, byId) {
        const groups = /* @__PURE__ */ new Map();
        for (const r of rules) {
          const g = r.rule_group ?? 1;
          if (!groups.has(g)) groups.set(g, []);
          groups.get(g).push(r);
        }
        const trace = [];
        let satisfied = true;
        for (const [groupId, conditions] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
          const results = conditions.map((c) => evaluateCondition(c, facts, byId, subject));
          const met = results.some((r) => r.met);
          if (!met) satisfied = false;
          trace.push({
            group: groupId,
            met,
            /* Only a multi-condition group is a real choice. Labelling a
               single condition "any one of" reads as though an
               alternative exists. */
            kind: conditions.length > 1 ? "any_of" : "required",
            conditions: results
          });
        }
        return { satisfied, trace };
      }
      function evaluateCondition(rule, facts, byId, subject) {
        const type = rule.requirement_type;
        if (type === STANDING) {
          let need = standingPosition(rule.threshold_value);
          if (subject && subject.year_level != null) {
            const own = subject.year_level * 10 + (Number(subject.term) || 1);
            if (need >= own) need = own - 1;
          }
          const have = facts.completedThroughPosition;
          const met2 = facts.firstIncompletePosition !== void 0 ? facts.firstIncompletePosition > need : have >= need;
          return {
            type,
            met: met2,
            threshold: need,
            detail: met2 ? `Completed through ${describePosition(need)}.` : `Requires completion through ${describePosition(need)}. Currently through ${describePosition(have)}.`
          };
        }
        const required = byId.get(rule.prerequisite_subject_id);
        if (!required) {
          return {
            type,
            met: false,
            detail: "This condition refers to a subject that is no longer in the prospectus."
          };
        }
        if (type === CO_REQUISITE) {
          const already = facts.passed.has(required.id) || facts.enrolled.has(required.id);
          const together = !already && !!facts.alongside && facts.alongside.has(required.id);
          const met2 = already || together;
          return {
            type,
            met: met2,
            subjectId: required.id,
            code: required.code,
            title: required.title,
            alongside: together,
            detail: already ? `${required.code} is passed or currently being taken.` : together ? `${required.code} must be taken in the same term as this subject.` : `${required.code} must be passed or taken alongside this subject.`
          };
        }
        const met = facts.passed.has(required.id);
        const currentlyTaking = facts.enrolled.has(required.id);
        const previouslyFailed = facts.failed.has(required.id);
        return {
          type: PREREQUISITE,
          met,
          subjectId: required.id,
          code: required.code,
          title: required.title,
          detail: met ? `${required.code} passed.` : currentlyTaking ? `${required.code} is in progress. It must be passed first.` : previouslyFailed ? `${required.code} was not passed. It must be retaken.` : `${required.code} has not been taken.`
        };
      }
      function chainForward(facts, kb, assumePassed = []) {
        const passed = new Set(facts.passed);
        for (const id of assumePassed) passed.add(id);
        const working = { ...facts, passed };
        working.completedThroughPosition = highestCompletedPosition(passed, kb.subjects);
        working.firstIncompletePosition = firstIncompletePosition(passed, kb.subjects);
        const depth = /* @__PURE__ */ new Map();
        let iteration = 0;
        let derivedThisPass;
        do {
          derivedThisPass = 0;
          iteration++;
          const newlyPassed = [];
          for (const subject of kb.subjects) {
            if (working.passed.has(subject.id)) continue;
            if (depth.has(subject.id)) continue;
            const rules = kb.rulesFor(subject.id);
            const { satisfied } = evaluateSubject(subject, rules, working, kb.byId);
            if (satisfied) {
              depth.set(subject.id, iteration);
              newlyPassed.push(subject.id);
              derivedThisPass++;
            }
          }
          for (const id of newlyPassed) working.passed.add(id);
          working.completedThroughPosition = highestCompletedPosition(working.passed, kb.subjects);
          working.firstIncompletePosition = firstIncompletePosition(working.passed, kb.subjects);
        } while (derivedThisPass > 0 && iteration < DEFAULTS.maxIterations);
        return depth;
      }
      function unlockImpact(subjectId, facts, kb) {
        const dependents = kb.dependentsOf(subjectId);
        const seen = /* @__PURE__ */ new Set([subjectId]);
        const queue = [...dependents];
        let count = 0;
        while (queue.length > 0) {
          const { id, weight } = queue.shift();
          if (seen.has(id)) continue;
          seen.add(id);
          if (facts.passed.has(id)) continue;
          count += weight;
          for (const next of kb.dependentsOf(id)) {
            if (!seen.has(next.id)) queue.push({ id: next.id, weight: weight * next.weight });
          }
        }
        return Math.round(count * 10) / 10;
      }
      function assess(student, records, knowledgeBase, options = {}) {
        const kept = new Set(records.filter((r) => r.status === PASSED || r.status === ENROLLED).map((r) => r.subject_id));
        const subjects = (knowledgeBase.subjects ?? []).filter((s) => s.is_active !== false || kept.has(s.id));
        const rules = knowledgeBase.rules ?? [];
        const offerings = knowledgeBase.offerings ?? [];
        const byId = new Map(subjects.map((s) => [s.id, s]));
        const rulesBySubject = /* @__PURE__ */ new Map();
        for (const r of rules) {
          if (!rulesBySubject.has(r.subject_id)) rulesBySubject.set(r.subject_id, []);
          rulesBySubject.get(r.subject_id).push(r);
        }
        const dependents = /* @__PURE__ */ new Map();
        for (const [subjectId, subjectRules] of rulesBySubject) {
          const groupSize = /* @__PURE__ */ new Map();
          for (const r of subjectRules) {
            const g = r.rule_group ?? 1;
            groupSize.set(g, (groupSize.get(g) ?? 0) + 1);
          }
          for (const r of subjectRules) {
            if (r.prerequisite_subject_id == null) continue;
            const weight = 1 / groupSize.get(r.rule_group ?? 1);
            if (!dependents.has(r.prerequisite_subject_id)) {
              dependents.set(r.prerequisite_subject_id, []);
            }
            dependents.get(r.prerequisite_subject_id).push({ id: subjectId, weight });
          }
        }
        const documented = rules.some((r) => r.requirement_type === STANDING && byId.has(r.subject_id));
        const gateFrom = options.yearGate === false || documented ? Infinity : Number(options.gateFromYear) || DEFAULTS.gateFromYear;
        const gateFor = (id) => {
          const s = byId.get(id);
          const y = Number(s?.year_level);
          if (!s || !Number.isFinite(y) || y < gateFrom) return null;
          const own = rulesBySubject.get(id) ?? [];
          if (own.some((r) => r.requirement_type === STANDING)) return null;
          return {
            subject_id: id,
            prerequisite_subject_id: null,
            requirement_type: STANDING,
            rule_type: "and",
            rule_group: 99,
            threshold_value: (y - 1) * 10 + 2,
            // through the end of the year before
            implicit: true
          };
        };
        const kb = {
          subjects,
          byId,
          rulesFor: (id) => {
            const own = rulesBySubject.get(id) ?? [];
            const gate = gateFor(id);
            return gate ? [...own, gate] : own;
          },
          dependentsOf: (id) => dependents.get(id) ?? []
        };
        const facts = buildFacts(student, records, subjects);
        const offeredIds = new Set(offerings.map((o) => o.subject_id));
        const useSchedule = options.respectOfferings !== false && offerings.length > 0;
        const blockOf = (s) => `${s.year_level ?? "-"}:${s.term ?? "-"}`;
        const scheduledBlocks = new Set(
          useSchedule ? subjects.filter((s) => offeredIds.has(s.id)).map(blockOf) : []
        );
        const scheduleStateOf = (s) => {
          if (!useSchedule) return "none";
          if (offeredIds.has(s.id)) return "offered";
          return scheduledBlocks.has(blockOf(s)) ? "not-run" : "pending";
        };
        const typeOf = (s) => s.elective_type ?? "IT";
        const isSlot = (s) => isElective(s) && s.year_level != null;
        const isCatalogue = (s) => isElective(s) && s.year_level == null;
        const positionOf = (s) => s.year_level * 10 + (Number(s.term) || 0);
        const slotFill = /* @__PURE__ */ new Map();
        const electives = {};
        let overflowUnits = 0;
        for (const type of new Set(subjects.filter(isElective).map(typeOf))) {
          const slots = subjects.filter((s) => isSlot(s) && typeOf(s) === type).sort((a, b) => positionOf(a) - positionOf(b) || a.code.localeCompare(b.code));
          const direct = slots.filter((s) => facts.passed.has(s.id));
          const open = slots.filter((s) => !facts.passed.has(s.id) && !facts.enrolled.has(s.id));
          const picked2 = subjects.filter((s) => isCatalogue(s) && typeOf(s) === type && facts.passed.has(s.id));
          picked2.forEach((c, i) => {
            if (i < open.length) slotFill.set(open[i].id, c);
            else overflowUnits += Number(c.units) || 0;
          });
          const filled = direct.length + Math.min(open.length, picked2.length);
          electives[type] = {
            slots: slots.length,
            filled,
            remaining: Math.max(0, open.length - picked2.length),
            options: 0
          };
        }
        const unitsEarned = Math.max(0, facts.unitsEarned - overflowUnits);
        const eligible = [];
        const locked = [];
        const completed = [];
        const inProgress = [];
        const takeable = new Set(subjects.filter((s) => !facts.passed.has(s.id) && !facts.enrolled.has(s.id) && !slotFill.has(s.id)).map((s) => s.id));
        for (let pass = 0; pass < DEFAULTS.maxIterations; pass++) {
          const withTakeable = { ...facts, alongside: takeable };
          let changed = false;
          for (const id of [...takeable]) {
            const s = byId.get(id);
            if (!evaluateSubject(s, kb.rulesFor(id), withTakeable, byId).satisfied) {
              takeable.delete(id);
              changed = true;
            }
          }
          if (!changed) break;
        }
        const factsTogether = { ...facts, alongside: takeable };
        for (const subject of subjects) {
          if (facts.passed.has(subject.id)) {
            completed.push(subject);
            continue;
          }
          if (facts.enrolled.has(subject.id)) {
            inProgress.push(subject);
            continue;
          }
          if (slotFill.has(subject.id)) {
            completed.push({ ...subject, filledBy: slotFill.get(subject.id) });
            continue;
          }
          if (isCatalogue(subject)) {
            const t = electives[typeOf(subject)];
            if (t.slots > 0 && t.remaining === 0) continue;
          }
          const subjectRules = kb.rulesFor(subject.id);
          const { satisfied, trace } = evaluateSubject(subject, subjectRules, factsTogether, byId);
          const scheduleState = scheduleStateOf(subject);
          const entry = {
            subject,
            trace,
            /* True when a student could enrol now as far as the schedule
               goes: it has a section, or there is no schedule to judge by. */
            offered: scheduleState === "offered" || scheduleState === "none",
            scheduleState,
            sections: offerings.filter((o) => o.subject_id === subject.id),
            retake: facts.failed.has(subject.id),
            /* Subjects this one must be taken together with, when a co-requisite
               is met only because the other is taken in the same term. */
            alongside: trace.flatMap((g) => g.conditions).filter((c) => c.alongside).map((c) => ({ id: c.subjectId, code: c.code, title: c.title }))
          };
          if (satisfied) {
            eligible.push(entry);
          } else {
            entry.unmet = trace.filter((g) => !g.met).flatMap((g) => g.conditions.filter((c) => !c.met));
            locked.push(entry);
          }
        }
        for (const type of Object.keys(electives)) {
          electives[type].options = eligible.filter((e) => isCatalogue(e.subject) && typeOf(e.subject) === type).length;
        }
        for (const e of eligible) {
          if (!isSlot(e.subject)) continue;
          e.slotOptions = eligible.filter((o) => isCatalogue(o.subject) && typeOf(o.subject) === typeOf(e.subject)).map((o) => ({ code: o.subject.code, title: o.subject.title, units: o.subject.units }));
        }
        for (const e of eligible) {
          e.unlocks = unlockImpact(e.subject.id, facts, kb);
          e.priority = scoreSubject(e, facts);
        }
        eligible.sort((a, b) => b.priority - a.priority || b.unlocks - a.unlocks || (a.subject.year_level ?? 9) - (b.subject.year_level ?? 9) || a.subject.code.localeCompare(b.subject.code));
        const enrolledUnits = inProgress.reduce((t, s) => t + (Number(s.units) || 0), 0);
        const totalUnits = subjects.filter((s) => s.year_level != null).reduce((t, s) => t + Number(s.units || 0), 0);
        const remainingUnits = Math.max(0, totalUnits - unitsEarned - enrolledUnits);
        const gradCap = Number(options.maxUnitsGraduating) || DEFAULTS.maxUnitsGraduating;
        const graduating = remainingUnits > 0 && remainingUnits <= gradCap;
        const maxUnits = graduating ? Math.max(Number(options.maxUnits) || 0, gradCap) : Number(options.maxUnits) || DEFAULTS.maxUnits;
        const availableUnits = Math.max(0, maxUnits - enrolledUnits);
        const term = Number(options.term) || null;
        for (const e of eligible) {
          let ok;
          if (e.scheduleState === "offered") ok = true;
          else if (e.scheduleState === "not-run") ok = false;
          else if (isCatalogue(e.subject)) ok = false;
          else ok = e.retake || term === null || Number(e.subject.term) === term;
          e.availableThisTerm = ok;
        }
        const recommended = [];
        let units = 0;
        const eligibleById = new Map(eligible.map((e) => [e.subject.id, e]));
        const picked = /* @__PURE__ */ new Set();
        const bundleOf = (e) => {
          const bundle = /* @__PURE__ */ new Map();
          const stack = [e];
          while (stack.length) {
            const cur = stack.pop();
            if (bundle.has(cur.subject.id)) continue;
            bundle.set(cur.subject.id, cur);
            for (const p of cur.alongside) {
              const partner = eligibleById.get(p.id);
              if (!partner) return null;
              stack.push(partner);
            }
          }
          return [...bundle.values()];
        };
        for (const e of eligible) {
          if (picked.has(e.subject.id)) continue;
          if (isCatalogue(e.subject)) continue;
          if (!e.availableThisTerm) continue;
          const bundle = bundleOf(e);
          if (!bundle) continue;
          if (bundle.some((b) => isCatalogue(b.subject) || !b.availableThisTerm)) continue;
          const fresh = bundle.filter((b) => !picked.has(b.subject.id));
          const need = fresh.reduce((t, b) => t + (Number(b.subject.units) || 0), 0);
          if (units + need > availableUnits) continue;
          for (const b of fresh) {
            picked.add(b.subject.id);
            recommended.push({ ...b, reason: recommendationReason(b, facts) });
          }
          units += need;
        }
        const rank = new Map(eligible.map((e, i) => [e.subject.id, i]));
        recommended.sort((a, b) => rank.get(a.subject.id) - rank.get(b.subject.id));
        const baseline = chainForward(facts, kb);
        for (const l of locked) {
          l.termsAway = baseline.get(l.subject.id) ?? null;
        }
        return {
          facts: {
            unitsEarned,
            completedThroughPosition: facts.completedThroughPosition,
            passedCount: facts.passed.size,
            failedCount: facts.failed.size,
            enrolledCount: facts.enrolled.size
          },
          completed,
          inProgress,
          eligible,
          locked,
          recommended,
          recommendedUnits: units,
          maxUnits,
          enrolledUnits,
          availableUnits,
          graduating,
          totalUnits,
          electives
        };
      }
      function scoreSubject(entry, facts) {
        const s = entry.subject;
        let score = 0;
        if (entry.retake) score += 1e3;
        score += entry.unlocks * 25;
        if (facts.yearLevel && s.year_level != null) {
          const behind = facts.yearLevel - s.year_level;
          if (behind > 0) score += behind * 60;
          if (behind < 0) score += behind * 30;
        }
        if (!isElective(s)) score += 20;
        return score;
      }
      function recommendationReason(entry, facts) {
        if (entry.alongside && entry.alongside.length) {
          return `Taken together with ${entry.alongside.map((a) => a.code).join(" and ")}: both are enrolled in the same term.`;
        }
        if (isElective(entry.subject) && entry.subject.year_level != null) {
          const n = entry.slotOptions?.length ?? 0;
          const kind = entry.subject.elective_type === "FREE" ? "free elective" : "programme elective";
          return n > 0 ? `Elective slot: choose one of ${n} ${kind}${n === 1 ? "" : "s"}.` : "Elective slot: no electives are listed for it yet.";
        }
        if (entry.retake) {
          return entry.unlocks > 0 ? `Retake. Passing this opens ${Math.round(entry.unlocks)} further subject${entry.unlocks === 1 ? "" : "s"}.` : "Retake. This subject was not passed and is still required.";
        }
        if (entry.unlocks >= 3) {
          return `Opens ${Math.round(entry.unlocks)} later subjects \u2014 taking it now avoids a bottleneck.`;
        }
        if (facts.yearLevel && entry.subject.year_level != null && entry.subject.year_level < facts.yearLevel) {
          return "Outstanding from an earlier year level.";
        }
        return "On track for this year level.";
      }
      function explain2(entry) {
        if (!entry.trace || entry.trace.length === 0) {
          return ["No conditions \u2014 this subject is open to any student."];
        }
        return entry.trace.map((group) => {
          const parts = group.conditions.map((c) => c.detail);
          const body = group.kind === "any_of" ? "Any one of: " + parts.join(" or ") : parts.join(" ");
          return (group.met ? "\u2713 " : "\u2717 ") + body;
        });
      }
      return {
        assess,
        buildFacts,
        evaluateSubject,
        chainForward,
        highestCompletedPosition,
        firstIncompletePosition,
        isElective,
        describePosition,
        standingPosition,
        explain: explain2,
        DEFAULTS,
        PASSED,
        FAILED,
        ENROLLED,
        PREREQUISITE,
        CO_REQUISITE,
        STANDING
      };
    });
  }
});

// shared/js/schedule/scheduleconflicts.js
var require_scheduleconflicts = __commonJS({
  "shared/js/schedule/scheduleconflicts.js"(exports, module) {
    (function(root, factory) {
      if (typeof module === "object" && module.exports) module.exports = factory();
      else root.ScheduleConflicts = factory();
    })(typeof self !== "undefined" ? self : exports, function() {
      "use strict";
      const MEETING_ORDER = { LEC: 0, LAB: 1, REC: 2 };
      const DAY_TOKEN = /SUN|SAT|THURS|THUR|THU|MON|TUES|TUE|WED|FRI|SU|TH|M|T|W|F|S/g;
      const DAY_CODE = {
        SUN: "SU",
        SAT: "S",
        THURS: "TH",
        THUR: "TH",
        THU: "TH",
        MON: "M",
        TUES: "T",
        TUE: "T",
        WED: "W",
        FRI: "F"
      };
      function parseDays(s) {
        return (String(s ?? "").toUpperCase().match(DAY_TOKEN) ?? []).map((d) => DAY_CODE[d] ?? d);
      }
      function minutesOf(t) {
        const [h, m] = String(t ?? "").split(":").map(Number);
        return Number.isFinite(h) ? h * 60 + (m || 0) : null;
      }
      function meetingsClash(a, b) {
        const shared = parseDays(a.schedule_days).some((d) => parseDays(b.schedule_days).includes(d));
        if (!shared) return false;
        const [a1, a2, b1, b2] = [
          minutesOf(a.start_time),
          minutesOf(a.end_time),
          minutesOf(b.start_time),
          minutesOf(b.end_time)
        ];
        if ([a1, a2, b1, b2].some((v) => v === null)) return false;
        return a1 < b2 && b1 < a2;
      }
      function groupSections(meetings) {
        const bySection = /* @__PURE__ */ new Map();
        for (const m of meetings ?? []) {
          if (!bySection.has(m.section)) bySection.set(m.section, []);
          bySection.get(m.section).push(m);
        }
        return [...bySection].map(([section, rows]) => {
          rows.sort((a, b) => (MEETING_ORDER[a.meeting_type] ?? 9) - (MEETING_ORDER[b.meeting_type] ?? 9));
          return { section, meetings: rows, offeringId: rows[0].id ?? null };
        });
      }
      function timeOfDay(minutesValue) {
        if (minutesValue === null) return null;
        if (minutesValue < 12 * 60) return "morning";
        if (minutesValue < 17 * 60) return "afternoon";
        return "evening";
      }
      function sectionTimeOfDay(meetings) {
        const buckets = new Set(
          (meetings ?? []).map((m) => timeOfDay(minutesOf(m.start_time))).filter(Boolean)
        );
        if (buckets.size === 0) return null;
        if (buckets.size > 1) return "mixed";
        return [...buckets][0];
      }
      function formatClock(t) {
        if (!t) return "";
        const [h, m] = String(t).split(":").map(Number);
        if (!Number.isFinite(h) || !Number.isFinite(m)) return "";
        return `${(h + 11) % 12 + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
      }
      function availableStartTimes(subjectsWithSections) {
        const seen = /* @__PURE__ */ new Map();
        for (const subject of subjectsWithSections ?? []) {
          for (const group of groupSections(subject.sections)) {
            for (const m of group.meetings) {
              if (!m.start_time) continue;
              if (!seen.has(m.start_time)) seen.set(m.start_time, minutesOf(m.start_time));
            }
          }
        }
        return [...seen.entries()].sort((a, b) => a[1] - b[1]).map(([time]) => ({ time, label: formatClock(time) }));
      }
      function findClashes(labeledSections) {
        const clashes = [];
        for (let i = 0; i < labeledSections.length; i++) {
          for (let j = i + 1; j < labeledSections.length; j++) {
            const a = labeledSections[i];
            const b = labeledSections[j];
            const overlap = a.meetings.some((m1) => b.meetings.some((m2) => meetingsClash(m1, m2)));
            if (overlap) clashes.push({ a: a.label, b: b.label });
          }
        }
        return clashes;
      }
      return {
        parseDays,
        minutesOf,
        meetingsClash,
        groupSections,
        timeOfDay,
        sectionTimeOfDay,
        formatClock,
        availableStartTimes,
        findClashes
      };
    });
  }
});

// shared/engine/preferences.js
var require_preferences = __commonJS({
  "shared/engine/preferences.js"(exports, module) {
    (function(root, factory) {
      if (typeof module === "object" && module.exports) module.exports = factory(require_scheduleconflicts());
      else root.CurricuLogicPreferences = factory(root.ScheduleConflicts);
    })(typeof self !== "undefined" ? self : exports, function(SC2) {
      "use strict";
      const TIMES = ["morning", "afternoon", "evening"];
      const LOADS = ["light", "regular", "full"];
      const LOAD_UNITS = { light: 15, regular: 21 };
      const LABEL = { morning: "morning", afternoon: "afternoon", evening: "evening" };
      function clean(prefs) {
        const p = prefs ?? {};
        return {
          timeOfDay: TIMES.includes(p.timeOfDay) ? p.timeOfDay : null,
          load: LOADS.includes(p.load) ? p.load : null,
          compact: p.compact === true
        };
      }
      const GAP_MINUTES = 30;
      function gapMinutes(lists) {
        const days = /* @__PURE__ */ new Map();
        for (const meetings of lists) {
          for (const m of meetings ?? []) {
            if (!m || !m.start_time || !m.end_time) continue;
            const start2 = SC2.minutesOf(m.start_time);
            const end = SC2.minutesOf(m.end_time);
            if (start2 === null || end === null || end <= start2) continue;
            for (const d of SC2.parseDays(m.schedule_days)) {
              if (!days.has(d)) days.set(d, []);
              days.get(d).push([start2, end]);
            }
          }
        }
        let total = 0;
        for (const spans of days.values()) {
          spans.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
          let reach = spans[0][1];
          for (let i = 1; i < spans.length; i++) {
            const wait = spans[i][0] - reach;
            if (wait >= GAP_MINUTES) total += wait;
            reach = Math.max(reach, spans[i][1]);
          }
        }
        return total;
      }
      function gapWords(minutes) {
        const m = Math.round(Number(minutes) || 0);
        if (m <= 0) return "none";
        const h = Math.floor(m / 60);
        const r = m % 60;
        return h ? r ? `${h} h ${r} min` : `${h} h` : `${r} min`;
      }
      function timeMatchOf(group, wanted) {
        if (!wanted) return "any";
        const parts = group.meetings.map((m) => SC2.timeOfDay(SC2.minutesOf(m.start_time))).filter(Boolean);
        if (!parts.length) return "any";
        const hits = parts.filter((p) => p === wanted).length;
        if (hits === parts.length) return "match";
        return hits > 0 ? "partial" : "other";
      }
      const MATCH_RANK = { match: 0, any: 1, partial: 2, other: 3 };
      function clashCount(group, chosen) {
        let n = 0;
        for (const c of chosen) {
          if (c.meetings.some((m1) => group.meetings.some((m2) => SC2.meetingsClash(m1, m2)))) n++;
        }
        return n;
      }
      const timeWord = (t) => LABEL[t] ?? t;
      function ceilingFor(result, load) {
        if (!load || load === "full") return null;
        return Math.min(Number(result.maxUnits) || Infinity, LOAD_UNITS[load]);
      }
      function trimToLoad(list, room) {
        const kept = [];
        const deferred = [];
        let units = 0;
        for (const e of list) {
          const u = Number(e.subject.units) || 0;
          if (units + u <= room) {
            kept.push(e);
            units += u;
          } else deferred.push(e);
        }
        return { kept, deferred, units };
      }
      const sectionsClash = (a, b) => a.some((m1) => b.some((m2) => SC2.meetingsClash(m1, m2)));
      const NODE_LIMIT = 2e5;
      function weightOf(e, i, n, force) {
        return (force && force.includes(e.subject.code) ? 5e3 : 0) + (e.retake ? 1e3 : 0) + (Number(e.subject.units) || 0) * 10 + Math.min(Number(e.unlocks) || 0, 9) + (n - i) * 1e-3;
      }
      function planSections(kept, wanted, force = [], compact = false) {
        const n = kept.length;
        const items = kept.map((e, i) => {
          const groups = SC2.groupSections(e.sections);
          const options = groups.map((g, gi) => ({ g, gi, match: timeMatchOf(g, wanted) })).sort((a, b) => MATCH_RANK[a.match] - MATCH_RANK[b.match] || a.gi - b.gi);
          return { e, groups, options, weight: weightOf(e, i, n, force) };
        });
        const suffix = new Array(n + 1).fill(0);
        for (let i = n - 1; i >= 0; i--) suffix[i] = suffix[i + 1] + items[i].weight;
        let best = null;
        let nodes = 0;
        const picks = new Array(n).fill(null);
        const placed = [];
        const improves = (score, cost) => !best || score > best.score + 1e-9 || Math.abs(score - best.score) <= 1e-9 && cost < best.cost - 1e-9;
        function search(i, score, cost) {
          if (++nodes > NODE_LIMIT) return;
          if (i === n) {
            if (improves(score, cost)) best = { score, cost, picks: picks.slice() };
            return;
          }
          if (best && score + suffix[i] < best.score - 1e-9) return;
          const item = items[i];
          if (!item.options.length) {
            picks[i] = { free: true };
            search(i + 1, score + item.weight, cost);
            picks[i] = null;
            return;
          }
          for (const opt of item.options) {
            if (placed.some((p) => sectionsClash(p.meetings, opt.g.meetings))) continue;
            picks[i] = opt;
            placed.push({ meetings: opt.g.meetings });
            search(i + 1, score + item.weight, cost + MATCH_RANK[opt.match] + opt.gi * 1e-3);
            placed.pop();
            picks[i] = null;
          }
          picks[i] = null;
          search(i + 1, score, cost);
        }
        search(0, 0, 0);
        const chosenPicks = best ? best.picks : new Array(n).fill(null);
        const compacted = /* @__PURE__ */ new Set();
        let gaps = null;
        if (compact) {
          const total = (picks2) => gapMinutes(picks2.filter((p) => p && !p.free).map((p) => p.g.meetings));
          const before = total(chosenPicks);
          let now = before;
          for (let pass = 0, changed = true; changed && pass < 20; pass++) {
            changed = false;
            for (let i = 0; i < n; i++) {
              const cur = chosenPicks[i];
              if (!cur || cur.free) continue;
              for (const opt of items[i].options) {
                if (opt.g.section === cur.g.section) continue;
                if (MATCH_RANK[opt.match] > MATCH_RANK[cur.match]) continue;
                if (chosenPicks.some((p, j) => j !== i && p && !p.free && sectionsClash(p.g.meetings, opt.g.meetings))) continue;
                const trial = chosenPicks.slice();
                trial[i] = opt;
                const after = total(trial);
                if (after < now) {
                  chosenPicks[i] = opt;
                  compacted.add(i);
                  now = after;
                  changed = true;
                  break;
                }
              }
            }
          }
          gaps = { before, after: now };
        }
        const out = [];
        const leftOut = [];
        const notes = [];
        const taken = [];
        items.forEach((item, i) => {
          const pick = chosenPicks[i];
          if (pick && !pick.free) taken.push({ code: item.e.subject.code, label: `${item.e.subject.code} (${pick.g.section})`, meetings: pick.g.meetings });
        });
        items.forEach((item, i) => {
          const e = item.e;
          const pick = chosenPicks[i];
          if (!item.groups.length) {
            out.push({
              ...e,
              chosenSection: null,
              timeMatch: "none",
              clashesWith: [],
              preferenceReason: e.scheduleState === "pending" ? "No schedule has been published for this yet." : "No section is listed for this subject."
            });
            return;
          }
          if (!pick) {
            const perSection = item.groups.map((g2) => {
              const clashing = taken.filter((c) => sectionsClash(c.meetings, g2.meetings));
              return { section: g2.section, with: clashing.map((c) => c.label), codes: clashing.map((c) => c.code) };
            });
            const blockedBy = [...new Set(perSection.flatMap((s) => s.with))];
            const swaps = perSection.filter((s) => s.with.length === 1).map((s) => ({ section: s.section, instead: s.with[0] }));
            const together = [...new Set(taken.map((c) => c.code))].map((code) => {
              const ways = perSection.filter((s) => !s.codes.includes(code)).sort((a, b) => a.codes.length - b.codes.length);
              return ways.length ? { with: code, possible: true, takeSection: ways[0].section, dropFirst: ways[0].codes } : { with: code, possible: false, takeSection: null, dropFirst: [] };
            });
            leftOut.push({ ...e, blockedBy, swaps, together });
            notes.push(`${e.subject.code} is not in your suggested load: every section clashes with ${blockedBy.join(" and ")}.`);
            return;
          }
          const g = pick.g;
          const tod = SC2.sectionTimeOfDay(g.meetings);
          let reason;
          if (!wanted) {
            reason = item.groups.length > 1 ? `Section ${g.section}.` : `Only section: ${g.section}.`;
          } else if (pick.match === "match") {
            reason = `Section ${g.section} is a ${timeWord(wanted)} class, as you preferred.`;
          } else if (item.groups.length === 1) {
            reason = `Only section ${g.section} is offered${tod ? ` (${timeWord(tod)})` : ""}.`;
          } else {
            reason = `No ${timeWord(wanted)} section is free of clashes; section ${g.section}${tod ? ` is ${timeWord(tod)}` : ""}.`;
          }
          if (compacted.has(i)) reason += " It also keeps your classes closer together.";
          out.push({
            ...e,
            chosenSection: { section: g.section, timeOfDay: tod, meetings: g.meetings },
            timeMatch: pick.match,
            clashesWith: [],
            preferenceReason: reason
          });
          if (wanted && pick.match !== "match" && pick.match !== "any") {
            notes.push(`${e.subject.code} has no ${timeWord(wanted)} section${tod ? `; suggested ${timeWord(tod)}` : ""}.`);
          }
        });
        let moved = true;
        while (moved) {
          moved = false;
          const inPlan = new Set(out.map((e) => e.subject.id));
          for (let i = out.length - 1; i >= 0; i--) {
            const e = out[i];
            const missing = (e.alongside ?? []).filter((a) => !inPlan.has(a.id));
            if (!missing.length) continue;
            const { chosenSection, timeMatch, clashesWith, preferenceReason, ...bare } = e;
            const names = missing.map((m) => m.code);
            out.splice(i, 1);
            inPlan.delete(e.subject.id);
            leftOut.push({ ...bare, blockedBy: names, swaps: [], together: [], mustBeWith: names });
            notes.push(`${e.subject.code} is not in your suggested load: it must be taken together with ${names.join(" and ")}, which does not fit.`);
            moved = true;
          }
        }
        return { out, leftOut, notes, gaps };
      }
      const planKey = (out) => out.map((e) => `${e.subject.code}@${e.chosenSection ? e.chosenSection.section : "-"}`).sort().join("|");
      const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
      function alternativesFor(fits, primary, wanted, compact = false) {
        const mainKey = planKey(primary.out);
        const mainSection = new Map(primary.out.map((e) => [e.subject.code, e.chosenSection ? e.chosenSection.section : null]));
        const seen = /* @__PURE__ */ new Set([mainKey]);
        const found = [];
        const variants = [];
        for (const t of TIMES) if (t !== wanted) variants.push({ label: `${cap(t)} classes`, wanted: t, force: [], time: t });
        for (const l of primary.leftOut.slice(0, 2)) {
          variants.push({ label: `Include ${l.subject.code}`, wanted, force: [l.subject.code], time: wanted });
        }
        for (const v of variants) {
          if (found.length >= 4) break;
          const alt = planSections(fits, v.wanted, v.force, compact);
          const key = planKey(alt.out);
          if (seen.has(key)) continue;
          seen.add(key);
          const changes = [];
          for (const e of alt.out) {
            const code = e.subject.code;
            const sec = e.chosenSection ? e.chosenSection.section : null;
            if (!mainSection.has(code)) changes.push(`${code} is added`);
            else if (mainSection.get(code) !== sec && sec) changes.push(`${code} moves to section ${sec}`);
          }
          const altCodes = new Set(alt.out.map((e) => e.subject.code));
          for (const code of mainSection.keys()) if (!altCodes.has(code)) changes.push(`${code} is left out`);
          const timed = alt.out.filter((e) => e.chosenSection);
          const matched = v.time ? timed.filter((e) => e.timeMatch === "match").length : 0;
          found.push({
            label: v.label,
            placed: alt.out.map((e) => ({ code: e.subject.code, section: e.chosenSection ? e.chosenSection.section : null })),
            notIncluded: alt.leftOut.map((l) => l.subject.code),
            units: alt.out.reduce((t, e) => t + (Number(e.subject.units) || 0), 0),
            changes,
            note: v.time && timed.length ? `${matched} of ${timed.length} scheduled subject${timed.length === 1 ? "" : "s"} in ${v.time} sections.` : null
          });
        }
        return found;
      }
      function apply(result, prefs) {
        const p = clean(prefs);
        const notes = [];
        const ceiling = ceilingFor(result, p.load);
        const room = ceiling === null ? Number(result.availableUnits) || 0 : Math.max(0, ceiling - (Number(result.enrolledUnits) || 0));
        const { kept: fits, deferred } = trimToLoad(result.recommended, Math.min(room, Number(result.availableUnits) || 0));
        if (deferred.length) {
          notes.push(`Kept to about ${ceiling} units as you asked; ${deferred.length} subject${deferred.length === 1 ? "" : "s"} moved to a later term.`);
          if (result.graduating) {
            notes.push("You are close to graduating: a lighter load may add a term.");
          }
          if (deferred.some((d) => d.retake)) {
            notes.push("A retake was left out to keep the load. Retakes normally come first.");
          }
        }
        const loadNotes = [...notes];
        const planned = planSections(fits, p.timeOfDay, [], p.compact);
        const { out, leftOut, notes: sectionNotes, gaps } = planned;
        notes.push(...sectionNotes);
        const alternatives = alternativesFor(fits, planned, p.timeOfDay, p.compact);
        if (p.compact && gaps) {
          const week = `Free time between classes: ${gapWords(gaps.after)} a week`;
          notes.unshift(gaps.after < gaps.before ? `${week} (it would be ${gapWords(gaps.before)} without this preference).` : `${week}.`);
        }
        if (p.timeOfDay) {
          const withTimes = out.filter((e) => e.chosenSection);
          const matched = withTimes.filter((e) => e.timeMatch === "match").length;
          if (withTimes.length) {
            notes.unshift(`${matched} of ${withTimes.length} scheduled subject${withTimes.length === 1 ? "" : "s"} fit your ${timeWord(p.timeOfDay)} preference.`);
          }
        }
        return {
          ...result,
          recommended: out,
          // Eligible and within the load, but with no section that fits beside the
          // plan; each says what blocks it and what single swap would make room.
          leftOutForClash: leftOut,
          // Other clash-free plans: [{ label, placed: [{code, section}], notIncluded, units, changes, note }]
          alternatives,
          recommendedUnits: out.reduce((t, e) => t + (Number(e.subject.units) || 0), 0),
          preference: {
            timeOfDay: p.timeOfDay,
            load: p.load,
            // Fewest gaps: on or off, and the free time in the plan (minutes a week) with and
            // without it. Null when it is off.
            compact: p.compact,
            freeMinutes: gaps ? gaps.after : null,
            freeMinutesBefore: gaps ? gaps.before : null,
            ceiling,
            deferred: deferred.map((d) => d.subject.code),
            deferredForClash: leftOut.map((d) => d.subject.code),
            loadNotes,
            notes
          }
        };
      }
      const stripSection = (label) => String(label).replace(/\s*\([^)]*\)\s*$/, "");
      const listOf = (items) => items.length <= 1 ? items[0] || "" : items.length === 2 ? items.join(" and ") : items.slice(0, -1).join(", ") + " and " + items[items.length - 1];
      function summarize(plan) {
        const pref = plan?.preference ?? {};
        const wanted = pref.timeOfDay || null;
        const timed = (plan?.recommended ?? []).filter((e) => e.chosenSection);
        const missed = wanted ? timed.filter((e) => e.timeMatch !== "match" && e.timeMatch !== "any") : [];
        const matched = wanted ? timed.filter((e) => e.timeMatch === "match").length : 0;
        const word = wanted ? timeWord(wanted) : "";
        const when = (e) => e.chosenSection.timeOfDay ? timeWord(e.chosenSection.timeOfDay) : "mixed times";
        let headline = "";
        let body = "";
        if (wanted && timed.length) {
          const groups = /* @__PURE__ */ new Map();
          for (const e of missed) {
            const k = when(e);
            if (!groups.has(k)) groups.set(k, []);
            groups.get(k).push(e.subject.code);
          }
          const ordered = [...groups.entries()].sort((a, b) => a[1].length - b[1].length);
          const used = ordered.map(([k, codes], i) => ordered.length === 1 ? k : i === ordered.length - 1 ? `${k} for the rest` : `${k} for ${listOf(codes)}`);
          const closest = ordered.length === 1 ? `the closest time was used: ${used[0]}.` : `the closest times were used: ${listOf(used)}.`;
          if (matched === timed.length) {
            headline = `All ${timed.length} of your scheduled subjects fit your ${word} preference.`;
          } else if (!matched && missed.length === timed.length) {
            headline = `No ${word} classes could be fitted this term.`;
            body = `None of your ${timed.length} subject${timed.length === 1 ? "" : "s"} has ${/^[aeiou]/.test(word) ? "an" : "a"} ${word} section that works, so ${closest}`;
          } else {
            headline = `${matched} of ${timed.length} scheduled subjects fit your ${word} preference.`;
            body = missed.length ? `For the others, ${closest}` : "";
          }
        }
        const left = (plan?.leftOutForClash ?? []).map((e) => e.subject.code);
        const leftOut = left.length ? `Left out: ${listOf(left)} ${left.length === 1 ? "clashes" : "clash"} with the rest of your plan.` : "";
        const details = [];
        if (missed.length) {
          details.push(`No ${word} section that fits: ${missed.map((e) => `${e.subject.code} (${when(e)})`).join(", ")}.`);
        }
        for (const e of plan?.leftOutForClash ?? []) {
          const by = (e.blockedBy ?? []).map(stripSection);
          details.push(`${e.subject.code} was left out because every section clashes with ${listOf([...new Set(by)])}.`);
        }
        let freeTime = "";
        if (pref.compact === true && pref.freeMinutes !== null && pref.freeMinutes !== void 0) {
          const week = `Free time between classes: ${gapWords(pref.freeMinutes)} a week`;
          freeTime = pref.freeMinutesBefore > pref.freeMinutes ? `${week} (it would be ${gapWords(pref.freeMinutesBefore)} without this preference).` : `${week}.`;
        }
        return { headline, body, leftOut, freeTime, loadNotes: pref.loadNotes ?? [], details };
      }
      return { apply, summarize, clean, gapMinutes, gapWords, GAP_MINUTES, TIMES, LOADS, LOAD_UNITS };
    });
  }
});

// cura/eligibility-explanation.js
var require_eligibility_explanation = __commonJS({
  "cura/eligibility-explanation.js"(exports, module) {
    var SC2 = typeof window !== "undefined" && window.ScheduleConflicts ? window.ScheduleConflicts : require_scheduleconflicts();
    function summarizeSections(r) {
      return SC2.groupSections(r.sections).map((g) => ({
        section: g.section,
        meetings: g.meetings.map((m) => ({
          type: m.meeting_type,
          days: m.schedule_days,
          start: m.start_time,
          end: m.end_time,
          edp: m.edp_code ?? null
        })),
        timeOfDay: SC2.sectionTimeOfDay(g.meetings)
      }));
    }
    function summarizeForExplanation(assessResult, studentName, opts = {}) {
      const { facts, locked, totalUnits } = assessResult;
      const inReviewIds = new Set(opts.inRequestIds ?? []);
      const allRecommended = assessResult.recommended;
      const recommended = allRecommended.filter((r) => !inReviewIds.has(r.subject.id));
      const inReview = allRecommended.filter((r) => inReviewIds.has(r.subject.id));
      const unitsOf = (list) => list.reduce((n, r) => n + (Number(r.subject.units) || 0), 0);
      const lockedSummary = locked.filter((l) => l.termsAway !== null).sort((a, b) => (a.termsAway ?? 99) - (b.termsAway ?? 99)).slice(0, 6).map((l) => ({
        code: l.subject.code,
        title: l.subject.title,
        termsAway: l.termsAway,
        reasons: l.unmet.map((c) => c.detail)
      }));
      const recommendedSummary = recommended.map((r) => ({
        code: r.subject.code,
        title: r.subject.title,
        units: r.subject.units,
        retake: r.retake,
        reason: r.reason,
        // Codes of subjects this one must be taken together with (a co-requisite met
        // only because both are taken this term). Empty when it stands alone.
        takenTogetherWith: (r.alongside ?? []).map((a) => a.code),
        sections: summarizeSections(r),
        // Set only when the student has stated a preference: the section
        // that was picked for them and why, so Cura cites it, not guesses.
        chosenSection: r.chosenSection ? { section: r.chosenSection.section, timeOfDay: r.chosenSection.timeOfDay } : null,
        timeMatch: r.timeMatch ?? null,
        sectionReason: r.preferenceReason ?? null,
        // An open elective slot: the catalogue subjects that could fill it.
        slotOptions: r.slotOptions ?? null
      }));
      const pref = assessResult.preference ?? null;
      const preferences2 = pref && (pref.timeOfDay || pref.load || pref.compact) ? {
        timeOfDay: pref.timeOfDay,
        load: pref.load,
        // Fewest gaps: set when the student asked for classes close together, with the free time between
        // classes in the suggested plan (minutes a week) and what it would have been without the preference.
        fewestGaps: pref.compact === true,
        freeMinutesPerWeek: pref.compact === true ? pref.freeMinutes ?? null : null,
        freeMinutesWithoutIt: pref.compact === true ? pref.freeMinutesBefore ?? null : null,
        unitCeiling: pref.ceiling,
        movedToLaterTerm: pref.deferred,
        notes: pref.notes
      } : null;
      const leftOut = assessResult.leftOutForClash ?? [];
      const labeledSections = [...allRecommended, ...leftOut].flatMap((r) => SC2.groupSections(r.sections).map((g) => ({
        label: `${r.subject.code} (${g.section})`,
        meetings: g.meetings
      })));
      const scheduleConflicts = SC2.findClashes(labeledSections);
      const availableStartTimes = SC2.availableStartTimes(recommended);
      return {
        studentName: studentName ?? null,
        unitsEarned: facts.unitsEarned,
        totalUnits,
        completedThroughPosition: facts.completedThroughPosition,
        recommended: recommendedSummary,
        // Units of what is still to be submitted, not of the whole suggested load.
        recommendedUnits: inReviewIds.size ? unitsOf(recommended) : assessResult.recommendedUnits,
        // The most the student may take this term (24, or more when graduating).
        // "recommendedUnits" is what is suggested, which can be less.
        unitLimit: assessResult.maxUnits ?? null,
        graduating: assessResult.graduating === true,
        // Already submitted and waiting for the adviser: not to be suggested again.
        inReview: inReview.map((r) => ({ code: r.subject.code, title: r.subject.title, units: r.subject.units })),
        inReviewUnits: unitsOf(inReview),
        preferences: preferences2,
        scheduleConflicts,
        // Eligible subjects the planner could not fit beside the suggested ones. Each says
        // which suggested subject-sections block its sections ("blockedBy") and which single
        // swap would make room ("swaps": take it in that section instead of that subject).
        // Null when everything fits.
        leftOutForClash: leftOut.length ? leftOut.map((l) => ({
          code: l.subject.code,
          title: l.subject.title,
          units: l.subject.units,
          sections: summarizeSections(l),
          blockedBy: l.blockedBy ?? [],
          swaps: l.swaps ?? [],
          // Can it be taken together with each suggested subject? possible:true says in
          // which section, and which suggested subjects (dropFirst) would have to be dropped.
          together: l.together ?? [],
          // Left out because it must be taken with these subjects and they do not fit.
          mustBeWith: l.mustBeWith ?? []
        })) : null,
        // Other clash-free plans the student can ask to see, each named by "label" and described by
        // "changes" against the current one. Empty when there is no real alternative.
        alternatives: (assessResult.alternatives ?? []).map((a) => ({
          label: a.label,
          units: a.units,
          placed: a.placed,
          notIncluded: a.notIncluded,
          changes: a.changes,
          note: a.note
        })),
        availableStartTimes,
        locked: lockedSummary,
        lockedCount: locked.length
        // so "6 more subjects are also locked" is possible
      };
    }
    if (typeof module === "object" && module.exports) {
      module.exports = { summarizeForExplanation };
    }
  }
});

// shared/js/schedule/backupsections.js
var require_backupsections = __commonJS({
  "shared/js/schedule/backupsections.js"(exports, module) {
    (function(root, factory) {
      if (typeof module === "object" && module.exports) module.exports = factory(require_scheduleconflicts());
      else root.BackupSections = factory(root.ScheduleConflicts);
    })(typeof self !== "undefined" ? self : exports, function(SC2) {
      "use strict";
      const MAX_BACKUPS = 2;
      function sectionsClash(a, b) {
        return (a.meetings ?? []).some((m1) => (b.meetings ?? []).some((m2) => SC2.meetingsClash(m1, m2)));
      }
      function firstStart(group) {
        const starts = (group.meetings ?? []).filter((m) => m.start_time).map((m) => SC2.minutesOf(m.start_time)).filter((v) => v !== null);
        return starts.length ? Math.min(...starts) : null;
      }
      function backupsFor(plan, options = {}) {
        const max = options.max ?? MAX_BACKUPS;
        const isClosed = options.isClosed ?? (() => false);
        const wanted = options.timeOfDay ?? null;
        const placed = (plan ?? []).map((entry) => ({
          entry,
          group: (entry.sections ?? []).find((g) => g.section === entry.chosen) ?? null
        }));
        const out = /* @__PURE__ */ new Map();
        for (const { entry, group: current } of placed) {
          const others = placed.filter((p) => p.entry !== entry && p.group).map((p) => p.group);
          const currentTime = current ? SC2.sectionTimeOfDay(current.meetings) : null;
          const target = wanted ?? currentTime;
          const fitting = (entry.sections ?? []).filter((g) => g.section !== entry.chosen).filter((g) => !isClosed(g)).filter((g) => !others.some((o) => sectionsClash(g, o)));
          const ranked = fitting.map((g) => {
            const start2 = firstStart(g);
            return {
              g,
              // 0 = meets at the preferred time of day, 1 = another time, so a closer match comes first
              away: target && SC2.sectionTimeOfDay(g.meetings) === target ? 0 : 1,
              // a section with no posted time cannot be checked for clashes, so it comes last
              unposted: start2 === null ? 1 : 0,
              start: start2 ?? Infinity
            };
          }).sort((a, b) => a.unposted - b.unposted || a.away - b.away || a.start - b.start || a.g.section.localeCompare(b.g.section));
          out.set(entry.code, ranked.slice(0, max).map((r) => r.g));
        }
        return out;
      }
      return { backupsFor, sectionsClash, MAX_BACKUPS };
    });
  }
});

// shared/js/edpresult.js
var require_edpresult = __commonJS({
  "shared/js/edpresult.js"(exports, module) {
    (function(root, factory) {
      if (typeof module === "object" && module.exports) module.exports = factory(require_scheduleconflicts(), require_backupsections());
      else root.EdpResult = factory(root.ScheduleConflicts, root.BackupSections);
    })(typeof self !== "undefined" ? self : exports, function(SC2, BS) {
      "use strict";
      const REASONS = [
        {
          value: "full",
          label: "The section is full or closed",
          kind: "section",
          next: "Ask the EDP office for another section, or choose another subject."
        },
        {
          value: "conflict",
          label: "The EDP office found a time conflict",
          kind: "section",
          next: "Choose a section that does not overlap. If the posted schedule looks wrong, tell the Department."
        },
        {
          value: "code_error",
          label: "Wrong EDP code or a mistake on the form",
          kind: "section",
          next: "Check each code against your Enrolment sheet, then write the form again."
        },
        {
          value: "record",
          label: "My record or a prerequisite was questioned",
          kind: "office",
          next: "Ask the Registrar to check your record, then go back to the EDP office."
        },
        {
          value: "overload",
          label: "Too many units",
          kind: "office",
          next: "Take out a subject, or ask your adviser about your unit limit."
        },
        {
          value: "hold",
          label: "A hold (balance or clearance)",
          kind: "office",
          next: "Visit the Registrar or the Cashier. Your plan is still valid."
        },
        {
          value: "other",
          label: "Another reason",
          kind: "section",
          next: "Ask your adviser what to change. Another section may help."
        }
      ];
      const reasonOf = (value) => REASONS.find((r) => r.value === value) ?? null;
      const reasonLabel = (value) => reasonOf(value)?.label ?? "";
      const nextStep = (value) => reasonOf(value)?.next ?? "";
      const needsNewSection = (value) => reasonOf(value)?.kind === "section";
      function checklistRows(request) {
        return (request?.request_item ?? []).filter((i) => i.status === "approved").map((i) => ({
          itemId: i.id,
          subjectId: i.subject_id ?? null,
          code: i.subject?.code ?? "",
          title: i.subject?.title ?? "",
          units: Number(i.subject?.units) || 0,
          section: i._section?.section ?? null,
          edp: [...new Set((i._section?.meetings ?? []).map((m) => String(m.edp_code ?? "").trim()).filter(Boolean))],
          result: i.edp_result ?? null,
          reason: i.edp_reason ?? null
        }));
      }
      function problems(choices) {
        const out = [];
        for (const c of choices ?? []) {
          if (c.result !== null && c.result !== void 0 && c.result !== "accepted" && c.result !== "rejected") {
            out.push({ itemId: c.itemId, message: "Choose accepted or rejected." });
          } else if (c.result === "rejected" && !reasonOf(c.reason)) {
            out.push({ itemId: c.itemId, message: "Say why it was rejected." });
          }
        }
        return out;
      }
      function payload(choices) {
        return (choices ?? []).map((c) => ({
          item_id: c.itemId,
          result: c.result ?? null,
          reason: c.result === "rejected" ? c.reason : null
        }));
      }
      const sectionKey = (subjectId, section) => `${subjectId}|${section}`;
      function fullKeys(requests) {
        const keys = /* @__PURE__ */ new Set();
        for (const r of requests ?? []) {
          for (const i of r.request_item ?? []) {
            if (i.edp_result === "rejected" && i.edp_reason === "full" && i._section?.section && i.subject_id != null) {
              keys.add(sectionKey(i.subject_id, i._section.section));
            }
          }
        }
        return keys;
      }
      function dropReported(offerings, keys) {
        if (!keys || !keys.size) return offerings;
        return (offerings ?? []).filter((o) => !keys.has(sectionKey(o.subject_id, o.section)));
      }
      function dropByOfferingIds(offerings, offeringIds) {
        const ids = new Set(offeringIds ?? []);
        if (!ids.size) return offerings;
        const keys = new Set((offerings ?? []).filter((o) => ids.has(o.id)).map((o) => sectionKey(o.subject_id, o.section)));
        return dropReported(offerings, keys);
      }
      function openRows(offerings, keepSection = null) {
        return (offerings ?? []).filter((o) => o.is_open !== false || keepSection != null && o.section === keepSection);
      }
      const clash = (a, b) => (a.meetings ?? []).some((m1) => (b.meetings ?? []).some((m2) => SC2.meetingsClash(m1, m2)));
      function alternatives({ request, rejected, eligible = [], room = Infinity, fullKeys: full = /* @__PURE__ */ new Set(), timeOfDay = null, max = 3 }) {
        const items = (request?.request_item ?? []).filter((i) => i.status === "approved" && i._section);
        const isRejected = (i) => rejected.has(i.id);
        const kept = items.filter((i) => !isRejected(i));
        const keptGroups = kept.map((i) => i._section);
        const keptCodes = new Set(items.map((i) => i.subject?.code));
        const isFull = (subjectId) => (g) => full.has(sectionKey(subjectId, g.section));
        const out = /* @__PURE__ */ new Map();
        for (const item of items.filter(isRejected)) {
          const plan = [...kept, item].map((i) => ({
            code: i.subject?.code ?? "",
            chosen: i._section.section,
            sections: i._allSections ?? [i._section]
          }));
          const own = BS.backupsFor(plan, { max, timeOfDay, isClosed: isFull(item.subject_id) }).get(item.subject?.code ?? "") ?? [];
          let replacements = [];
          if (!own.length) {
            const freed = Number(item.subject?.units) || 0;
            for (const e of eligible) {
              if (replacements.length >= max) break;
              if (keptCodes.has(e.subject.code)) continue;
              if (e.availableThisTerm === false) continue;
              if (e.subject.year_level == null) continue;
              if ((e.alongside ?? []).length) continue;
              const u = Number(e.subject.units) || 0;
              if (u > room + freed) continue;
              const group = SC2.groupSections(e.sections).filter((g) => !isFull(e.subject.id)(g)).find((g) => !keptGroups.some((k) => clash(g, k)));
              if (!group) continue;
              replacements.push({ code: e.subject.code, title: e.subject.title, units: u, group });
            }
          }
          out.set(item.id, { sameSubject: own, replacements });
        }
        return out;
      }
      function moveOptions({ request, item, fullKeys: full = /* @__PURE__ */ new Set(), max = 6 }) {
        const current = (item?._section?.meetings ?? []).find((m) => m.id === item.offering_id);
        if (!current) return [];
        const others = (request?.request_item ?? []).filter((i) => i.status === "approved" && i._section && i.id !== item.id && i.subject_id !== item.subject_id && i.edp_result !== "rejected");
        const out = [];
        for (const g of item._allSections ?? []) {
          if (out.length >= max) break;
          if (g.section === item._section.section) continue;
          if (full.has(sectionKey(item.subject_id, g.section))) continue;
          if (g.meetings.some((m) => m.is_open === false)) continue;
          const target = g.meetings.find((m) => (m.meeting_type ?? null) === (current.meeting_type ?? null));
          if (!target) continue;
          if (others.some((o) => clash(g, o._section))) continue;
          out.push({ group: g, offeringId: target.id });
        }
        return out;
      }
      return { REASONS, reasonLabel, nextStep, needsNewSection, checklistRows, problems, payload, sectionKey, fullKeys, dropReported, dropByOfferingIds, openRows, alternatives, moveOptions };
    });
  }
});

// shared/js/curriculum/curriculumstart.js
var require_curriculumstart = __commonJS({
  "shared/js/curriculum/curriculumstart.js"(exports, module) {
    (function(root, factory) {
      if (typeof module === "object" && module.exports) module.exports = factory();
      else root.CurriculogicCurriculumStart = factory();
    })(typeof self !== "undefined" ? self : exports, function() {
      "use strict";
      function notStarted({ curriculumYear, currentYear, ownProspectus, recordCount }) {
        if (!Number.isInteger(curriculumYear) || !Number.isInteger(currentYear)) return false;
        if (curriculumYear <= currentYear) return false;
        return !ownProspectus || !(recordCount > 0);
      }
      function message(curriculumYear) {
        return `The curriculum for your programme takes effect in ${curriculumYear}\u2013${curriculumYear + 1}, so you cannot choose subjects from it yet. Please contact your department.`;
      }
      return { notStarted, message };
    });
  }
});

// supabase/functions/assess-student/index.ts
var import_core = __toESM(require_core());
var import_core2 = __toESM(require_core2());
var import_engine = __toESM(require_engine());
var import_preferences = __toESM(require_preferences());
var import_scheduleconflicts = __toESM(require_scheduleconflicts());
var import_eligibility_explanation = __toESM(require_eligibility_explanation());
var import_edpresult = __toESM(require_edpresult());
var import_curriculumstart = __toESM(require_curriculumstart());
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
var corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};
var json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" }
});
function fallbackProspectus(programId, actives) {
  if (programId !== null && programId !== void 0) {
    return actives.find((p) => p.program_id === programId) ?? null;
  }
  return actives.length === 1 ? actives[0] : null;
}
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const anon = Deno.env.get("SUPABASE_ANON_KEY");
    const authorization = req.headers.get("Authorization") ?? "";
    if (!url || !anon) {
      console.error("SUPABASE_URL / SUPABASE_ANON_KEY are not set.");
      return json(500, { error: "Server is not configured." });
    }
    const db = createClient(url, anon, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data: userData, error: userError } = await db.auth.getUser();
    if (userError || !userData?.user) return json(401, { error: "Not signed in." });
    const fail = (what, error) => {
      console.error(`assess-student: ${what} failed:`, error?.message);
      return json(502, { error: "Could not load your record. Try again." });
    };
    const { data: student, error: studentError } = await db.from("university_student").select("id, user_id, student_id, first_name, last_name, year_level, is_approved, record_verified, prospectus_id, program_id").eq("user_id", userData.user.id).maybeSingle();
    if (studentError) return fail("student lookup", studentError);
    if (!student) return json(404, { error: "No student account is linked to this login." });
    if (student.is_approved !== true) {
      return json(403, { error: "This account is awaiting approval.", reason: "not_approved" });
    }
    const { data: program } = student.program_id == null ? { data: null } : await db.from("program").select("id, code, name, max_units, max_units_graduating, target_units").eq("id", student.program_id).maybeSingle();
    const who = {
      studentId: student.student_id,
      name: [student.first_name, student.last_name].filter(Boolean).join(" "),
      programCode: program?.code ?? null
    };
    if (student.record_verified !== true) {
      return json(200, { assessed: false, reason: "record_not_verified", student: who });
    }
    let prospectusId = student.prospectus_id ?? null;
    if (prospectusId === null) {
      const { data: actives, error } = await db.from("prospectus").select("id, program_id").eq("is_active", true);
      if (error) return fail("prospectus lookup", error);
      prospectusId = fallbackProspectus(student.program_id, actives ?? [])?.id ?? null;
    }
    if (prospectusId === null) {
      return json(200, { assessed: false, reason: "no_curriculum", student: who });
    }
    const { data: subjects, error: subjectError } = await db.from("subject").select("id, code, title, units, year_level, term, is_elective, elective_type, is_active").eq("prospectus_id", prospectusId);
    if (subjectError) return fail("subjects", subjectError);
    const subjectIds = (subjects ?? []).map((s) => s.id);
    const { data: config } = await db.from("system_config").select("current_term, current_academic_year").eq("id", 1).maybeSingle();
    const term = config?.current_term ?? 1;
    const year = config?.current_academic_year ?? (/* @__PURE__ */ new Date()).getUTCFullYear();
    const [rulesRes, offeringsRes, recordsRes, prefRes, requestsRes, reportedRes, approvedRes] = await Promise.all([
      db.from("prerequisite").select("subject_id, prerequisite_subject_id, requirement_type, rule_type, rule_group, threshold_value").in("subject_id", subjectIds),
      db.from("subject_offering").select("id, subject_id, section, meeting_type, schedule_days, start_time, end_time, room, edp_code, is_open").eq("academic_year", year).eq("term", term),
      db.from("academic_record").select("subject_id, status, grade, grade_points, taken_term, taken_year").eq("student_id", student.id),
      // Preferences are optional: the table may not exist yet, and a missing
      // row just means "no preference".
      // "compact" (fewest gaps, db/081) is read with the rest; if that column is not there yet the
      // query errors and the two older columns are read on their own just below.
      db.from("student_preference").select("time_of_day, load, compact").eq("student_id", student.id).maybeSingle(),
      // Optional like preferences: if it cannot be read, nothing is marked in review.
      db.from("request").select("id, status, registrar_status, created_at, request_item(subject_id, status)").eq("student_id", student.id).order("created_at", { ascending: false }),
      // Sections this student reported full at the EDP office (db/077). Optional too: before that migration the
      // columns do not exist, the query errors, and nothing is hidden.
      db.from("request_item").select("offering_id").eq("edp_result", "rejected").eq("edp_reason", "full").not("offering_id", "is", null),
      // The approved plan with what the student reported (for Cura's "the EDP office turned it down" answers). Optional.
      db.from("request").select("id, status, registrar_status, created_at, request_item(id, subject_id, status, offering_id, remarks, edp_result, edp_reason, subject(code, title, units))").eq("student_id", student.id).in("status", ["approved", "partially_approved"]).order("created_at", { ascending: false }).limit(3)
    ]);
    if (rulesRes.error) return fail("rules", rulesRes.error);
    if (offeringsRes.error) return fail("offerings", offeringsRes.error);
    if (recordsRes.error) return fail("records", recordsRes.error);
    const { data: chosenVersion } = await db.from("prospectus").select("academic_year").eq("id", prospectusId).maybeSingle();
    if (import_curriculumstart.default.notStarted({
      curriculumYear: chosenVersion?.academic_year,
      currentYear: year,
      ownProspectus: student.prospectus_id != null,
      recordCount: (recordsRes.data ?? []).length
    })) {
      return json(200, {
        assessed: false,
        reason: "curriculum_not_started",
        student: who,
        message: import_curriculumstart.default.message(chosenVersion.academic_year)
      });
    }
    const idSet = new Set(subjectIds);
    const offerings = (offeringsRes.data ?? []).filter((o) => idSet.has(o.subject_id));
    let prefRow = prefRes.error ? null : prefRes.data;
    if (prefRes.error) {
      const older = await db.from("student_preference").select("time_of_day, load").eq("student_id", student.id).maybeSingle();
      prefRow = older.error ? null : older.data;
    }
    const prefs = !prefRow ? null : { timeOfDay: prefRow.time_of_day, load: prefRow.load, compact: prefRow.compact === true };
    const out = import_core.default.assessStudent(
      { engine: import_engine.default, preferences: import_preferences.default, explain: import_eligibility_explanation.default, SC: import_scheduleconflicts.default, edp: import_edpresult.default },
      {
        student,
        program,
        records: recordsRes.data ?? [],
        subjects: subjects ?? [],
        rules: rulesRes.data ?? [],
        offerings,
        term,
        year,
        prefs,
        approvedRequests: approvedRes.error ? [] : approvedRes.data ?? [],
        reportedFullOfferingIds: reportedRes.error ? [] : (reportedRes.data ?? []).map((x) => x.offering_id),
        inRequestIds: requestsRes.error ? [] : [...import_core2.default.lockedSubjectIds(requestsRes.data ?? [])]
      }
    );
    return json(200, out);
  } catch (err) {
    console.error("Unexpected error in assess-student:", err);
    return json(500, { error: "Something went wrong." });
  }
});
