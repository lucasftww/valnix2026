/**
 * UTM Parameter Capture & Persistence
 * Captures UTM params from URL on page entry and persists them in sessionStorage
 * so they survive navigation through the site (e.g., Discord → Home → Product → Checkout)
 */

const UTM_STORAGE_KEY = 'valnix_utm_params';
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];

export interface UtmParams {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
}

/**
 * Call on app mount. If the current URL has UTM params, save them to sessionStorage.
 * Only overwrites if new UTMs are present (first-touch within session).
 */
export function captureUtmParams(): void {
  try {
    const params = new URLSearchParams(window.location.search);
    const utms: UtmParams = {};
    let hasAny = false;

    for (const key of UTM_KEYS) {
      const val = params.get(key);
      if (val) {
        utms[key as keyof UtmParams] = val;
        hasAny = true;
      }
    }

    if (hasAny) {
      sessionStorage.setItem(UTM_STORAGE_KEY, JSON.stringify(utms));
      console.log('📊 UTM params captured:', utms);
    }
  } catch {
    // sessionStorage unavailable (incognito, etc.)
  }
}

/**
 * Returns the stored UTM params (or empty object).
 */
export function getStoredUtmParams(): UtmParams {
  try {
    const raw = sessionStorage.getItem(UTM_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * Returns the UTM params as a query string for UTMify's `parameters` field.
 * Example: "utm_source=discord&utm_medium=social&utm_campaign=comunidade"
 */
export function getUtmQueryString(): string {
  const utms = getStoredUtmParams();
  const parts: string[] = [];
  for (const [key, val] of Object.entries(utms)) {
    if (val) parts.push(`${key}=${encodeURIComponent(val)}`);
  }
  return parts.join('&');
}
