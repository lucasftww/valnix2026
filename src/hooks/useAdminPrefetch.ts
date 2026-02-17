import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { auth } from "@/integrations/firebase/config";
import { invokeFunction } from "@/lib/apiHelper";

/**
 * Prefetches all admin data in parallel when the admin page mounts.
 * This ensures that switching tabs is instant from the first click.
 */
export const useAdminPrefetch = () => {
  const queryClient = useQueryClient();

  useEffect(() => {
    const prefetch = async () => {
      const user = auth.currentUser;
      if (!user) return;

      const token = await user.getIdToken();
      const headers = { "x-firebase-token": token };

      const resources = [
        { key: "admin-stats", resource: "dashboard-stats" },
        { key: "admin-orders", resource: "orders" },
        { key: "admin-products", resource: "products" },
        { key: "admin-categories", resource: "categories" },
        { key: "admin-coupons", resource: "coupons" },
      ];

      // Fire all prefetches in parallel — don't await sequentially
      resources.forEach(({ key, resource }) => {
        // Only prefetch if not already in cache
        const existing = queryClient.getQueryData([key]);
        if (existing) return;

        queryClient.prefetchQuery({
          queryKey: [key],
          queryFn: async () => {
            const res = await invokeFunction("admin-data", {
              method: "GET",
              queryParams: { resource },
              headers,
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json();
          },
          staleTime: 2 * 60 * 1000,
        });
      });
    };

    prefetch();
  }, [queryClient]);
};
