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
  try {
    const RECAPTCHA_SITE_KEY = "6Lfl7G4sAAAAADoi7eT1rgsOVSBIr9CMiqJ7JL-3";
    const appCheck = initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(RECAPTCHA_SITE_KEY),
      isTokenAutoRefreshEnabled: true,
    });

    // Proactively get first token with timeout to catch & suppress reCAPTCHA timeouts
    // This prevents "Uncaught (in promise) Timeout" from polluting the console
    Promise.race([
      getToken(appCheck, /* forceRefresh */ false),
      new Promise((_, reject) => setTimeout(() => reject(new Error("AppCheck token timeout")), 8000)),
    ]).catch(() => {
      // Silent: App Check token failed (adblock/network/timeout)
      // Firestore continues in monitoring mode without App Check
    });
  } catch (err) {
    // Sync init failure — continue without App Check
  }
}

export const appCheckReady = Promise.resolve();

// Reduce Firestore SDK console noise in production (hides "unavailable" warnings from adblock/network)
if (isProduction) {
  setLogLevel("error");
}

// Initialize services
export const auth = getAuth(app);
export const db = initializeFirestore(app, {
  localCache: memoryLocalCache()
});
export default app;
