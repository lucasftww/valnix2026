import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { initializeFirestore, memoryLocalCache, setLogLevel } from "firebase/firestore";

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

const app = initializeApp(firebaseConfig);

// Reduce Firestore SDK console noise in production
const PRODUCTION_HOSTS = ["www.valnix.com.br", "valnix.com.br"];
if (PRODUCTION_HOSTS.includes(window.location.hostname)) {
  setLogLevel("error");
}

export const auth = getAuth(app);
export const db = initializeFirestore(app, {
  localCache: memoryLocalCache()
});
export default app;
