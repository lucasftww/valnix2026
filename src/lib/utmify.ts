 /**
  * UTMify Integration Utilities
  * Handles SDK loading verification and event sending with fallback
  */
 
 const UTMIFY_PIXEL_ID = "6983b13f961e629ed63fae7a";
 const UTMIFY_API_URL = "https://tracking.utmify.com.br/tracking/v1/events";
const SDK_LOAD_TIMEOUT = 3000; // 3 seconds timeout (reduced for better UX)
const API_FETCH_TIMEOUT = 5000; // 5 seconds for API calls
 
 interface UTMifyWindow extends Window {
   Utmify?: {
     track?: (event: string, data?: Record<string, unknown>) => void;
     initialized?: boolean;
   };
   pixelId?: string;
  utmify_loaded?: boolean;
 }
 
 interface UTMifyEventPayload {
   type: string;
   lead: {
     pixelId: string;
     userAgent: string;
     ip: string | null;
     parameters: string;
     icTextMatch: string | null;
     icCSSMatch: string | null;
     icURLMatch: string | null;
     leadTextMatch: string | null;
     addToCartTextMatch: string | null;
   };
   event: {
     sourceUrl: string;
     pageTitle: string;
     value?: number;
     currency?: string;
     orderId?: string;
     customerEmail?: string;
   };
   tikTokPageInfo: null;
 }
 
 /**
  * Check if UTMify SDK is loaded and ready
  */
 const isSDKReady = (): boolean => {
   const win = window as UTMifyWindow;
  // Check multiple indicators that SDK might be ready
  return !!(
    win.Utmify?.initialized || 
    win.utmify_loaded ||
    (win.pixelId === UTMIFY_PIXEL_ID && typeof win.Utmify !== 'undefined')
  );
 };
 
 /**
  * Wait for UTMify SDK to load with timeout
  */
 const waitForSDK = (timeout: number = SDK_LOAD_TIMEOUT): Promise<boolean> => {
   return new Promise((resolve) => {
     // Already loaded
     if (isSDKReady()) {
       console.log("✅ UTMify SDK already loaded");
       resolve(true);
       return;
     }
 
     const startTime = Date.now();
     
     const checkInterval = setInterval(() => {
       if (isSDKReady()) {
         clearInterval(checkInterval);
         console.log("✅ UTMify SDK loaded after wait");
         resolve(true);
         return;
       }
 
       // Timeout reached
       if (Date.now() - startTime >= timeout) {
         clearInterval(checkInterval);
         console.warn("⚠️ UTMify SDK load timeout - using API fallback");
         resolve(false);
       }
     }, 100); // Check every 100ms
   });
 };
 
 /**
  * Build the event payload for UTMify API
  */
 const buildEventPayload = (
   eventType: string,
   eventData: {
     value?: number;
     currency?: string;
     orderId?: string;
     customerEmail?: string;
   } = {}
 ): UTMifyEventPayload => {
   return {
     type: eventType,
     lead: {
       pixelId: UTMIFY_PIXEL_ID,
       userAgent: navigator.userAgent,
       ip: null, // Will be captured by UTMify
       parameters: window.location.search || "",
       icTextMatch: null,
       icCSSMatch: ".utmify-checkout",
       icURLMatch: null,
       leadTextMatch: null,
       addToCartTextMatch: null,
     },
     event: {
       sourceUrl: window.location.href,
       pageTitle: document.title,
       ...eventData,
     },
     tikTokPageInfo: null,
   };
 };
 
 /**
  * Send event directly via API (fallback method)
  */
 const sendEventViaAPI = async (payload: UTMifyEventPayload): Promise<boolean> => {
   try {
    // Create AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_FETCH_TIMEOUT);

    try {
      const response = await fetch(UTMIFY_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
        mode: 'cors',
      });

      clearTimeout(timeoutId);
 
      if (response.ok) {
        console.log(`📊 UTMify ${payload.type} event sent via API`);
        return true;
      } else {
        console.warn(`⚠️ UTMify API returned ${response.status}`);
        return false;
      }
    } catch (fetchError) {
      clearTimeout(timeoutId);
      
      // Handle specific error types gracefully
      if (fetchError instanceof Error) {
        if (fetchError.name === 'AbortError') {
          console.warn(`⚠️ UTMify API timeout for ${payload.type}`);
        } else if (fetchError.message.includes('Failed to fetch')) {
          console.warn(`⚠️ UTMify API network error for ${payload.type} (CORS or connectivity)`);
        } else {
          console.warn(`⚠️ UTMify API error for ${payload.type}:`, fetchError.message);
        }
      }
       return false;
     }
   } catch (error) {
    // Catch any unexpected errors silently to not break the app
    console.warn("⚠️ UTMify tracking failed silently:", error);
     return false;
   }
 };
 
 /**
  * Main function to track UTMify events
  * Waits for SDK, falls back to API if timeout
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
  try {
    console.log(`🔄 Tracking UTMify event: ${eventType}`);
 
    // Wait for SDK with timeout
    const sdkLoaded = await waitForSDK();
 
    const payload = buildEventPayload(eventType, eventData);
 
    if (sdkLoaded) {
      // SDK is ready - try native tracking first, fallback to API
      const win = window as UTMifyWindow;
      
      if (win.Utmify?.track) {
        try {
          win.Utmify.track(eventType, eventData);
          console.log(`✅ UTMify ${eventType} tracked via SDK`);
          return true;
        } catch (sdkError) {
          console.warn("⚠️ SDK track failed, using API fallback:", sdkError);
          return sendEventViaAPI(payload);
        }
      } else {
        // SDK loaded but track method not available - use API
        return sendEventViaAPI(payload);
       }
     } else {
      // SDK didn't load in time - use API fallback
       return sendEventViaAPI(payload);
     }
  } catch (error) {
    // Never let tracking errors break the checkout flow
    console.warn(`⚠️ UTMify ${eventType} tracking failed silently:`, error);
    return false;
   }
 };
 
 /**
  * Track Purchase event with all required data
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
  * Track AddToCart event
  */
 export const trackAddToCart = async (
   value: number,
   productName?: string
 ): Promise<boolean> => {
   return trackUTMifyEvent("AddToCart", {
     value,
     currency: "BRL",
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
 
 export { UTMIFY_PIXEL_ID, UTMIFY_API_URL };