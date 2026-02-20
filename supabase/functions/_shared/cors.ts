export const ALLOWED_ORIGINS = [
  "https://www.valnix.com.br",
  "https://valnix.com.br",
  "https://valnix2026.lovable.app",
  "https://id-preview--819e052b-89b4-40a7-8d34-1a89d59aa702.lovable.app",
  "https://819e052b-89b4-40a7-8d34-1a89d59aa702.lovableproject.com",
];

export function getCorsHeaders(
  req: Request,
  options?: { headers?: string; methods?: string }
): Record<string, string> | null {
  const allowHeaders = options?.headers ?? "authorization, x-client-info, apikey, content-type, x-admin-token, x-delivery-token";
  const allowMethods = options?.methods ?? "GET, POST, OPTIONS";
  const origin = req.headers.get("Origin");
  if (!origin) {
    return {
      "Access-Control-Allow-Headers": allowHeaders,
      "Access-Control-Allow-Methods": allowMethods,
    };
  }
  if (!ALLOWED_ORIGINS.includes(origin)) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": allowHeaders,
    "Access-Control-Allow-Methods": allowMethods,
  };
}
