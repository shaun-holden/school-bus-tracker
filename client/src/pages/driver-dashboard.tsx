import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import AppNavigation from "@/components/shared/Navigation";
import { MessagingPortal } from "@/components/shared/MessagingPortal";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { isUnauthorizedError } from "@/lib/authUtils";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { 
  MapPin, Clock, Users, CheckCircle, Fuel, AlertTriangle, Clipboard, 
  Plus, UserPlus, Route as RouteIcon, FileText, Settings, Car, 
  Calendar, TrendingUp, BarChart3, Wrench, User, Save, Power, Bus,
  Navigation, Timer, School, Bell, BarChart, MessageCircle
} from "lucide-react";
import { driverCheckInSchema, type DriverCheckIn } from "@shared/schema";
import { Loader2, Send } from "lucide-react";

// Schema for driver route broadcast
const driverBroadcastSchema = z.object({
  title: z.string().min(1, "Title is required"),
  message: z.string().min(1, "Message is required"),
  type: z.enum(["info", "delay", "emergency", "route_change"]).default("info"),
});

// DriverRouteBroadcast Component - allows drivers to send notifications to all route parents
function DriverRouteBroadcast({ 
  assignedRouteId, 
  isOnDuty 
}: { 
  assignedRouteId?: string; 
  isOnDuty: boolean;
}) {
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const form = useForm<z.infer<typeof driverBroadcastSchema>>({
    resolver: zodResolver(driverBroadcastSchema),
    defaultValues: {
      title: "",
      message: "",
      type: "info",
    },
  });

  const sendNotificationMutation = useMutation({
    mutationFn: async (data: z.infer<typeof driverBroadcastSchema>) => {
      return apiRequest("/api/driver/system-notifications", "POST", {
        ...data,
        routeId: assignedRouteId,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/system-notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/system-notifications/unread-count"] });
      setIsDialogOpen(false);
      form.reset();
      toast({
        title: "Success",
        description: "Notification sent to route parents",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to send notification",
        variant: "destructive",
      });
    },
  });

  if (!isOnDuty || !assignedRouteId) {
    return (
      <Card className="border-dashed border-gray-300 bg-gray-50">
        <CardContent className="py-6 text-center text-gray-500">
          <Bell className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p>Go on duty with an assigned route to send notifications to parents</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Bell className="w-5 h-5 text-blue-600" />
              Broadcast to Route Parents
            </CardTitle>
            <CardDescription>
              Send a notification to all parents on your route
            </CardDescription>
          </div>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Send className="w-4 h-4 mr-2" />
                Send Alert
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Send Notification to Parents</DialogTitle>
                <DialogDescription>
                  This notification will be sent to all parents with students on your current route.
                </DialogDescription>
              </DialogHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit((data) => sendNotificationMutation.mutate(data))} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="type"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Notification Type</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select type" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="info">General Info</SelectItem>
                            <SelectItem value="delay">Delay</SelectItem>
                            <SelectItem value="emergency">Emergency</SelectItem>
                            <SelectItem value="route_change">Route Change</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="title"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Title</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="e.g. Running 10 minutes late" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="message"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Message</FormLabel>
                        <FormControl>
                          <Textarea {...field} placeholder="Provide details for parents..." />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="flex justify-end space-x-3 pt-4">
                    <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button type="submit" disabled={sendNotificationMutation.isPending}>
                      {sendNotificationMutation.isPending ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Send className="w-4 h-4 mr-2" />
                      )}
                      Send
                    </Button>
                  </div>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
    </Card>
  );
}

// DriverAdminAlerts Component - shows alerts sent by admin to drivers
function DriverAdminAlerts() {
  const { data: notifications, isLoading } = useQuery({
    queryKey: ["/api/system-notifications"],
    retry: false,
    refetchInterval: 30000,
  });

  const adminAlerts = Array.isArray(notifications)
    ? notifications.filter((n: any) => n.senderRole === 'admin')
    : [];

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "emergency": return <AlertTriangle className="w-4 h-4 text-red-600" />;
      case "delay": return <Clock className="w-4 h-4 text-orange-600" />;
      case "route_change": return <RouteIcon className="w-4 h-4 text-blue-600" />;
      default: return <Bell className="w-4 h-4 text-gray-600" />;
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case "emergency": return "border-red-500 bg-red-50";
      case "delay": return "border-orange-500 bg-orange-50";
      case "route_change": return "border-blue-500 bg-blue-50";
      default: return "border-gray-300 bg-gray-50";
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-6 text-center">
          <Loader2 className="w-6 h-6 animate-spin mx-auto" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <Bell className="w-5 h-5 text-purple-600" />
          Admin Alerts
          {adminAlerts.filter((n: any) => !n.isRead).length > 0 && (
            <Badge className="bg-red-500 text-white">
              {adminAlerts.filter((n: any) => !n.isRead).length} new
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          Important updates from administration
        </CardDescription>
      </CardHeader>
      <CardContent>
        {adminAlerts.length > 0 ? (
          <div className="space-y-3 max-h-64 overflow-y-auto">
            {adminAlerts.slice(0, 5).map((notification: any) => (
              <div 
                key={notification.id}
                className={`p-3 rounded-lg border-l-4 ${getTypeColor(notification.type)}`}
              >
                <div className="flex items-start gap-2">
                  {getTypeIcon(notification.type)}
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h4 className="font-medium text-sm">{notification.title}</h4>
                      {!notification.isRead && (
                        <Badge variant="destructive" className="text-xs h-4">New</Badge>
                      )}
                    </div>
                    <p className="text-sm text-gray-600 mt-1">{notification.message}</p>
                    <p className="text-xs text-gray-400 mt-1">
                      {new Date(notification.createdAt).toLocaleString()}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-4 text-gray-500">
            <Bell className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No alerts from administration</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Form schemas
const assignDriverSchema = z.object({
  driverId: z.string().min(1, "Driver selection is required"),
  routeId: z.string().min(1, "Route selection is required"),
  busId: z.string().min(1, "Bus selection is required"),
});

export default function DriverDashboard() {
  const { toast } = useToast();
  const { isAuthenticated, isLoading, user } = useAuth();
  const [currentLocation, setCurrentLocation] = useState({ lat: 40.7128, lng: -74.0060 });
  const [activeTab, setActiveTab] = useState("overview");
  const [isOnDuty, setIsOnDuty] = useState((user as any)?.isOnDuty || false);
  const [showDutyDialog, setShowDutyDialog] = useState(false);
  const [showCheckInDialog, setShowCheckInDialog] = useState(false);
  const [selectedDriverId, setSelectedDriverId] = useState("");

  // Update duty status when user data changes
  useEffect(() => {
    if ((user as any)?.isOnDuty !== undefined) {
      setIsOnDuty((user as any).isOnDuty);
    }
  }, [(user as any)?.isOnDuty]);

  // Initialize check-in form
  const checkInForm = useForm<DriverCheckIn>({
    resolver: zodResolver(driverCheckInSchema),
    defaultValues: {
      driverId: "",
      fuelLevel: "Full",
      interiorClean: true,
      exteriorClean: true,
      routeId: "",
      busId: "",
    },
  });

  // Driver check-in mutation - ties all duty actions together
  const checkInMutation = useMutation({
    mutationFn: async (data: DriverCheckIn) => {
      // Perform check-in which also activates route
      const result = await apiRequest("/api/driver-check-in", "POST", data);
      
      // Also activate route after check-in
      try {
        await apiRequest("/api/driver/activate-route", "POST", {});
      } catch (e) {
        console.log("Route activation after check-in - handled by check-in");
      }
      
      return result;
    },
    onSuccess: async () => {
      // First, refetch user data to get updated assignedRouteId
      await queryClient.refetchQueries({ queryKey: ["/api/auth/user"] });
      
      // Set on duty state
      setIsOnDuty(true);
      setShowCheckInDialog(false);
      checkInForm.reset();
      
      // Now refetch all route-related data with fresh user data
      queryClient.invalidateQueries({ queryKey: ["/api/routes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/drivers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/on-duty-drivers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/buses"] });
      
      // Force refetch route data queries
      await queryClient.refetchQueries({ queryKey: ["/api/driver-route-students"] });
      await queryClient.refetchQueries({ queryKey: ["/api/driver-route-stops"] });
      await queryClient.refetchQueries({ queryKey: ["/api/driver-route-schools"] });
      queryClient.invalidateQueries({ queryKey: ["/api/driver-school-visits"] });
      queryClient.invalidateQueries({ queryKey: ["/api/student-attendance"] });
      queryClient.invalidateQueries({ queryKey: ["/api/messages/contacts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/messages/conversations"] });
      
      toast({
        title: "Checked In Successfully",
        description: "You are now on duty with route activated. Drive safely!",
      });
    },
    onError: (error) => {
      if (isUnauthorizedError(error)) {
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
      toast({
        title: "Error",
        description: error?.message || "Failed to check in. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Form instances
  const assignDriverForm = useForm({
    resolver: zodResolver(assignDriverSchema),
    defaultValues: {
      driverId: "",
      routeId: "",
      busId: "",
    },
  });

  // Update duty status from user data
  useEffect(() => {
    if (user) {
      setIsOnDuty((user as any).isOnDuty || false);
    }
  }, [user]);

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

  const { data: students } = useQuery({
    queryKey: ["/api/students"],
    enabled: !!user,
    retry: false,
  });

  const { data: routes } = useQuery({
    queryKey: ["/api/routes"],
    enabled: !!user,
    retry: false,
    refetchInterval: 5000, // Refresh every 5 seconds for route assignments
  });

  // Query for available routes during check-in
  const { data: availableRoutes } = useQuery({
    queryKey: ["/api/available-routes"],
    enabled: !!user && showCheckInDialog,
    retry: false,
  });

  // Query for available buses during check-in
  const { data: availableBuses } = useQuery({
    queryKey: ["/api/available-buses"],
    enabled: !!user && showCheckInDialog,
    retry: false,
  });

  // Query for all drivers from administration for check-in
  const { data: adminDrivers } = useQuery({
    queryKey: ["/api/driver-profiles-checkin"],
    enabled: !!user && showCheckInDialog,
    retry: false,
  });

  // Query for students on assigned route - always enabled when on duty, backend returns empty if no route
  const { data: routeStudents, refetch: refetchRouteStudents } = useQuery({
    queryKey: ["/api/driver-route-students"],
    enabled: !!user && isOnDuty,
    retry: false,
    refetchInterval: 30000,
  });

  // Query for route stops - always enabled when on duty, backend returns empty if no route
  const { data: routeStops, refetch: refetchRouteStops } = useQuery({
    queryKey: ["/api/driver-route-stops"],
    enabled: !!user && isOnDuty,
    retry: false,
    refetchInterval: 30000,
  });

  // Query for route schools - always enabled when on duty, backend returns empty if no route
  const { data: routeSchools, refetch: refetchRouteSchools } = useQuery({
    queryKey: ["/api/driver-route-schools"],
    enabled: !!user && isOnDuty,
    retry: false,
    refetchInterval: 30000,
  });

  // Query for assigned route details
  const { data: assignedRoute } = useQuery<{ id: string; name: string; description?: string; estimatedDuration?: number }>({
    queryKey: ["/api/routes", (user as any)?.assignedRouteId],
    enabled: !!user && !!(user as any)?.assignedRouteId,
    retry: false,
  });

  // Query for today's school visits (arrival/departure tracking) - always enabled when on duty
  const { data: schoolVisits, refetch: refetchSchoolVisits } = useQuery({
    queryKey: ["/api/driver-school-visits"],
    enabled: !!user && isOnDuty,
    retry: false,
    refetchInterval: 30000,
  });

  // Query for completed stops today - used to show which stops the driver has arrived at
  const assignedRouteId = (user as any)?.assignedRouteId;
  const { data: completedStops, refetch: refetchCompletedStops } = useQuery<any[]>({
    queryKey: ["/api/routes", assignedRouteId, "completed-stops"],
    enabled: !!user && isOnDuty && !!assignedRouteId,
    retry: false,
    refetchInterval: 10000,
  });

  // Mutation to mark a stop as completed (arrived)
  const markStopCompletedMutation = useMutation({
    mutationFn: async ({ routeStopId, routeId, stopSequence }: { routeStopId: string; routeId: string; stopSequence: number }) => {
      return apiRequest("/api/driver/mark-stop-completed", "POST", {
        routeStopId,
        routeId,
        stopSequence,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/routes", assignedRouteId, "completed-stops"] });
      toast({
        title: "Success",
        description: "Stop marked as arrived. Parents have been notified.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to mark stop",
        variant: "destructive",
      });
    },
  });

  // Query for today's student attendance - always enabled when on duty
  const { data: studentAttendanceData, refetch: refetchAttendance } = useQuery({
    queryKey: ["/api/student-attendance"],
    enabled: !!user && isOnDuty,
    retry: false,
    refetchInterval: 30000,
  });

  const { data: buses } = useQuery({
    queryKey: ["/api/buses"],
    enabled: !!user,
    retry: false,
    refetchInterval: 5000, // Refresh every 5 seconds to get real-time updates
  });

  const { data: driverTasks } = useQuery({
    queryKey: ["/api/driver-tasks"],
    enabled: !!user,
    retry: false,
    refetchInterval: 30000,
  });

  // Query for all drivers to allow selection
  const { data: allDrivers } = useQuery({
    queryKey: ["/api/driver-names"],
    enabled: !!user,
    retry: false,
    refetchInterval: 30000,
  });

  // Query for admin requests and assignments
  const { data: adminRequests } = useQuery({
    queryKey: ["/api/admin-requests"],
    enabled: !!user,
    retry: false,
    refetchInterval: 30000,
  });

  // Query for unread messages count
  const { data: unreadMessagesData } = useQuery<{ unreadCount: number }>({
    queryKey: ["/api/messages/unread-count"],
    enabled: !!user,
    retry: false,
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Get pending tasks count (tasks not completed)
  const pendingTasksCount = Array.isArray(driverTasks) 
    ? driverTasks.filter((task: any) => task.status !== 'completed').length 
    : 0;

  // Get routes assigned to current driver
  const assignedRoutes = Array.isArray(routes) 
    ? routes.filter((route: any) => route.driverId === (user as any)?.id) 
    : [];

  // Get bus assigned to current driver (only one bus allowed per driver)
  const assignedBus = Array.isArray(buses) 
    ? buses.find((bus: any) => bus.driverId === (user as any)?.id) 
    : null;

  // Log bus assignment changes and show toast notification
  useEffect(() => {
    if (assignedBus) {
      console.log('Driver assigned bus updated:', assignedBus);
      // Only show toast if this is not the initial load
      const hasShownInitialLoad = sessionStorage.getItem('initial-bus-load-shown');
      if (hasShownInitialLoad) {
        toast({
          title: "Bus Assignment Updated",
          description: `You are now assigned to Bus #${assignedBus.busNumber}`,
          duration: 4000,
        });
      } else {
        sessionStorage.setItem('initial-bus-load-shown', 'true');
      }
    } else {
      console.log('Driver has no assigned bus');
    }
  }, [assignedBus, toast]);

  // State for location sharing
  const [isLocationSharing, setIsLocationSharing] = useState(false);
  const [lastLocationUpdate, setLastLocationUpdate] = useState<Date | null>(null);

  // Auto-update location every 30 seconds when on duty with assigned bus
  useEffect(() => {
    if (!isOnDuty || !assignedBus?.id) {
      setIsLocationSharing(false);
      return;
    }

    const updateLocation = () => {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          async (position) => {
            try {
              await apiRequest('/api/driver/update-location', 'POST', {
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
                speed: position.coords.speed ? Math.round(position.coords.speed * 2.237) : 0 // Convert m/s to mph
              });
              queryClient.invalidateQueries({ queryKey: ['/api/buses'] });
              setIsLocationSharing(true);
              setLastLocationUpdate(new Date());
              console.log('Location update successful');
            } catch (error) {
              console.error('Location update failed:', error);
              setIsLocationSharing(false);
            }
          },
          (error) => {
            console.error('Geolocation error:', error);
            setIsLocationSharing(false);
          },
          { enableHighAccuracy: true, timeout: 10000 }
        );
      }
    };

    // Initial update
    updateLocation();

    // Set up interval for every 30 seconds
    const intervalId = setInterval(updateLocation, 30000);

    return () => clearInterval(intervalId);
  }, [isOnDuty, assignedBus?.id]);

  // Mutations
  const completeTaskMutation = useMutation({
    mutationFn: async (taskId: string) => {
      return apiRequest(`/api/driver-tasks/${taskId}/complete`, "PUT", {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/driver-tasks"] });
      toast({
        title: "Task Completed",
        description: "The task has been marked as completed.",
      });
    },
    onError: (error) => {
      if (isUnauthorizedError(error)) {
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
      toast({
        title: "Error",
        description: "Failed to complete task",
        variant: "destructive",
      });
    },
  });

  // Acknowledge admin request mutation
  const acknowledgeRequestMutation = useMutation({
    mutationFn: async (requestId: string) => {
      return await apiRequest(`/api/admin-requests/${requestId}/acknowledge`, "PATCH", {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin-requests"] });
      toast({
        title: "Request Acknowledged",
        description: "Request moved to Recent Communications",
      });
    },
    onError: (error) => {
      if (isUnauthorizedError(error)) {
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
      toast({
        title: "Error",
        description: "Failed to acknowledge request",
        variant: "destructive",
      });
    },
  });

  // Complete admin request mutation
  const completeRequestMutation = useMutation({
    mutationFn: async (requestId: string) => {
      return await apiRequest(`/api/admin-requests/${requestId}/complete`, "PATCH", {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin-requests"] });
      toast({
        title: "Request Completed",
        description: "Task marked as completed",
      });
    },
    onError: (error) => {
      if (isUnauthorizedError(error)) {
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
      toast({
        title: "Error",
        description: "Failed to complete request",
        variant: "destructive",
      });
    },
  });

  // Duty status toggle mutation - ties all duty actions together
  const toggleDutyMutation = useMutation({
    mutationFn: async (onDutyStatus: boolean) => {
      // Update duty status
      const result = await apiRequest("/api/driver/duty-status", "PATCH", {
        isOnDuty: onDutyStatus
      });
      
      // Also activate/deactivate route (update bus status) when going on/off duty
      if (onDutyStatus) {
        try {
          await apiRequest("/api/driver/activate-route", "POST", {});
        } catch (e) {
          console.log("Route activation skipped - no bus/route assigned");
        }
      } else {
        try {
          await apiRequest("/api/driver/deactivate-route", "POST", {});
        } catch (e) {
          console.log("Route deactivation skipped - no bus/route assigned");
        }
      }
      
      return result;
    },
    onSuccess: async (updatedUser) => {
      // First, refetch user data to ensure fresh state
      await queryClient.refetchQueries({ queryKey: ["/api/auth/user"] });
      
      setIsOnDuty(updatedUser.isOnDuty);
      
      // Invalidate all related queries to refresh data
      queryClient.invalidateQueries({ queryKey: ["/api/on-duty-drivers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/buses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/routes"] });
      
      // Force refetch route data queries if going on duty
      if (updatedUser.isOnDuty) {
        await queryClient.refetchQueries({ queryKey: ["/api/driver-route-students"] });
        await queryClient.refetchQueries({ queryKey: ["/api/driver-route-stops"] });
        await queryClient.refetchQueries({ queryKey: ["/api/driver-route-schools"] });
        queryClient.invalidateQueries({ queryKey: ["/api/driver-school-visits"] });
        queryClient.invalidateQueries({ queryKey: ["/api/student-attendance"] });
        queryClient.invalidateQueries({ queryKey: ["/api/messages/contacts"] });
        queryClient.invalidateQueries({ queryKey: ["/api/messages/conversations"] });
      }
      
      toast({
        title: updatedUser.isOnDuty ? "Now On Duty" : "Now Off Duty",
        description: updatedUser.isOnDuty 
          ? "You are now on duty - route activated" 
          : "You are now off duty - route deactivated",
      });
    },
    onError: (error: any) => {
      console.error("Error toggling duty status:", error);
      if (isUnauthorizedError(error)) {
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
      toast({
        title: "Error",
        description: "Failed to update duty status",
        variant: "destructive",
      });
    },
  });

  const toggleDutyStatus = () => {
    if (!isOnDuty) {
      // Show check-in dialog when going on duty
      setShowCheckInDialog(true);
    } else {
      // Go off duty immediately
      toggleDutyMutation.mutate(false);
    }
  };



  const handleConfirmDuty = () => {
    if (selectedDriverId) {
      toggleDutyMutation.mutate(true);
      setShowDutyDialog(false);
    }
  };

  // Route activation mutations
  const activateRouteMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("/api/driver/activate-route", "POST", {});
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/buses"] });
      toast({
        title: "Route Activated",
        description: `Your route is now active and visible to administrators.`,
      });
    },
    onError: (error) => {
      if (isUnauthorizedError(error)) {
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
      toast({
        title: "Error",
        description: "Failed to activate route",
        variant: "destructive",
      });
    },
  });

  const deactivateRouteMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("/api/driver/deactivate-route", "POST", {});
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/buses"] });
      toast({
        title: "Route Ended",
        description: `Your route has been deactivated. Shift ended.`,
      });
    },
    onError: (error) => {
      if (isUnauthorizedError(error)) {
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
      toast({
        title: "Error",
        description: "Failed to deactivate route",
        variant: "destructive",
      });
    },
  });

  // School arrival mutation
  const schoolArrivalMutation = useMutation({
    mutationFn: async (schoolId: string) => {
      return await apiRequest("/api/driver-school-arrival", "POST", { schoolId });
    },
    onSuccess: () => {
      refetchSchoolVisits();
      toast({
        title: "Arrival Recorded",
        description: "School arrival time has been successfully recorded.",
      });
    },
    onError: (error) => {
      if (isUnauthorizedError(error)) {
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
      toast({
        title: "Error",
        description: "Failed to record school arrival. Please try again.",
        variant: "destructive",
      });
    },
  });

  // School departure mutation
  const schoolDepartureMutation = useMutation({
    mutationFn: async (visitId: string) => {
      return await apiRequest("/api/driver-school-departure", "POST", { visitId });
    },
    onSuccess: () => {
      refetchSchoolVisits();
      toast({
        title: "Departure Recorded",
        description: "School departure time has been successfully recorded.",
      });
    },
    onError: (error) => {
      if (isUnauthorizedError(error)) {
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
      toast({
        title: "Error",
        description: "Failed to record school departure. Please try again.",
        variant: "destructive",
      });
    },
  });

  // Student attendance mutations
  const markAttendanceMutation = useMutation({
    mutationFn: async ({ studentId, status }: { studentId: string; status: "present" | "absent" }) => {
      return await apiRequest("/api/student-attendance", "POST", { studentId, status });
    },
    onSuccess: (_, variables) => {
      refetchAttendance();
      const statusColor = variables.status === "present" ? "green" : "blue";
      toast({
        title: "Attendance Recorded",
        description: `Student marked as ${variables.status}`,
        className: variables.status === "present" ? "border-green-500" : "border-blue-500",
      });
    },
    onError: (error) => {
      if (isUnauthorizedError(error)) {
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
      toast({
        title: "Error",
        description: "Failed to record attendance. Please try again.",
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  // Get drivers from API or use fallback
  const availableDrivers = Array.isArray(allDrivers) && allDrivers.length > 0 
    ? allDrivers.map((driver: any) => ({ id: driver.id, name: driver.firstName && driver.lastName ? `${driver.firstName} ${driver.lastName}` : driver.name || 'Unknown Driver' }))
    : [
        { id: "1", name: "John Smith" },
        { id: "2", name: "Sarah Johnson" },
        { id: "3", name: "Mike Wilson" },
      ];

  return (
    <div className="min-h-screen bg-background">
      <AppNavigation />
      
      {/* Header */}
      <div className="bg-primary text-white py-6">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">Driver Management Dashboard</h1>
              <p className="text-blue-100">Comprehensive bus fleet and student management</p>
            </div>
            <div className="flex items-center space-x-4">
              <Button
                onClick={toggleDutyStatus}
                disabled={toggleDutyMutation.isPending}
                size="sm"
                className={isOnDuty 
                  ? "bg-green-600 hover:bg-green-700 text-white" 
                  : "bg-gray-600 hover:bg-gray-700 text-white"
                }
                data-testid="button-duty-toggle"
              >
                <Power className="w-4 h-4 mr-2" />
                {toggleDutyMutation.isPending 
                  ? "Updating..." 
                  : isOnDuty 
                    ? "On Duty" 
                    : "Off Duty"
                }
              </Button>
              <Badge 
                variant="secondary" 
                className={isOnDuty ? "bg-green-500" : "bg-gray-500"}
              >
                <CheckCircle className="w-4 h-4 mr-1" />
                {isOnDuty ? "Available" : "Unavailable"}
              </Badge>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Quick Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center">
                <Users className="h-8 w-8 text-blue-600" />
                <div className="ml-4">
                  <p className="text-2xl font-semibold">{Array.isArray(students) ? students.length : 0}</p>
                  <p className="text-gray-600">Total Students</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center">
                <RouteIcon className="h-8 w-8 text-green-600" />
                <div className="ml-4">
                  <p className="text-2xl font-semibold">{Array.isArray(routes) ? routes.length : 0}</p>
                  <p className="text-gray-600">Active Routes</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center">
                <Car className="h-8 w-8 text-purple-600" />
                <div className="ml-4">
                  <p className="text-2xl font-semibold">{Array.isArray(buses) ? buses.length : 0}</p>
                  <p className="text-gray-600">Fleet Size</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center">
                <Clipboard className="h-8 w-8 text-orange-600" />
                <div className="ml-4">
                  <p className="text-2xl font-semibold">{Array.isArray(driverTasks) ? driverTasks.length : 0}</p>
                  <p className="text-gray-600">Pending Tasks</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Main Content Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-7">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="admin-requests">
              Admin Requests
              {Array.isArray(adminRequests) && adminRequests.length > 0 && (
                <Badge className="ml-1 h-4 w-4 p-0 text-xs bg-red-500">
                  {adminRequests.filter((req: any) => req.status === 'pending').length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="students" data-testid="tab-students">
              Students
              {Array.isArray(routeStudents) && routeStudents.length > 0 && (
                <Badge className="ml-1 h-4 w-4 p-0 text-xs bg-blue-500">
                  {routeStudents.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="messages" className="flex items-center gap-2" data-testid="tab-messages">
              <MessageCircle className="w-4 h-4" />
              Messages
              {unreadMessagesData?.unreadCount && unreadMessagesData.unreadCount > 0 && (
                <Badge className="ml-1 h-4 w-4 p-0 text-xs bg-green-500">
                  {unreadMessagesData.unreadCount}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="routes">Routes</TabsTrigger>
            <TabsTrigger value="assignments">My Assignments</TabsTrigger>
            <TabsTrigger value="tasks">
              Tasks
              {pendingTasksCount > 0 && (
                <Badge className="ml-1 h-4 w-4 p-0 text-xs bg-orange-500">
                  {pendingTasksCount}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/* Students Tab */}
          <TabsContent value="students">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="w-5 h-5" />
                  Route Students
                  {(user as any)?.assignedRouteId && assignedRoute && (
                    <Badge variant="outline" className="ml-2">
                      Route: {assignedRoute.name}
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription>
                  {isOnDuty && (user as any)?.assignedRouteId 
                    ? `Students assigned to your current route - ${Array.isArray(routeStudents) ? routeStudents.length : 0} total`
                    : "Students will appear here when you're on duty with an assigned route"
                  }
                </CardDescription>
              </CardHeader>
              <CardContent>
                {!isOnDuty ? (
                  <div className="text-center py-12">
                    <Users className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                    <h3 className="text-lg font-medium text-gray-900 mb-2">Go On Duty to View Students</h3>
                    <p className="text-gray-500 mb-4">Student information will be available when you're on duty</p>
                    <Button 
                      onClick={toggleDutyStatus}
                      disabled={toggleDutyMutation.isPending}
                      data-testid="button-go-on-duty"
                    >
                      <Power className="w-4 h-4 mr-2" />
                      Go On Duty
                    </Button>
                  </div>
                ) : Array.isArray(routeStudents) && routeStudents.length > 0 ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {routeStudents.map((student: any) => (
                        <Card key={student.id} className={`hover:shadow-md transition-shadow border-l-4 ${
                          (() => {
                            const attendance = Array.isArray(studentAttendanceData) 
                              ? studentAttendanceData.find((att: any) => att.studentId === student.id)
                              : null;
                            return attendance?.status === "present" 
                              ? "border-l-green-500 bg-green-50" 
                              : attendance?.status === "absent" 
                                ? "border-l-blue-500 bg-blue-50" 
                                : "border-l-gray-300";
                          })()
                        }`}>
                          <CardContent className="p-4">
                            <div className="flex items-start justify-between mb-3">
                              <div>
                                <h4 className="font-medium text-lg">
                                  {student.firstName} {student.lastName}
                                </h4>
                                <p className="text-sm text-gray-600">
                                  Grade {student.grade}
                                </p>
                              </div>
                              <Badge 
                                variant="outline"
                                className={(() => {
                                  const attendance = Array.isArray(studentAttendanceData) 
                                    ? studentAttendanceData.find((att: any) => att.studentId === student.id)
                                    : null;
                                  return attendance?.status === "present" 
                                    ? "bg-green-100 text-green-700 border-green-200" 
                                    : attendance?.status === "absent" 
                                      ? "bg-blue-100 text-blue-700 border-blue-200" 
                                      : "bg-gray-50 text-gray-700";
                                })()}
                              >
                                {(() => {
                                  const attendance = Array.isArray(studentAttendanceData) 
                                    ? studentAttendanceData.find((att: any) => att.studentId === student.id)
                                    : null;
                                  return attendance?.status ? attendance.status.toUpperCase() : "PENDING";
                                })()}
                              </Badge>
                            </div>
                            
                            <div className="space-y-2 text-sm">
                              {(student.school || student.schoolId) && (
                                <div className="flex items-center gap-2">
                                  <School className="w-4 h-4 text-blue-500" />
                                  <span className="text-gray-600">{student.school?.name || `School ID: ${student.schoolId}`}</span>
                                </div>
                              )}
                              {student.stopId && (
                                <div className="flex items-center gap-2">
                                  <MapPin className="w-4 h-4 text-orange-500" />
                                  <span className="text-gray-600">Stop ID: {student.stopId}</span>
                                </div>
                              )}
                              <div className="flex items-center gap-2">
                                <Calendar className="w-4 h-4 text-purple-500" />
                                <span className="text-gray-600">
                                  Joined: {new Date(student.createdAt).toLocaleDateString()}
                                </span>
                              </div>
                            </div>

                            <div className="mt-4 pt-3 border-t">
                              {/* Check for attendance record */}
                              {(() => {
                                const attendance = Array.isArray(studentAttendanceData) 
                                  ? studentAttendanceData.find((att: any) => att.studentId === student.id)
                                  : null;
                                
                                return (
                                  <div className="space-y-2">
                                    {attendance && (
                                      <div className={`text-xs font-medium p-2 rounded ${
                                        attendance.status === "present" 
                                          ? "bg-green-100 text-green-700" 
                                          : "bg-blue-100 text-blue-700"
                                      }`}>
                                        Marked {attendance.status} at {new Date(attendance.createdAt).toLocaleTimeString()}
                                      </div>
                                    )}
                                    <div className="flex gap-2">
                                      <Button
                                        size="sm"
                                        variant={attendance?.status === "present" ? "default" : "outline"}
                                        className={`flex-1 ${
                                          attendance?.status === "present" 
                                            ? "bg-green-600 hover:bg-green-700 text-white" 
                                            : "hover:bg-green-50 hover:text-green-700 hover:border-green-300"
                                        }`}
                                        onClick={() => markAttendanceMutation.mutate({ studentId: student.id, status: "present" })}
                                        disabled={markAttendanceMutation.isPending}
                                        data-testid={`button-mark-present-${student.id}`}
                                      >
                                        <CheckCircle className="w-4 h-4 mr-1" />
                                        {markAttendanceMutation.isPending ? "Marking..." : "Present"}
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant={attendance?.status === "absent" ? "default" : "outline"}
                                        className={`flex-1 ${
                                          attendance?.status === "absent" 
                                            ? "bg-blue-600 hover:bg-blue-700 text-white" 
                                            : "hover:bg-blue-50 hover:text-blue-700 hover:border-blue-300"
                                        }`}
                                        onClick={() => markAttendanceMutation.mutate({ studentId: student.id, status: "absent" })}
                                        disabled={markAttendanceMutation.isPending}
                                        data-testid={`button-mark-absent-${student.id}`}
                                      >
                                        <AlertTriangle className="w-4 h-4 mr-1" />
                                        {markAttendanceMutation.isPending ? "Marking..." : "Absent"}
                                      </Button>
                                    </div>
                                  </div>
                                );
                              })()}
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>

                    {/* Student Summary */}
                    <Card className="mt-6 bg-blue-50">
                      <CardContent className="p-4">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                          <div>
                            <p className="text-2xl font-bold text-blue-600">{routeStudents.length}</p>
                            <p className="text-sm text-gray-600">Total Students</p>
                          </div>
                          <div>
                            <p className="text-2xl font-bold text-green-600">
                              {routeStudents.filter((s: any) => s.isActive).length}
                            </p>
                            <p className="text-sm text-gray-600">Active</p>
                          </div>
                          <div>
                            <p className="text-2xl font-bold text-purple-600">
                              {new Set(routeStudents.map((s: any) => s.grade)).size}
                            </p>
                            <p className="text-sm text-gray-600">Grade Levels</p>
                          </div>
                          <div>
                            <p className="text-2xl font-bold text-orange-600">
                              {routeStudents.filter((s: any) => s.stopId).length}
                            </p>
                            <p className="text-sm text-gray-600">With Stops</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <Users className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                    <h3 className="text-lg font-medium text-gray-900 mb-2">No Students on Route</h3>
                    <p className="text-gray-500">
                      No students are currently assigned to route "{assignedRoute?.name}"
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Admin Requests Tab */}
          <TabsContent value="admin-requests">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Pending Admin Requests */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center">
                    <AlertTriangle className="w-5 h-5 mr-2 text-red-500" />
                    Pending Admin Requests
                    {Array.isArray(adminRequests) && adminRequests.filter((req: any) => 
                      req.status === 'pending'
                    ).length > 0 && (
                      <Badge className="ml-2 bg-red-500">
                        {adminRequests.filter((req: any) => req.status === 'pending').length} New
                      </Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {Array.isArray(adminRequests) && adminRequests.filter((req: any) => 
                    req.status === 'pending'
                  ).length > 0 ? (
                    <div className="space-y-4">
                      {adminRequests.filter((req: any) => req.status === 'pending').map((request: any) => (
                        <div key={request.id} className="border border-red-200 bg-red-50 p-4 rounded-lg">
                          <div className="flex items-center justify-between mb-2">
                            <h4 className="font-semibold text-red-900">{request.title}</h4>
                            <Badge variant="destructive">Urgent</Badge>
                          </div>
                          <p className="text-sm text-red-800 mb-3">{request.description}</p>
                          <div className="flex gap-2">
                            <Button 
                              size="sm" 
                              onClick={() => acknowledgeRequestMutation.mutate(request.id)}
                              disabled={acknowledgeRequestMutation.isPending}
                              data-testid={`button-acknowledge-${request.id}`}
                            >
                              {acknowledgeRequestMutation.isPending ? "Acknowledging..." : "Acknowledge"}
                            </Button>
                            <Button 
                              size="sm" 
                              variant="outline"
                              onClick={() => completeRequestMutation.mutate(request.id)}
                              disabled={completeRequestMutation.isPending}
                              data-testid={`button-complete-${request.id}`}
                            >
                              {completeRequestMutation.isPending ? "Completing..." : "Mark Complete"}
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <CheckCircle className="w-12 h-12 mx-auto mb-4 text-green-500" />
                      <p className="text-gray-500">No pending requests from administration</p>
                      <p className="text-sm text-gray-400">New requests will appear here</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Recent Communications */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center">
                    <FileText className="w-5 h-5 mr-2" />
                    Recent Communications
                    {Array.isArray(adminRequests) && adminRequests.filter((req: any) => 
                      req.status === 'acknowledged' || req.status === 'completed'
                    ).length > 0 && (
                      <Badge className="ml-2 bg-blue-500">
                        {adminRequests.filter((req: any) => 
                          req.status === 'acknowledged' || req.status === 'completed'
                        ).length} Processed
                      </Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {Array.isArray(adminRequests) && adminRequests.filter((req: any) => 
                      req.status === 'acknowledged' || req.status === 'completed'
                    ).map((request: any) => (
                      <div key={request.id} className={`border-l-4 ${request.status === 'completed' ? 'border-green-500' : 'border-blue-500'} pl-4 py-2`}>
                        <div className="flex justify-between items-start">
                          <div>
                            <p className="font-medium">{request.title}</p>
                            <p className="text-sm text-gray-600">{request.description}</p>
                          </div>
                          <Badge variant="secondary" className={request.status === 'completed' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'}>
                            {request.status === 'completed' ? 'Completed' : 'Acknowledged'}
                          </Badge>
                        </div>
                      </div>
                    ))}
                    <div className="border-l-4 border-blue-500 pl-4 py-2">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="font-medium">Route Change Notice</p>
                          <p className="text-sm text-gray-600">Route A3 modified - new stop added at Maple Street</p>
                        </div>
                        <Badge variant="secondary">2 hrs ago</Badge>
                      </div>
                    </div>
                    <div className="border-l-4 border-green-500 pl-4 py-2">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="font-medium">Maintenance Approved</p>
                          <p className="text-sm text-gray-600">Bus #42 scheduled for service tomorrow at 6 AM</p>
                        </div>
                        <Badge variant="secondary">4 hrs ago</Badge>
                      </div>
                    </div>
                    <div className="border-l-4 border-yellow-500 pl-4 py-2">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="font-medium">New Student Assignment</p>
                          <p className="text-sm text-gray-600">Emily Johnson added to your route - pickup at Oak Avenue</p>
                        </div>
                        <Badge variant="secondary">1 day ago</Badge>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Overview Tab */}
          <TabsContent value="overview">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Current Route Status */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center">
                    <MapPin className="w-5 h-5 mr-2" />
                    Current Route Status
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {assignedRoutes.length > 0 ? (
                    <div className="space-y-4">
                      {assignedRoutes.map((route: any, index: number) => (
                        <div key={route.id} className="space-y-4">
                          <div className="flex justify-between items-center">
                            <span className="font-medium">{route.name}</span>
                            <Badge variant="secondary" className={route.isActive ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"}>
                              {route.isActive ? "Active" : "Inactive"}
                            </Badge>
                          </div>
                          {route.description && (
                            <p className="text-sm text-gray-600">{route.description}</p>
                          )}
                          {route.estimatedDuration && (
                            <div className="text-sm text-gray-600">
                              <p>Estimated Duration: {Math.floor(route.estimatedDuration / 60)}h {route.estimatedDuration % 60}m</p>
                            </div>
                          )}
                          <div className="text-sm text-gray-500">
                            <p>Route ID: {route.id.substring(0, 8)}...</p>
                            <p>Status: {route.isActive ? "Ready to start" : "Contact admin for activation"}</p>
                          </div>
                          {index < assignedRoutes.length - 1 && <hr className="my-4" />}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <MapPin className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                      <p className="text-gray-500">No route assigned</p>
                      <p className="text-sm text-gray-400">Contact administration to get route assignment</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Assigned Bus Status */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center">
                    <Car className="w-5 h-5 mr-2" />
                    Assigned Bus
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {assignedBus ? (
                    <div className="space-y-4">
                      <div className="text-center">
                        <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                          <Car className="w-8 h-8 text-blue-600" />
                        </div>
                        <p className="text-lg font-semibold">Bus #{assignedBus.busNumber}</p>
                        <p className="text-sm text-gray-500">
                          {assignedBus.make} {assignedBus.model} ({assignedBus.year})
                        </p>
                        {assignedBus.licensePlate && (
                          <p className="text-sm text-gray-500">License: {assignedBus.licensePlate}</p>
                        )}
                      </div>
                      
                      <div className="grid grid-cols-2 gap-4 pt-4 border-t">
                        <div className="text-center">
                          <div className="flex items-center justify-center mb-2">
                            <Fuel className={`w-4 h-4 mr-1 ${
                              assignedBus.fuelLevel === 'F' ? 'text-green-500' :
                              assignedBus.fuelLevel === '¾' || assignedBus.fuelLevel === '3/4' ? 'text-green-400' :
                              assignedBus.fuelLevel === '½' || assignedBus.fuelLevel === '1/2' ? 'text-yellow-500' :
                              assignedBus.fuelLevel === '¼' || assignedBus.fuelLevel === '1/4' ? 'text-orange-500' :
                              assignedBus.fuelLevel === 'E' ? 'text-red-500' : 'text-gray-500'
                            }`} />
                            <span className={`text-lg font-bold ${
                              assignedBus.fuelLevel === 'F' ? 'text-green-600' :
                              assignedBus.fuelLevel === '¾' || assignedBus.fuelLevel === '3/4' ? 'text-green-500' :
                              assignedBus.fuelLevel === '½' || assignedBus.fuelLevel === '1/2' ? 'text-yellow-600' :
                              assignedBus.fuelLevel === '¼' || assignedBus.fuelLevel === '1/4' ? 'text-orange-600' :
                              assignedBus.fuelLevel === 'E' ? 'text-red-600' : 'text-gray-600'
                            }`}>
                              {assignedBus.fuelLevel || 'Unknown'}
                            </span>
                          </div>
                          <p className="text-sm text-gray-600">Fuel Level</p>
                        </div>
                        <div className="text-center">
                          <div className="flex items-center justify-center mb-2">
                            <Clock className="w-4 h-4 text-blue-500 mr-1" />
                            <span className="text-lg font-bold text-blue-600">
                              {assignedBus.mileage ? `${assignedBus.mileage.toLocaleString()}` : 'N/A'}
                            </span>
                          </div>
                          <p className="text-sm text-gray-600">Mileage</p>
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-4 pt-4 border-t">
                        <div className="text-center">
                          <div className="flex items-center justify-center mb-2">
                            <Users className="w-4 h-4 text-purple-500 mr-1" />
                            <span className="text-lg font-bold text-purple-600">
                              {assignedBus.capacity || 'N/A'}
                            </span>
                          </div>
                          <p className="text-sm text-gray-600">Capacity</p>
                        </div>
                        <div className="text-center">
                          <div className="flex items-center justify-center mb-2">
                            <Badge 
                              className={`${
                                assignedBus.status === 'on_route' ? 'bg-green-100 text-green-800' :
                                assignedBus.status === 'idle' ? 'bg-blue-100 text-blue-800' :
                                assignedBus.status === 'maintenance' ? 'bg-orange-100 text-orange-800' : 'bg-red-100 text-red-800'
                              }`}
                            >
                              {assignedBus.status === 'on_route' ? 'ACTIVE' : 
                               assignedBus.status === 'idle' ? 'READY' : 
                               assignedBus.status === 'maintenance' ? 'MAINTENANCE' : 'EMERGENCY'}
                            </Badge>
                          </div>
                          <p className="text-sm text-gray-600">Status</p>
                        </div>
                      </div>
                      
                      {/* Location Sharing Status */}
                      <div className="pt-4 border-t mt-4">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <MapPin className="w-4 h-4 text-blue-500" />
                            <span className="font-medium text-sm">GPS Location Sharing</span>
                          </div>
                          {isOnDuty && isLocationSharing && (
                            <Badge className="bg-green-100 text-green-800 animate-pulse">
                              LIVE
                            </Badge>
                          )}
                        </div>
                        
                        {isOnDuty ? (
                          <div className="space-y-2">
                            <div className="flex items-center gap-2 text-sm">
                              <div className={`w-2 h-2 rounded-full ${isLocationSharing ? 'bg-green-500 animate-pulse' : 'bg-yellow-500'}`} />
                              <span className={isLocationSharing ? 'text-green-600' : 'text-yellow-600'}>
                                {isLocationSharing ? 'Sharing location with parents' : 'Starting location sharing...'}
                              </span>
                            </div>
                            {lastLocationUpdate && (
                              <p className="text-xs text-gray-500">
                                Last update: {lastLocationUpdate.toLocaleTimeString()}
                              </p>
                            )}
                            {assignedBus.currentLatitude && assignedBus.currentLongitude && (
                              <div className="text-xs text-gray-500">
                                Position: {parseFloat(assignedBus.currentLatitude).toFixed(4)}, {parseFloat(assignedBus.currentLongitude).toFixed(4)}
                              </div>
                            )}
                            <p className="text-xs text-gray-400 mt-2">
                              Location updates every 30 seconds while on duty
                            </p>
                          </div>
                        ) : (
                          <div className="text-center py-2">
                            <p className="text-sm text-gray-500">Location sharing starts when you check in</p>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Car className="w-8 h-8 text-gray-400" />
                      </div>
                      <p className="text-gray-500">No bus assigned</p>
                      <p className="text-sm text-gray-400">Contact administration to get bus assignment</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Messages Tab */}
          <TabsContent value="messages">
            <div className="space-y-6">
              <DriverAdminAlerts />
              <DriverRouteBroadcast 
                assignedRouteId={(user as any)?.assignedRouteId} 
                isOnDuty={isOnDuty} 
              />
              {user?.id && (
                <MessagingPortal currentUserId={user.id} userRole="driver" />
              )}
            </div>
          </TabsContent>

          {/* Routes Tab */}
          <TabsContent value="routes">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MapPin className="w-5 h-5" />
                  Route Information
                  {(user as any)?.assignedRouteId && assignedRoute && (
                    <Badge variant="outline" className="ml-2">
                      {assignedRoute.name}
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription>
                  {isOnDuty && (user as any)?.assignedRouteId 
                    ? `Your assigned route details and stops`
                    : "Route information will appear here when you're on duty with an assigned route"
                  }
                </CardDescription>
              </CardHeader>
              <CardContent>
                {!isOnDuty ? (
                  <div className="text-center py-12">
                    <MapPin className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                    <h3 className="text-lg font-medium text-gray-900 mb-2">Go On Duty to View Route</h3>
                    <p className="text-gray-500 mb-4">Route information will be available when you're on duty</p>
                    <Button 
                      onClick={toggleDutyStatus}
                      disabled={toggleDutyMutation.isPending}
                      data-testid="button-go-on-duty-routes"
                    >
                      <Power className="w-4 h-4 mr-2" />
                      Go On Duty
                    </Button>
                  </div>
                ) : (assignedRoute || (Array.isArray(routeStops) && routeStops.length > 0) || (Array.isArray(routeSchools) && routeSchools.length > 0)) ? (
                  <div className="space-y-6">
                    {/* Route Details */}
                    {assignedRoute && (
                      <Card className="bg-blue-50">
                        <CardHeader className="pb-3">
                          <CardTitle className="text-lg">{assignedRoute.name}</CardTitle>
                          {assignedRoute.description && (
                            <CardDescription>{assignedRoute.description}</CardDescription>
                          )}
                        </CardHeader>
                        <CardContent>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div className="text-center">
                              <p className="text-2xl font-bold text-blue-600">
                                {assignedRoute.estimatedDuration || 0}
                              </p>
                              <p className="text-sm text-gray-600">Minutes</p>
                            </div>
                            <div className="text-center">
                              <p className="text-2xl font-bold text-green-600">
                                {Array.isArray(routeStops) ? routeStops.length : 0}
                              </p>
                              <p className="text-sm text-gray-600">Stops</p>
                            </div>
                            <div className="text-center">
                              <p className="text-2xl font-bold text-purple-600">
                                {Array.isArray(routeSchools) ? routeSchools.length : 0}
                              </p>
                              <p className="text-sm text-gray-600">Schools</p>
                            </div>
                            <div className="text-center">
                              <p className="text-2xl font-bold text-orange-600">
                                {Array.isArray(routeStudents) ? routeStudents.length : 0}
                              </p>
                              <p className="text-sm text-gray-600">Students</p>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    )}

                    {/* School Stops Section */}
                    <div>
                      <h3 className="text-lg font-medium mb-4 flex items-center gap-2">
                        <School className="w-5 h-5 text-blue-500" />
                        School Stops
                        {Array.isArray(routeSchools) && routeSchools.length > 0 && (
                          <Badge variant="secondary" className="ml-2">
                            {routeSchools.length} schools
                          </Badge>
                        )}
                      </h3>
                      
                      {Array.isArray(routeSchools) && routeSchools.length > 0 ? (
                        <div className="grid gap-4">
                          {routeSchools.map((school: any, index: number) => {
                            // Find if there's a visit record for this school today
                            const schoolVisit = Array.isArray(schoolVisits) 
                              ? schoolVisits.find((visit: any) => visit.schoolId === school.id)
                              : null;
                            
                            return (
                              <Card key={school.id} className="hover:shadow-md transition-shadow">
                                <CardContent className="p-4">
                                  <div className="flex items-start justify-between mb-3">
                                    <div className="flex items-center gap-3">
                                      <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                                        <span className="text-blue-600 font-medium text-sm">{index + 1}</span>
                                      </div>
                                      <div>
                                        <h4 className="font-medium text-lg">{school.name}</h4>
                                        <p className="text-gray-600 text-sm">{school.address}</p>
                                      </div>
                                    </div>
                                    <Badge variant="outline" className="bg-blue-50 text-blue-700">
                                      School Stop
                                    </Badge>
                                  </div>
                                  
                                  <div className="flex items-center gap-4 text-sm text-gray-600 mb-4">
                                    <div className="flex items-center gap-1">
                                      <MapPin className="w-4 h-4" />
                                      <span>Stop #{index + 1}</span>
                                    </div>
                                    {school.latitude && school.longitude && (
                                      <div className="flex items-center gap-1">
                                        <Navigation className="w-4 h-4" />
                                        <span>GPS: {parseFloat(school.latitude).toFixed(4)}, {parseFloat(school.longitude).toFixed(4)}</span>
                                      </div>
                                    )}
                                  </div>

                                  {/* Arrival/Departure Controls */}
                                  <div className="space-y-2">
                                    {schoolVisit ? (
                                      <div className="space-y-2">
                                        {schoolVisit.arrivedAt && (
                                          <div className="flex items-center gap-2 text-green-600 text-sm">
                                            <CheckCircle className="w-4 h-4" />
                                            <span>Arrived: {new Date(schoolVisit.arrivedAt).toLocaleTimeString()}</span>
                                          </div>
                                        )}
                                        {schoolVisit.departedAt && (
                                          <div className="flex items-center gap-2 text-blue-600 text-sm">
                                            <CheckCircle className="w-4 h-4" />
                                            <span>Departed: {new Date(schoolVisit.departedAt).toLocaleTimeString()}</span>
                                          </div>
                                        )}
                                        {schoolVisit.arrivedAt && !schoolVisit.departedAt && (
                                          <Button
                                            size="sm"
                                            onClick={() => schoolDepartureMutation.mutate(schoolVisit.id)}
                                            disabled={schoolDepartureMutation.isPending}
                                            className="w-full bg-orange-600 hover:bg-orange-700"
                                            data-testid={`button-depart-${school.id}`}
                                          >
                                            <Timer className="w-4 h-4 mr-2" />
                                            {schoolDepartureMutation.isPending ? "Recording..." : "Mark Departure"}
                                          </Button>
                                        )}
                                      </div>
                                    ) : (
                                      <Button
                                        size="sm"
                                        onClick={() => schoolArrivalMutation.mutate(school.id)}
                                        disabled={schoolArrivalMutation.isPending}
                                        className="w-full bg-green-600 hover:bg-green-700"
                                        data-testid={`button-arrive-${school.id}`}
                                      >
                                        <Timer className="w-4 h-4 mr-2" />
                                        {schoolArrivalMutation.isPending ? "Recording..." : "Mark Arrival"}
                                      </Button>
                                    )}
                                  </div>
                                </CardContent>
                              </Card>
                            );
                          })}
                        </div>
                      ) : (
                        <Card className="border-dashed">
                          <CardContent className="flex flex-col items-center justify-center py-12">
                            <School className="w-12 h-12 text-gray-300 mb-4" />
                            <h4 className="font-medium text-gray-900 mb-2">No School Stops</h4>
                            <p className="text-gray-500 text-center">
                              No schools are currently assigned to this route
                            </p>
                          </CardContent>
                        </Card>
                      )}
                    </div>

                    {/* Regular Stops Section */}
                    <div>
                      <h3 className="text-lg font-medium mb-4 flex items-center gap-2">
                        <MapPin className="w-5 h-5 text-orange-500" />
                        Route Stops
                        {Array.isArray(routeStops) && routeStops.length > 0 && (
                          <Badge variant="secondary" className="ml-2">
                            {routeStops.length} stops
                          </Badge>
                        )}
                      </h3>
                      
                      {Array.isArray(routeStops) && routeStops.length > 0 ? (
                        <div className="grid gap-4">
                          {routeStops.map((stop: any, index: number) => {
                            const isStopCompleted = Array.isArray(completedStops) && completedStops.some((cs: any) => cs.routeStopId === stop.id);
                            const stopSequence = stop.order || index + 1;
                            
                            return (
                              <Card key={stop.id} className={`hover:shadow-md transition-shadow ${isStopCompleted ? 'border-green-300 bg-green-50' : ''}`}>
                                <CardContent className="p-4">
                                  <div className="flex items-start justify-between mb-3">
                                    <div className="flex items-center gap-3">
                                      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${isStopCompleted ? 'bg-green-100' : 'bg-orange-100'}`}>
                                        {isStopCompleted ? (
                                          <CheckCircle className="w-5 h-5 text-green-600" />
                                        ) : (
                                          <span className="text-orange-600 font-medium text-sm">{stopSequence}</span>
                                        )}
                                      </div>
                                      <div>
                                        <h4 className="font-medium text-lg">{stop.name}</h4>
                                        <p className="text-gray-600 text-sm">{stop.address}</p>
                                      </div>
                                    </div>
                                    <div className="flex flex-col gap-1 items-end">
                                      {isStopCompleted ? (
                                        <Badge className="bg-green-100 text-green-700 border-green-300">
                                          <CheckCircle className="w-3 h-3 mr-1" />
                                          Arrived
                                        </Badge>
                                      ) : (
                                        <>
                                          <Badge variant="outline" className="bg-orange-50 text-orange-700">
                                            Regular Stop
                                          </Badge>
                                          {isOnDuty && assignedRouteId && (
                                            <Button
                                              size="sm"
                                              className="mt-2 bg-blue-600 hover:bg-blue-700"
                                              onClick={() => markStopCompletedMutation.mutate({
                                                routeStopId: stop.id,
                                                routeId: assignedRouteId,
                                                stopSequence,
                                              })}
                                              disabled={markStopCompletedMutation.isPending}
                                            >
                                              {markStopCompletedMutation.isPending ? (
                                                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                                              ) : (
                                                <MapPin className="w-4 h-4 mr-1" />
                                              )}
                                              Mark Arrived
                                            </Button>
                                          )}
                                        </>
                                      )}
                                      {stop.scheduledTime && (
                                        <Badge variant="secondary" className="text-xs">
                                          {stop.scheduledTime}
                                        </Badge>
                                      )}
                                    </div>
                                  </div>
                                  
                                  <div className="flex items-center gap-4 text-sm text-gray-600">
                                    <div className="flex items-center gap-1">
                                      <Clock className="w-4 h-4" />
                                      <span>Order: {stopSequence}</span>
                                    </div>
                                    {stop.estimatedPickupTime && (
                                      <div className="flex items-center gap-1">
                                        <Timer className="w-4 h-4" />
                                        <span>{stop.estimatedPickupTime} min from start</span>
                                      </div>
                                    )}
                                    {stop.latitude && stop.longitude && (
                                      <div className="flex items-center gap-1">
                                        <Navigation className="w-4 h-4" />
                                        <span>GPS: {parseFloat(stop.latitude).toFixed(4)}, {parseFloat(stop.longitude).toFixed(4)}</span>
                                      </div>
                                    )}
                                  </div>
                                </CardContent>
                              </Card>
                            );
                          })}
                        </div>
                      ) : (
                        <Card className="border-dashed">
                          <CardContent className="flex flex-col items-center justify-center py-12">
                            <MapPin className="w-12 h-12 text-gray-300 mb-4" />
                            <h4 className="font-medium text-gray-900 mb-2">No Route Stops</h4>
                            <p className="text-gray-500 text-center">
                              No regular stops are currently assigned to this route
                            </p>
                          </CardContent>
                        </Card>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <MapPin className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                    <h3 className="text-lg font-medium text-gray-900 mb-2">Loading Route Data...</h3>
                    <p className="text-gray-500">Route information is being fetched</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* My Assignments Tab */}
          <TabsContent value="assignments">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Bus Selection and Status */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center">
                    <Car className="w-5 h-5 mr-2" />
                    My Bus Assignment
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {Array.isArray(buses) && buses.length > 0 ? (
                    <div className="space-y-4">
                      {buses.map((bus: any) => (
                        <div key={bus.id} className="border rounded-lg p-4">
                          <div className="flex justify-between items-center mb-3">
                            <div>
                              <h4 className="font-semibold">Bus #{bus.busNumber}</h4>
                              <p className="text-sm text-gray-600">{bus.make} {bus.model} ({bus.year})</p>
                            </div>
                            <Badge 
                              variant={
                                bus.status === 'on_route' ? 'default' :
                                bus.status === 'idle' ? 'secondary' :
                                bus.status === 'maintenance' ? 'outline' : 'destructive'
                              }
                              className={
                                bus.status === 'on_route' ? 'bg-green-100 text-green-800' :
                                bus.status === 'idle' ? 'bg-blue-100 text-blue-800' :
                                bus.status === 'maintenance' ? 'bg-orange-100 text-orange-800 border-orange-300' : 'bg-red-100 text-red-800'
                              }
                            >
                              {bus.status === 'on_route' ? 'ACTIVE' : 
                               bus.status === 'idle' ? 'IDLE' : 
                               bus.status === 'maintenance' ? 'MAINTENANCE' : 'EMERGENCY'}
                            </Badge>
                          </div>
                          
                          <div className="grid grid-cols-2 gap-4 text-sm mb-4">
                            <div>
                              <p className="text-gray-600">Capacity</p>
                              <p className="font-medium">{bus.capacity} students</p>
                            </div>
                            <div>
                              <p className="text-gray-600">License Plate</p>
                              <p className="font-medium">{bus.licensePlate}</p>
                            </div>
                            <div>
                              <p className="text-gray-600">Fuel Level</p>
                              <div className="flex items-center">
                                <Fuel className="w-4 h-4 mr-1 text-blue-500" />
                                <span className="font-medium">
                                  {bus.fuelLevel === 'F' ? 'Full' :
                                   bus.fuelLevel === '¾' ? '¾ Full' :
                                   bus.fuelLevel === '½' ? '½ Full' :
                                   bus.fuelLevel === '¼' ? '¼ Full' :
                                   bus.fuelLevel === 'E' ? 'Empty' : 'Full'}
                                </span>
                              </div>
                            </div>
                            <div>
                              <p className="text-gray-600">Mileage</p>
                              <p className="font-medium">{bus.mileage?.toLocaleString() || 0} miles</p>
                            </div>
                          </div>
                          
                          <div className="flex space-x-2">
                            {bus.status === 'idle' ? (
                              <Button 
                                onClick={() => activateRouteMutation.mutate(bus.id)}
                                disabled={activateRouteMutation.isPending}
                                className="flex-1"
                                data-testid={`button-activate-${bus.id}`}
                              >
                                <CheckCircle className="w-4 h-4 mr-2" />
                                {activateRouteMutation.isPending ? 'Starting...' : 'Start Shift'}
                              </Button>
                            ) : bus.status === 'maintenance' ? (
                              <Button 
                                disabled
                                variant="outline"
                                className="flex-1 bg-orange-50 border-orange-300 text-orange-700"
                                data-testid={`button-maintenance-${bus.id}`}
                              >
                                <Wrench className="w-4 h-4 mr-2" />
                                Under Maintenance
                              </Button>
                            ) : (
                              <Button 
                                onClick={() => deactivateRouteMutation.mutate()}
                                disabled={deactivateRouteMutation.isPending}
                                variant="outline"
                                className="flex-1"
                                data-testid={`button-deactivate-${bus.id}`}
                              >
                                <AlertTriangle className="w-4 h-4 mr-2" />
                                {deactivateRouteMutation.isPending ? 'Ending...' : 'End Shift'}
                              </Button>
                            )}
                          </div>
                          
                          {bus.status === 'on_route' && (
                            <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-md">
                              <div className="flex items-center text-green-800 mb-1">
                                <CheckCircle className="w-4 h-4 mr-2" />
                                <span className="font-medium">Bus is Active</span>
                              </div>
                              <p className="text-sm text-green-700">
                                Your shift has started. The bus is now in active mode and ready for route assignments.
                              </p>
                            </div>
                          )}
                          
                          {bus.status === 'maintenance' && (
                            <div className="mt-4 p-3 bg-orange-50 border border-orange-200 rounded-md">
                              <div className="flex items-center text-orange-800 mb-1">
                                <Wrench className="w-4 h-4 mr-2" />
                                <span className="font-medium">Maintenance Mode</span>
                              </div>
                              <p className="text-sm text-orange-700">
                                This bus is currently under maintenance and unavailable for service. Contact administration for updates.
                              </p>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <Car className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                      <p className="text-gray-500">No bus assigned</p>
                      <p className="text-sm text-gray-400">Contact administration to get a bus assignment</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Current Assignments */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center">
                    <Calendar className="w-5 h-5 mr-2" />
                    My Route Assignments
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {assignedRoutes.length > 0 ? (
                    <div className="space-y-4">
                      {assignedRoutes.map((route: any) => {
                        // Find associated bus and students
                        const routeBus = assignedBus; // Use the driver's assigned bus for all routes
                        const routeStudents = Array.isArray(students) ? students.filter((s: any) => s.routeId === route.id) : [];
                        
                        return (
                          <div key={route.id} className="border rounded-lg p-4" data-testid={`route-card-${route.id}`}>
                            <div className="flex justify-between items-center mb-2">
                              <h4 className="font-semibold">{route.name}</h4>
                              <Badge variant="secondary" className={route.isActive ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"}>
                                {route.isActive ? "Active" : "Inactive"}
                              </Badge>
                            </div>
                            {route.description && (
                              <p className="text-sm text-gray-600 mb-3">{route.description}</p>
                            )}
                            <div className="grid grid-cols-2 gap-4 text-sm">
                              <div>
                                <p className="text-gray-600">Assigned Bus</p>
                                <p className="font-medium">
                                  {routeBus ? `#${routeBus.busNumber}` : "No bus assigned"}
                                </p>
                              </div>
                              <div>
                                <p className="text-gray-600">Duration</p>
                                <p className="font-medium">
                                  {route.estimatedDuration 
                                    ? `${Math.floor(route.estimatedDuration / 60)}h ${route.estimatedDuration % 60}m` 
                                    : "Not calculated"}
                                </p>
                              </div>
                              <div>
                                <p className="text-gray-600">Students</p>
                                <p className="font-medium">{routeStudents.length} students</p>
                              </div>
                              <div>
                                <p className="text-gray-600">Route ID</p>
                                <p className="font-medium text-xs text-gray-500">{route.id.substring(0, 8)}...</p>
                              </div>
                            </div>
                            <div className="mt-3 pt-3 border-t">
                              <div className="flex items-center justify-between">
                                <div>
                                  <p className="text-sm text-gray-600">Status:</p>
                                  <p className="text-sm font-medium text-green-600">
                                    {route.isActive ? "Ready for service" : "Inactive"}
                                  </p>
                                </div>
                                {assignedBus && (
                                  <div className="flex items-center gap-2">
                                    <RouteIcon className="w-4 h-4 text-green-600" />
                                    <span className="text-sm text-green-600">Bus ready</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <Calendar className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                      <p className="text-gray-500">No current assignments</p>
                      <p className="text-sm text-gray-400">Route assignments will appear here when available</p>
                    </div>
                  )}
                </CardContent>
              </Card>

            </div>
          </TabsContent>

          {/* Tasks Tab */}
          <TabsContent value="tasks">
            <Card>
              <CardHeader>
                <CardTitle>My Tasks</CardTitle>
                <CardDescription>
                  View and complete your assigned tasks
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="max-h-[500px] overflow-y-auto">
                  <Table>
                    <TableHeader className="sticky top-0 bg-white dark:bg-gray-900 z-10">
                      <TableRow>
                        <TableHead>Task</TableHead>
                        <TableHead>Priority</TableHead>
                        <TableHead>Due Date</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {Array.isArray(driverTasks) && driverTasks.length > 0 ? (
                        driverTasks.map((task: any) => (
                          <TableRow key={task.id}>
                            <TableCell>
                              <div>
                                <p className="font-medium" data-testid={`task-title-${task.id}`}>{task.title}</p>
                                {task.description && (
                                  <p className="text-sm text-gray-500">{task.description}</p>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant={task.priority === 'high' ? 'destructive' : task.priority === 'medium' ? 'default' : 'secondary'}>
                                {task.priority}
                              </Badge>
                            </TableCell>
                            <TableCell>{task.dueDate}</TableCell>
                            <TableCell>
                              <Badge 
                                variant={task.status === 'completed' ? 'default' : 'outline'}
                                className={task.status === 'completed' ? 'bg-green-100 text-green-800' : ''}
                              >
                                {task.status === 'completed' ? 'Completed' : 'Pending'}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {task.status !== 'completed' && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => completeTaskMutation.mutate(task.id)}
                                  disabled={completeTaskMutation.isPending}
                                  data-testid={`button-complete-task-${task.id}`}
                                >
                                  <CheckCircle className="w-4 h-4 mr-1" />
                                  Complete
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center text-gray-500">
                            No tasks assigned to you.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
                {Array.isArray(driverTasks) && driverTasks.length > 0 && (
                  <div className="mt-4 text-sm text-gray-500 text-center">
                    Showing {driverTasks.length} task{driverTasks.length !== 1 ? 's' : ''}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

        </Tabs>
      </div>

      {/* Driver Check-in Dialog */}
      <Dialog open={showCheckInDialog} onOpenChange={setShowCheckInDialog}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Power className="h-5 w-5 text-green-500" />
              Driver Check-In
            </DialogTitle>
            <DialogDescription>
              Complete your pre-duty inspection before going on duty. This ensures vehicle safety and compliance.
            </DialogDescription>
          </DialogHeader>
          <Form {...checkInForm}>
            <form onSubmit={checkInForm.handleSubmit((data) => checkInMutation.mutate(data))} className="space-y-6">
              
              {/* Driver Selection */}
              <FormField
                control={checkInForm.control}
                name="driverId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-2">
                      <User className="h-4 w-4" />
                      Select Driver Profile
                    </FormLabel>
                    <p className="text-sm text-gray-600 mb-2">
                      Choose your driver profile from the administration's driver management system
                    </p>
                    <FormControl>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <SelectTrigger data-testid="select-driver">
                          <SelectValue placeholder="Choose which driver profile you are" />
                        </SelectTrigger>
                        <SelectContent>
                          {Array.isArray(adminDrivers) && adminDrivers.length > 0 ? (
                            adminDrivers.map((driver: any) => (
                              <SelectItem key={driver.id} value={driver.id}>
                                <div className="flex items-center gap-3">
                                  <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                                    <User className="w-4 h-4 text-blue-600" />
                                  </div>
                                  <div className="flex-1">
                                    <div className="font-medium flex items-center gap-2">
                                      {driver.firstName} {driver.lastName}
                                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                                        Managed
                                      </span>
                                    </div>
                                    <div className="text-sm text-gray-500 flex items-center gap-2">
                                      <span>{driver.email}</span>
                                      {driver.phone && (
                                        <>
                                          <span>•</span>
                                          <span>{driver.phone}</span>
                                        </>
                                      )}
                                    </div>
                                    {driver.licenseNumber && (
                                      <div className="text-xs text-gray-400">
                                        License: {driver.licenseNumber} ({driver.licenseState})
                                      </div>
                                    )}
                                  </div>
                                  <div className="text-right">
                                    <div className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                                      driver.isOnDuty 
                                        ? 'bg-green-100 text-green-800' 
                                        : 'bg-gray-100 text-gray-800'
                                    }`}>
                                      {driver.isOnDuty ? 'On Duty' : 'Off Duty'}
                                    </div>
                                  </div>
                                </div>
                              </SelectItem>
                            ))
                          ) : (
                            <SelectItem value="no-drivers" disabled>
                              <div className="flex items-center gap-2 text-gray-500">
                                <User className="w-4 h-4" />
                                No drivers available - ask admin to add drivers in Administration → Driver Management
                              </div>
                            </SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Route Selection */}
              <FormField
                control={checkInForm.control}
                name="routeId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-2">
                      <RouteIcon className="h-4 w-4" />
                      Select Route to Drive
                    </FormLabel>
                    <FormControl>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <SelectTrigger data-testid="select-route">
                          <SelectValue placeholder="Choose which route you'll be driving" />
                        </SelectTrigger>
                        <SelectContent>
                          {Array.isArray(availableRoutes) && availableRoutes.length > 0 ? (
                            availableRoutes.map((route: any) => (
                              <SelectItem key={route.id} value={route.id}>
                                {route.name} ({route.startTime} - {route.endTime})
                              </SelectItem>
                            ))
                          ) : (
                            <SelectItem value="no-routes" disabled>No routes available</SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Vehicle Selection */}
              <FormField
                control={checkInForm.control}
                name="busId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-2">
                      <Bus className="h-4 w-4" />
                      Select Vehicle to Drive
                    </FormLabel>
                    <FormControl>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <SelectTrigger data-testid="select-bus">
                          <SelectValue placeholder="Choose which vehicle you'll be driving" />
                        </SelectTrigger>
                        <SelectContent>
                          {Array.isArray(availableBuses) && availableBuses.length > 0 ? (
                            availableBuses.map((bus: any) => (
                              <SelectItem key={bus.id} value={bus.id}>
                                Bus #{bus.busNumber} - {bus.make} {bus.model} ({bus.year})
                              </SelectItem>
                            ))
                          ) : (
                            <SelectItem value="no-buses" disabled>No vehicles available</SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Gas Level */}
              <FormField
                control={checkInForm.control}
                name="fuelLevel"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-2">
                      <Fuel className="h-4 w-4" />
                      Current Gas Level
                    </FormLabel>
                    <FormControl>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <SelectTrigger data-testid="select-fuel-level">
                          <SelectValue placeholder="Select current fuel level" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Empty">Empty</SelectItem>
                          <SelectItem value="1/4">1/4 Tank</SelectItem>
                          <SelectItem value="1/2">1/2 Tank</SelectItem>
                          <SelectItem value="3/4">3/4 Tank</SelectItem>
                          <SelectItem value="Full">Full Tank</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Interior Cleanliness */}
              <FormField
                control={checkInForm.control}
                name="interiorClean"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                    <div className="space-y-0.5">
                      <FormLabel className="flex items-center gap-2">
                        <CheckCircle className="h-4 w-4" />
                        Interior Cleanliness
                      </FormLabel>
                      <div className="text-sm text-gray-600">
                        Is the inside of the bus clean and ready for students?
                      </div>
                    </div>
                    <FormControl>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant={field.value === true ? "default" : "outline"}
                          size="sm"
                          onClick={() => field.onChange(true)}
                          data-testid="button-interior-clean-yes"
                        >
                          Yes
                        </Button>
                        <Button
                          type="button"
                          variant={field.value === false ? "destructive" : "outline"}
                          size="sm"
                          onClick={() => field.onChange(false)}
                          data-testid="button-interior-clean-no"
                        >
                          No
                        </Button>
                      </div>
                    </FormControl>
                  </FormItem>
                )}
              />

              {/* Exterior Cleanliness */}
              <FormField
                control={checkInForm.control}
                name="exteriorClean"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                    <div className="space-y-0.5">
                      <FormLabel className="flex items-center gap-2">
                        <Car className="h-4 w-4" />
                        Exterior Cleanliness
                      </FormLabel>
                      <div className="text-sm text-gray-600">
                        Is the outside of the bus clean and presentable?
                      </div>
                    </div>
                    <FormControl>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant={field.value === true ? "default" : "outline"}
                          size="sm"
                          onClick={() => field.onChange(true)}
                          data-testid="button-exterior-clean-yes"
                        >
                          Yes
                        </Button>
                        <Button
                          type="button"
                          variant={field.value === false ? "destructive" : "outline"}
                          size="sm"
                          onClick={() => field.onChange(false)}
                          data-testid="button-exterior-clean-no"
                        >
                          No
                        </Button>
                      </div>
                    </FormControl>
                  </FormItem>
                )}
              />

              <div className="flex justify-end space-x-2 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowCheckInDialog(false)}
                  disabled={checkInMutation.isPending}
                  data-testid="button-cancel-check-in"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={checkInMutation.isPending}
                  className="bg-green-600 hover:bg-green-700"
                  data-testid="button-submit-check-in"
                >
                  {checkInMutation.isPending ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                      Checking In...
                    </>
                  ) : (
                    <>
                      <Power className="h-4 w-4 mr-2" />
                      Complete Check-In & Go On Duty
                    </>
                  )}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>


    </div>
  );
}
