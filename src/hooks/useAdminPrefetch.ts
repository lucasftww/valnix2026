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

      // Only prefetch dashboard stats — other tabs load on-demand with React Query cache
      const resources = [
        { key: "admin-stats", resource: "dashboard-stats", extract: (d: any) => d },
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
          staleTime: 5 * 60_000,
        });
      });
    };

    prefetch();
  }, [queryClient]);
};
