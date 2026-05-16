import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { QUERY_KEYS } from '@/lib/constants';
import { deduplicateCategories, buildCategoryTree } from '@/lib/categoryUtils';
import type { Category } from '@/types';

async function fetchCategories(): Promise<Category[]> {
  const { data, error } = await supabase
    .from('categories')
    .select('id,name,slug,description,image_url,icon_url,parent_id,is_active,display_order,show_on_homepage')
    .eq('is_active', true)
    .order('display_order', { ascending: true });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Category[];
  return deduplicateCategories(rows);
}

export const useCategories = () => {
  return useQuery({
    queryKey: [QUERY_KEYS.CATEGORIES],
    queryFn: fetchCategories,
    staleTime: 60 * 60 * 1000,
    gcTime: 2 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });
};

export const useCategoriesTree = () => {
  const { data: categories = [], ...rest } = useCategories();
  return { data: buildCategoryTree(categories), ...rest };
};

export type { Category } from '@/types';
