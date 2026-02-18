/**
 * Admin token helpers — shared across all admin components and hooks.
 * Token is stored in sessionStorage (clears on tab close).
 */
const ADMIN_TOKEN_KEY = "valnix_admin_token";
const TOKEN_TTL_MS = 3600000; // 1h

/** In-memory flag: once a 401 is received, block further admin calls */
let adminSessionInvalid = false;

export function isAdminSessionInvalid(): boolean {
  return adminSessionInvalid;
}

export function getAdminToken(): string | null {
  if (adminSessionInvalid) return null;
  try {
    const token = sessionStorage.getItem(ADMIN_TOKEN_KEY);
    if (!token) return null;
    // Token format: timestampHex.nonce.hmac — check TTL client-side
    const parts = token.split(".");
    if (parts.length >= 3) {
      const ts = parseInt(parts[0], 16);
      if (!isNaN(ts) && Date.now() - ts > TOKEN_TTL_MS) {
        sessionStorage.removeItem(ADMIN_TOKEN_KEY);
        return null;
      }
    }
    return token;
  } catch {
    return null;
  }
}

export function setAdminToken(token: string): void {
  adminSessionInvalid = false;
  try {
    sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
  } catch {}
}

export function clearAdminToken(): void {
  adminSessionInvalid = true;
  try {
    sessionStorage.removeItem(ADMIN_TOKEN_KEY);
  } catch {}
}

/**
 * Get admin token or throw. Use in admin API calls.
 * If session was invalidated by a 401, throws immediately (no network call).
 */
export function requireAdminToken(): string {
  const token = getAdminToken();
  if (!token) throw new Error("Not authenticated as admin");
  return token;
}
