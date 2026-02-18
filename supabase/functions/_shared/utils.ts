import { getFirebaseAccessToken, FIREBASE_PROJECT_ID, FIRESTORE_BASE } from './firebase.ts';
import { addFirestoreDocWithId } from './firestore.ts';

// ── Parse first public IP from x-forwarded-for ────────────────────
export function parsePublicIp(raw: string | undefined): string {
  if (!raw) return 'unknown';
  const ips = raw.split(',').map(ip => ip.trim()).filter(Boolean);
  const privateRanges = [
    /^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^127\./,
    /^::1$/, /^fd[0-9a-f]{2}:/i, /^fc[0-9a-f]{2}:/i, /^fe80:/i,
  ];
  for (const ip of ips) {
    const normalized = ip.replace(/^::ffff:/i, '');
    if (!privateRanges.some(r => r.test(normalized))) return normalized;
  }
  return ips[0]?.replace(/^::ffff:/i, '') || 'unknown';
}

// ── Invoke edge function ──────────────────────────────────────────
const SUPABASE_FUNCTIONS_URL = Deno.env.get('SUPABASE_URL') + '/functions/v1';

export async function invokeEdgeFunction(
  functionName: string, body: Record<string, unknown>, extraHeaders?: Record<string, string>
): Promise<Response | null> {
  try {
    const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/${functionName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...extraHeaders },
      body: JSON.stringify(body),
    });
    if (!res.ok) console.warn(`⚠️ ${functionName} returned ${res.status}`);
    return res;
  } catch (e) {
    console.warn(`⚠️ ${functionName} invoke error:`, e);
    return null;
  }
}

// ── Coupon helpers ────────────────────────────────────────────────
export async function incrementCouponUsage(couponId: string): Promise<void> {
  const accessToken = await getFirebaseAccessToken();
  const url = `${FIRESTORE_BASE}:commit`;
  const body = {
    writes: [{
      transform: {
        document: `projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/coupons/${couponId}`,
        fieldTransforms: [{ fieldPath: 'current_uses', increment: { integerValue: "1" } }],
      },
    }],
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) console.error(`❌ Coupon increment error:`, await res.text());
  else console.log(`✅ Coupon ${couponId} incremented`);
}

export async function idempotentCouponIncrement(orderId: string, couponId: string): Promise<void> {
  const created = await addFirestoreDocWithId('coupon_use_events', orderId, {
    coupon_id: couponId,
    used_at: new Date().toISOString(),
  });
  if (!created) {
    console.log(`ℹ️ Coupon already incremented for order ${orderId}`);
    return;
  }
  await incrementCouponUsage(couponId);
}

// ── SHA-256 helpers ───────────────────────────────────────────────
export async function sha256(value: string): Promise<string> {
  const data = new TextEncoder().encode(value.trim().toLowerCase());
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Short(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}
