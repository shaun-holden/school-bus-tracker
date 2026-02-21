import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import Navigation from "@/components/shared/Navigation";
import RoleHeader from "@/components/shared/RoleHeader";
import LiveTrackingCard from "@/components/parent/LiveTrackingCard";
import StudentStatusCard from "@/components/parent/StudentStatusCard";
import ParentQuickActions from "@/components/parent/ParentQuickActions";
import { LinkCodeEntry } from "@/components/parent/LinkCodeEntry";
import { MessagingPortal } from "@/components/shared/MessagingPortal";
import { BluetoothCheckIn } from "@/components/parent/BluetoothCheckIn";
import { NotificationCenter } from "@/components/parent/NotificationCenter";
import { useQuery } from "@tanstack/react-query";
import { isUnauthorizedError } from "@/lib/authUtils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Bell, AlertTriangle, MapPin } from "lucide-react";
import { Link } from "wouter";

export default function ParentDashboard() {
  const { toast } = useToast();
  const { isAuthenticated, isLoading, user } = useAuth();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      toast({
        title: "Unauthorized",
        description: "You are logged out. Logging in again...",
        variant: "destructive",
      });
      setTimeout(() => {
        window.location.href = "/auth";
      }, 500);
      return;
    }
  }, [isAuthenticated, isLoading, toast]);

  const { data: students, isLoading: studentsLoading, error } = useQuery({
    queryKey: ["/api/students"],
    enabled: !!user,
    retry: false,
    refetchInterval: 30000,
  });

  const { data: unreadCount } = useQuery<{ unreadCount: number }>({
    queryKey: ["/api/parent-notifications/unread-count"],
    enabled: !!user,
    retry: false,
    refetchInterval: 10000,
  });

  if (error && isUnauthorizedError(error as Error)) {
    toast({
      title: "Unauthorized",
      description: "You are logged out. Logging in again...",
      variant: "destructive",
    });
    setTimeout(() => {
      window.location.href = "/auth";
    }, 500);
    return null;
  }

  if (isLoading || studentsLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  return (
    <div className="font-inter bg-background text-gray-800 min-h-screen">
      <Navigation />
      
      <RoleHeader 
        user={user}
        title="Parent Dashboard"
        stats={[
          { label: "Next Pickup", value: "3:25 PM" }
        ]}
      />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Prominent Notification Alert Banner */}
        {(unreadCount?.unreadCount || 0) > 0 && (
          <Link href="/parent/notifications">
            <Card className="mb-6 border-2 border-red-300 bg-gradient-to-r from-red-50 to-orange-50 cursor-pointer hover:shadow-lg transition-shadow animate-pulse">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="bg-red-500 text-white rounded-full p-2">
                      <Bell className="w-6 h-6" />
                    </div>
                    <div>
                      <p className="font-bold text-lg text-red-700">
                        You have {unreadCount?.unreadCount} new alert{unreadCount?.unreadCount !== 1 ? 's' : ''}!
                      </p>
                      <p className="text-sm text-gray-600">Tap here to view your notifications</p>
                    </div>
                  </div>
                  <Badge className="bg-red-500 text-white text-lg px-3 py-1">
                    {unreadCount?.unreadCount}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          </Link>
        )}

        {/* Notification Center - Always Visible */}
        <div className="mb-6">
          <NotificationCenter />
        </div>

        <LiveTrackingCard />
        
        {Array.isArray(students) && students.length > 0 && (
          <BluetoothCheckIn students={students as any[]} />
        )}
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          {Array.isArray(students) && (students as any[]).map((student) => (
            <StudentStatusCard key={student.id} student={student} />
          ))}
          <LinkCodeEntry />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <ParentQuickActions />
          {user?.id && (
            <MessagingPortal currentUserId={user.id} userRole="parent" />
          )}
        </div>
      </div>
    </div>
  );
}
