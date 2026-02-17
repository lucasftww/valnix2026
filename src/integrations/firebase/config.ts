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

// Initialize services with persistent local cache (IndexedDB)
export const auth = getAuth(app);
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager()
  })
});

// Lazy-load App Check AFTER initial render to avoid blocking LCP
// This runs asynchronously and doesn't block any Firestore reads
if (typeof window !== 'undefined') {
  requestAnimationFrame(() => {
    import("firebase/app-check").then(({ initializeAppCheck, ReCaptchaV3Provider }) => {
      try {
        initializeAppCheck(app, {
          provider: new ReCaptchaV3Provider("6Le-LW4sAAAAAAIVQezpJ2wv4h_s3nYrdb_-y28J"),
          isTokenAutoRefreshEnabled: true,
        });
      } catch (e) {
        console.warn("App Check initialization failed:", e);
      }
    }).catch(() => {
      // App Check module failed to load — continue without it
    });
  });
}

export default app;
