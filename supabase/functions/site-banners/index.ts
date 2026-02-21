import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { getCorsHeaders } from '../_shared/cors.ts';
import { getFirebaseAccessToken, FIREBASE_PROJECT_ID } from '../_shared/firebase.ts';

const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;

function extractFields(fields: any): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, val] of Object.entries(fields || {})) {
    const v = val as any;
    if (v.stringValue !== undefined) result[key] = v.stringValue;
    else if (v.integerValue !== undefined) result[key] = Number(v.integerValue);
    else if (v.doubleValue !== undefined) result[key] = v.doubleValue;
    else if (v.booleanValue !== undefined) result[key] = v.booleanValue;
    else if (v.nullValue !== undefined) result[key] = null;
    else if (v.arrayValue) result[key] = (v.arrayValue.values || []).map((item: any) => {
      if (item.stringValue !== undefined) return item.stringValue;
      if (item.mapValue) return extractFields(item.mapValue.fields);
      return null;
    });
    else if (v.mapValue) result[key] = extractFields(v.mapValue.fields);
  }
  return result;
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req, { headers: "content-type, apikey, authorization, x-client-info", methods: "GET, OPTIONS" });
  if (!corsHeaders) return new Response("Forbidden", { status: 403 });
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const accessToken = await getFirebaseAccessToken();
    const queryUrl = `${FIRESTORE_BASE}:runQuery`;
    const res = await fetch(queryUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'banners' }],
          where: { fieldFilter: { field: { fieldPath: 'is_active' }, op: 'EQUAL', value: { booleanValue: true } } },
          orderBy: [{ field: { fieldPath: 'display_order' }, direction: 'ASCENDING' }],
          limit: 20,
        },
      }),
    });

    if (!res.ok) {
      return new Response(JSON.stringify({ banners: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results = await res.json();
    const banners = Array.isArray(results)
      ? results.filter((r: any) => r.document).map((r: any) => ({
          id: r.document.name.split('/').pop(),
          ...extractFields(r.document.fields),
        }))
      : [];

    return new Response(JSON.stringify({ banners }), {
      headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "public, max-age=120, s-maxage=300" },
    });
  } catch (error) {
    console.error("site-banners error:", error);
    return new Response(JSON.stringify({ banners: [] }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
