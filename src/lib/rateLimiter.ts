// Simple client-side rate limiter for auth attempts
const attempts = new Map<string, { count: number; blockedUntil: number }>();

const MAX_ATTEMPTS = 5;
const BLOCK_DURATION_MS = 5 * 60 * 1000; // 5 minutes
const WINDOW_MS = 10 * 60 * 1000; // 10 minute window

export function checkRateLimit(key: string): { allowed: boolean; retryAfterSeconds?: number } {
  const now = Date.now();
  const entry = attempts.get(key);

  if (entry && entry.blockedUntil > now) {
    return { allowed: false, retryAfterSeconds: Math.ceil((entry.blockedUntil - now) / 1000) };
  }

  // Reset if block expired
  if (entry && entry.blockedUntil <= now && entry.count >= MAX_ATTEMPTS) {
    attempts.delete(key);
  }

  return { allowed: true };
}

export function recordFailedAttempt(key: string): void {
  const now = Date.now();
  const entry = attempts.get(key) || { count: 0, blockedUntil: 0 };

  entry.count += 1;

  if (entry.count >= MAX_ATTEMPTS) {
    entry.blockedUntil = now + BLOCK_DURATION_MS;
  }

  attempts.set(key, entry);

  // Auto-cleanup old entries
  if (attempts.size > 100) {
    for (const [k, v] of attempts) {
      if (v.blockedUntil < now && v.count < MAX_ATTEMPTS) attempts.delete(k);
    }
  }
}

export function resetAttempts(key: string): void {
  attempts.delete(key);
}
