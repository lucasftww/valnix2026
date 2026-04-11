/// <reference types="vite/client" />

interface Window {
  /** Meta Pixel stub / SDK — accepts varied argument shapes at runtime */
  fbq?: (command: string, ...args: unknown[]) => void;
  _fbq?: unknown;
  __utmify_loaded?: boolean;
  /** Set by Firestore hooks when ad-blocker / network blocks Firestore */
  __valnix_firestore_blocked?: boolean;
}
