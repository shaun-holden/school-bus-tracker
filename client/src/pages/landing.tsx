import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, Car, Shield } from "lucide-react";

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

export default function Landing() {
  const [selectedRole, setSelectedRole] = useState<string>('');
  const [showRoleSelection, setShowRoleSelection] = useState(false);

  const handleRoleLogin = () => {
    if (selectedRole) {
      sessionStorage.setItem('pendingRole', selectedRole);
      window.location.href = '/auth';
    }
  };

  if (showRoleSelection) {
    return (
      <div className="min-h-screen bg-background">
        {/* Navigation */}
        <nav className="bg-primary shadow-lg">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center">
                <i className="fas fa-bus text-white text-2xl mr-3"></i>
                <h1 className="text-white text-xl font-semibold">SchoolBus Tracker</h1>
              </div>
              <Button 
                onClick={() => setShowRoleSelection(false)}
                variant="ghost"
                className="text-white hover:bg-blue-700"
                data-testid="button-back"
              >
                ← Back
              </Button>
            </div>
          </div>
        </nav>

        {/* Role Selection */}
        <div className="max-w-6xl mx-auto px-4 py-16">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-4">
              Choose Your Role
            </h1>
            <p className="text-lg text-gray-600 max-w-2xl mx-auto">
              Select the role that best describes your position in the school bus tracking system.
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
                    <CardDescription className="mb-4 text-center">
                      {role.description}
                    </CardDescription>
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
              onClick={handleRoleLogin}
              disabled={!selectedRole}
              size="lg"
              className="px-8 py-3 text-lg"
              data-testid="button-continue-login"
            >
              Continue to Sign In
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Navigation */}
      <nav className="bg-primary shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <i className="fas fa-bus text-white text-2xl mr-3"></i>
              <h1 className="text-white text-xl font-semibold">SchoolBus Tracker</h1>
            </div>
            <Button 
              onClick={() => setShowRoleSelection(true)}
              className="bg-white text-primary hover:bg-gray-100"
              data-testid="button-login"
            >
              Sign In
            </Button>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="text-center mb-16">
          <h2 className="text-4xl font-bold text-gray-900 mb-4">
            Keep Track of Your School Bus
          </h2>
          <p className="text-xl text-gray-600 max-w-3xl mx-auto">
            Real-time GPS tracking, attendance management, and seamless communication 
            between parents, drivers, and administrators.
          </p>
        </div>

        {/* Features Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-16">
          <Card className="text-center">
            <CardHeader>
              <div className="w-16 h-16 bg-primary rounded-full flex items-center justify-center mx-auto mb-4">
                <i className="fas fa-map-marker-alt text-white text-2xl"></i>
              </div>
              <CardTitle>Real-Time Tracking</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                Track your child's bus location in real-time with accurate GPS positioning 
                and estimated arrival times.
              </CardDescription>
            </CardContent>
          </Card>

          <Card className="text-center">
            <CardHeader>
              <div className="w-16 h-16 bg-success rounded-full flex items-center justify-center mx-auto mb-4">
                <i className="fas fa-clipboard-check text-white text-2xl"></i>
              </div>
              <CardTitle>Attendance Management</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                Drivers can easily take attendance and parents receive instant notifications 
                when their child boards the bus.
              </CardDescription>
            </CardContent>
          </Card>

          <Card className="text-center">
            <CardHeader>
              <div className="w-16 h-16 bg-secondary rounded-full flex items-center justify-center mx-auto mb-4">
                <i className="fas fa-users text-white text-2xl"></i>
              </div>
              <CardTitle>Multi-Role Access</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>
                Dedicated interfaces for parents, drivers, and administrators with 
                role-specific features and permissions.
              </CardDescription>
            </CardContent>
          </Card>
        </div>

        {/* Call to Action */}
        <div className="text-center">
          <h3 className="text-2xl font-bold text-gray-900 mb-4">
            Ready to Get Started?
          </h3>
          <p className="text-gray-600 mb-8">
            Sign in to access your personalized dashboard and start tracking your school bus.
          </p>
          <Button 
            size="lg"
            onClick={() => window.location.href = '/auth'}
            className="bg-primary hover:bg-primary/90"
            data-testid="button-get-started"
          >
            Get Started Today
          </Button>
        </div>
      </div>
    </div>
  );
}
