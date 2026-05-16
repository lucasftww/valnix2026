#!/usr/bin/env node
/**
 * Update Meta CAPI credentials in Supabase (system_credentials/meta_capi).
 *
 *   export SUPABASE_URL="https://YOUR-PROJECT.supabase.co"
 *   export SUPABASE_SERVICE_ROLE_KEY="eyJ..."
 *
 *   node scripts/update-meta-credentials.cjs <token> <pixel_id>
 *
 * If args are omitted, env vars META_ACCESS_TOKEN / META_PIXEL_ID are used.
 * Token & pixel_id are never echoed to stdout.
 */
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars are required.');
  process.exit(1);
}

const token = process.argv[2] || process.env.META_ACCESS_TOKEN || '';
const pixelId = process.argv[3] || process.env.META_PIXEL_ID || '';
if (!token || !pixelId) {
  console.error('Usage: node scripts/update-meta-credentials.cjs <token> <pixel_id>');
  console.error('  or set META_ACCESS_TOKEN / META_PIXEL_ID env vars.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

(async () => {
  const { error } = await supabase
    .from('system_credentials')
    .upsert(
      {
        key: 'meta_capi',
        data: { token, pixel_id: pixelId },
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'key' },
    );

  if (error) {
    console.error('Failed to update credentials:', error.message);
    process.exit(1);
  }
  console.log(`✓ Updated system_credentials/meta_capi (pixel ${pixelId}).`);
  process.exit(0);
})();
