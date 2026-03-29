import { db } from './_utils/firebase';
import { setCorsHeaders } from './_utils/helpers';
import axios from 'axios';

export default async function handler(req: any, res: any) {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { eventIds } = req.body;
    if (!eventIds || !Array.isArray(eventIds)) {
      return res.status(400).json({ error: 'eventIds array required' });
    }

    // Call the internal metaRelay for each event
    // In Vercel, we can just import the logic or call the endpoint
    const protocol = req.headers['x-forwarded-proto'] || 'http';
    const host = req.headers.host;
    const baseUrl = `${protocol}://${host}`;

    const results = await Promise.all(eventIds.map(async (id: string) => {
      const eventDoc = await db.collection('analytics_events').doc(id).get();
      if (!eventDoc.exists) return { id, status: 'not_found' };

      const eventData = eventDoc.data();
      try {
        await axios.post(`${baseUrl}/api/metaRelay`, {
          event: eventData?.event_name,
          userData: eventData?.user_data,
          customData: eventData?.custom_data,
          event_id: eventData?.event_id,
          url: eventData?.url
        });
        return { id, status: 'success' };
      } catch (err: any) {
        return { id, status: 'error', message: err.message };
      }
    }));

    return res.status(200).json({ results });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
}
