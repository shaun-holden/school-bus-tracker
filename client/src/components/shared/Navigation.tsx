import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/hooks/use-theme";
import { formatRole } from "@/lib/roleLabel";
import { logoutThenRedirect } from "@/lib/pushToken";
import { useQuery } from "@tanstack/react-query";
import { UserCog, UserRound, Bell, Eye, Sun, Moon, Menu } from "lucide-react";
import { Link, useLocation } from "wouter";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

export default function Navigation() {
  const { user, logoutAsync, isLoggingOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [, setLocation] = useLocation();

  const { data: unreadCount } = useQuery<{ unreadCount: number }>({
    queryKey: ["/api/parent-notifications/unread-count"],
    enabled: user?.role === "parent",
    // Reader only: NotificationCenter owns the polling interval for this key.
  });

  // Leave the page only after the logout request has finished (or failed):
  // on the phone app it first waits for the push token, and a reload before
  // the request would keep the session alive.
  const logout = () =>
    logoutThenRedirect(logoutAsync, () => {
      window.location.href = '/';
    });

  const handleLogout = async () => {
    return logout();
  };

  // Q31: the page wrapper (.safe-area-page-below-nav) insets left/right; the negative margins let the bar span the full width while its padding keeps content clear of the notch.
  return (
    <nav className="bg-primary shadow-lg sticky top-0 z-50" style={{ paddingTop: 'env(safe-area-inset-top)', paddingLeft: 'env(safe-area-inset-left)', paddingRight: 'env(safe-area-inset-right)', marginLeft: 'calc(-1 * env(safe-area-inset-left))', marginRight: 'calc(-1 * env(safe-area-inset-right))' }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <div className="flex items-center min-w-0 flex-1">
            <i className="fas fa-bus text-white text-2xl mr-3 shrink-0"></i>
            <h1 className="text-white text-lg sm:text-xl font-semibold truncate min-w-0">SchoolBus Tracker</h1>
            {user?.role && (
              <span className="hidden min-[380px]:inline-flex shrink-0 ml-2 sm:ml-4 px-2 py-1 bg-white/20 text-white text-sm rounded-md">
                {formatRole(user.role)}
              </span>
            )}
          </div>
          <div className="flex items-center space-x-2 shrink-0 ml-2">
            {user?.role === "parent" && (
              <Link href="/parent/notifications">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-11 min-w-11 sm:h-9 sm:min-w-0 text-white hover:bg-blue-700 relative"
                  aria-label={`Notifications${(unreadCount?.unreadCount || 0) > 0 ? ` (${unreadCount?.unreadCount} unread)` : ''}`}
                  data-testid="button-notifications"
                >
                  <Bell className="w-5 h-5" />
                  {(unreadCount?.unreadCount || 0) > 0 && (
                    <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-bold animate-pulse">
                      {unreadCount?.unreadCount}
                    </span>
                  )}
                </Button>
              </Link>
            )}
            <div className="hidden sm:flex items-center space-x-2">
              {user?.role === 'master_admin' && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-white hover:bg-blue-700"
                      data-testid="button-view-as"
                    >
                      <Eye className="w-4 h-4 mr-1" />
                      View As
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>Switch Dashboard View</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => window.location.href = '/admin'}>
                      Administrator
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => window.location.href = '/driver'}>
                      Driver
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => window.location.href = '/parent'}>
                      Parent
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              {user?.role === 'admin' && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-white hover:bg-blue-700"
                  onClick={() => window.location.href = '/select-role'}
                  data-testid="button-change-role"
                >
                  <UserCog className="w-4 h-4 mr-1" />
                  Change Role
                </Button>
              )}
              <Link href="/account">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-white hover:bg-blue-700"
                  data-testid="button-account"
                >
                  <UserRound className="w-4 h-4 mr-1" />
                  Account
                </Button>
              </Link>
              <Button
                variant="ghost"
                size="sm"
                className="text-white hover:bg-blue-700"
                onClick={toggleTheme}
                aria-label="Toggle theme"
                data-testid="button-theme-toggle"
              >
                {theme === "light" ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
              </Button>
              <Button
                variant="ghost"
                className="text-white hover:bg-blue-700"
                onClick={handleLogout}
                disabled={isLoggingOut}
                data-testid="button-logout"
              >
                Sign Out
              </Button>
            </div>
            <div className="sm:hidden">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-11 w-11 text-white hover:bg-blue-700 [&_svg]:size-6"
                    aria-label="Menu"
                    data-testid="button-mobile-menu"
                  >
                    <Menu className="w-6 h-6" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {user?.role === 'master_admin' && (
                    <>
                      <DropdownMenuLabel>Switch Dashboard View</DropdownMenuLabel>
                      <DropdownMenuItem className="min-h-11" onClick={() => window.location.href = '/admin'}>
                        Administrator
                      </DropdownMenuItem>
                      <DropdownMenuItem className="min-h-11" onClick={() => window.location.href = '/driver'}>
                        Driver
                      </DropdownMenuItem>
                      <DropdownMenuItem className="min-h-11" onClick={() => window.location.href = '/parent'}>
                        Parent
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                    </>
                  )}
                  {user?.role === 'admin' && (
                    <DropdownMenuItem
                      className="min-h-11"
                      onClick={() => window.location.href = '/select-role'}
                      data-testid="button-change-role-mobile"
                    >
                      <UserCog className="w-4 h-4 mr-2" />
                      Change Role
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    className="min-h-11"
                    onClick={toggleTheme}
                    data-testid="button-theme-toggle-mobile"
                  >
                    {theme === "light" ? <Moon className="w-4 h-4 mr-2" /> : <Sun className="w-4 h-4 mr-2" />}
                    {theme === "light" ? "Dark mode" : "Light mode"}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="min-h-11"
                    onClick={() => setLocation('/account')}
                    data-testid="button-account-mobile"
                  >
                    <UserRound className="w-4 h-4 mr-2" />
                    Account
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="min-h-11"
                    onClick={handleLogout}
                    disabled={isLoggingOut}
                    data-testid="button-logout-mobile"
                  >
                    Sign Out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
}
