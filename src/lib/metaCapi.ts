/**
 * Meta CAPI client-side helper
 * Captures fbc/fbp cookies and sends events via backend function
 */
import { invokeFunctionFireAndForget } from "@/lib/apiHelper";

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

// ── Core sender ────────────────────────────────────────────────────
export async function sendMetaCapiEvent(data: MetaCapiEventData) {
  try {
    const fbc = getCookie('_fbc');
    const fbp = getCookie('_fbp');

    const eventId = data.event_id
      ? data.event_id
      : data.order_id 
        ? `${data.event_name.trim().toLowerCase()}_${data.order_id}`
        : `${data.event_name.trim().toLowerCase()}_${Date.now()}`;

    const payload = {
      ...data,
      event_id: eventId,
      currency: 'BRL',
      event_source_url: data.event_source_url || window.location.href,
      user_agent: navigator.userAgent,
      fbc: fbc || undefined,
      fbp: fbp || undefined,
    };

    invokeFunctionFireAndForget('meta-capi', payload).then(() => {
      console.log(`📡 Meta CAPI ${data.event_name} sent`);
    });
  } catch (e) {
    console.warn('⚠️ Meta CAPI helper error:', e);
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
    // Only include item_price if we have a real value — never guess/fabricate
    return price !== undefined && price > 0
      ? { id, quantity: qty, item_price: price }
      : { id, quantity: qty, item_price: 0 }; // Meta requires the field but 0 signals "unknown"
  });

  // If ALL prices are 0 (no real data), strip item_price entirely
  const hasAnyPrice = contents.some(c => c.item_price > 0);
  const cleanContents = hasAnyPrice
    ? contents
    : contents.map(({ id, quantity }) => ({ id, quantity, item_price: 0 }));

  const sumQty = cleanContents.reduce((sum, c) => sum + c.quantity, 0);
  return { contents: cleanContents, numItems: sumQty > 0 ? sumQty : undefined };
}

// ── InitiateCheckout ───────────────────────────────────────────────
// Called on checkout mount — NO form PII (user hasn't typed yet).
// Only sends data already available: userId, user email (if logged in),
// cart items, fbp/fbc (captured automatically in sendMetaCapiEvent).
export function sendInitiateCheckout(params: {
  userId?: string;
  userEmail?: string;       // from auth, NOT from form
  value?: number;
  productNames?: string[];
  productIds?: string[];
  quantities?: number[];
  prices?: number[];
}) {
  const checkoutSessionId = getCheckoutSessionId();
  const { contents, numItems } = buildContents(
    params.productIds, params.quantities, params.prices,
  );

  sendMetaCapiEvent({
    event_name: 'InitiateCheckout',
    event_id: `initiatecheckout_${checkoutSessionId}`,
    value: params.value,
    content_name: params.productNames?.join(', '),
    content_ids: params.productIds || params.productNames,
    contents,
    num_items: numItems,
    // Only auth-known PII — no form data at mount
    email: params.userEmail,
    external_id: params.userId,
  });
}

// ── Purchase (client-side) ─────────────────────────────────────────
// Called after payment confirmed — full PII available.
// event_id = purchase_{orderId} — MUST match server-side for dedup.
export function sendPurchaseFromClient(params: {
  orderId: string;
  value: number;
  userId?: string;
  email?: string;
  name?: string;
  productNames?: string[];
  productIds?: string[];
  quantities?: number[];
  prices?: number[];
  eventSourceUrl?: string;
}) {
  const nameParts = (params.name || '').split(' ');
  const { contents, numItems } = buildContents(
    params.productIds, params.quantities, params.prices,
  );

  clearCheckoutSessionId();

  sendMetaCapiEvent({
    event_name: 'Purchase',
    order_id: params.orderId,
    value: params.value,
    content_name: params.productNames?.join(', '),
    content_ids: params.productIds || params.productNames,
    contents,
    num_items: numItems,
    email: params.email,
    first_name: nameParts[0],
    last_name: nameParts.slice(1).join(' ') || undefined,
    external_id: params.userId,
    event_source_url: params.eventSourceUrl,
  });
}
