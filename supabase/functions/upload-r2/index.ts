import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ALLOWED_ORIGINS = [
  "https://www.valnix.com.br",
  "https://valnix.com.br",
  "https://valnix2026.lovable.app",
  "https://id-preview--819e052b-89b4-40a7-8d34-1a89d59aa702.lovable.app",
  "https://819e052b-89b4-40a7-8d34-1a89d59aa702.lovableproject.com",
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("Origin") || "";
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_CONTENT_TYPES = ["image/webp", "image/png", "image/jpeg", "image/jpg", "image/gif"];
const FIREBASE_API_KEY = Deno.env.get('FIREBASE_WEB_API_KEY') || '';
const FIREBASE_PROJECT_ID = "valnix";

// ── Firebase Service Account Auth (for admin check) ───────────────
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

// ── Admin check via Firestore user_roles ───────────────────────────
async function isAdminInFirestore(uid: string): Promise<boolean> {
  try {
    const accessToken = await getFirebaseAccessToken();
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/user_roles/${uid}`;
    const res = await fetch(url, { headers: { 'Authorization': `Bearer ${accessToken}` } });
    if (!res.ok) return false;
    const doc = await res.json();
    return doc.fields?.role?.stringValue === 'admin';
  } catch { return false; }
}

// ── AWS Signature V4 for Cloudflare R2 ─────────────────────────────
async function hmacSHA256(key: ArrayBuffer, message: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message));
}

async function getSignatureKey(key: string, dateStamp: string, region: string, service: string): Promise<ArrayBuffer> {
  const kDate = await hmacSHA256(new TextEncoder().encode('AWS4' + key), dateStamp);
  const kRegion = await hmacSHA256(kDate, region);
  const kService = await hmacSHA256(kRegion, service);
  return hmacSHA256(kService, 'aws4_request');
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function uploadToR2(fileName: string, body: Uint8Array, contentType: string): Promise<string> {
  const accessKeyId = Deno.env.get('R2_ACCESS_KEY_ID')!;
  const secretAccessKey = Deno.env.get('R2_SECRET_ACCESS_KEY')!;
  const endpoint = Deno.env.get('R2_ENDPOINT')!; // https://<account_id>.r2.cloudflarestorage.com
  const publicUrl = Deno.env.get('R2_PUBLIC_URL')!;
  const bucket = 'valnix-assets';

  const endpointUrl = new URL(endpoint);
  const host = endpointUrl.host;
  const objectPath = `/${bucket}/valnix-upload/${fileName}`;
  
  const now = new Date();
  const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, '');
  const amzDate = now.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const region = 'auto';
  const service = 's3';

  const payloadHash = toHex(await crypto.subtle.digest('SHA-256', body));

  const canonicalHeaders = `content-type:${contentType}\nhost:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';

  const canonicalRequest = `PUT\n${objectPath}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalRequest)))}`;

  const signingKey = await getSignatureKey(secretAccessKey, dateStamp, region, service);
  const signature = toHex(await hmacSHA256(signingKey, stringToSign));

  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const uploadUrl = `https://${host}${objectPath}`;
  console.log(`[R2 DEBUG] host=${host}, objectPath=${objectPath}, accessKeyId=${accessKeyId?.slice(0,8)}..., endpoint=${endpoint}, uploadUrl=${uploadUrl}`);

  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Authorization': authorization,
      'Content-Type': contentType,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    },
    body: body,
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`R2 upload failed: ${res.status}`, errText);
    throw new Error(`R2 upload failed: ${res.status} - ${errText}`);
  }

  // Build public URL
  const fileUrl = `${publicUrl.replace(/\/$/, '')}/valnix-upload/${fileName}`;
  console.log(`✅ Uploaded to R2: ${fileUrl}`);
  return fileUrl;
}

// ── Main handler ───────────────────────────────────────────────────
Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth: validate Firebase token (admin only)
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const idToken = authHeader.replace("Bearer ", "");

    const verifyRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      }
    );

    if (!verifyRes.ok) {
      return new Response(
        JSON.stringify({ error: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const verifyData = await verifyRes.json();
    const userUid = verifyData?.users?.[0]?.localId;
    const userEmail = verifyData?.users?.[0]?.email?.toLowerCase();

    if (!userUid) {
      return new Response(
        JSON.stringify({ error: "Invalid user" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const adminStatus = await isAdminInFirestore(userUid);
    if (!adminStatus) {
      console.warn(`🚨 BLOCKED upload attempt | uid=${userUid} | email=${userEmail} | origin=${req.headers.get("Origin") || "unknown"} | ip=${req.headers.get("x-forwarded-for") || "unknown"} | time=${new Date().toISOString()}`);
      return new Response(
        JSON.stringify({ error: "Admin access required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { fileBase64, fileName, contentType } = await req.json();

    if (!fileBase64 || !fileName) {
      return new Response(
        JSON.stringify({ error: "fileBase64 and fileName are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const resolvedContentType = contentType || "image/webp";
    if (!ALLOWED_CONTENT_TYPES.includes(resolvedContentType)) {
      return new Response(
        JSON.stringify({ error: `Content type not allowed: ${resolvedContentType}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const estimatedSize = Math.ceil(fileBase64.length * 0.75);
    if (estimatedSize > MAX_FILE_SIZE) {
      return new Response(
        JSON.stringify({ error: "File too large. Max 5MB." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9._\-\/]/g, "_");

    // Decode base64 to bytes
    const binaryStr = atob(fileBase64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }

    // Upload to Cloudflare R2
    const fileUrl = await uploadToR2(sanitizedFileName, bytes, resolvedContentType);

    return new Response(
      JSON.stringify({ url: fileUrl }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Upload error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
    );
  }
});
