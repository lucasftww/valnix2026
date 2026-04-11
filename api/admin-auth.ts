import { setCorsHeaders, verifyAdminToken } from './_utils/helpers';
import { createHmac } from 'crypto';
import { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const adminPassword = process.env.ADMIN_PASSWORD;

  if (req.method === 'POST') {
    const { password } = req.body;

    if (!adminPassword) {
      return res.status(500).json({
        error: 'ADMIN_PASSWORD não está definida no Vercel (Settings → Environment Variables).',
      });
    }

    if (password === adminPassword) {
      // Generate the fixed HMAC token the helpers expect
      const token = createHmac('sha256', adminPassword)
        .update('admin-access')
        .digest('hex');
      
      return res.status(200).json({ token });
    } else {
      return res.status(401).json({ error: 'Invalid password' });
    }
  }

  if (req.method === 'GET') {
    const token = req.headers['x-admin-token'] as string;
    const isValid = verifyAdminToken(token);
    return res.status(200).json({ valid: isValid });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
