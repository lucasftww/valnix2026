import { useEffect } from "react";

declare global {
  interface Window {
    $crisp: unknown[];
    CRISP_WEBSITE_ID: string;
  }
}

export function CrispChat() {
  useEffect(() => {
    window.$crisp = [];
    window.CRISP_WEBSITE_ID = "50e06f90-b2d3-4ec6-8b07-ccf01e5f5f7d";

    const script = document.createElement("script");
    script.src = "https://client.crisp.chat/l.js";
    script.async = true;
    document.getElementsByTagName("head")[0].appendChild(script);

    // Hide only the bubble, keep chat functional when opened programmatically
    const style = document.createElement("style");
    style.textContent = `
      .crisp-client .cc-1brb6 .cc-unoo {
        display: none !important;
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
