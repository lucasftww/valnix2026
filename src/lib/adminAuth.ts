/**
 * Admin token helpers — shared across all admin components and hooks.
 * Token is stored in sessionStorage (clears on tab close).
 */
const ADMIN_TOKEN_KEY = "valnix_admin_token";

export function getAdminToken(): string | null {
  try {
    return sessionStorage.getItem(ADMIN_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setAdminToken(token: string): void {
  try {
    sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
  } catch {}
}

export function clearAdminToken(): void {
  try {
    sessionStorage.removeItem(ADMIN_TOKEN_KEY);
  } catch {}
}

/**
 * Get admin token or throw. Use in admin API calls.
 */
export function requireAdminToken(): string {
  const token = getAdminToken();
  if (!token) throw new Error("Not authenticated as admin");
  return token;
}
