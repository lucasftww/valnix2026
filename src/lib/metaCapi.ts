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

// Get UTM params from sessionStorage
function getUtmParams(): Record<string, string> {
  try {
    const raw = sessionStorage.getItem('valnix_utm_params');
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

interface MetaCapiEventData {
  event_name: string;
  order_id?: string;
  value?: number;
  content_name?: string;
  content_ids?: string[];
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

    const payload = {
      ...data,
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
}) {
  const nameParts = (params.name || '').split(' ');
  sendMetaCapiEvent({
    event_name: 'InitiateCheckout',
    value: params.value,
    content_name: params.productNames?.join(', '),
    content_ids: params.productNames,
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
}) {
  const nameParts = (params.name || '').split(' ');
  sendMetaCapiEvent({
    event_name: 'Purchase',
    order_id: params.orderId,
    value: params.value,
    content_name: params.productNames?.join(', '),
    content_ids: params.productNames,
    email: params.email,
    first_name: nameParts[0],
    last_name: nameParts.slice(1).join(' ') || undefined,
    external_id: params.userId,
  });
}
