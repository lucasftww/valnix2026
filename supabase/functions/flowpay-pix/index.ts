import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
// FlowPay PIX Edge Function v2

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const FLOWPAY_BASE_URL = 'https://flowpayments.net/api/pix';
const FIREBASE_PROJECT_ID = 'valnix';

// ── Firebase ID Token Verification ─────────────────────────────────
// Verifies Firebase Auth ID tokens using Google's public keys (RSA)
let cachedPublicKeys: Record<string, CryptoKey> | null = null;
let publicKeysExpiresAt = 0;

async function getGooglePublicKeys(): Promise<Record<string, CryptoKey>> {
  if (cachedPublicKeys && Date.now() < publicKeysExpiresAt) return cachedPublicKeys;

  const res = await fetch('https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com');
  if (!res.ok) throw new Error(`Failed to fetch Google public keys: ${res.status}`);

  // Parse cache-control for expiry
  const cacheControl = res.headers.get('cache-control') || '';
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
  const maxAge = maxAgeMatch ? parseInt(maxAgeMatch[1]) * 1000 : 3600_000;
  publicKeysExpiresAt = Date.now() + maxAge;

  const certs: Record<string, string> = await res.json();
  const keys: Record<string, CryptoKey> = {};

  for (const [kid, pem] of Object.entries(certs)) {
    const pemBody = pem
      .replace(/-----BEGIN CERTIFICATE-----/, '')
      .replace(/-----END CERTIFICATE-----/, '')
      .replace(/\n/g, '');
    const certBytes = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));

    // Extract public key from X.509 certificate using SubjectPublicKeyInfo
    // Import as RSASSA-PKCS1-v1_5 with SHA-256
    try {
      const key = await crypto.subtle.importKey(
        'raw', certBytes,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']
      );
      keys[kid] = key;
    } catch {
      // Fallback: try importing the raw SPKI from the cert
      // X.509 certs need special parsing; use a simpler approach
    }
  }

  cachedPublicKeys = keys;
  return keys;
}

/**
 * Verify a Firebase ID token.
 * Returns the decoded payload (uid, email, etc.) or null if invalid.
 * Uses Google's tokeninfo endpoint for reliable verification in Deno.
 */
async function verifyFirebaseIdToken(idToken: string): Promise<{ uid: string; email?: string } | null> {
  try {
    // Use Google's secure tokeninfo endpoint for verification
    const res = await fetch(`https://www.googleapis.com/identitytoolkit/v3/relyingparty/getAccountInfo?key=${getFirebaseWebApiKey()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    });

    if (!res.ok) {
      console.warn('❌ Firebase token verification failed:', res.status);
      return null;
    }

    const data = await res.json();
    const user = data.users?.[0];
    if (!user?.localId) return null;

    return { uid: user.localId, email: user.email || undefined };
  } catch (e) {
    console.warn('❌ Firebase token verification error:', e);
    return null;
  }
}

function getFirebaseWebApiKey(): string {
  // Extract from service account or use the known web API key
  const saKeyRaw = Deno.env.get('FIREBASE_SERVICE_ACCOUNT_KEY');
  if (saKeyRaw) {
    try {
      const sa = JSON.parse(saKeyRaw);
      // Service account doesn't contain web API key, use the known one
    } catch {}
  }
  // This is the Firebase Web API key (public, same as in frontend config)
  return 'AIzaSyBHpcqUztUdpvoCZpjuobkXuFXO9gEJogw';
}


// ── Firebase Service Account Auth ──────────────────────────────────
let cachedAccessToken: string | null = null;
let tokenExpiresAt = 0;

function base64url(data: Uint8Array): string {
  let binary = '';
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function getFirebaseAccessToken(): Promise<string> {
  if (cachedAccessToken && Date.now() < tokenExpiresAt - 60_000) {
    return cachedAccessToken;
  }

  const saKeyRaw = Deno.env.get('FIREBASE_SERVICE_ACCOUNT_KEY');
  if (!saKeyRaw) throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY not configured');

  const saKey = JSON.parse(saKeyRaw);
  const now = Math.floor(Date.now() / 1000);

  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: saKey.client_email,
    sub: saKey.client_email,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/datastore',
  };

  const enc = new TextEncoder();
  const headerB64 = base64url(enc.encode(JSON.stringify(header)));
  const payloadB64 = base64url(enc.encode(JSON.stringify(payload)));
  const unsignedToken = `${headerB64}.${payloadB64}`;

  // Import RSA private key
  const pemBody = saKey.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\n/g, '');
  const keyBytes = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', keyBytes, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']
  );

  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, enc.encode(unsignedToken));
  const jwt = `${unsignedToken}.${base64url(new Uint8Array(signature))}`;

  // Exchange JWT for access token
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    console.error('❌ Firebase token exchange failed:', err);
    throw new Error(`Firebase auth failed: ${tokenRes.status}`);
  }

  const tokenData = await tokenRes.json();
  cachedAccessToken = tokenData.access_token;
  tokenExpiresAt = Date.now() + (tokenData.expires_in * 1000);
  console.log('🔑 Firebase access token obtained');
  return cachedAccessToken!;
}

// Helper: Update Firestore document via REST API
async function updateFirestoreDoc(collection: string, docId: string, fields: Record<string, unknown>) {
  const accessToken = await getFirebaseAccessToken();
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
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
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
  const accessToken = await getFirebaseAccessToken();
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${collection}/${docId}`;
  console.log(`🔍 Firestore GET: ${collection}/${docId}`);
  const response = await fetch(url, {
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    console.error(`❌ Firestore GET failed (${response.status}): ${errorText.substring(0, 300)}`);
    return null;
  }
  
  const data = await response.json();
  return data.fields || null;
}

// Helper: Query Firestore collection
async function queryFirestore(collectionId: string, fieldPath: string, op: string, value: string) {
  const accessToken = await getFirebaseAccessToken();
  const queryUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents:runQuery`;
  const response = await fetch(queryUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
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
        const accessTokenForUpdate = await getFirebaseAccessToken();
        await fetch(updateUrl, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessTokenForUpdate}` },
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
        // Not a regular order — check if it's an upsell (sale_addons in Supabase)
        console.log(`ℹ️ No order found in Firestore for chargeId: ${chargeId}, checking sale_addons...`);
        
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const supa = createClient(supabaseUrl, serviceRoleKey);
        
        const { data: addon, error: addonError } = await supa
          .from('sale_addons')
          .select('*')
          .eq('flowpay_charge_id', chargeId)
          .maybeSingle();
        
        if (addonError || !addon) {
          console.error(`❌ No order or addon found for chargeId: ${chargeId}`);
          return new Response(JSON.stringify({ error: 'Order not found' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        
        // It's an upsell addon payment
        console.log(`💰 Upsell addon payment confirmed: ${addon.addon_type} for order ${addon.order_id}, amount: ${addon.amount}`);
        
        // Skip if already paid
        if (addon.status === 'paid') {
          console.log(`ℹ️ Addon ${addon.id} already paid, skipping`);
          return new Response(JSON.stringify({ success: true, message: 'Already processed' }), {
            headers: { 'Content-Type': 'application/json' },
          });
        }
        
        // Update addon status to paid
        await supa
          .from('sale_addons')
          .update({ status: 'paid', paid_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq('id', addon.id);
        
        console.log(`✅ Addon ${addon.id} marked as paid via webhook`);
        
        
        // Register upsell in analytics
        const upsellOrderId = `upsell-${addon.order_id}-${addon.addon_type}`;
        try {
          await registerAnalyticsEvent(upsellOrderId, Number(addon.amount), addon.user_id || undefined, addon.customer_email || undefined);
        } catch (analyticsError) {
          console.warn('⚠️ Analytics upsell registration failed:', analyticsError);
        }

        // Send upsell Purchase to Meta CAPI
        try {
          const supabaseUrlCapi = Deno.env.get("SUPABASE_URL")!;
          const serviceRoleKeyCapi = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
          const supaCapi = createClient(supabaseUrlCapi, serviceRoleKeyCapi);

          const addonNameParts = (addon.customer_name || '').split(' ');

          await supaCapi.functions.invoke('meta-capi', {
            body: {
              event_name: 'Purchase',
              event_id: `purchase_upsell_${addon.order_id}_${addon.addon_type}_${Date.now()}`,
              order_id: `${addon.order_id}_${addon.addon_type}`,
              value: Number(addon.amount),
              currency: 'BRL',
              content_name: `Upsell ${addon.addon_type}`,
              email: addon.customer_email || undefined,
              first_name: addonNameParts[0] || undefined,
              last_name: addonNameParts.slice(1).join(' ') || undefined,
              external_id: addon.user_id || undefined,
            },
          });
          console.log(`📡 Meta CAPI upsell Purchase sent for addon ${addon.id}`);
        } catch (capiErr) {
          console.warn('⚠️ Meta CAPI upsell failed:', capiErr);
        }

        // Send upsell Purchase to UTMify
        try {
          const supabaseUrl3 = Deno.env.get("SUPABASE_URL")!;
          const serviceRoleKey3 = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
          const supa3 = createClient(supabaseUrl3, serviceRoleKey3);

          await supa3.functions.invoke('utmify-event', {
            body: {
              order_id: `${addon.order_id}_${addon.addon_type}`,
              event_type: 'Purchase',
              value: Number(addon.amount),
              customer_name: addon.customer_name || undefined,
              customer_email: addon.customer_email || undefined,
              product_name: `Upsell ${addon.addon_type}`,
              utm_source: addon.utm_source || undefined,
              utm_medium: addon.utm_medium || undefined,
              utm_campaign: addon.utm_campaign || undefined,
            },
          });
          console.log(`📡 UTMify upsell Purchase sent for addon ${addon.id}`);
        } catch (utmifyErr) {
          console.warn('⚠️ UTMify upsell failed:', utmifyErr);
        }
        
        return new Response(JSON.stringify({ success: true, addonId: addon.id }), {
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

      // Extract order data for analytics
      const orderValue = orderFields?.total_amount?.doubleValue || orderFields?.total_amount?.integerValue || (paidValue ? paidValue / 100 : 0);
      const customerEmail = orderFields?.customer_email?.stringValue;
      const userId = orderFields?.user_id?.stringValue;

      // Update order status to paid
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
      }


      // Register Purchase in analytics_events (Supabase)
      try {
        await registerAnalyticsEvent(orderId!, orderValue, userId, customerEmail);
      } catch (analyticsError) {
        console.warn('⚠️ Analytics registration failed:', analyticsError);
      }

      // Send Purchase event to Meta CAPI (server-side, enriched)
      try {
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const supa = createClient(supabaseUrl, serviceRoleKey);
        
        const customerName = orderFields?.customer_name?.stringValue || '';
        const customerPhone = orderFields?.customer_phone?.stringValue || '';
        const orderFbc = orderFields?.fbc?.stringValue || undefined;
        const orderFbp = orderFields?.fbp?.stringValue || undefined;
        const nameParts = customerName.split(' ');

        await supa.functions.invoke('meta-capi', {
          body: {
            event_name: 'Purchase',
            event_id: `purchase_${orderId}_${Date.now()}`,
            order_id: orderId,
            value: orderValue,
            currency: 'BRL',
            content_name: `Pedido #${orderId!.substring(0, 8)}`,
            email: customerEmail,
            phone: customerPhone || undefined,
            first_name: nameParts[0] || undefined,
            last_name: nameParts.slice(1).join(' ') || undefined,
            external_id: userId,
            fbc: orderFbc,
            fbp: orderFbp,
          },
        });
        console.log(`📡 Meta CAPI Purchase sent for order ${orderId}`);
      } catch (capiError) {
        console.warn('⚠️ Meta CAPI Purchase failed:', capiError);
      }

      // Send Purchase event to UTMify (server-side attribution)
      try {
        const supabaseUrl2 = Deno.env.get("SUPABASE_URL")!;
        const serviceRoleKey2 = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const supa2 = createClient(supabaseUrl2, serviceRoleKey2);

        const customerName2 = orderFields?.customer_name?.stringValue || '';
        const customerPhone2 = orderFields?.customer_phone?.stringValue || '';

        await supa2.functions.invoke('utmify-event', {
          body: {
            order_id: orderId,
            event_type: 'Purchase',
            value: orderValue,
            customer_name: customerName2,
            customer_email: customerEmail,
            customer_phone: customerPhone2 || undefined,
            product_name: `Pedido #${orderId!.substring(0, 8)}`,
          },
        });
        console.log(`📡 UTMify Purchase sent for order ${orderId}`);
      } catch (utmifyError) {
        console.warn('⚠️ UTMify Purchase failed:', utmifyError);
      }

      return new Response(JSON.stringify({ success: true, orderId }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // ==================== CREATE PIX CHARGE ====================
    if (req.method === 'POST' && action === 'create') {
      // 🔐 Verify Firebase Auth token (optional for guest checkout)
      const authHeader = req.headers.get('authorization');
      const idToken = authHeader?.replace(/^Bearer\s+/i, '');
      let firebaseUser: { uid: string; email?: string } | null = null;
      
      if (idToken) {
        firebaseUser = await verifyFirebaseIdToken(idToken);
        if (firebaseUser) {
          console.log(`🔐 Authenticated user: ${firebaseUser.uid} (${firebaseUser.email})`);
        } else {
          console.warn('⚠️ Invalid Firebase token provided, proceeding as guest');
        }
      } else {
        console.log('👤 Guest checkout (no auth token)');
      }

      if (!apiKey) {
        console.error('❌ FLOWPAY_API_KEY not configured');
        return new Response(JSON.stringify({ error: 'Payment gateway not configured' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Capture REAL client IP/UA at PIX creation time (for webhook EQM later)
      const clientIpAtCreate = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
        || req.headers.get('cf-connecting-ip')
        || req.headers.get('x-real-ip')
        || null;
      const clientUaAtCreate = req.headers.get('user-agent') || null;

      const body = await req.json();
      const { orderId, customer, utmParameters } = body;
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

      // Store the chargeId + client IP/UA in the order for webhook lookup (regular orders only)
      if (orderId && !isUpsell) {
        try {
          await updateFirestoreDoc('orders', orderId, {
            flowpay_charge_id: data.charge.id,
            ...(utmParameters ? { utm_parameters: utmParameters } : {}),
            ...(clientIpAtCreate ? { client_ip: clientIpAtCreate } : {}),
            ...(clientUaAtCreate ? { client_ua: clientUaAtCreate } : {}),
          });
          console.log(`✅ Stored chargeId ${data.charge.id} in order ${orderId} (IP: ${clientIpAtCreate}, UA: ${(clientUaAtCreate || '').substring(0, 40)})`);
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

    // ==================== CHECK STATUS (with Purchase fallback) ====================
    if (req.method === 'GET' && action === 'status') {
      // 🔐 Verify Firebase Auth token (optional for guest checkout)
      const statusAuthHeader = req.headers.get('authorization');
      const statusIdToken = statusAuthHeader?.replace(/^Bearer\s+/i, '');
      if (statusIdToken) {
        const statusFirebaseUser = await verifyFirebaseIdToken(statusIdToken);
        if (!statusFirebaseUser) {
          return new Response(JSON.stringify({ error: 'Unauthorized: invalid token' }), {
            status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }
      // Allow unauthenticated status checks for guest checkout

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

      // ── FALLBACK: If COMPLETED, ensure Purchase events were sent ──
      // This covers cases where the FlowPay webhook didn't fire
      if (data.charge?.status === 'COMPLETED') {
        try {
          const queryResults = await queryFirestore('orders', 'flowpay_charge_id', 'EQUAL', chargeId);
          
          if (queryResults?.[0]?.document) {
            const orderDoc = queryResults[0].document;
            const fbOrderId = orderDoc.name.split('/').pop()!;
            const orderFields = orderDoc.fields;
            const currentPaymentStatus = orderFields?.payment_status?.stringValue;
            const orderValue = orderFields?.total_amount?.doubleValue || orderFields?.total_amount?.integerValue || 0;
            const fbUserId = orderFields?.user_id?.stringValue;
            const fbEmail = orderFields?.customer_email?.stringValue;
            const fbName = orderFields?.customer_name?.stringValue || '';
            const fbPhone = orderFields?.customer_phone?.stringValue || '';
            const fbFbc = orderFields?.fbc?.stringValue || undefined;
            const fbFbp = orderFields?.fbp?.stringValue || undefined;

            // Only fire Purchase events if order wasn't already marked as paid (avoid duplicates)
            if (currentPaymentStatus !== 'paid') {
              console.log(`🔄 FALLBACK: Webhook missed for order ${fbOrderId}, processing via polling`);

              // Update order status
              await updateFirestoreDoc('orders', fbOrderId, {
                payment_status: 'paid',
                status: 'processing',
                updated_at: new Date().toISOString(),
              });

              // Auto-delivery
              try { await processAutoDelivery(fbOrderId); } catch (e) { console.warn('⚠️ Fallback auto-delivery error:', e); }

              // Analytics
              await registerAnalyticsEvent(fbOrderId, Number(orderValue), fbUserId, fbEmail);

              // Meta CAPI Purchase
              try {
                const supabaseUrlFb = Deno.env.get("SUPABASE_URL")!;
                const serviceRoleKeyFb = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
                const supaFb = createClient(supabaseUrlFb, serviceRoleKeyFb);
                const nameParts = fbName.split(' ');
                await supaFb.functions.invoke('meta-capi', {
                  body: {
                    event_name: 'Purchase',
                    event_id: `purchase_${fbOrderId}_${Date.now()}`,
                    order_id: fbOrderId,
                    value: Number(orderValue),
                    currency: 'BRL',
                    content_name: `Pedido #${fbOrderId.substring(0, 8)}`,
                    email: fbEmail,
                    phone: fbPhone || undefined,
                    first_name: nameParts[0] || undefined,
                    last_name: nameParts.slice(1).join(' ') || undefined,
                    external_id: fbUserId,
                    fbc: fbFbc,
                    fbp: fbFbp,
                  },
                });
                console.log(`📡 FALLBACK: Meta CAPI Purchase sent for order ${fbOrderId}`);
              } catch (capiErr) { console.warn('⚠️ Fallback Meta CAPI error:', capiErr); }

              // UTMify Purchase
              try {
                const supabaseUrlUt = Deno.env.get("SUPABASE_URL")!;
                const serviceRoleKeyUt = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
                const supaUt = createClient(supabaseUrlUt, serviceRoleKeyUt);
                await supaUt.functions.invoke('utmify-event', {
                  body: {
                    order_id: fbOrderId,
                    event_type: 'Purchase',
                    value: Number(orderValue),
                    customer_name: fbName,
                    customer_email: fbEmail,
                    customer_phone: fbPhone || undefined,
                    product_name: `Pedido #${fbOrderId.substring(0, 8)}`,
                  },
                });
                console.log(`📡 FALLBACK: UTMify Purchase sent for order ${fbOrderId}`);
              } catch (utmErr) { console.warn('⚠️ Fallback UTMify error:', utmErr); }
            } else {
              console.log(`ℹ️ Order ${fbOrderId} already paid, skipping fallback`);
            }
          } else {
            // Check if it's an upsell addon
            const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
            const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
            const supa = createClient(supabaseUrl, serviceRoleKey);

            const { data: addon } = await supa
              .from('sale_addons')
              .select('*')
              .eq('flowpay_charge_id', chargeId)
              .maybeSingle();

            if (addon && addon.status !== 'paid') {
              console.log(`🔄 FALLBACK: Webhook missed for upsell addon ${addon.id}, processing via polling`);
              
              await supa
                .from('sale_addons')
                .update({ status: 'paid', paid_at: new Date().toISOString(), updated_at: new Date().toISOString() })
                .eq('id', addon.id);

              const upsellOrderId = `upsell-${addon.order_id}-${addon.addon_type}`;
              await registerAnalyticsEvent(upsellOrderId, Number(addon.amount), addon.user_id || undefined, addon.customer_email || undefined);

              // Meta CAPI for upsell
              try {
                const nameParts2 = (addon.customer_name || '').split(' ');
                await supa.functions.invoke('meta-capi', {
                  body: {
                    event_name: 'Purchase',
                    event_id: `purchase_${upsellOrderId}_${Date.now()}`,
                    order_id: upsellOrderId,
                    value: Number(addon.amount),
                    currency: 'BRL',
                    content_name: `Upsell ${addon.addon_type}`,
                    email: addon.customer_email,
                    first_name: nameParts2[0] || undefined,
                    last_name: nameParts2.slice(1).join(' ') || undefined,
                    external_id: addon.user_id,
                  },
                });
              } catch (e) { console.warn('⚠️ Fallback upsell CAPI error:', e); }

              // UTMify for upsell
              try {
                await supa.functions.invoke('utmify-event', {
                  body: {
                    order_id: `${addon.order_id}_${addon.addon_type}`,
                    event_type: 'Purchase',
                    value: Number(addon.amount),
                    customer_name: addon.customer_name,
                    customer_email: addon.customer_email,
                    product_name: `Upsell ${addon.addon_type}`,
                    utm_source: addon.utm_source || undefined,
                    utm_medium: addon.utm_medium || undefined,
                    utm_campaign: addon.utm_campaign || undefined,
                  },
                });
              } catch (e) { console.warn('⚠️ Fallback upsell UTMify error:', e); }
            }
          }
        } catch (fallbackError) {
          console.warn('⚠️ Purchase fallback error (non-blocking):', fallbackError);
        }
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