// Polling policy (LEAK-2): there is NO global refetchInterval. Every query
// that needs live data opts in with its own `refetchInterval`:
//   - bus position / live tracking:           10000 ms
//   - check-in and attendance status:         15000 ms
//   - unread counts and notifications:        30000 ms
//   - lists (routes, buses, schools, students, reports, ...): no polling;
//     they refresh on window focus and on mutation invalidation
//   - onboarding status pages: keep their own short intervals (short-lived)
// When several observers share a query key, exactly one of them owns the
// interval and the others read the same key without one. Never go below 5000.
import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { apiUrl } from "@/lib/apiBase";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  url: string,
  method: string,
  data?: unknown | undefined,
): Promise<any> {
  const res = await fetch(apiUrl(url), {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return await res.json();
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(apiUrl(queryKey.join("/") as string), {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && (res.status === 401 || res.status === 403)) {
      return null;
    }

    if (!res.ok) {
      const text = (await res.text()) || res.statusText;
      throw new Error(`${res.status}: ${text}`);
    }

    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "returnNull" }),
      refetchInterval: false,
      refetchOnWindowFocus: true,
      staleTime: 5000,
      gcTime: 300000,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
