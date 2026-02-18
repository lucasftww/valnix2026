import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { getCorsHeaders } from '../_shared/cors.ts';
import { getFirebaseAccessToken, FIREBASE_PROJECT_ID, FIRESTORE_BASE } from '../_shared/firebase.ts';
import { parsePublicIp } from '../_shared/utils.ts';

// ── Firestore-backed atomic rate limiter (windowed) ──
async function checkRateLimitFirestore(key: string, maxAttempts: number, windowMs: number, blockMs: number, accessToken: string): Promise<boolean> {
  const docId = key.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 60);
  const docPath = `projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/rate_limits/guest_order_${docId}`;
  const commitUrl = `${FIRESTORE_BASE}:commit`;
  const docUrl = `${FIRESTORE_BASE}/rate_limits/guest_order_${docId}`;
  const now = Date.now();

  try {
    const existingRes = await fetch(docUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
    let count = 0, resetAt = 0, blockedUntil = 0;
    if (existingRes.ok) {
      const existing = await existingRes.json();
      const f = existing.fields || {};
      count = Number(f.count?.integerValue || "0");
      resetAt = Number(f.reset_at?.integerValue || "0");
      blockedUntil = Number(f.blocked_until?.integerValue || "0");
    } else { await existingRes.text(); }

    if (blockedUntil > now) return false;
    if (resetAt <= now) {
      const res = await fetch(commitUrl, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ writes: [{ update: { name: docPath, fields: { key: { stringValue: key }, count: { integerValue: "1" }, reset_at: { integerValue: String(now + windowMs) }, blocked_until: { integerValue: "0" }, updated_at: { timestampValue: new Date().toISOString() } } } }] }) });
      await res.text();
      return true;
    }

    const commitRes = await fetch(commitUrl, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ writes: [ { update: { name: docPath, fields: { key: { stringValue: key }, reset_at: { integerValue: String(resetAt) }, updated_at: { timestampValue: new Date().toISOString() } } }, updateMask: { fieldPaths: ["key", "reset_at", "updated_at"] }, currentDocument: { exists: true } }, { transform: { document: docPath, fieldTransforms: [{ fieldPath: "count", increment: { integerValue: "1" } }] } } ] }) });
    await commitRes.text();
    if (!commitRes.ok) return true;

    if (count + 1 >= maxAttempts - 2) {
      const verifyRes = await fetch(docUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (verifyRes.ok) {
        const verifyData = await verifyRes.json();
        const realCount = Number(verifyData.fields?.count?.integerValue || "0");
        if (realCount > maxAttempts) {
          const blockUntilMs = now + blockMs;
          const blockRes = await fetch(commitUrl, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ writes: [{ update: { name: docPath, fields: { blocked_until: { integerValue: String(blockUntilMs) }, count: { integerValue: "0" } } }, updateMask: { fieldPaths: ["blocked_until", "count"] }, currentDocument: { exists: true } }] }) });
          await blockRes.text();
          const logUrl = `${FIRESTORE_BASE}/rate_limit_logs`;
          const logRes = await fetch(logUrl, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ fields: { function_name: { stringValue: "guest-order" }, key: { stringValue: key }, ip: { stringValue: key }, blocked_until_ms: { integerValue: String(blockUntilMs) }, created_at: { timestampValue: new Date().toISOString() } } }) });
          await logRes.text();
          return false;
        }
      } else { await verifyRes.text(); }
    }
    return true;
  } catch (e) { console.warn("Rate limit failed (allowing):", e); return true; }
}

function readIsoTimestamp(field: any): string | null {
  if (!field) return null;
  return field.timestampValue || field.stringValue || null;
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (!corsHeaders) return new Response("Forbidden", { status: 403 });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' };

  try {
    let hash: string | null = null;
    if (req.method === 'GET') { const url = new URL(req.url); hash = url.searchParams.get('hash'); }
    else { const body = await req.json(); hash = body.hash || null; }

    if (!hash || typeof hash !== 'string' || !/^[A-Za-z0-9]{12,32}$/.test(hash)) {
      return new Response(JSON.stringify({ error: 'Invalid hash' }), { status: 400, headers: jsonHeaders });
    }

    const accessToken = await getFirebaseAccessToken();
    const raw = req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") || undefined;
    const clientIp = parsePublicIp(raw);
    const allowed = await checkRateLimitFirestore(clientIp, 30, 60_000, 300_000, accessToken);
    if (!allowed) return new Response(JSON.stringify({ error: 'Too many requests' }), { status: 429, headers: jsonHeaders });

    const queryUrl = `${FIRESTORE_BASE}:runQuery`;
    const queryRes = await fetch(queryUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` }, body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'ordens' }], where: { fieldFilter: { field: { fieldPath: 'hash' }, op: 'EQUAL', value: { stringValue: hash } } }, limit: 1 } }) });
    if (!queryRes.ok) { await queryRes.text(); return new Response(JSON.stringify({ error: 'Order not found' }), { status: 404, headers: jsonHeaders }); }

    const queryResults = await queryRes.json();
    const matchedDoc = Array.isArray(queryResults) ? queryResults.find((r: any) => r.document) : null;
    if (!matchedDoc?.document) return new Response(JSON.stringify({ error: 'Order not found' }), { status: 404, headers: jsonHeaders });

    const fields = matchedDoc.document.fields || {};
    const orderId = matchedDoc.document.name.split('/').pop()!;
    const expiresIso = readIsoTimestamp(fields.expires_at);
    if (expiresIso && new Date(expiresIso).getTime() < Date.now()) return new Response(JSON.stringify({ error: 'Order expired' }), { status: 410, headers: jsonHeaders });

    const listUrl = `${FIRESTORE_BASE}/ordens/${orderId}/items?pageSize=50`;
    const itemsRes = await fetch(listUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
    const items: Array<{ product_name: string; product_image: string | null; quantity: number; unit_price: number; total_price: number; delivery_code: string | null }> = [];
    if (itemsRes.ok) {
      const itemsData = await itemsRes.json();
      for (const itemDoc of (itemsData.documents || [])) {
        const f = itemDoc.fields || {};
        items.push({ product_name: f.product_name?.stringValue || '', product_image: f.product_image?.stringValue || null, quantity: Number(f.quantity?.integerValue || f.quantity?.doubleValue || 1), unit_price: Number(f.unit_price?.doubleValue || f.unit_price?.integerValue || 0), total_price: Number(f.total_price?.doubleValue || f.total_price?.integerValue || 0), delivery_code: f.delivery_code?.stringValue || null });
      }
    } else { const errText = await itemsRes.text(); console.warn(`⚠️ Failed to list items: ${itemsRes.status} ${errText.slice(0, 200)}`); }

    const response = {
      order_id: orderId, email: fields.customer_email?.stringValue || fields.email?.stringValue || null,
      customer_name: fields.customer_name?.stringValue || null, customer_phone: fields.customer_phone?.stringValue || null,
      total_amount: Number(fields.total_amount?.doubleValue || fields.total_amount?.integerValue || 0),
      payment_method: fields.payment_method?.stringValue || 'pix', created_at: readIsoTimestamp(fields.created_at),
      expires_at: expiresIso, linked: fields.linked?.booleanValue ?? false, items,
    };
    return new Response(JSON.stringify(response), { status: 200, headers: { ...jsonHeaders, 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('❌ guest-order error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
