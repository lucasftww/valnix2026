import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { getCorsHeaders } from '../_shared/cors.ts';
import { getFirebaseAccessToken, FIREBASE_PROJECT_ID } from '../_shared/firebase.ts';
import { verifyAdminToken } from '../_shared/auth.ts';
import { createInMemoryRateLimiter } from '../_shared/rate-limit.ts';

const rateLimiter = createInMemoryRateLimiter({ max: 20, windowMs: 60_000, blockMs: 120_000 });

// ── Firestore query with date filter ───────────────────────────────
async function queryAnalyticsEvents(dateFilter: Date) {
  const accessToken = await getFirebaseAccessToken();
  const queryUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents:runQuery`;

  const res = await fetch(queryUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'analytics_events' }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'event_time' },
            op: 'GREATER_THAN_OR_EQUAL',
            value: { stringValue: dateFilter.toISOString() },
          },
        },
        orderBy: [{ field: { fieldPath: 'event_time' }, direction: 'DESCENDING' }],
        limit: 10000,
      },
    }),
  });

  if (!res.ok) {
    console.error('❌ Firestore query failed:', await res.text());
    return [];
  }

  const results = await res.json();
  if (!Array.isArray(results)) return [];

  return results
    .filter((r: any) => r.document)
    .map((r: any) => {
      const f = r.document.fields;
      return {
        id: r.document.name.split('/').pop(),
        event_name: f?.event_name?.stringValue || '',
        event_time: f?.event_time?.stringValue || '',
        user_id: f?.user_id?.stringValue || null,
        page_url: f?.page_url?.stringValue || null,
        device_type: f?.device_type?.stringValue || null,
        browser: f?.browser?.stringValue || null,
        value: f?.value?.doubleValue ?? f?.value?.integerValue ?? null,
        currency: f?.currency?.stringValue || null,
        order_id: f?.order_id?.stringValue || null,
        content_name: f?.content_name?.stringValue || null,
        content_category: f?.content_category?.stringValue || null,
      };
    });
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req, { headers: "authorization, x-client-info, apikey, content-type, x-admin-token" });
  if (!corsHeaders) return new Response("Forbidden", { status: 403 });
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  rateLimiter.maybeCleanup();
  const rl = rateLimiter.check(clientIp);
  if (!rl.allowed) {
    console.warn(`🚫 Rate limited admin-analytics: ip=${clientIp}`);
    return new Response(JSON.stringify({ error: "Too many requests" }),
      { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": String(rl.retryAfter || 120) } });
  }

  try {
    const adminToken = req.headers.get("x-admin-token");
    if (!adminToken) {
      return new Response(JSON.stringify({ error: "Admin token required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const isValid = await verifyAdminToken(adminToken);
    if (!isValid) {
      return new Response(JSON.stringify({ error: "Invalid or expired admin token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const url = new URL(req.url);
    const dateRange = url.searchParams.get("dateRange") || "7d";

    let dateFilter = new Date();
    if (dateRange === "today") dateFilter.setHours(0, 0, 0, 0);
    else if (dateRange === "7d") dateFilter.setDate(dateFilter.getDate() - 7);
    else if (dateRange === "30d") dateFilter.setDate(dateFilter.getDate() - 30);
    else dateFilter = new Date(0);

    const events = await queryAnalyticsEvents(dateFilter);

    return new Response(JSON.stringify({ events }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...getCorsHeaders(req, { headers: "authorization, x-client-info, apikey, content-type, x-admin-token" }), "Content-Type": "application/json" } });
  }
});
