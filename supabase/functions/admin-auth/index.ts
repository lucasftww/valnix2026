import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ALLOWED_ORIGINS = [
  "https://www.valnix.com.br",
  "https://valnix.com.br",
  "https://valnix2026.lovable.app",
  "https://id-preview--819e052b-89b4-40a7-8d34-1a89d59aa702.lovable.app",
  "https://819e052b-89b4-40a7-8d34-1a89d59aa702.lovableproject.com",
];

function getCorsHeaders(req: Request): Record<string, string> | null {
  const origin = req.headers.get("Origin");
  if (!origin) {
    return {
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-token",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    };
  }
  if (!ALLOWED_ORIGINS.includes(origin)) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-token",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };
}

// ── HMAC Token Generation & Verification ──────────────────────────
const TOKEN_TTL_MS = 1 * 60 * 60 * 1000; // 1 hour

// ── Firestore-backed infrastructure ───────────────────────────────
const FIREBASE_PROJECT_ID = 'valnix';

let cachedAccessToken: string | null = null;
let tokenExpiresAt = 0;

function base64url(data: Uint8Array): string {
  let binary = '';
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function getFirebaseAccessToken(): Promise<string> {
  if (cachedAccessToken && Date.now() < tokenExpiresAt - 60_000) return cachedAccessToken;
  const saKeyRaw = Deno.env.get('FIREBASE_SERVICE_ACCOUNT_KEY');
  if (!saKeyRaw) throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY not configured');
  const saKey = JSON.parse(saKeyRaw);
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: saKey.client_email, sub: saKey.client_email,
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/datastore',
  };
  const enc = new TextEncoder();
  const headerB64 = base64url(enc.encode(JSON.stringify(header)));
  const payloadB64 = base64url(enc.encode(JSON.stringify(payload)));
  const unsignedToken = `${headerB64}.${payloadB64}`;
  const pemBody = saKey.private_key.replace(/-----BEGIN PRIVATE KEY-----/, '').replace(/-----END PRIVATE KEY-----/, '').replace(/\n/g, '');
  const keyBytes = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey('pkcs8', keyBytes, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, enc.encode(unsignedToken));
  const jwt = `${unsignedToken}.${base64url(new Uint8Array(signature))}`;
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  if (!tokenRes.ok) throw new Error(`Firebase auth failed: ${tokenRes.status}`);
  const tokenData = await tokenRes.json();
  cachedAccessToken = tokenData.access_token;
  tokenExpiresAt = Date.now() + (tokenData.expires_in * 1000);
  return cachedAccessToken!;
}

const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;
const COMMIT_URL = `${FIRESTORE_BASE}:commit`;
const RATE_LIMIT_DOC_BASE = `projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/rate_limits`;

// ── Nonce denylist (Firestore-backed, true replay protection) ─────
// On token use (verify), mark nonce as consumed. Reject if already used.
async function isNonceUsed(nonce: string, accessToken: string): Promise<boolean> {
  const docUrl = `${FIRESTORE_BASE}/admin_nonces/${nonce}`;
  const res = await fetch(docUrl, { headers: { 'Authorization': `Bearer ${accessToken}` } });
  if (res.status === 404) return false;
  if (res.ok) {
    const data = await res.json();
    return data.fields?.used?.booleanValue === true;
  }
  // On error, fail-closed: treat as used
  console.warn(`⚠️ Nonce check failed: ${res.status}`);
  return true;
}

async function markNonceUsed(nonce: string, expiresAt: number, accessToken: string): Promise<void> {
  const docUrl = `${FIRESTORE_BASE}/admin_nonces/${nonce}`;
  await fetch(docUrl, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
    body: JSON.stringify({
      fields: {
        used: { booleanValue: true },
        used_at: { timestampValue: new Date().toISOString() },
        expires_at: { integerValue: String(expiresAt) },
      },
    }),
  });
}

// ── Token generation ──────────────────────────────────────────────
async function generateAdminToken(): Promise<string> {
  const adminPassword = Deno.env.get("ADMIN_PASSWORD");
  if (!adminPassword) throw new Error("ADMIN_PASSWORD not configured");

  const nonce = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const timestamp = Date.now().toString(16);
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(adminPassword),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`${timestamp}:${nonce}:admin`));
  const hmac = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
  return `${timestamp}.${nonce}.${hmac}`;
}

// ── Token verification (with nonce single-use enforcement) ────────
async function verifyAdminToken(token: string): Promise<boolean> {
  const adminPassword = Deno.env.get("ADMIN_PASSWORD");
  if (!adminPassword) return false;

  const parts = token.split(".");
  if (parts.length !== 3) return false;

  const [timestampHex, nonce, providedHmac] = parts;
  const timestamp = parseInt(timestampHex, 16);
  if (isNaN(timestamp)) return false;

  // Check TTL (1h)
  const now = Date.now();
  if (now - timestamp > TOKEN_TTL_MS) return false;
  if (timestamp > now + 60_000) return false;

  // Recompute HMAC with nonce
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(adminPassword),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`${timestampHex}:${nonce}:admin`));
  const expectedHmac = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");

  // Constant-time comparison
  if (providedHmac.length !== expectedHmac.length) return false;
  let diff = 0;
  for (let i = 0; i < providedHmac.length; i++) {
    diff |= providedHmac.charCodeAt(i) ^ expectedHmac.charCodeAt(i);
  }
  if (diff !== 0) return false;

  // ── Nonce single-use check (Firestore-backed) ──
  // For GET /verify: we do NOT consume the nonce (it's just a session check).
  // Nonce consumption happens on first actual admin API call via x-admin-token.
  // Here we just check HMAC validity + TTL.
  // The nonce denylist is used by admin-data/admin-analytics to prevent replay.
  return true;
}

// ── Rate Limiting (Firestore-backed, FAIL-CLOSED) ─────────────────
async function checkLoginRateLimit(ip: string): Promise<{ allowed: boolean; retryAfter?: number }> {
  const MAX_ATTEMPTS = 5;
  const WINDOW_MS = 5 * 60_000;
  const BLOCK_MS = 10 * 60_000;
  const docId = `admin_login_${ip.replace(/[\/\.:\[\]]/g, '_')}`;
  const docPath = `${RATE_LIMIT_DOC_BASE}/${docId}`;
  const now = Date.now();

  let accessToken: string;
  try {
    accessToken = await getFirebaseAccessToken();
  } catch (e) {
    // FAIL-CLOSED: if we can't get Firestore access, deny the login attempt
    console.error('🚨 Rate limit FAIL-CLOSED: cannot get Firebase access token:', e);
    return { allowed: false, retryAfter: 30 };
  }

  try {
    const readUrl = `https://firestore.googleapis.com/v1/${docPath}`;
    const readRes = await fetch(readUrl, { headers: { 'Authorization': `Bearer ${accessToken}` } });

    if (readRes.ok) {
      const data = await readRes.json();
      const fields = data.fields || {};
      const blockedUntil = Number(fields.blocked_until?.integerValue || '0');
      if (blockedUntil > now) {
        return { allowed: false, retryAfter: Math.ceil((blockedUntil - now) / 1000) };
      }

      const resetAt = Number(fields.reset_at?.integerValue || '0');
      const count = Number(fields.count?.integerValue || '0');

      if (resetAt > now) {
        const shouldBlock = count >= MAX_ATTEMPTS;
        const commitRes = await fetch(COMMIT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
          body: JSON.stringify({
            writes: [
              {
                update: {
                  name: docPath,
                  fields: {
                    reset_at: { integerValue: String(resetAt) },
                    blocked_until: { integerValue: String(shouldBlock ? now + BLOCK_MS : 0) },
                    updated_at: { timestampValue: new Date().toISOString() },
                  },
                },
                currentDocument: { exists: true },
              },
              {
                transform: {
                  document: docPath,
                  fieldTransforms: [{ fieldPath: 'count', increment: { integerValue: '1' } }],
                },
              },
            ],
          }),
        });
        if (!commitRes.ok) {
          // FAIL-CLOSED: if atomic increment fails, deny
          console.warn(`🚨 Rate limit commit failed (FAIL-CLOSED): ${commitRes.status}`);
          return { allowed: false, retryAfter: 30 };
        }
        if (shouldBlock) {
          console.warn(`🛡️ Admin login rate limit BLOCKED IP: ${ip} after ${count} attempts`);
          return { allowed: false, retryAfter: Math.ceil(BLOCK_MS / 1000) };
        }
        return { allowed: true };
      }
    } else if (readRes.status !== 404) {
      // FAIL-CLOSED: unexpected error reading rate limit doc
      console.warn(`🚨 Rate limit read failed (FAIL-CLOSED): ${readRes.status}`);
      return { allowed: false, retryAfter: 30 };
    }

    // Window expired or first attempt — reset
    const resetRes = await fetch(COMMIT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
      body: JSON.stringify({
        writes: [{
          update: {
            name: docPath,
            fields: {
              count: { integerValue: '1' },
              reset_at: { integerValue: String(now + WINDOW_MS) },
              blocked_until: { integerValue: '0' },
              updated_at: { timestampValue: new Date().toISOString() },
            },
          },
        }],
      }),
    });
    if (!resetRes.ok) {
      // FAIL-CLOSED on reset failure too
      console.warn(`🚨 Rate limit reset failed (FAIL-CLOSED): ${resetRes.status}`);
      return { allowed: false, retryAfter: 30 };
    }
    return { allowed: true };
  } catch (e) {
    // FAIL-CLOSED: any unexpected error denies the request
    console.error('🚨 Rate limit check FAIL-CLOSED:', e);
    return { allowed: false, retryAfter: 30 };
  }
}

async function resetLoginAttempts(ip: string) {
  try {
    const docId = `admin_login_${ip.replace(/[\/\.:\[\]]/g, '_')}`;
    const docPath = `${RATE_LIMIT_DOC_BASE}/${docId}`;
    const accessToken = await getFirebaseAccessToken();
    await fetch(`https://firestore.googleapis.com/v1/${docPath}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });
  } catch { /* best-effort cleanup */ }
}

// ════════════════════════════════════════════════════════════════════
Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (!corsHeaders) {
    return new Response("Forbidden", { status: 403 });
  }
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

  try {
    // ── POST: Login ──
    if (req.method === "POST") {
      const rl = await checkLoginRateLimit(clientIp);
      if (!rl.allowed) {
        return new Response(JSON.stringify({ error: "Too many attempts. Try again later." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": String(rl.retryAfter || 600) },
        });
      }

      const body = await req.json();
      const password = typeof body?.password === "string" ? body.password.trim() : "";

      if (!password) {
        return new Response(JSON.stringify({ error: "Password required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const adminPassword = Deno.env.get("ADMIN_PASSWORD");
      if (!adminPassword || password !== adminPassword) {
        console.warn(`🚫 Failed admin login attempt from ip=${clientIp}`);
        return new Response(JSON.stringify({ error: "Invalid password" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      await resetLoginAttempts(clientIp);
      const token = await generateAdminToken();
      console.log(`✅ Admin login successful from ip=${clientIp}`);

      return new Response(JSON.stringify({ token }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── GET: Verify token ──
    if (req.method === "GET") {
      const adminToken = req.headers.get("x-admin-token");
      if (!adminToken) {
        return new Response(JSON.stringify({ valid: false }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const valid = await verifyAdminToken(adminToken);
      return new Response(JSON.stringify({ valid }), {
        status: valid ? 200 : 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("admin-auth error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
