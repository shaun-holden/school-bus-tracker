// Polling policy (LEAK-2): there is NO global refetchInterval. Every query
// that needs live data opts in with its own `refetchInterval`:
//   - live position:                          15000 ms (drivers post location every 30 s)
//   - check-in and attendance status:         15000 ms
//   - unread counts and notifications:        30000 ms
//   - lists (routes, buses, schools, students, reports, ...): no polling;
//     they refresh on window focus and on mutation invalidation
//   - onboarding status pages: keep their own short intervals (short-lived)
// When several observers share a query key, exactly one of them owns the
// interval and the others read the same key without one. Never go below 15000
// (onboarding status screens excepted).
import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { apiUrl } from "@/lib/apiBase";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

// Q190: a request that never answers gives up, so dialogs and "Saving…"
// buttons can't stay stuck. The signal aborts the fetch; the race settles the
// promise even if the native layer (iOS CapacitorHttp) ignores the signal.
// A timed-out write may still have reached the server.
export const API_REQUEST_TIMEOUT_MS = 30000;
export const API_TIMEOUT_MESSAGE = "Timed out. Check your connection, then refresh.";

export async function apiRequest(
  url: string,
  method: string,
  data?: unknown | undefined,
  options: { timeoutMs?: number } = {},
): Promise<any> {
  const timeoutMs = options.timeoutMs ?? API_REQUEST_TIMEOUT_MS;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(API_TIMEOUT_MESSAGE));
    }, timeoutMs);
  });
  const request = (async () => {
    const res = await fetch(apiUrl(url), {
      method,
      headers: data ? { "Content-Type": "application/json" } : {},
      body: data ? JSON.stringify(data) : undefined,
      credentials: "include",
      signal: controller.signal,
    });

    await throwIfResNotOk(res);
    return await res.json();
  })();

  try {
    return await Promise.race([request, timeout]);
  } finally {
    clearTimeout(timer);
  }
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
