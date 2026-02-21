import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { UserCog, Bell } from "lucide-react";
import { Link } from "wouter";

export default function Navigation() {
  const { user, logout } = useAuth();

  const { data: unreadCount } = useQuery<{ unreadCount: number }>({
    queryKey: ["/api/parent-notifications/unread-count"],
    enabled: user?.role === "parent",
    refetchInterval: 10000,
  });

  const handleLogout = async () => {
    logout();
    window.location.href = '/';
  };

  return (
    <nav className="bg-primary shadow-lg sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <div className="flex items-center">
            <i className="fas fa-bus text-white text-2xl mr-3"></i>
            <h1 className="text-white text-xl font-semibold">SchoolBus Tracker</h1>
            {user?.role && (
              <span className="ml-4 px-2 py-1 bg-white/20 text-white text-sm rounded-md capitalize">
                {user.role}
              </span>
            )}
          </div>
          <div className="flex items-center space-x-2">
            {user?.role === "parent" && (
              <Link href="/parent/notifications">
                <Button 
                  variant="ghost"
                  size="sm"
                  className="text-white hover:bg-blue-700 relative"
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
            <Button 
              variant="ghost"
              className="text-white hover:bg-blue-700"
              onClick={handleLogout}
              data-testid="button-logout"
            >
              Sign Out
            </Button>
          </div>
        </div>
      </div>
    </nav>
  );
}
