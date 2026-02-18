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
        { key: "admin-stats", resource: "dashboard-stats", extract: (d: any) => d },
        { key: "admin-orders", resource: "orders", extract: (d: any) => {
          const arr = Array.isArray(d.orders) ? d.orders : Array.isArray(d) ? d : [];
          arr.sort((a: any, b: any) => (b.created_at || '').localeCompare(a.created_at || ''));
          return arr;
        }},
        { key: "admin-products", resource: "products", extract: (d: any) => {
          const arr = Array.isArray(d.products) ? d.products : Array.isArray(d) ? d : [];
          arr.sort((a: any, b: any) => {
            const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
            const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
            return dateB - dateA;
          });
          return arr;
        }},
        { key: "admin-categories", resource: "categories", extract: (d: any) => {
          const arr = Array.isArray(d.categories) ? d.categories : Array.isArray(d) ? d : [];
          return arr.filter((c: any) => c.is_active !== false).sort((a: any, b: any) => (a.display_order ?? 0) - (b.display_order ?? 0));
        }},
      ];

      resources.forEach(({ key, resource, extract }) => {
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
            return extract(data);
          },
          staleTime: 30_000,
        });
      });
    };

    prefetch();
  }, [queryClient]);
};
