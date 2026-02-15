import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-firebase-token",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const FIREBASE_PROJECT_ID = "valnix";
const ALLOWED_ADMIN_EMAILS = ["valnix@gmail.com"];

/**
 * Securely verify Firebase ID token using Google Identity Toolkit API.
 * This validates the token signature server-side (not just base64 decode).
 */
async function verifyFirebaseToken(idToken: string): Promise<{ uid: string; email: string } | null> {
  try {
    const FIREBASE_WEB_API_KEY = 'AIzaSyBHpcqUztUdpvoCZpjuobkXuFXO9gEJogw';
    const res = await fetch(
      `https://www.googleapis.com/identitytoolkit/v3/relyingparty/getAccountInfo?key=${FIREBASE_WEB_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      }
    );

    if (!res.ok) {
      console.warn('❌ Firebase token verification failed:', res.status);
      return null;
    }

    const data = await res.json();
    const user = data.users?.[0];
    if (!user?.localId) return null;

    return { uid: user.localId, email: user.email || '' };
  } catch (e) {
    console.warn('❌ Firebase token verification error:', e);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify Firebase auth
    const firebaseToken = req.headers.get("x-firebase-token");
    if (!firebaseToken) {
      return new Response(
        JSON.stringify({ error: "Firebase token required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userData = await verifyFirebaseToken(firebaseToken);
    if (!userData) {
      return new Response(
        JSON.stringify({ error: "Invalid Firebase token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 🔒 Security: Hardcoded admin email check (cannot be bypassed via Firestore)
    if (!ALLOWED_ADMIN_EMAILS.includes(userData.email.toLowerCase())) {
      console.warn(`⚠️ Unauthorized admin attempt: ${userData.email}`);
      return new Response(
        JSON.stringify({ error: "Admin access required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse date range from query params
    const url = new URL(req.url);
    const dateRange = url.searchParams.get("dateRange") || "7d";

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Calculate date filter
    let dateFilter = new Date();
    if (dateRange === "today") {
      dateFilter.setHours(0, 0, 0, 0);
    } else if (dateRange === "7d") {
      dateFilter.setDate(dateFilter.getDate() - 7);
    } else if (dateRange === "30d") {
      dateFilter.setDate(dateFilter.getDate() - 30);
    } else {
      dateFilter = new Date(0);
    }

    const { data: events, error } = await supabase
      .from("analytics_events")
      .select("*")
      .gte("event_time", dateFilter.toISOString())
      .order("event_time", { ascending: false })
      .limit(10000);

    if (error) {
      console.error("Database error:", error);
      return new Response(
        JSON.stringify({ error: "Failed to fetch analytics" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ events: events || [] }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
