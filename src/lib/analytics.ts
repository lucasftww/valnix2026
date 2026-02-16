/**
 * Analytics tracking utilities
 * Records events via backend function for the admin funnel dashboard
 */
import { invokeFunction } from "@/lib/apiHelper";

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

export async function trackAnalyticsEvent(
  eventName: string,
  data: {
    userId?: string | null;
    value?: number;
    orderId?: string;
    contentName?: string;
    contentCategory?: string;
  } = {}
) {
  try {
    await invokeFunction('track-analytics', {
      body: {
        event_name: eventName,
        user_id: data.userId || null,
        page_url: window.location.href,
        device_type: getDeviceType(),
        browser: getBrowser(),
        value: data.value || null,
        currency: data.value ? 'BRL' : null,
        order_id: data.orderId || null,
        content_name: data.contentName || null,
        content_category: data.contentCategory || null,
      },
    });
  } catch (e) {
    console.warn('⚠️ Analytics event failed:', e);
  }
}

export const trackViewContentEvent = (userId?: string | null, contentName?: string, contentCategory?: string) =>
  trackAnalyticsEvent('ViewContent', { userId, contentName, contentCategory });

export const trackInitiateCheckoutEvent = (userId?: string | null, value?: number) =>
  trackAnalyticsEvent('InitiateCheckout', { userId, value });

export const trackPurchaseEvent = (userId?: string | null, value?: number, orderId?: string, contentName?: string) =>
  trackAnalyticsEvent('Purchase', { userId, value, orderId, contentName });
