/**
 * In-session deduplication for Meta Pixel + CAPI events.
 *
 * There are TWO levels of dedup we need to think about:
 *   (a) Pixel ↔ CAPI dedup — same physical event arriving via both browser
 *       and server. Handled by sending the same `event_id` to both; Meta
 *       combines them automatically.
 *   (b) INTRA-SESSION dedup — same user firing the same event multiple
 *       times in one session (impatient clicks, F5 reloads, route
 *       changes, React StrictMode double-render). Meta does dedupe
 *       within a ~1h window by event_id, but we can be more conservative
 *       client-side to avoid polluting the funnel with noise.
 *
 * This module is dedicated to (b). Uses sessionStorage so it resets per
 * tab/session — different days = fresh tracking.
 *
 * Naming convention for keys: `valnix_evt_dedup_<event>_<sub>` where
 * <sub> is whatever uniquely identifies the event subject (orderId,
 * productId, email, etc.).
 */

const PREFIX = 'valnix_evt_dedup_';

/**
 * Check-and-set guard. Returns true if the event can fire (first time
 * this session) and atomically marks it as fired. Returns false on
 * subsequent calls.
 *
 *   if (!shouldFireOnce('PageView', 'session')) return;
 *   ...fire event...
 */
export function shouldFireOnce(eventName: string, identifier: string | null | undefined): boolean {
  if (typeof window === 'undefined') return false;
  const sub = (identifier ?? 'global').toString().trim() || 'global';
  const key = `${PREFIX}${eventName}_${sub}`;
  try {
    if (sessionStorage.getItem(key)) return false;
    sessionStorage.setItem(key, String(Date.now()));
    return true;
  } catch {
    // sessionStorage may be unavailable (Safari private mode quirks).
    // Fall through to allow firing — better to fire twice than miss.
    return true;
  }
}

/**
 * Check-and-set guard with cooldown (ms). Use for events that CAN fire
 * again after a delay (e.g., same product viewed multiple times across
 * the session — 30min cool-down is sane).
 */
export function shouldFireWithCooldown(
  eventName: string,
  identifier: string | null | undefined,
  cooldownMs: number,
): boolean {
  if (typeof window === 'undefined') return false;
  const sub = (identifier ?? 'global').toString().trim() || 'global';
  const key = `${PREFIX}${eventName}_${sub}`;
  try {
    const last = sessionStorage.getItem(key);
    if (last) {
      const ts = parseInt(last, 10);
      if (Number.isFinite(ts) && Date.now() - ts < cooldownMs) return false;
    }
    sessionStorage.setItem(key, String(Date.now()));
    return true;
  } catch {
    return true;
  }
}

/**
 * Detect crude bot / preview clients we don't want polluting the Meta
 * pixel + analytics tables. Run BEFORE any tracker fires.
 *
 *   if (isProbablyBot()) return;
 *   ...fire event...
 */
const BOT_REGEX =
  /bot|crawler|spider|crawling|googlebot|bingbot|slurp|duckduckbot|baiduspider|yandex|sogou|exabot|facebot|ia_archiver|prerender|chrome-lighthouse|pagespeed|gtmetrix/i;

export function isProbablyBot(): boolean {
  if (typeof navigator === 'undefined') return false;
  // 1. UA match — covers Googlebot, Lighthouse, PageSpeed, etc.
  if (BOT_REGEX.test(navigator.userAgent || '')) return true;
  // 2. Headless flag (Puppeteer / Chrome --headless)
  if ((navigator as { webdriver?: boolean }).webdriver) return true;
  return false;
}
