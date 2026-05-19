/**
 * Bootstrap scripts — runs before React.
 * Moved from index.html inline scripts to eliminate 'unsafe-inline' in CSP.
 */

// ── 1. Strip sensitive tokens from URL before any tracking loads ──
(function stripTokens() {
  const url = new URL(window.location.href);
  let dirty = false;
  ['__dev_token'].forEach((key) => {
    if (url.searchParams.has(key)) { url.searchParams.delete(key); dirty = true; }
  });
  if (dirty) window.history.replaceState(null, '', url.toString());
})();

// ── 2. Auto-detect referrer/click IDs and inject UTMs ──
(function autoDetectUtms() {
  const params = new URLSearchParams(window.location.search);
  const STORAGE_KEY = 'valnix_utm_params';

  // Helper: persist UTMs to BOTH sessionStorage and localStorage
  function persistUtms(utms: Record<string, string>) {
    const json = JSON.stringify(utms);
    try { sessionStorage.setItem(STORAGE_KEY, json); } catch {}
    try { localStorage.setItem(STORAGE_KEY, json); } catch {}
  }

  // 1. Explicit UTMs in URL → highest priority
  if (params.get('utm_source')) {
    const existing: Record<string, string> = {};
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].forEach((k) => {
      const v = params.get(k); if (v) existing[k] = v;
    });
    const fbclid = params.get('fbclid');
    if (fbclid) { try { localStorage.setItem('valnix_fbclid', fbclid); } catch {} }
    persistUtms(existing);
    return;
  }

  // 2. Already captured in this session → don't overwrite
  try { if (sessionStorage.getItem(STORAGE_KEY)) return; } catch {}

  // 3. Restore from localStorage (survives tab closes / in-app browser → Chrome)
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try { sessionStorage.setItem(STORAGE_KEY, stored); } catch {}
      return;
    }
  } catch {}

  // 4. Auto-detect from click IDs (paid traffic)
  const utm: Record<string, string> | null = (() => {
    const fbclid = params.get('fbclid');
    if (fbclid) {
      try { localStorage.setItem('valnix_fbclid', fbclid); } catch {}
      return { utm_source: 'facebook', utm_medium: 'cpc', utm_campaign: params.get('utm_campaign') || 'facebook_ads' };
    }
    if (params.get('gclid')) {
      return { utm_source: 'google', utm_medium: 'cpc', utm_campaign: params.get('utm_campaign') || 'google_ads' };
    }
    return null;
  })();

  // 5. Referrer fallback — if no click ID but came from Facebook/Instagram/Google
  const finalUtm = utm || (() => {
    try {
      const ref = document.referrer.toLowerCase();
      if (ref.includes('facebook.com') || ref.includes('fb.com') || ref.includes('instagram.com') || ref.includes('l.facebook.com')) {
        return { utm_source: 'facebook', utm_medium: 'referral', utm_campaign: 'organic_social' };
      }
      if (ref.includes('google.com') || ref.includes('google.com.br')) {
        return { utm_source: 'google', utm_medium: 'organic', utm_campaign: 'organic_search' };
      }
    } catch {}
    return null;
  })();

  if (finalUtm) {
    const url = new URL(window.location.href);
    for (const key in finalUtm) { url.searchParams.set(key, finalUtm[key]); }
    window.history.replaceState(null, '', url.toString());
    persistUtms(finalUtm);
  }
})();

// ── 3. Facebook cookies (fbc/fbp) — ensure they exist for CAPI match quality ──
(function ensureFbCookies() {
  const ONE_YEAR = 365 * 24 * 60 * 60;
  
  // Generate _fbp if missing (browser ID for Meta matching)
  if (!document.cookie.match(/(^| )_fbp=/)) {
    const fbp = `fb.1.${Date.now()}.${Math.floor(Math.random() * 2147483647 + 1000000000)}`;
    document.cookie = `_fbp=${fbp}; max-age=${ONE_YEAR}; path=/; SameSite=Lax`;
  }

  // Generate _fbc from fbclid if missing (click ID for Meta attribution)
  if (!document.cookie.match(/(^| )_fbc=/)) {
    const params = new URLSearchParams(window.location.search);
    const fbclid = params.get('fbclid') || (() => { try { return localStorage.getItem('valnix_fbclid'); } catch { return null; } })();
    if (fbclid) {
      const fbc = `fb.1.${Date.now()}.${fbclid}`;
      document.cookie = `_fbc=${fbc}; max-age=${ONE_YEAR}; path=/; SameSite=Lax`;
    }
  }
})();
// ── 4. Facebook Pixel Base — deferred 5s after load to avoid blocking LCP/TBT ──
// FB SDK is 131 KiB (66% of total JS) — must load well AFTER critical paint
type FbqStub = ((...args: unknown[]) => void) & {
  callMethod?: (...args: unknown[]) => void;
  queue: unknown[][];
  push: FbqStub;
  loaded: boolean;
  version: string;
};

(function initFbPixel() {
  // Initialize the queue immediately so early events (like ViewContent) are caught
  const w = window;
  if (!w.fbq) {
    const stub = ((...args: unknown[]) => {
      const self = stub as FbqStub;
      if (self.callMethod) {
        self.callMethod(...args);
      } else {
        self.queue.push(args);
      }
    }) as FbqStub;
    w.fbq = stub as Window["fbq"];
    if (!w._fbq) w._fbq = stub;
    stub.push = stub;
    stub.loaded = true;
    stub.version = "2.0";
    stub.queue = [];
  }

  window.addEventListener('load', () => {
    setTimeout(() => {
      const ric = window.requestIdleCallback || ((cb: () => void) => setTimeout(cb, 100));
      ric(() => {
        // Use environment variable for Pixel ID, fallback to VALNIX's official pixel
        const pixelId = import.meta.env.VITE_META_PIXEL_ID || '1399664275253859';
        const fbq = window.fbq;
        if (!fbq) return;

        // Disable autoConfig BEFORE loading the script to prevent duplicate PageView
        fbq("set", "autoConfig", false, pixelId);
        fbq("init", pixelId, {}, { agent: "plvalnix" });

        // Generate ONE stable event_id used by BOTH browser pixel and CAPI.
        // Meta's Events Manager uses this to deduplicate the two sources;
        // without it our Pixel coverage report shows 0% on PageView.
        const pageviewEventId =
          `pv_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

        // 1) Browser Pixel PageView with eventID for dedup
        fbq("track", "PageView", {}, { eventID: pageviewEventId });

        // 2) Server CAPI PageView — fire-and-forget, same event_id.
        //    Server-relay enriches with ip/UA/fbc/fbp and forwards to Meta.
        try {
          const body = JSON.stringify({
            event: "PageView",
            event_id: pageviewEventId,
            url: window.location.href,
          });
          // Use sendBeacon when available so the call survives page navigation.
          if (navigator.sendBeacon) {
            const blob = new Blob([body], { type: "application/json" });
            navigator.sendBeacon("/api/server-relay", blob);
          } else {
            fetch("/api/server-relay", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body,
              keepalive: true,
            }).catch(() => {});
          }
        } catch { /* never block page load on tracking */ }

        const t = document.createElement('script');
        t.async = true;
        t.src = 'https://connect.facebook.net/en_US/fbevents.js';
        const s = document.getElementsByTagName('script')[0];
        s.parentNode!.insertBefore(t, s);
      });
    }, 5000); // 5s delay after load + idle callback
  }, { once: true });
})();


// ── 4. UTMify loader — lazy, guarded, skips admin/checkout, delayed 4s ──
(function loadUtmify() {
  const path = location.pathname;
  if (/^\/(admin|charles|checkout)(\/|$)/.test(path)) return;

  if (window.__utmify_loaded === true) return;
  window.__utmify_loaded = true;

  window.addEventListener('load', () => {
    setTimeout(() => {
      if (!document.head) return;
      const s = document.createElement('script');
      s.src = 'https://cdn.utmify.com.br/scripts/utms/latest.js';
      s.async = true;
      s.setAttribute('data-utmify-prevent-xcod-sck', '');
      s.setAttribute('data-utmify-prevent-subids', '');
      document.head.appendChild(s);
    }, 4000);
  }, { once: true });
})();
