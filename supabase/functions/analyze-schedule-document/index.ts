// analyze-schedule-document
// Reads a photograph of a University of Cebu "Schedule Data Entry Form"
// and returns rows in the same shape the CSV upload produces, so the
// client can hand them straight to previewUpload().
//
// Deploy from the Supabase dashboard (Code tab → Deploy). Requires the
// GEMINI_API_KEY secret to be set — same one analyze-curriculum-document
// uses.
//
// v7: only an approved department account or an administrator may call it
// (v6 ran for anyone holding the public anon key), the photo must be a JPEG,
// PNG or WebP of at most ~5 MB, and the subject list / section / term / year
// that are written into the prompt are checked first.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const GEMINI_MODEL = "gemini-3.1-flash-lite";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

// Who may call this function.
//
// verify_jwt (on in the dashboard) only proves the token is validly signed,
// and the public anon key IS a validly signed token, so on its own it lets a
// signed-out visitor straight through to a paid AI call. This checks that the
// token belongs to a real, approved account with one of the allowed roles.
// Returns null when the caller may proceed, otherwise the response to send.
type CallerRole = "student" | "department" | "admin";
const ROLE_TABLE: Record<CallerRole, string> = {
  student: "university_student",
  department: "department_staff",
  admin: "system_administrator",
};

async function rejectCaller(req: Request, roles: CallerRole[]): Promise<Response | null> {
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) {
    console.error("SUPABASE_URL / ANON / SERVICE_ROLE key not set.");
    return json({ ok: false, error: "Server is not configured." }, 500);
  }

  const noSession = { auth: { persistSession: false, autoRefreshToken: false } };
  const asCaller = createClient(url, anon, {
    ...noSession,
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data, error } = await asCaller.auth.getUser();
  if (error || !data?.user) return json({ ok: false, error: "Not signed in." }, 401);

  const admin = createClient(url, service, noSession);
  for (const role of roles) {
    const { data: row } = await admin
      .from(ROLE_TABLE[role])
      .select("id")
      .eq("user_id", data.user.id)
      .eq("is_approved", true)
      .maybeSingle();
    if (row) return null;
  }
  return json({ ok: false, error: "Not allowed." }, 403);
}

// The client shrinks the photo to 2000 px before sending, so a real request is
// well under a megabyte. 5 MB of image is about 7 million base64 characters.
const MAX_REQUEST_BYTES = 8_000_000;
const MAX_IMAGE_CHARS = 7_000_000;
const MAX_SUBJECTS = 400;
const MAX_TEXT = 60;   // one subject code, or the section label
// A line break inside a value written into the prompt could start a new
// instruction, so none is accepted.
const CONTROL = /[\u0000-\u001f\u007f]/;

const cleanText = (v: unknown): string | null =>
  typeof v === "string" && v.length >= 1 && v.length <= MAX_TEXT && !CONTROL.test(v) ? v : null;

const smallInt = (v: unknown, min: number, max: number): number | null => {
  const n = Number(v);
  return v !== null && v !== "" && Number.isInteger(n) && n >= min && n <= max ? n : null;
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const denied = await rejectCaller(req, ["department", "admin"]);
    if (denied) return denied;

    if (Number(req.headers.get("content-length") ?? "0") > MAX_REQUEST_BYTES) {
      return json({ ok: false, error: "That photo is too large (5 MB maximum)." }, 413);
    }

    const body0 = await req.json();
    const { image, subjects } = body0;

    if (!image) return json({ ok: false, error: "No image provided." });
    if (!Array.isArray(subjects) || subjects.length === 0) {
      return json({ ok: false, error: "No subject list provided." });
    }

    if (typeof image !== "string" || image.length > MAX_IMAGE_CHARS) {
      return json({ ok: false, error: "That photo is too large (5 MB maximum)." }, 413);
    }
    if (subjects.length > MAX_SUBJECTS || subjects.some((s: unknown) => cleanText(s) === null)) {
      return json({ ok: false, error: "The subject list is not valid." }, 400);
    }
    const section = body0.section == null ? null : cleanText(body0.section);
    if (body0.section != null && section === null) {
      return json({ ok: false, error: "The section is not valid." }, 400);
    }
    const term = smallInt(body0.term, 1, 3);
    const year = smallInt(body0.year, 2000, 2100);

    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) return json({ ok: false, error: "Server is missing GEMINI_API_KEY." });

    const m = String(image).match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/i);
    if (!m) return json({ ok: false, error: "The photo must be a JPEG, PNG or WebP image." });
    const mimeType = m[1];
    const base64   = m[2];

    const prompt = buildPrompt({ section, subjects, term, year });

    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inline_data: { mime_type: mimeType, data: base64 } },
            ],
          }],
          generationConfig: {
            temperature: 0.05,
            responseMimeType: "application/json",
          },
        }),
      },
    );

    if (!upstream.ok) {
      const text = await upstream.text();
      console.error("gemini error:", upstream.status, text.slice(0, 400));
      return json({ ok: false, error: `Scanner error (${upstream.status}). Try again.` });
    }

    const body = await upstream.json();
    const raw = body.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!raw) return json({ ok: false, error: "The scanner returned nothing." });

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.error("gemini returned non-JSON:", raw.slice(0, 400));
      return json({ ok: false, error: "The scanner returned malformed data." });
    }

    return json({
      ok: true,
      rows: Array.isArray(parsed.rows) ? parsed.rows : [],
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
      detected_section: parsed.detected_section ?? null,
      detected_course:  parsed.detected_course  ?? null,
      detected_year:    Number.isFinite(Number(parsed.detected_year)) ? Number(parsed.detected_year) : null,
      detected_term:    Number.isFinite(Number(parsed.detected_term)) ? Number(parsed.detected_term) : null,
    });
  } catch (err) {
    console.error("analyze-schedule-document failed:", err);
    return json({ ok: false, error: err?.message ?? "Unexpected error." });
  }
});

function buildPrompt({ section, subjects, term, year }) {
  const sectionPrefix = String(section || "").split("-")[0] || "BSIT";
  const ayRange = `${year}–${Number(year) + 1}`;

  return `You are reading a photograph of a University of Cebu "Schedule Data Entry Form".

FORM LAYOUT
- Title block: program name, form title, semester and academic year
- A header line:  COURSE: <code>    YEAR & SECTION: <year> - <letter>
- A table with columns:
  EDP CODE | SUBJECT | TYPE | UNITS | TIME START | TIME END | DAYS | ROOM

CONTEXT FROM THE OPERATOR'S SCREEN (may be blank if they haven't chosen)
- Section: ${section ?? "(not yet chosen)"}
- Term: ${term ?? "(not yet chosen)"} semester, AY ${year ?? "(not yet chosen)"}
- Course code: ${sectionPrefix ?? "(not yet chosen)"}

VALID SUBJECT CODES IN THE CURRICULUM
${subjects.join(", ")}

EXTRACT EVERY DATA ROW. RETURN THIS EXACT JSON SHAPE:
{
  "rows": [
    {
      "edp_code": "61251",
      "subject": "CC-APPSDEV22",
      "type": "LEC",
      "start_time": "09:00",
      "end_time": "10:00",
      "days": "MW",
      "room": "215"
    }
  ],
  "warnings": ["Row 3: EDP code unclear, read as 61281."],
  "detected_section": "BSIT-2A",
  "detected_course": "BSIT",
  "detected_year": 2024,
  "detected_term": 2
}

RULES — FOLLOW ALL OF THEM

1. TYPE is printed as "LEC" or "LAB". Copy as-is.

2. LAB ROWS CARRY AN "L" SUFFIX IN THE SUBJECT COLUMN. This is the
   form's convention, NOT part of the subject code. The suffix may or
   may not have a space before it.
     "CC-APPSDEV22L"    → "CC-APPSDEV22"
     "IT-PLATECH22 L"   → "IT-PLATECH22"
     "CC-DASTRUC21 L"   → "CC-DASTRUC21"
     "CC-DATACOM22L"    → "CC-DATACOM22"
   Strip the trailing "L" (with or without preceding space) ONLY when
   TYPE is "LAB". Then match against the valid codes list. Use the
   matched code exactly as it appears in the list.
   NEVER strip an "L" from a TYPE=LEC row.

3. A LEC row and its LAB counterpart carry the SAME subject code after
   stripping. If a subject has both rows, both must show the same code.

4. Return the subject code exactly as it appears on the form (after the
   LAB L-strip in rule 2). Do NOT substitute, autocorrect, or pick a
   "closest match" from the valid codes list.

   If the code does not appear in the valid list, add a warning naming
   the row and the code you read. The operator decides whether the form
   is wrong, the curriculum is wrong, or the subject has not been added
   yet.

   The ONE exception is glyph-level ambiguity in the printed characters
   themselves — cases where the ink could genuinely be two different
   characters and only one reading matches a valid code:
     O (letter) vs 0 (digit)
     I (letter) vs 1 (digit)
     l (lowercase L) vs 1 (digit)
     S vs 5
     B vs 8
   For these, choose the reading that matches a valid code. If neither
   reading matches, return what you read and warn.

   Do not treat different digits as confusable. "21" and "22" are
   different codes. "AB12" and "AB22" are different codes. Never swap
   a digit or letter to make a code match.

5. TIME START and TIME END are printed in 12-hour format with AM/PM.
   Convert to 24-hour, zero-padded HH:MM:
     "7:30 AM" → "07:30"    "12:00 PM" → "12:00"
     "1:30 PM" → "13:30"    "12:00 AM" → "00:00"
     "6:30 PM" → "18:30"

6. DAYS: copy the string exactly as printed. Uppercase, no spaces.
   The form uses "MW", "TTH", "SAT", "THU" — preserve that convention.
   Do not translate to a different scheme.

7. ROOM: a short identifier, typically 2–4 characters. Copy as printed.

8. EDP CODE: a 5-digit number. Copy exactly, preserving all digits.

9. If a value is illegible or missing, use "" and add a warning naming
   the row number and the column.

10. Skip fully blank rows.

11. Skip the "guide row" if it appears — its EDP CODE starts with "#".

12. Skip any row where DAYS, TIME START, and ROOM are all blank. Those
    mean the subject is not offered this term — the form leaves them
    empty on purpose.

13. Compose detected_section as "<COURSE>-<year><letter>" with no
    spaces around the dash:
      COURSE "BSIT", YEAR & SECTION "2 - A"  →  "BSIT-2A"

14. detected_course is the COURSE value from the header, e.g. "BSIT".

15. If a section was provided above and detected_section does not equal
    it, add a warning. Still return every row.

15b. detected_term is the semester number from the title block:
      "1st Semester" or "First Semester"  → 1
      "2nd Semester" or "Second Semester" → 2
      "Summer" or "Midyear"               → 3
      If unclear, use null.

15c. detected_year is the FIRST year of the academic-year range in
     the title block:
      "2024-2025" → 2024
      "2024–25"   → 2024
     If unclear, use null.

16. If detected_course does not equal "${sectionPrefix}", add a warning.

17. Return ONLY the JSON object. No markdown fences. No commentary.`;
}
