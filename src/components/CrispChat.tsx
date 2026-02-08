import { useEffect } from "react";

declare global {
  interface Window {
    $crisp: unknown[];
    CRISP_WEBSITE_ID: string;
  }
}

export function CrispChat() {
  useEffect(() => {
    // Prevent duplicate initialization
    if (window.CRISP_WEBSITE_ID) return;

    window.$crisp = [];
    window.CRISP_WEBSITE_ID = "50e06f90-b2d3-4ec6-8b07-ccf01e5f5f7d";

    // Load script asynchronously
    const script = document.createElement("script");
    script.src = "https://client.crisp.chat/l.js";
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);

    // Hide the chat bubble completely while keeping tracking/monitoring active
    const style = document.createElement("style");
    style.id = "crisp-hide-styles";
    style.textContent = `
      .crisp-client .cc-1brb6,
      .crisp-client .cc-tlyw,
      .crisp-client .cc-kxkl,
      .crisp-client .cc-1brb6 .cc-unoo {
        display: none !important;
        visibility: hidden !important;
        opacity: 0 !important;
        pointer-events: none !important;
        width: 0 !important;
        height: 0 !important;
        overflow: hidden !important;
        position: fixed !important;
        bottom: -9999px !important;
        right: -9999px !important;
      }
    `;
    document.head.appendChild(style);

    return () => {
      const existingScript = document.querySelector('script[src="https://client.crisp.chat/l.js"]');
      if (existingScript) existingScript.remove();
      style.remove();
    };
  }, []);

  return null;
}
