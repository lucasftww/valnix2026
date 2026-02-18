import { getFirebaseAccessToken, FIREBASE_PROJECT_ID, FIRESTORE_BASE } from './firebase.ts';

// ── Value conversion ──────────────────────────────────────────────
export function toFirestoreValue(val: unknown): Record<string, unknown> {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'string') return { stringValue: val };
  if (typeof val === 'number') return Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (Array.isArray(val)) return { arrayValue: { values: val.map(v => typeof v === 'string' ? { stringValue: v } : toFirestoreValue(v)) } };
  return { stringValue: String(val) };
}

export function extractValue(val: any): any {
  if (!val) return null;
  if ('stringValue' in val) return val.stringValue;
  if ('doubleValue' in val) return val.doubleValue;
  if ('integerValue' in val) return Number(val.integerValue);
  if ('booleanValue' in val) return val.booleanValue;
  if ('nullValue' in val) return null;
  if ('timestampValue' in val) return val.timestampValue;
  if ('arrayValue' in val) return (val.arrayValue.values || []).map(extractValue);
  if ('mapValue' in val) {
    const obj: any = {};
    for (const [k, v] of Object.entries(val.mapValue.fields || {})) obj[k] = extractValue(v);
    return obj;
  }
  return null;
}

export function parseFirestoreDoc(doc: any): any {
  const fields = doc.fields || doc.document?.fields || {};
  const name = doc.name || doc.document?.name || '';
  const obj: any = { id: name.split('/').pop() };
  for (const [k, v] of Object.entries(fields)) obj[k] = extractValue(v);
  return obj;
}

export function parseFirestoreResults(results: any[]): any[] {
  if (!Array.isArray(results)) return [];
  return results.filter((r: any) => r.document).map((r: any) => parseFirestoreDoc(r.document));
}

function buildFields(data: Record<string, unknown>): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) fields[k] = toFirestoreValue(v);
  return fields;
}

// ── CRUD operations ───────────────────────────────────────────────
export async function getFirestoreDoc(col: string, docId: string): Promise<any> {
  const accessToken = await getFirebaseAccessToken();
  const url = `${FIRESTORE_BASE}/${col}/${docId}`;
  const res = await fetch(url, { headers: { 'Authorization': `Bearer ${accessToken}` } });
  if (!res.ok) return null;
  return await res.json();
}

export async function updateFirestoreDoc(col: string, docId: string, data: Record<string, unknown>): Promise<boolean> {
  const accessToken = await getFirebaseAccessToken();
  const fieldPaths = Object.keys(data).map(k => `updateMask.fieldPaths=${k}`).join('&');
  const url = `${FIRESTORE_BASE}/${col}/${docId}?${fieldPaths}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
    body: JSON.stringify({ fields: buildFields(data) }),
  });
  if (!res.ok) {
    console.error(`❌ Firestore update failed for ${col}/${docId}:`, await res.text());
  }
  return res.ok;
}

export async function addFirestoreDoc(col: string, data: Record<string, unknown>): Promise<string | null> {
  const accessToken = await getFirebaseAccessToken();
  const url = `${FIRESTORE_BASE}/${col}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
    body: JSON.stringify({ fields: buildFields(data) }),
  });
  if (!res.ok) {
    console.error(`❌ Firestore add failed for ${col}:`, await res.text());
    return null;
  }
  const result = await res.json();
  return result.name?.split('/').pop() || null;
}

export async function addFirestoreDocWithId(col: string, docId: string, data: Record<string, unknown>): Promise<boolean> {
  const accessToken = await getFirebaseAccessToken();
  const url = `${FIRESTORE_BASE}/${col}?documentId=${encodeURIComponent(docId)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
    body: JSON.stringify({ fields: buildFields(data) }),
  });
  if (res.status === 409) return false;
  if (!res.ok) console.warn(`⚠️ addFirestoreDocWithId ${col}/${docId} failed: ${res.status}`);
  return res.ok;
}

export async function createFirestoreDoc(col: string, docId: string, data: Record<string, unknown>): Promise<boolean> {
  const accessToken = await getFirebaseAccessToken();
  const url = `${FIRESTORE_BASE}/${col}/${docId}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
    body: JSON.stringify({ fields: buildFields(data) }),
  });
  return res.ok;
}

export async function deleteFirestoreDoc(col: string, docId: string): Promise<boolean> {
  const accessToken = await getFirebaseAccessToken();
  const url = `${FIRESTORE_BASE}/${col}/${docId}`;
  const res = await fetch(url, { method: 'DELETE', headers: { 'Authorization': `Bearer ${accessToken}` } });
  return res.ok;
}

// ── Query helpers ─────────────────────────────────────────────────
export async function queryFirestore(collectionId: string, fieldPath: string, op: string, value: string): Promise<any> {
  const accessToken = await getFirebaseAccessToken();
  const queryUrl = `${FIRESTORE_BASE}:runQuery`;
  const res = await fetch(queryUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId }],
        where: { fieldFilter: { field: { fieldPath }, op, value: { stringValue: value } } },
      },
    }),
  });
  return await res.json();
}

export async function queryCollectionSimple(col: string, limit = 10000): Promise<any[]> {
  const accessToken = await getFirebaseAccessToken();
  const queryUrl = `${FIRESTORE_BASE}:runQuery`;
  const res = await fetch(queryUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: col }], limit } }),
  });
  if (!res.ok) { console.error(`❌ Query ${col} failed:`, await res.text()); return []; }
  return parseFirestoreResults(await res.json());
}

export async function queryCollectionFiltered(
  col: string,
  filters: Array<{ field: string; op: string; value: any }>,
  limit = 10000
): Promise<any[]> {
  const accessToken = await getFirebaseAccessToken();
  const queryUrl = `${FIRESTORE_BASE}:runQuery`;
  const structuredQuery: any = { from: [{ collectionId: col }], limit };
  if (filters.length === 1) {
    structuredQuery.where = { fieldFilter: { field: { fieldPath: filters[0].field }, op: filters[0].op, value: filters[0].value } };
  } else if (filters.length > 1) {
    structuredQuery.where = {
      compositeFilter: { op: 'AND', filters: filters.map(f => ({ fieldFilter: { field: { fieldPath: f.field }, op: f.op, value: f.value } })) },
    };
  }
  const res = await fetch(queryUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
    body: JSON.stringify({ structuredQuery }),
  });
  if (!res.ok) { console.error(`❌ Query ${col} failed:`, await res.text()); return []; }
  return parseFirestoreResults(await res.json());
}

export async function firestoreCommit(writes: any[]): Promise<boolean> {
  const accessToken = await getFirebaseAccessToken();
  const url = `${FIRESTORE_BASE}:commit`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
    body: JSON.stringify({ writes }),
  });
  return res.ok;
}

// Re-export for convenience
export { getFirebaseAccessToken, FIREBASE_PROJECT_ID, FIRESTORE_BASE } from './firebase.ts';
