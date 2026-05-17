import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../src/integrations/supabase/types.js';

// ============================================================================
// Server-side Supabase client (Vercel Functions only).
// Uses service_role key — bypasses RLS. NEVER import this from client code.
// ============================================================================

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  '';

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  // Don't throw at import time — let each handler return a clean JSON 500
  // instead of Vercel's HTML error page.
  if (process.env.NODE_ENV !== 'production') {
    console.warn(
      '[supabase] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing. ' +
        'Set them in Vercel → Settings → Environment Variables.',
    );
  }
}

let cached: SupabaseClient<Database> | null = null;

export function getSupabaseAdmin(): SupabaseClient<Database> {
  if (cached) return cached;
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    throw new Error('Supabase credentials not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).');
  }
  cached = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

/** Convenience export — lazy getter so the client is never built at import time. */
export const supabaseAdmin = new Proxy({} as SupabaseClient<Database>, {
  get(_t, prop) {
    const client = getSupabaseAdmin() as unknown as Record<string | symbol, unknown>;
    return client[prop as string];
  },
});
