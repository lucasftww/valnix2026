import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import * as crypto from "crypto";
import axios from "axios";

admin.initializeApp();
const db = admin.firestore();

const NEW_META_TOKEN = "EAAXCTJFcZAckBRHf1P0P3ZBbmfv98XX5OUOgAItrXOkwgquHxlvfGyh1paz1kIP0f9jHQJLDgGRGWL55rsJTigXjtLQYLH5z8XD8AglRWgZBPofDGytdrlYxLXXznt2TBZAFLYXpv2P6jslxHynXuytAyRx3Vqslt5ZAHZAaA6GLrCZAlHZBkZAC1cQ3zLUGyvwZDZD";

/**
 * Meta Conversions API Relay (Migrated from Supabase)
 */
export const metaRelay = functions.https.onRequest(async (req, res) => {
  // CORS Headers
  res.set('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.status(204).send('');
    return;
  }

  try {
    const { event_name, event_id, event_source_url, user_data, custom_data } = req.body;

    // Buscar Pixel ID e Token do Firestore (ou usar o fallback de segurança)
    const credsSnap = await db.collection("system_credentials").doc("META_ACCESS_TOKEN").get();
    const pixelSnap = await db.collection("system_credentials").doc("META_PIXEL_ID").get();
    
    const token = credsSnap.exists ? credsSnap.data()?.value : NEW_META_TOKEN;
    const pixelId = pixelSnap.exists ? pixelSnap.data()?.value : null;

    if (!pixelId || !token) {
      console.error("❌ Meta configuration missing in Firestore.");
      res.status(500).json({ error: "Meta configuration missing" });
      return;
    }

    const url = `https://graph.facebook.com/v18.0/${pixelId}/events?access_token=${token}`;
    
    const payload = {
      data: [{
        event_name,
        event_time: Math.floor(Date.now() / 1000),
        action_source: "website",
        event_id,
        event_source_url,
        user_data,
        custom_data
      }]
    };

    const response = await axios.post(url, payload);
    console.log(`✅ Event ${event_name} sent to Meta CAPI.`);
    res.status(200).json(response.data);
  } catch (error: any) {
    console.error("💥 Error in metaRelay:", error.response?.data || error.message);
    res.status(500).json({ error: "Failed to send event to Meta" });
  }
});

/**
 * Helper: HMAC Admin Token Verification (Node.js version)
 */
async function verifyAdminToken(token: string): Promise<boolean> {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword || !token) return false;

  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [timestampHex, nonce, providedHmac] = parts;
  const timestamp = parseInt(timestampHex, 16);
  if (isNaN(timestamp)) return false;

  const TOKEN_TTL_MS = 3600000; // 1 hour
  const now = Date.now();
  if (now - timestamp > TOKEN_TTL_MS || timestamp > now + 60000) return false;

  const expectedHmac = crypto.createHmac('sha256', adminPassword)
    .update(`${timestampHex}:${nonce}:admin`)
    .digest('hex');

  return timingSafeEqual(providedHmac, expectedHmac);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Admin Data API (Migrated from Supabase)
 */
export const adminData = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-admin-token');
  
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

  const adminToken = req.header('x-admin-token');
  if (!adminToken || !await verifyAdminToken(adminToken)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const resource = req.query.resource as string;
  if (!resource) { res.status(400).json({ error: "Resource required" }); return; }

  try {
    switch (req.method) {
      case 'GET':
        if (resource === "products") {
          const snap = await db.collection("products").get();
          const products = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          res.status(200).json({ products });
        } else if (resource === "orders") {
          const snap = await db.collection("ordens").orderBy("created_at", "desc").limit(500).get();
          const orders = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          res.status(200).json({ orders });
        } else if (resource === "system_credentials") {
          const snap = await db.collection("system_credentials").get();
          const credentials = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          res.status(200).json({ credentials });
        } else {
          // General auto-fetch for categories, coupons, etc.
          const snap = await db.collection(resource).get();
          const data = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          res.status(200).json({ [resource]: data });
        }
        break;

      case 'PUT':
      case 'POST':
        const body = req.body;
        const id = body.id || req.query.id;
        if (!id) { res.status(400).json({ error: "ID required for update/create" }); return; }
        
        const dataToSave = { ...body, updated_at: admin.firestore.FieldValue.serverTimestamp() };
        delete dataToSave.id;

        await db.collection(resource === "orders" ? "ordens" : resource).doc(id).set(dataToSave, { merge: true });
        res.status(200).json({ success: true });
        break;

      case 'DELETE':
        const delId = req.query.id as string;
        if (!delId) { res.status(400).json({ error: "ID required for deletion" }); return; }
        await db.collection(resource === "orders" ? "ordens" : resource).doc(delId).delete();
        res.status(200).json({ success: true });
        break;

      default:
        res.status(405).json({ error: "Method not allowed" });
    }
  } catch (error: any) {
    console.error(`💥 Admin Data Error (${resource}):`, error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Server Relay API (Migrated from Supabase)
 * Handles initial reception of events, logs to Firestore, and relays to Meta via the internal metaRelay logic.
 */
export const serverRelay = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, x-client-info');
  
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: "Method not allowed" }); return; }

  try {
    const { event_name, event_id, event_source_url, user_data, custom_data, event_time } = req.body;
    const resolvedEventId = event_id || crypto.randomUUID();
    const finalEventTime = event_time ? Number(event_time) : Math.floor(Date.now() / 1000);

    // 1. Log the event to analytics_events for audit/replay
    const eventPayload = {
      event_name,
      event_id: resolvedEventId,
      event_time: finalEventTime,
      event_source_url: event_source_url || '',
      user_data: user_data || {},
      custom_data: custom_data || {},
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown'
    };

    await db.collection("analytics_events").doc(resolvedEventId).set(eventPayload);

    // 2. Prepare Meta CAPI Payload
    const credsSnap = await db.collection("system_credentials").doc("META_ACCESS_TOKEN").get();
    const pixelSnap = await db.collection("system_credentials").doc("META_PIXEL_ID").get();
    
    const token = credsSnap.exists ? credsSnap.data()?.value : NEW_META_TOKEN;
    const pixelId = pixelSnap.exists ? pixelSnap.data()?.value : null;

    if (pixelId && token) {
      const metaUrl = `https://graph.facebook.com/v18.0/${pixelId}/events?access_token=${token}`;
      const payload = {
        data: [{
          event_name,
          event_time: finalEventTime,
          action_source: "website",
          event_id: resolvedEventId,
          event_source_url: event_source_url || '',
          user_data: user_data || {},
          custom_data: custom_data || {}
        }]
      };

      // Disparar o envio de forma assíncrona (não bloqueia a resposta pro cliente)
      axios.post(metaUrl, payload).catch(err => {
        console.error(`💥 Async Meta CAPI Error for ${event_name}:`, err.message);
      });
    } else {
      console.warn(`⚠️ Meta credentials missing for event ${event_name}. Event saved but not relayed.`);
    }

    res.status(200).json({ success: true, event_id: resolvedEventId });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * SHA-256 Hashing Helper for PII (Node.js version)
 */
async function sha256(value: string): Promise<string> {
  return crypto.createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
}

/**
 * CAPI Replay API (Migrated from Supabase)
 * Allows re-sending historical events or manual event injection.
 */
export const capiReplay = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, x-admin-token');
  
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

  const adminToken = req.header('x-admin-token');
  if (!adminToken || !await verifyAdminToken(adminToken)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const { resource, event_name, event_id, email, phone, value, currency = "BRL" } = req.body;
    
    if (resource !== 'relay') {
      res.status(400).json({ error: "Invalid legacy resource" });
      return;
    }

    if (!event_name) {
      res.status(400).json({ error: "event_name required" });
      return;
    }

    // 1. Prepare User Data (Hashed)
    const userData: Record<string, any> = {
      client_ip_address: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '0.0.0.0',
      client_user_agent: req.headers['user-agent'] || 'unknown',
      country: await sha256('br')
    };

    if (email) userData.em = await sha256(email);
    if (phone) {
      let ph = phone.replace(/\D/g, '');
      if (!ph.startsWith('55') && ph.length >= 10) ph = '55' + ph;
      userData.ph = await sha256(ph);
    }

    // 2. Build Event Payload
    const resolvedEventId = event_id || `mig_${event_name}_${Date.now()}`;
    const eventPayload: Record<string, any> = {
      event_name,
      event_time: Math.floor(Date.now() / 1000),
      event_id: resolvedEventId,
      action_source: 'website',
      event_source_url: 'https://www.valnix.com.br',
      user_data: userData,
    };

    if (value !== undefined) {
      eventPayload.custom_data = {
        value: Number(value),
        currency
      };
    }

    // 3. Send to Meta
    const credsSnap = await db.collection("system_credentials").doc("META_ACCESS_TOKEN").get();
    const pixelSnap = await db.collection("system_credentials").doc("META_PIXEL_ID").get();
    
    const token = credsSnap.exists ? credsSnap.data()?.value : NEW_META_TOKEN;
    const pixelId = pixelSnap.exists ? pixelSnap.data()?.value : null;

    if (!pixelId || !token) {
      res.status(500).json({ error: "Meta configuration missing in Firestore" });
      return;
    }

    const metaUrl = `https://graph.facebook.com/v18.0/${pixelId}/events?access_token=${token}`;
    const response = await axios.post(metaUrl, { data: [eventPayload] });

    console.log(`✅ Manual CAPI Replay for ${event_name} successful.`);
    res.status(200).json({ success: true, meta_data: response.data, event_id: resolvedEventId });
  } catch (error: any) {
    console.error(`💥 CAPI Replay Error:`, error.message);
    res.status(500).json({ error: error.message });
  }
});
