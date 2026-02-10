import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const FLOWPAY_BASE_URL = 'https://flowpayments.net/api/pix';
const FIREBASE_PROJECT_ID = 'valnix-a2755';
const UTMIFY_PIXEL_ID = '6983b13f961e629ed63fae7a';
const UTMIFY_API_URL = 'https://tracking.utmify.com.br/tracking/v1/events';

// Helper: Update Firestore document via REST API
async function updateFirestoreDoc(collection: string, docId: string, fields: Record<string, unknown>) {
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${collection}/${docId}?updateMask.fieldPaths=${Object.keys(fields).join('&updateMask.fieldPaths=')}`;
  
  const firestoreFields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === 'string') {
      firestoreFields[key] = { stringValue: value };
    } else if (typeof value === 'number') {
      firestoreFields[key] = { doubleValue: value };
    } else if (typeof value === 'boolean') {
      firestoreFields[key] = { booleanValue: value };
    }
  }

  const response = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: firestoreFields }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`❌ Firestore update failed for ${collection}/${docId}:`, errorText);
    throw new Error(`Firestore update failed: ${response.status}`);
  }

  console.log(`✅ Firestore ${collection}/${docId} updated successfully`);
  return true;
}

// Helper: Get Firestore document
async function getFirestoreDoc(collection: string, docId: string) {
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${collection}/${docId}`;
  const response = await fetch(url);
  
  if (!response.ok) return null;
  
  const data = await response.json();
  return data.fields || null;
}

// Helper: Query Firestore collection
async function queryFirestore(collectionId: string, fieldPath: string, op: string, value: string) {
  const queryUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents:runQuery`;
  const response = await fetch(queryUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId }],
        where: {
          fieldFilter: {
            field: { fieldPath },
            op,
            value: { stringValue: value },
          },
        },
      },
    }),
  });

  const results = await response.json();
  return results;
}

// Generate random delivery code XXXX-XXXX-XXXX-XXXX
function generateFakeDeliveryCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 16; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
    if ((i + 1) % 4 === 0 && i < 15) result += '-';
  }
  return result;
}

// Process auto-delivery for order items after payment confirmation
async function processAutoDelivery(orderId: string) {
  console.log(`🔄 Processing auto-delivery for order ${orderId}`);
  
  // Get all order items for this order
  const itemsResults = await queryFirestore('order_items', 'order_id', 'EQUAL', orderId);
  
  if (!itemsResults || !Array.isArray(itemsResults)) {
    console.log(`ℹ️ No order items found for order ${orderId}`);
    return;
  }

  let allDelivered = true;

  for (const result of itemsResults) {
    if (!result.document) continue;
    
    const itemFields = result.document.fields;
    const itemId = result.document.name.split('/').pop();
    
    // Skip if already has delivery code
    if (itemFields?.delivery_code?.stringValue) {
      console.log(`ℹ️ Item ${itemId} already has delivery code`);
      continue;
    }
    
    const productId = itemFields?.product_id?.stringValue;
    if (!productId) {
      allDelivered = false;
      continue;
    }

    // Get product delivery info
    const productFields = await getFirestoreDoc('products', productId);
    if (!productFields) {
      allDelivered = false;
      continue;
    }

    const deliveryType = productFields?.delivery_type?.stringValue || 'manual';
    const quantity = itemFields?.quantity?.integerValue ? parseInt(itemFields.quantity.integerValue) : 1;

    if (deliveryType === 'auto_fake') {
      // Generate fake codes
      const codes: string[] = [];
      for (let i = 0; i < quantity; i++) {
        codes.push(generateFakeDeliveryCode());
      }
      const deliveryCode = codes.join(',');
      
      await updateFirestoreDoc('order_items', itemId!, { delivery_code: deliveryCode });
      console.log(`✅ Auto-generated ${codes.length} fake code(s) for item ${itemId}`);
    } else if (deliveryType === 'auto_real') {
      // Use pre-configured codes from product
      const autoCodesArray = productFields?.auto_delivery_codes?.arrayValue?.values;
      if (autoCodesArray && autoCodesArray.length > 0) {
        const neededCodes = Math.min(quantity, autoCodesArray.length);
        const codes = autoCodesArray.slice(0, neededCodes).map((v: any) => v.stringValue);
        const deliveryCode = codes.join(',');
        
        await updateFirestoreDoc('order_items', itemId!, { delivery_code: deliveryCode });
        
        // Remove used codes from product (update remaining codes)
        const remainingCodes = autoCodesArray.slice(neededCodes);
        const updateUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/products/${productId}?updateMask.fieldPaths=auto_delivery_codes`;
        await fetch(updateUrl, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fields: {
              auto_delivery_codes: {
                arrayValue: { values: remainingCodes }
              }
            }
          }),
        });
        
        console.log(`✅ Assigned ${codes.length} real code(s) for item ${itemId}`);
      } else {
        allDelivered = false;
        console.warn(`⚠️ No auto_delivery_codes available for product ${productId}`);
      }
    } else {
      // Manual delivery - skip
      allDelivered = false;
    }
  }

  // If all items have been auto-delivered, mark order as completed
  if (allDelivered) {
    await updateFirestoreDoc('orders', orderId, {
      status: 'completed',
      updated_at: new Date().toISOString(),
    });
    console.log(`✅ Order ${orderId} auto-completed (all items delivered)`);
  }
}

// Track Purchase event on UTMify (server-side, with persistent dedupe)
async function trackUTMifyPurchase(orderId: string, value: number, clientIp?: string | null, customerEmail?: string) {
  const LOCK_TTL_SECONDS = 30;
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supa = createClient(supabaseUrl, serviceRoleKey);

  const dedupeKey = `Purchase_${orderId}`;

  try {
    // 1. Check existing state in dedupe table
    const { data: existing } = await supa
      .from('utmify_event_log')
      .select('status, locked_at, attempt_count')
      .eq('event_id', dedupeKey)
      .maybeSingle();

    // Already sent → skip
    if (existing?.status === 'sent') {
      console.log(`⏭️ UTMify Purchase already sent for ${orderId}, skipping`);
      return;
    }

    // Pending + locked recently → someone else is sending
    if (existing?.status === 'pending' && existing.locked_at) {
      const lockedAge = (Date.now() - new Date(existing.locked_at).getTime()) / 1000;
      if (lockedAge < LOCK_TTL_SECONDS) {
        console.log(`🔒 UTMify Purchase locked for ${orderId}, skipping`);
        return;
      }
    }

    if (!existing) {
      // New → insert as pending + locked
      const { error: insertError } = await supa
        .from('utmify_event_log')
        .insert({
          event_id: dedupeKey,
          event_type: 'Purchase',
          order_id: orderId,
          status: 'pending',
          locked_at: new Date().toISOString(),
          attempt_count: 1,
        });

      if (insertError && insertError.code !== '23505') {
        console.warn('⚠️ Dedupe INSERT error:', insertError.message);
      }

      // 23505 (unique violation) → recheck status instead of silent skip
      if (insertError?.code === '23505') {
        const { data: recheck } = await supa
          .from('utmify_event_log')
          .select('status, locked_at, attempt_count')
          .eq('event_id', dedupeKey)
          .maybeSingle();

        if (recheck?.status === 'sent') {
          console.log(`⏭️ UTMify Purchase already sent (after race) for ${orderId}`);
          return;
        }

        // If pending with active lock → in_flight
        if (recheck?.status === 'pending' && recheck.locked_at) {
          const lockedAge = (Date.now() - new Date(recheck.locked_at).getTime()) / 1000;
          if (lockedAge < LOCK_TTL_SECONDS) {
            console.log(`🔒 UTMify Purchase in_flight (after race) for ${orderId}`);
            return;
          }
        }

        // Pending with expired lock → try to acquire lock and continue
        if (recheck?.status === 'pending') {
          const lockThreshold = new Date(Date.now() - LOCK_TTL_SECONDS * 1000).toISOString();
          const { data: locked } = await supa
            .from('utmify_event_log')
            .update({
              locked_at: new Date().toISOString(),
              attempt_count: (recheck.attempt_count || 0) + 1,
            })
            .eq('event_id', dedupeKey)
            .eq('status', 'pending')
            .or(`locked_at.is.null,locked_at.lt.${lockThreshold}`)
            .select('event_id')
            .maybeSingle();

          if (!locked) {
            console.log(`⚡ UTMify lock race (after 23505) for ${orderId}, skipping`);
            return;
          }
          // Lock acquired, continue to send
        } else {
          console.log(`⚡ UTMify dedupe race for ${orderId}, status: ${recheck?.status}, skipping`);
          return;
        }
      }
    } else {
      // Existing pending (lock expired) → acquire lock atomically
      const lockThreshold = new Date(Date.now() - LOCK_TTL_SECONDS * 1000).toISOString();
      const { data: locked } = await supa
        .from('utmify_event_log')
        .update({
          locked_at: new Date().toISOString(),
          attempt_count: (existing.attempt_count || 0) + 1,
        })
        .eq('event_id', dedupeKey)
        .eq('status', 'pending')
        .or(`locked_at.is.null,locked_at.lt.${lockThreshold}`)
        .select('event_id')
        .maybeSingle();

      if (!locked) {
        console.log(`⚡ UTMify lock race for ${orderId}, skipping`);
        return;
      }
    }

    // 2. Send to UTMify API
    const payload = {
      type: 'Purchase',
      eventId: dedupeKey,
      lead: {
        pixelId: UTMIFY_PIXEL_ID,
        userAgent: 'server-side/webhook',
        ip: clientIp || null,
        parameters: '',
        icTextMatch: null,
        icCSSMatch: '.utmify-checkout',
        icURLMatch: null,
        leadTextMatch: null,
        addToCartTextMatch: null,
      },
      event: {
        sourceUrl: 'https://valnix2026.lovable.app/checkout',
        pageTitle: 'Checkout - Valnix',
        value,
        currency: 'BRL',
        orderId,
      },
      tikTokPageInfo: null,
    };

    const response = await fetch(UTMIFY_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const responseText = await response.text();

    // 3. Update dedupe status
    if (response.ok) {
      await supa
        .from('utmify_event_log')
        .update({ status: 'sent', locked_at: null, updated_at: new Date().toISOString() })
        .eq('event_id', dedupeKey);
      console.log(`📊 UTMify Purchase sent server-side for order ${orderId}`);
    } else {
      await supa
        .from('utmify_event_log')
        .update({ locked_at: null, last_error: `HTTP ${response.status}: ${responseText.slice(0, 200)}` })
        .eq('event_id', dedupeKey);
      console.warn(`⚠️ UTMify API returned ${response.status}: ${responseText.slice(0, 100)}`);
    }
  } catch (error) {
    console.warn('⚠️ UTMify server-side tracking failed:', error);
  }
}

// Register Purchase event in Supabase analytics_events table
async function registerAnalyticsEvent(orderId: string, value: number, userId?: string, customerEmail?: string) {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    await supabase.from('analytics_events').insert({
      event_name: 'Purchase',
      event_time: new Date().toISOString(),
      user_id: userId || null,
      value,
      currency: 'BRL',
      order_id: orderId,
      page_url: 'https://valnix2026.lovable.app/checkout',
      content_name: `Pedido #${orderId.substring(0, 8)}`,
    });

    console.log(`📊 Analytics Purchase event registered for order ${orderId}`);
  } catch (error) {
    console.warn('⚠️ Analytics event registration failed:', error);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const apiKey = Deno.env.get('FLOWPAY_API_KEY');

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get('action');

    // ==================== WEBHOOK (from FlowPay) ====================
    if (req.method === 'POST' && action === 'webhook') {
      console.log('🔔 FlowPay webhook received');
      
      // Capture client IP from webhook request for UTMify match quality
      const webhookClientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
        || req.headers.get('cf-connecting-ip')
        || req.headers.get('x-real-ip')
        || null;
      console.log('🔔 Headers:', JSON.stringify(Object.fromEntries(req.headers.entries())));

      // Validate webhook secret - STRICT enforcement
      const webhookSecret = Deno.env.get('FLOWPAY_WEBHOOK_SECRET');
      if (!webhookSecret) {
        console.error('❌ FLOWPAY_WEBHOOK_SECRET not configured - rejecting webhook for security');
        return new Response(
          JSON.stringify({ error: 'Webhook authentication not configured' }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const receivedSecret = req.headers.get('x-webhook-secret') 
        || req.headers.get('x-secret')
        || req.headers.get('authorization')?.replace('Bearer ', '')
        || req.headers.get('x-api-key');
      
      if (receivedSecret !== webhookSecret) {
        console.error('❌ Invalid webhook secret - rejecting request');
        return new Response(
          JSON.stringify({ error: 'Invalid webhook authentication' }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        );
      }
      console.log('✅ Webhook secret validated');

      const body = await req.json();
      console.log('🔔 Webhook payload:', JSON.stringify(body));

      const event = body.event || body.type || body.status;
      const chargeData = body.data || body.charge || body;

      // Accept multiple event names for payment confirmation
      const paidEvents = ['pix.received', 'charge.paid', 'COMPLETED', 'paid', 'approved', 'pix_paid'];
      const isPaidEvent = paidEvents.includes(event) || 
                          chargeData?.status === 'COMPLETED' || 
                          chargeData?.status === 'paid';
      
      if (!isPaidEvent) {
        console.log(`ℹ️ Ignoring webhook event: ${event}, chargeStatus: ${chargeData?.status}`);
        return new Response(JSON.stringify({ success: true, message: 'Event ignored' }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const chargeId = chargeData.chargeId || chargeData.id;
      const paidValue = chargeData.value;

      if (!chargeId) {
        console.error('❌ Missing chargeId in webhook payload');
        return new Response(JSON.stringify({ error: 'Missing chargeId' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      console.log(`💰 Payment confirmed for charge: ${chargeId}, value: ${paidValue}`);

      // Find the order linked to this chargeId in Firestore
      const queryResults = await queryFirestore('orders', 'flowpay_charge_id', 'EQUAL', chargeId);
      
      if (!queryResults || !queryResults[0]?.document) {
        console.error(`❌ No order found for chargeId: ${chargeId}`);
        return new Response(JSON.stringify({ error: 'Order not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const orderDoc = queryResults[0].document;
      const orderPath = orderDoc.name;
      const orderId = orderPath.split('/').pop();
      const orderFields = orderDoc.fields;

      console.log(`📦 Found order: ${orderId}, current status: ${orderFields?.payment_status?.stringValue}`);

      // Skip if already paid
      if (orderFields?.payment_status?.stringValue === 'paid') {
        console.log(`ℹ️ Order ${orderId} already paid, skipping`);
        return new Response(JSON.stringify({ success: true, message: 'Already processed' }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Extract order data for tracking
      const orderValue = orderFields?.total_amount?.doubleValue || orderFields?.total_amount?.integerValue || (paidValue ? paidValue / 100 : 0);
      const customerEmail = orderFields?.customer_email?.stringValue;
      const userId = orderFields?.user_id?.stringValue;

      // Update order status to paid - determine status based on delivery type
      // First mark as paid + processing, auto-delivery will update to completed if all items are auto-delivered
      await updateFirestoreDoc('orders', orderId!, {
        payment_status: 'paid',
        status: 'processing',
        updated_at: new Date().toISOString(),
      });

      console.log(`✅ Order ${orderId} marked as paid via webhook`);

      // Process auto-delivery for eligible products
      try {
        await processAutoDelivery(orderId!);
      } catch (deliveryError) {
        console.error(`⚠️ Auto-delivery failed for order ${orderId}:`, deliveryError);
        // Don't fail the webhook - order is still paid
      }

      // Track Purchase event on UTMify (server-side)
      try {
        await trackUTMifyPurchase(orderId!, orderValue, webhookClientIp, customerEmail);
      } catch (trackError) {
        console.warn('⚠️ UTMify tracking failed:', trackError);
      }

      // Register Purchase in analytics_events (Supabase)
      try {
        await registerAnalyticsEvent(orderId!, orderValue, userId, customerEmail);
      } catch (analyticsError) {
        console.warn('⚠️ Analytics registration failed:', analyticsError);
      }

      return new Response(JSON.stringify({ success: true, orderId }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // ==================== CREATE PIX CHARGE ====================
    if (req.method === 'POST' && action === 'create') {
      if (!apiKey) {
        console.error('❌ FLOWPAY_API_KEY not configured');
        return new Response(JSON.stringify({ error: 'Payment gateway not configured' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const body = await req.json();
      const { orderId, customer } = body;
      let { amount } = body;

      if (!orderId) {
        return new Response(JSON.stringify({ error: 'orderId is required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Server-side amount validation: verify against Firestore order data
      const isUpsell = orderId.startsWith('upsell-');
      
      if (!isUpsell) {
        // Regular order: fetch from Firestore and use server-side amount
        const orderFields = await getFirestoreDoc('orders', orderId);
        if (!orderFields) {
          console.error(`❌ Order not found: ${orderId}`);
          return new Response(JSON.stringify({ error: 'Order not found' }), {
            status: 404,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const serverAmount = orderFields.total_amount?.doubleValue 
          || orderFields.total_amount?.integerValue 
          || 0;
        const serverAmountCents = Math.round(Number(serverAmount) * 100);

        if (serverAmountCents < 100) {
          return new Response(JSON.stringify({ error: 'Order amount too low' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Use server-verified amount, ignore client-provided amount
        amount = serverAmountCents;
        console.log(`🔒 Server-verified amount: ${amount} cents (order ${orderId})`);
      } else {
        // Upsell: validate amount from post_payment_pages config
        if (!amount || amount < 100) {
          return new Response(JSON.stringify({ error: 'Amount must be at least 100 (R$ 1,00)' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        console.log(`🔵 Upsell charge: ${amount} cents (${orderId})`);
      }

      // Strip emojis and special chars from description to avoid FlowPay rejection
      const rawDesc = body.description || `Pedido ${orderId || 'Valnix'}`;
      const description = rawDesc.replace(/[\u{1F600}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F000}-\u{1FFFF}\u{E0020}-\u{E007F}#:]/gu, '').trim() || `Pedido ${orderId}`;

      console.log('🔵 Creating FlowPay PIX charge:', { amount, orderId });

      const response = await fetch(`${FLOWPAY_BASE_URL}/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify({
          value: amount,
          description: description || `Pedido ${orderId}`,
          expiresIn: 900,
          customer: customer || undefined,
        }),
      });

      const data = await response.json();
      console.log('🟢 FlowPay create response:', { success: data.success, chargeId: data.charge?.id, status: response.status });

      if (!response.ok || !data.success) {
        console.error('❌ FlowPay create error:', data);
        return new Response(JSON.stringify({ error: data.error || 'Failed to create PIX charge' }), {
          status: response.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Store the chargeId in the order for webhook lookup
      if (orderId) {
        try {
          await updateFirestoreDoc('orders', orderId, {
            flowpay_charge_id: data.charge.id,
          });
          console.log(`✅ Stored chargeId ${data.charge.id} in order ${orderId}`);
        } catch (err) {
          console.warn('⚠️ Failed to store chargeId in order:', err);
        }
      }

      return new Response(JSON.stringify({
        success: true,
        chargeId: data.charge.id,
        brCode: data.charge.brCode,
        qrCodeImage: data.charge.qrCodeImage,
        expiresAt: data.charge.expiresAt,
      }), {
        status: 201,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ==================== CHECK STATUS ====================
    if (req.method === 'GET' && action === 'status') {
      if (!apiKey) {
        console.error('❌ FLOWPAY_API_KEY not configured');
        return new Response(JSON.stringify({ error: 'Payment gateway not configured' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const chargeId = url.searchParams.get('chargeId');

      if (!chargeId) {
        return new Response(JSON.stringify({ error: 'chargeId is required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      console.log('🔵 Checking FlowPay charge status:', chargeId);

      const response = await fetch(`${FLOWPAY_BASE_URL}/status?id=${chargeId}`, {
        headers: { 'x-api-key': apiKey },
      });

      const data = await response.json();
      console.log('🟢 FlowPay status response:', { chargeId, status: data.charge?.status });

      if (!response.ok || !data.success) {
        console.error('❌ FlowPay status error:', data);
        return new Response(JSON.stringify({ error: data.error || 'Failed to check status' }), {
          status: response.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({
        success: true,
        status: data.charge.status,
        paidAt: data.charge.paidAt || null,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Invalid action. Use ?action=create, ?action=status, or ?action=webhook' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('❌ FlowPay edge function error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});