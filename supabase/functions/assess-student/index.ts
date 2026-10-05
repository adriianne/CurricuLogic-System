// assess-student
//
// One call for a mobile client: "what can I take, and why?"
//
// The signed-in student's own token is used for every query, so row-level
// security applies exactly as it does on the website: a student only ever
// reads their own record. The rules themselves are NOT reimplemented here.
// This file loads the data and calls the same shared engine, preferences step
// and Cura summary the website runs (shared/engine/*, ai-assist/*), through
// core.js. build.mjs bundles all of it into dist/index.js, which is what gets
// deployed, so the deployed copy cannot drift from the website's.
//
// Returns { assessed: true, student, term, progress, load, recommended,
// alsoOpen, locked, curriculum, electives, preferences, summary }, or
// { assessed: false, reason } for a student who cannot be assessed yet.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
// @ts-ignore: plain JavaScript, bundled by build.mjs
import core from "./core.js";
// Which subjects are already in a request awaiting a decision: the same rule the
// website and submit-advising-request use.
import requestCore from "../submit-advising-request/core.js";
// @ts-ignore
import engine from "../../../shared/engine/engine.js";
// @ts-ignore
import preferences from "../../../shared/engine/preferences.js";
// @ts-ignore
import SC from "../../../shared/js/scheduleconflicts.js";
// @ts-ignore
import explain from "../../../ai-assist/eligibility-explanation.js";

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

/* Which active prospectus a student falls back to when they have none of
   their own: their programme's, or the only one if no programme is set.
   Same rule as CurriculogicPrograms.fallbackProspectus on the website. */
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
    const authorization = req.headers.get("Authorization") ?? "";
    if (!url || !anon) {
      console.error("SUPABASE_URL / SUPABASE_ANON_KEY are not set.");
      return json(500, { error: "Server is not configured." });
    }

    // The caller's own token: every query below runs as the student.
    const db = createClient(url, anon, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userError } = await db.auth.getUser();
    if (userError || !userData?.user) return json(401, { error: "Not signed in." });

    const fail = (what: string, error: { message: string } | null) => {
      console.error(`assess-student: ${what} failed:`, error?.message);
      return json(502, { error: "Could not load your record. Try again." });
    };

    const { data: student, error: studentError } = await db
      .from("university_student")
      .select("id, user_id, student_id, first_name, last_name, year_level, is_approved, record_verified, prospectus_id, program_id")
      .eq("user_id", userData.user.id)
      .maybeSingle();
    if (studentError) return fail("student lookup", studentError);
    if (!student) return json(404, { error: "No student account is linked to this login." });
    if (student.is_approved !== true) {
      return json(403, { error: "This account is awaiting approval.", reason: "not_approved" });
    }

    const { data: program } = student.program_id == null
      ? { data: null }
      : await db.from("program")
          .select("id, code, name, max_units, max_units_graduating, target_units")
          .eq("id", student.program_id).maybeSingle();

    const who = {
      studentId: student.student_id,
      name: [student.first_name, student.last_name].filter(Boolean).join(" "),
      programCode: program?.code ?? null,
    };
    if (student.record_verified !== true) {
      return json(200, { assessed: false, reason: "record_not_verified", student: who });
    }

    // The curriculum this student is assessed against: their own if set at
    // registration, otherwise their programme's active one.
    let prospectusId: number | null = student.prospectus_id ?? null;
    if (prospectusId === null) {
      const { data: actives, error } = await db.from("prospectus")
        .select("id, program_id").eq("is_active", true);
      if (error) return fail("prospectus lookup", error);
      prospectusId = fallbackProspectus(student.program_id, actives ?? [])?.id ?? null;
    }
    if (prospectusId === null) {
      return json(200, { assessed: false, reason: "no_curriculum", student: who });
    }

    const { data: subjects, error: subjectError } = await db.from("subject")
      .select("id, code, title, units, year_level, term, is_elective, elective_type, is_active")
      .eq("prospectus_id", prospectusId);
    if (subjectError) return fail("subjects", subjectError);
    const subjectIds = (subjects ?? []).map((s: { id: number }) => s.id);

    const { data: config } = await db.from("system_config")
      .select("current_term, current_academic_year").eq("id", 1).maybeSingle();
    const term = config?.current_term ?? 1;
    const year = config?.current_academic_year ?? new Date().getUTCFullYear();

    const [rulesRes, offeringsRes, recordsRes, prefRes, requestsRes] = await Promise.all([
      db.from("prerequisite")
        .select("subject_id, prerequisite_subject_id, requirement_type, rule_type, rule_group, threshold_value")
        .in("subject_id", subjectIds),
      db.from("subject_offering")
        .select("id, subject_id, section, meeting_type, schedule_days, start_time, end_time, room")
        .eq("academic_year", year).eq("term", term),
      db.from("academic_record")
        .select("subject_id, status, grade, grade_points, taken_term, taken_year")
        .eq("student_id", student.id),
      // Preferences are optional: the table may not exist yet, and a missing
      // row just means "no preference".
      db.from("student_preference").select("time_of_day, load")
        .eq("student_id", student.id).maybeSingle(),
      // Optional like preferences: if it cannot be read, nothing is marked in review.
      db.from("request")
        .select("id, status, registrar_status, created_at, request_item(subject_id, status)")
        .eq("student_id", student.id)
        .order("created_at", { ascending: false }),
    ]);
    if (rulesRes.error) return fail("rules", rulesRes.error);
    if (offeringsRes.error) return fail("offerings", offeringsRes.error);
    if (recordsRes.error) return fail("records", recordsRes.error);

    const idSet = new Set(subjectIds);
    const offerings = (offeringsRes.data ?? []).filter((o: { subject_id: number }) => idSet.has(o.subject_id));
    const prefs = prefRes.error || !prefRes.data
      ? null
      : { timeOfDay: prefRes.data.time_of_day, load: prefRes.data.load };

    const out = core.assessStudent(
      { engine, preferences, explain, SC },
      {
        student, program,
        records: recordsRes.data ?? [],
        subjects: subjects ?? [],
        rules: rulesRes.data ?? [],
        offerings, term, year, prefs,
        inRequestIds: requestsRes.error
          ? []
          : [...requestCore.lockedSubjectIds(requestsRes.data ?? [])],
      },
    );

    return json(200, out);
  } catch (err) {
    console.error("Unexpected error in assess-student:", err);
    return json(500, { error: "Something went wrong." });
  }
});
