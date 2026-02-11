import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Register Service Worker to block unwanted UTMify pixel events (ViewContent, Lead, AddToCart, PageView)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js', { scope: '/' })
    .then((reg) => console.log('[SW] Registered, scope:', reg.scope))
    .catch((err) => console.warn('[SW] Registration failed:', err));
}

// Render React immediately - Firebase handles its own caching
createRoot(document.getElementById("root")!).render(<App />);
