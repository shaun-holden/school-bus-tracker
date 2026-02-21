import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Bell, 
  AlertTriangle, 
  Clock, 
  Route as RouteIcon, 
  CheckCircle2, 
  MapPin,
  Bus,
  Check,
  Trash2
} from "lucide-react";

interface Notification {
  id: string;
  title: string;
  message: string;
  type: string;
  isRead: boolean;
  createdAt: string;
  estimatedDelay?: number;
}

export function NotificationCenter() {
  const [activeTab, setActiveTab] = useState("unread");

  const { data: notifications = [], isLoading } = useQuery<Notification[]>({
    queryKey: ["/api/parent-notifications"],
    refetchInterval: 10000,
  });

  const { data: unreadCount } = useQuery<{ unreadCount: number }>({
    queryKey: ["/api/parent-notifications/unread-count"],
    refetchInterval: 10000,
  });

  const markReadMutation = useMutation({
    mutationFn: async (notificationId: string) => {
      return apiRequest(`/api/notifications/${notificationId}/read`, "POST");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/parent-notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/parent-notifications/unread-count"] });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("/api/notifications/mark-all-read", "POST");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/parent-notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/parent-notifications/unread-count"] });
    },
  });

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case "emergency": return <AlertTriangle className="w-5 h-5 text-red-600" />;
      case "delay": return <Clock className="w-5 h-5 text-orange-600" />;
      case "route_change": return <RouteIcon className="w-5 h-5 text-blue-600" />;
      case "stop_arrival": return <MapPin className="w-5 h-5 text-green-600" />;
      case "bus_arrival": return <Bus className="w-5 h-5 text-green-600" />;
      default: return <Bell className="w-5 h-5 text-gray-600" />;
    }
  };

  const getNotificationStyle = (type: string, isRead: boolean) => {
    const opacity = isRead ? "opacity-70" : "";
    switch (type) {
      case "emergency": return `border-l-red-500 bg-red-50 ${opacity}`;
      case "delay": return `border-l-orange-500 bg-orange-50 ${opacity}`;
      case "route_change": return `border-l-blue-500 bg-blue-50 ${opacity}`;
      case "stop_arrival": return `border-l-green-500 bg-green-50 ${opacity}`;
      case "bus_arrival": return `border-l-green-500 bg-green-50 ${opacity}`;
      default: return `border-l-gray-500 bg-gray-50 ${opacity}`;
    }
  };

  const unreadNotifications = notifications.filter(n => !n.isRead);
  const readNotifications = notifications.filter(n => n.isRead);

  const displayNotifications = activeTab === "unread" ? unreadNotifications : 
                               activeTab === "read" ? readNotifications : notifications;

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-gray-500">
          Loading notifications...
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-2 shadow-lg">
      <CardHeader className="bg-gradient-to-r from-yellow-50 to-orange-50 border-b">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center text-xl">
            <div className="relative">
              <Bell className="w-6 h-6 mr-3 text-yellow-600" />
              {(unreadCount?.unreadCount || 0) > 0 && (
                <span className="absolute -top-2 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-bold">
                  {unreadCount?.unreadCount}
                </span>
              )}
            </div>
            Notifications
          </CardTitle>
          {unreadNotifications.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => markAllReadMutation.mutate()}
              disabled={markAllReadMutation.isPending}
            >
              <Check className="w-4 h-4 mr-1" />
              Mark All Read
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="w-full rounded-none border-b">
            <TabsTrigger value="unread" className="flex-1">
              Unread
              {unreadNotifications.length > 0 && (
                <Badge className="ml-2 bg-red-500 text-white text-xs">
                  {unreadNotifications.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="read" className="flex-1">Read</TabsTrigger>
            <TabsTrigger value="all" className="flex-1">All</TabsTrigger>
          </TabsList>

          <TabsContent value={activeTab} className="m-0">
            <ScrollArea className="h-[400px]">
              {displayNotifications.length === 0 ? (
                <div className="p-8 text-center text-gray-500">
                  <Bell className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                  <p className="text-lg font-medium">No {activeTab} notifications</p>
                  <p className="text-sm mt-1">You'll see bus alerts and updates here</p>
                </div>
              ) : (
                <div className="divide-y">
                  {displayNotifications.map((notification) => (
                    <div 
                      key={notification.id}
                      className={`p-4 border-l-4 transition-all hover:shadow-sm ${getNotificationStyle(notification.type, notification.isRead)}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start space-x-3 flex-1">
                          <div className="mt-0.5">
                            {getNotificationIcon(notification.type)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center flex-wrap gap-2 mb-1">
                              <span className={`font-semibold ${notification.isRead ? 'text-gray-600' : 'text-gray-900'}`}>
                                {notification.title}
                              </span>
                              <Badge variant="outline" className="text-xs capitalize">
                                {notification.type.replace(/_/g, " ")}
                              </Badge>
                              {!notification.isRead && (
                                <Badge className="bg-blue-500 text-white text-xs">New</Badge>
                              )}
                              {notification.estimatedDelay && (
                                <Badge variant="secondary" className="text-xs">
                                  ~{notification.estimatedDelay} min delay
                                </Badge>
                              )}
                            </div>
                            <p className={`text-sm mt-1 ${notification.isRead ? 'text-gray-500' : 'text-gray-700'}`}>
                              {notification.message}
                            </p>
                            <p className="text-xs text-gray-400 mt-2">
                              {new Date(notification.createdAt).toLocaleString()}
                            </p>
                          </div>
                        </div>
                        {!notification.isRead && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => markReadMutation.mutate(notification.id)}
                            disabled={markReadMutation.isPending}
                            className="shrink-0"
                          >
                            <CheckCircle2 className="w-5 h-5 text-green-600" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
