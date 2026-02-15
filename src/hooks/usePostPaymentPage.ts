import { useState, useEffect } from 'react';
import { db } from '@/integrations/firebase/config';
import { collection, query, where, getDocs } from 'firebase/firestore';

export interface PostPaymentPageConfig {
  id: string;
  addon_type: string;
  title: string;
  subtitle: string | null;
  badge_text: string | null;
  badge_color: string;
  benefits: string[];
  price: number;
  original_price: number | null;
  button_accept_text: string;
  button_skip_text: string;
  next_route: string;
  is_active: boolean;
  display_order: number;
}

export function usePostPaymentPage(addonType: string) {
  const [config, setConfig] = useState<PostPaymentPageConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const pagesRef = collection(db, 'post_payment_pages');
        const q = query(
          pagesRef,
          where('addon_type', '==', addonType),
          where('is_active', '==', true)
        );
        const snapshot = await getDocs(q);

        if (!snapshot.empty) {
          const doc = snapshot.docs[0];
          const data = doc.data();
          setConfig({
            id: doc.id,
            addon_type: data.addon_type,
            title: data.title || 'Oferta Especial',
            subtitle: data.subtitle || null,
            badge_text: data.badge_text || null,
            badge_color: data.badge_color || 'yellow',
            benefits: Array.isArray(data.benefits) ? data.benefits as string[] : [],
            price: Number(data.price) || 0,
            original_price: data.original_price ? Number(data.original_price) : null,
            button_accept_text: data.button_accept_text || 'SIM! EU QUERO!',
            button_skip_text: data.button_skip_text || 'Não, obrigado',
            next_route: data.next_route || '/',
            is_active: data.is_active ?? true,
            display_order: data.display_order || 0,
          });
        }
      } catch (err: any) {
        console.error('Error fetching post-payment page config:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchConfig();
  }, [addonType]);

  return { config, loading, error };
}
