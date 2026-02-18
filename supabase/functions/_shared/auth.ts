// ── HMAC Admin Token Verification ──────────────────────────────────
const TOKEN_TTL_MS = 1 * 60 * 60 * 1000; // 1 hour

export async function verifyAdminToken(token: string): Promise<boolean> {
  const adminPassword = Deno.env.get("ADMIN_PASSWORD");
  if (!adminPassword) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [timestampHex, nonce, providedHmac] = parts;
  const timestamp = parseInt(timestampHex, 16);
  if (isNaN(timestamp)) return false;
  const now = Date.now();
  if (now - timestamp > TOKEN_TTL_MS) return false;
  if (timestamp > now + 60_000) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(adminPassword), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`${timestampHex}:${nonce}:admin`));
  const expectedHmac = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
  if (providedHmac.length !== expectedHmac.length) return false;
  let diff = 0;
  for (let i = 0; i < providedHmac.length; i++) { diff |= providedHmac.charCodeAt(i) ^ expectedHmac.charCodeAt(i); }
  return diff === 0;
}

// ── Constant-time comparison ──────────────────────────────────────
export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  const max = Math.max(ab.length, bb.length);
  let result = ab.length ^ bb.length;
  for (let i = 0; i < max; i++) {
    result |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return result === 0;
}
