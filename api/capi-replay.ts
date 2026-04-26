import type { DocumentData } from 'firebase-admin/firestore';
import { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from './_utils/firebase.js';
import { setCorsHeaders } from './_utils/helpers.js';
import axios from 'axios';

export default async function handler(req: VercelRequest, res: VercelResponse) {
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
      // Lookup by event_id (which is now the doc ID)
      const eventDoc = await db.collection('analytics_events').doc(id).get();
      
      let eventData: DocumentData | undefined;
      if (!eventDoc.exists) {
        // Fallback: try to query by field event_id if not found as doc ID
        const query = await db.collection('analytics_events').where('event_id', '==', id).limit(1).get();
        if (query.empty) return { id, status: 'not_found' };
        eventData = query.docs[0].data();
      } else {
        eventData = eventDoc.data();
      }

      try {
        // Updated to use the corrected filename 'meta-relay'
        const relayUrl = `${baseUrl}/api/meta-relay`;
        await axios.post(relayUrl, {
          event: eventData?.event_name,
          userData: eventData?.user_data,
          customData: eventData?.custom_data,
          event_id: eventData?.event_id,
          url: eventData?.url
        });
        return { id, status: 'success' };
      } catch (err: unknown) {
        const ax = err as { message?: string; response?: { data?: unknown } };
        console.error(`❌ [Replay] Error for ${id}:`, ax.response?.data || ax.message);
        return { id, status: 'error', message: ax.message, details: ax.response?.data };
      }
    }));

    return res.status(200).json({ results });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
}
