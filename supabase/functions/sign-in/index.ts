// sign-in
//
// The only way an ID (uc-1234567, EMP-00123) becomes a session.
//
// Before this function the browser called the database function
// resolve_login_identifier, which RETURNED THE ACCOUNT'S EMAIL to anyone holding
// the public API key. Anyone could harvest emails and learn which IDs exist.
// Now the lookup happens here, with the service role, and the caller only ever
// gets a session or the same generic failure. The email is never sent back.
//
// Body: { identifier, password }
//   identifier: school email, uc-<digits> (students) or EMP-<id> (staff)
// Returns 200 { session: { access_token, refresh_token, expires_in, expires_at,
//                          token_type } }
//         401 { error: "Invalid username or password." }   (any failure at all)
//         429 { error: "Too many attempts. Try again later." }
//
// Which login page a person may use is still decided by the page and by the
// role check after sign-in (resolveRole); this only proves who they are.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

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

const GENERIC_FAIL = "Invalid username or password.";
const fail = () => json(401, { error: GENERIC_FAIL });

const MAX_IDENTIFIER = 254; // longest valid email address
const MAX_PASSWORD = 72;    // bcrypt reads no more than this

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STUDENT_ID = /^uc-\d{1,7}$/i;
const STAFF_ID = /^emp-[a-z0-9]{1,10}$/i;

// Used when an ID matches no account, so an unknown ID still costs one real
// password check and cannot be told apart by how long the answer takes.
const DECOY_EMAIL = "no-such-account@invalid.example";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed." });

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const anon = Deno.env.get("SUPABASE_ANON_KEY");
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !anon || !service) {
      console.error("sign-in: SUPABASE_URL / ANON / SERVICE_ROLE key not set.");
      return json(500, { error: "Server is not configured." });
    }

    let body: any = null;
    try { body = await req.json(); } catch { /* handled below */ }

    const identifier = typeof body?.identifier === "string" ? body.identifier.trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";

    if (!identifier || !password) return fail();
    if (identifier.length > MAX_IDENTIFIER || password.length > MAX_PASSWORD) return fail();

    const isEmail = EMAIL.test(identifier);
    if (!isEmail && !STUDENT_ID.test(identifier) && !STAFF_ID.test(identifier)) return fail();

    let email = isEmail ? identifier : DECOY_EMAIL;

    if (!isEmail) {
      const admin = createClient(url, service, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data, error } = await admin.rpc("resolve_login_identifier", { identifier });
      if (error) {
        console.error("sign-in: lookup failed:", error.message);
        return fail();
      }
      if (typeof data === "string" && data) email = data;
    }

    const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: anon, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (res.status === 429) {
      return json(429, { error: "Too many attempts. Try again later." });
    }
    if (!res.ok) return fail();

    const s = await res.json();
    if (!s?.access_token || !s?.refresh_token) return fail();

    return json(200, {
      session: {
        access_token: s.access_token,
        refresh_token: s.refresh_token,
        expires_in: s.expires_in,
        expires_at: s.expires_at,
        token_type: s.token_type,
      },
    });
  } catch (err) {
    console.error("sign-in: unexpected error:", err instanceof Error ? err.message : err);
    return fail();
  }
});
