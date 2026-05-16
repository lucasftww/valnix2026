/**
 * Centralized event ID generator for Meta CAPI deduplication.
 * Ensures consistent, lowercase, underscore-delimited, whitespace-free IDs.
 *
 * Usage:
 *   generateEventId('Purchase', orderId)       → "purchase_{orderId}"
 *   generateEventId('InitiateCheckout', sesId)  → "initiatecheckout_{sesId}"
 *   generateEventId('ViewContent')              → "viewcontent_{timestamp}"
 */
export function generateEventId(eventName: string, identifier?: string | null): string {
  const sanitized = eventName.trim().toLowerCase().replace(/\s+/g, '_');
  // Reject sentinel values that would collide across events: "null", "undefined",
  // empty strings, or pure-whitespace identifiers all fall back to a timestamp+random.
  const trimmed = typeof identifier === 'string' ? identifier.trim() : '';
  const isSentinel = !trimmed || trimmed.toLowerCase() === 'null' || trimmed.toLowerCase() === 'undefined';
  const id = isSentinel
    ? `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
    : trimmed.replace(/\s+/g, '_');
  return `${sanitized}_${id}`;
}
