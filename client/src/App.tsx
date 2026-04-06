import { useEffect } from "react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/hooks/use-auth";
import { useWebPush } from "@/hooks/use-web-push";
import { ErrorBoundary } from "@/components/ErrorBoundary";
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

function Router() {
  const { isAuthenticated, isLoading, user } = useAuth();

  // Register for web push notifications once authenticated
  useWebPush(!!isAuthenticated && !!user?.id);

  useEffect(() => {
    if (isAuthenticated && user?.id) {
      // Skip role updates for master_admin users and impersonated sessions
      if (user?.role === 'master_admin' || (user as any)?._masterAdminImpersonating) {
        sessionStorage.removeItem('pendingRole');
        return;
      }
      const pendingRole = sessionStorage.getItem('pendingRole');
      if (pendingRole && (!user?.role || user?.role !== pendingRole)) {
        fetch(`/api/users/${user.id}/role`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: pendingRole })
        }).then(() => {
          sessionStorage.removeItem('pendingRole');
          window.location.reload();
        });
      }
    }
  }, [isAuthenticated, user]);

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
          {(user?.role === 'admin' || user?.role === 'master_admin' || user?.role === 'driver_admin') && <Route path="/" component={AdminDashboard} />}
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

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
