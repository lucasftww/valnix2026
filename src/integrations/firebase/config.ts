import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

// Firebase configuration using environment variables for better security practices
// Note: Firebase API keys are designed to be public; security relies on Firebase Security Rules
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyBHpcqUztUdpvoCZpjuobkXuFXO9gEJogw",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "valnix.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "valnix",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "valnix.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "767135941537",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:767135941537:web:d4f9e4ee1b2c84133a41e0",
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || "G-C8YC2EWJ7K"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize services
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

export default app;
