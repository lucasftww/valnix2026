/**
 * Analytics tracking utilities.
 * Records events via /api/store-metrics for the admin funnel dashboard
 * (separate from Meta CAPI relay, which writes to analytics_events).
 *
 * Meta-style event names (PascalCase) are auto-converted to the snake_case
 * variants the store-metrics endpoint accepts (avoiding a silent 400).
 */
import { invokeFunctionFireAndForget } from "@/lib/apiHelper";

function getDeviceType(): string {
  const ua = navigator.userAgent;
  if (/tablet|ipad|playbook|silk/i.test(ua)) return 'tablet';
  if (/mobile|iphone|ipod|android|blackberry|opera mini|iemobile/i.test(ua)) return 'mobile';
  return 'desktop';
}

function getBrowser(): string {
  const ua = navigator.userAgent;
  if (ua.includes('Firefox')) return 'Firefox';
  if (ua.includes('Edg')) return 'Edge';
  if (ua.includes('Chrome')) return 'Chrome';
  if (ua.includes('Safari')) return 'Safari';
  return 'Other';
}

// Map Meta-style PascalCase to the snake_case names the server-side whitelist
// uses. Keeps callers free to use whichever convention they prefer.
const EVENT_NAME_MAP: Record<string, string> = {
  PageView: 'page_view',
  ViewContent: 'view_content',
  AddToCart: 'add_to_cart',
  RemoveFromCart: 'remove_from_cart',
  InitiateCheckout: 'initiate_checkout',
  Purchase: 'purchase',
  Search: 'search',
  Click: 'click',
};

function normalizeEventName(name: string): string {
  return EVENT_NAME_MAP[name] ?? name;
}

export function trackAnalyticsEvent(
  eventName: string,
  data: {
    userId?: string | null;
    value?: number;
    orderId?: string;
    contentName?: string;
  } = {}
) {
  // Fire-and-forget — NEVER await analytics during checkout flow.
  invokeFunctionFireAndForget('store-metrics', {
    event_name: normalizeEventName(eventName),
    user_id: data.userId || null,
    page_url: window.location.href,
    device_type: getDeviceType(),
    browser: getBrowser(),
    value: data.value || null,
    currency: data.value ? 'BRL' : null,
    order_id: data.orderId || null,
    content_name: data.contentName || null,
  });
}

export const trackPageViewEvent = (userId?: string | null) =>
  trackAnalyticsEvent('PageView', { userId });

export const trackViewContentEvent = (userId?: string | null, contentName?: string) =>
  trackAnalyticsEvent('ViewContent', { userId, contentName });

export const trackAddToCartEvent = (userId?: string | null, value?: number, contentName?: string) =>
  trackAnalyticsEvent('AddToCart', { userId, value, contentName });

export const trackInitiateCheckoutEvent = (userId?: string | null, value?: number) =>
  trackAnalyticsEvent('InitiateCheckout', { userId, value });

export const trackPurchaseEvent = (userId?: string | null, value?: number, orderId?: string, contentName?: string) =>
  trackAnalyticsEvent('Purchase', { userId, value, orderId, contentName });

export const trackSearchEvent = (userId: string | null | undefined, query: string) =>
  trackAnalyticsEvent('Search', { userId, contentName: query });
