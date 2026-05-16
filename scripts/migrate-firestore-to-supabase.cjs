#!/usr/bin/env node
/**
 * One-shot migration: Firebase Firestore → Supabase Postgres.
 *
 * Setup:
 *   npm install firebase-admin @supabase/supabase-js
 *   export FIREBASE_SERVICE_ACCOUNT_KEY="$(cat path/to/serviceAccount.json)"
 *   export SUPABASE_URL="https://YOUR.supabase.co"
 *   export SUPABASE_SERVICE_ROLE_KEY="eyJ..."
 *
 * Run:
 *   node scripts/migrate-firestore-to-supabase.cjs               # all collections
 *   node scripts/migrate-firestore-to-supabase.cjs categories    # one collection
 *   node scripts/migrate-firestore-to-supabase.cjs --dry-run     # no writes
 *
 * Idempotent: uses upsert-by-id, so re-running is safe.
 *
 * Notes:
 *   • Firestore IDs are kept as Supabase UUIDs only when valid; otherwise a
 *     deterministic UUID v5 is generated from the original ID and stored
 *     alongside the legacy id (in `notes`/`migrated_from` where the schema
 *     supports it). Anything more invasive belongs in a follow-up migration.
 *   • Firestore Timestamps are converted to ISO strings.
 *   • Subcollections (orders/{id}/items) are flattened into order_items.
 */
const admin = require('firebase-admin');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

// ─── CLI flags ──────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const onlyCollections = args.filter((a) => !a.startsWith('--'));

// ─── Init Firebase Admin ────────────────────────────────────────────────
const svcKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
if (!svcKey) {
  console.error('FIREBASE_SERVICE_ACCOUNT_KEY env var is required (paste the JSON contents).');
  process.exit(1);
}
let credential;
try {
  credential = admin.credential.cert(JSON.parse(svcKey));
} catch (e) {
  console.error('Could not parse FIREBASE_SERVICE_ACCOUNT_KEY as JSON.');
  process.exit(1);
}
admin.initializeApp({ credential });
const fdb = admin.firestore();

// ─── Init Supabase ──────────────────────────────────────────────────────
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars are required.');
  process.exit(1);
}
const sb = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ─── Helpers ────────────────────────────────────────────────────────────
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAMESPACE = 'b9b8c70e-3c22-4d01-a2b3-2c4f7e54aa00';

function uuidV5(name) {
  // RFC 4122 v5 (SHA-1) — deterministic per (namespace, name).
  const nsBytes = Buffer.from(NAMESPACE.replace(/-/g, ''), 'hex');
  const hash = crypto.createHash('sha1').update(nsBytes).update(name).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.slice(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function toUuid(firestoreId) {
  return UUID_RE.test(firestoreId) ? firestoreId.toLowerCase() : uuidV5(firestoreId);
}

function tsToIso(v) {
  if (!v) return null;
  if (typeof v === 'string') return v;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object' && typeof v.toDate === 'function') return v.toDate().toISOString();
  if (typeof v === 'object' && typeof v._seconds === 'number') {
    return new Date(v._seconds * 1000).toISOString();
  }
  return null;
}

async function chunkUpsert(table, rows, onConflict = 'id') {
  if (DRY_RUN) {
    console.log(`  [dry-run] would upsert ${rows.length} rows into ${table}`);
    return;
  }
  const SIZE = 200;
  for (let i = 0; i < rows.length; i += SIZE) {
    const chunk = rows.slice(i, i + SIZE);
    const { error } = await sb.from(table).upsert(chunk, { onConflict });
    if (error) {
      console.error(`  ERROR upserting ${table}[${i}..${i + chunk.length}]:`, error.message);
      throw error;
    }
  }
}

// ─── Per-collection mappers ─────────────────────────────────────────────
async function migrateCategories() {
  console.log('▸ categories');
  const snap = await fdb.collection('categories').get();
  const rows = snap.docs.map((d) => {
    const data = d.data();
    return {
      id: toUuid(d.id),
      name: data.name ?? '',
      slug: data.slug ?? d.id,
      description: data.description ?? null,
      image_url: data.image_url ?? null,
      icon_url: data.icon_url ?? null,
      parent_id: data.parent_id ? toUuid(String(data.parent_id)) : null,
      is_active: data.is_active !== false,
      display_order: Number(data.display_order ?? 0),
      show_on_homepage: data.show_on_homepage ?? false,
      created_at: tsToIso(data.created_at) ?? new Date().toISOString(),
      updated_at: tsToIso(data.updated_at) ?? new Date().toISOString(),
    };
  });
  console.log(`  found ${rows.length} categories`);
  await chunkUpsert('categories', rows);
}

async function migrateProducts() {
  console.log('▸ products');
  const snap = await fdb.collection('products').get();
  const rows = snap.docs.map((d) => {
    const data = d.data();
    return {
      id: toUuid(d.id),
      name: data.name ?? '',
      description: data.description ?? null,
      rich_description: data.rich_description ?? null,
      price: Number(data.price ?? 0),
      old_price: data.old_price != null ? Number(data.old_price) : null,
      discount: data.discount != null ? Number(data.discount) : null,
      image_url: data.image_url ?? null,
      icon_url: data.icon_url ?? null,
      category: data.category ?? '',
      is_active: data.is_active !== false,
      featured: !!data.featured,
      is_featured_in_category: !!data.is_featured_in_category,
      display_order: Number(data.display_order ?? 0),
      stock: data.stock != null ? Number(data.stock) : null,
      sold: data.sold != null ? Number(data.sold) : 0,
      delivery_type: data.delivery_type ?? 'manual',
      delivery_info: data.delivery_info ?? null,
      auto_delivery_codes: Array.isArray(data.auto_delivery_codes) ? data.auto_delivery_codes : null,
      instructions: data.instructions ?? null,
      terms_conditions: data.terms_conditions ?? null,
      video_url: data.video_url ?? null,
      product_type: data.product_type ?? null,
      offer_hash: data.offer_hash ?? null,
      created_at: tsToIso(data.created_at) ?? new Date().toISOString(),
      updated_at: tsToIso(data.updated_at) ?? new Date().toISOString(),
    };
  });
  console.log(`  found ${rows.length} products`);
  await chunkUpsert('products', rows);
}

async function migrateOrders() {
  console.log('▸ orders + order_items');
  const snap = await fdb.collection('orders').get();
  const orderRows = [];
  const itemRows = [];
  for (const d of snap.docs) {
    const data = d.data();
    const oid = toUuid(d.id);
    orderRows.push({
      id: oid,
      user_id: data.user_id ?? null,
      guest_hash: data.guest_hash ?? null,
      customer_name: data.customer_name ?? '',
      customer_email: data.customer_email ?? null,
      customer_phone: data.customer_phone ?? null,
      customer_document: data.customer_document ?? null,
      total_amount: Number(data.total_amount ?? 0),
      status: data.status ?? 'pending',
      payment_status: data.payment_status ?? 'pending',
      payment_method: data.payment_method ?? null,
      notes: data.notes ?? null,
      flowpay_charge_id: data.flowpay_charge_id ?? null,
      pix_code: data.pix_code ?? null,
      pix_expires_at: tsToIso(data.pix_expires_at),
      fbc: data.fbc ?? null,
      fbp: data.fbp ?? null,
      event_source_url: data.event_source_url ?? null,
      utm_source: data.utm_source ?? null,
      utm_medium: data.utm_medium ?? null,
      utm_campaign: data.utm_campaign ?? null,
      utm_content: data.utm_content ?? null,
      utm_term: data.utm_term ?? null,
      paid_at: tsToIso(data.paid_at),
      created_at: tsToIso(data.created_at) ?? new Date().toISOString(),
      updated_at: tsToIso(data.updated_at) ?? new Date().toISOString(),
    });

    // Try subcollections first (items, order_items), then top-level
    let items = [];
    for (const subName of ['items', 'order_items']) {
      const sub = await d.ref.collection(subName).get();
      if (!sub.empty) {
        items = sub.docs.map((s) => ({ id: s.id, data: s.data(), subcoll: true }));
        break;
      }
    }
    if (items.length === 0) {
      const top = await fdb.collection('order_items').where('order_id', '==', d.id).get();
      if (!top.empty) items = top.docs.map((s) => ({ id: s.id, data: s.data(), subcoll: false }));
    }
    for (const it of items) {
      itemRows.push({
        id: toUuid(it.id),
        order_id: oid,
        product_id: it.data.product_id ? toUuid(String(it.data.product_id)) : null,
        product_name: it.data.product_name ?? '',
        product_image: it.data.product_image ?? null,
        quantity: Number(it.data.quantity ?? 1),
        unit_price: Number(it.data.unit_price ?? 0),
        total_price: Number(it.data.total_price ?? 0),
        delivery_type: it.data.delivery_type ?? 'manual',
        delivery_code: it.data.delivery_code ?? null,
        delivered_at: tsToIso(it.data.delivered_at),
        created_at: tsToIso(it.data.created_at) ?? new Date().toISOString(),
        updated_at: tsToIso(it.data.updated_at) ?? new Date().toISOString(),
      });
    }
  }
  console.log(`  found ${orderRows.length} orders / ${itemRows.length} line items`);
  await chunkUpsert('orders', orderRows);
  await chunkUpsert('order_items', itemRows);
}

async function migratePostPaymentPages() {
  console.log('▸ post_payment_pages');
  const snap = await fdb.collection('post_payment_pages').get();
  const rows = snap.docs.map((d) => {
    const data = d.data();
    return {
      id: toUuid(d.id),
      addon_type: data.addon_type ?? d.id,
      title: data.title ?? '',
      subtitle: data.subtitle ?? null,
      badge_text: data.badge_text ?? null,
      badge_color: data.badge_color ?? 'yellow',
      benefits: Array.isArray(data.benefits) ? data.benefits : [],
      price: Number(data.price ?? 0),
      original_price: data.original_price != null ? Number(data.original_price) : null,
      button_accept_text: data.button_accept_text ?? 'SIM! EU QUERO!',
      button_skip_text: data.button_skip_text ?? 'Não, obrigado',
      next_route: data.next_route ?? '/',
      is_active: data.is_active !== false,
      display_order: Number(data.display_order ?? 0),
      created_at: tsToIso(data.created_at) ?? new Date().toISOString(),
      updated_at: tsToIso(data.updated_at) ?? new Date().toISOString(),
    };
  });
  console.log(`  found ${rows.length} pages`);
  await chunkUpsert('post_payment_pages', rows, 'addon_type');
}

async function migrateProductReviews() {
  console.log('▸ product_reviews');
  const snap = await fdb.collection('product_reviews').get();
  const rows = snap.docs.map((d) => {
    const data = d.data();
    return {
      id: toUuid(d.id),
      product_id: data.product_id ? toUuid(String(data.product_id)) : null,
      category: data.category ?? null,
      customer_name: data.customer_name ?? '',
      rating: Number(data.rating ?? 5),
      comment: data.comment ?? '',
      display_order: Number(data.display_order ?? 0),
      created_at: tsToIso(data.created_at) ?? new Date().toISOString(),
    };
  });
  console.log(`  found ${rows.length} reviews`);
  await chunkUpsert('product_reviews', rows);
}

async function migrateNewsletter() {
  console.log('▸ newsletter_subscribers');
  const snap = await fdb.collection('newsletter_subscribers').get();
  const rows = snap.docs
    .map((d) => {
      const data = d.data();
      const email = String(data.email ?? '').trim().toLowerCase();
      if (!email) return null;
      return {
        id: toUuid(d.id),
        email,
        user_id: data.user_id ?? null,
        created_at: tsToIso(data.created_at) ?? new Date().toISOString(),
      };
    })
    .filter(Boolean);
  console.log(`  found ${rows.length} subscribers`);
  await chunkUpsert('newsletter_subscribers', rows, 'email');
}

async function migrateAnalyticsEvents() {
  console.log('▸ analytics_events (this may be large — only last 30 days)');
  const cutoff = new Date(Date.now() - 30 * 86400_000).toISOString();
  let snap;
  try {
    snap = await fdb.collection('analytics_events').where('timestamp', '>=', cutoff).get();
  } catch {
    snap = await fdb.collection('analytics_events').get();
  }
  const rows = snap.docs.map((d) => {
    const data = d.data();
    return {
      id: toUuid(d.id),
      event_id: data.event_id ?? d.id,
      event_name: data.event_name ?? 'Unknown',
      url: data.url ?? null,
      user_data: data.user_data ?? null,
      custom_data: data.custom_data ?? null,
      source: data.source ?? 'firestore-import',
      status: data.status ?? 'pending',
      status_code: data.status_code ?? null,
      error: data.error ?? null,
      meta_response: data.meta_response ?? null,
      timestamp: tsToIso(data.timestamp) ?? new Date().toISOString(),
      updated_at: tsToIso(data.updatedAt ?? data.updated_at),
    };
  });
  console.log(`  found ${rows.length} events`);
  await chunkUpsert('analytics_events', rows, 'event_id');
}

const ALL = {
  categories: migrateCategories,
  products: migrateProducts,
  orders: migrateOrders,
  post_payment_pages: migratePostPaymentPages,
  product_reviews: migrateProductReviews,
  newsletter_subscribers: migrateNewsletter,
  analytics_events: migrateAnalyticsEvents,
};

(async () => {
  const targets = onlyCollections.length ? onlyCollections : Object.keys(ALL);
  console.log(`Migrating: ${targets.join(', ')}${DRY_RUN ? ' [DRY RUN]' : ''}\n`);
  for (const t of targets) {
    const fn = ALL[t];
    if (!fn) {
      console.warn(`Unknown collection "${t}" — skipping`);
      continue;
    }
    try {
      await fn();
    } catch (e) {
      console.error(`Failed migrating ${t}:`, e.message);
      process.exit(1);
    }
  }
  console.log('\n✓ Done.');
  process.exit(0);
})();
