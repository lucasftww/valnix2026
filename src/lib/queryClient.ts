import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      retry: 2,
      // Exponential backoff (1s → 2s → 4s, capped at 8s). Fixed 2s delay
      // before this would hammer Supabase/Vercel under widespread errors.
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 8000),
    },
    mutations: {
      // Mutations should fail fast — no silent retry that could create
      // duplicate orders or duplicate charges.
      retry: 0,
    },
  },
});
