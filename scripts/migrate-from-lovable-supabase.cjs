#!/usr/bin/env node
/**
 * Migrates products and categories from the old Lovable Supabase project
 * (tiupdhnjdcmgbqifwkrd) to the new production Supabase project (ewtbkzcisxjpbjzlxfet).
 *
 * Run: node scripts/migrate-from-lovable-supabase.cjs
 */
const https = require('https');

// ── Source (old Lovable project — read-only with anon key) ──
const SRC_URL  = 'https://tiupdhnjdcmgbqifwkrd.supabase.co';
const SRC_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRpdXBkaG5qZGNtZ2JxaWZ3a3JkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA0MjEwODYsImV4cCI6MjA4NTk5NzA4Nn0.xgPpT3hWbTTo6DcFuf0pjD1jcPpyWIpLQGrdNHX4IkI';

// ── Destination (new production project — service_role) ──
const DST_URL  = 'https://ewtbkzcisxjpbjzlxfet.supabase.co';
const DST_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV3dGJremNpc3hqcGJqemx4ZmV0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODg5MTA1MywiZXhwIjoyMDk0NDY3MDUzfQ.dLl1GnaNv99e8RrWZI7D6dftWtHgVtfA6A8nm1rbtE0';

function fetchJson(url, headers) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error(`JSON parse failed: ${data.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
  });
}

function postJson(url, headers, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const opts = {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    };
    const [protocol, rest] = url.startsWith('https') ? ['https', url.slice(8)] : ['http', url.slice(7)];
    const [host, ...pathParts] = rest.split('/');
    const path = '/' + pathParts.join('/');
    const req = require(protocol).request({ hostname: host, path, ...opts }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

(async () => {
  console.log('\n📦 Migrating products & categories from Lovable Supabase → production\n');

  // ── 1. Fetch source data ──
  const srcHeaders = { apikey: SRC_ANON, Authorization: `Bearer ${SRC_ANON}` };

  const oldCats = await fetchJson(`${SRC_URL}/rest/v1/categories?select=*`, srcHeaders);
  console.log(`✓ Fetched ${oldCats.length} categories from source`);

  const oldProds = await fetchJson(`${SRC_URL}/rest/v1/products?select=*&limit=500`, srcHeaders);
  console.log(`✓ Fetched ${oldProds.length} products from source`);

  // ── 2. Build category-id → slug map ──
  const catMap = {}; // old UUID → slug
  oldCats.forEach(c => { catMap[c.id] = c.slug; });

  // ── 3. Transform categories ──
  const categoryDisplayOrder = { valorant: 1, roblox: 2, 'league-of-legends': 3 };
  const newCats = oldCats.map((c, i) => ({
    id:               c.id,
    name:             c.name,
    slug:             c.slug,
    description:      c.description || null,
    image_url:        c.image_url || null,
    icon_url:         c.icon_url || null,
    is_active:        true,
    display_order:    categoryDisplayOrder[c.slug] || (i + 1),
    show_on_homepage: true,
  }));

  // ── 4. Transform products ──
  const newProds = oldProds.map((p, i) => {
    const categorySlug = catMap[p.category_id] || 'outros';
    return {
      id:            p.id,
      name:          p.name,
      description:   p.description || null,
      price:         Number(p.price),
      old_price:     p.old_price ? Number(p.old_price) : null,
      discount:      null,
      image_url:     p.image_url || null,
      icon_url:      null,
      category:      categorySlug,
      is_active:     p.active !== false,
      featured:      i < 6,           // first 6 products per display_order become featured
      is_featured_in_category: false,
      display_order: p.display_order || (i + 1),
      stock:         null,
      sold:          0,
      delivery_type: p.delivery_method === 'auto' ? 'auto' : 'manual',
      delivery_info: null,
    };
  });

  const dstHeaders = {
    apikey:        DST_KEY,
    Authorization: `Bearer ${DST_KEY}`,
    Prefer:        'resolution=merge-duplicates',
  };

  // ── 5. Upsert categories ──
  console.log('\n📁 Upserting categories...');
  const catRes = await postJson(
    `${DST_URL}/rest/v1/categories?on_conflict=id`,
    dstHeaders,
    newCats,
  );
  if (catRes.status >= 400) {
    console.error('✗ Categories upsert failed:', catRes.body);
  } else {
    console.log(`✓ ${newCats.length} categories upserted (HTTP ${catRes.status})`);
  }

  // ── 6. Upsert products (batch of 50) ──
  console.log('\n🛒 Upserting products...');
  const batchSize = 50;
  for (let i = 0; i < newProds.length; i += batchSize) {
    const batch = newProds.slice(i, i + batchSize);
    const prodRes = await postJson(
      `${DST_URL}/rest/v1/products?on_conflict=id`,
      dstHeaders,
      batch,
    );
    if (prodRes.status >= 400) {
      console.error(`✗ Products batch ${i}–${i + batch.length} failed:`, prodRes.body);
    } else {
      console.log(`✓ Products ${i + 1}–${i + batch.length} upserted (HTTP ${prodRes.status})`);
    }
  }

  // ── 7. Summary ──
  console.log('\n✅ Migration complete!');
  console.log(`   Categories : ${newCats.length}`);
  console.log(`   Products   : ${newProds.length}`);
  console.log('\nCategories migrated:');
  newCats.forEach(c => console.log(`  [${c.display_order}] ${c.name} (${c.slug})`));
  console.log('\nProducts migrated:');
  newProds.forEach(p => console.log(`  [${p.display_order}] ${p.name} — R$${p.price} (${p.category}) featured=${p.featured}`));
  console.log('');
  process.exit(0);
})();
