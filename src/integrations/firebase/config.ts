import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { initializeFirestore, memoryLocalCache, setLogLevel } from "firebase/firestore";
import { initializeAppCheck, ReCaptchaV3Provider, getToken } from "firebase/app-check";

// Firebase configuration — these are publishable keys (security relies on Firebase Security Rules)
const firebaseConfig = {
  apiKey: "AIzaSyBHpcqUztUdpvoCZpjuobkXuFXO9gEJogw",
  authDomain: "valnix.firebaseapp.com",
  projectId: "valnix",
  storageBucket: "valnix.firebasestorage.app",
  messagingSenderId: "767135941537",
  appId: "1:767135941537:web:d4f9e4ee1b2c84133a41e0",
  measurementId: "G-C8YC2EWJ7K",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// App Check with reCAPTCHA v3 — only on production domains
// Preview/dev domains are not registered in reCAPTCHA console, so skip there.
// Non-blocking: if App Check fails, Firestore queries still proceed (monitoring mode).
const PRODUCTION_HOSTS = ["www.valnix.com.br", "valnix.com.br"];
const isProduction = PRODUCTION_HOSTS.includes(window.location.hostname);

// Declare global flag for idempotent handler registration
declare global {
  interface Window { __valnix_unhandled_rejection_hooked?: boolean; }
}

let _appCheckReady: Promise<void> = Promise.resolve();

if (isProduction) {
  // ── Idempotent safety net: suppress unhandled rejections from App Check / reCAPTCHA SDK ──
  if (!window.__valnix_unhandled_rejection_hooked) {
    window.__valnix_unhandled_rejection_hooked = true;
    window.addEventListener("unhandledrejection", (event) => {
      const msg = String(event.reason?.message || event.reason || "");
      if (/Timeout \(b\)|AppCheck|recaptcha/i.test(msg)) {
        event.preventDefault();
      }
    });
  }

  // Reduce Firestore SDK console noise in production
  setLogLevel("error");

  // Defer App Check initialization to after first paint to avoid blocking LCP
  const initAppCheckLazy = () => {
    try {
      const RECAPTCHA_SITE_KEY = "6Lfl7G4sAAAAADoi7eT1rgsOVSBIr9CMiqJ7JL-3";
      const appCheck = initializeAppCheck(app, {
        provider: new ReCaptchaV3Provider(RECAPTCHA_SITE_KEY),
        isTokenAutoRefreshEnabled: true,
      });

      // Warmup with short timeout
      let timeoutId: ReturnType<typeof setTimeout>;
      const timeout = new Promise<null>((resolve) => {
        timeoutId = setTimeout(() => resolve(null), 5000);
      });

      _appCheckReady = Promise.race([getToken(appCheck, false), timeout])
        .catch(() => null)
        .finally(() => clearTimeout(timeoutId!))
        .then(() => undefined);
    } catch {
      // Init failure — continue without App Check
    }
  };

  // Use requestIdleCallback to defer heavy reCAPTCHA loading
  const ric = window.requestIdleCallback || ((cb: () => void) => setTimeout(cb, 100));
  ric(initAppCheckLazy);
}

export const appCheckReady = _appCheckReady;
export const auth = getAuth(app);
export const db = initializeFirestore(app, {
  localCache: memoryLocalCache()
});
export default app;
