import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { clearPushToken, getPushToken, logoutBody, setPushToken } from "@/lib/pushToken";
import type { User } from "@shared/schema";

// /api/auth/user returns req.user, which the server extends with the user's
// company status (HF3). Null when the user has no company.
export type AuthUser = User & {
  companyStatus?: string | null;
  companyIsActive?: boolean | null;
};

interface LoginCredentials {
  email: string;
  password: string;
}

interface RegisterCredentials {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
  role?: string;
}

const LOGOUT_REGISTER_WAIT_MS = 3000;

// Cold-start logout: permission is granted but this session has no token yet,
// so ask for it (up to 3 s). Web: always null (web logout is unchanged).
async function nativeLogoutToken(): Promise<string | null> {
  if (!Capacitor.isNativePlatform()) return null;
  const existing = getPushToken();
  if (existing) return existing;
  try {
    const { receive } = await PushNotifications.checkPermissions();
    if (receive !== "granted") return null;
    let settled = false;
    let handle: { remove: () => Promise<void> } | null = null;
    const dropListener = () => {
      if (handle) void handle.remove().catch(() => {});
      handle = null;
    };
    const token = await new Promise<string | null>((resolve) => {
      const finish = (value: string | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        dropListener();
        resolve(value);
      };
      const timer = setTimeout(() => finish(null), LOGOUT_REGISTER_WAIT_MS);
      void PushNotifications.addListener("registration", ({ value }) => finish(value || null))
        .then((h) => {
          handle = h;
          if (settled) dropListener();
          else void PushNotifications.register().catch(() => finish(null));
        })
        .catch(() => finish(null));
    });
    if (token) setPushToken(token);
    return token;
  } catch {
    return null;
  }
}

async function unregisterNativePush() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    // Without permission this phone can't get push, so there is nothing to
    // stop. Skipping also avoids touching Firebase for users who never turned
    // push on (on Android, unregister() needs google-services.json, see T3).
    const { receive } = await PushNotifications.checkPermissions();
    if (receive !== "granted") return;
    await PushNotifications.unregister();
  } catch {
    console.warn("Push unregister failed");
  }
}

// After logout: if it failed, or there was no token to send, the server can't
// turn this phone off, so unregister instead (B2). Then clear the tray and the
// in-memory token.
async function clearNativePushAfterLogout(token: string | null, loggedOut: boolean) {
  if (!Capacitor.isNativePlatform()) return;
  if (!loggedOut || !token) await unregisterNativePush();
  try {
    await PushNotifications.removeAllDeliveredNotifications();
  } catch {
    // nothing to clear
  }
  clearPushToken();
}

export function useAuth() {
  const queryClient = useQueryClient();

  const userQuery = useQuery<AuthUser | null>({
    queryKey: ["/api/auth/user"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    retry: false,
    refetchOnWindowFocus: true,
    staleTime: 5 * 60 * 1000,
  });

  const loginMutation = useMutation({
    mutationFn: async (credentials: LoginCredentials) => {
      return await apiRequest("/api/auth/login", "POST", credentials);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
    },
  });

  const registerMutation = useMutation({
    mutationFn: async (credentials: RegisterCredentials) => {
      return await apiRequest("/api/auth/register", "POST", credentials);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      // Send this phone's push token so the server turns off push on this phone only (T4a).
      const token = await nativeLogoutToken();
      let loggedOut = false;
      try {
        const res = await apiRequest("/api/auth/logout", "POST", logoutBody(token));
        loggedOut = true;
        return res;
      } finally {
        await clearNativePushAfterLogout(token, loggedOut);
      }
    },
    onSuccess: () => {
      // Wipe all cached data so the next user on this device doesn't see
      // the previous user's buses, students, messages, etc.
      queryClient.clear();
    },
  });

  return {
    user: userQuery.data,
    isLoading: userQuery.isLoading,
    isAuthenticated: !!userQuery.data,
    error: userQuery.error,
    login: loginMutation.mutate,
    loginAsync: loginMutation.mutateAsync,
    isLoggingIn: loginMutation.isPending,
    loginError: loginMutation.error,
    register: registerMutation.mutate,
    registerAsync: registerMutation.mutateAsync,
    isRegistering: registerMutation.isPending,
    registerError: registerMutation.error,
    logout: logoutMutation.mutate,
    logoutAsync: logoutMutation.mutateAsync,
    isLoggingOut: logoutMutation.isPending,
  };
}
