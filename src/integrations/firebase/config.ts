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

// App Check DISABLED — reCAPTCHA key returning 401 Unauthorized in loop.
// The reCAPTCHA v3 site key (6Le-LW4sAAAAAAIVQezpJ2wv4h_s3nYrdb_-y28J) needs to be
// properly configured in Google Cloud reCAPTCHA console before re-enabling.
// Keep enforcement OFF in Firebase Console until this is resolved.
export const appCheckReady = Promise.resolve();

// Initialize services
export const auth = getAuth(app);
export const db = initializeFirestore(app, {
  localCache: memoryLocalCache()
});
export default app;
