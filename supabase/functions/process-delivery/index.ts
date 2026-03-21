import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { getCorsHeaders } from '../_shared/cors.ts';
import { getFirebaseAccessToken, FIREBASE_PROJECT_ID, FIRESTORE_BASE, verifyFirebaseIdToken } from '../_shared/firebase.ts';
import { getFirestoreDoc, updateFirestoreDoc, queryFirestore } from '../_shared/firestore.ts';
import { verifyAdminToken } from '../_shared/auth.ts';

// ── Throwing wrapper ──
async function updateDocOrThrow(col: string, docId: string, data: Record<string, unknown>) {
  const ok = await updateFirestoreDoc(col, docId, data);
  if (!ok) throw new Error(`Firestore update failed: ${col}/${docId}`);
  return true;
}

async function updateFirestoreArray(col: string, docId: string, fieldPath: string, values: Array<{ stringValue: string }>) {
  const accessToken = await getFirebaseAccessToken();
  const url = `${FIRESTORE_BASE}/${col}/${docId}?updateMask.fieldPaths=${fieldPath}`;
  const response = await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` }, body: JSON.stringify({ fields: { [fieldPath]: { arrayValue: { values } } } }) });
  if (!response.ok) { console.error(`❌ Array update failed for ${col}/${docId}:`, await response.text()); throw new Error(`Array update failed: ${response.status}`); }
}

// ── Per-product lock ──
const LOCK_TTL_MS = 30_000;
async function acquireProductLock(productId: string): Promise<boolean> {
  const accessToken = await getFirebaseAccessToken();
  const lockDoc = await getFirestoreDoc('delivery_locks', productId);
  if (lockDoc?.fields) { const lockTime = lockDoc.fields.locked_at?.stringValue; if (lockTime && (Date.now() - new Date(lockTime).getTime()) < LOCK_TTL_MS) return false; try { await fetch(`${FIRESTORE_BASE}/delivery_locks/${productId}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${accessToken}` } }); } catch {} }
  const createUrl = `${FIRESTORE_BASE}/delivery_locks?documentId=${encodeURIComponent(productId)}`;
  const res = await fetch(createUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` }, body: JSON.stringify({ fields: { locked_at: { stringValue: new Date().toISOString() }, locked_by: { stringValue: 'process-delivery' } } }) });
  if (res.status === 409) { console.log(`🔒 Lock contention for product ${productId}`); return false; }
  if (!res.ok) { console.warn(`⚠️ Lock acquire failed for ${productId}: ${res.status}`); return false; }
  return true;
}
async function releaseProductLock(productId: string): Promise<void> {
  try { const accessToken = await getFirebaseAccessToken(); await fetch(`${FIRESTORE_BASE}/delivery_locks/${productId}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${accessToken}` } }); } catch {}
}

function generateFakeDeliveryCode(category?: string): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const rand = (len: number) => { let r = ''; for (let i = 0; i < len; i++) r += chars.charAt(Math.floor(Math.random() * chars.length)); return r; };
  const cat = (category || '').toLowerCase();
  if (cat.includes('valorant') || cat.includes('vp')) return `RA-${rand(16)}`;
  if (cat.includes('lol') || cat.includes('riot') || cat.includes('league') || cat.includes('rp')) return `RA-${rand(15)}`;
  return `${rand(4)}-${rand(4)}-${rand(4)}-${rand(4)}`;
}

async function isAdmin(uid: string): Promise<boolean> {
  const roleDoc = await getFirestoreDoc('user_roles', uid);
  return roleDoc?.fields?.role?.stringValue === 'admin';
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req, { headers: "authorization, x-client-info, apikey, content-type, x-internal-key, x-delivery-token, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version" });
  if (!corsHeaders) return new Response("Forbidden", { status: 403 });
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    if (req.method !== 'POST') return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    const body = await req.json(); const { orderId } = body;
    if (!orderId) return new Response(JSON.stringify({ success: false, error: 'orderId is required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const internalKey = req.headers.get('x-internal-key'); const expectedInternalKey = Deno.env.get('FLOWPAY_WEBHOOK_SECRET');
    const authHeader = req.headers.get('authorization'); const idToken = authHeader?.replace(/^Bearer\s+/i, '');
    const deliveryToken = req.headers.get('x-delivery-token');
    let authSource = 'none'; let callerUid: string | null = null;
    if (internalKey && internalKey === expectedInternalKey) authSource = 'internal';
    else if (idToken) { const user = await verifyFirebaseIdToken(idToken); if (!user) return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); callerUid = user.uid; authSource = await isAdmin(user.uid) ? 'admin' : 'user'; }
    else if (deliveryToken && deliveryToken.length >= 20) authSource = 'delivery_token';
    if (authSource === 'none') return new Response(JSON.stringify({ success: false, error: 'Authentication required' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const orderDoc = await getFirestoreDoc('ordens', orderId);
    if (!orderDoc?.fields) return new Response(JSON.stringify({ success: false, error: 'Order not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    if (authSource === 'user') { const ouid = orderDoc.fields.user_id?.stringValue; if (!ouid || ouid !== callerUid) { console.warn(`🚫 [${orderId}] User ${callerUid} tried to deliver order owned by ${ouid}`); return new Response(JSON.stringify({ success: false, error: 'Forbidden: not your order' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); } }
    else if (authSource === 'delivery_token') {
      const storedToken = orderDoc.fields.delivery_token?.stringValue;
      if (!storedToken || storedToken !== deliveryToken) { console.warn(`🚫 [${orderId}] Invalid delivery_token attempt`); return new Response(JSON.stringify({ success: false, error: 'Forbidden: invalid delivery token' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }
      const tokenCreatedAt = orderDoc.fields.delivery_token_created_at?.stringValue;
      if (tokenCreatedAt) { const ageMs = Date.now() - new Date(tokenCreatedAt).getTime(); if (ageMs > 10 * 60 * 1000) { console.warn(`🚫 [${orderId}] delivery_token expired`); try { await updateDocOrThrow('ordens', orderId, { delivery_token: null }); } catch {} return new Response(JSON.stringify({ success: false, error: 'Forbidden: delivery token expired' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); } }
      const consumerId = crypto.randomUUID();
      try { await updateDocOrThrow('ordens', orderId, { delivery_token: null, delivery_token_created_at: null, delivery_token_consumer: consumerId }); } catch (consumeErr) { console.error(`❌ [${orderId}] Failed to consume delivery_token`, consumeErr); return new Response(JSON.stringify({ success: false, error: 'Internal error: token consumption failed' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }
      const recheck = await getFirestoreDoc('ordens', orderId);
      if (recheck?.fields?.delivery_token_consumer?.stringValue !== consumerId) { console.warn(`🚫 [${orderId}] delivery_token race lost`); return new Response(JSON.stringify({ success: false, error: 'Forbidden: token claimed by another request' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }
      console.log(`✅ [${orderId}] delivery_token validated, consumed by ${consumerId}`);
    }

    const paymentStatus = orderDoc.fields.payment_status?.stringValue;
    if (paymentStatus !== 'paid') return new Response(JSON.stringify({ success: false, error: 'Order not paid', payment_status: paymentStatus }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const accessToken = await getFirebaseAccessToken();
    const itemsListUrl = `${FIRESTORE_BASE}/ordens/${orderId}/items?pageSize=100`;
    const itemsListRes = await fetch(itemsListUrl, { headers: { 'Authorization': `Bearer ${accessToken}` } });
    const itemsResults = itemsListRes.ok ? (await itemsListRes.json()).documents?.map((doc: any) => ({ document: doc })) || [] : [];
    if (!itemsResults || !Array.isArray(itemsResults) || itemsResults.length === 0) return new Response(JSON.stringify({ success: false, error: 'No order items found' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const results: Array<{ itemId: string; productId: string; status: string; codes?: string }> = [];
    let allDelivered = true; let deliveredCount = 0; let skippedCount = 0; let failedCount = 0;

    for (const result of itemsResults) {
      if (!result.document) continue;
      const itemFields = result.document.fields; const itemId = result.document.name.split('/').pop()!;
      if (itemFields?.delivery_code?.stringValue) { results.push({ itemId, productId: itemFields?.product_id?.stringValue || '', status: 'already_delivered', codes: itemFields.delivery_code.stringValue }); skippedCount++; continue; }
      const productId = itemFields?.product_id?.stringValue;
      if (!productId) { results.push({ itemId, productId: 'unknown', status: 'no_product_id' }); allDelivered = false; failedCount++; continue; }
      const productDoc = await getFirestoreDoc('products', productId);
      if (!productDoc?.fields) { results.push({ itemId, productId, status: 'product_not_found' }); allDelivered = false; failedCount++; continue; }
      const deliveryType = productDoc.fields.delivery_type?.stringValue || 'manual';
      const productCategory = productDoc.fields.category?.stringValue || '';
      const quantity = itemFields?.quantity?.integerValue ? parseInt(itemFields.quantity.integerValue) : 1;

      if (deliveryType === 'auto_fake') {
        const codes: string[] = []; for (let i = 0; i < quantity; i++) codes.push(generateFakeDeliveryCode(productCategory));
        const codeStr = codes.join(',');
        await updateDocOrThrow(`ordens/${orderId}/items`, itemId, { delivery_code: codeStr, delivered_at: new Date().toISOString() });
        results.push({ itemId, productId, status: 'delivered', codes: codeStr }); deliveredCount++;
        console.log(`✅ [${orderId}] auto_fake: ${codes.length} code(s) → item ${itemId}`);
      } else if (deliveryType === 'auto_real') {
        let lockAcquired = false; let retries = 0;
        while (!lockAcquired && retries < 5) { lockAcquired = await acquireProductLock(productId); if (!lockAcquired) { retries++; await new Promise(r => setTimeout(r, 1000 + Math.random() * 1000)); } }
        if (!lockAcquired) { results.push({ itemId, productId, status: 'lock_timeout' }); allDelivered = false; failedCount++; console.error(`❌ [${orderId}] Lock timeout for product ${productId}`); continue; }
        try {
          const codesDoc = await getFirestoreDoc('product_codes', productId);
          const autoCodesArray = codesDoc?.fields?.codes?.arrayValue?.values;
          if (!autoCodesArray || autoCodesArray.length === 0) { results.push({ itemId, productId, status: 'no_codes_available' }); allDelivered = false; failedCount++; continue; }
          const neededCodes = Math.min(quantity, autoCodesArray.length);
          const usedCodes = autoCodesArray.slice(0, neededCodes).map((v: any) => v.stringValue);
          const remainingCodes = autoCodesArray.slice(neededCodes);
          const codeStr = usedCodes.join(',');
          await updateFirestoreArray('product_codes', productId, 'codes', remainingCodes);
          try { await updateDocOrThrow(`ordens/${orderId}/items`, itemId, { delivery_code: codeStr, delivered_at: new Date().toISOString() }); }
          catch (writeErr) { console.error(`❌ [${orderId}] Failed to write delivery_code, compensating...`, writeErr); try { await updateFirestoreArray('product_codes', productId, 'codes', [...usedCodes.map((c: string) => ({ stringValue: c })), ...remainingCodes]); } catch (compErr) { console.error(`🚨 [${orderId}] COMPENSATION FAILED!`, usedCodes, compErr); } results.push({ itemId, productId, status: 'failed' }); allDelivered = false; failedCount++; continue; }
          results.push({ itemId, productId, status: 'delivered', codes: codeStr }); deliveredCount++;
          console.log(`✅ [${orderId}] auto_real: ${usedCodes.length} code(s) → item ${itemId} (${remainingCodes.length} remaining)`);
        } finally { await releaseProductLock(productId); }
      } else { results.push({ itemId, productId, status: 'manual' }); allDelivered = false; }
    }

    const hasItems = results.length > 0; const allItemsHandled = allDelivered && hasItems && failedCount === 0;
    let orderStatus = orderDoc.fields.status?.stringValue || 'processing';
    if (allItemsHandled) { await updateDocOrThrow('ordens', orderId, { status: 'completed', updated_at: new Date().toISOString() }); orderStatus = 'completed'; console.log(`✅ [${orderId}] Order auto-completed`); }

    return new Response(JSON.stringify({ success: true, orderId, orderStatus, deliveredCount, skippedCount, failedCount, items: results }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error: any) {
    const requestId = crypto.randomUUID();
    console.error(`❌ process-delivery error [${requestId}]:`, error);
    return new Response(JSON.stringify({ success: false, error_code: 'INTERNAL_ERROR', request_id: requestId }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
