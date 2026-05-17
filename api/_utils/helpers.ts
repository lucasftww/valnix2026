import { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash, createHmac, timingSafeEqual } from 'crypto';

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1h — must match TOKEN_TTL_MS in src/lib/adminAuth.ts

/**
 * SHA-256 Hashing for Meta PII compliance
 */
export function hashData(data: string | undefined): string | null {
  if (!data) return null;
  const cleanData = data.trim().toLowerCase();
  return createHash('sha256').update(cleanData).digest('hex');
}

/**
 * Verify an admin token issued by api/admin-auth.ts.
 * Format: `${tsHex}.${nonce}.${hmacSha256(password, "${tsHex}.${nonce}")}`
 * TTL: 1h. Also rejects tokens with timestamps too far in the future (clock-skew guard).
 */
const CLOCK_SKEW_MS = 60_000; // accept up to 60s future skew

export function verifyAdminToken(token: string | null | undefined): boolean {
  if (!token) return false;
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('CRITICAL: ADMIN_PASSWORD not set in environment');
    }
    return false;
  }

  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [tsHex, nonce, sig] = parts;
  const ts = parseInt(tsHex, 16);
  if (!Number.isFinite(ts)) return false;
  const now = Date.now();
  // Reject expired AND future-dated tokens (previously only checked expiry — a token
  // with ts = year 9999 would parse as a positive future ts, making (now - ts) negative
  // and bypassing the > TTL check entirely).
  if (now - ts > TOKEN_TTL_MS) return false;
  if (ts - now > CLOCK_SKEW_MS) return false;
  if (!/^[0-9a-f]+$/i.test(nonce) || !/^[0-9a-f]+$/i.test(sig)) return false;

  const expected = createHmac('sha256', adminPassword)
    .update(`${tsHex}.${nonce}`)
    .digest('hex');
  try {
    const a = Buffer.from(sig, 'hex');
    const b = Buffer.from(expected, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Signs a payload for trusted internal calls between Vercel functions.
 * Used so e.g. dice-webhook can call process-delivery without an admin token.
 * The signing key is ADMIN_PASSWORD (always available server-side, never exposed).
 *
 * Header: X-Internal-Signature: <ts>.<hmac(payload + ts)>
 * TTL: 5 minutes (much tighter than admin tokens — these never leave server-to-server).
 */
const INTERNAL_TTL_MS = 5 * 60 * 1000;

export function signInternalRequest(payload: string): string {
  const key = process.env.ADMIN_PASSWORD || '';
  if (!key) return '';
  const ts = Date.now().toString();
  const sig = createHmac('sha256', key).update(`${ts}.${payload}`).digest('hex');
  return `${ts}.${sig}`;
}

export function verifyInternalSignature(header: string | undefined | null, payload: string): boolean {
  if (!header || typeof header !== 'string') return false;
  const key = process.env.ADMIN_PASSWORD || '';
  if (!key) return false;
  const dot = header.indexOf('.');
  if (dot <= 0) return false;
  const ts = parseInt(header.slice(0, dot), 10);
  const sig = header.slice(dot + 1);
  if (!Number.isFinite(ts) || !/^[0-9a-f]+$/i.test(sig)) return false;
  const now = Date.now();
  if (now - ts > INTERNAL_TTL_MS) return false;
  if (ts - now > CLOCK_SKEW_MS) return false;
  const expected = createHmac('sha256', key).update(`${ts}.${payload}`).digest('hex');
  try {
    const a = Buffer.from(sig, 'hex');
    const b = Buffer.from(expected, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Tiny in-memory rate-limiter for serverless functions. Per-process state, so
 * limits are roughly per-region per warm container — good enough as a brake
 * against trivial abuse without external infra (Redis).
 *
 * Usage: if (!rateLimit(`auth:${ip}`, 10, 60_000)) return 429.
 */
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
const MAX_BUCKETS = 5000; // cap memory; oldest entries evicted on overflow

export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    if (rateBuckets.size > MAX_BUCKETS) {
      // crude eviction: drop the first 10% of entries
      const drop = Math.floor(MAX_BUCKETS / 10);
      let i = 0;
      for (const k of rateBuckets.keys()) {
        rateBuckets.delete(k);
        if (++i >= drop) break;
      }
    }
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= max) return false;
  bucket.count++;
  return true;
}

/** Extract a best-effort client IP from common proxy headers. */
export function clientIp(req: VercelRequest): string {
  const xff = (req.headers['x-forwarded-for'] as string) || '';
  if (xff) return xff.split(',')[0].trim();
  const realIp = req.headers['x-real-ip'];
  if (typeof realIp === 'string' && realIp) return realIp;
  return (req.socket?.remoteAddress as string) || 'unknown';
}

/** RFC 5322-ish email validator (good enough for storage gates). */
export function isValidEmail(s: string): boolean {
  return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(s) && s.length <= 320;
}

/** Brazilian CPF or CNPJ digit count (no checksum, just shape). */
export function isValidDocument(digits: string): boolean {
  return digits.length === 11 || digits.length === 14;
}

/** UUID v4-ish validator. */
export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

const ALLOWED_ORIGINS = (process.env.ADMIN_ALLOWED_ORIGINS || 'https://www.valnix.com.br,https://valnix.com.br')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

/**
 * CORS handling for Vercel functions.
 * Only echoes back origins from ADMIN_ALLOWED_ORIGINS (defaults to valnix.com.br).
 * Never sends `Access-Control-Allow-Credentials: true` with `*` — that's spec violation
 * and a CSRF vector for authenticated admin endpoints.
 */
export function setCorsHeaders(res: VercelResponse, req?: VercelRequest) {
  const origin = req ? ((req.headers.origin as string) || '') : '';
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, x-admin-token'
  );
}

/** Safe message for API error responses and logs. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
