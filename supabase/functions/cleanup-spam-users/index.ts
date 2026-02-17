import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const FIREBASE_PROJECT_ID = "valnix";

// ── Firebase Auth helpers (reused pattern from admin-data) ──
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
    scope: 'https://www.googleapis.com/auth/identitytoolkit',
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

// ── Firebase Auth: list users ──
async function listAllUsers(accessToken: string): Promise<{ localId: string; email?: string }[]> {
  const allUsers: { localId: string; email?: string }[] = [];
  let nextPageToken: string | undefined;
  const apiKey = Deno.env.get('FIREBASE_WEB_API_KEY');

  for (let page = 0; page < 100; page++) {
    const body: any = { maxResults: 1000 };
    if (nextPageToken) body.nextPageToken = nextPageToken;

    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/accounts:batchGet`,
      {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${accessToken}` },
      }
    );

    // Use the REST API with pagination
    const listRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/accounts:batchGet?maxResults=1000${nextPageToken ? `&nextPageToken=${nextPageToken}` : ''}`,
      {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      }
    );

    if (!listRes.ok) {
      console.error(`Failed to list users: ${listRes.status}`, await listRes.text());
      break;
    }

    const data = await listRes.json();
    const users = data.users || [];
    allUsers.push(...users);

    nextPageToken = data.nextPageToken;
    if (!nextPageToken || users.length === 0) break;
  }

  return allUsers;
}

// ── Firebase Auth: delete user ──
async function deleteUser(accessToken: string, uid: string): Promise<boolean> {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/accounts:delete`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
      body: JSON.stringify({ localId: uid }),
    }
  );
  return res.ok;
}

// ── Firebase Auth: batch delete users ──
async function batchDeleteUsers(accessToken: string, uids: string[]): Promise<{ success: number; failed: number }> {
  // Firebase supports batch delete up to 1000 at a time
  let success = 0;
  let failed = 0;

  for (let i = 0; i < uids.length; i += 1000) {
    const batch = uids.slice(i, i + 1000);
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/accounts:batchDelete`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
        body: JSON.stringify({ localIds: batch, force: true }),
      }
    );

    if (res.ok) {
      const data = await res.json();
      const errors = data.errors || [];
      success += batch.length - errors.length;
      failed += errors.length;
    } else {
      console.error(`Batch delete failed:`, await res.text());
      failed += batch.length;
    }
  }

  return { success, failed };
}

// ── Firestore cleanup: delete spam docs ──
async function deleteFirestoreSpamDocs(accessToken: string, collection: string, uids: string[]) {
  let deleted = 0;
  for (const uid of uids) {
    const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${collection}/${uid}`;
    const res = await fetch(url, { method: 'DELETE', headers: { 'Authorization': `Bearer ${accessToken}` } });
    if (res.ok) deleted++;
  }
  return deleted;
}

// ── CORS ──
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
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-firebase-token",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

// ── Verify admin via Firestore user_roles ──
async function verifyFirebaseToken(idToken: string): Promise<{ uid: string; email: string } | null> {
  const apiKey = Deno.env.get('FIREBASE_WEB_API_KEY');
  if (!apiKey) return null;
  const res = await fetch(
    `https://www.googleapis.com/identitytoolkit/v3/relyingparty/getAccountInfo?key=${apiKey}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken }) }
  );
  if (!res.ok) return null;
  const data = await res.json();
  const user = data.users?.[0];
  if (!user?.localId) return null;
  return { uid: user.localId, email: user.email || '' };
}

async function isAdminInFirestore(uid: string, accessToken: string): Promise<boolean> {
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/user_roles/${uid}`;
  const res = await fetch(url, { headers: { 'Authorization': `Bearer ${accessToken}` } });
  if (!res.ok) return false;
  const doc = await res.json();
  return doc.fields?.role?.stringValue === 'admin';
}

// ════════════════════════════════════════════════════════════════════
Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    // Parse body first
    const body = await req.json().catch(() => ({}));

    // ── Admin auth check ──
    const firebaseToken = req.headers.get("x-firebase-token");
    const cronSecret = body.secret || req.headers.get("x-cron-secret");
    const expectedCronSecret = Deno.env.get("CRON_SECRET");
    // Also accept FIREBASE_WEB_API_KEY as auth for one-time admin operations
    const expectedApiKey = Deno.env.get("FIREBASE_WEB_API_KEY");

    console.log(`Auth: hasSecret=${!!cronSecret}, hasCronEnv=${!!expectedCronSecret}, firebase=${!!firebaseToken}`);
    let isAuthorized = false;

    if (cronSecret && expectedCronSecret && cronSecret === expectedCronSecret) {
      isAuthorized = true;
    } else if (cronSecret && expectedApiKey && cronSecret === expectedApiKey) {
      isAuthorized = true;
    } else if (firebaseToken) {
      const caller = await verifyFirebaseToken(firebaseToken);
      if (!caller) {
        return new Response(JSON.stringify({ error: "Invalid token" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const accessTokenCheck = await getFirebaseAccessToken();
      const isAdmin = await isAdminInFirestore(caller.uid, accessTokenCheck);
      if (!isAdmin) {
        console.warn(`🚫 Non-admin tried cleanup: uid=${caller.uid} email=${caller.email}`);
        return new Response(JSON.stringify({ error: "Admin only" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      isAuthorized = true;
      console.log(`✅ Authorized admin: ${caller.email}`);
    }

    if (!isAuthorized) {
      return new Response(JSON.stringify({ error: "Auth required" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Use already parsed body ──
    const pattern = body.pattern || "spam_quota_attack";
    const dryRun = body.dryRun === true;

    const accessToken = await getFirebaseAccessToken();
    console.log(`🧹 Cleanup started | pattern="${pattern}" | dryRun=${dryRun}`);

    // ── List all users and filter spam ──
    const allUsers = await listAllUsers(accessToken);
    const spamUsers = allUsers.filter(u => u.email && u.email.toLowerCase().includes(pattern.toLowerCase()));

    console.log(`Found ${spamUsers.length} spam users out of ${allUsers.length} total`);

    if (dryRun) {
      return new Response(JSON.stringify({
        dryRun: true,
        totalUsers: allUsers.length,
        spamUsersFound: spamUsers.length,
        sampleEmails: spamUsers.slice(0, 10).map(u => u.email),
      }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Delete from Firebase Auth ──
    const spamUids = spamUsers.map(u => u.localId);
    const authResult = await batchDeleteUsers(accessToken, spamUids);

    // ── Cleanup Firestore docs (users, profiles) ──
    const [usersDeleted, profilesDeleted] = await Promise.all([
      deleteFirestoreSpamDocs(accessToken, 'users', spamUids),
      deleteFirestoreSpamDocs(accessToken, 'profiles', spamUids),
    ]);

    const result = {
      totalUsers: allUsers.length,
      spamUsersFound: spamUsers.length,
      authDeleted: authResult.success,
      authFailed: authResult.failed,
      firestoreUsersDeleted: usersDeleted,
      firestoreProfilesDeleted: profilesDeleted,
    };

    console.log(`✅ Cleanup complete:`, JSON.stringify(result));

    return new Response(JSON.stringify(result), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("❌ Cleanup error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
