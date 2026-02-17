/**
 * Bootstrap scripts — runs before React.
 * Moved from index.html inline scripts to eliminate 'unsafe-inline' in CSP.
 */

// ── 1. Strip sensitive tokens from URL before any tracking loads ──
(function stripTokens() {
  const url = new URL(window.location.href);
  let dirty = false;
  ['__lovable_token', '__dev_token'].forEach((key) => {
    if (url.searchParams.has(key)) { url.searchParams.delete(key); dirty = true; }
  });
  if (dirty) window.history.replaceState(null, '', url.toString());
})();

// ── 2. Auto-detect referrer/click IDs and inject UTMs ──
(function autoDetectUtms() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('utm_source')) {
    try {
      const existing: Record<string, string> = {};
      ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].forEach((k) => {
        const v = params.get(k); if (v) existing[k] = v;
      });
      sessionStorage.setItem('valnix_utm_params', JSON.stringify(existing));
    } catch {}
    return;
  }
  // If UTMs already captured in this session, don't overwrite with auto-detection
  try { if (sessionStorage.getItem('valnix_utm_params')) return; } catch {}

  const utm: Record<string, string> | null = (() => {
    // Only auto-detect PAID traffic (click IDs from ad platforms)
    if (params.get('gclid')) {
      return { utm_source: 'google', utm_medium: 'cpc', utm_campaign: params.get('utm_campaign') || 'google_ads' };
    }
    if (params.get('fbclid')) {
      return { utm_source: 'facebook', utm_medium: 'cpc', utm_campaign: params.get('utm_campaign') || 'facebook_ads' };
    }
    return null;
  })();

  if (utm) {
    const url = new URL(window.location.href);
    for (const key in utm) { url.searchParams.set(key, utm[key]); }
    window.history.replaceState(null, '', url.toString());
    try { sessionStorage.setItem('valnix_utm_params', JSON.stringify(utm)); } catch {}
  }
})();

// ── 3. Facebook Pixel Base — deferred to after page load ──
(function initFbPixel() {
  window.addEventListener('load', () => {
    const f = window as any;
    if (f.fbq) return;
    const n: any = f.fbq = function () {
      n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
    };
    if (!f._fbq) f._fbq = n;
    n.push = n; n.loaded = true; n.version = '2.0'; n.queue = [];
    const t = document.createElement('script');
    t.async = true;
    t.src = 'https://connect.facebook.net/en_US/fbevents.js';
    const s = document.getElementsByTagName('script')[0];
    s.parentNode!.insertBefore(t, s);
    f.fbq('set', 'autoConfig', false, '1939179866693535');
    f.fbq('init', '1939179866693535');
    // PageView with deterministic event_id for CAPI dedup
    const pvId = `pageview_${window.location.pathname}_${new Date().toISOString().slice(0, 13)}`;
    f.fbq('track', 'PageView', {}, { eventID: pvId });
  }, { once: true });
})();

// ── 4. UTMify loader — lazy, guarded, skips admin/checkout ──
(function loadUtmify() {
  const path = location.pathname;
  if (/^\/(admin|checkout|card-callback)(\/|$)/.test(path)) return;

  if ((window as any).__utmify_loaded === true) return;
  (window as any).__utmify_loaded = true;

  const load = () => {
    if (!document.head) { setTimeout(load, 50); return; }
    const s = document.createElement('script');
    s.src = 'https://cdn.utmify.com.br/scripts/utms/latest.js';
    s.async = true;
    s.setAttribute('data-utmify-prevent-xcod-sck', '');
    s.setAttribute('data-utmify-prevent-subids', '');
    document.head.appendChild(s);
  };

  const ric = window.requestIdleCallback || ((cb: () => void) => setTimeout(cb, 200));
  ric(load);
})();
