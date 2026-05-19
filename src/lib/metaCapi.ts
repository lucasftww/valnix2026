/**
 * Meta CAPI client-side helper
 * Captures fbc/fbp cookies and sends events via backend function
 */
import { invokeFunctionFireAndForget } from "@/lib/apiHelper";
import { generateEventId } from "@/lib/eventId";
import { shouldFireOnce, shouldFireWithCooldown, isProbablyBot } from "@/lib/eventDedup";

// ⏸️ MIGRATION FLAG: set to false when new pixel is ready
const PIXEL_PAUSED = false;

// Read cookie by name
function getCookie(name: string): string | undefined {
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return match ? decodeURIComponent(match[2]) : undefined;
}

// ── Checkout Session ID (localStorage for cross-tab stability) ─────
const CHECKOUT_SESSION_KEY = 'valnix_checkout_session_id';

function getCheckoutSessionId(): string {
  try {
    const existing = localStorage.getItem(CHECKOUT_SESSION_KEY);
    if (existing) return existing;
  } catch { /* localStorage unavailable */ }
  const id = `cs_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  try { localStorage.setItem(CHECKOUT_SESSION_KEY, id); } catch {}
  return id;
}

export function clearCheckoutSessionId() {
  try { localStorage.removeItem(CHECKOUT_SESSION_KEY); } catch {}
}

// ── Types ──────────────────────────────────────────────────────────
interface ContentItem {
  id: string;
  quantity: number;
  item_price: number;
}

interface MetaCapiEventData {
  event_name: string;
  event_id?: string;
  order_id?: string;
  value?: number;
  content_name?: string;
  content_ids?: string[];
  contents?: ContentItem[];
  num_items?: number;
  email?: string;
  phone?: string;
  first_name?: string;
  last_name?: string;
  external_id?: string;
  event_source_url?: string;
}

// ── Events that are sent via CAPI ──────────────────
// All 6 events are forwarded to /api/server-relay. Meta's dashboard
// (Events Manager → Settings → "Server events") currently only ATTRIBUTES
// optimization to InitiateCheckout + Purchase — but we still send the rest:
//   1. Each CAPI POST writes to our `analytics_events` table — source of
//      truth for the admin funnel.
//   2. Meta silently discards events that aren't enabled — no harm.
//   3. CAPI coverage on PageView matters: Meta surfaces a "Improve your
//      rate of Pixel events covered by Conversions API" recommendation
//      that lowers CPM by ~25% when PageView is dual-tracked. Both Pixel
//      and CAPI use the SAME event_id so Meta dedups correctly.
//      (PageView itself is fired from bootstrap.ts using sendBeacon, not
//      this helper — listed here for documentation only.)
const CAPI_ENABLED_EVENTS = ['PageView', 'AddToCart', 'Lead', 'AddPaymentInfo', 'InitiateCheckout', 'Purchase'];

// ── Core sender ────────────────────────────────────────────────────
export async function sendMetaCapiEvent(data: MetaCapiEventData) {
  try {
    const fbc = getCookie('_fbc');
    const fbp = getCookie('_fbp');

    const eventId = data.event_id || generateEventId(data.event_name, data.order_id);

    // Only allow specific events to be sent from client-side CAPI relay
    if (!CAPI_ENABLED_EVENTS.includes(data.event_name)) {
      if (import.meta.env.DEV) console.log(`⏭️ [Meta] CAPI skipped for ${data.event_name}`);
      return;
    }

    const payload = {
      ...data,
      event_id: eventId,
      currency: 'BRL',
      event_source_url: data.event_source_url || window.location.href,
      user_agent: navigator.userAgent,
      phone: data.phone || undefined,
      fbc: fbc || undefined,
      fbp: fbp || undefined,
    };

    // Updated to match the refined Vercel filenames (using hyphens)
    invokeFunctionFireAndForget('server-relay', payload).then(() => {
      if (import.meta.env.DEV) console.log(`📡 [Meta] CAPI ${data.event_name} sent — event_id=${eventId}`);
    });
  } catch (e) {
    if (import.meta.env.DEV) {
      console.warn('⚠️ Meta CAPI helper error:', e);
    }
  }
}


// ── Helper: build contents with safe fallbacks ─────────────────────
function buildContents(
  productIds?: string[],
  quantities?: number[],
  prices?: number[],
): { contents: ContentItem[] | undefined; numItems: number | undefined } {
  const ids = productIds || [];
  if (ids.length === 0) return { contents: undefined, numItems: undefined };

  const contents: ContentItem[] = ids.map((id, i) => {
    const qty = quantities?.[i] ?? 1;
    const price = prices?.[i];
    return price !== undefined && price > 0
      ? { id, quantity: qty, item_price: price }
      : { id, quantity: qty, item_price: 0 };
  });

  const hasAnyPrice = contents.some(c => c.item_price > 0);
  const cleanContents = hasAnyPrice
    ? contents
    : contents.map(({ id, quantity }) => ({ id, quantity, item_price: 0 }));

  const sumQty = cleanContents.reduce((sum, c) => sum + c.quantity, 0);
  return { contents: cleanContents, numItems: sumQty > 0 ? sumQty : undefined };
}

// ── ViewContent ────────────────────────────────────────────────────
// Pixel-only ViewContent per user request.
// DEDUP: same product viewed within 30min in a session = 1 event.
// Different products in same session = different events (correct).
export function sendViewContent(params: {
  productId?: string;
  productName?: string;
  value?: number;
}) {
  if (typeof window === "undefined" || isProbablyBot()) return;
  // 30-min cooldown per product — prevents F5/back-button noise on the
  // same product page from inflating ViewContent counts.
  if (!shouldFireWithCooldown('ViewContent', params.productId, 30 * 60 * 1000)) return;

  const fbq = (window as any).fbq;
  if (typeof fbq === 'function') {
    fbq('track', 'ViewContent', {
      content_name: params.productName,
      content_ids: params.productId ? [params.productId] : undefined,
      content_type: 'product',
      value: params.value,
      currency: 'BRL',
    }, { eventID: generateEventId('ViewContent', params.productId) });
  }
}

// ── AddToCart (Pixel + CAPI) ───────────────────────────────────────
// Hybrid so Meta can optimize ad campaigns for cart-add intent.
// DEDUP: 5-minute cooldown per product. Impatient users clicking
// "Add to cart" 5x = 1 event, but legitimate "add same product again
// after browsing for 10min" = 2 events.
export function sendAddToCart(params: {
  productId?: string;
  productName?: string;
  value?: number;
  quantity?: number;
}) {
  if (typeof window === 'undefined' || isProbablyBot()) return;
  if (!shouldFireWithCooldown('AddToCart', params.productId, 5 * 60 * 1000)) return;
  const eventId = generateEventId('AddToCart', params.productId);
  const contents = params.productId
    ? [{ id: params.productId, quantity: params.quantity ?? 1, item_price: params.value ?? 0 }]
    : undefined;

  // 1. Browser Pixel
  const fbq = (window as any).fbq;
  if (typeof fbq === 'function') {
    fbq('track', 'AddToCart', {
      content_name: params.productName,
      content_ids: params.productId ? [params.productId] : undefined,
      content_type: 'product',
      contents,
      num_items: params.quantity ?? 1,
      value: params.value,
      currency: 'BRL',
    }, { eventID: eventId });
  }

  // 2. Server CAPI (via Relay)
  sendMetaCapiEvent({
    event_name: 'AddToCart',
    event_id: eventId,
    value: params.value,
    content_name: params.productName,
    content_ids: params.productId ? [params.productId] : undefined,
    contents,
    num_items: params.quantity ?? 1,
  });
}

// ── AddPaymentInfo (Pixel + CAPI) ──────────────────────────────────
// Fired when a user reaches the PIX QR-Code step.
// DEDUP: once per orderId per session. QR re-render does not duplicate.
export function sendAddPaymentInfo(params: {
  orderId: string;
  value: number;
  email?: string;
  phone?: string;
}) {
  if (typeof window === 'undefined' || !params.orderId || isProbablyBot()) return;
  if (!shouldFireOnce('AddPaymentInfo', params.orderId)) return;
  const eventId = generateEventId('AddPaymentInfo', params.orderId);
  const fbq = (window as any).fbq;
  if (typeof fbq === 'function') {
    fbq('track', 'AddPaymentInfo', {
      content_category: 'pix',
      value: params.value,
      currency: 'BRL',
    }, { eventID: eventId });
  }
  sendMetaCapiEvent({
    event_name: 'AddPaymentInfo',
    event_id: eventId,
    order_id: params.orderId,
    value: params.value,
    email: params.email,
    phone: params.phone,
  });
}

// ── Lead (Pixel + CAPI) ────────────────────────────────────────────
// Fired when a user enters a valid email at checkout.
// DEDUP: once per (email, session). Same email re-typed = no duplicate;
// different email = new event.
export function sendLead(params: {
  email: string;
  phone?: string;
  value?: number;
}) {
  if (typeof window === 'undefined' || !params.email || isProbablyBot()) return;
  if (!shouldFireOnce('Lead', params.email)) return;

  const eventId = generateEventId('Lead', params.email);
  const fbq = (window as any).fbq;
  if (typeof fbq === 'function') {
    fbq('track', 'Lead', {
      content_category: 'checkout_email_provided',
      value: params.value,
      currency: params.value ? 'BRL' : undefined,
    }, { eventID: eventId });
  }
  sendMetaCapiEvent({
    event_name: 'Lead',
    event_id: eventId,
    email: params.email,
    phone: params.phone,
    value: params.value,
  });
}

// ── Search (Pixel only — CAPI is overkill for search) ──────────────
// DEDUP: same query in 10min = 1 event.
export function sendSearch(query: string) {
  if (typeof window === 'undefined' || !query || isProbablyBot()) return;
  const normalized = query.trim().toLowerCase().slice(0, 100);
  if (!shouldFireWithCooldown('Search', normalized, 10 * 60 * 1000)) return;

  const fbq = (window as any).fbq;
  if (typeof fbq === 'function') {
    fbq('track', 'Search', { search_string: query.slice(0, 100) },
      { eventID: generateEventId('Search', normalized) });
  }
}

// ── InitiateCheckout ───────────────────────────────────────────────
// Hybrid (Pixel + CAPI). DEDUP: keyed by checkoutSessionId which persists
// in localStorage — same checkout session = same event_id = Meta dedups.
// We also block re-firing within the session via sessionStorage so the
// browser pixel doesn't fire twice on quick F5/back-button.
export function sendInitiateCheckout(params: {
  userId?: string;
  userEmail?: string;
  userPhone?: string;
  userName?: string;
  value?: number;
  productNames?: string[];
  productIds?: string[];
  quantities?: number[];
  prices?: number[];
}) {
  if (typeof window === 'undefined' || isProbablyBot()) return;
  const checkoutSessionId = getCheckoutSessionId();
  if (!shouldFireOnce('InitiateCheckout', checkoutSessionId)) return;
  const { contents, numItems } = buildContents(
    params.productIds, params.quantities, params.prices,
  );

  const eventId = generateEventId('InitiateCheckout', checkoutSessionId);
  const nameParts = (params.userName || '').split(' ');

  // 1. Browser Pixel
  const fbq = (window as any).fbq;
  if (typeof fbq === 'function') {
    fbq('track', 'InitiateCheckout', {
      value: params.value,
      currency: 'BRL',
      content_name: params.productNames?.join(', '),
      content_ids: params.productIds || params.productNames,
      contents,
      num_items: numItems,
      content_type: 'product',
    }, { eventID: eventId });
  }

  // 2. Server CAPI (via Relay)
  sendMetaCapiEvent({
    event_name: 'InitiateCheckout',
    event_id: eventId,
    value: params.value,
    content_name: params.productNames?.join(', '),
    content_ids: params.productIds || params.productNames,
    contents,
    num_items: numItems,
    email: params.userEmail || undefined,
    phone: params.userPhone || undefined,
    first_name: nameParts[0] || undefined,
    last_name: nameParts.slice(1).join(' ') || undefined,
    external_id: params.userId,
  });
}

// ── Purchase (client-side pixel only) ──────────────────────────────
// Fires browser pixel fbq + CAPI relay. CRITICAL DEDUP: exactly ONCE
// per orderId per session. PIX-payment users often refresh the success
// page or click back/forward — without this guard, those reloads would
// each fire a Purchase event. event_id matches across Pixel+CAPI so Meta
// dedupes server-side too, but client-side guard is the first line.
export function sendPurchaseFromClient(params: {
  orderId: string;
  value: number;
  userId?: string;
  email?: string;
  phone?: string;
  name?: string;
  productNames?: string[];
  productIds?: string[];
  quantities?: number[];
  prices?: number[];
  eventSourceUrl?: string;
}) {
  if (typeof window === 'undefined' || !params.orderId || isProbablyBot()) return;
  // Bulletproof: even refreshes / React StrictMode double-mounts won't
  // refire. localStorage (not sessionStorage) so user can't bypass with
  // a new tab on the same order. Persists for 30 days then auto-expires.
  const lsKey = `valnix_purchase_fired_${params.orderId}`;
  try {
    const ts = localStorage.getItem(lsKey);
    if (ts && Date.now() - parseInt(ts, 10) < 30 * 24 * 60 * 60 * 1000) return;
    localStorage.setItem(lsKey, String(Date.now()));
  } catch {}

  const { contents, numItems } = buildContents(
    params.productIds, params.quantities, params.prices,
  );

  clearCheckoutSessionId();

  try {
    const eventId = generateEventId('Purchase', params.orderId);
    
    // 1. Browser Pixel
    const fbq = (window as any).fbq;
    if (typeof fbq === 'function') {
      fbq('track', 'Purchase', {
        content_ids: params.productIds || params.productNames,
        contents,
        content_name: params.productNames?.join(', '),
        content_type: 'product',
        value: params.value,
        currency: 'BRL',
        ...(numItems ? { num_items: numItems } : {}),
      }, { eventID: eventId });
    }

    // 2. Server CAPI (via Relay)
    sendMetaCapiEvent({
      event_name: 'Purchase',
      event_id: eventId,
      order_id: params.orderId,
      value: params.value,
      content_name: params.productNames?.join(', '),
      content_ids: params.productIds || params.productNames,
      contents,
      num_items: numItems,
      email: params.email || undefined,
      phone: params.phone || undefined,
      external_id: params.userId,
      event_source_url: params.eventSourceUrl || window.location.href,
    });
  } catch (e) {
    if (import.meta.env.DEV) console.warn('⚠️ Meta Purchase tracking error:', e);
  }
}


