/// <reference types="vite/client" />

interface Window {
  fbq?: (
    command: "track" | "trackCustom" | "init" | "set" | "addToCart" | "consent",
    event?: string,
    params?: Record<string, any>,
    options?: { eventID?: string }
  ) => void;
}
