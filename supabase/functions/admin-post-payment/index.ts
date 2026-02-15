import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-firebase-token",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
};

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
    const firebaseToken = req.headers.get("x-firebase-token");
    if (!firebaseToken) {
      return new Response(JSON.stringify({ error: "Firebase token required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const userData = await verifyFirebaseToken(firebaseToken);
    if (!userData) {
      return new Response(JSON.stringify({ error: "Invalid Firebase token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 🔒 Security: Hardcoded admin email check (cannot be bypassed via Firestore)
    if (!ALLOWED_ADMIN_EMAILS.includes(userData.email.toLowerCase())) {
      console.warn(`⚠️ Unauthorized admin attempt: ${userData.email}`);
      return new Response(JSON.stringify({ error: "Admin access required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    if (req.method === "GET") {
      const url = new URL(req.url);
      const orderId = url.searchParams.get("orderId");

      // If orderId provided, fetch addons for that order
      if (orderId) {
        const { data: addons } = await supabase
          .from("sale_addons")
          .select("*")
          .eq("order_id", orderId);

        return new Response(JSON.stringify({ addons: addons || [] }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const { data, error } = await supabase
        .from("post_payment_pages")
        .select("*")
        .order("display_order");

      if (error) {
        return new Response(JSON.stringify({ error: error.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const { data: addons } = await supabase.from("sale_addons").select("addon_type, status, amount");

      return new Response(JSON.stringify({ pages: data || [], addons: addons || [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (req.method === "PUT") {
      const body = await req.json();
      const { id, ...updates } = body;

      if (!id) {
        return new Response(JSON.stringify({ error: "Page ID required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const { error } = await supabase
        .from("post_payment_pages")
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq("id", id);

      if (error) {
        return new Response(JSON.stringify({ error: error.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      return new Response(JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
