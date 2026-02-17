import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from "firebase/firestore";

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

// App Check: Only initialize on production domains where reCAPTCHA v3 key is registered.
// On other domains, App Check is NOT initialized — Firestore enforcement must be
// set to "Unenforced" in Firebase Console for this to work, OR the domain must be
// added to the reCAPTCHA v3 allowed domains list.
const APPCHECK_DOMAINS = [
  "valnix.com.br",
  "www.valnix.com.br",
];

const currentHost = window.location.hostname;
const shouldEnableAppCheck = APPCHECK_DOMAINS.some(
  (d) => currentHost === d
);

if (shouldEnableAppCheck) {
  import("firebase/app-check").then(({ initializeAppCheck, ReCaptchaV3Provider }) => {
    try {
      initializeAppCheck(app, {
        provider: new ReCaptchaV3Provider("6Le-LW4sAAAAAAIVQezpJ2wv4h_s3nYrdb_-y28J"),
        isTokenAutoRefreshEnabled: true,
      });
    } catch (e) {
      console.warn("App Check init failed:", e);
    }
  });
}

// Initialize services with persistent local cache (IndexedDB)
export const auth = getAuth(app);
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager()
  })
});
export default app;
