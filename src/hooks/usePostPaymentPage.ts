import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

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
        const { data, error: fetchError } = await supabase
          .from('post_payment_pages')
          .select('*')
          .eq('addon_type', addonType)
          .eq('is_active', true)
          .single();

        if (fetchError) throw fetchError;

        if (data) {
          setConfig({
            ...data,
            benefits: Array.isArray(data.benefits) ? data.benefits as string[] : [],
            price: Number(data.price),
            original_price: data.original_price ? Number(data.original_price) : null,
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
