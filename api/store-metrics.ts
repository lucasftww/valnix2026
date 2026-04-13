import { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from './_utils/firebase';
import { errorMessage, setCorsHeaders } from './_utils/helpers';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { 
      event_name, 
      user_id, 
      page_url, 
      device_type, 
      browser, 
      value, 
      currency, 
      order_id, 
      content_name 
    } = req.body;

    if (!event_name) {
      return res.status(400).json({ error: 'event_name is required' });
    }

    const metricRef = db.collection('store_metrics').doc();
    await metricRef.set({
      event_name,
      user_id: user_id || null,
      page_url: page_url || null,
      device_type: device_type || 'unknown',
      browser: browser || 'unknown',
      value: value || null,
      currency: currency || null,
      order_id: order_id || null,
      content_name: content_name || null,
      timestamp: new Date().toISOString(),
      created_at: new Date()
    });

    return res.status(200).json({ success: true, id: metricRef.id });
  } catch (error: unknown) {
    const message = errorMessage(error);
    console.error('❌ [Metrics] error:', message);
    return res.status(500).json({ error: message });
  }
}
