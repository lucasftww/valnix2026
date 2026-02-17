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
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-token",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };
}

// ── HMAC Token Generation & Verification ──────────────────────────
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

async function generateAdminToken(): Promise<string> {
  const adminPassword = Deno.env.get("ADMIN_PASSWORD");
  if (!adminPassword) throw new Error("ADMIN_PASSWORD not configured");

  const timestamp = Date.now().toString(16);
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(adminPassword),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`${timestamp}:admin`));
  const hmac = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
  return `${timestamp}.${hmac}`;
}

async function verifyAdminToken(token: string): Promise<boolean> {
  const adminPassword = Deno.env.get("ADMIN_PASSWORD");
  if (!adminPassword) return false;

  const parts = token.split(".");
  if (parts.length !== 2) return false;

  const [timestampHex, providedHmac] = parts;
  const timestamp = parseInt(timestampHex, 16);
  if (isNaN(timestamp)) return false;

  // Check TTL
  const now = Date.now();
  if (now - timestamp > TOKEN_TTL_MS) return false;
  if (timestamp > now + 60_000) return false; // future guard

  // Recompute HMAC
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(adminPassword),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`${timestampHex}:admin`));
  const expectedHmac = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");

  // Constant-time comparison
  if (providedHmac.length !== expectedHmac.length) return false;
  let diff = 0;
  for (let i = 0; i < providedHmac.length; i++) {
    diff |= providedHmac.charCodeAt(i) ^ expectedHmac.charCodeAt(i);
  }
  return diff === 0;
}

// ── Rate limiting ─────────────────────────────────────────────────
const loginAttempts = new Map<string, { count: number; blockedUntil: number }>();

function checkLoginRateLimit(ip: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (entry && entry.blockedUntil > now) {
    return { allowed: false, retryAfter: Math.ceil((entry.blockedUntil - now) / 1000) };
  }
  if (!entry || entry.blockedUntil <= now) {
    loginAttempts.set(ip, { count: (entry?.count || 0) + 1, blockedUntil: 0 });
  }
  const current = loginAttempts.get(ip)!;
  if (current.count > 5) {
    current.blockedUntil = now + 5 * 60 * 1000; // Block 5 minutes after 5 attempts
    return { allowed: false, retryAfter: 300 };
  }
  return { allowed: true };
}

// Reset successful login attempts
function resetLoginAttempts(ip: string) {
  loginAttempts.delete(ip);
}

// Cleanup old entries
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of loginAttempts) {
    if (v.blockedUntil <= now && v.count <= 5) loginAttempts.delete(k);
  }
}, 300_000);

// ════════════════════════════════════════════════════════════════════
Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

  try {
    // ── POST: Login ──
    if (req.method === "POST") {
      const rl = checkLoginRateLimit(clientIp);
      if (!rl.allowed) {
        return new Response(JSON.stringify({ error: "Too many attempts. Try again later." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": String(rl.retryAfter || 300) },
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

      resetLoginAttempts(clientIp);
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
