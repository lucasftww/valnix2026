/// <reference types="vite/client" />

interface Window {
  /** Meta Pixel stub / SDK — accepts varied argument shapes at runtime */
  fbq?: (command: string, ...args: unknown[]) => void;
  _fbq?: unknown;
  __utmify_loaded?: boolean;
}
