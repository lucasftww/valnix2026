#!/usr/bin/env node
/**
 * Runs the initial schema SQL against Supabase using the Management API.
 * Usage: SUPABASE_PAT=sbp_... node scripts/run-schema.cjs
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const PAT = process.env.SUPABASE_PAT;
const PROJECT_REF = 'ewtbkzcisxjpbjzlxfet';

if (!PAT) {
  console.error('SUPABASE_PAT env var required');
  process.exit(1);
}

const sql = fs.readFileSync(
  path.join(__dirname, '../supabase/migrations/20260516000000_initial_schema.sql'),
  'utf8'
);

const body = JSON.stringify({ query: sql });

const options = {
  hostname: 'api.supabase.com',
  path: `/v1/projects/${PROJECT_REF}/database/query`,
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${PAT}`,
    'Content-Length': Buffer.byteLength(body),
  },
};

const req = https.request(options, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      console.log('✓ Schema applied successfully');
      try { console.log(JSON.stringify(JSON.parse(data), null, 2)); } catch { console.log(data); }
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
