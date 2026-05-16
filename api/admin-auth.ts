import type { VercelRequest, VercelResponse } from '@vercel/node';

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1h — must match TOKEN_TTL_MS in src/lib/adminAuth.ts

const ALLOWED_ORIGINS = (process.env.ADMIN_ALLOWED_ORIGINS || 'https://www.valnix.com.br,https://valnix.com.br')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

function applyCors(req: VercelRequest, res: VercelResponse) {
  const origin = (req.headers.origin as string) || '';
  // Only echo back an origin we know — never reflect arbitrary origins with credentials.
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Content-Type, x-admin-token'
  );
}

function constantTimeStringEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  // Compare byte buffers of equal length via XOR. If lengths differ, still iterate
  // over max length to keep timing roughly constant per request.
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  const len = Math.max(ba.length, bb.length);
  let diff = ba.length ^ bb.length;
  for (let i = 0; i < len; i++) {
    diff |= (ba[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

async function signToken(adminPassword: string): Promise<string> {
  const { createHmac, randomBytes } = await import('crypto');
  const ts = Date.now().toString(16);
  const nonce = randomBytes(16).toString('hex');
  const sig = createHmac('sha256', adminPassword)
    .update(`${ts}.${nonce}`)
    .digest('hex');
  return `${ts}.${nonce}.${sig}`;
}

async function verifyToken(token: string, adminPassword: string): Promise<boolean> {
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [tsHex, nonce, sig] = parts;
  const ts = parseInt(tsHex, 16);
  if (!Number.isFinite(ts) || Date.now() - ts > TOKEN_TTL_MS) return false;
  if (!/^[0-9a-f]+$/i.test(nonce) || !/^[0-9a-f]+$/i.test(sig)) return false;

  const { createHmac, timingSafeEqual } = await import('crypto');
  const expected = createHmac('sha256', adminPassword)
    .update(`${tsHex}.${nonce}`)
    .digest('hex');
  try {
    const a = Buffer.from(sig, 'hex');
    const b = Buffer.from(expected, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try { applyCors(req, res); } catch { /* noop */ }

  try {
    if (req.method === 'OPTIONS') {
      return res.status(200).json({ ok: true });
    }

    const adminPassword = process.env.ADMIN_PASSWORD;

    if (req.method === 'POST') {
      let parsedBody: any = req.body;
      if (Buffer.isBuffer(parsedBody)) {
        try { parsedBody = JSON.parse(parsedBody.toString('utf8')); } catch { parsedBody = {}; }
      } else if (typeof parsedBody === 'string') {
        try { parsedBody = JSON.parse(parsedBody); } catch { parsedBody = {}; }
      }
      if (!parsedBody || typeof parsedBody !== 'object') parsedBody = {};
      const password = parsedBody.password;

      if (!adminPassword) {
        return res.status(500).json({
          error: 'ADMIN_PASSWORD não está definida no servidor (Vercel → Settings → Environment Variables).',
        });
      }

      if (typeof password !== 'string' || password.length === 0) {
        return res.status(400).json({ error: 'Senha é obrigatória.' });
      }

      if (!constantTimeStringEqual(password, adminPassword)) {
        return res.status(401).json({ error: 'Senha incorreta.' });
      }

      const token = await signToken(adminPassword);
      return res.status(200).json({ token });
    }

    if (req.method === 'GET') {
      const token = (req.headers['x-admin-token'] as string) || '';
      if (!adminPassword) {
        return res.status(500).json({ valid: false, error: 'ADMIN_PASSWORD não configurada.' });
      }
      if (!token) {
        return res.status(200).json({ valid: false });
      }
      const valid = await verifyToken(token, adminPassword);
      return res.status(200).json({ valid });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err: any) {
    const message = err?.message || (typeof err === 'string' ? err : 'Internal server error');
    if (process.env.NODE_ENV !== 'production') {
      try { console.error('admin-auth handler error:', message); } catch { /* noop */ }
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
}
