import { QueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // retry once on network/5xx errors; a 4xx (401, 403, 404...) won't change by asking again
      retry: (failureCount, error) =>
        failureCount < 1 && !(isAxiosError(error) && (error.response?.status ?? 500) < 500),
      staleTime: 1000 * 30, // 30s — avoids refetching on every tab focus for a dashboard
    },
  },
});
