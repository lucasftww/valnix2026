import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { initializeFirestore, memoryLocalCache } from "firebase/firestore";

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

// App Check DISABLED — reCAPTCHA Enterprise API still propagating (0% verified).
// Re-enable after % verified rises above 90% in Firebase Console.
// Site Key: 6Le-LW4sAAAAAAIVQezpJ2wv4h_s3nYrdb_-y28J
export const appCheckReady = Promise.resolve();

// Initialize services
export const auth = getAuth(app);
export const db = initializeFirestore(app, {
  localCache: memoryLocalCache()
});
export default app;
