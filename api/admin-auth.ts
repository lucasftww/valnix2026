import type { VercelRequest, VercelResponse } from '@vercel/node';

// CORS helper inlined to avoid any import-time crash that would make Vercel
// return its generic HTML "A server error has occurred" page (which the
// browser then fails to JSON.parse).
function applyCors(res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, x-admin-token'
  );
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Apply CORS first, in its own try, so even a CORS failure can't break JSON output
  try { applyCors(res); } catch { /* noop */ }

  try {
    if (req.method === 'OPTIONS') {
      return res.status(200).json({ ok: true });
    }

    const adminPassword = process.env.ADMIN_PASSWORD;

    if (req.method === 'POST') {
      // Defensive body parsing — Vercel may deliver body as string, object, Buffer, or undefined
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

      if (password === adminPassword) {
        // Lazy require so any module-resolution problem still produces a JSON error,
        // not Vercel's HTML 500 page.
        const { createHmac } = await import('crypto');
        const token = createHmac('sha256', adminPassword)
          .update('admin-access')
          .digest('hex');
        return res.status(200).json({ token });
      }

      return res.status(401).json({ error: 'Senha incorreta.' });
    }

    if (req.method === 'GET') {
      const token = (req.headers['x-admin-token'] as string) || '';
      if (!adminPassword) {
        return res.status(500).json({ valid: false, error: 'ADMIN_PASSWORD não configurada.' });
      }
      if (!token) {
        return res.status(200).json({ valid: false });
      }
      const { createHmac, timingSafeEqual } = await import('crypto');
      const expected = createHmac('sha256', adminPassword).update('admin-access').digest('hex');
      let valid = false;
      try {
        const a = Buffer.from(token, 'hex');
        const b = Buffer.from(expected, 'hex');
        valid = a.length === b.length && timingSafeEqual(a, b);
      } catch {
        valid = false;
      }
      return res.status(200).json({ valid });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err: any) {
    // Always return JSON so the client never sees raw HTML/text
    const message = err?.message || (typeof err === 'string' ? err : 'Internal server error');
    try { console.error('admin-auth handler error:', message); } catch { /* noop */ }
    return res.status(500).json({ error: message });
  }
}
