import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { invokeFunction } from "@/lib/apiHelper";
import { requireAdminToken } from "@/lib/adminAuth";

/**
 * Prefetches all admin data in parallel when the admin page mounts.
 */
export const useAdminPrefetch = () => {
  const queryClient = useQueryClient();

  useEffect(() => {
    const prefetch = async () => {
      let token: string;
      try { token = requireAdminToken(); } catch { return; }

      const headers = { "x-admin-token": token };

      const resources = [
        { key: "admin-stats", resource: "dashboard-stats" },
        { key: "admin-orders", resource: "orders" },
        { key: "admin-products", resource: "products" },
        { key: "admin-categories", resource: "categories" },
      ];

      resources.forEach(({ key, resource }) => {
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
            const data = await res.json();
            return data;
          },
          staleTime: 30_000,
        });
      });
    };

    prefetch();
  }, [queryClient]);
};
