import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { getCorsHeaders } from '../_shared/cors.ts';
import { getFirebaseAccessToken, FIREBASE_PROJECT_ID } from '../_shared/firebase.ts';
import { verifyAdminToken } from '../_shared/auth.ts';
import { extractValue, queryCollectionSimple, queryCollectionFiltered, createFirestoreDoc, updateFirestoreDoc, parseFirestoreDoc } from '../_shared/firestore.ts';

function docToObj(doc: any): Record<string, any> {
  const fields = doc.document?.fields || {};
  const obj: Record<string, any> = { id: doc.document.name.split('/').pop() };
  for (const [k, v] of Object.entries(fields)) obj[k] = extractValue(v);
  return obj;
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req, { headers: "authorization, x-client-info, apikey, content-type, x-admin-token", methods: "GET, POST, PUT, OPTIONS" });
  if (!corsHeaders) return new Response("Forbidden", { status: 403 });
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const isPublicPageRequest = req.method === "GET" && !url.searchParams.get("orderId");

    if (isPublicPageRequest) {
      const accessToken = await getFirebaseAccessToken();
      const queryUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents:runQuery`;
      const res = await fetch(queryUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` }, body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'post_payment_pages' }], limit: 10000 } }) });
      const results = res.ok ? await res.json() : [];
      const pageResults = Array.isArray(results) ? results.filter((r: any) => r.document) : [];
      const PUBLIC_FIELDS = ['addon_type', 'title', 'subtitle', 'badge_text', 'badge_color', 'benefits', 'price', 'original_price', 'button_accept_text', 'button_skip_text', 'next_route', 'is_active', 'display_order'];
      const pages = pageResults.map((r: any) => {
        const full = docToObj(r);
        const filtered: Record<string, any> = { id: full.id };
        for (const key of PUBLIC_FIELDS) { if (full[key] !== undefined) filtered[key] = full[key]; }
        return filtered;
      }).sort((a: any, b: any) => (a.display_order || 0) - (b.display_order || 0));
      return new Response(JSON.stringify({ pages }), { headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "public, max-age=60, s-maxage=120" } });
    }

    const adminToken = req.headers.get("x-admin-token");
    if (!adminToken) return new Response(JSON.stringify({ error: "Admin token required" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const isValid = await verifyAdminToken(adminToken);
    if (!isValid) return new Response(JSON.stringify({ error: "Invalid or expired admin token" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    if (req.method === "GET") {
      const orderId = url.searchParams.get("orderId");
      if (orderId) {
        const addons = await queryCollectionFiltered('sale_addons', [{ field: 'order_id', op: 'EQUAL', value: { stringValue: orderId } }]);
        return new Response(JSON.stringify({ addons }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const pages = await queryCollectionSimple('post_payment_pages');
      pages.sort((a: any, b: any) => (a.display_order || 0) - (b.display_order || 0));

      const accessToken = await getFirebaseAccessToken();
      const addonQueryUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents:runQuery`;
      const addonRes = await fetch(addonQueryUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` }, body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'sale_addons' }], limit: 10000 } }) });
      const addonResults = addonRes.ok ? await addonRes.json() : [];
      const addons = (Array.isArray(addonResults) ? addonResults : []).filter((r: any) => r.document).map((r: any) => {
        const f = r.document?.fields || {};
        return { id: r.document.name.split('/').pop(), order_id: f?.order_id?.stringValue || '', addon_type: f?.addon_type?.stringValue || '', status: f?.status?.stringValue || '', amount: f?.amount?.doubleValue ?? f?.amount?.integerValue ?? 0, paid_at: f?.paid_at?.stringValue || null, created_at: f?.created_at?.timestampValue || f?.created_at?.stringValue || null };
      });
      return new Response(JSON.stringify({ pages, addons }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (req.method === "PUT") {
      const body = await req.json();
      const { id, ...rawUpdates } = body;
      if (!id) return new Response(JSON.stringify({ error: "Page ID required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const ALLOWED_FIELDS = ['title', 'subtitle', 'badge_text', 'badge_color', 'benefits', 'price', 'original_price', 'button_accept_text', 'button_skip_text', 'next_route', 'is_active', 'display_order', 'addon_type'];
      const dangerous = ['__proto__', 'constructor', 'prototype'];
      const updates: Record<string, unknown> = {};
      for (const key of Object.keys(rawUpdates)) { if (!dangerous.includes(key) && ALLOWED_FIELDS.includes(key)) updates[key] = rawUpdates[key]; }
      const success = await updateFirestoreDoc('post_payment_pages', id, { ...updates, updated_at: new Date().toISOString() });
      if (!success) return new Response(JSON.stringify({ error: "Update failed" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (req.method === "POST") {
      const body = await req.json();
      if (body.action === "seed") {
        const existing = await queryCollectionSimple('post_payment_pages');
        if (existing.length > 0) return new Response(JSON.stringify({ message: "Pages already exist", count: existing.length }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        const defaults = [
          { addon_type: "delivery_priority", title: "Entrega Prioritária", subtitle: "Receba seu pedido com prioridade máxima", badge_text: "MAIS VENDIDO", badge_color: "yellow", benefits: ["Entrega em até 5 minutos", "Suporte prioritário 24h", "Garantia de entrega", "Atendimento VIP no Discord"], price: 4.99, original_price: 14.99, button_accept_text: "SIM! EU QUERO!", button_skip_text: "Não, obrigado", next_route: "/protecao-total", is_active: true, display_order: 1 },
          { addon_type: "data_swap_warranty", title: "Proteção Total", subtitle: "Garantia de troca de dados caso necessário", badge_text: "RECOMENDADO", badge_color: "green", benefits: ["Troca de dados garantida", "Suporte dedicado para troca", "Validade de 30 dias", "Processo rápido e seguro"], price: 7.99, original_price: 19.99, button_accept_text: "QUERO PROTEÇÃO!", button_skip_text: "Não, obrigado", next_route: "/order", is_active: true, display_order: 2 },
        ];
        for (const page of defaults) await createFirestoreDoc('post_payment_pages', page.addon_type, { ...page, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
        return new Response(JSON.stringify({ success: true, created: defaults.length }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers: { ...getCorsHeaders(req, { headers: "authorization, x-client-info, apikey, content-type, x-admin-token", methods: "GET, POST, PUT, OPTIONS" }), "Content-Type": "application/json" } });
  }
});
