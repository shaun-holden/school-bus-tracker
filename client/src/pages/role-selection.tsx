import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/use-auth";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Users, Car, Shield, Lock } from "lucide-react";
import { useLocation } from "wouter";

const roles = [
  {
    id: 'parent',
    title: 'Parent',
    description: 'Track your children\'s bus location, view pickup times, and report absences',
    icon: Users,
    features: ['Live GPS tracking', 'Pickup notifications', 'Absence reporting', 'Student status updates'],
    color: 'bg-blue-500'
  },
  {
    id: 'driver',
    title: 'Bus Driver',
    description: 'Manage route progress, student attendance, and vehicle maintenance',
    icon: Car,
    features: ['Route management', 'Attendance tracking', 'Vehicle status', 'Task assignments'],
    color: 'bg-green-500'
  },
  {
    id: 'admin',
    title: 'Administrator',
    description: 'Oversee the entire bus tracking system, manage routes and assign tasks',
    icon: Shield,
    features: ['Fleet management', 'Route planning', 'Driver assignments', 'System oversight'],
    color: 'bg-purple-500'
  }
];

export default function RoleSelection() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [selectedRole, setSelectedRole] = useState<string>((user as any)?.role || '');

  const userRole = (user as any)?.role;
  const isAdmin = userRole === 'admin' || userRole === 'master_admin';

  if (!isAdmin && (userRole === 'parent' || userRole === 'driver')) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <Card className="max-w-md w-full text-center">
          <CardHeader>
            <div className="flex justify-center mb-4">
              <div className="bg-red-100 w-16 h-16 rounded-full flex items-center justify-center">
                <Lock className="w-8 h-8 text-red-500" />
              </div>
            </div>
            <CardTitle className="text-xl">Access Restricted</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-600 mb-6">
              Role changes can only be made by an administrator. Please contact your administrator if you need your role updated.
            </p>
            <Button onClick={() => setLocation("/")} className="w-full">
              Go to My Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const updateRoleMutation = useMutation({
    mutationFn: async (role: string) => {
      return await apiRequest(
        `/api/users/${(user as any)?.id}/role`,
        "PATCH",
        { role }
      );
    },
    onSuccess: () => {
      toast({
        title: "Role Updated",
        description: "Role has been successfully updated. Redirecting...",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      setTimeout(() => {
        window.location.href = "/";
      }, 1500);
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to update role: ${(error as any).message || 'Please try again.'}`,
        variant: "destructive",
      });
    },
  });

  const handleRoleSelect = () => {
    if (selectedRole) {
      updateRoleMutation.mutate(selectedRole);
    }
  };

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-4">
            Change User Role
          </h1>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            As an administrator, you can update your role in the system.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          {roles.map((role) => {
            const Icon = role.icon;
            const isSelected = selectedRole === role.id;

            return (
              <Card
                key={role.id}
                className={`cursor-pointer transition-all duration-200 ${
                  isSelected
                    ? 'ring-2 ring-primary border-primary shadow-lg'
                    : 'hover:shadow-md border-gray-200'
                }`}
                onClick={() => setSelectedRole(role.id)}
                data-testid={`role-card-${role.id}`}
              >
                <CardHeader className="text-center pb-4">
                  <div className={`${role.color} w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4`}>
                    <Icon className="w-8 h-8 text-white" />
                  </div>
                  <CardTitle className="text-xl font-semibold">
                    {role.title}
                    {isSelected && (
                      <Badge className="ml-2 bg-primary">Selected</Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-gray-600 mb-4 text-center">
                    {role.description}
                  </p>
                  <div className="space-y-2">
                    <h4 className="font-medium text-sm text-gray-900 mb-2">Key Features:</h4>
                    {role.features.map((feature, index) => (
                      <div key={index} className="flex items-center text-sm text-gray-600">
                        <div className="w-1.5 h-1.5 bg-green-500 rounded-full mr-2"></div>
                        {feature}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="text-center">
          <Button
            onClick={handleRoleSelect}
            disabled={!selectedRole || updateRoleMutation.isPending}
            className="px-8 py-3 text-lg"
            data-testid="button-confirm-role"
          >
            {updateRoleMutation.isPending ? "Updating..." : "Continue to Dashboard"}
          </Button>

          {(user as any)?.role && (
            <div className="mt-4">
              <p className="text-sm text-gray-500 mb-2">
                Current role: <span className="font-medium capitalize">{(user as any).role}</span>
              </p>
              <Button
                variant="outline"
                onClick={() => window.location.href = "/"}
                className="text-sm"
                data-testid="button-skip-role-selection"
              >
                Skip and go to current dashboard
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
