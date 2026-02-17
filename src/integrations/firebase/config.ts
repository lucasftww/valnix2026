import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { initializeFirestore, memoryLocalCache } from "firebase/firestore";
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

// App Check with reCAPTCHA v3
const RECAPTCHA_SITE_KEY = "6Le-LW4sAAAAAAIVQezpJ2wv4h_s3nYrdb_-y28J";

export const appCheckReady: Promise<void> = (async () => {
  try {
    const appCheck = initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(RECAPTCHA_SITE_KEY),
      isTokenAutoRefreshEnabled: true,
    });
    // Wait for the first token to be generated before allowing queries
    await getToken(appCheck, /* forceRefresh */ false);
    console.log("[AppCheck] Token obtained successfully");
  } catch (err) {
    // If App Check fails (e.g. domain not in reCAPTCHA allowlist), continue anyway
    // Queries will still work if enforcement is not enabled, or fail gracefully
    console.warn("[AppCheck] Token failed, continuing without:", (err as Error).message);
  }
})();

// Initialize services
export const auth = getAuth(app);
export const db = initializeFirestore(app, {
  localCache: memoryLocalCache()
});
export default app;
