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

// Generate or retrieve a stable checkout session ID (anti-inflate on refresh)
function getCheckoutSessionId(): string {
  const key = 'valnix_checkout_session_id';
  const existing = sessionStorage.getItem(key);
  if (existing) return existing;
  const id = `cs_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  sessionStorage.setItem(key, id);
  return id;
}

// Clear checkout session ID (call after purchase or cart clear)
export function clearCheckoutSessionId() {
  sessionStorage.removeItem('valnix_checkout_session_id');
}

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
}

export async function sendMetaCapiEvent(data: MetaCapiEventData) {
  try {
    // Capture client-side data
    const fbc = getCookie('_fbc');
    const fbp = getCookie('_fbp');

    // Use provided event_id or generate deterministic one
    const eventId = data.event_id
      ? data.event_id
      : data.order_id 
        ? `${data.event_name.trim().toLowerCase()}_${data.order_id}`
        : `${data.event_name.trim().toLowerCase()}_${Date.now()}`;

    const payload = {
      ...data,
      event_id: eventId,
      currency: 'BRL',
      event_source_url: window.location.href,
      user_agent: navigator.userAgent,
      fbc: fbc || undefined,
      fbp: fbp || undefined,
    };

    // Fire and forget - non-blocking
    invokeFunctionFireAndForget('meta-capi', payload).then(() => {
      console.log(`📡 Meta CAPI ${data.event_name} sent`);
    });
  } catch (e) {
    console.warn('⚠️ Meta CAPI helper error:', e);
  }
}

export function sendInitiateCheckout(params: {
  userId?: string;
  email?: string;
  phone?: string;
  name?: string;
  value?: number;
  productNames?: string[];
  productIds?: string[];
  quantities?: number[];
  prices?: number[];
}) {
  const nameParts = (params.name || '').split(' ');
  const checkoutSessionId = getCheckoutSessionId();
  
  // Build contents array for better catalog matching
  const contents: ContentItem[] = (params.productIds || []).map((id, i) => ({
    id,
    quantity: params.quantities?.[i] || 1,
    item_price: params.prices?.[i] || 0,
  }));

  const numItems = (params.quantities || []).reduce((sum, q) => sum + q, 0) || contents.length;

  sendMetaCapiEvent({
    event_name: 'InitiateCheckout',
    event_id: `initiatecheckout_${checkoutSessionId}`,
    value: params.value,
    content_name: params.productNames?.join(', '),
    content_ids: params.productIds || params.productNames,
    contents,
    num_items: numItems,
    email: params.email,
    phone: params.phone,
    first_name: nameParts[0],
    last_name: nameParts.slice(1).join(' ') || undefined,
    external_id: params.userId,
  });
}

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
}) {
  const nameParts = (params.name || '').split(' ');

  // Build contents array
  const contents: ContentItem[] = (params.productIds || []).map((id, i) => ({
    id,
    quantity: params.quantities?.[i] || 1,
    item_price: params.prices?.[i] || 0,
  }));

  const numItems = (params.quantities || []).reduce((sum, q) => sum + q, 0) || contents.length;

  // Clear checkout session on purchase
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
  });
}
