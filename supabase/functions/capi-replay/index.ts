import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { getCorsHeaders } from '../_shared/cors.ts';
import { verifyAdminToken } from '../_shared/auth.ts';
import { getFirebaseAccessToken, FIRESTORE_BASE } from '../_shared/firebase.ts';
import { invokeEdgeFunction, generateEventId } from '../_shared/utils.ts';

/**
 * CAPI Replay — reads paid orders from Firestore and sends Purchase events
 * to Meta CAPI for all orders that haven't been sent yet.
 * Protected by admin auth.
 */

interface OrderDoc {
  id: string;
  fields: Record<string, any>;
}

async function fetchPaidOrders(): Promise<OrderDoc[]> {
  const accessToken = await getFirebaseAccessToken();
  const queryUrl = `${FIRESTORE_BASE}:runQuery`;

  // Query orders with payment_status = 'paid' (this is the actual field used in the system)
  const res = await fetch(queryUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'ordens' }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'payment_status' },
            op: 'EQUAL',
            value: { stringValue: 'paid' },
          },
        },
        limit: 500,
      },
    }),
  });

  if (!res.ok) {
    console.error('❌ Failed to query paid orders:', await res.text());
    return [];
  }

  const results = await res.json();
  return (results || [])
    .filter((r: any) => r.document)
    .map((r: any) => ({
      id: r.document.name.split('/').pop(),
      fields: r.document.fields || {},
    }));
}

async function fetchAlreadySentIds(): Promise<Set<string>> {
  const accessToken = await getFirebaseAccessToken();
  const queryUrl = `${FIRESTORE_BASE}:runQuery`;

  const res = await fetch(queryUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'meta_purchase_events' }],
        select: { fields: [{ fieldPath: '__name__' }] },
        limit: 10000,
      },
    }),
  });

  if (!res.ok) return new Set();
  const results = await res.json();
  const ids = new Set<string>();
  for (const r of (results || [])) {
    if (r.document) ids.add(r.document.name.split('/').pop());
  }
  return ids;
}

async function fetchOrderItems(orderId: string, accessToken: string) {
  const productNames: string[] = [];
  const contentIds: string[] = [];
  const contents: { id: string; quantity: number; item_price?: number }[] = [];
  const categories = new Set<string>();

  try {
    const url = `${FIRESTORE_BASE}/ordens/${orderId}/items?pageSize=50`;
    const res = await fetch(url, { headers: { 'Authorization': `Bearer ${accessToken}` } });
    if (res.ok) {
      const data = await res.json();
      for (const d of (data.documents || [])) {
        const f = d.fields || {};
        if (f.product_name?.stringValue) productNames.push(f.product_name.stringValue);
        const pid = f.product_id?.stringValue;
        if (pid) {
          contentIds.push(pid);
          const qty = Number(f.quantity?.integerValue || 1);
          const price = Number(f.unit_price?.doubleValue || f.unit_price?.integerValue || 0);
          contents.push({ id: pid, quantity: qty, ...(price > 0 ? { item_price: price } : {}) });
        }
        if (f.product_category?.stringValue) categories.add(f.product_category.stringValue);
      }
    }
  } catch {}

  return {
    productNamesList: productNames.length > 0 ? productNames.join(', ') : `Pedido #${orderId.substring(0, 8)}`,
    contentIds,
    contents,
    contentCategory: categories.size > 0 ? [...categories].join(', ') : undefined,
  };
}

function getStr(fields: Record<string, any>, key: string): string | undefined {
  return fields[key]?.stringValue || undefined;
}

function getNum(fields: Record<string, any>, key: string): number {
  return Number(fields[key]?.doubleValue || fields[key]?.integerValue || 0);
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (!corsHeaders) return new Response("Forbidden", { status: 403 });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // Admin auth
  const adminToken = req.headers.get('x-admin-token');
  if (!adminToken || !(await verifyAdminToken(adminToken))) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run === true;

    console.log(`🔄 CAPI Replay started (dry_run=${dryRun})`);

    // 1. Fetch paid orders + already-sent IDs in parallel
    const [orders, alreadySent] = await Promise.all([
      fetchPaidOrders(),
      fetchAlreadySentIds(),
    ]);

    console.log(`📊 Found ${orders.length} paid orders, ${alreadySent.size} already sent`);

    // 2. Filter out already-sent
    const pending = orders.filter(o => !alreadySent.has(o.id));
    console.log(`📤 ${pending.length} orders to replay`);

    if (dryRun) {
      return new Response(JSON.stringify({
        dry_run: true,
        total_paid: orders.length,
        already_sent: alreadySent.size,
        pending_replay: pending.length,
        order_ids: pending.map(o => o.id),
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // 3. Replay — send in sequence to avoid rate limits
    const accessToken = await getFirebaseAccessToken();
    const results: { orderId: string; success: boolean; error?: string }[] = [];

    for (const order of pending) {
      try {
        const f = order.fields;
        const orderId = order.id;
        const orderValue = getNum(f, 'total') || getNum(f, 'value');
        if (orderValue <= 0) {
          results.push({ orderId, success: false, error: 'no value' });
          continue;
        }

        const items = await fetchOrderItems(orderId, accessToken);
        const eventId = generateEventId('Purchase', orderId);
        const nameParts = (getStr(f, 'customer_name') || '').split(' ');

        const payload = {
          event_name: 'Purchase',
          event_id: eventId,
          order_id: orderId,
          value: orderValue,
          currency: 'BRL',
          content_name: items.productNamesList,
          content_category: items.contentCategory || undefined,
          content_ids: items.contentIds.length > 0 ? items.contentIds : undefined,
          contents: items.contents.length > 0 ? items.contents : undefined,
          content_type: 'product',
          email: getStr(f, 'customer_email'),
          phone: getStr(f, 'customer_phone'),
          first_name: nameParts[0] || undefined,
          last_name: nameParts.slice(1).join(' ') || undefined,
          external_id: getStr(f, 'userId'),
          fbc: getStr(f, 'fbc'),
          fbp: getStr(f, 'fbp'),
          event_source_url: getStr(f, 'event_source_url') || 'https://www.valnix.com.br/checkout',
        };

        const res = await invokeEdgeFunction('meta-capi', payload);
        const ok = res?.ok ?? false;
        results.push({ orderId, success: ok });

        if (ok) {
          console.log(`✅ Replayed Purchase for ${orderId}`);
        } else {
          console.warn(`⚠️ Failed replay for ${orderId}: ${res?.status}`);
          results[results.length - 1].error = `status ${res?.status}`;
        }

        // Small delay to avoid rate limiting
        await new Promise(r => setTimeout(r, 200));
      } catch (e) {
        results.push({ orderId: order.id, success: false, error: String(e) });
      }
    }

    const sent = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    console.log(`🏁 CAPI Replay done: ${sent} sent, ${failed} failed`);

    return new Response(JSON.stringify({
      total_completed: orders.length,
      already_sent: alreadySent.size,
      replayed: sent,
      failed,
      details: results,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('❌ CAPI Replay error:', error);
    return new Response(JSON.stringify({ error: String(error) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
