import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { getCorsHeaders } from '../_shared/cors.ts';
import { getFirebaseAccessToken, FIREBASE_PROJECT_ID } from '../_shared/firebase.ts';

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES = ["image/webp", "image/png", "image/jpeg", "image/jpg", "image/gif", "image/avif"];
const FIREBASE_API_KEY = Deno.env.get('FIREBASE_WEB_API_KEY') || '';

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
  const endpoint = Deno.env.get('R2_ENDPOINT')!;
  const publicUrl = Deno.env.get('R2_PUBLIC_URL')!;
  const bucket = 'valnix-assets';
  const endpointUrl = new URL(endpoint);
  const host = endpointUrl.host;
  const objectPath = `/${bucket}/valnix-upload/${fileName}`;
  const now = new Date();
  const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, '');
  const amzDate = now.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const region = 'auto'; const service = 's3';
  const payloadHash = toHex(await crypto.subtle.digest('SHA-256', body));
  const cacheControlValue = 'public, max-age=31536000, immutable';
  const canonicalHeaders = `cache-control:${cacheControlValue}\ncontent-type:${contentType}\nhost:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'cache-control;content-type;host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = `PUT\n${objectPath}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalRequest)))}`;
  const signingKey = await getSignatureKey(secretAccessKey, dateStamp, region, service);
  const signature = toHex(await hmacSHA256(signingKey, stringToSign));
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const uploadUrl = `https://${host}${objectPath}`;
  const res = await fetch(uploadUrl, { method: 'PUT', headers: { 'Authorization': authorization, 'Content-Type': contentType, 'Cache-Control': cacheControlValue, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate }, body: body });
  if (!res.ok) { const errText = await res.text(); throw new Error(`R2 upload failed: ${res.status} - ${errText}`); }
  const fileUrl = `${publicUrl.replace(/\/$/, '')}/valnix-upload/${fileName}`;
  console.log(`✅ Uploaded to R2: ${fileUrl}`);
  return fileUrl;
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req, { methods: "POST, OPTIONS" });
  if (!corsHeaders) return new Response("Forbidden", { status: 403 });
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const idToken = authHeader.replace("Bearer ", "");
    const verifyRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_API_KEY}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken }) });
    if (!verifyRes.ok) return new Response(JSON.stringify({ error: "Invalid token" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const verifyData = await verifyRes.json();
    const userUid = verifyData?.users?.[0]?.localId;
    const userEmail = verifyData?.users?.[0]?.email?.toLowerCase();
    if (!userUid) return new Response(JSON.stringify({ error: "Invalid user" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const adminStatus = await isAdminInFirestore(userUid);
    if (!adminStatus) {
      console.warn(`🚨 BLOCKED upload attempt | uid=${userUid} | email=${userEmail}`);
      return new Response(JSON.stringify({ error: "Admin access required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const { fileBase64, fileName, contentType } = await req.json();
    if (!fileBase64 || !fileName) return new Response(JSON.stringify({ error: "fileBase64 and fileName are required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const resolvedContentType = contentType || "image/webp";
    if (!ALLOWED_CONTENT_TYPES.includes(resolvedContentType)) return new Response(JSON.stringify({ error: `Content type not allowed: ${resolvedContentType}` }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const estimatedSize = Math.ceil(fileBase64.length * 0.75);
    if (estimatedSize > MAX_FILE_SIZE) return new Response(JSON.stringify({ error: "File too large. Max 5MB." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9._\-\/]/g, "_");
    const binaryStr = atob(fileBase64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
    const fileUrl = await uploadToR2(sanitizedFileName, bytes, resolvedContentType);
    return new Response(JSON.stringify({ url: fileUrl }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("Upload error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...getCorsHeaders(req, { methods: "POST, OPTIONS" }), "Content-Type": "application/json" } });
  }
});
