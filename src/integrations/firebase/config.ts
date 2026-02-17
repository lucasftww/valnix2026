import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { initializeFirestore, memoryLocalCache } from "firebase/firestore";
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

// App Check with reCAPTCHA v3 — only on production domains
// Preview/dev domains are not registered in reCAPTCHA console, so skip there.
const PRODUCTION_HOSTS = ["www.valnix.com.br", "valnix.com.br", "valnix2026.lovable.app"];
const isProduction = PRODUCTION_HOSTS.includes(window.location.hostname);

if (isProduction) {
  try {
    const RECAPTCHA_SITE_KEY = "6Le-LW4sAAAAAAIVQezpJ2wv4h_s3nYrdb_-y28J";
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(RECAPTCHA_SITE_KEY),
      isTokenAutoRefreshEnabled: true,
    });
  } catch (err) {
    console.warn("[AppCheck] Init failed:", (err as Error).message);
  }
}

export const appCheckReady = Promise.resolve();

// Initialize services
export const auth = getAuth(app);
export const db = initializeFirestore(app, {
  localCache: memoryLocalCache()
});
export default app;
