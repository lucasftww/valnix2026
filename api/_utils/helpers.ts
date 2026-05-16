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
 * TTL: 1h.
 */
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
  if (!Number.isFinite(ts) || Date.now() - ts > TOKEN_TTL_MS) return false;
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
