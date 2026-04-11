/**
 * Espelha src/lib/postPaymentOrderId.ts — altere os dois ao mudar regras.
 */
const BLOCKED_LOWER = new Set([
  "coloque_o_id_do_pedido",
  "cole_o_id_do_pedido",
  "seu_order_id",
  "pedido_id",
  "order_id",
  "placeholder",
  "exemplo",
  "example",
  "teste",
  "demo",
  "xxx",
  "abc123",
  "id_pedido",
  "substitua",
  "preencher",
  "your_order_id",
]);

export function isValidPostPaymentOrderId(raw: string): boolean {
  const id = raw.trim();
  if (!id) return false;
  const lower = id.toLowerCase();
  if (BLOCKED_LOWER.has(lower)) return false;
  if (lower.startsWith("lead-")) return false;
  if (/^<[^>]+>$/.test(id)) return false;
  return true;
}
