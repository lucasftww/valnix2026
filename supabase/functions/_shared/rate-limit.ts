import { getFirebaseAccessToken, FIREBASE_PROJECT_ID, FIRESTORE_BASE } from './firebase.ts';
import { getFirestoreDoc, addFirestoreDoc } from './firestore.ts';

const RATE_LIMIT_DOC_BASE = `projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/rate_limits`;
const COMMIT_URL = `${FIRESTORE_BASE}:commit`;

// ── Firestore-backed atomic rate limiter ──────────────────────────
export async function checkRateLimitFirestore(
  key: string, maxAttempts: number, windowMs: number, blockMs: number
): Promise<{ allowed: boolean; attempts: number }> {
  const docId = key.replace(/[\/\.]/g, '_');
  const docPath = `${RATE_LIMIT_DOC_BASE}/${docId}`;
  const now = Date.now();
  const accessToken = await getFirebaseAccessToken();

  try {
    const doc = await getFirestoreDoc('rate_limits', docId);
    const fields = doc?.fields || doc;

    if (fields && fields.reset_at) {
      const blockedUntil = Number(fields.blocked_until?.integerValue || '0');
      if (blockedUntil > now) {
        return { allowed: false, attempts: Number(fields.count?.integerValue || '0') };
      }
      const resetAt = Number(fields.reset_at?.integerValue || '0');
      const count = Number(fields.count?.integerValue || '0');

      if (resetAt > now) {
        const shouldBlock = count >= maxAttempts;
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
                    blocked_until: { integerValue: String(shouldBlock ? now + blockMs : 0) },
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
          console.warn(`⚠️ Rate limit commit failed: ${commitRes.status}`);
          return { allowed: true, attempts: count };
        }
        return { allowed: !shouldBlock, attempts: count + 1 };
      }
    }

    // Window expired or doc doesn't exist — reset
    const resetRes = await fetch(COMMIT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
      body: JSON.stringify({
        writes: [{
          update: {
            name: docPath,
            fields: {
              count: { integerValue: '1' },
              reset_at: { integerValue: String(now + windowMs) },
              blocked_until: { integerValue: '0' },
              updated_at: { timestampValue: new Date().toISOString() },
            },
          },
        }],
      }),
    });
    if (!resetRes.ok) console.warn(`⚠️ Rate limit reset failed: ${resetRes.status}`);
    return { allowed: true, attempts: 1 };
  } catch (e) {
    console.warn('⚠️ Rate limit check failed, allowing request:', e);
    return { allowed: true, attempts: 0 };
  }
}

// ── Rate limit logging ────────────────────────────────────────────
export async function logRateLimitBlock(source: string, ip: string, attempts: number): Promise<void> {
  try {
    await addFirestoreDoc('rate_limit_logs', {
      source, ip, attempts,
      blocked_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    });
    console.warn(`🛡️ Rate limit block logged: ${source} | IP: ${ip} | Attempts: ${attempts}`);
  } catch (e) {
    console.warn('⚠️ Failed to log rate limit block:', e);
  }
}

// ── In-memory rate limiter (for non-Firestore-backed functions) ───
export function createInMemoryRateLimiter(config?: { max?: number; windowMs?: number; blockMs?: number }) {
  const RL_MAX = config?.max ?? 30;
  const RL_WINDOW_MS = config?.windowMs ?? 60_000;
  const RL_BLOCK_MS = config?.blockMs ?? 120_000;
  const map = new Map<string, { count: number; resetAt: number; blockedUntil: number }>();

  function check(ip: string): { allowed: boolean; retryAfter?: number } {
    const now = Date.now();
    const entry = map.get(ip);
    if (entry && entry.blockedUntil > now) {
      return { allowed: false, retryAfter: Math.ceil((entry.blockedUntil - now) / 1000) };
    }
    if (!entry || entry.resetAt <= now) {
      map.set(ip, { count: 1, resetAt: now + RL_WINDOW_MS, blockedUntil: 0 });
      return { allowed: true };
    }
    entry.count++;
    if (entry.count > RL_MAX) {
      entry.blockedUntil = now + RL_BLOCK_MS;
      return { allowed: false, retryAfter: Math.ceil(RL_BLOCK_MS / 1000) };
    }
    return { allowed: true };
  }

  function maybeCleanup() {
    if (map.size < 200) return;
    const now = Date.now();
    for (const [k, v] of map) {
      if (v.resetAt <= now && v.blockedUntil <= now) map.delete(k);
    }
  }

  return { check, maybeCleanup };
}
