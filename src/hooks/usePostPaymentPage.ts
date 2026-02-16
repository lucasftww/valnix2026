import { useState, useEffect } from 'react';
import { invokeFunction } from '@/lib/apiHelper';

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
        // Fetch via edge function (public GET, no auth needed)
        const res = await invokeFunction('admin-post-payment', { method: 'GET' });
        if (!res.ok) throw new Error('Failed to fetch post-payment pages');
        
        const result = await res.json();
        const page = (result.pages || []).find(
          (p: any) => p.addon_type === addonType && p.is_active !== false
        );

        if (page) {
          setConfig({
            id: page.id || addonType,
            addon_type: page.addon_type || addonType,
            title: page.title || 'Oferta Especial',
            subtitle: page.subtitle || null,
            badge_text: page.badge_text || null,
            badge_color: page.badge_color || 'yellow',
            benefits: Array.isArray(page.benefits) ? page.benefits : [],
            price: Number(page.price) || 0,
            original_price: page.original_price ? Number(page.original_price) : null,
            button_accept_text: page.button_accept_text || 'SIM! EU QUERO!',
            button_skip_text: page.button_skip_text || 'Não, obrigado',
            next_route: page.next_route || '/',
            is_active: page.is_active ?? true,
            display_order: page.display_order || 0,
          });
        } else {
          console.warn(`Post-payment page "${addonType}" not found or inactive`);
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
