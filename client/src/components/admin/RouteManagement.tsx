import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Pencil, Trash2, Plus } from "lucide-react";

interface RouteManagementProps {
  routes: any[];
}

export default function RouteManagement({ routes }: RouteManagementProps) {
  const { toast } = useToast();
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [selectedRoute, setSelectedRoute] = useState<any>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    description: "",
    estimatedDuration: "",
    busNumber: "",
    driverId: "",
    isActive: true,
  });

  const { data: drivers } = useQuery({
    queryKey: ["/api/drivers/active"],
  });

  const { data: buses } = useQuery({
    queryKey: ["/api/buses"],
  });

  const updateRouteMutation = useMutation({
    mutationFn: async (data: { id: string; updates: any }) => {
      return apiRequest(`/api/routes/${data.id}`, "PUT", data.updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/routes"] });
      setEditDialogOpen(false);
      setSelectedRoute(null);
      toast({
        title: "Route Updated",
        description: "The route has been updated successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update route",
        variant: "destructive",
      });
    },
  });

  const handleEditClick = (route: any) => {
    setSelectedRoute(route);
    setEditForm({
      name: route.name || "",
      description: route.description || "",
      estimatedDuration: route.estimatedDuration?.toString() || "",
      busNumber: route.busNumber || "",
      driverId: route.driverId || "",
      isActive: route.isActive ?? true,
    });
    setEditDialogOpen(true);
  };

  const handleSaveEdit = () => {
    if (!selectedRoute) return;
    
    const updates: any = {
      name: editForm.name,
      description: editForm.description || null,
      estimatedDuration: editForm.estimatedDuration ? parseInt(editForm.estimatedDuration) : null,
      busNumber: editForm.busNumber || null,
      driverId: editForm.driverId || null,
      isActive: editForm.isActive,
    };

    updateRouteMutation.mutate({ id: selectedRoute.id, updates });
  };

  const handleAction = (action: string, routeId?: string) => {
    toast({
      title: "Feature Coming Soon",
      description: `${action} functionality will be available in a future update.`,
    });
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg font-semibold">Route Management</CardTitle>
            <Button 
              size="sm"
              onClick={() => handleAction("New Route")}
              data-testid="button-new-route"
            >
              <Plus className="w-4 h-4 mr-1" />
              New Route
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {routes && routes.length > 0 ? (
              routes.map((route) => (
                <div 
                  key={route.id}
                  className="flex items-center justify-between p-3 border border-gray-200 rounded-lg"
                  data-testid={`route-${route.id}`}
                >
                  <div>
                    <div className="font-medium" data-testid={`route-name-${route.id}`}>
                      {route.name}
                    </div>
                    <div className="text-sm text-gray-600" data-testid={`route-details-${route.id}`}>
                      {route.description || 'No description'}
                      {route.estimatedDuration && ` • ${route.estimatedDuration} min`}
                      {route.busNumber && ` • Bus ${route.busNumber}`}
                    </div>
                  </div>
                  <div className="flex space-x-2">
                    <Button 
                      size="sm"
                      variant="ghost"
                      onClick={() => handleEditClick(route)}
                      data-testid={`button-edit-route-${route.id}`}
                    >
                      <Pencil className="w-4 h-4 text-primary" />
                    </Button>
                    <Button 
                      size="sm"
                      variant="ghost"
                      onClick={() => handleAction("Delete Route", route.id)}
                      data-testid={`button-delete-route-${route.id}`}
                    >
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center text-gray-500 py-8">
                No routes found. Create your first route to get started.
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Edit Route</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Route Name</Label>
              <Input
                id="name"
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                placeholder="Enter route name"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={editForm.description}
                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                placeholder="Enter route description"
                rows={3}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="estimatedDuration">Estimated Duration (minutes)</Label>
              <Input
                id="estimatedDuration"
                type="number"
                value={editForm.estimatedDuration}
                onChange={(e) => setEditForm({ ...editForm, estimatedDuration: e.target.value })}
                placeholder="e.g., 45"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="busNumber">Assigned Bus</Label>
              <Select
                value={editForm.busNumber}
                onValueChange={(value) => setEditForm({ ...editForm, busNumber: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a bus" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">No bus assigned</SelectItem>
                  {Array.isArray(buses) && buses.map((bus: any) => (
                    <SelectItem key={bus.id} value={bus.busNumber}>
                      Bus #{bus.busNumber} - {bus.make} {bus.model}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="driver">Assigned Driver</Label>
              <Select
                value={editForm.driverId}
                onValueChange={(value) => setEditForm({ ...editForm, driverId: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a driver" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">No driver assigned</SelectItem>
                  {Array.isArray(drivers) && drivers.map((driver: any) => (
                    <SelectItem key={driver.id} value={driver.id}>
                      {driver.firstName} {driver.lastName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="isActive">Status</Label>
              <Select
                value={editForm.isActive ? "active" : "inactive"}
                onValueChange={(value) => setEditForm({ ...editForm, isActive: value === "active" })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleSaveEdit}
              disabled={updateRouteMutation.isPending || !editForm.name}
            >
              {updateRouteMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
