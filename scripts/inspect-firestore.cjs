#!/usr/bin/env node
/**
 * Read-only Firestore inspector. Prints document counts + a small sample of
 * each known collection so we can confirm we're pointed at the right project
 * before running the actual migration.
 *
 *   FIREBASE_SERVICE_ACCOUNT_KEY="$(cat .firebase-svc.tmp.json)" \
 *     node scripts/inspect-firestore.cjs
 */
const admin = require('firebase-admin');

const svcKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
if (!svcKey) {
  console.error('FIREBASE_SERVICE_ACCOUNT_KEY env var is required (paste the JSON contents).');
  process.exit(1);
}
let credential;
try {
  credential = admin.credential.cert(JSON.parse(svcKey));
} catch (e) {
  console.error('Could not parse FIREBASE_SERVICE_ACCOUNT_KEY as JSON:', e.message);
  process.exit(1);
}
admin.initializeApp({ credential });
const db = admin.firestore();

const TARGETS = [
  'categories',
  'products',
  'orders',
  'order_items',
  'post_payment_pages',
  'product_reviews',
  'newsletter_subscribers',
  'sale_addons',
  'analytics_events',
  'store_metrics',
  'system_credentials',
];

(async () => {
  const projectId = JSON.parse(svcKey).project_id;
  console.log(`\nInspecting Firestore project: ${projectId}\n`);

  for (const name of TARGETS) {
    try {
      const snap = await db.collection(name).limit(5).get();
      const countSnap = await db.collection(name).count().get();
      const total = countSnap.data().count;
      console.log(`▸ ${name.padEnd(24)} ${String(total).padStart(6)} docs`);
      if (snap.size > 0 && total > 0) {
        const first = snap.docs[0];
        const data = first.data();
        const keys = Object.keys(data).slice(0, 6).join(', ');
        const preview =
          name === 'products' || name === 'categories'
            ? ` — first: "${data.name || data.slug || first.id}"`
            : '';
        console.log(`  ${preview}`);
        console.log(`  fields: ${keys}${Object.keys(data).length > 6 ? ', ...' : ''}`);
      }
    } catch (e) {
      console.log(`▸ ${name.padEnd(24)}  ERROR (${e.code || e.message})`);
    }
  }

  // Also probe for any orders subcollection structure
  try {
    const orderSamples = await db.collection('orders').limit(3).get();
    if (orderSamples.size > 0) {
      console.log(`\nProbing orders for line-item subcollection layout:`);
      for (const d of orderSamples.docs) {
        for (const sub of ['items', 'order_items']) {
          const subSnap = await d.ref.collection(sub).limit(1).get();
          if (!subSnap.empty) {
            console.log(`  order ${d.id}: has subcollection "${sub}" (${subSnap.size}+ items)`);
            break;
          }
        }
      }
    }
  } catch (e) {
    console.log(`\norders probe failed: ${e.message}`);
  }

  // List all top-level collections to catch anything we missed
  try {
    const all = await db.listCollections();
    const known = new Set(TARGETS);
    const extras = all.map((c) => c.id).filter((id) => !known.has(id));
    if (extras.length) {
      console.log(`\nOther top-level collections found (not in migration plan):`);
      for (const id of extras) {
        const c = await db.collection(id).count().get();
        console.log(`  ▸ ${id.padEnd(24)} ${String(c.data().count).padStart(6)} docs`);
      }
    }
  } catch (e) {
    console.log(`\nlistCollections failed: ${e.message}`);
  }

  console.log('\nDone.');
  process.exit(0);
})();
