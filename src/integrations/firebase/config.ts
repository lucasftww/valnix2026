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

if (isProduction) {
  // ── Global safety net: suppress unhandled rejections from App Check / reCAPTCHA SDK ──
  // The Firebase App Check SDK + reCAPTCHA internally reject promises on timeout/network
  // that we cannot catch with try/catch (auto-refresh, internal retries).
  // This filters ONLY those cases to avoid polluting the console without masking real bugs.
  window.addEventListener("unhandledrejection", (event) => {
    const msg = String(event.reason?.message || event.reason || "");
    if (/Timeout \(b\)|AppCheck|recaptcha/i.test(msg)) {
      event.preventDefault();
    }
  });

  try {
    const RECAPTCHA_SITE_KEY = "6Lfl7G4sAAAAADoi7eT1rgsOVSBIr9CMiqJ7JL-3";
    const appCheck = initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(RECAPTCHA_SITE_KEY),
      isTokenAutoRefreshEnabled: true,
    });

    // Warmup: proactively get first token with timeout
    const warmupTimeout = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), 8000)
    );
    Promise.race([
      getToken(appCheck, false),
      warmupTimeout,
    ]).catch(() => {
      // Silent: token failed (adblock/network/timeout)
    });
  } catch {
    // Sync init failure — continue without App Check
  }

  // Reduce Firestore SDK console noise in production
  setLogLevel("error");
}

export const appCheckReady = Promise.resolve();
export const auth = getAuth(app);
export const db = initializeFirestore(app, {
  localCache: memoryLocalCache()
});
export default app;
