// submit-advising-request
//
// The only path that creates a `request` and its `request_item` rows.
// Every selected subject is run through the real engine before any row is
// written, so an invalid subject reaches Faculty's queue already flagged, and
// no client-supplied status is ever trusted.
//
// The rules are NOT reimplemented here. core.js calls the same shared engine
// the website and assess-student run; build.mjs bundles it into dist/index.js,
// which is what gets deployed, so the deployed copy cannot drift.
//
// Body: { items: [{ subjectId, offeringId }], term, year, dryRun? }
// With dryRun: true nothing is written; the answer is what would happen.
// Returns { requestId, items: [{ subjectId, offeringId, valid, reason }], flaggedCount }.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
// @ts-ignore: plain JavaScript, bundled by build.mjs
import core from "./core.js";
// @ts-ignore
import engine from "../../../shared/engine/engine.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/* The active prospectus a student falls back to when they have none of their
   own. Same rule as CurriculogicPrograms.fallbackProspectus on the website. */
function fallbackProspectus(programId: number | null, actives: { id: number; program_id: number }[]) {
  if (programId !== null && programId !== undefined) {
    return actives.find((p) => p.program_id === programId) ?? null;
  }
  return actives.length === 1 ? actives[0] : null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const anon = Deno.env.get("SUPABASE_ANON_KEY");
    if (!url || !anon) {
      console.error("SUPABASE_URL / SUPABASE_ANON_KEY are not set.");
      return json(500, { error: "Server is not configured." });
    }

    const db = createClient(url, anon, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: authError } = await db.auth.getUser();
    if (authError || !userData?.user) return json(401, { error: "Not signed in." });

    let body: any = null;
    try { body = await req.json(); } catch { /* handled below */ }
    const selections = body?.items;
    if (!Array.isArray(selections) || selections.length === 0) {
      return json(400, { error: "Select at least one subject." });
    }
    const dryRun = body?.dryRun === true;

    const { data: student, error: studentError } = await db
      .from("university_student")
      .select("id, year_level, prospectus_id, program_id, record_verified")
      .eq("user_id", userData.user.id)
      .maybeSingle();
    if (studentError || !student) {
      return json(403, { error: "No student record found for this account." });
    }
    if (!student.record_verified) {
      return json(403, { error: "Your academic record has not been verified yet." });
    }

    // The student's own curriculum, else their programme's active one.
    let prospectusId: number | null = student.prospectus_id ?? null;
    if (prospectusId === null) {
      const { data: actives } = await db.from("prospectus").select("id, program_id").eq("is_active", true);
      prospectusId = fallbackProspectus(student.program_id, actives ?? [])?.id ?? null;
    }
    if (prospectusId === null) {
      return json(403, { error: "No curriculum is assigned to your account yet." });
    }

    const { data: program } = student.program_id == null
      ? { data: null }
      : await db.from("program").select("max_units, max_units_graduating")
          .eq("id", student.program_id).maybeSingle();

    const { data: subjects, error: subjectError } = await db.from("subject")
      .select("id, code, title, units, year_level, term, is_elective, elective_type, is_active")
      .eq("prospectus_id", prospectusId);
    if (subjectError) {
      console.error("subjects failed:", subjectError.message);
      return json(500, { error: "Could not load your academic data." });
    }
    const subjectIds = (subjects ?? []).map((s: { id: number }) => s.id);

    const { data: config } = await db.from("system_config")
      .select("current_term, current_academic_year").eq("id", 1).maybeSingle();
    const term = config?.current_term ?? 1;
    const year = config?.current_academic_year ?? new Date().getUTCFullYear();

    const [rulesRes, offeringsRes, recordsRes, requestsRes] = await Promise.all([
      db.from("prerequisite")
        .select("subject_id, prerequisite_subject_id, requirement_type, rule_type, rule_group, threshold_value")
        .in("subject_id", subjectIds),
      db.from("subject_offering").select("id, subject_id")
        .eq("academic_year", year).eq("term", term),
      db.from("academic_record")
        .select("subject_id, status, grade, grade_points, taken_term, taken_year")
        .eq("student_id", student.id),
      db.from("request")
        .select("id, status, registrar_status, created_at, request_item(subject_id, status)")
        .eq("student_id", student.id)
        .order("created_at", { ascending: false }),
    ]);
    if (rulesRes.error || offeringsRes.error || recordsRes.error) {
      console.error("data load failed:", rulesRes.error, offeringsRes.error, recordsRes.error);
      return json(500, { error: "Could not load your academic data." });
    }
    if (requestsRes.error) {
      console.error("existing request load failed:", requestsRes.error.message);
      return json(500, { error: "Could not verify your existing requests. Please try again." });
    }

    // A second tab or a racing click can still send a subject whose request
    // is already in flight: refuse the whole submission if so.
    const lockedIds = core.lockedSubjectIds(requestsRes.data ?? []);
    const blocked = selections.filter((sel: { subjectId: number }) => lockedIds.has(sel.subjectId));
    if (blocked.length > 0) {
      const byId = new Map((subjects ?? []).map((s: { id: number; code: string }) => [s.id, s]));
      const codes = blocked.map((sel: { subjectId: number }) => (byId.get(sel.subjectId) as any)?.code).filter(Boolean);
      return json(409, {
        error: codes.length
          ? `Already submitted and awaiting a decision: ${codes.join(", ")}. Refresh Build Your Plan and try again.`
          : "One or more selected subjects already have a request awaiting a decision. Refresh Build Your Plan and try again.",
      });
    }

    const idSet = new Set(subjectIds);
    const offerings = (offeringsRes.data ?? []).filter((o: { subject_id: number }) => idSet.has(o.subject_id));

    const evaluated = core.evaluateSelections({ engine }, {
      student, program,
      records: recordsRes.data ?? [],
      subjects: subjects ?? [],
      rules: rulesRes.data ?? [],
      offerings, term, selections,
    });
    const flaggedCount = evaluated.filter((e: { valid: boolean }) => !e.valid).length;

    // A subject that cannot be enrolled in this semester is refused outright
    // rather than flagged for the adviser: it should never reach the queue.
    const unavailable = evaluated.filter((e: { unavailable?: boolean }) => e.unavailable);
    if (unavailable.length > 0) {
      const byId = new Map((subjects ?? []).map((s: { id: number; code: string }) => [s.id, s]));
      const codes = unavailable.map((e: { subjectId: number }) => (byId.get(e.subjectId) as any)?.code).filter(Boolean);
      return json(422, {
        error: `Not available this semester: ${codes.join(", ")}. Refresh Build Your Plan and choose again.`,
      });
    }

    if (dryRun) return json(200, { requestId: null, items: evaluated, flaggedCount, dryRun: true });

    // Real submissions only: a student cannot flood their adviser with requests.
    const limit = core.submissionLimit(requestsRes.data ?? []);
    if (!limit.ok) return json(429, { error: limit.error });

    const { data: request, error: requestError } = await db
      .from("request")
      .insert({
        student_id: student.id,
        prospectus_id: prospectusId,
        requested_term: body?.term ?? null,
        requested_year: body?.year ?? null,
        status: "submitted",
      })
      .select("id")
      .single();
    if (requestError) {
      console.error("request insert failed:", requestError.message);
      return json(500, { error: "Could not create the request." });
    }

    const { error: itemsError } = await db.from("request_item").insert(
      evaluated.map((e: any) => ({
        request_id: request.id,
        subject_id: e.subjectId,
        offering_id: e.offeringId,
        status: e.valid ? "valid" : "flagged",
        remarks: e.reason,
      })),
    );
    if (itemsError) {
      console.error("request_item insert failed:", itemsError.message);
      return json(500, {
        error: "The request was created but its subjects failed to save. Contact support with request ID " + request.id + ".",
      });
    }

    return json(200, { requestId: request.id, items: evaluated, flaggedCount });
  } catch (err) {
    console.error("Unexpected error in submit-advising-request:", err);
    return json(500, { error: "Something went wrong submitting your request." });
  }
});
