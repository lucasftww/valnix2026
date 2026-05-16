import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

// ============================================================================
// Browser-side Supabase client. Uses the **publishable** (anon) key.
// All sensitive operations go through Vercel Functions (api/) which use
// the service_role key server-side and bypass RLS.
// ============================================================================

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // Surface the misconfiguration immediately in dev — silent failure here
  // turns into "products won't load" debugging hell later.
  if (import.meta.env.DEV) {
    console.error(
      '[supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env',
    );
  }
}

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});
