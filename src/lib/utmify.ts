/**
 * UTMify Integration Utilities
 * Uses edge function proxy to avoid CORS issues with direct API calls.
 * Also attempts SDK-native tracking when available.
 * Includes event deduplication via unique event IDs.
 */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

/** Set of already-fired event IDs to prevent duplicates */
const firedEvents = new Set<string>();

interface UTMifyWindow extends Window {
  Utmify?: {
    track?: (event: string, data?: Record<string, unknown>) => void;
    initialized?: boolean;
  };
  pixelId?: string;
  utmify_loaded?: boolean;
}

/** Generate a unique event ID based on type + orderId (or random) */
function makeEventId(eventType: string, orderId?: string): string {
  return orderId ? `${eventType}_${orderId}` : `${eventType}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Send event via server-side proxy (no CORS issues)
 */
const sendEventViaProxy = async (
  eventType: string,
  eventData: {
    value?: number;
    currency?: string;
    orderId?: string;
    customerEmail?: string;
  } = {}
): Promise<boolean> => {
  try {
    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/utmify-track`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SUPABASE_KEY}`,
        },
        body: JSON.stringify({
          type: eventType,
          sourceUrl: window.location.href,
          pageTitle: document.title,
          userAgent: navigator.userAgent,
          parameters: window.location.search || "",
          icCSSMatch: ".utmify-checkout",
          ...eventData,
        }),
      }
    );

    const data = await response.json();
    if (data.success) {
      console.log(`✅ UTMify ${eventType} sent via proxy`);
      return true;
    } else {
      console.warn(`⚠️ UTMify proxy returned:`, data);
      return false;
    }
  } catch (error) {
    console.warn(`⚠️ UTMify proxy error for ${eventType}:`, error);
    return false;
  }
};

/**
 * Try SDK first, then fall back to server proxy.
 * Deduplicates by event ID — same event never fires twice.
 */
export const trackUTMifyEvent = async (
  eventType: string,
  eventData: {
    value?: number;
    currency?: string;
    orderId?: string;
    customerEmail?: string;
  } = {}
): Promise<boolean> => {
  const eventId = makeEventId(eventType, eventData.orderId);

  // Dedupe: skip if already fired
  if (firedEvents.has(eventId)) {
    console.log(`⏭️ UTMify ${eventType} already fired (${eventId}), skipping`);
    return true;
  }
  firedEvents.add(eventId);

  try {
    console.log(`🔄 Tracking UTMify event: ${eventType} (${eventId})`);

    // Try SDK native tracking
    const win = window as UTMifyWindow;
    if (win.Utmify?.track) {
      try {
        win.Utmify.track(eventType, eventData);
        console.log(`✅ UTMify ${eventType} tracked via SDK`);
        return true; // SDK succeeded — do NOT fallback
      } catch (sdkError) {
        console.warn("⚠️ SDK track failed, using proxy:", sdkError);
      }
    }

    // Fallback: server-side proxy (only if SDK unavailable or failed)
    return sendEventViaProxy(eventType, eventData);
  } catch (error) {
    console.warn(`⚠️ UTMify ${eventType} tracking failed silently:`, error);
    return false;
  }
};

/**
 * Track Purchase event
 */
export const trackPurchase = async (
  orderId: string,
  value: number,
  customerEmail?: string
): Promise<boolean> => {
  return trackUTMifyEvent("Purchase", {
    value,
    currency: "BRL",
    orderId,
    customerEmail,
  });
};

/**
 * Track InitiateCheckout event
 */
export const trackInitiateCheckout = async (value: number): Promise<boolean> => {
  return trackUTMifyEvent("InitiateCheckout", {
    value,
    currency: "BRL",
  });
};

export const UTMIFY_PIXEL_ID = "6983b13f961e629ed63fae7a";
