import { db } from './_utils/firebase';
import { verifyAdminToken, setCorsHeaders } from './_utils/helpers';

export default async function handler(req: any, res: any) {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const adminToken = req.headers['x-admin-token'];
  if (!verifyAdminToken(adminToken)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { action, collection, id, data } = req.body;

  try {
    const colRef = db.collection(collection || 'products');

    switch (action) {
      case 'GET_ALL':
        const snapshot = await colRef.get();
        const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        return res.status(200).json(items);

      case 'GET_ONE':
        const doc = await colRef.doc(id).get();
        return res.status(200).json({ id: doc.id, ...doc.data() });

      case 'CREATE':
        const newDoc = await colRef.add({ ...data, createdAt: new Date().toISOString() });
        return res.status(200).json({ id: newDoc.id });

      case 'UPDATE':
        await colRef.doc(id).update({ ...data, updatedAt: new Date().toISOString() });
        return res.status(200).json({ success: true });

      case 'DELETE':
        await colRef.doc(id).delete();
        return res.status(200).json({ success: true });

      default:
        return res.status(400).json({ error: 'Invalid action' });
    }
  } catch (error: any) {
    console.error('Admin API error:', error.message);
    return res.status(500).json({ error: error.message });
  }
}
