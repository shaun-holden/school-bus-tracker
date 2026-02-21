import { useEffect, useState, useMemo } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import Navigation from "@/components/shared/Navigation";
import { BusTrackingMap, BusTrackingLegend } from "@/components/shared/BusTrackingMap";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { isUnauthorizedError } from "@/lib/authUtils";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { 
  Users, UserCheck, Car, Settings, Plus, FileText, Calendar, 
  AlertTriangle, CheckCircle, Fuel, Wrench, Shield, MapPin, Edit, Clock, X, Calculator,
  Trash2, GraduationCap, Route as RouteIcon, Loader2, ChevronUp, ChevronDown, Edit2, Eye,
  Power, User, MessageSquare, Bell, Send, Archive, RotateCcw, RefreshCw, ClipboardList
} from "lucide-react";
import { calculateRouteDuration, formatDuration, geocodeAddress, calculateRouteFromStops, type Coordinates } from "@/lib/distanceUtils";
import { ShiftReports } from "@/components/admin/ShiftReports";
import { JourneyReports } from "@/components/admin/JourneyReports";
import { LinkCodeButton } from "@/components/admin/LinkCodeManager";

// Form schema for adding buses
const addBusSchema = z.object({
  busNumber: z.string().min(1, "Bus number is required"),
  make: z.string().min(1, "Make is required"),
  model: z.string().min(1, "Model is required"),
  year: z.coerce.number().min(1990, "Invalid year").max(new Date().getFullYear() + 1, "Invalid year"),
  capacity: z.coerce.number().min(1, "Capacity must be at least 1").max(200, "Invalid capacity"),
  licensePlate: z.string().min(1, "License plate is required"),
  status: z.enum(["idle", "on_route", "maintenance", "emergency", "inactive"]),
  fuelLevel: z.string().optional(),
  mileage: z.coerce.number().min(0, "Invalid mileage").optional(),
});

// Form schema for creating routes  
const routeSchema = z.object({
  name: z.string().min(1, "Route name is required"),
  description: z.string().optional(),
  busNumber: z.string().optional(),
  schoolId: z.string().optional(),
});

// School schema for validation
const schoolSchema = z.object({
  name: z.string().min(1, "School name is required"),
  address: z.string().min(1, "School address is required"),
});

const studentSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  grade: z.string().optional(),
  parentId: z.string().min(1, "Parent ID is required"),
  schoolId: z.string().optional(),
  routeId: z.string().optional(),
  isActive: z.boolean().default(true),
});

// Driver schema for validation
const driverSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email("Invalid email address"),
  phone: z.string().min(10, "Phone number must be at least 10 digits"),
  address: z.string().optional(),
  licenseNumber: z.string().min(1, "License number is required"),
  licenseState: z.string().min(2, "License state is required"),
  licenseExpiryDate: z.string().optional(),
  hireDate: z.string().optional(),
  emergencyContactName: z.string().optional(),
  emergencyContactPhone: z.string().optional(),
});

// Route assignment schema
const routeAssignmentSchema = z.object({
  driverId: z.string().min(1, "Driver is required"),
  routeId: z.string().min(1, "Route is required"),
});

// Bus assignment schema
const busAssignmentSchema = z.object({
  driverId: z.string().min(1, "Driver is required"),
  busId: z.string().min(1, "Bus is required"),
});

// Notification schema for parent alerts
const notificationSchema = z.object({
  type: z.enum(["delay", "emergency", "info", "route_change"]),
  title: z.string().min(1, "Title is required"),
  message: z.string().min(1, "Message is required"),
  routeId: z.string().optional(),
  busId: z.string().optional(),
  isGlobal: z.boolean().default(false),
  estimatedDelay: z.coerce.number().optional(),
});

// Component to display route stop count based on schools
function RouteStopCount({ routeId }: { routeId: string }) {
  const { data: schools } = useQuery({
    queryKey: ["/api/routes", routeId, "schools"],
    retry: false,
  });

  const schoolCount = Array.isArray(schools) ? schools.length : 0;
  
  return (
    <div className="flex items-center space-x-1">
      <MapPin className="w-4 h-4 text-gray-400" />
      <span>{schoolCount} {schoolCount === 1 ? 'stop' : 'stops'}</span>
      {schoolCount > 0 && (
        <Badge variant="secondary" className="ml-1">
          {schoolCount} {schoolCount === 1 ? 'school' : 'schools'}
        </Badge>
      )}
    </div>
  );
}

// Component to display total stops count with accurate school-based counting
function TotalStopsDisplay({ routes }: { routes: any }) {
  const [totalStops, setTotalStops] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const calculateTotalStops = async () => {
      if (!Array.isArray(routes) || routes.length === 0) {
        setTotalStops(0);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      let total = 0;

      // Fetch schools for each route and count them
      const promises = routes.map(async (route: any) => {
        try {
          const response = await fetch(`/api/routes/${route.id}/schools`);
          if (response.ok) {
            const schools = await response.json();
            return Array.isArray(schools) ? schools.length : 0;
          }
          return 0;
        } catch (error) {
          console.error(`Error fetching schools for route ${route.id}:`, error);
          return 0;
        }
      });

      const stopCounts = await Promise.all(promises);
      total = stopCounts.reduce((sum, count) => sum + count, 0);
      
      setTotalStops(total);
      setIsLoading(false);
    };

    calculateTotalStops();
  }, [routes]);

  return (
    <div className="text-3xl font-bold">
      {isLoading ? "..." : totalStops}
    </div>
  );
}

// Task form validation schema
const taskFormSchema = z.object({
  title: z.string().min(1, "Task title is required"),
  description: z.string().optional(),
  assignedToId: z.string().min(1, "Please select a driver"),
  priority: z.enum(["normal", "high", "urgent"]),
  dueDate: z.string().optional(),
});

// Driver Tasks Section Component for Admin Dashboard
function DriverTasksSection({ drivers }: { drivers: any }) {
  const { toast } = useToast();
  const [isCreateTaskDialogOpen, setIsCreateTaskDialogOpen] = useState(false);

  const taskForm = useForm<z.infer<typeof taskFormSchema>>({
    resolver: zodResolver(taskFormSchema),
    defaultValues: {
      title: "",
      description: "",
      assignedToId: "",
      priority: "normal",
      dueDate: "",
    },
  });

  const { data: tasks, isLoading: tasksLoading } = useQuery({
    queryKey: ["/api/driver-tasks"],
    retry: false,
  });

  const createTaskMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiRequest("/api/driver-tasks", "POST", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/driver-tasks"] });
      setIsCreateTaskDialogOpen(false);
      taskForm.reset();
      toast({
        title: "Success",
        description: "Task assigned to driver",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create task",
        variant: "destructive",
      });
    },
  });

  const getDriverName = (driverId: string) => {
    if (!Array.isArray(drivers)) return "Unknown";
    const driver = drivers.find((d: any) => d.id === driverId);
    return driver ? `${driver.firstName} ${driver.lastName}` : "Unknown";
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "urgent": return "bg-red-100 text-red-800";
      case "high": return "bg-orange-100 text-orange-800";
      default: return "bg-gray-100 text-gray-800";
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-center">
          <div>
            <CardTitle className="flex items-center">
              <FileText className="w-5 h-5 mr-2" />
              Driver Tasks
            </CardTitle>
            <CardDescription>View and assign tasks to drivers</CardDescription>
          </div>
          <Dialog open={isCreateTaskDialogOpen} onOpenChange={setIsCreateTaskDialogOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-create-task">
                <Plus className="w-4 h-4 mr-2" />
                Assign Task
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Assign New Task</DialogTitle>
                <DialogDescription>Create a task and assign it to a driver</DialogDescription>
              </DialogHeader>
              <Form {...taskForm}>
                <form onSubmit={taskForm.handleSubmit((data) => createTaskMutation.mutate(data))} className="space-y-4">
                  <FormField
                    control={taskForm.control}
                    name="title"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Task Title *</FormLabel>
                        <FormControl>
                          <Input 
                            {...field} 
                            placeholder="e.g. Vehicle inspection" 
                            data-testid="input-task-title"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={taskForm.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Description</FormLabel>
                        <FormControl>
                          <Textarea 
                            {...field} 
                            placeholder="Task details..." 
                            data-testid="input-task-description"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={taskForm.control}
                    name="assignedToId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Assign To *</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger data-testid="select-task-driver">
                              <SelectValue placeholder="Select driver" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {Array.isArray(drivers) && drivers.map((driver: any) => (
                              <SelectItem key={driver.id} value={driver.id}>
                                {driver.firstName} {driver.lastName}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={taskForm.control}
                      name="priority"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Priority</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger data-testid="select-task-priority">
                                <SelectValue placeholder="Select priority" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="normal">Normal</SelectItem>
                              <SelectItem value="high">High</SelectItem>
                              <SelectItem value="urgent">Urgent</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={taskForm.control}
                      name="dueDate"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Due Date</FormLabel>
                          <FormControl>
                            <Input 
                              type="date" 
                              {...field} 
                              data-testid="input-task-duedate"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <div className="flex justify-end space-x-3 pt-4">
                    <Button type="button" variant="outline" onClick={() => setIsCreateTaskDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button type="submit" disabled={createTaskMutation.isPending} data-testid="button-submit-task">
                      {createTaskMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                      Assign Task
                    </Button>
                  </div>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {tasksLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : Array.isArray(tasks) && tasks.length > 0 ? (
          <div className="max-h-[300px] overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Task</TableHead>
                <TableHead>Assigned To</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Due Date</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.map((task: any) => (
                <TableRow key={task.id} data-testid={`task-row-${task.id}`}>
                  <TableCell>
                    <div>
                      <div className="font-medium">{task.title}</div>
                      {task.description && (
                        <div className="text-sm text-gray-500 whitespace-pre-wrap">{task.description}</div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>{getDriverName(task.assignedToId)}</TableCell>
                  <TableCell>
                    <Badge className={getPriorityColor(task.priority)}>
                      {task.priority}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {task.dueDate ? new Date(task.dueDate).toLocaleDateString() : "-"}
                  </TableCell>
                  <TableCell>
                    {task.isCompleted ? (
                      <Badge className="bg-green-100 text-green-800">
                        <CheckCircle className="w-3 h-3 mr-1" />
                        Completed
                      </Badge>
                    ) : (
                      <Badge variant="outline">Pending</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
        ) : (
          <div className="text-center py-4">
            <FileText className="w-8 h-8 text-gray-400 mx-auto mb-2" />
            <p className="text-gray-500 text-sm">No tasks assigned yet</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Notifications Tab Component
function NotificationsTab({ routes, buses }: { routes: any; buses: any }) {
  const { toast } = useToast();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [notificationView, setNotificationView] = useState<'parent' | 'driver' | 'system'>('parent');
  const [alertRecipient, setAlertRecipient] = useState<'parent' | 'driver'>('parent');
  const [isTaskDialogOpen, setIsTaskDialogOpen] = useState(false);
  const [selectedNotificationForTask, setSelectedNotificationForTask] = useState<any>(null);

  const taskForm = useForm<z.infer<typeof taskFormSchema>>({
    resolver: zodResolver(taskFormSchema),
    defaultValues: {
      title: "",
      description: "",
      assignedToId: "",
      priority: "normal",
      dueDate: "",
    },
  });

  const form = useForm<z.infer<typeof notificationSchema>>({
    resolver: zodResolver(notificationSchema),
    defaultValues: {
      type: "info",
      title: "",
      message: "",
      routeId: "",
      busId: "",
      isGlobal: false,
      estimatedDelay: undefined,
    },
  });

  const { data: notifications, isLoading } = useQuery({
    queryKey: ["/api/notifications"],
    retry: false,
  });

  const { data: systemNotifications, isLoading: systemNotificationsLoading } = useQuery({
    queryKey: ["/api/system-notifications"],
    retry: false,
  });

  const { data: drivers } = useQuery({
    queryKey: ["/api/drivers"],
    retry: false,
  });

  const markAsReadMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest(`/api/system-notifications/${id}/read`, "PATCH");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/system-notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/system-notifications/unread-count"] });
    },
  });

  const createNotificationMutation = useMutation({
    mutationFn: async (data: z.infer<typeof notificationSchema>) => {
      const payload = {
        ...data,
        routeId: data.routeId && data.routeId !== "all" ? data.routeId : null,
        busId: data.busId && data.busId !== "none" ? data.busId : null,
      };
      return apiRequest("/api/notifications", "POST", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      setIsCreateDialogOpen(false);
      form.reset();
      toast({
        title: "Success",
        description: "Notification sent to parents",
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

  const createDriverAlertMutation = useMutation({
    mutationFn: async (data: z.infer<typeof notificationSchema>) => {
      return apiRequest("/api/system-notifications", "POST", {
        title: data.title,
        message: data.message,
        type: data.type,
        recipientRole: 'all_drivers',
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/system-notifications"] });
      setIsCreateDialogOpen(false);
      form.reset();
      toast({
        title: "Success",
        description: "Alert sent to all drivers",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to send alert to drivers",
        variant: "destructive",
      });
    },
  });

  const deleteNotificationMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest(`/api/notifications/${id}`, "DELETE");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      toast({
        title: "Success",
        description: "Notification deleted",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete notification",
        variant: "destructive",
      });
    },
  });

  const createTaskFromNotificationMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiRequest("/api/driver-tasks", "POST", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/driver-tasks"] });
      setIsTaskDialogOpen(false);
      setSelectedNotificationForTask(null);
      taskForm.reset();
      toast({
        title: "Success",
        description: "Task created from notification",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create task",
        variant: "destructive",
      });
    },
  });

  const openTaskDialogFromNotification = (notification: any) => {
    const priority = notification.type === 'emergency' ? 'urgent' : 
                     notification.type === 'delay' ? 'high' : 'normal';
    taskForm.reset({
      title: notification.title,
      description: `${notification.message}\n\n(Created from notification sent on ${new Date(notification.createdAt).toLocaleString()})`,
      assignedToId: "",
      priority,
      dueDate: "",
    });
    setSelectedNotificationForTask(notification);
    setIsTaskDialogOpen(true);
  };

  const notificationType = form.watch("type");

  const getTypeColor = (type: string) => {
    switch (type) {
      case "emergency": return "bg-red-100 text-red-800 border-red-200";
      case "delay": return "bg-orange-100 text-orange-800 border-orange-200";
      case "route_change": return "bg-blue-100 text-blue-800 border-blue-200";
      default: return "bg-gray-100 text-gray-800 border-gray-200";
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "emergency": return <AlertTriangle className="w-4 h-4 text-red-600" />;
      case "delay": return <Clock className="w-4 h-4 text-orange-600" />;
      case "route_change": return <RouteIcon className="w-4 h-4 text-blue-600" />;
      default: return <Bell className="w-4 h-4 text-gray-600" />;
    }
  };

  const getDriverName = (senderId: string) => {
    if (!Array.isArray(drivers)) return "Driver";
    const driver = drivers.find((d: any) => d.id === senderId);
    return driver ? `${driver.firstName} ${driver.lastName}` : "Driver";
  };

  const driverNotifications = Array.isArray(systemNotifications) 
    ? systemNotifications.filter((n: any) => n.senderRole === 'driver')
    : [];

  const unreadDriverNotifications = driverNotifications.filter((n: any) => !n.isRead);

  const adminToDriverAlerts = Array.isArray(systemNotifications)
    ? systemNotifications.filter((n: any) => n.senderRole === 'admin' && n.recipientRole === 'all_drivers')
    : [];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold">Notifications Center</h2>
          <p className="text-gray-600">Manage alerts and view messages</p>
        </div>
        <div className="flex items-center space-x-2">
          <div className="flex rounded-lg border p-1">
            <Button 
              variant={notificationView === 'parent' ? 'default' : 'ghost'} 
              size="sm"
              onClick={() => setNotificationView('parent')}
            >
              Parent Alerts
            </Button>
            <Button 
              variant={notificationView === 'driver' ? 'default' : 'ghost'} 
              size="sm"
              onClick={() => setNotificationView('driver')}
            >
              Driver Alerts
            </Button>
            <Button 
              variant={notificationView === 'system' ? 'default' : 'ghost'} 
              size="sm"
              onClick={() => setNotificationView('system')}
              className="relative"
            >
              Driver Messages
              {unreadDriverNotifications.length > 0 && (
                <Badge className="ml-1 h-5 min-w-[20px] p-0 text-xs bg-red-500">
                  {unreadDriverNotifications.length}
                </Badge>
              )}
            </Button>
          </div>
          <Dialog open={isCreateDialogOpen} onOpenChange={(open) => {
            setIsCreateDialogOpen(open);
            if (open) {
              setAlertRecipient(notificationView === 'driver' ? 'driver' : 'parent');
            }
          }}>
            {(notificationView === 'parent' || notificationView === 'driver') && (
              <DialogTrigger asChild>
                <Button data-testid="button-create-notification">
                  <Plus className="w-4 h-4 mr-2" />
                  Send Alert
                </Button>
              </DialogTrigger>
            )}
            <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>Send {alertRecipient === 'driver' ? 'Driver' : 'Parent'} Alert</DialogTitle>
              <DialogDescription>
                {alertRecipient === 'driver' 
                  ? 'Create a notification to alert all drivers about important updates.'
                  : 'Create a notification to alert parents about important updates.'}
              </DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit((data) => 
                alertRecipient === 'driver' 
                  ? createDriverAlertMutation.mutate(data)
                  : createNotificationMutation.mutate(data)
              )} className="space-y-4">
                <FormField
                  control={form.control}
                  name="type"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Alert Type *</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-notification-type">
                            <SelectValue placeholder="Select type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="emergency">
                            <span className="flex items-center">
                              <AlertTriangle className="w-4 h-4 mr-2 text-red-600" />
                              Emergency
                            </span>
                          </SelectItem>
                          <SelectItem value="delay">
                            <span className="flex items-center">
                              <Clock className="w-4 h-4 mr-2 text-orange-600" />
                              Delay
                            </span>
                          </SelectItem>
                          <SelectItem value="route_change">
                            <span className="flex items-center">
                              <RouteIcon className="w-4 h-4 mr-2 text-blue-600" />
                              Route Change
                            </span>
                          </SelectItem>
                          <SelectItem value="info">
                            <span className="flex items-center">
                              <Bell className="w-4 h-4 mr-2 text-gray-600" />
                              General Info
                            </span>
                          </SelectItem>
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
                      <FormLabel>Title *</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="e.g. Bus 42 Delayed" data-testid="input-notification-title" />
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
                      <FormLabel>Message *</FormLabel>
                      <FormControl>
                        <Textarea {...field} placeholder="Describe the situation..." data-testid="input-notification-message" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {notificationType === "delay" && (
                  <FormField
                    control={form.control}
                    name="estimatedDelay"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Estimated Delay (minutes)</FormLabel>
                        <FormControl>
                          <Input type="number" {...field} placeholder="e.g. 15" data-testid="input-estimated-delay" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

                <FormField
                  control={form.control}
                  name="routeId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Affected Route (optional)</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-notification-route">
                            <SelectValue placeholder="All routes" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="all">All routes</SelectItem>
                          {Array.isArray(routes) && routes.map((route: any) => (
                            <SelectItem key={route.id} value={route.id}>
                              {route.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="busId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Affected Bus (optional)</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-notification-bus">
                            <SelectValue placeholder="Select bus" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="none">No specific bus</SelectItem>
                          {Array.isArray(buses) && buses.map((bus: any) => (
                            <SelectItem key={bus.id} value={bus.id}>
                              Bus {bus.busNumber}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="flex justify-end space-x-3 pt-4">
                  <Button type="button" variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button 
                    type="submit" 
                    disabled={alertRecipient === 'driver' ? createDriverAlertMutation.isPending : createNotificationMutation.isPending} 
                    data-testid="button-send-notification"
                  >
                    {(alertRecipient === 'driver' ? createDriverAlertMutation.isPending : createNotificationMutation.isPending) ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4 mr-2" />
                    )}
                    Send Alert
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {notificationView === 'parent' ? (
        <>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          ) : Array.isArray(notifications) && notifications.length > 0 ? (
            <div className="space-y-3">
              {notifications.map((notification: any) => (
                <Card key={notification.id} className={`border-l-4 ${getTypeColor(notification.type)}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex items-start space-x-3">
                        <div className="mt-1">{getTypeIcon(notification.type)}</div>
                        <div>
                          <div className="flex items-center space-x-2">
                            <h3 className="font-semibold">{notification.title}</h3>
                            <Badge variant="outline" className="text-xs">
                              {notification.type.replace("_", " ")}
                            </Badge>
                            {notification.estimatedDelay && (
                              <Badge variant="secondary" className="text-xs">
                                ~{notification.estimatedDelay} min delay
                              </Badge>
                            )}
                          </div>
                          <p className="text-gray-600 mt-1">{notification.message}</p>
                          <p className="text-xs text-gray-400 mt-2">
                            Sent {new Date(notification.createdAt).toLocaleString()}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openTaskDialogFromNotification(notification)}
                          title="Create task from this notification"
                        >
                          <ClipboardList className="w-4 h-4 text-blue-500 hover:text-blue-700" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteNotificationMutation.mutate(notification.id)}
                          disabled={deleteNotificationMutation.isPending}
                          data-testid={`button-delete-notification-${notification.id}`}
                        >
                          <Trash2 className="w-4 h-4 text-gray-400 hover:text-red-500" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                  <Bell className="w-8 h-8 text-gray-400" />
                </div>
                <h3 className="text-lg font-medium text-gray-900 mb-2">No Notifications Sent</h3>
                <p className="text-gray-500 text-center max-w-md">
                  Use the "Send Alert" button to notify parents about delays, emergencies, or route changes.
                </p>
              </CardContent>
            </Card>
          )}
        </>
      ) : notificationView === 'driver' ? (
        <>
          {systemNotificationsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          ) : adminToDriverAlerts.length > 0 ? (
            <div className="space-y-3">
              {adminToDriverAlerts.map((notification: any) => (
                <Card key={notification.id} className={`border-l-4 ${getTypeColor(notification.type)}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex items-start space-x-3">
                        <div className="mt-1">{getTypeIcon(notification.type)}</div>
                        <div>
                          <div className="flex items-center space-x-2">
                            <h3 className="font-semibold">{notification.title}</h3>
                            <Badge variant="outline" className="text-xs bg-purple-100 text-purple-800">
                              To: All Drivers
                            </Badge>
                            <Badge variant="outline" className="text-xs">
                              {notification.type.replace("_", " ")}
                            </Badge>
                          </div>
                          <p className="text-gray-600 mt-1">{notification.message}</p>
                          <p className="text-xs text-gray-400 mt-2">
                            Sent {new Date(notification.createdAt).toLocaleString()}
                          </p>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                  <Bell className="w-8 h-8 text-gray-400" />
                </div>
                <h3 className="text-lg font-medium text-gray-900 mb-2">No Driver Alerts Sent</h3>
                <p className="text-gray-500 text-center max-w-md">
                  Use the "Send Alert" button to notify drivers about important updates.
                </p>
              </CardContent>
            </Card>
          )}
        </>
      ) : (
        <>
          {systemNotificationsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          ) : driverNotifications.length > 0 ? (
            <div className="space-y-3">
              {driverNotifications.map((notification: any) => (
                <Card 
                  key={notification.id} 
                  className={`border-l-4 ${notification.isRead ? 'border-gray-200 bg-gray-50' : 'border-blue-500 bg-blue-50'}`}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex items-start space-x-3">
                        <div className="mt-1">
                          <MessageSquare className={`w-4 h-4 ${notification.isRead ? 'text-gray-400' : 'text-blue-600'}`} />
                        </div>
                        <div>
                          <div className="flex items-center space-x-2">
                            <h3 className="font-semibold">{notification.title}</h3>
                            <Badge variant="outline" className="text-xs bg-blue-100 text-blue-800">
                              From: {getDriverName(notification.senderId)}
                            </Badge>
                            {!notification.isRead && (
                              <Badge className="text-xs bg-red-500">New</Badge>
                            )}
                          </div>
                          <p className="text-gray-600 mt-1">{notification.message}</p>
                          <p className="text-xs text-gray-400 mt-2">
                            Sent {new Date(notification.createdAt).toLocaleString()}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openTaskDialogFromNotification(notification)}
                          title="Create task from this message"
                        >
                          <ClipboardList className="w-4 h-4 text-blue-500 hover:text-blue-700" />
                        </Button>
                        {!notification.isRead && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => markAsReadMutation.mutate(notification.id)}
                            disabled={markAsReadMutation.isPending}
                          >
                            <CheckCircle className="w-4 h-4 mr-1" />
                            Mark Read
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                  <MessageSquare className="w-8 h-8 text-gray-400" />
                </div>
                <h3 className="text-lg font-medium text-gray-900 mb-2">No Driver Messages</h3>
                <p className="text-gray-500 text-center max-w-md">
                  Messages from drivers to parents will appear here.
                </p>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Create Task from Notification Dialog */}
      <Dialog open={isTaskDialogOpen} onOpenChange={setIsTaskDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Task from Notification</DialogTitle>
            <DialogDescription>
              Convert this notification into a task and assign it to a driver
            </DialogDescription>
          </DialogHeader>
          <Form {...taskForm}>
            <form onSubmit={taskForm.handleSubmit((data) => createTaskFromNotificationMutation.mutate(data))} className="space-y-4">
              <FormField
                control={taskForm.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Task Title *</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="e.g. Follow up on delay" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={taskForm.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Textarea {...field} placeholder="Task details..." rows={4} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={taskForm.control}
                name="assignedToId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Assign To *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select driver" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {Array.isArray(drivers) && drivers.map((driver: any) => (
                          <SelectItem key={driver.id} value={driver.id}>
                            {driver.firstName} {driver.lastName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={taskForm.control}
                name="priority"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Priority</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select priority" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="normal">Normal</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                        <SelectItem value="urgent">Urgent</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={taskForm.control}
                name="dueDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Due Date (Optional)</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex justify-end space-x-3 pt-4">
                <Button type="button" variant="outline" onClick={() => setIsTaskDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createTaskFromNotificationMutation.isPending}>
                  {createTaskFromNotificationMutation.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <ClipboardList className="w-4 h-4 mr-2" />
                  )}
                  Create Task
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function AdminDashboard() {
  const { toast } = useToast();
  const { isAuthenticated, isLoading, user } = useAuth();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingBus, setEditingBus] = useState<any>(null);
  const [isDeleteBusDialogOpen, setIsDeleteBusDialogOpen] = useState(false);
  const [deletingBus, setDeletingBus] = useState<any>(null);
  const [isDriverDialogOpen, setIsDriverDialogOpen] = useState(false);
  const [editingDriver, setEditingDriver] = useState<any>(null);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [showStudentSuccessDialog, setShowStudentSuccessDialog] = useState(false);
  const [studentSuccessMessage, setStudentSuccessMessage] = useState("");
  const [isRouteDialogOpen, setIsRouteDialogOpen] = useState(false);
  const [isEditRouteDialogOpen, setIsEditRouteDialogOpen] = useState(false);
  const [editingRoute, setEditingRoute] = useState<any>(null);
  const [routeStops, setRouteStops] = useState([
    { name: '', address: '', scheduledTime: '' }
  ]);
  const [isAddSchoolDialogOpen, setIsAddSchoolDialogOpen] = useState(false);
  const [isStudentDialogOpen, setIsStudentDialogOpen] = useState(false);
  const [isEditStudentDialogOpen, setIsEditStudentDialogOpen] = useState(false);
  const [editingStudent, setEditingStudent] = useState<any>(null);
  const [showAddSchoolInRoute, setShowAddSchoolInRoute] = useState(false);
  const [activeTab, setActiveTab] = useState("fleet");
  const [calculatedDuration, setCalculatedDuration] = useState<number>(0);
  const [isCalculatingDuration, setIsCalculatingDuration] = useState(false);
  const [selectedSchoolForRoute, setSelectedSchoolForRoute] = useState<string>("");
  const [addSchoolToCurrentRoute, setAddSchoolToCurrentRoute] = useState(false);
  const [isRouteAssignmentDialogOpen, setIsRouteAssignmentDialogOpen] = useState(false);
  const [selectedDriver, setSelectedDriver] = useState<any>(null);
  const [isBusAssignmentDialogOpen, setIsBusAssignmentDialogOpen] = useState(false);
  const [driverViewMode, setDriverViewMode] = useState<'active' | 'archived'>('active');
  const [isDeactivateDriverDialogOpen, setIsDeactivateDriverDialogOpen] = useState(false);
  const [driverToDeactivate, setDriverToDeactivate] = useState<any>(null);

  // School reordering functions
  const moveSchoolUp = async (schoolId: string, currentIndex: number) => {
    if (currentIndex === 0 || !editingRoute) return;

    try {
      await apiRequest(`/api/routes/${editingRoute.id}/schools/reorder`, 'PUT', {
        schoolId,
        direction: 'up'
      });

      // Invalidate and refetch route schools
      queryClient.invalidateQueries({ 
        queryKey: ["/api/routes", editingRoute.id, "schools"] 
      });

      toast({
        title: "Success",
        description: "School moved up successfully",
      });
    } catch (error) {
      console.error("Error moving school up:", error);
      toast({
        title: "Error",
        description: "Failed to move school up",
        variant: "destructive",
      });
    }
  };

  const moveSchoolDown = async (schoolId: string, currentIndex: number) => {
    if (!editingRoute || !routeSchools || currentIndex === routeSchools.length - 1) return;

    try {
      await apiRequest(`/api/routes/${editingRoute.id}/schools/reorder`, 'PUT', {
        schoolId,
        direction: 'down'
      });

      // Invalidate and refetch route schools
      queryClient.invalidateQueries({ 
        queryKey: ["/api/routes", editingRoute.id, "schools"] 
      });

      toast({
        title: "Success",
        description: "School moved down successfully",
      });
    } catch (error) {
      console.error("Error moving school down:", error);
      toast({
        title: "Error",
        description: "Failed to move school down",
        variant: "destructive",
      });
    }
  };

  // Calculate route duration from actual addresses
  const calculateRouteDurationFromStops = async (routeId: string) => {
    try {
      setIsCalculatingDuration(true);
      
      // Fetch route stops
      const response = await fetch(`/api/routes/${routeId}/stops`);
      const stops = await response.json();
      
      console.log("Route stops fetched:", stops);
      console.log("Number of stops found:", stops.length);
      
      // Also fetch route schools for comparison
      const schoolsResponse = await fetch(`/api/routes/${routeId}/schools`);
      const schools = await schoolsResponse.json();
      console.log("Route schools fetched:", schools);
      console.log("Number of schools found:", schools.length);
      
      if (!Array.isArray(stops) || stops.length < 2) {
        toast({
          title: "Info",
          description: `Route needs at least 2 stops to calculate duration. Found ${stops?.length || 0} stops.`,
        });
        return;
      }

      // For now, let's try using schools as stops if we don't have enough route stops
      let routeData = stops;
      if (stops.length < schools.length && Array.isArray(schools)) {
        console.log("Using schools as stops because we have more schools than stops");
        routeData = schools.map((school: any) => ({
          name: school.name,
          address: school.address,
          order: school.order || 0
        }));
      }

      // Calculate duration from addresses
      const duration = await calculateRouteFromStops(routeData);
      console.log("Calculated duration:", duration);
      setCalculatedDuration(duration);

      // Update the route with calculated duration
      await apiRequest(`/api/routes/${routeId}`, 'PATCH', {
        estimatedDuration: duration
      });

      // Invalidate route queries to refresh data
      queryClient.invalidateQueries({ queryKey: ["/api/routes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/routes", routeId] });

      toast({
        title: "Duration Calculated",
        description: `Route duration updated to ${formatDuration(duration)} based on stop addresses`,
      });

    } catch (error) {
      console.error("Error calculating route duration:", error);
      toast({
        title: "Error",
        description: "Failed to calculate route duration",
        variant: "destructive",
      });
    } finally {
      setIsCalculatingDuration(false);
    }
  };

  // Form for adding buses
  const addBusForm = useForm({
    resolver: zodResolver(addBusSchema),
    defaultValues: {
      busNumber: "",
      make: "",
      model: "",
      year: new Date().getFullYear(),
      capacity: 50,
      licensePlate: "",
      status: "idle" as const,
      fuelLevel: "F",
      mileage: 0,
    },
  });

  // Form for editing buses
  const editBusForm = useForm({
    resolver: zodResolver(addBusSchema),
    defaultValues: {
      busNumber: "",
      make: "",
      model: "",
      year: new Date().getFullYear(),
      capacity: 50,
      licensePlate: "",
      status: "idle" as const,
      fuelLevel: "F",
      mileage: 0,
    },
  });

  // Form for creating routes
  const routeForm = useForm({
    resolver: zodResolver(routeSchema),
    defaultValues: {
      name: "",
      description: "",
      busNumber: "",
      schoolId: "",
    },
  });

  // Form for editing routes
  const editRouteForm = useForm({
    resolver: zodResolver(routeSchema),
    defaultValues: {
      name: "",
      description: "",
      busNumber: "",
      schoolId: "",
    },
  });

  // Form for adding schools
  const schoolForm = useForm({
    resolver: zodResolver(schoolSchema),
    defaultValues: {
      name: "",
      address: "",
    },
  });

  const studentForm = useForm<z.infer<typeof studentSchema>>({
    resolver: zodResolver(studentSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      grade: "",
      parentId: user?.id || "demo-parent-id",
      schoolId: "",
      routeId: "",
      isActive: true,
    },
  });

  const editStudentForm = useForm<z.infer<typeof studentSchema>>({
    resolver: zodResolver(studentSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      grade: "",
      parentId: "",
      schoolId: "",
      routeId: "",
      isActive: true,
    },
  });

  // Form for adding/editing drivers
  const driverForm = useForm<z.infer<typeof driverSchema>>({
    resolver: zodResolver(driverSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      email: "",
      phone: "",
      address: "",
      licenseNumber: "",
      licenseState: "",
      licenseExpiryDate: "",
      hireDate: "",
      emergencyContactName: "",
      emergencyContactPhone: "",
    },
  });

  // Form for route assignment
  const routeAssignmentForm = useForm<z.infer<typeof routeAssignmentSchema>>({
    resolver: zodResolver(routeAssignmentSchema),
    defaultValues: {
      driverId: "",
      routeId: "",
    },
  });

  // Form for bus assignment
  const busAssignmentForm = useForm<z.infer<typeof busAssignmentSchema>>({
    resolver: zodResolver(busAssignmentSchema),
    defaultValues: {
      driverId: "",
      busId: "",
    },
  });

  // Route creation mutation
  const createRouteMutation = useMutation({
    mutationFn: async (data: z.infer<typeof routeSchema>) => {
      console.log('Route data:', data);
      // Transform the data to match the database schema
      const routeData = {
        name: data.name,
        description: data.description || null,
        busNumber: data.busNumber || null,
        schoolId: data.schoolId || null,
        driverId: null, // Will be assigned later
        isActive: true,
        estimatedDuration: calculatedDuration || null,
      };
      console.log('Transformed route data:', routeData);
      return await apiRequest("/api/routes", "POST", routeData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/routes"] });
      routeForm.reset();
      setIsRouteDialogOpen(false);
      setRouteStops([{ name: '', address: '', scheduledTime: '' }]);
      const durationMsg = calculatedDuration > 0 ? ` with estimated duration of ${formatDuration(calculatedDuration)}` : "";
      setCalculatedDuration(0);
      toast({
        title: "Success",
        description: `Route created successfully${durationMsg}`,
      });
    },
    onError: (error) => {
      console.error("Error creating route:", error);
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
        description: error?.message || "Failed to create route",
        variant: "destructive",
      });
    },
  });

  // Route edit mutation
  const editRouteMutation = useMutation({
    mutationFn: async (data: z.infer<typeof routeSchema> & { id: string }) => {
      const { id, ...updateData } = data;
      
      // Get the current route data to preserve estimatedDuration
      const currentRoute = Array.isArray(routes) ? routes.find((r: any) => r.id === id) : null;
      
      // Transform the data to match the database schema
      const routeData = {
        name: updateData.name,
        description: updateData.description || null,
        busNumber: updateData.busNumber || null,
        schoolId: updateData.schoolId || null,
        driverId: null, // Will be assigned later
        isActive: true,
        estimatedDuration: currentRoute?.estimatedDuration || null, // Preserve existing duration
      };
      console.log('Updating route:', id, routeData);
      return await apiRequest(`/api/routes/${id}`, "PATCH", routeData);
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/routes"] });
      editRouteForm.reset();
      setIsEditRouteDialogOpen(false);
      setEditingRoute(null);
      const action = variables.schoolId === "" ? "School removed from route" : "Route updated";
      toast({
        title: "Success",
        description: `${action} successfully`,
      });
    },
    onError: (error) => {
      console.error("Error updating route:", error);
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
        description: error?.message || "Failed to update route",
        variant: "destructive",
      });
    },
  });

  // Calculate route duration based on stops
  const calculateDurationFromStops = async (stops: typeof routeStops) => {
    if (stops.length < 2 || stops.some(stop => !stop.address)) {
      setCalculatedDuration(0);
      return;
    }

    setIsCalculatingDuration(true);
    try {
      // Get coordinates for each stop
      const coordinates: Coordinates[] = [];
      for (const stop of stops) {
        if (stop.address) {
          const coords = await geocodeAddress(stop.address);
          if (coords) {
            coordinates.push(coords);
          }
        }
      }

      if (coordinates.length >= 2) {
        const duration = calculateRouteDuration(coordinates);
        setCalculatedDuration(duration);
      }
    } catch (error) {
      console.error("Error calculating duration:", error);
    } finally {
      setIsCalculatingDuration(false);
    }
  };

  // Route stop management functions
  const addRouteStop = () => {
    const newStops = [...routeStops, { name: '', address: '', scheduledTime: '' }];
    setRouteStops(newStops);
  };

  const removeRouteStop = (index: number) => {
    setRouteStops(routeStops.filter((_, i) => i !== index));
  };

  const updateRouteStop = (index: number, field: string, value: string) => {
    const updatedStops = routeStops.map((stop, i) => 
      i === index ? { ...stop, [field]: value } : stop
    );
    setRouteStops(updatedStops);
    
    // Recalculate duration when addresses change
    if (field === 'address') {
      calculateDurationFromStops(updatedStops);
    }
  };

  // Handle route edit
  const handleEditRoute = (route: any) => {
    setEditingRoute(route);
    editRouteForm.reset({
      name: route.name,
      description: route.description || "",
      busNumber: route.busNumber || "",
      schoolId: route.schoolId || "",
    });
    setIsEditRouteDialogOpen(true);
  };

  // Handle maintenance toggle
  const handleMaintenanceToggle = (busId: string, newStatus: string) => {
    const bus = Array.isArray(buses) ? buses.find((b: any) => b.id === busId) : null;
    if (bus) {
      editBusMutation.mutate({
        id: busId,
        busNumber: bus.busNumber,
        make: bus.make,
        model: bus.model,
        year: bus.year,
        capacity: bus.capacity,
        licensePlate: bus.licensePlate,
        status: newStatus,
        fuelLevel: bus.fuelLevel,
        mileage: bus.mileage,
      });
    }
  };


  // Student creation mutation
  const createStudentMutation = useMutation({
    mutationFn: async (data: z.infer<typeof studentSchema>) => {
      // Check for duplicate name
      if (Array.isArray(students)) {
        const duplicate = students.find((student: any) => 
          student.firstName.toLowerCase() === data.firstName.toLowerCase() && 
          student.lastName.toLowerCase() === data.lastName.toLowerCase()
        );
        if (duplicate) {
          throw new Error(`A student named ${data.firstName} ${data.lastName} already exists in the system.`);
        }
      }
      
      // Validate school-route association
      const schoolId = data.schoolId === "none" ? undefined : data.schoolId;
      const routeId = data.routeId === "none" ? undefined : data.routeId;
      
      if (schoolId && routeId) {
        const response = await fetch(`/api/routes/${routeId}/schools`, { credentials: 'include' });
        if (response.ok) {
          const routeSchools = await response.json();
          const schoolOnRoute = Array.isArray(routeSchools) && routeSchools.some((s: any) => s.id === schoolId);
          if (!schoolOnRoute) {
            const schoolName = Array.isArray(schools) ? schools.find((s: any) => s.id === schoolId)?.name : 'Selected school';
            const routeName = Array.isArray(routes) ? routes.find((r: any) => r.id === routeId)?.name : 'selected route';
            throw new Error(`${schoolName} is not associated with ${routeName}. Please add the school to the route first, or select a different school/route combination.`);
          }
        }
      }
      
      // Convert "none" values to empty strings for proper API handling
      const processedData = {
        ...data,
        schoolId: schoolId,
        routeId: routeId,
      };
      console.log('Creating student with data:', processedData);
      return await apiRequest("/api/students", "POST", processedData);
    },
    onSuccess: (newStudent) => {
      console.log("Student created successfully:", newStudent);
      queryClient.invalidateQueries({ queryKey: ["/api/students"] });
      studentForm.reset({
        firstName: "",
        lastName: "",
        grade: "",
        parentId: user?.id || "demo-parent-id",
        schoolId: "",
        routeId: "",
        isActive: true,
      });
      setIsStudentDialogOpen(false);
      
      // Show success popup
      setStudentSuccessMessage(`${newStudent.firstName} ${newStudent.lastName} has been added successfully to the student roster.`);
      setShowStudentSuccessDialog(true);
      
      // Auto-hide after 5 seconds
      setTimeout(() => {
        setShowStudentSuccessDialog(false);
      }, 5000);
    },
    onError: (error) => {
      console.error("Error creating student:", error);
      console.log("Form errors:", studentForm.formState.errors);
      
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
      // Check if it's a duplicate error
      if (error?.message?.includes("already exists in the system")) {
        toast({
          title: "Duplicate Entry",
          description: error.message,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Error",
          description: error?.message || "Failed to create student. Please check all required fields.",
          variant: "destructive",
        });
      }
    },
  });

  // Student edit mutation
  const editStudentMutation = useMutation({
    mutationFn: async (data: z.infer<typeof studentSchema> & { id: string }) => {
      const { id, ...updateData } = data;
      
      // Check for duplicate name (excluding current student)
      if (Array.isArray(students)) {
        const duplicate = students.find((student: any) => 
          student.id !== id &&
          student.firstName.toLowerCase() === updateData.firstName.toLowerCase() && 
          student.lastName.toLowerCase() === updateData.lastName.toLowerCase()
        );
        if (duplicate) {
          throw new Error(`A student named ${updateData.firstName} ${updateData.lastName} already exists in the system.`);
        }
      }
      
      // Validate school-route association
      const schoolId = updateData.schoolId === "none" ? undefined : updateData.schoolId;
      const routeId = updateData.routeId === "none" ? undefined : updateData.routeId;
      
      if (schoolId && routeId) {
        const response = await fetch(`/api/routes/${routeId}/schools`, { credentials: 'include' });
        if (response.ok) {
          const routeSchools = await response.json();
          const schoolOnRoute = Array.isArray(routeSchools) && routeSchools.some((s: any) => s.id === schoolId);
          if (!schoolOnRoute) {
            const schoolName = Array.isArray(schools) ? schools.find((s: any) => s.id === schoolId)?.name : 'Selected school';
            const routeName = Array.isArray(routes) ? routes.find((r: any) => r.id === routeId)?.name : 'selected route';
            throw new Error(`${schoolName} is not associated with ${routeName}. Please add the school to the route first, or select a different school/route combination.`);
          }
        }
      }
      
      // Convert "none" values to undefined for proper API handling
      const processedData = {
        ...updateData,
        schoolId: schoolId,
        routeId: routeId,
      };
      console.log('Updating student with data:', processedData);
      return await apiRequest(`/api/students/${id}`, "PUT", processedData);
    },
    onSuccess: (updatedStudent) => {
      console.log("Student updated successfully:", updatedStudent);
      queryClient.invalidateQueries({ queryKey: ["/api/students"] });
      editStudentForm.reset();
      setIsEditStudentDialogOpen(false);
      setEditingStudent(null);
      
      // Show success popup for edit
      setStudentSuccessMessage(`${updatedStudent.firstName} ${updatedStudent.lastName} has been updated successfully.`);
      setShowStudentSuccessDialog(true);
      
      // Auto-hide after 5 seconds
      setTimeout(() => {
        setShowStudentSuccessDialog(false);
      }, 5000);
    },
    onError: (error) => {
      console.error("Error updating student:", error);
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
      // Check if it's a duplicate error
      if (error?.message?.includes("already exists in the system")) {
        toast({
          title: "Duplicate Entry",
          description: error.message,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Error",
          description: error?.message || "Failed to update student. Please check all required fields.",
          variant: "destructive",
        });
      }
    },
  });

  // Student delete mutation
  const deleteStudentMutation = useMutation({
    mutationFn: async (studentId: string) => {
      return await apiRequest(`/api/students/${studentId}`, "DELETE");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/students"] });
      
      // Show success popup for delete
      setStudentSuccessMessage("Student has been removed from the roster successfully.");
      setShowStudentSuccessDialog(true);
      
      // Auto-hide after 5 seconds
      setTimeout(() => {
        setShowStudentSuccessDialog(false);
      }, 5000);
    },
    onError: (error) => {
      console.error("Error deleting student:", error);
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
        description: error?.message || "Failed to delete student",
        variant: "destructive",
      });
    },
  });

  // Handle edit student
  const handleEditStudent = (student: any) => {
    setEditingStudent(student);
    editStudentForm.reset({
      firstName: student.firstName,
      lastName: student.lastName,
      grade: student.grade || "",
      parentId: student.parentId,
      schoolId: student.schoolId || "",
      routeId: student.routeId || "",
      isActive: student.isActive,
    });
    setIsEditStudentDialogOpen(true);
  };

  // Handle delete student
  const handleDeleteStudent = (student: any) => {
    const studentName = `${student.firstName} ${student.lastName}`;
    if (window.confirm(`Are you sure you want to delete ${studentName}? This action cannot be undone.`)) {
      deleteStudentMutation.mutate(student.id);
    }
  };

  // Handle delete driver
  const handleDeleteDriver = (driverId: string) => {
    toast({
      title: "Info",
      description: "Delete driver functionality coming soon",
    });
  };

  // Driver mutations
  const createDriverMutation = useMutation({
    mutationFn: async (data: z.infer<typeof driverSchema>) => {
      return await apiRequest("/api/drivers", "POST", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/drivers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/drivers/active"] });
      queryClient.invalidateQueries({ queryKey: ["/api/drivers/archived"] });
      driverForm.reset();
      setIsDriverDialogOpen(false);
      toast({
        title: "Success",
        description: "Driver added successfully",
      });
    },
    onError: (error: any) => {
      console.error("Create driver error:", error);
      toast({
        title: "Error",
        description: error?.message || "Failed to add driver",
        variant: "destructive",
      });
    },
  });

  const editDriverMutation = useMutation({
    mutationFn: async (data: z.infer<typeof driverSchema>) => {
      if (!editingDriver) return;
      return await apiRequest(`/api/drivers/${editingDriver.id}`, "PATCH", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/drivers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/drivers/active"] });
      queryClient.invalidateQueries({ queryKey: ["/api/drivers/archived"] });
      setEditingDriver(null);
      setIsDriverDialogOpen(false);
      driverForm.reset();
      toast({
        title: "Success",
        description: "Driver updated successfully",
      });
    },
    onError: (error: any) => {
      console.error("Edit driver error:", error);
      toast({
        title: "Error",
        description: error?.message || "Failed to update driver",
        variant: "destructive",
      });
    },
  });

  const deactivateDriverMutation = useMutation({
    mutationFn: async (driverId: string) => {
      return await apiRequest(`/api/drivers/${driverId}/deactivate`, "POST");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/drivers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/drivers/active"] });
      queryClient.invalidateQueries({ queryKey: ["/api/drivers/archived"] });
      queryClient.invalidateQueries({ queryKey: ["/api/buses"] });
      setIsDeactivateDriverDialogOpen(false);
      setDriverToDeactivate(null);
      toast({
        title: "Driver Archived",
        description: "Driver has been deactivated and moved to archive. Their bus and route assignments have been cleared.",
      });
    },
    onError: (error: any) => {
      console.error("Deactivate driver error:", error);
      toast({
        title: "Error",
        description: error?.message || "Failed to deactivate driver",
        variant: "destructive",
      });
    },
  });

  const reactivateDriverMutation = useMutation({
    mutationFn: async (driverId: string) => {
      return await apiRequest(`/api/drivers/${driverId}/reactivate`, "POST");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/drivers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/drivers/active"] });
      queryClient.invalidateQueries({ queryKey: ["/api/drivers/archived"] });
      toast({
        title: "Driver Reactivated",
        description: "Driver has been restored to active status.",
      });
    },
    onError: (error: any) => {
      console.error("Reactivate driver error:", error);
      toast({
        title: "Error",
        description: error?.message || "Failed to reactivate driver",
        variant: "destructive",
      });
    },
  });

  const sendDriverInvitationMutation = useMutation({
    mutationFn: async (driverId: string) => {
      return await apiRequest(`/api/drivers/${driverId}/send-invitation`, "POST");
    },
    onSuccess: () => {
      toast({
        title: "Invitation Sent",
        description: "Password setup email has been sent to the driver.",
      });
    },
    onError: (error: any) => {
      console.error("Send invitation error:", error);
      toast({
        title: "Error",
        description: error?.message || "Failed to send invitation",
        variant: "destructive",
      });
    },
  });

  // School creation mutation
  const createSchoolMutation = useMutation({
    mutationFn: async (data: z.infer<typeof schoolSchema>) => {
      return await apiRequest("/api/schools", "POST", data);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/schools"] });
      schoolForm.reset();
      setIsAddSchoolDialogOpen(false);
      
      // If we're adding school from route context, add it to the current route
      if (addSchoolToCurrentRoute && editingRoute) {
        addSchoolToRouteMutation.mutate({
          routeId: editingRoute.id,
          schoolId: data.id
        });
        setAddSchoolToCurrentRoute(false);
        toast({
          title: "Success",
          description: "School created and added to route successfully.",
        });
      } else {
        // Navigate to routes tab after adding school
        setActiveTab("routes");
        toast({
          title: "Success",
          description: "School added successfully. Switched to Routes tab.",
        });
      }
    },
    onError: (error) => {
      console.error("Error creating school:", error);
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
        description: error?.message || "Failed to create school",
        variant: "destructive",
      });
    },
  });

  // Edit bus mutation
  const editBusMutation = useMutation({
    mutationFn: async (data: z.infer<typeof addBusSchema> & { id: string }) => {
      const { id, ...updateData } = data;
      return await apiRequest(`/api/buses/${id}`, "PATCH", updateData);
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/buses"] });
      editBusForm.reset();
      setEditDialogOpen(false);
      setEditingBus(null);
      
      // Special success message for maintenance status
      if (variables.status === 'maintenance') {
        toast({
          title: "Bus Placed Under Maintenance",
          description: `Bus #${variables.busNumber} has been moved to maintenance mode and is no longer available for routes.`,
        });
      } else {
        toast({
          title: "Success",
          description: "Bus updated successfully",
        });
      }
    },
    onError: (error) => {
      console.error("Error updating bus:", error);
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
        description: error?.message || "Failed to update bus",
        variant: "destructive",
      });
    },
  });

  // Delete bus mutation
  const deleteBusMutation = useMutation({
    mutationFn: async (busId: string) => {
      return await apiRequest(`/api/buses/${busId}`, "DELETE");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/buses"] });
      setIsDeleteBusDialogOpen(false);
      setDeletingBus(null);
      toast({
        title: "Success",
        description: "Bus deleted successfully",
      });
    },
    onError: (error) => {
      console.error("Error deleting bus:", error);
      
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
        description: error?.message || "Bus is associated with active route and cannot be deleted",
        variant: "destructive",
      });
    },
  });

  // Add school to route mutation
  const addSchoolToRouteMutation = useMutation({
    mutationFn: async ({ routeId, schoolId }: { routeId: string; schoolId: string }) => {
      return await apiRequest(`/api/routes/${routeId}/schools/${schoolId}`, "POST", {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/routes", editingRoute?.id, "schools"] });
      queryClient.invalidateQueries({ queryKey: ["/api/routes", editingRoute?.id, "stops"] });
      setSelectedSchoolForRoute("");
      toast({
        title: "Success",
        description: "School added to route successfully",
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
        description: error?.message || "Failed to add school to route",
        variant: "destructive",
      });
    },
  });


  // Route assignment mutation
  const assignRouteToDriverMutation = useMutation({
    mutationFn: async (data: z.infer<typeof routeAssignmentSchema>) => {
      return await apiRequest(`/api/routes/${data.routeId}`, "PATCH", {
        driverId: data.routeId ? data.driverId : null
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/routes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/drivers"] });
      routeAssignmentForm.reset();
      setIsRouteAssignmentDialogOpen(false);
      setSelectedDriver(null);
      toast({
        title: "Success",
        description: "Route assigned to driver successfully",
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
        description: error?.message || "Failed to assign route to driver",
        variant: "destructive",
      });
    },
  });

  // Bus assignment mutation
  const assignBusToDriverMutation = useMutation({
    mutationFn: async (data: z.infer<typeof busAssignmentSchema>) => {
      return await apiRequest(`/api/buses/${data.busId}`, "PATCH", {
        driverId: data.busId ? data.driverId : null
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/buses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/drivers"] });
      busAssignmentForm.reset();
      setIsBusAssignmentDialogOpen(false);
      setSelectedDriver(null);
      toast({
        title: "Success",
        description: "Bus assigned to driver successfully",
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
      // Check for duplicate assignment error
      if (error?.message?.includes("already assigned to Bus")) {
        toast({
          title: "Duplicate Assignment",
          description: error.message,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Error",
          description: error?.message || "Failed to assign bus to driver",
          variant: "destructive",
        });
      }
    },
  });

  // Function to open edit dialog
  const handleEditBus = (bus: any) => {
    setEditingBus(bus);
    editBusForm.reset({
      busNumber: bus.busNumber || "",
      make: bus.make || "",
      model: bus.model || "",
      year: bus.year || new Date().getFullYear(),
      capacity: bus.capacity || 50,
      licensePlate: bus.licensePlate || "",
      status: bus.status || "idle",
      fuelLevel: bus.fuelLevel || "F",
      mileage: bus.mileage || 0,
    });
    setEditDialogOpen(true);
  };

  const handleDeleteBus = (bus: any) => {
    setDeletingBus(bus);
    setIsDeleteBusDialogOpen(true);
  };

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

  const { data: buses, refetch: refetchBuses, isLoading: busesLoading, isFetching: busesFetching, dataUpdatedAt } = useQuery({
    queryKey: ["/api/buses"],
    enabled: !!user,
    retry: false,
    staleTime: 0, // Always fetch fresh data
    gcTime: 0, // Don't cache data (updated from cacheTime)
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    refetchInterval: 30000, // Auto-refresh every 30 seconds
  });

  const { data: students } = useQuery({
    queryKey: ["/api/students"],
    enabled: !!user,
    retry: false,
    refetchInterval: 30000,
  });

  const { data: routes } = useQuery({
    queryKey: ["/api/routes"],
    enabled: !!user,
    retry: false,
    refetchInterval: 30000,
  });

  // Helper function to get school count for a route (each school = 1 stop)
  const getRouteStopCount = async (routeId: string) => {
    try {
      const response = await fetch(`/api/routes/${routeId}/schools`);
      if (response.ok) {
        const schools = await response.json();
        return Array.isArray(schools) ? schools.length : 0;
      }
    } catch (error) {
      console.error('Error fetching route schools:', error);
    }
    return 0;
  };

  const { data: schools } = useQuery({
    queryKey: ["/api/schools"],
    enabled: !!user,
    retry: false,
  });

  const { data: drivers } = useQuery({
    queryKey: ["/api/drivers"],
    enabled: !!user,
    retry: false,
    refetchInterval: 30000,
  });

  const { data: activeDrivers } = useQuery({
    queryKey: ["/api/drivers/active"],
    enabled: !!user,
    retry: false,
    refetchInterval: 30000,
  });

  const { data: archivedDrivers } = useQuery({
    queryKey: ["/api/drivers/archived"],
    enabled: !!user,
    retry: false,
    refetchInterval: 30000,
  });

  const { data: onDutyDrivers } = useQuery({
    queryKey: ["/api/on-duty-drivers"],
    enabled: !!user,
    retry: false,
    refetchInterval: 30000,
  });

  const { data: unreadNotificationCount } = useQuery<{ count: number }>({
    queryKey: ["/api/system-notifications/unread-count"],
    enabled: !!user,
    retry: false,
    refetchInterval: 30000,
  });

  // Query for student attendance data
  const { data: attendanceData, refetch: refetchAttendanceData } = useQuery({
    queryKey: ["/api/student-attendance"],
    enabled: !!user,
    retry: false,
  });

  // Fetch schools for the currently editing route
  const { data: routeSchools } = useQuery({
    queryKey: ["/api/routes", editingRoute?.id, "schools"],
    enabled: !!editingRoute?.id,
    retry: false,
  });

  // Fetch stops for the currently editing route
  const { data: routeStopsData } = useQuery({
    queryKey: ["/api/routes", editingRoute?.id, "stops"],
    enabled: !!editingRoute?.id,
    retry: false,
  });

  // Add bus mutation with comprehensive error handling
  const addBusMutation = useMutation({
    mutationFn: async (data: z.infer<typeof addBusSchema>) => {
      console.log('Frontend: Submitting bus data:', data);
      
      try {
        const result = await apiRequest("/api/buses", "POST", data);
        console.log('Frontend: API response:', result);
        return result;
      } catch (error) {
        console.error('Frontend: API request failed:', error);
        throw error;
      }
    },
    onSuccess: (newBus) => {
      console.log('Frontend: Bus creation successful:', newBus);
      
      // Immediately update the local cache with the new bus
      queryClient.setQueryData(["/api/buses"], (oldData: any) => {
        console.log('Updating cache. Old data:', oldData?.length || 0, 'buses');
        const newData = oldData ? [...oldData, newBus] : [newBus];
        console.log('New data:', newData.length, 'buses');
        return newData;
      });
      
      // Complete cache reset and immediate refetch
      queryClient.removeQueries({ queryKey: ["/api/buses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/buses"] });
      
      // Immediate refetch with promise chain for reliability
      refetchBuses().then(() => {
        console.log('First refetch completed');
        setTimeout(() => {
          refetchBuses().then(() => {
            console.log('Second refetch completed - UI should now show updated data');
          });
        }, 50);
      });
      
      // Reset form and close dialog
      addBusForm.reset();
      setIsDialogOpen(false);
      
      // Show success popup dialog
      setSuccessMessage(`Bus #${newBus.busNumber} (${newBus.make} ${newBus.model}) has been successfully added to your fleet!`);
      setShowSuccessDialog(true);
    },
    onError: (error: any) => {
      console.error("Frontend: Error adding bus:", error);
      
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
      
      let errorMessage = "Failed to add bus to fleet";
      if (error?.message?.includes("already exists")) {
        errorMessage = "Bus number already exists in the fleet";
      } else if (error?.message) {
        errorMessage = error.message;
      }
      
      toast({
        title: "Error",
        description: errorMessage,
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

  console.log('Admin Dashboard - Buses data:', buses?.length || 0, 'buses loaded');

  // Calculate assignedBuses for driver operations
  const assignedBuses = useMemo(() => {
    if (!Array.isArray(buses)) return [];
    return buses;
  }, [buses]);
  const activeBuses = Array.isArray(buses) ? buses.filter((bus: any) => bus.status === 'on_route') : [];
  const idleBuses = Array.isArray(buses) ? buses.filter((bus: any) => bus.status === 'idle') : [];
  const maintenanceBuses = Array.isArray(buses) ? buses.filter((bus: any) => bus.status === 'maintenance') : [];
  const availableBuses = idleBuses.length;
  
  return (
    <div className="min-h-screen bg-background">
      <Navigation />
      
      {/* Header */}
      <div className="bg-primary text-white py-6">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">Administrator Dashboard</h1>
              <p className="text-blue-100">Comprehensive fleet and operations management</p>
            </div>
            <div className="flex items-center space-x-4">
              <Badge variant="secondary" className="bg-green-500">
                <CheckCircle className="w-4 h-4 mr-1" />
                System Online
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
                <Car className="h-8 w-8 text-blue-600" />
                <div className="ml-4">
                  <p className="text-2xl font-semibold">{Array.isArray(buses) ? buses.length : 0}</p>
                  <p className="text-gray-600">Total Fleet</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center">
                <Users className="h-8 w-8 text-green-600" />
                <div className="ml-4">
                  <p className="text-2xl font-semibold">{Array.isArray(students) ? students.length : 0}</p>
                  <p className="text-gray-600">Students</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <div className="flex items-center">
                <RouteIcon className="h-8 w-8 text-purple-600" />
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
                <CheckCircle className="h-8 w-8 text-orange-600" />
                <div className="ml-4">
                  <p className="text-2xl font-semibold">{activeBuses.length}</p>
                  <p className="text-gray-600">Active Buses</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Main Content Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="flex flex-wrap gap-1 h-auto p-1">
            <TabsTrigger value="fleet">Fleet Management</TabsTrigger>
            <TabsTrigger value="live-map" className="flex items-center">
              <MapPin className="w-4 h-4 mr-1" />
              Live Map
            </TabsTrigger>
            <TabsTrigger value="maintenance" className="flex items-center">
              <Wrench className="w-4 h-4 mr-1" />
              Maintenance
            </TabsTrigger>
            <TabsTrigger value="routes">Routes</TabsTrigger>
            <TabsTrigger value="students">Students</TabsTrigger>
            <TabsTrigger value="drivers">Drivers</TabsTrigger>
            <TabsTrigger value="active-drivers" className="flex items-center">
              <CheckCircle className="w-4 h-4 mr-1" />
              On-Duty
              {Array.isArray(onDutyDrivers) && onDutyDrivers.length > 0 && (
                <Badge className="ml-1 h-4 w-4 p-0 text-xs bg-green-500">
                  {onDutyDrivers.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="active-buses" className="flex items-center">
              <Car className="w-4 h-4 mr-1" />
              Active Buses
              {Array.isArray(buses) && buses.filter((bus: any) => bus.driverId).length > 0 && (
                <Badge className="ml-1 h-4 w-4 p-0 text-xs bg-blue-500">
                  {buses.filter((bus: any) => bus.driverId).length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="attendance" className="flex items-center">
              <Users className="w-4 h-4 mr-1" />
              Attendance
              {Array.isArray(attendanceData) && attendanceData.length > 0 && (
                <Badge className="ml-1 h-4 w-4 p-0 text-xs bg-purple-500">
                  {attendanceData.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="reports">Reports</TabsTrigger>
            <TabsTrigger value="shift-reports" className="flex items-center">
              <Clock className="w-4 h-4 mr-1" />
              Shift Reports
            </TabsTrigger>
            <TabsTrigger value="notifications" className="flex items-center">
              <Bell className="w-4 h-4 mr-1" />
              Notifications
              {unreadNotificationCount && unreadNotificationCount.count > 0 && (
                <Badge className="ml-1 h-5 min-w-[20px] p-0 text-xs bg-red-500 animate-pulse">
                  {unreadNotificationCount.count}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/* Fleet Management Tab */}
          <TabsContent value="fleet">
            <div className="space-y-6">
              {/* Fleet Overview Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center text-green-600">
                      <CheckCircle className="w-5 h-5 mr-2" />
                      Active Buses
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">{activeBuses.length}</div>
                    <p className="text-sm text-gray-600 mt-1">Currently on routes</p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center text-blue-600">
                      <Car className="w-5 h-5 mr-2" />
                      Available Buses
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">{availableBuses}</div>
                    <p className="text-sm text-gray-600 mt-1">Ready for assignment</p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center text-orange-600">
                      <Wrench className="w-5 h-5 mr-2" />
                      In Maintenance
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">{maintenanceBuses.length}</div>
                    <p className="text-sm text-gray-600 mt-1">Under service</p>
                  </CardContent>
                </Card>
              </div>

              {/* Fleet Management Table */}
              <Card>
                <CardHeader>
                  <div className="flex justify-between items-center">
                    <CardTitle>Fleet Inventory</CardTitle>
                    <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                      <DialogTrigger asChild>
                        <Button data-testid="button-add-bus">
                          <Plus className="w-4 h-4 mr-2" />
                          Add Bus to Fleet
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="sm:max-w-[600px]">
                        <DialogHeader>
                          <DialogTitle>Add New Bus to Fleet</DialogTitle>
                          <DialogDescription>
                            Enter the bus details to add it to your fleet inventory.
                          </DialogDescription>
                        </DialogHeader>
                        <Form {...addBusForm}>
                          <form onSubmit={addBusForm.handleSubmit((data) => addBusMutation.mutate(data))} className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                              <FormField
                                control={addBusForm.control}
                                name="busNumber"
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel>Bus Number *</FormLabel>
                                    <FormControl>
                                      <Input {...field} placeholder="e.g. 42" data-testid="input-bus-number" />
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                              <FormField
                                control={addBusForm.control}
                                name="licensePlate"
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel>License Plate *</FormLabel>
                                    <FormControl>
                                      <Input {...field} placeholder="e.g. ABC-1234" data-testid="input-license-plate" />
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                            </div>
                            
                            <div className="grid grid-cols-2 gap-4">
                              <FormField
                                control={addBusForm.control}
                                name="make"
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel>Make *</FormLabel>
                                    <FormControl>
                                      <Input {...field} placeholder="e.g. Blue Bird" data-testid="input-make" />
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                              <FormField
                                control={addBusForm.control}
                                name="model"
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel>Model *</FormLabel>
                                    <FormControl>
                                      <Input {...field} placeholder="e.g. Vision" data-testid="input-model" />
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                              <FormField
                                control={addBusForm.control}
                                name="year"
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel>Year *</FormLabel>
                                    <FormControl>
                                      <Input {...field} type="number" min="1990" max={new Date().getFullYear() + 1} data-testid="input-year" />
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                              <FormField
                                control={addBusForm.control}
                                name="capacity"
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel>Capacity *</FormLabel>
                                    <FormControl>
                                      <Input {...field} type="number" min="1" max="200" placeholder="50" data-testid="input-capacity" />
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                              <FormField
                                control={addBusForm.control}
                                name="status"
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel>Initial Status</FormLabel>
                                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                                      <FormControl>
                                        <SelectTrigger data-testid="select-status">
                                          <SelectValue />
                                        </SelectTrigger>
                                      </FormControl>
                                      <SelectContent>
                                        <SelectItem value="idle">Idle</SelectItem>
                                        <SelectItem value="on_route">On Route</SelectItem>
                                        <SelectItem value="maintenance">Maintenance</SelectItem>
                                        <SelectItem value="emergency">Emergency</SelectItem>
                                      </SelectContent>
                                    </Select>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                              <FormField
                                control={addBusForm.control}
                                name="fuelLevel"
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel>Fuel Level</FormLabel>
                                    <Select onValueChange={field.onChange} value={field.value}>
                                      <FormControl>
                                        <SelectTrigger data-testid="select-fuel-level">
                                          <SelectValue placeholder="Select fuel level" />
                                        </SelectTrigger>
                                      </FormControl>
                                      <SelectContent>
                                        <SelectItem value="F">Full (F)</SelectItem>
                                        <SelectItem value="¾">¾ Full</SelectItem>
                                        <SelectItem value="½">½ Full</SelectItem>
                                        <SelectItem value="¼">¼ Full</SelectItem>
                                        <SelectItem value="E">Empty (E)</SelectItem>
                                      </SelectContent>
                                    </Select>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                            </div>

                            <FormField
                              control={addBusForm.control}
                              name="mileage"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>Current Mileage</FormLabel>
                                  <FormControl>
                                    <Input {...field} type="number" min="0" placeholder="0" data-testid="input-mileage" />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />

                            <div className="flex justify-end space-x-2 pt-4">
                              <Button variant="outline" type="button" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
                              <Button type="submit" disabled={addBusMutation.isPending} data-testid="button-submit-bus">
                                {addBusMutation.isPending ? "Adding..." : "Add Bus"}
                              </Button>
                            </div>
                          </form>
                        </Form>
                      </DialogContent>
                    </Dialog>
                  </div>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Bus #</TableHead>
                        <TableHead>Make/Model</TableHead>
                        <TableHead>License Plate</TableHead>
                        <TableHead>Capacity</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Fuel Level</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {Array.isArray(buses) && buses.length > 0 ? (
                        buses
                          .sort((a: any, b: any) => parseInt(a.busNumber) - parseInt(b.busNumber))
                          .map((bus: any) => (
                          <TableRow key={bus.id}>
                            <TableCell className="font-medium" data-testid={`bus-number-${bus.id}`}>
                              #{bus.busNumber}
                            </TableCell>
                            <TableCell>
                              {bus.make || 'Blue Bird'} {bus.model || 'Vision'}
                              <div className="text-sm text-gray-500">{bus.year || '2020'}</div>
                            </TableCell>
                            <TableCell>{bus.licensePlate || 'ABC-1234'}</TableCell>
                            <TableCell>{bus.capacity || 50} students</TableCell>
                            <TableCell>
                              <Badge 
                                variant={
                                  bus.status === 'on_route' ? 'default' :
                                  bus.status === 'idle' ? 'secondary' :
                                  bus.status === 'maintenance' ? 'outline' : 
                                  bus.status === 'inactive' ? 'outline' : 'destructive'
                                }
                                className={
                                  bus.status === 'on_route' ? 'bg-green-100 text-green-800' :
                                  bus.status === 'idle' ? 'bg-blue-100 text-blue-800' :
                                  bus.status === 'maintenance' ? 'bg-orange-100 text-orange-800 border-orange-300' : 
                                  bus.status === 'inactive' ? 'bg-gray-100 text-gray-800 border-gray-300' : 'bg-red-100 text-red-800'
                                }
                              >
                                {bus.status === 'on_route' ? (
                                  <div className="flex items-center">
                                    <RouteIcon className="w-3 h-3 mr-1" />
                                    On Route
                                  </div>
                                ) : bus.status === 'idle' ? (
                                  <div className="flex items-center">
                                    <CheckCircle className="w-3 h-3 mr-1" />
                                    Available
                                  </div>
                                ) : bus.status === 'maintenance' ? (
                                  <div className="flex items-center">
                                    <Wrench className="w-3 h-3 mr-1" />
                                    Under Maintenance
                                  </div>
                                ) : bus.status === 'inactive' ? (
                                  <div className="flex items-center">
                                    <Power className="w-3 h-3 mr-1" />
                                    Inactive
                                  </div>
                                ) : (
                                  <div className="flex items-center">
                                    <AlertTriangle className="w-3 h-3 mr-1" />
                                    Emergency
                                  </div>
                                )}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center">
                                <Fuel className="w-4 h-4 mr-1 text-blue-500" />
                                {bus.fuelLevel === 'F' ? 'Full' :
                                 bus.fuelLevel === '¾' ? '¾ Full' :
                                 bus.fuelLevel === '½' ? '½ Full' :
                                 bus.fuelLevel === '¼' ? '¼ Full' :
                                 bus.fuelLevel === 'E' ? 'Empty' : bus.fuelLevel || 'Full'}
                              </div>
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex space-x-2">
                                <Button 
                                  variant="outline" 
                                  size="sm"
                                  onClick={() => handleEditBus(bus)}
                                  data-testid={`button-edit-${bus.id}`}
                                >
                                  <Edit className="w-4 h-4 mr-1" />
                                  Edit
                                </Button>
                                <Button 
                                  variant="outline" 
                                  size="sm"
                                  onClick={() => handleDeleteBus(bus)}
                                  className="text-red-600 hover:text-red-800 hover:bg-red-50"
                                  data-testid={`button-delete-${bus.id}`}
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                                {bus.status !== 'maintenance' && (
                                  <Button 
                                    variant="outline" 
                                    size="sm"
                                    onClick={() => handleMaintenanceToggle(bus.id, 'maintenance')}
                                    className="text-orange-600 hover:text-orange-700 hover:bg-orange-50"
                                    data-testid={`button-maintenance-${bus.id}`}
                                  >
                                    <Wrench className="w-4 h-4" />
                                  </Button>
                                )}
                                {bus.status === 'maintenance' && (
                                  <Button 
                                    variant="outline" 
                                    size="sm"
                                    onClick={() => handleMaintenanceToggle(bus.id, 'idle')}
                                    className="text-green-600 hover:text-green-700 hover:bg-green-50"
                                    data-testid={`button-restore-${bus.id}`}
                                  >
                                    <CheckCircle className="w-4 h-4" />
                                  </Button>
                                )}
                                <Button variant="outline" size="sm" data-testid={`button-track-bus-${bus.id}`}>
                                  <MapPin className="w-4 h-4" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell colSpan={7} className="text-center text-gray-500 py-8">
                            No buses in fleet. Add buses to get started.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              {/* Edit Bus Dialog */}
              <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
                <DialogContent className="sm:max-w-[600px]">
                  <DialogHeader>
                    <DialogTitle>Edit Bus Details</DialogTitle>
                    <DialogDescription>
                      Update the bus information below.
                    </DialogDescription>
                  </DialogHeader>
                  <Form {...editBusForm}>
                    <form onSubmit={editBusForm.handleSubmit((data) => {
                      if (editingBus) {
                        editBusMutation.mutate({ ...data, id: editingBus.id });
                      }
                    })} className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <FormField
                          control={editBusForm.control}
                          name="busNumber"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Bus Number *</FormLabel>
                              <FormControl>
                                <Input {...field} placeholder="e.g. 42" data-testid="edit-input-bus-number" />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={editBusForm.control}
                          name="licensePlate"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>License Plate *</FormLabel>
                              <FormControl>
                                <Input {...field} placeholder="e.g. ABC-123" data-testid="edit-input-license-plate" />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={editBusForm.control}
                          name="make"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Make</FormLabel>
                              <FormControl>
                                <Input {...field} placeholder="e.g. Blue Bird" data-testid="edit-input-make" />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={editBusForm.control}
                          name="model"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Model</FormLabel>
                              <FormControl>
                                <Input {...field} placeholder="e.g. Vision" data-testid="edit-input-model" />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={editBusForm.control}
                          name="year"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Year</FormLabel>
                              <FormControl>
                                <Input {...field} type="number" min="1990" max={new Date().getFullYear() + 1} data-testid="edit-input-year" />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={editBusForm.control}
                          name="capacity"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Capacity</FormLabel>
                              <FormControl>
                                <Input {...field} type="number" min="1" max="100" placeholder="50" data-testid="edit-input-capacity" />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={editBusForm.control}
                          name="status"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Status</FormLabel>
                              <Select onValueChange={field.onChange} value={field.value}>
                                <FormControl>
                                  <SelectTrigger data-testid="edit-select-status">
                                    <SelectValue placeholder="Select status" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="idle">Available</SelectItem>
                                  <SelectItem value="on_route">On Route</SelectItem>
                                  <SelectItem value="maintenance">
                                    <div className="flex items-center">
                                      <Wrench className="w-4 h-4 mr-2 text-orange-500" />
                                      Place Under Maintenance
                                    </div>
                                  </SelectItem>
                                  <SelectItem value="inactive">
                                    <div className="flex items-center">
                                      <Power className="w-4 h-4 mr-2 text-gray-500" />
                                      Make Inactive
                                    </div>
                                  </SelectItem>
                                  <SelectItem value="emergency">Emergency</SelectItem>
                                </SelectContent>
                              </Select>
                              <FormMessage />
                              {field.value === "maintenance" && (
                                <div className="mt-3 p-4 bg-orange-50 border border-orange-200 rounded-lg">
                                  <div className="flex items-center text-orange-800 mb-2">
                                    <AlertTriangle className="w-4 h-4 mr-2" />
                                    <span className="font-medium">Maintenance Mode Active</span>
                                  </div>
                                  <p className="text-sm text-orange-700 mb-3">
                                    This bus will be removed from active service and unavailable for route assignments until maintenance is completed.
                                  </p>
                                  <div className="space-y-2">
                                    <div className="flex items-center text-sm text-orange-800">
                                      <CheckCircle className="w-3 h-3 mr-2" />
                                      <span>Bus will be flagged as "Under Maintenance"</span>
                                    </div>
                                    <div className="flex items-center text-sm text-orange-800">
                                      <CheckCircle className="w-3 h-3 mr-2" />
                                      <span>Route assignments will be automatically suspended</span>
                                    </div>
                                    <div className="flex items-center text-sm text-orange-800">
                                      <CheckCircle className="w-3 h-3 mr-2" />
                                      <span>Maintenance timestamp will be logged</span>
                                    </div>
                                  </div>
                                </div>
                              )}
                              {field.value === "inactive" && (
                                <div className="mt-3 p-4 bg-gray-50 border border-gray-200 rounded-lg">
                                  <div className="flex items-center text-gray-800 mb-2">
                                    <Power className="w-4 h-4 mr-2" />
                                    <span className="font-medium">Inactive Status</span>
                                  </div>
                                  <p className="text-sm text-gray-700 mb-3">
                                    This bus will be removed from active fleet and unavailable for assignments until reactivated.
                                  </p>
                                  <div className="space-y-2">
                                    <div className="flex items-center text-sm text-gray-800">
                                      <CheckCircle className="w-3 h-3 mr-2" />
                                      <span>Bus will be flagged as "Inactive"</span>
                                    </div>
                                    <div className="flex items-center text-sm text-gray-800">
                                      <CheckCircle className="w-3 h-3 mr-2" />
                                      <span>Will not appear in driver assignment lists</span>
                                    </div>
                                    <div className="flex items-center text-sm text-gray-800">
                                      <CheckCircle className="w-3 h-3 mr-2" />
                                      <span>Can be reactivated by changing status to Available</span>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={editBusForm.control}
                          name="fuelLevel"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Fuel Level</FormLabel>
                              <Select onValueChange={field.onChange} value={field.value}>
                                <FormControl>
                                  <SelectTrigger data-testid="edit-select-fuel-level">
                                    <SelectValue placeholder="Select fuel level" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="F">Full (F)</SelectItem>
                                  <SelectItem value="¾">¾ Full</SelectItem>
                                  <SelectItem value="½">½ Full</SelectItem>
                                  <SelectItem value="¼">¼ Full</SelectItem>
                                  <SelectItem value="E">Empty (E)</SelectItem>
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>

                      <FormField
                        control={editBusForm.control}
                        name="mileage"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Current Mileage</FormLabel>
                            <FormControl>
                              <Input {...field} type="number" min="0" placeholder="0" data-testid="edit-input-mileage" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <div className="flex justify-end space-x-2 pt-4">
                        <Button variant="outline" type="button" onClick={() => setEditDialogOpen(false)}>Cancel</Button>
                        <Button type="submit" disabled={editBusMutation.isPending} data-testid="button-update-bus">
                          {editBusMutation.isPending ? "Updating..." : "Update Bus"}
                        </Button>
                      </div>
                    </form>
                  </Form>
                </DialogContent>
              </Dialog>

              {/* Delete Bus Confirmation Dialog */}
              <AlertDialog open={isDeleteBusDialogOpen} onOpenChange={setIsDeleteBusDialogOpen}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete Bus</AlertDialogTitle>
                    <AlertDialogDescription>
                      Are you sure you want to delete Bus #{deletingBus?.busNumber}? This action cannot be undone.
                      {deletingBus && (
                        <div className="mt-2 p-3 bg-gray-50 rounded-md">
                          <div className="text-sm text-gray-600">
                            <strong>Bus Details:</strong><br />
                            • Bus #{deletingBus.busNumber}<br />
                            • {deletingBus.make} {deletingBus.model} ({deletingBus.year})<br />
                            • License: {deletingBus.licensePlate}
                          </div>
                        </div>
                      )}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <Button variant="outline" onClick={() => setIsDeleteBusDialogOpen(false)}>
                      Cancel
                    </Button>
                    <AlertDialogAction
                      onClick={() => {
                        if (deletingBus) {
                          deleteBusMutation.mutate(deletingBus.id);
                        }
                      }}
                      className="bg-red-600 hover:bg-red-700"
                      disabled={deleteBusMutation.isPending}
                      data-testid="button-confirm-delete-bus"
                    >
                      {deleteBusMutation.isPending ? "Deleting..." : "Delete Bus"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>

            </div>
          </TabsContent>

          {/* Live Map Tab */}
          <TabsContent value="live-map">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center">
                    <MapPin className="w-5 h-5 mr-2" />
                    Real-Time Bus Tracking
                  </CardTitle>
                  <div className="flex items-center gap-4">
                    <BusTrackingLegend />
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500">
                        {dataUpdatedAt ? `Updated: ${new Date(dataUpdatedAt).toLocaleTimeString()}` : ''}
                      </span>
                      <Badge variant="outline" className="text-xs">
                        Auto-refresh: 30s
                      </Badge>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => refetchBuses()}
                        disabled={busesFetching}
                        data-testid="button-refresh-map"
                      >
                        {busesFetching ? (
                          <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                        ) : (
                          <RefreshCw className="w-4 h-4 mr-1" />
                        )}
                        Refresh
                      </Button>
                    </div>
                  </div>
                </div>
                <CardDescription>
                  View real-time locations of all buses in your fleet. Map auto-updates every 30 seconds.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {busesLoading ? (
                  <div className="flex items-center justify-center h-[500px]">
                    <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                  </div>
                ) : (
                  <BusTrackingMap 
                    buses={Array.isArray(buses) ? buses : []}
                    drivers={Array.isArray(drivers) ? drivers : []}
                    height="500px"
                  />
                )}
                
                <div className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-4">
                  <Card className="bg-green-50 border-green-200">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-green-500"></div>
                        <span className="font-medium text-green-800">On Route</span>
                      </div>
                      <p className="text-2xl font-bold text-green-900 mt-1">
                        {Array.isArray(buses) ? buses.filter((b: any) => b.status === 'on_route').length : 0}
                      </p>
                    </CardContent>
                  </Card>
                  
                  <Card className="bg-blue-50 border-blue-200">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                        <span className="font-medium text-blue-800">Idle</span>
                      </div>
                      <p className="text-2xl font-bold text-blue-900 mt-1">
                        {Array.isArray(buses) ? buses.filter((b: any) => b.status === 'idle').length : 0}
                      </p>
                    </CardContent>
                  </Card>
                  
                  <Card className="bg-orange-50 border-orange-200">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-orange-500"></div>
                        <span className="font-medium text-orange-800">Maintenance</span>
                      </div>
                      <p className="text-2xl font-bold text-orange-900 mt-1">
                        {Array.isArray(buses) ? buses.filter((b: any) => b.status === 'maintenance').length : 0}
                      </p>
                    </CardContent>
                  </Card>
                  
                  <Card className="bg-purple-50 border-purple-200">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2">
                        <MapPin className="w-3 h-3 text-purple-500" />
                        <span className="font-medium text-purple-800">With Location</span>
                      </div>
                      <p className="text-2xl font-bold text-purple-900 mt-1">
                        {Array.isArray(buses) ? buses.filter((b: any) => b.currentLatitude && b.currentLongitude).length : 0}
                      </p>
                    </CardContent>
                  </Card>
                </div>
                
                {/* Test Location Simulation */}
                <Card className="mt-4 border-dashed border-gray-300">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Settings className="w-4 h-4" />
                      Test: Simulate Bus Location
                    </CardTitle>
                    <CardDescription className="text-xs">
                      For testing purposes only. Click to set a sample location for buses.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-2">
                      {Array.isArray(buses) && buses.slice(0, 5).map((bus: any) => (
                        <Button
                          key={bus.id}
                          size="sm"
                          variant="outline"
                          onClick={async () => {
                            const lat = 33.749 + (Math.random() - 0.5) * 0.1;
                            const lng = -84.388 + (Math.random() - 0.5) * 0.1;
                            const speed = Math.floor(Math.random() * 45);
                            try {
                              await apiRequest(`/api/buses/${bus.id}/location`, 'PUT', {
                                latitude: lat.toString(),
                                longitude: lng.toString(),
                                speed: speed.toString()
                              });
                              queryClient.invalidateQueries({ queryKey: ['/api/buses'] });
                              toast({
                                title: "Location Simulated",
                                description: `Bus #${bus.busNumber} placed at ${lat.toFixed(4)}, ${lng.toFixed(4)}`,
                              });
                            } catch (error) {
                              toast({
                                title: "Error",
                                description: "Failed to simulate location. Driver role required.",
                                variant: "destructive",
                              });
                            }
                          }}
                          data-testid={`button-simulate-location-${bus.busNumber}`}
                        >
                          <MapPin className="w-3 h-3 mr-1" />
                          Bus #{bus.busNumber}
                        </Button>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Maintenance Tab */}
          <TabsContent value="maintenance">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center">
                    <Wrench className="w-5 h-5 mr-2" />
                    Buses Under Maintenance
                  </CardTitle>
                  <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-300">
                    {maintenanceBuses.length} in maintenance
                  </Badge>
                </div>
                <CardDescription>
                  Monitor and manage buses that are currently under maintenance or service
                </CardDescription>
              </CardHeader>
              <CardContent>
                {maintenanceBuses.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Bus #</TableHead>
                        <TableHead>Make/Model</TableHead>
                        <TableHead>License Plate</TableHead>
                        <TableHead>Fuel Level</TableHead>
                        <TableHead>Maintenance Status</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {maintenanceBuses.map((bus: any) => (
                        <TableRow key={bus.id}>
                          <TableCell className="font-medium">
                            #{bus.busNumber}
                          </TableCell>
                          <TableCell>
                            {bus.make || 'Blue Bird'} {bus.model || 'Vision'}
                            <div className="text-sm text-gray-500">{bus.year || '2020'}</div>
                          </TableCell>
                          <TableCell>{bus.licensePlate || 'ABC-1234'}</TableCell>
                          <TableCell>
                            <div className="flex items-center">
                              <Fuel className="w-4 h-4 mr-1 text-blue-500" />
                              {bus.fuelLevel === 'F' ? 'Full' :
                               bus.fuelLevel === '¾' ? '¾ Full' :
                               bus.fuelLevel === '½' ? '½ Full' :
                               bus.fuelLevel === '¼' ? '¼ Full' :
                               bus.fuelLevel === 'E' ? 'Empty' : bus.fuelLevel || 'Full'}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="bg-orange-50 border border-orange-200 rounded-lg p-3">
                              <div className="flex items-center text-orange-800 mb-2">
                                <Wrench className="w-4 h-4 mr-2" />
                                <span className="font-medium">Under Maintenance</span>
                              </div>
                              <p className="text-sm text-orange-700">
                                Bus is currently unavailable for service
                              </p>
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex space-x-2">
                              <Button 
                                variant="outline" 
                                size="sm"
                                onClick={() => handleEditBus(bus)}
                                data-testid={`button-edit-maintenance-${bus.id}`}
                              >
                                <Edit className="w-4 h-4 mr-1" />
                                Edit
                              </Button>
                              <Button 
                                variant="outline" 
                                size="sm"
                                onClick={() => handleMaintenanceToggle(bus.id, 'idle')}
                                className="text-green-600 hover:text-green-700 hover:bg-green-50"
                                data-testid={`button-restore-maintenance-${bus.id}`}
                              >
                                <CheckCircle className="w-4 h-4 mr-1" />
                                Restore to Service
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="text-center py-12">
                    <Wrench className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                    <h3 className="text-lg font-medium text-gray-900 mb-2">No Buses Under Maintenance</h3>
                    <p className="text-gray-500 mb-6">
                      All buses are currently available for service. When buses require maintenance, they will appear here.
                    </p>
                    <div className="bg-green-50 border border-green-200 rounded-lg p-4 max-w-md mx-auto">
                      <div className="flex items-center text-green-800">
                        <CheckCircle className="w-5 h-5 mr-2" />
                        <span className="font-medium">Fleet Status: All Operational</span>
                      </div>
                      <p className="text-sm text-green-700 mt-1">
                        Your entire fleet is ready for route assignments.
                      </p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="routes">
            <div className="space-y-6">
              {/* Route Overview Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center text-blue-600">
                      <RouteIcon className="w-5 h-5 mr-2" />
                      Active Routes
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">{Array.isArray(routes) ? routes.filter((r: any) => r.isActive).length : 0}</div>
                    <p className="text-sm text-gray-600 mt-1">Currently running</p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center text-green-600">
                      <MapPin className="w-5 h-5 mr-2" />
                      Total Stops
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <TotalStopsDisplay routes={routes} />
                    <p className="text-sm text-gray-600 mt-1">Schools across all routes</p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center text-purple-600">
                      <Clock className="w-5 h-5 mr-2" />
                      Avg Duration
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">
                      {Array.isArray(routes) && routes.length > 0 ? (
                        routes.filter((r: any) => r.estimatedDuration && r.estimatedDuration > 0).length > 0 ? 
                          Math.round(routes.reduce((sum: number, r: any) => sum + (r.estimatedDuration || 0), 0) / routes.filter((r: any) => r.estimatedDuration && r.estimatedDuration > 0).length) :
                          'Not calculated'
                      ) : 'No routes'}
                    </div>
                    <p className="text-sm text-gray-600 mt-1">
                      {Array.isArray(routes) && routes.length > 0 ? 
                        `Minutes per route (${routes.filter((r: any) => r.estimatedDuration && r.estimatedDuration > 0).length}/${routes.length} calculated)` : 
                        'Minutes per route'}
                    </p>
                  </CardContent>
                </Card>
              </div>

              {/* Route Management Table */}
              <Card>
                <CardHeader>
                  <div className="flex justify-between items-center">
                    <CardTitle>Route Management</CardTitle>
                    <Dialog open={isRouteDialogOpen} onOpenChange={setIsRouteDialogOpen}>
                      <DialogTrigger asChild>
                        <Button data-testid="button-add-route">
                          <Plus className="w-4 h-4 mr-2" />
                          Create New Route
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="sm:max-w-[800px] max-h-[90vh] overflow-y-auto">
                        <DialogHeader>
                          <DialogTitle>Create New Route</DialogTitle>
                          <DialogDescription>
                            Set up a new bus route with multiple stops and full addresses.
                          </DialogDescription>
                        </DialogHeader>
                        <Form {...routeForm}>
                          <form onSubmit={routeForm.handleSubmit((data) => {
                            createRouteMutation.mutate(data);
                          })} className="space-y-6">
                            <div className="grid grid-cols-2 gap-4">
                              <FormField
                                control={routeForm.control}
                                name="name"
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel>Route Name *</FormLabel>
                                    <FormControl>
                                      <Input {...field} placeholder="e.g. Morning Route A" data-testid="input-route-name" />
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                              <FormField
                                control={routeForm.control}
                                name="busNumber"
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel>Assigned Bus</FormLabel>
                                    <Select onValueChange={field.onChange} value={field.value}>
                                      <FormControl>
                                        <SelectTrigger data-testid="select-bus-number">
                                          <SelectValue placeholder="Select a bus" />
                                        </SelectTrigger>
                                      </FormControl>
                                      <SelectContent>
                                        {Array.isArray(buses) && buses.map((bus: any) => (
                                          <SelectItem key={bus.id} value={bus.busNumber}>
                                            Bus #{bus.busNumber} - {bus.make} {bus.model}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                            </div>

                            <FormField
                              control={routeForm.control}
                              name="description"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>Description</FormLabel>
                                  <FormControl>
                                    <Input {...field} placeholder="Brief description of the route" data-testid="input-route-description" />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />

                            <FormField
                              control={routeForm.control}
                              name="schoolId"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>Associated School (Optional)</FormLabel>
                                  <div className="flex space-x-2">
                                    <Select onValueChange={field.onChange} value={field.value}>
                                      <FormControl>
                                        <SelectTrigger data-testid="select-route-school">
                                          <SelectValue placeholder="Select a school" />
                                        </SelectTrigger>
                                      </FormControl>
                                      <SelectContent>
                                        {Array.isArray(schools) && schools.map((school: any) => (
                                          <SelectItem key={school.id} value={school.id}>
                                            {school.name}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                    <Button
                                      type="button"
                                      variant="outline"
                                      onClick={() => setIsAddSchoolDialogOpen(true)}
                                      data-testid="button-add-school-route"
                                    >
                                      <Plus className="w-4 h-4" />
                                    </Button>
                                  </div>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />

                            <div>
                              <div className="flex justify-between items-center mb-4">
                                <h4 className="text-lg font-medium">Route Stops</h4>
                                <div className="flex items-center space-x-2">
                                  <Calculator className="w-4 h-4 text-blue-600" />
                                  <span className="text-sm text-gray-600">
                                    {isCalculatingDuration ? "Calculating..." : 
                                     calculatedDuration > 0 ? `Est. Duration: ${formatDuration(calculatedDuration)}` : "Add addresses to calculate"}
                                  </span>
                                </div>
                              </div>
                              <div className="space-y-4">
                                {routeStops.map((stop, index) => (
                                  <Card key={index} className="p-4">
                                    <div className="flex items-center justify-between mb-3">
                                      <h5 className="font-medium">Stop #{index + 1}</h5>
                                      {routeStops.length > 1 && (
                                        <Button
                                          type="button"
                                          variant="outline"
                                          size="sm"
                                          onClick={() => removeRouteStop(index)}
                                          data-testid={`button-remove-stop-${index}`}
                                        >
                                          <X className="w-4 h-4" />
                                        </Button>
                                      )}
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                      <div>
                                        <label className="text-sm font-medium">Stop Name *</label>
                                        <Input
                                          value={stop.name}
                                          onChange={(e) => updateRouteStop(index, 'name', e.target.value)}
                                          placeholder="e.g. Oak Street & Main Ave"
                                          data-testid={`input-stop-name-${index}`}
                                        />
                                      </div>
                                      <div>
                                        <label className="text-sm font-medium">Scheduled Time</label>
                                        <Input
                                          type="time"
                                          value={stop.scheduledTime}
                                          onChange={(e) => updateRouteStop(index, 'scheduledTime', e.target.value)}
                                          data-testid={`input-stop-time-${index}`}
                                        />
                                      </div>
                                    </div>
                                    <div className="mt-4">
                                      <label className="text-sm font-medium">Full Address *</label>
                                      <Input
                                        value={stop.address}
                                        onChange={(e) => updateRouteStop(index, 'address', e.target.value)}
                                        placeholder="e.g. 123 Oak Street, Springfield, IL 62701"
                                        data-testid={`input-stop-address-${index}`}
                                        className="mt-1"
                                      />
                                      <p className="text-xs text-gray-500 mt-1">
                                        Include street address, city, state, and ZIP code
                                      </p>
                                    </div>
                                  </Card>
                                ))}
                              </div>
                              <Button
                                type="button"
                                variant="outline"
                                onClick={addRouteStop}
                                className="mt-4"
                                data-testid="button-add-stop"
                              >
                                <Plus className="w-4 h-4 mr-2" />
                                Add Another Stop
                              </Button>
                            </div>

                            <div className="flex justify-end space-x-2">
                              <Button
                                type="button"
                                variant="outline"
                                onClick={() => setIsRouteDialogOpen(false)}
                                data-testid="button-cancel-route"
                              >
                                Cancel
                              </Button>
                              <Button 
                                type="submit" 
                                disabled={createRouteMutation.isPending}
                                data-testid="button-submit-route"
                              >
                                {createRouteMutation.isPending ? "Creating..." : "Create Route"}
                              </Button>
                            </div>
                          </form>
                        </Form>
                      </DialogContent>
                    </Dialog>
                  </div>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Route Name</TableHead>
                        <TableHead>Assigned Bus</TableHead>
                        <TableHead>School</TableHead>
                        <TableHead>Duration</TableHead>
                        <TableHead>Stops</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {Array.isArray(routes) && routes.length > 0 ? (
                        routes.map((route: any) => (
                          <TableRow key={route.id}>
                            <TableCell className="font-medium" data-testid={`route-name-${route.id}`}>
                              {route.name}
                              <div className="text-sm text-gray-500">{route.description}</div>
                            </TableCell>
                            <TableCell>
                              {route.busNumber ? `Bus #${route.busNumber}` : 'Unassigned'}
                            </TableCell>
                            <TableCell>
                              {route.schoolId ? (
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center space-x-2">
                                    <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                                    <span className="text-sm">
                                      {Array.isArray(schools) ? 
                                        schools.find((s: any) => s.id === route.schoolId)?.name || 'Unknown School' : 
                                        'Loading...'
                                      }
                                    </span>
                                  </div>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                      const schoolName = Array.isArray(schools) ? 
                                        schools.find((s: any) => s.id === route.schoolId)?.name || 'Unknown School' : 
                                        'School';
                                      if (window.confirm(`Remove ${schoolName} from this route? This will also remove associated stops.`)) {
                                        handleRemoveSchoolFromRoute(route.id, route.schoolId);
                                      }
                                    }}
                                    className="text-red-500 hover:text-red-700 hover:bg-red-50 p-1 h-auto"
                                    data-testid={`button-remove-school-${route.id}`}
                                    title="Remove school from route"
                                  >
                                    <X className="w-3 h-3" />
                                  </Button>
                                </div>
                              ) : (
                                <span className="text-gray-400 text-sm">No school assigned</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center space-x-1">
                                <Clock className="w-4 h-4 text-gray-400" />
                                <span>{route.estimatedDuration ? formatDuration(route.estimatedDuration) : 'Not set'}</span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <RouteStopCount routeId={route.id} />
                            </TableCell>
                            <TableCell>
                              <Badge variant={route.isActive ? 'default' : 'secondary'}>
                                {route.isActive ? 'Active' : 'Inactive'}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex space-x-2">
                                <Button 
                                  variant="outline" 
                                  size="sm" 
                                  onClick={() => handleEditRoute(route)}
                                  data-testid={`button-edit-route-${route.id}`}
                                >
                                  <Edit className="w-4 h-4 mr-1" />
                                  Edit
                                </Button>
                                <Button variant="outline" size="sm" data-testid={`button-view-route-${route.id}`}>
                                  <MapPin className="w-4 h-4" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell colSpan={7} className="text-center text-gray-500 py-8">
                            No routes created yet. Create your first route to get started.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="students">
            <div className="space-y-6">
              {/* Students Overview Cards */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Total Students</CardTitle>
                    <Users className="w-4 h-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">{Array.isArray(students) ? students.length : 0}</div>
                  </CardContent>
                </Card>
                
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Active Students</CardTitle>
                    <UserCheck className="w-4 h-4 text-green-600" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {Array.isArray(students) ? students.filter((s: any) => s.isActive).length : 0}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Students with Routes</CardTitle>
                    <RouteIcon className="w-4 h-4 text-blue-600" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {Array.isArray(students) ? students.filter((s: any) => s.routeId).length : 0}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Students with Schools</CardTitle>
                    <GraduationCap className="w-4 h-4 text-purple-600" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {Array.isArray(students) ? students.filter((s: any) => s.schoolId).length : 0}
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Student Management */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center space-x-2">
                      <Users className="w-5 h-5" />
                      <span>Student Management</span>
                    </CardTitle>
                    <Button onClick={() => setIsStudentDialogOpen(true)} data-testid="button-add-student">
                      <Plus className="w-4 h-4 mr-2" />
                      Add Student
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Grade</TableHead>
                        <TableHead>School</TableHead>
                        <TableHead>Route</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {Array.isArray(students) && students.length > 0 ? (
                        students.map((student: any) => (
                          <TableRow key={student.id}>
                            <TableCell className="font-medium" data-testid={`student-name-${student.id}`}>
                              {student.firstName} {student.lastName}
                            </TableCell>
                            <TableCell>{student.grade || 'N/A'}</TableCell>
                            <TableCell>
                              {student.schoolId ? (
                                <div className="flex items-center space-x-2">
                                  <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                                  <span className="text-sm">
                                    {Array.isArray(schools) ? 
                                      schools.find((s: any) => s.id === student.schoolId)?.name || 'Unknown School' : 
                                      'Loading...'
                                    }
                                  </span>
                                </div>
                              ) : (
                                <span className="text-gray-400 text-sm">No school assigned</span>
                              )}
                            </TableCell>
                            <TableCell>
                              {student.routeId ? (
                                <div className="flex items-center space-x-2">
                                  <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                                  <span className="text-sm">
                                    {Array.isArray(routes) ? 
                                      routes.find((r: any) => r.id === student.routeId)?.name || 'Unknown Route' : 
                                      'Loading...'
                                    }
                                  </span>
                                </div>
                              ) : (
                                <span className="text-gray-400 text-sm">No route assigned</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <Badge variant={student.isActive ? "default" : "secondary"}>
                                {student.isActive ? "Active" : "Inactive"}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <div className="flex space-x-2">
                                <LinkCodeButton student={student} />
                                <Button 
                                  variant="outline" 
                                  size="sm"
                                  onClick={() => handleEditStudent(student)}
                                  data-testid={`button-edit-student-${student.id}`}
                                >
                                  <Edit className="w-4 h-4" />
                                </Button>
                                <Button 
                                  variant="outline" 
                                  size="sm"
                                  onClick={() => handleDeleteStudent(student)}
                                  disabled={deleteStudentMutation.isPending}
                                  className="text-red-500 hover:text-red-700"
                                  data-testid={`button-delete-student-${student.id}`}
                                >
                                  {deleteStudentMutation.isPending && deleteStudentMutation.variables === student.id ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                  ) : (
                                    <Trash2 className="w-4 h-4" />
                                  )}
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center text-gray-500 py-8">
                            No students registered yet. Add your first student to get started.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="drivers">
            <div className="space-y-6">
              {/* Driver Overview Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center text-blue-600">
                      <Users className="w-5 h-5 mr-2" />
                      Total Drivers
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">{Array.isArray(drivers) ? drivers.length : 0}</div>
                    <p className="text-sm text-gray-600 mt-1">Registered drivers</p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center text-green-600">
                      <CheckCircle className="w-5 h-5 mr-2" />
                      On Duty Drivers
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">
                      {Array.isArray(onDutyDrivers) ? onDutyDrivers.length : 0}
                    </div>
                    <p className="text-sm text-gray-600 mt-1">Currently on duty</p>
                    {Array.isArray(onDutyDrivers) && onDutyDrivers.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {onDutyDrivers.slice(0, 3).map((driver: any) => (
                          <div key={driver.id} className="text-xs text-gray-600">
                            {driver.firstName} {driver.lastName}
                          </div>
                        ))}
                        {onDutyDrivers.length > 3 && (
                          <div className="text-xs text-gray-500">
                            +{onDutyDrivers.length - 3} more
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center text-orange-600">
                      <Clock className="w-5 h-5 mr-2" />
                      On Duty
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">
                      {Array.isArray(drivers) ? drivers.filter((d: any) => d.isActive && assignedBuses.some((b: any) => b.driverId === d.id && b.status === 'on_route')).length : 0}
                    </div>
                    <p className="text-sm text-gray-600 mt-1">Currently driving</p>
                  </CardContent>
                </Card>
              </div>

              {/* Driver Management Section */}
              <Card>
                <CardHeader>
                  <div className="flex justify-between items-center">
                    <CardTitle>Driver Management</CardTitle>
                    <Dialog open={isDriverDialogOpen} onOpenChange={setIsDriverDialogOpen}>
                      <DialogTrigger asChild>
                        <Button data-testid="button-add-driver">
                          <Plus className="w-4 h-4 mr-2" />
                          Add Driver
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="sm:max-w-[600px]">
                        <DialogHeader>
                          <DialogTitle>
                            {editingDriver ? "Edit Driver Information" : "Add New Driver"}
                          </DialogTitle>
                        </DialogHeader>
                        <Form {...driverForm}>
                          <form onSubmit={driverForm.handleSubmit(editingDriver ? editDriverMutation.mutate : createDriverMutation.mutate)} className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                              <FormField
                                control={driverForm.control}
                                name="firstName"
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel>First Name *</FormLabel>
                                    <FormControl>
                                      <Input {...field} placeholder="John" data-testid="input-driver-firstname" />
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />

                              <FormField
                                control={driverForm.control}
                                name="lastName"
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel>Last Name *</FormLabel>
                                    <FormControl>
                                      <Input {...field} placeholder="Doe" data-testid="input-driver-lastname" />
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                              <FormField
                                control={driverForm.control}
                                name="email"
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel>Email *</FormLabel>
                                    <FormControl>
                                      <Input {...field} type="email" placeholder="john.doe@example.com" data-testid="input-driver-email" />
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />

                              <FormField
                                control={driverForm.control}
                                name="phone"
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel>Phone Number *</FormLabel>
                                    <FormControl>
                                      <Input {...field} placeholder="(555) 123-4567" data-testid="input-driver-phone" />
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                            </div>

                            <FormField
                              control={driverForm.control}
                              name="address"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>Home Address</FormLabel>
                                  <FormControl>
                                    <Input {...field} placeholder="123 Main St, Springfield, IL 62701" data-testid="input-driver-address" />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />

                            <div className="grid grid-cols-2 gap-4">
                              <FormField
                                control={driverForm.control}
                                name="licenseNumber"
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel>Driver's License Number *</FormLabel>
                                    <FormControl>
                                      <Input {...field} placeholder="D123456789" data-testid="input-driver-license" />
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />

                              <FormField
                                control={driverForm.control}
                                name="licenseState"
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel>License State *</FormLabel>
                                    <FormControl>
                                      <Input {...field} placeholder="GA" data-testid="input-driver-license-state" />
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                              <FormField
                                control={driverForm.control}
                                name="licenseExpiryDate"
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel>License Expiry Date</FormLabel>
                                    <FormControl>
                                      <Input {...field} type="date" data-testid="input-driver-license-expiry" />
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />

                              <FormField
                                control={driverForm.control}
                                name="hireDate"
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel>Hire Date</FormLabel>
                                    <FormControl>
                                      <Input {...field} type="date" data-testid="input-driver-hire-date" />
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                              <FormField
                                control={driverForm.control}
                                name="emergencyContactName"
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel>Emergency Contact Name</FormLabel>
                                    <FormControl>
                                      <Input {...field} placeholder="Jane Doe" data-testid="input-driver-emergency-name" />
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />

                              <FormField
                                control={driverForm.control}
                                name="emergencyContactPhone"
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel>Emergency Contact Phone</FormLabel>
                                    <FormControl>
                                      <Input {...field} placeholder="(555) 987-6543" data-testid="input-driver-emergency-phone" />
                                    </FormControl>
                                    <FormMessage />
                                  </FormItem>
                                )}
                              />
                            </div>

                            <div className="flex justify-end space-x-2">
                              <Button
                                type="button"
                                variant="outline"
                                onClick={() => {
                                  setIsDriverDialogOpen(false);
                                  setEditingDriver(null);
                                  driverForm.reset();
                                }}
                                data-testid="button-cancel-driver"
                              >
                                Cancel
                              </Button>
                              <Button 
                                type="submit" 
                                disabled={createDriverMutation.isPending || editDriverMutation.isPending}
                                data-testid="button-submit-driver"
                              >
                                {(createDriverMutation.isPending || editDriverMutation.isPending) ? "Saving..." : 
                                 editingDriver ? "Update Driver" : "Add Driver"}
                              </Button>
                            </div>
                          </form>
                        </Form>
                      </DialogContent>
                    </Dialog>
                  </div>
                </CardHeader>
                <CardContent>
                  {/* Active/Archived Tabs */}
                  <div className="flex items-center gap-2 mb-4 border-b pb-3">
                    <Button
                      variant={driverViewMode === 'active' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setDriverViewMode('active')}
                    >
                      Active Drivers ({Array.isArray(activeDrivers) ? activeDrivers.length : 0})
                    </Button>
                    <Button
                      variant={driverViewMode === 'archived' ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setDriverViewMode('archived')}
                    >
                      <Archive className="w-4 h-4 mr-2" />
                      Archived ({Array.isArray(archivedDrivers) ? archivedDrivers.length : 0})
                    </Button>
                  </div>

                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Driver Name</TableHead>
                        <TableHead>Phone Number</TableHead>
                        <TableHead>License</TableHead>
                        {driverViewMode === 'active' && (
                          <>
                            <TableHead>Assigned Bus</TableHead>
                            <TableHead>Assigned Route</TableHead>
                          </>
                        )}
                        <TableHead>Status</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {driverViewMode === 'active' ? (
                        Array.isArray(activeDrivers) && activeDrivers.length > 0 ? (
                        activeDrivers.map((driver: any) => {
                          const assignedBus = Array.isArray(buses) ? buses.find((b: any) => b.driverId === driver.id) : null;
                          const assignedRoute = Array.isArray(routes) ? routes.find((r: any) => r.driverId === driver.id) : null;
                          return (
                            <TableRow key={driver.id}>
                              <TableCell>
                                <div className="flex items-center space-x-3">
                                  <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                                    <Users className="w-4 h-4 text-blue-600" />
                                  </div>
                                  <div>
                                    <div className="font-medium" data-testid={`text-driver-name-${driver.id}`}>
                                      {driver.firstName} {driver.lastName}
                                    </div>
                                    <div className="text-sm text-gray-500">{driver.email}</div>
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell data-testid={`text-driver-phone-${driver.id}`}>
                                {driver.phone || 'Not provided'}
                              </TableCell>
                              <TableCell>
                                <div className="text-sm">
                                  <div>{driver.licenseNumber || 'Not provided'}</div>
                                  <div className="text-gray-500">{driver.licenseState || ''}</div>
                                </div>
                              </TableCell>
                              <TableCell data-testid={`text-driver-bus-${driver.id}`}>
                                {assignedBus ? (
                                  <div className="flex items-center space-x-2">
                                    <Car className="w-4 h-4 text-blue-600" />
                                    <span>Bus #{assignedBus.busNumber}</span>
                                  </div>
                                ) : (
                                  <span className="text-gray-500">No assignment</span>
                                )}
                              </TableCell>
                              <TableCell data-testid={`text-driver-route-${driver.id}`}>
                                {assignedRoute ? (
                                  <div className="flex items-center space-x-2">
                                    <RouteIcon className="w-4 h-4 text-green-600" />
                                    <span>{assignedRoute.name}</span>
                                  </div>
                                ) : (
                                  <span className="text-gray-500">No route</span>
                                )}
                              </TableCell>
                              <TableCell>
                                <Badge variant={driver.isActive ? "default" : "secondary"} data-testid={`badge-driver-status-${driver.id}`}>
                                  {driver.isActive ? "Active" : "Inactive"}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center space-x-2">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => {
                                      setEditingDriver(driver);
                                      driverForm.reset({
                                        firstName: driver.firstName || '',
                                        lastName: driver.lastName || '',
                                        email: driver.email || '',
                                        phone: driver.phone || '',
                                        address: driver.address || '',
                                        licenseNumber: driver.licenseNumber || '',
                                        licenseState: driver.licenseState || '',
                                        licenseExpiryDate: driver.licenseExpiryDate ? new Date(driver.licenseExpiryDate).toISOString().split('T')[0] : '',
                                        hireDate: driver.hireDate ? new Date(driver.hireDate).toISOString().split('T')[0] : '',
                                        emergencyContactName: driver.emergencyContactName || '',
                                        emergencyContactPhone: driver.emergencyContactPhone || '',
                                      });
                                      setIsDriverDialogOpen(true);
                                    }}
                                    data-testid={`button-edit-driver-${driver.id}`}
                                  >
                                    <Edit2 className="w-4 h-4" />
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => {
                                      setSelectedDriver(driver);
                                      setIsRouteAssignmentDialogOpen(true);
                                    }}
                                    data-testid={`button-assign-route-${driver.id}`}
                                  >
                                    <RouteIcon className="w-4 h-4" />
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => {
                                      setSelectedDriver(driver);
                                      busAssignmentForm.setValue("driverId", driver.id);
                                      setIsBusAssignmentDialogOpen(true);
                                    }}
                                    data-testid={`button-assign-bus-${driver.id}`}
                                  >
                                    <Car className="w-4 h-4" />
                                  </Button>
                                  {driver.email && (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="text-blue-600 hover:bg-blue-50"
                                      onClick={() => sendDriverInvitationMutation.mutate(driver.id)}
                                      disabled={sendDriverInvitationMutation.isPending}
                                      title="Send password setup invitation"
                                      data-testid={`button-send-invitation-${driver.id}`}
                                    >
                                      <Send className="w-4 h-4" />
                                    </Button>
                                  )}
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="text-red-600 hover:bg-red-50"
                                    onClick={() => {
                                      setDriverToDeactivate(driver);
                                      setIsDeactivateDriverDialogOpen(true);
                                    }}
                                    data-testid={`button-deactivate-driver-${driver.id}`}
                                  >
                                    <Archive className="w-4 h-4" />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })
                      ) : (
                        <TableRow>
                          <TableCell colSpan={7} className="text-center py-8">
                            <div className="flex flex-col items-center space-y-3">
                              <Users className="w-12 h-12 text-gray-400" />
                              <div>
                                <p className="text-lg font-medium text-gray-900">No active drivers</p>
                                <p className="text-gray-500">Add your first driver to get started</p>
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                      ) : (
                        /* Archived Drivers View */
                        Array.isArray(archivedDrivers) && archivedDrivers.length > 0 ? (
                        archivedDrivers.map((driver: any) => (
                          <TableRow key={driver.id} className="bg-gray-50">
                            <TableCell>
                              <div className="flex items-center space-x-3">
                                <div className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center">
                                  <Users className="w-4 h-4 text-gray-500" />
                                </div>
                                <div>
                                  <div className="font-medium text-gray-600">
                                    {driver.firstName} {driver.lastName}
                                  </div>
                                  <div className="text-sm text-gray-400">{driver.email}</div>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="text-gray-500">
                              {driver.phone || 'Not provided'}
                            </TableCell>
                            <TableCell>
                              <div className="text-sm text-gray-500">
                                <div>{driver.licenseNumber || 'Not provided'}</div>
                                <div className="text-gray-400">{driver.licenseState || ''}</div>
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant="secondary" className="bg-gray-200 text-gray-600">
                                Archived
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="outline"
                                size="sm"
                                className="text-green-600 hover:bg-green-50"
                                onClick={() => reactivateDriverMutation.mutate(driver.id)}
                                disabled={reactivateDriverMutation.isPending}
                                data-testid={`button-reactivate-driver-${driver.id}`}
                              >
                                <RotateCcw className="w-4 h-4 mr-2" />
                                Reactivate
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center py-8">
                            <div className="flex flex-col items-center space-y-3">
                              <Archive className="w-12 h-12 text-gray-400" />
                              <div>
                                <p className="text-lg font-medium text-gray-900">No archived drivers</p>
                                <p className="text-gray-500">Deactivated drivers will appear here</p>
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              {/* Driver Tasks Section */}
              <DriverTasksSection drivers={drivers} />

              {/* Deactivate Driver Confirmation Dialog */}
              <AlertDialog open={isDeactivateDriverDialogOpen} onOpenChange={setIsDeactivateDriverDialogOpen}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Archive Driver</AlertDialogTitle>
                    <AlertDialogDescription>
                      Are you sure you want to deactivate {driverToDeactivate?.firstName} {driverToDeactivate?.lastName}?
                      {driverToDeactivate && (
                        <div className="mt-2 p-3 bg-orange-50 rounded-md">
                          <div className="text-sm text-orange-800">
                            <strong>This action will:</strong><br />
                            • Remove the driver from active driver list<br />
                            • Clear their bus and route assignments<br />
                            • Set them to off-duty status<br />
                            • Move them to the Archive section
                          </div>
                        </div>
                      )}
                      <div className="mt-2 text-sm">
                        You can reactivate the driver later from the Archive section.
                      </div>
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <Button variant="outline" onClick={() => {
                      setIsDeactivateDriverDialogOpen(false);
                      setDriverToDeactivate(null);
                    }}>
                      Cancel
                    </Button>
                    <AlertDialogAction
                      onClick={() => {
                        if (driverToDeactivate) {
                          deactivateDriverMutation.mutate(driverToDeactivate.id);
                        }
                      }}
                      className="bg-orange-600 hover:bg-orange-700"
                      disabled={deactivateDriverMutation.isPending}
                      data-testid="button-confirm-deactivate-driver"
                    >
                      {deactivateDriverMutation.isPending ? "Archiving..." : "Archive Driver"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </TabsContent>

          {/* Active Drivers Tab */}
          <TabsContent value="active-drivers">
            <div className="space-y-6">
              {/* Active Drivers Header */}
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-bold">On-Duty Drivers</h2>
                  <p className="text-gray-600">Real-time view of drivers currently on duty</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge 
                    variant="secondary" 
                    className={`${Array.isArray(onDutyDrivers) && onDutyDrivers.length > 0 ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}
                  >
                    {Array.isArray(onDutyDrivers) ? onDutyDrivers.length : 0} Active
                  </Badge>
                </div>
              </div>

              {/* Active Drivers List */}
              {Array.isArray(onDutyDrivers) && onDutyDrivers.length > 0 ? (
                <div className="grid gap-6">
                  {onDutyDrivers.map((driver: any) => {
                    const dutyStartTime = driver.dutyStartTime ? new Date(driver.dutyStartTime) : null;
                    const hoursOnDuty = dutyStartTime 
                      ? Math.floor((new Date().getTime() - dutyStartTime.getTime()) / (1000 * 60 * 60))
                      : 0;
                    const minutesOnDuty = dutyStartTime 
                      ? Math.floor(((new Date().getTime() - dutyStartTime.getTime()) % (1000 * 60 * 60)) / (1000 * 60))
                      : 0;

                    return (
                      <Card key={driver.id} className="border-l-4 border-l-green-500">
                        <CardHeader className="pb-4">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-4">
                              <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
                                <User className="w-6 h-6 text-green-600" />
                              </div>
                              <div>
                                <h3 className="text-xl font-semibold">
                                  {driver.firstName} {driver.lastName}
                                </h3>
                                <div className="flex items-center space-x-4 text-sm text-gray-600">
                                  <span className="flex items-center">
                                    <Power className="w-4 h-4 mr-1 text-green-600" />
                                    On Duty
                                  </span>
                                  {dutyStartTime && (
                                    <span className="flex items-center">
                                      <Clock className="w-4 h-4 mr-1" />
                                      {hoursOnDuty}h {minutesOnDuty}m
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                            <Badge className="bg-green-100 text-green-800 border-green-300">
                              Available
                            </Badge>
                          </div>
                        </CardHeader>
                        <CardContent>
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                            {/* Contact Information */}
                            <div className="space-y-2">
                              <h4 className="font-medium text-gray-900">Contact</h4>
                              <div className="space-y-1 text-sm">
                                {driver.phone && (
                                  <div className="flex items-center text-gray-600">
                                    <span className="w-16">Phone:</span>
                                    <span>{driver.phone}</span>
                                  </div>
                                )}
                                {driver.email && (
                                  <div className="flex items-center text-gray-600">
                                    <span className="w-16">Email:</span>
                                    <span>{driver.email}</span>
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* License Information */}
                            <div className="space-y-2">
                              <h4 className="font-medium text-gray-900">License</h4>
                              <div className="space-y-1 text-sm">
                                {driver.licenseNumber && (
                                  <div className="flex items-center text-gray-600">
                                    <span className="w-16">Number:</span>
                                    <span>{driver.licenseNumber}</span>
                                  </div>
                                )}
                                {driver.licenseState && (
                                  <div className="flex items-center text-gray-600">
                                    <span className="w-16">State:</span>
                                    <span>{driver.licenseState}</span>
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Emergency Contact */}
                            <div className="space-y-2">
                              <h4 className="font-medium text-gray-900">Emergency Contact</h4>
                              <div className="space-y-1 text-sm">
                                {driver.emergencyContactName && (
                                  <div className="flex items-center text-gray-600">
                                    <span className="w-16">Name:</span>
                                    <span>{driver.emergencyContactName}</span>
                                  </div>
                                )}
                                {driver.emergencyContactPhone && (
                                  <div className="flex items-center text-gray-600">
                                    <span className="w-16">Phone:</span>
                                    <span>{driver.emergencyContactPhone}</span>
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Assigned Bus */}
                            <div className="space-y-2">
                              <h4 className="font-medium text-gray-900 flex items-center gap-2">
                                <Car className="w-4 h-4 text-blue-600" />
                                Assigned Bus
                              </h4>
                              <div className="space-y-1 text-sm">
                                {(() => {
                                  const assignedBus = Array.isArray(buses) 
                                    ? buses.find((bus: any) => bus.driverId === driver.id) 
                                    : null;
                                  
                                  if (assignedBus) {
                                    return (
                                      <>
                                        <div className="flex items-center text-gray-600">
                                          <span className="w-16">Bus:</span>
                                          <span className="font-medium">#{assignedBus.busNumber}</span>
                                        </div>
                                        <div className="flex items-center text-gray-600">
                                          <span className="w-16">Vehicle:</span>
                                          <span>{assignedBus.make} {assignedBus.model}</span>
                                        </div>
                                        <div className="flex items-center text-gray-600">
                                          <span className="w-16">Status:</span>
                                          <Badge 
                                            variant="secondary" 
                                            className={`text-xs ${
                                              assignedBus.status === 'available' ? 'bg-green-100 text-green-800' :
                                              assignedBus.status === 'on_route' ? 'bg-blue-100 text-blue-800' :
                                              assignedBus.status === 'maintenance' ? 'bg-red-100 text-red-800' :
                                              'bg-gray-100 text-gray-800'
                                            }`}
                                          >
                                            {assignedBus.status === 'on_route' ? 'Active' : 
                                             assignedBus.status === 'available' ? 'Available' :
                                             assignedBus.status === 'maintenance' ? 'Maintenance' : 
                                             assignedBus.status}
                                          </Badge>
                                        </div>
                                        <div className="flex items-center text-gray-600">
                                          <span className="w-16">Fuel:</span>
                                          <span>{assignedBus.fuelLevel || 'Unknown'}</span>
                                        </div>
                                      </>
                                    );
                                  } else {
                                    return (
                                      <div className="text-gray-500 text-xs">
                                        No bus assigned
                                      </div>
                                    );
                                  }
                                })()}
                              </div>
                            </div>

                            {/* Employment Info */}
                            <div className="space-y-2">
                              <h4 className="font-medium text-gray-900">Employment</h4>
                              <div className="space-y-1 text-sm">
                                {driver.hireDate && (
                                  <div className="flex items-center text-gray-600">
                                    <span className="w-16">Hired:</span>
                                    <span>{new Date(driver.hireDate).toLocaleDateString()}</span>
                                  </div>
                                )}
                                {dutyStartTime && (
                                  <div className="flex items-center text-gray-600">
                                    <span className="w-16">On Duty:</span>
                                    <span>{dutyStartTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Action Buttons */}
                          <div className="flex items-center space-x-2 mt-6 pt-4 border-t">
                            <Button 
                              variant="outline" 
                              size="sm"
                              onClick={() => {
                                toast({
                                  title: "Feature Coming Soon",
                                  description: "Driver communication features will be available soon",
                                });
                              }}
                              data-testid={`button-contact-driver-${driver.id}`}
                            >
                              <MessageSquare className="w-4 h-4 mr-2" />
                              Contact
                            </Button>
                            <Button 
                              variant="outline" 
                              size="sm"
                              onClick={() => {
                                toast({
                                  title: "Feature Coming Soon",
                                  description: "Live location tracking will be available soon",
                                });
                              }}
                              data-testid={`button-track-driver-${driver.id}`}
                            >
                              <MapPin className="w-4 h-4 mr-2" />
                              Track Location
                            </Button>
                            <Button 
                              variant="outline" 
                              size="sm"
                              onClick={() => {
                                setEditingDriver(driver);
                                setIsDriverDialogOpen(true);
                              }}
                              data-testid={`button-edit-driver-${driver.id}`}
                            >
                              <Edit2 className="w-4 h-4 mr-2" />
                              Edit Details
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              ) : (
                <Card>
                  <CardContent className="flex flex-col items-center justify-center py-12">
                    <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                      <Users className="w-8 h-8 text-gray-400" />
                    </div>
                    <h3 className="text-lg font-medium text-gray-900 mb-2">No Drivers On Duty</h3>
                    <p className="text-gray-500 text-center max-w-md">
                      There are currently no drivers on duty. Drivers can mark themselves as on duty from their dashboard to appear here.
                    </p>
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>

          {/* Active Buses Tab */}
          <TabsContent value="active-buses">
            <div className="space-y-6">
              {/* Active Buses Header */}
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-bold">Active Bus Fleet</h2>
                  <p className="text-gray-600">Real-time view of buses currently assigned to drivers</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge 
                    variant="secondary" 
                    className={`${Array.isArray(buses) && buses.filter((bus: any) => bus.driverId).length > 0 ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-800'}`}
                  >
                    {Array.isArray(buses) ? buses.filter((bus: any) => bus.driverId).length : 0} Assigned
                  </Badge>
                </div>
              </div>

              {/* Active Buses List */}
              {Array.isArray(buses) && buses.filter((bus: any) => bus.driverId).length > 0 ? (
                <div className="grid gap-6">
                  {buses
                    .filter((bus: any) => bus.driverId) // Only show buses with assigned drivers
                    .map((bus: any) => {
                      const assignedDriver = Array.isArray(drivers) 
                        ? drivers.find((driver: any) => driver.id === bus.driverId) 
                        : null;
                      
                      const assignedRoute = Array.isArray(routes)
                        ? routes.find((route: any) => route.driverId === bus.driverId)
                        : null;

                      return (
                        <Card key={bus.id} className="border-l-4 border-l-blue-500">
                          <CardHeader className="pb-4">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center space-x-4">
                                <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                                  <Car className="w-6 h-6 text-blue-600" />
                                </div>
                                <div>
                                  <h3 className="text-xl font-semibold">
                                    Bus #{bus.busNumber}
                                  </h3>
                                  <div className="flex items-center space-x-4 text-sm text-gray-600">
                                    <span>{bus.make} {bus.model} ({bus.year})</span>
                                    <span className="flex items-center">
                                      <Users className="w-4 h-4 mr-1" />
                                      {bus.capacity} seats
                                    </span>
                                  </div>
                                </div>
                              </div>
                              <Badge 
                                className={`${
                                  bus.status === 'available' ? 'bg-green-100 text-green-800' :
                                  bus.status === 'on_route' ? 'bg-blue-100 text-blue-800' :
                                  bus.status === 'maintenance' ? 'bg-red-100 text-red-800' :
                                  'bg-gray-100 text-gray-800'
                                }`}
                              >
                                {bus.status === 'on_route' ? 'On Route' : 
                                 bus.status === 'available' ? 'Available' :
                                 bus.status === 'maintenance' ? 'Maintenance' : 
                                 bus.status}
                              </Badge>
                            </div>
                          </CardHeader>
                          <CardContent>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                              {/* Driver Information */}
                              <div className="space-y-2">
                                <h4 className="font-medium text-gray-900 flex items-center gap-2">
                                  <User className="w-4 h-4" />
                                  Assigned Driver
                                </h4>
                                <div className="space-y-1 text-sm">
                                  {assignedDriver ? (
                                    <>
                                      <div className="flex items-center text-gray-600">
                                        <span className="w-16">Name:</span>
                                        <span className="font-medium">{assignedDriver.firstName} {assignedDriver.lastName}</span>
                                      </div>
                                      <div className="flex items-center text-gray-600">
                                        <span className="w-16">Phone:</span>
                                        <span>{assignedDriver.phone || 'N/A'}</span>
                                      </div>
                                      <div className="flex items-center text-gray-600">
                                        <span className="w-16">Status:</span>
                                        <Badge 
                                          variant="secondary" 
                                          className={`text-xs ${assignedDriver.isOnDuty ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}
                                        >
                                          {assignedDriver.isOnDuty ? 'On Duty' : 'Off Duty'}
                                        </Badge>
                                      </div>
                                    </>
                                  ) : (
                                    <div className="text-gray-500 text-xs">
                                      No driver information
                                    </div>
                                  )}
                                </div>
                              </div>

                              {/* Vehicle Details */}
                              <div className="space-y-2">
                                <h4 className="font-medium text-gray-900">Vehicle Details</h4>
                                <div className="space-y-1 text-sm">
                                  <div className="flex items-center text-gray-600">
                                    <span className="w-16">License:</span>
                                    <span>{bus.licensePlate || 'N/A'}</span>
                                  </div>
                                  <div className="flex items-center text-gray-600">
                                    <span className="w-16">Mileage:</span>
                                    <span>{bus.mileage ? `${bus.mileage.toLocaleString()} mi` : 'N/A'}</span>
                                  </div>
                                  <div className="flex items-center text-gray-600">
                                    <span className="w-16">Fuel:</span>
                                    <span className="flex items-center gap-1">
                                      <span>{bus.fuelLevel || 'Unknown'}</span>
                                      {bus.fuelLevel && (
                                        <div className={`w-2 h-2 rounded-full ${
                                          bus.fuelLevel === 'F' ? 'bg-green-500' :
                                          bus.fuelLevel === '¾' || bus.fuelLevel === '3/4' ? 'bg-green-400' :
                                          bus.fuelLevel === '½' || bus.fuelLevel === '1/2' ? 'bg-yellow-500' :
                                          bus.fuelLevel === '¼' || bus.fuelLevel === '1/4' ? 'bg-orange-500' :
                                          bus.fuelLevel === 'E' ? 'bg-red-500' :
                                          'bg-gray-400'
                                        }`} />
                                      )}
                                    </span>
                                  </div>
                                </div>
                              </div>

                              {/* Route Assignment */}
                              <div className="space-y-2">
                                <h4 className="font-medium text-gray-900 flex items-center gap-2">
                                  <RouteIcon className="w-4 h-4" />
                                  Assigned Route
                                </h4>
                                <div className="space-y-1 text-sm">
                                  {assignedRoute ? (
                                    <>
                                      <div className="flex items-center text-gray-600">
                                        <span className="w-16">Route:</span>
                                        <span className="font-medium">{assignedRoute.name}</span>
                                      </div>
                                      <div className="flex items-center text-gray-600">
                                        <span className="w-16">Status:</span>
                                        <Badge 
                                          variant="secondary" 
                                          className={`text-xs ${assignedRoute.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}
                                        >
                                          {assignedRoute.isActive ? 'Active' : 'Inactive'}
                                        </Badge>
                                      </div>
                                      {assignedRoute.estimatedDuration && (
                                        <div className="flex items-center text-gray-600">
                                          <span className="w-16">Duration:</span>
                                          <span>{Math.floor(assignedRoute.estimatedDuration / 60)}h {assignedRoute.estimatedDuration % 60}m</span>
                                        </div>
                                      )}
                                    </>
                                  ) : (
                                    <div className="text-gray-500 text-xs">
                                      No route assigned
                                    </div>
                                  )}
                                </div>
                              </div>

                              {/* Actions */}
                              <div className="space-y-2">
                                <h4 className="font-medium text-gray-900">Actions</h4>
                                <div className="space-y-2">
                                  <Button 
                                    variant="outline" 
                                    size="sm"
                                    className="w-full text-left justify-start"
                                    onClick={() => handleEditBus(bus)}
                                    data-testid={`button-edit-bus-${bus.id}`}
                                  >
                                    <Edit2 className="w-4 h-4 mr-2" />
                                    Edit Bus
                                  </Button>
                                  <Button 
                                    variant="outline" 
                                    size="sm"
                                    className="w-full text-left justify-start"
                                    onClick={() => {
                                      toast({
                                        title: "Feature Coming Soon",
                                        description: "Live bus tracking will be available soon",
                                      });
                                    }}
                                    data-testid={`button-track-bus-${bus.id}`}
                                  >
                                    <MapPin className="w-4 h-4 mr-2" />
                                    Track Bus
                                  </Button>
                                </div>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                </div>
              ) : (
                <Card>
                  <CardContent className="flex flex-col items-center justify-center py-12">
                    <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                      <Car className="w-8 h-8 text-gray-400" />
                    </div>
                    <h3 className="text-lg font-medium text-gray-900 mb-2">No Active Buses</h3>
                    <p className="text-gray-500 text-center max-w-md">
                      There are currently no buses assigned to drivers. Use the bus assignment feature in the Drivers tab to assign buses to drivers.
                    </p>
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>

          <TabsContent value="attendance">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="w-6 h-6" />
                  Student Attendance
                </CardTitle>
                <CardDescription>
                  View today's student attendance records marked by drivers
                </CardDescription>
              </CardHeader>
              <CardContent>
                {Array.isArray(attendanceData) && attendanceData.length > 0 ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                      <Card>
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-sm font-medium text-gray-600">Total Records</p>
                              <p className="text-2xl font-bold text-gray-900">{attendanceData.length}</p>
                            </div>
                            <Users className="w-8 h-8 text-blue-500" />
                          </div>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-sm font-medium text-gray-600">Present Students</p>
                              <p className="text-2xl font-bold text-green-600">
                                {attendanceData.filter((record: any) => record.status === 'present').length}
                              </p>
                            </div>
                            <CheckCircle className="w-8 h-8 text-green-500" />
                          </div>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-sm font-medium text-gray-600">Absent Students</p>
                              <p className="text-2xl font-bold text-blue-600">
                                {attendanceData.filter((record: any) => record.status === 'absent').length}
                              </p>
                            </div>
                            <X className="w-8 h-8 text-blue-500" />
                          </div>
                        </CardContent>
                      </Card>
                    </div>

                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Student</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Route</TableHead>
                          <TableHead>Driver</TableHead>
                          <TableHead>Time Recorded</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {attendanceData.map((record: any) => {
                          const student = Array.isArray(students) ? students.find((s: any) => s.id === record.studentId) : null;
                          const route = Array.isArray(routes) ? routes.find((r: any) => r.id === record.routeId) : null;
                          // Get driver from attendance record's driverId field
                          const driver = Array.isArray(drivers) ? drivers.find((d: any) => d.id === record.driverId) : null;
                          
                          return (
                            <TableRow key={record.id}>
                              <TableCell>
                                <div className="flex items-center space-x-3">
                                  <div className="w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center">
                                    <User className="w-4 h-4 text-purple-600" />
                                  </div>
                                  <div>
                                    <div className="font-medium">
                                      {student ? `${student.firstName} ${student.lastName}` : 'Unknown Student'}
                                    </div>
                                    <div className="text-sm text-gray-500">
                                      {student?.grade ? `Grade ${student.grade}` : 'No grade info'}
                                    </div>
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell>
                                <Badge 
                                  variant={record.status === 'present' ? 'default' : 'secondary'}
                                  className={
                                    record.status === 'present' 
                                      ? 'bg-green-100 text-green-800 hover:bg-green-200' 
                                      : 'bg-blue-100 text-blue-800 hover:bg-blue-200'
                                  }
                                >
                                  {record.status === 'present' ? (
                                    <div className="flex items-center">
                                      <CheckCircle className="w-3 h-3 mr-1" />
                                      Present
                                    </div>
                                  ) : (
                                    <div className="flex items-center">
                                      <X className="w-3 h-3 mr-1" />
                                      Absent
                                    </div>
                                  )}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center space-x-2">
                                  <RouteIcon className="w-4 h-4 text-green-600" />
                                  <span>{route ? route.name : 'Unknown Route'}</span>
                                </div>
                              </TableCell>
                              <TableCell>
                                {driver ? (
                                  <div className="flex items-center space-x-2">
                                    <User className="w-4 h-4 text-blue-600" />
                                    <div>
                                      <div className="font-medium">
                                        {driver.firstName} {driver.lastName}
                                      </div>
                                      <div className="text-xs text-gray-500">
                                        {driver.isOnDuty ? (
                                          <span className="text-green-600">On Duty</span>
                                        ) : (
                                          <span className="text-gray-500">Off Duty</span>
                                        )}
                                        {driver.dutyStartTime && driver.isOnDuty && (
                                          <span className="ml-1">
                                            since {new Date(driver.dutyStartTime).toLocaleTimeString([], { 
                                              hour: '2-digit', 
                                              minute: '2-digit' 
                                            })}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="flex items-center space-x-2">
                                    <User className="w-4 h-4 text-gray-400" />
                                    <span className="text-gray-500">No driver assigned</span>
                                  </div>
                                )}
                              </TableCell>
                              <TableCell>
                                <div className="text-sm">
                                  {new Date(record.attendanceDate).toLocaleTimeString([], { 
                                    hour: '2-digit', 
                                    minute: '2-digit' 
                                  })}
                                </div>
                                <div className="text-xs text-gray-500">
                                  {new Date(record.attendanceDate).toLocaleDateString()}
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <Card>
                    <CardContent className="flex flex-col items-center justify-center py-12">
                      <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                        <Users className="w-8 h-8 text-gray-400" />
                      </div>
                      <h3 className="text-lg font-medium text-gray-900 mb-2">No Attendance Records</h3>
                      <p className="text-gray-500 text-center max-w-md">
                        No student attendance has been recorded today. Drivers can mark attendance from their Routes tab once they're on duty and have selected their route.
                      </p>
                    </CardContent>
                  </Card>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="reports">
            <JourneyReports />
          </TabsContent>

          {/* Shift Reports Tab */}
          <TabsContent value="shift-reports">
            <ShiftReports />
          </TabsContent>

          {/* Notifications Tab */}
          <TabsContent value="notifications">
            <NotificationsTab routes={routes} buses={buses} />
          </TabsContent>
        </Tabs>
      </div>

      {/* Edit Route Dialog */}
      <Dialog open={isEditRouteDialogOpen} onOpenChange={setIsEditRouteDialogOpen}>
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Route</DialogTitle>
            <DialogDescription>
              Update the route information and bus assignment.
            </DialogDescription>
          </DialogHeader>
          <Form {...editRouteForm}>
            <form onSubmit={editRouteForm.handleSubmit((data) => {
              if (editingRoute) {
                editRouteMutation.mutate({ ...data, id: editingRoute.id });
              }
            })} className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={editRouteForm.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Route Name *</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="e.g. Morning Route A" data-testid="edit-input-route-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={editRouteForm.control}
                  name="busNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Assigned Bus</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="edit-select-bus-number">
                            <SelectValue placeholder="Select a bus" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="unassigned">Unassigned</SelectItem>
                          {Array.isArray(buses) && buses.map((bus: any) => (
                            <SelectItem key={bus.id} value={bus.busNumber}>
                              Bus #{bus.busNumber} - {bus.make} {bus.model}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={editRouteForm.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Textarea 
                        {...field} 
                        placeholder="Optional route description..."
                        className="min-h-[100px]"
                        data-testid="edit-textarea-description" 
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={editRouteForm.control}
                name="schoolId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Associated School (Optional)</FormLabel>
                    <div className="flex space-x-2">
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-edit-route-school">
                            <SelectValue placeholder="Select a school" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {Array.isArray(schools) && schools.map((school: any) => (
                            <SelectItem key={school.id} value={school.id}>
                              {school.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setIsAddSchoolDialogOpen(true)}
                        data-testid="button-add-school-edit-route"
                      >
                        <Plus className="w-4 h-4" />
                      </Button>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Current Schools Section */}
              {editingRoute && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <GraduationCap className="w-5 h-5 text-blue-600" />
                      <h4 className="text-lg font-medium">Schools Active on This Route</h4>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="text-green-600 border-green-200 hover:bg-green-50 hover:border-green-300"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        // Mark that we want to add school to current route
                        setAddSchoolToCurrentRoute(true);
                        // Open the Add New School dialog
                        setIsAddSchoolDialogOpen(true);
                      }}
                      data-testid="button-quick-add-school"
                    >
                      <Plus className="w-4 h-4 mr-1" />
                      Add School
                    </Button>
                  </div>
                  <Card>
                    <CardContent className="p-4">
                      {routeSchools && Array.isArray(routeSchools) && routeSchools.length > 0 ? (
                        <div className="space-y-3">
                          {routeSchools.map((school: any, index: number) => (
                            <div key={school.id} className="flex items-center justify-between p-3 bg-blue-50 rounded-lg border border-blue-200">
                              <div className="flex items-center gap-3">
                                <div className="flex items-center justify-center w-8 h-8 bg-blue-600 text-white rounded-full text-sm font-medium">
                                  {index + 1}
                                </div>
                                <GraduationCap className="w-6 h-6 text-blue-600" />
                                <div>
                                  <div className="font-medium text-blue-900">{school.name}</div>
                                  <div className="text-sm text-blue-700">{school.address}</div>
                                </div>
                              </div>
                              <div className="flex items-center gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => moveSchoolUp(school.id, index)}
                                  disabled={index === 0}
                                  className="text-gray-500 hover:text-gray-700 hover:bg-gray-100"
                                  data-testid={`button-move-up-${school.id}`}
                                >
                                  <ChevronUp className="w-4 h-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => moveSchoolDown(school.id, index)}
                                  disabled={index === routeSchools.length - 1}
                                  className="text-gray-500 hover:text-gray-700 hover:bg-gray-100"
                                  data-testid={`button-move-down-${school.id}`}
                                >
                                  <ChevronDown className="w-4 h-4" />
                                </Button>
                              </div>
                            </div>
                          ))}
                          
                          {/* Add new school to route */}
                          <div id="add-school-section" className="border-t pt-3">
                            <div className="flex items-center gap-2 mb-2">
                              <Plus className="w-4 h-4 text-green-600" />
                              <span className="text-sm font-medium text-gray-700">Add School to Route</span>
                            </div>
                            <div className="flex gap-2">
                              <Select value={selectedSchoolForRoute} onValueChange={setSelectedSchoolForRoute}>
                                <SelectTrigger className="flex-1" data-testid="select-school-for-route">
                                  <SelectValue placeholder="Select a school to add" />
                                </SelectTrigger>
                                <SelectContent>
                                  {Array.isArray(schools) && schools
                                    .filter((school: any) => !routeSchools.find((rs: any) => rs.id === school.id))
                                    .map((school: any) => (
                                    <SelectItem key={school.id} value={school.id}>
                                      {school.name} - {school.address}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <Button
                                size="sm"
                                onClick={() => {
                                  if (selectedSchoolForRoute) {
                                    addSchoolToRouteMutation.mutate({
                                      routeId: editingRoute.id,
                                      schoolId: selectedSchoolForRoute
                                    });
                                  }
                                }}
                                disabled={!selectedSchoolForRoute || addSchoolToRouteMutation.isPending}
                                data-testid="button-add-school-to-route"
                              >
                                {addSchoolToRouteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                              </Button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="text-center py-6 text-gray-500">
                          <GraduationCap className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                          <p>No schools currently assigned to this route</p>
                          <div className="mt-4">
                            <div className="flex items-center gap-2 mb-2 justify-center">
                              <Plus className="w-4 h-4 text-green-600" />
                              <span className="text-sm font-medium text-gray-700">Add First School</span>
                            </div>
                            <div id="add-school-section" className="flex gap-2 max-w-md mx-auto">
                              <Select value={selectedSchoolForRoute} onValueChange={setSelectedSchoolForRoute}>
                                <SelectTrigger className="flex-1" data-testid="select-first-school-for-route">
                                  <SelectValue placeholder="Select a school" />
                                </SelectTrigger>
                                <SelectContent>
                                  {Array.isArray(schools) && schools.map((school: any) => (
                                    <SelectItem key={school.id} value={school.id}>
                                      {school.name} - {school.address}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <Button
                                size="sm"
                                onClick={() => {
                                  if (selectedSchoolForRoute) {
                                    addSchoolToRouteMutation.mutate({
                                      routeId: editingRoute.id,
                                      schoolId: selectedSchoolForRoute
                                    });
                                  }
                                }}
                                disabled={!selectedSchoolForRoute || addSchoolToRouteMutation.isPending}
                                data-testid="button-add-first-school-to-route"
                              >
                                {addSchoolToRouteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                              </Button>
                            </div>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {/* Route Stops Section */}
                  <div className="space-y-3 mt-6">
                    <div className="flex items-center gap-2">
                      <MapPin className="w-5 h-5 text-green-600" />
                      <h4 className="text-lg font-medium">Route Stops</h4>
                    </div>
                    <Card>
                      <CardContent className="p-4">
                        {routeSchools && Array.isArray(routeSchools) && routeSchools.length > 0 ? (
                          <div className="space-y-3">
                            <p className="text-sm text-gray-600 mb-4">
                              Each school serves as one stop on this route. Total: {routeSchools.length} stop{routeSchools.length !== 1 ? 's' : ''}
                            </p>
                            {routeSchools.map((school: any, index: number) => (
                              <div key={school.id} className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
                                <div className="flex items-center justify-center w-8 h-8 bg-blue-100 text-blue-800 rounded-full text-sm font-medium">
                                  {index + 1}
                                </div>
                                <div className="flex items-center gap-3 flex-1">
                                  <GraduationCap className="w-6 h-6 text-blue-600" />
                                  <div>
                                    <div className="font-medium text-blue-900">{school.name}</div>
                                    <div className="text-sm text-blue-700">{school.address}</div>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <Badge variant="secondary" className="text-xs">
                                    Stop {index + 1}
                                  </Badge>
                                  <div className="flex flex-col gap-1">
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      className="h-6 w-6 p-0"
                                      onClick={() => moveSchoolUp(school.id, index)}
                                      disabled={index === 0}
                                      data-testid={`button-move-up-${school.id}`}
                                    >
                                      <ChevronUp className="w-3 h-3" />
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      className="h-6 w-6 p-0"
                                      onClick={() => moveSchoolDown(school.id, index)}
                                      disabled={index === routeSchools.length - 1}
                                      data-testid={`button-move-down-${school.id}`}
                                    >
                                      <ChevronDown className="w-3 h-3" />
                                    </Button>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-center py-6 text-gray-500">
                            <MapPin className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                            <p>No stops on this route</p>
                            <p className="text-sm text-gray-400">Add schools to create stops for this route</p>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                    
                    {/* Duration Calculation Section */}
                    <div className="mt-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Clock className="w-5 h-5 text-gray-600" />
                          <div>
                            <h4 className="text-sm font-medium text-gray-700">Route Duration</h4>
                            <p className="text-xs text-gray-500">
                              {editingRoute.estimatedDuration ? 
                                `Current: ${formatDuration(editingRoute.estimatedDuration)}` : 
                                "Not calculated yet"}
                            </p>
                          </div>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => calculateRouteDurationFromStops(editingRoute.id)}
                          disabled={isCalculatingDuration}
                          className="text-blue-600 border-blue-200 hover:bg-blue-50 hover:border-blue-300"
                          data-testid="button-calculate-duration"
                        >
                          {isCalculatingDuration ? (
                            <>
                              <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                              Calculating...
                            </>
                          ) : (
                            <>
                              <Calculator className="w-4 h-4 mr-1" />
                              Calculate from Stops
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex justify-end space-x-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsEditRouteDialogOpen(false)}
                  data-testid="button-cancel-edit-route"
                >
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  disabled={editRouteMutation.isPending}
                  data-testid="button-submit-edit-route"
                >
                  {editRouteMutation.isPending ? "Updating..." : "Update Route"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Add School Dialog */}
      <Dialog open={isAddSchoolDialogOpen} onOpenChange={(open) => {
        setIsAddSchoolDialogOpen(open);
        if (!open) {
          setAddSchoolToCurrentRoute(false);
        }
      }}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Add New School</DialogTitle>
            <DialogDescription>
              Add a school to associate with routes and students.
            </DialogDescription>
          </DialogHeader>
          <Form {...schoolForm}>
            <form onSubmit={schoolForm.handleSubmit((data) => {
              createSchoolMutation.mutate(data);
            })} className="space-y-6">
              <FormField
                control={schoolForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>School Name *</FormLabel>
                    <FormControl>
                      <Input 
                        {...field} 
                        placeholder="e.g. Springfield Elementary School" 
                        data-testid="input-school-name"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={schoolForm.control}
                name="address"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>School Address *</FormLabel>
                    <FormControl>
                      <Textarea 
                        {...field} 
                        placeholder="e.g. 123 School Street, Springfield, IL 62701"
                        className="min-h-[80px]"
                        data-testid="input-school-address"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-end space-x-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setIsAddSchoolDialogOpen(false);
                    setAddSchoolToCurrentRoute(false);
                  }}
                  data-testid="button-cancel-school"
                >
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  disabled={createSchoolMutation.isPending}
                  data-testid="button-submit-school"
                >
                  {createSchoolMutation.isPending ? "Adding..." : "Add School"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Add Student Dialog */}
      <Dialog open={isStudentDialogOpen} onOpenChange={setIsStudentDialogOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Add New Student</DialogTitle>
            <DialogDescription>
              Add a student to the system with their basic information.
            </DialogDescription>
          </DialogHeader>
          <Form {...studentForm}>
            <form onSubmit={studentForm.handleSubmit((data) => {
              console.log("Form submitted with data:", data);
              console.log("Form valid:", studentForm.formState.isValid);
              console.log("Form errors:", studentForm.formState.errors);
              createStudentMutation.mutate(data);
            })} className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={studentForm.control}
                  name="firstName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>First Name *</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="e.g. John" data-testid="input-student-first-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={studentForm.control}
                  name="lastName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Last Name *</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="e.g. Smith" data-testid="input-student-last-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={studentForm.control}
                  name="grade"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Grade (Optional)</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="e.g. 5th Grade" data-testid="input-student-grade" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={studentForm.control}
                  name="parentId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Parent ID *</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="Parent's user ID" data-testid="input-student-parent-id" />
                      </FormControl>
                      <FormMessage />
                      <p className="text-xs text-muted-foreground">
                        Current user ID: {user?.id || 'Not logged in'}
                      </p>
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={studentForm.control}
                name="schoolId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>School (Optional)</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-student-school">
                          <SelectValue placeholder="Select a school" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">No school assigned</SelectItem>
                        {Array.isArray(schools) && schools.map((school: any) => (
                          <SelectItem key={school.id} value={school.id}>
                            {school.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={studentForm.control}
                name="routeId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Route (Optional)</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-student-route">
                          <SelectValue placeholder="Select a route" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">No route assigned</SelectItem>
                        {Array.isArray(routes) && routes.map((route: any) => (
                          <SelectItem key={route.id} value={route.id}>
                            {route.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-end space-x-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsStudentDialogOpen(false)}
                  data-testid="button-cancel-student"
                >
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  disabled={createStudentMutation.isPending}
                  data-testid="button-submit-student"
                >
                  {createStudentMutation.isPending ? "Adding..." : "Add Student"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Edit Student Dialog */}
      <Dialog open={isEditStudentDialogOpen} onOpenChange={setIsEditStudentDialogOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Edit Student</DialogTitle>
            <DialogDescription>
              Update the student's information.
            </DialogDescription>
          </DialogHeader>
          <Form {...editStudentForm}>
            <form onSubmit={editStudentForm.handleSubmit((data) => {
              if (editingStudent) {
                editStudentMutation.mutate({
                  id: editingStudent.id,
                  ...data
                });
              }
            })} className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={editStudentForm.control}
                  name="firstName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>First Name *</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="e.g. John" data-testid="edit-input-student-first-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={editStudentForm.control}
                  name="lastName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Last Name *</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="e.g. Smith" data-testid="edit-input-student-last-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={editStudentForm.control}
                  name="grade"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Grade (Optional)</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="e.g. 5th Grade" data-testid="edit-input-student-grade" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={editStudentForm.control}
                  name="parentId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Parent ID *</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="Parent's user ID" data-testid="edit-input-student-parent-id" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={editStudentForm.control}
                name="schoolId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>School (Optional)</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="edit-select-student-school">
                          <SelectValue placeholder="Select a school" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">No school assigned</SelectItem>
                        {Array.isArray(schools) && schools.map((school: any) => (
                          <SelectItem key={school.id} value={school.id}>
                            {school.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={editStudentForm.control}
                name="routeId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Route (Optional)</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="edit-select-student-route">
                          <SelectValue placeholder="Select a route" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">No route assigned</SelectItem>
                        {Array.isArray(routes) && routes.map((route: any) => (
                          <SelectItem key={route.id} value={route.id}>
                            {route.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-end space-x-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsEditStudentDialogOpen(false)}
                  data-testid="button-cancel-edit-student"
                >
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  disabled={editStudentMutation.isPending}
                  data-testid="button-submit-edit-student"
                >
                  {editStudentMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      Updating...
                    </>
                  ) : (
                    "Update Student"
                  )}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Success Dialog */}
      <AlertDialog open={showSuccessDialog} onOpenChange={setShowSuccessDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-500" />
              Fleet Successfully Added!
            </AlertDialogTitle>
            <AlertDialogDescription className="text-base">
              {successMessage}
              <br /><br />
              Your fleet inventory has been updated with the new vehicle.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction 
              onClick={() => setShowSuccessDialog(false)}
              data-testid="button-success-ok"
              className="bg-green-600 hover:bg-green-700"
            >
              OK
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Student Success Dialog */}
      <AlertDialog open={showStudentSuccessDialog} onOpenChange={setShowStudentSuccessDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-500" />
              Student Operation Successful!
            </AlertDialogTitle>
            <AlertDialogDescription className="text-base">
              {studentSuccessMessage}
              <br /><br />
              The student roster has been updated.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction 
              onClick={() => setShowStudentSuccessDialog(false)}
              data-testid="button-student-success-ok"
              className="bg-green-600 hover:bg-green-700"
            >
              OK
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Route Assignment Dialog */}
      <Dialog open={isRouteAssignmentDialogOpen} onOpenChange={setIsRouteAssignmentDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Assign Route to Driver</DialogTitle>
            <DialogDescription>
              {selectedDriver && `Assign a route to ${selectedDriver.firstName} ${selectedDriver.lastName}`}
            </DialogDescription>
          </DialogHeader>
          <Form {...routeAssignmentForm}>
            <form onSubmit={routeAssignmentForm.handleSubmit(assignRouteToDriverMutation.mutate)} className="space-y-4">
              {selectedDriver && (
                <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                      <User className="w-5 h-5 text-blue-600" />
                    </div>
                    <div>
                      <div className="font-medium text-blue-900">
                        {selectedDriver.firstName} {selectedDriver.lastName}
                      </div>
                      <div className="text-sm text-blue-700">{selectedDriver.email}</div>
                      {selectedDriver.phone && (
                        <div className="text-sm text-blue-700">{selectedDriver.phone}</div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <FormField
                control={routeAssignmentForm.control}
                name="routeId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Select Route to Assign</FormLabel>
                    <Select onValueChange={(value) => {
                      field.onChange(value);
                      routeAssignmentForm.setValue('driverId', selectedDriver?.id || '');
                    }}>
                      <FormControl>
                        <SelectTrigger data-testid="select-route-assignment">
                          <SelectValue placeholder="Choose a route" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {Array.isArray(routes) && routes.length > 0 ? (
                          routes.map((route: any) => {
                            const currentDriver = Array.isArray(drivers) 
                              ? drivers.find((d: any) => d.id === route.driverId) 
                              : null;
                            
                            return (
                              <SelectItem key={route.id} value={route.id}>
                                <div className="flex flex-col">
                                  <div className="flex items-center gap-2">
                                    <RouteIcon className="w-4 h-4 text-green-600" />
                                    <span>{route.name}</span>
                                  </div>
                                  {currentDriver && (
                                    <span className="text-xs text-gray-500 mt-1">
                                      Currently assigned to {currentDriver.firstName} {currentDriver.lastName}
                                    </span>
                                  )}
                                  {route.description && (
                                    <span className="text-xs text-gray-500 mt-1">{route.description}</span>
                                  )}
                                </div>
                              </SelectItem>
                            );
                          })
                        ) : (
                          <SelectItem value="no-routes" disabled>
                            No routes available
                          </SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {routeAssignmentForm.watch('routeId') && (
                <div className="bg-green-50 p-3 rounded-lg border border-green-200">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-green-600" />
                    <span className="text-sm text-green-800">
                      This route will be assigned to {selectedDriver?.firstName} {selectedDriver?.lastName}
                    </span>
                  </div>
                </div>
              )}

              <div className="flex justify-end space-x-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setIsRouteAssignmentDialogOpen(false);
                    setSelectedDriver(null);
                    routeAssignmentForm.reset();
                  }}
                  data-testid="button-cancel-route-assignment"
                >
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  disabled={assignRouteToDriverMutation.isPending || !routeAssignmentForm.watch('routeId')}
                  data-testid="button-submit-route-assignment"
                >
                  {assignRouteToDriverMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      Assigning...
                    </>
                  ) : (
                    <>
                      <RouteIcon className="w-4 h-4 mr-2" />
                      Assign Route
                    </>
                  )}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Bus Assignment Dialog */}
      <Dialog open={isBusAssignmentDialogOpen} onOpenChange={setIsBusAssignmentDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Assign Bus to Driver</DialogTitle>
            <DialogDescription>
              {selectedDriver && `Assign a bus to ${selectedDriver.firstName} ${selectedDriver.lastName}`}
            </DialogDescription>
          </DialogHeader>
          <Form {...busAssignmentForm}>
            <form onSubmit={busAssignmentForm.handleSubmit(assignBusToDriverMutation.mutate)} className="space-y-4">
              {selectedDriver && (
                <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                      <User className="w-5 h-5 text-blue-600" />
                    </div>
                    <div>
                      <div className="font-medium text-blue-900">
                        {selectedDriver.firstName} {selectedDriver.lastName}
                      </div>
                      <div className="text-sm text-blue-700">{selectedDriver.email}</div>
                      {selectedDriver.phone && (
                        <div className="text-sm text-blue-700">{selectedDriver.phone}</div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <FormField
                control={busAssignmentForm.control}
                name="busId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Select Bus to Assign</FormLabel>
                    <Select onValueChange={(value) => {
                      field.onChange(value);
                      busAssignmentForm.setValue('driverId', selectedDriver?.id || '');
                    }}>
                      <FormControl>
                        <SelectTrigger data-testid="select-bus-assignment">
                          <SelectValue placeholder="Choose a bus" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {Array.isArray(buses) && buses.length > 0 ? (
                          (() => {
                            const availableBuses = buses.filter((bus: any) => 
                              // Show buses that are available (not in maintenance, emergency, or inactive)
                              bus.status !== 'maintenance' && 
                              bus.status !== 'emergency' &&
                              bus.status !== 'inactive'
                              // Allow reassignment - show all available buses regardless of current assignment
                            );
                            
                            console.log('Bus Assignment Dialog - Total buses:', buses.length);
                            console.log('Bus Assignment Dialog - Available buses:', availableBuses.length);
                            console.log('Bus Assignment Dialog - Available bus details:', availableBuses.map(b => ({id: b.id, number: b.busNumber, status: b.status, driverId: b.driverId})));
                            
                            if (availableBuses.length === 0) {
                              return (
                                <SelectItem value="no-buses" disabled>
                                  No buses available for assignment
                                </SelectItem>
                              );
                            }
                            
                            return availableBuses.map((bus: any) => {
                              const currentDriver = Array.isArray(drivers) 
                                ? drivers.find((d: any) => d.id === bus.driverId) 
                                : null;
                              
                              return (
                                <SelectItem key={bus.id} value={bus.id}>
                                  <div className="flex flex-col">
                                    <div className="flex items-center gap-2">
                                      <Car className="w-4 h-4 text-blue-600" />
                                      <span>Bus #{bus.busNumber}</span>
                                      <Badge variant="secondary" className="ml-2">
                                        {bus.make} {bus.model}
                                      </Badge>
                                    </div>
                                    {currentDriver && (
                                      <span className="text-xs text-gray-500 mt-1">
                                        Currently assigned to {currentDriver.firstName} {currentDriver.lastName}
                                      </span>
                                    )}
                                    <div className="flex items-center gap-2 mt-1">
                                      <span className="text-xs text-gray-500">Capacity: {bus.capacity} passengers</span>
                                      <span className="text-xs text-gray-500">• Fuel: {bus.fuelLevel}</span>
                                    </div>
                                  </div>
                                </SelectItem>
                              );
                            });
                          })()
                        ) : (
                          <SelectItem value="no-buses" disabled>
                            Loading buses...
                          </SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {busAssignmentForm.watch('busId') && (
                <div className="bg-green-50 p-3 rounded-lg border border-green-200">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-green-600" />
                    <span className="text-sm text-green-800">
                      This bus will be assigned to {selectedDriver?.firstName} {selectedDriver?.lastName}
                    </span>
                  </div>
                </div>
              )}

              <div className="flex justify-end space-x-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setIsBusAssignmentDialogOpen(false);
                    setSelectedDriver(null);
                    busAssignmentForm.reset();
                  }}
                  data-testid="button-cancel-bus-assignment"
                >
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  disabled={assignBusToDriverMutation.isPending || !busAssignmentForm.watch('busId')}
                  data-testid="button-submit-bus-assignment"
                >
                  {assignBusToDriverMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      Assigning...
                    </>
                  ) : (
                    <>
                      <Car className="w-4 h-4 mr-2" />
                      Assign Bus
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
