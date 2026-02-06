import { useQuery } from "@tanstack/react-query";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/integrations/firebase/config";
import { QUERY_KEYS, CACHE_TIMES } from "@/lib/constants";
import type { Banner } from "@/types";

export const useBanners = () => {
  return useQuery({
    queryKey: [QUERY_KEYS.BANNERS],
    queryFn: async (): Promise<Banner[]> => {
      // Evita índice composto (where + orderBy). Carrega tudo e filtra/ordena client-side.
      const snapshot = await getDocs(collection(db, "site_banners"));

      return snapshot.docs
        .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) }))
        .filter((b) => b?.is_active)
        .sort((a, b) => (a?.display_order ?? 0) - (b?.display_order ?? 0))
        .map((b) => ({
          id: b.id,
          image_url: b.image_url,
          alt_text: b.alt_text,
          display_order: b.display_order,
          is_active: b.is_active,
        })) as Banner[];
    },
    staleTime: 60 * 60 * 1000, // 1 hora - banners raramente mudam
    gcTime: 2 * 60 * 60 * 1000, // 2 horas
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });
};
