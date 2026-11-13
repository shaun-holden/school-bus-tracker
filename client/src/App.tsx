import { useEffect, useRef, useState } from "react";
import { Switch, Route, useLocation } from "wouter";
import { Capacitor } from "@capacitor/core";
import { App as CapacitorApp } from "@capacitor/app";
import { PushNotifications } from "@capacitor/push-notifications";
import { queryClient, apiRequest } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/use-auth";
import { useWebPush } from "@/hooks/use-web-push";
import { useNativePush } from "@/hooks/use-native-push";
import { pushRoutes, backButtonAction } from "@/lib/pushRoutes";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { OfflineBanner } from "@/components/shared/OfflineBanner";
import { SplashProvider, useSplash } from "@/lib/splash-context";
import NotFound from "@/pages/not-found";
import Landing from "@/pages/landing";
import AuthPage from "@/pages/auth";
import ResetPasswordPage from "@/pages/reset-password";
import DriverPasswordSetupPage from "@/pages/driver-password-setup";
import RoleSelection from "@/pages/role-selection";
import ParentDashboard from "@/pages/parent-dashboard";
import ParentNotifications from "@/pages/parent-notifications";
import DriverDashboard from "@/pages/driver-dashboard";
import AdminDashboard from "@/pages/admin-dashboard";
import BusinessSignup from "@/pages/business-signup";
import OnboardingPlans from "@/pages/onboarding-plans";
import OnboardingSuccess from "@/pages/onboarding-success";
import OnboardingPending from "@/pages/onboarding-pending";
import PrivacyPolicy from "@/pages/privacy";
import Support from "@/pages/support";

// HF3: admins of a company that is not approved+active get 403s from every
// admin API, so show the pending page instead of an empty dashboard. When the
// pending page's status poll sees approval, refresh the cached user so the
// router switches to the dashboard without waiting for the auth staleTime.
function PendingCompanyGate() {
  const { data: status } = useQuery<{ status: string; isActive: boolean }>({
    queryKey: ['/api/business/status'],
    refetchInterval: 10000,
  });
  useEffect(() => {
    if (status?.status === 'approved' && status?.isActive) {
      queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
    }
  }, [status]);
  return <OnboardingPending />;
}

function Router() {
  const { isAuthenticated, isLoading, user } = useAuth();
  const isCompanyActive = user?.companyStatus === 'approved' && user?.companyIsActive !== false;
  const { hide: hideSplash } = useSplash();
  const pendingRolePatchSentRef = useRef(false);
  const [, navigate] = useLocation();

  // A tapped push, kept until auth has loaded. Registered first, whatever the
  // auth state, so a tap that cold-starts the app isn't lost. Only the push
  // `type` is kept; the route comes from the pushRoutes allow-list (S-21).
  const pendingPushTypeRef = useRef<{ type: unknown } | null>(null);
  const [pushTapCount, setPushTapCount] = useState(0);
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const handle = PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
      pendingPushTypeRef.current = { type: action?.notification?.data?.type };
      setPushTapCount((n) => n + 1);
    });
    return () => {
      void handle.then((h) => h.remove()).catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (isLoading || !pendingPushTypeRef.current) return;
    const { type } = pendingPushTypeRef.current;
    pendingPushTypeRef.current = null;
    // Not logged in, or a role with no route for this type: just open the app.
    const path = user ? pushRoutes(type, user.role) : null;
    if (path) navigate(path);
  }, [pushTapCount, isLoading, user, navigate]);

  // Q46: Android back button / back swipe goes back in the app, else minimises.
  useEffect(() => {
    if (Capacitor.getPlatform() !== "android") return;
    const handle = CapacitorApp.addListener("backButton", ({ canGoBack }) => {
      if (backButtonAction(canGoBack) === "back") window.history.back();
      else void CapacitorApp.minimizeApp();
    });
    return () => {
      void handle.then((h) => h.remove()).catch(() => {});
    };
  }, []);

  // Register for web push notifications once authenticated (web only; the
  // phone app uses native push below).
  useWebPush(!!isAuthenticated && !!user?.id);
  useNativePush(user);

  useEffect(() => {
    if (isAuthenticated && user?.id) {
      // Skip role updates for master_admin users and impersonated sessions
      if (user?.role === 'master_admin' || (user as any)?._masterAdminImpersonating) {
        sessionStorage.removeItem('pendingRole');
        return;
      }
      const pendingRole = sessionStorage.getItem('pendingRole');
      if (pendingRole && (!user?.role || user?.role !== pendingRole)) {
        // Guard against the effect re-running (auth state churn, fast re-renders)
        // before the PATCH resolves and clears sessionStorage. Once set, never
        // reset — the page reloads on success, and on failure we leave pendingRole
        // intact so the user can retry by reloading manually.
        if (pendingRolePatchSentRef.current) return;
        pendingRolePatchSentRef.current = true;
        apiRequest(`/api/users/${user.id}/role`, 'PATCH', { role: pendingRole })
          .then(() => {
            sessionStorage.removeItem('pendingRole');
            window.location.reload();
          })
          .catch((err) => {
            console.error('Failed to apply pending role:', err);
          });
      }
    }
  }, [isAuthenticated, user]);

  // Dismiss the native splash screen the moment auth resolves. We intentionally
  // do NOT gate on isAuthenticated — landing on the Landing page is a valid
  // resolved state and should not leave the user staring at the splash.
  // SplashProvider.hide() is idempotent (guarded by hasHiddenRef), so calling
  // it on every non-loading render is safe.
  useEffect(() => {
    if (!isLoading) {
      void hideSplash();
    }
  }, [isLoading, hideSplash]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  return (
    <Switch>
      <Route path="/auth" component={AuthPage} />
      <Route path="/reset-password" component={ResetPasswordPage} />
      <Route path="/driver/password-setup" component={DriverPasswordSetupPage} />
      <Route path="/business/signup" component={BusinessSignup} />
      <Route path="/onboarding/plans" component={OnboardingPlans} />
      <Route path="/onboarding/success" component={OnboardingSuccess} />
      <Route path="/onboarding/pending" component={OnboardingPending} />
      <Route path="/privacy" component={PrivacyPolicy} />
      <Route path="/support" component={Support} />
      {!isAuthenticated ? (
        <Route path="/" component={Landing} />
      ) : (
        <>
          <Route path="/select-role" component={RoleSelection} />
          {!user?.role && <Route path="/" component={RoleSelection} />}
          {user?.role === 'parent' && <Route path="/" component={ParentDashboard} />}
          {user?.role === 'parent' && <Route path="/parent" component={ParentDashboard} />}
          {user?.role === 'parent' && <Route path="/parent/notifications" component={ParentNotifications} />}
          {user?.role === 'driver' && <Route path="/" component={DriverDashboard} />}
          {(user?.role === 'admin' || user?.role === 'driver_admin') && !isCompanyActive && <Route path="/" component={PendingCompanyGate} />}
          {(user?.role === 'master_admin' || ((user?.role === 'admin' || user?.role === 'driver_admin') && isCompanyActive)) && <Route path="/" component={AdminDashboard} />}
          {/* Master admin can view any dashboard */}
          {user?.role === 'master_admin' && <Route path="/driver" component={DriverDashboard} />}
          {user?.role === 'master_admin' && <Route path="/parent" component={ParentDashboard} />}
          {user?.role === 'master_admin' && <Route path="/parent/notifications" component={ParentNotifications} />}
          {user?.role === 'master_admin' && <Route path="/admin" component={AdminDashboard} />}
        </>
      )}
      <Route component={NotFound} />
    </Switch>
  );
}

interface AppProps {
  splashShownAt: number | null;
}

function AppShell() {
  const { hide: hideSplash } = useSplash();
  return (
    <ErrorBoundary onError={() => { void hideSplash(); }}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <OfflineBanner />
          <Toaster />
          <Router />
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

function App({ splashShownAt }: AppProps) {
  return (
    <SplashProvider shownAt={splashShownAt}>
      <AppShell />
    </SplashProvider>
  );
}

export default App;
