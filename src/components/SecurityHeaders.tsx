import { useEffect } from "react";

// Componente para adicionar meta tags de segurança
export function SecurityHeaders() {
  useEffect(() => {
    // Content Security Policy via meta tag
    const cspMeta = document.createElement('meta');
    cspMeta.httpEquiv = 'Content-Security-Policy';
    cspMeta.content = `
      default-src 'self';
      script-src 'self' 'unsafe-inline' 'unsafe-eval' https://fonts.googleapis.com https://cdnjs.cloudflare.com https://*.firebaseio.com https://connect.facebook.net https://apis.google.com https://*.googleapis.com https://cdn.utmify.com.br https://client.crisp.chat;
      style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://client.crisp.chat;
      font-src 'self' https://fonts.gstatic.com https://client.crisp.chat;
      img-src 'self' data: https: blob:;
      connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com https://*.firebaseapp.com https://api.ipify.org https://api6.ipify.org https://firestore.googleapis.com https://www.facebook.com https://connect.facebook.net https://apis.google.com https://accounts.google.com https://*.lovable.dev https://*.lovable.app https://tracking.utmify.com.br https://cdn.utmify.com.br https://viacep.com.br https://client.crisp.chat wss://client.relay.crisp.chat wss://stream.relay.crisp.chat https://*.crisp.chat wss://*.crisp.chat;
      frame-src 'self' https://accounts.google.com https://*.firebaseapp.com https://apis.google.com https://*.lovable.dev https://game.crisp.chat https://www.facebook.com https://connect.facebook.net;
      worker-src 'self' blob:;
      base-uri 'self';
      form-action 'self' https://accounts.google.com https://www.facebook.com https://connect.facebook.net;
    `.replace(/\s+/g, ' ').trim();
    
    // Referrer Policy
    const referrerMeta = document.createElement('meta');
    referrerMeta.name = 'referrer';
    referrerMeta.content = 'strict-origin-when-cross-origin';
    
    // X-Content-Type-Options
    const contentTypeMeta = document.createElement('meta');
    contentTypeMeta.httpEquiv = 'X-Content-Type-Options';
    contentTypeMeta.content = 'nosniff';
    
    // Adicionar ao head
    document.head.appendChild(cspMeta);
    document.head.appendChild(referrerMeta);
    document.head.appendChild(contentTypeMeta);
    
    return () => {
      // Cleanup
      document.head.removeChild(cspMeta);
      document.head.removeChild(referrerMeta);
      document.head.removeChild(contentTypeMeta);
    };
  }, []);
  
  return null;
}