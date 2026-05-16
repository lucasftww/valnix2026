import axios, { isAxiosError } from 'axios';

// ============================================================================
// Dice payment gateway helpers (server-side only).
//
// Auth: POST /api/v1/auth/login → JWT (30 min TTL).
// We cache the token in-memory with a small safety margin so a request that
// arrives just before expiry doesn't race the refresh.
// ============================================================================

export const DICE_BASE_URL = (process.env.DICE_BASE_URL || 'https://dev.use-dice.com').replace(/\/+$/, '');
const CLIENT_ID = process.env.DICE_CLIENT_ID || '';
const CLIENT_SECRET = process.env.DICE_CLIENT_SECRET || '';
const TOKEN_TTL_MS = 25 * 60 * 1000; // refresh 5 min before nominal expiry

interface CachedToken {
  token: string;
  expiresAt: number;
}

let cached: CachedToken | null = null;
let inflight: Promise<string> | null = null;

export function diceCredsConfigured(): boolean {
  return !!(CLIENT_ID && CLIENT_SECRET);
}

async function loginOnce(): Promise<string> {
  const res = await axios.post(
    `${DICE_BASE_URL}/api/v1/auth/login`,
    { client_id: CLIENT_ID, client_secret: CLIENT_SECRET },
    { timeout: 10_000, headers: { 'Content-Type': 'application/json' } },
  );
  // Dice docs aren't 100% explicit about the response field name. Accept the
  // common variants without surprising the caller.
  const data = res.data as Record<string, unknown>;
  const token =
    (typeof data.token === 'string' && data.token) ||
    (typeof data.access_token === 'string' && data.access_token) ||
    (typeof data.jwt === 'string' && data.jwt) ||
    '';
  if (!token) throw new Error('Dice login: missing token in response');
  return token;
}

export async function getDiceToken(forceRefresh = false): Promise<string> {
  if (!diceCredsConfigured()) {
    throw new Error('Dice credentials not configured (DICE_CLIENT_ID / DICE_CLIENT_SECRET).');
  }
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) return cached.token;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const token = await loginOnce();
      cached = { token, expiresAt: Date.now() + TOKEN_TTL_MS };
      return token;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/**
 * Wrap a Dice API call with auto-retry-after-refresh on 401/403. Single retry
 * — if the second call also fails auth, we bubble the error up.
 */
export async function diceFetch<T = unknown>(
  doRequest: (token: string) => Promise<T>,
): Promise<T> {
  let token = await getDiceToken();
  try {
    return await doRequest(token);
  } catch (err) {
    if (isAxiosError(err) && (err.response?.status === 401 || err.response?.status === 403)) {
      token = await getDiceToken(true);
      return doRequest(token);
    }
    throw err;
  }
}

export interface DiceDepositPayload {
  product_name: string;
  amount: number;
  payer: { name: string; email?: string; document?: string };
  external_id: string;
  clientCallbackUrl?: string;
}

export interface DiceDepositResponse {
  transaction_id: string;
  qr_code_text: string;
  expires_in?: number;
  expires_at?: string;
  status?: string;
}

/** Tries common shapes Dice may return — picks first non-empty match. */
export function pickField<T = string>(obj: Record<string, unknown>, keys: string[]): T | undefined {
  for (const key of keys) {
    const v = obj[key];
    if (v !== undefined && v !== null && v !== '') return v as T;
  }
  return undefined;
}
