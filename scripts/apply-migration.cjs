#!/usr/bin/env node
/**
 * Applies a specific SQL migration file to the Supabase project via the
 * Management API. Usage:
 *   SUPABASE_PAT=sbp_... node scripts/apply-migration.cjs <migration-file>
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const PAT = process.env.SUPABASE_PAT;
const PROJECT_REF = 'ewtbkzcisxjpbjzlxfet';
const file = process.argv[2];

if (!PAT) { console.error('SUPABASE_PAT env var required'); process.exit(1); }
if (!file) { console.error('Usage: SUPABASE_PAT=... node scripts/apply-migration.cjs <file>'); process.exit(1); }

const sql = fs.readFileSync(path.resolve(file), 'utf8');
const body = JSON.stringify({ query: sql });

const req = https.request({
  hostname: 'api.supabase.com',
  path: `/v1/projects/${PROJECT_REF}/database/query`,
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${PAT}`,
    'Content-Length': Buffer.byteLength(body),
  },
}, (res) => {
  let data = '';
  res.on('data', c => data += c);
  res.on('end', () => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      console.log(`✓ Applied ${path.basename(file)} (HTTP ${res.statusCode})`);
      if (data && data !== '[]') {
        try { console.log(JSON.stringify(JSON.parse(data), null, 2)); } catch { console.log(data); }
      }
    } else {
      console.error(`✗ HTTP ${res.statusCode}`);
      try { console.error(JSON.stringify(JSON.parse(data), null, 2)); } catch { console.error(data); }
      process.exit(1);
    }
  });
});
req.on('error', e => { console.error('Request failed:', e.message); process.exit(1); });
req.write(body);
req.end();
