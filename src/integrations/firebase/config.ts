import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from "firebase/firestore";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";

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

// App Check: reCAPTCHA v3 for production, debug mode for dev/preview
// Without a valid App Check token, Firestore enforcement rejects ALL queries.
const PRODUCTION_DOMAINS = [
  "valnix.com.br",
  "www.valnix.com.br",
  "valnix2026.lovable.app",
];

const currentHost = window.location.hostname;
const isProduction = PRODUCTION_DOMAINS.some(
  (d) => currentHost === d || currentHost.endsWith("." + d)
);

if (!isProduction) {
  // Enable debug token for non-production environments
  // This tells Firebase SDK to use a debug token instead of reCAPTCHA
  (self as any).FIREBASE_APPCHECK_DEBUG_TOKEN = "55382aa4-8a5a-433f-8e2a-7204060e7fc7";
}

try {
  initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider("6Le-LW4sAAAAAAIVQezpJ2wv4h_s3nYrdb_-y28J"),
    isTokenAutoRefreshEnabled: true,
  });
} catch (e) {
  console.warn("App Check initialization failed:", e);
}

// Initialize services with persistent local cache (IndexedDB)
export const auth = getAuth(app);
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager()
  })
});
export default app;
