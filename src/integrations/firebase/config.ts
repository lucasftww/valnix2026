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

// Initialize App Check with reCAPTCHA v3 only on authorized domains
// Preview/dev domains are NOT registered in reCAPTCHA, causing 401 errors
// that block ALL Firestore queries when enforcement is active.
const RECAPTCHA_AUTHORIZED_DOMAINS = [
  "valnix.com.br",
  "www.valnix.com.br",
  "valnix2026.lovable.app",
];

const currentHost = window.location.hostname;
const isAuthorizedDomain = RECAPTCHA_AUTHORIZED_DOMAINS.some(
  (d) => currentHost === d || currentHost.endsWith("." + d)
);

if (isAuthorizedDomain) {
  try {
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider("6Le-LW4sAAAAAAIVQezpJ2wv4h_s3nYrdb_-y28J"),
      isTokenAutoRefreshEnabled: true,
    });
  } catch (e) {
    console.warn("App Check initialization failed:", e);
  }
} else {
  console.info("App Check skipped: domain not in authorized list");
}

// Initialize services with persistent local cache (IndexedDB)
export const auth = getAuth(app);
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager()
  })
});
export default app;
