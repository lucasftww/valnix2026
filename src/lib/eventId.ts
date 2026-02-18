/**
 * Centralized event ID generator for Meta CAPI deduplication.
 * Ensures consistent, lowercase, underscore-delimited, whitespace-free IDs.
 *
 * Usage:
 *   generateEventId('Purchase', orderId)       → "purchase_{orderId}"
 *   generateEventId('InitiateCheckout', sesId)  → "initiatecheckout_{sesId}"
 *   generateEventId('ViewContent')              → "viewcontent_{timestamp}"
 */
export function generateEventId(eventName: string, identifier?: string): string {
  const sanitized = eventName.trim().toLowerCase().replace(/\s+/g, '_');
  const id = identifier
    ? identifier.trim().replace(/\s+/g, '_')
    : String(Date.now());
  return `${sanitized}_${id}`;
}
