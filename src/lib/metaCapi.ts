/**
 * Meta CAPI client-side helper
 * Captures fbc/fbp cookies and sends events via backend function
 */
import { invokeFunctionFireAndForget } from "@/lib/apiHelper";
import { generateEventId } from "@/lib/eventId";

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
  content_category?: string;
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

// ── Events that the SERVER already sends via CAPI ──────────────────
// For these, the client only fires the browser pixel (fbq) for dedup.
// The server (webhook/polling) handles the CAPI call to avoid duplicates.
const SERVER_HANDLED_CAPI_EVENTS = ['Purchase'] as const;

// ── Core sender ────────────────────────────────────────────────────
export async function sendMetaCapiEvent(data: MetaCapiEventData) {
  try {
    const fbc = getCookie('_fbc');
    const fbp = getCookie('_fbp');

    const eventId = data.event_id || generateEventId(data.event_name, data.order_id);

    const isServerHandled = (SERVER_HANDLED_CAPI_EVENTS as readonly string[]).includes(data.event_name);

    // 🔒 DEFENSIVE: Purchase CAPI is ALWAYS server-only — never call from client
    if (isServerHandled) {
      if (import.meta.env.DEV) console.log(`🔒 [Meta] CAPI blocked client-side for ${data.event_name} — server handles it`);
    } else {
      // Only call the CAPI edge function if the server doesn't already handle it
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

      invokeFunctionFireAndForget('meta-capi', payload).then(() => {
        if (import.meta.env.DEV) console.log(`📡 [Meta] CAPI ${data.event_name} sent — event_id=${eventId}`);
      });
    }

    // ⏸️ PAUSED: Pixel browser desabilitado durante migração de BM
    // Quando novo pixel estiver pronto, setar PIXEL_PAUSED = false
    if (!PIXEL_PAUSED) {
      try {
        const PIXEL_WHITELIST = ['InitiateCheckout', 'Purchase'] as const;
        const pixelEvent = PIXEL_WHITELIST.find(e => e === data.event_name);
        if (pixelEvent) {
          const fbq = (window as any).fbq;
          if (typeof fbq === 'function') {
            fbq('track', pixelEvent, {
              value: data.value,
              currency: 'BRL',
              content_name: data.content_name,
              content_category: data.content_category,
              content_ids: data.content_ids,
              contents: data.contents,
              num_items: data.num_items,
            }, { eventID: eventId });
          }
        }
      } catch { /* best-effort pixel */ }
    }
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

// ── InitiateCheckout ───────────────────────────────────────────────
// Now called AFTER user validates email/phone — includes PII for better match quality.
export function sendInitiateCheckout(params: {
  userId?: string;
  userEmail?: string;
  userPhone?: string;
  userName?: string;
  value?: number;
  productNames?: string[];
  productIds?: string[];
  productCategories?: string[];
  quantities?: number[];
  prices?: number[];
}) {
  const checkoutSessionId = getCheckoutSessionId();
  const { contents, numItems } = buildContents(
    params.productIds, params.quantities, params.prices,
  );

  const nameParts = (params.userName || '').split(' ');

  // Derive content_category from product categories (unique, joined)
  const contentCategory = params.productCategories
    ? [...new Set(params.productCategories.filter(Boolean))].join(', ')
    : undefined;

  sendMetaCapiEvent({
    event_name: 'InitiateCheckout',
    event_id: generateEventId('InitiateCheckout', checkoutSessionId),
    value: params.value,
    content_name: params.productNames?.join(', '),
    content_category: contentCategory,
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
// Fires browser pixel fbq ONLY — CAPI is handled exclusively by server
// (webhook or polling fallback, both with idempotent guards).
// DO NOT send CAPI from client — it causes duplicate events in Meta.
export function sendPurchaseFromClient(params: {
  orderId: string;
  value: number;
  userId?: string;
  email?: string;
  phone?: string;
  name?: string;
  productNames?: string[];
  productIds?: string[];
  productCategories?: string[];
  quantities?: number[];
  prices?: number[];
  eventSourceUrl?: string;
}) {
  const { contents, numItems } = buildContents(
    params.productIds, params.quantities, params.prices,
  );

  clearCheckoutSessionId();

  // Derive content_category from product categories
  const contentCategory = params.productCategories
    ? [...new Set(params.productCategories.filter(Boolean))].join(', ')
    : undefined;

  // ⏸️ PAUSED: Pixel browser desabilitado durante migração de BM
  if (!PIXEL_PAUSED) {
    try {
      const eventId = generateEventId('Purchase', params.orderId);
      const fbq = (window as any).fbq;
      if (typeof fbq === 'function') {
        fbq('track', 'Purchase', {
          value: params.value,
          currency: 'BRL',
          content_name: params.productNames?.join(', '),
          content_category: contentCategory,
          content_ids: params.productIds || params.productNames,
          contents,
          num_items: numItems,
        }, { eventID: eventId });
      }
    } catch { /* best-effort pixel */ }
  }
}
