/**
 * UTMify Integration Utilities
 * 
 * Royal-like architecture:
 * - InitiateCheckout: via CSS class .utmify-checkout (pixel/DOM) — stays client-side
 * - Purchase: 100% server-side via webhook/edge function (api-credentials/orders + UTMIFY_API_TOKEN)
 * 
 * Purchase tracking is NOT done here — it's handled exclusively by:
 * 1. flowpay-pix webhook (PIX payments)
 * 2. utmify-track edge function (balance payments)
 */

export const UTMIFY_PIXEL_ID = "6983b13f961e629ed63fae7a";

/**
 * Track InitiateCheckout — handled by UTMify pixel via .utmify-checkout CSS class.
 * This function is a no-op; the actual tracking happens via the UTMify SDK/pixel
 * when it detects the .utmify-checkout class on checkout elements.
 */
export const trackInitiateCheckout = async (_value: number): Promise<boolean> => {
  console.log('📊 UTMify InitiateCheckout: handled by pixel (.utmify-checkout CSS class)');
  return true;
};

/**
 * @deprecated Purchase tracking is now 100% server-side (Royal-like model).
 * PIX → flowpay-pix webhook
 * Balance → utmify-track edge function
 * This function is kept as a no-op for backward compatibility.
 */
export const trackPurchase = async (
  _orderId: string,
  _value: number,
  _customerEmail?: string
): Promise<boolean> => {
  console.log('📊 UTMify Purchase: handled server-side (Royal-like model), skipping client-side');
  return true;
};

/**
 * @deprecated Use server-side tracking instead.
 */
export const trackUTMifyEvent = async (
  _eventType: string,
  _eventData: Record<string, unknown> = {}
): Promise<boolean> => {
  console.log('📊 UTMify events now handled server-side (Royal-like model)');
  return true;
};
