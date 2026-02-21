import { useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Clock, CheckCircle, XCircle, AlertTriangle, Mail, Phone, Loader2 } from "lucide-react";

interface BusinessStatus {
  status: string;
  billingStatus: string;
  isActive: boolean;
  hasPayment: boolean;
}

export default function OnboardingPending() {
  const [, navigate] = useLocation();
  const { user, logout } = useAuth();

  const { data: status, isLoading, refetch } = useQuery<BusinessStatus>({
    queryKey: ['/api/business/status'],
    refetchInterval: 10000,
  });

  useEffect(() => {
    if (status?.status === 'approved' && status?.isActive) {
      navigate('/');
    }
  }, [status, navigate]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  const getStatusInfo = () => {
    switch (status?.status) {
      case 'pending_approval':
        return {
          icon: <Clock className="w-12 h-12 text-yellow-500" />,
          title: 'Application Under Review',
          description: 'Our team is reviewing your application. This typically takes 1-2 business days.',
          badge: <Badge className="bg-yellow-100 text-yellow-800">Pending Review</Badge>,
          color: 'yellow',
        };
      case 'approved':
        return {
          icon: <CheckCircle className="w-12 h-12 text-green-500" />,
          title: 'Application Approved!',
          description: 'Your account has been approved. You can now access the dashboard.',
          badge: <Badge className="bg-green-100 text-green-800">Approved</Badge>,
          color: 'green',
        };
      case 'rejected':
        return {
          icon: <XCircle className="w-12 h-12 text-red-500" />,
          title: 'Application Rejected',
          description: 'Unfortunately, your application was not approved. Please contact support for more information.',
          badge: <Badge className="bg-red-100 text-red-800">Rejected</Badge>,
          color: 'red',
        };
      case 'suspended':
        return {
          icon: <AlertTriangle className="w-12 h-12 text-orange-500" />,
          title: 'Account Suspended',
          description: 'Your account has been suspended. Please contact support for assistance.',
          badge: <Badge className="bg-orange-100 text-orange-800">Suspended</Badge>,
          color: 'orange',
        };
      default:
        return {
          icon: <Clock className="w-12 h-12 text-gray-500" />,
          title: 'Status Unknown',
          description: 'We could not determine your application status. Please try again later.',
          badge: <Badge>Unknown</Badge>,
          color: 'gray',
        };
    }
  };

  const statusInfo = getStatusInfo();

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-lg mx-auto">
        <Card>
          <CardHeader className="text-center">
            <div className="mx-auto mb-4">
              {statusInfo.icon}
            </div>
            <div className="flex justify-center mb-2">
              {statusInfo.badge}
            </div>
            <CardTitle className="text-2xl" data-testid="text-page-title">
              {statusInfo.title}
            </CardTitle>
            <CardDescription>
              {statusInfo.description}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {status?.status === 'pending_approval' && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h3 className="font-medium text-blue-800 mb-2">What happens next?</h3>
                <ul className="text-sm text-blue-700 space-y-2">
                  <li className="flex items-start">
                    <span className="mr-2">1.</span>
                    Our team reviews your business information
                  </li>
                  <li className="flex items-start">
                    <span className="mr-2">2.</span>
                    We verify your company details
                  </li>
                  <li className="flex items-start">
                    <span className="mr-2">3.</span>
                    You'll receive an email when approved
                  </li>
                  <li className="flex items-start">
                    <span className="mr-2">4.</span>
                    You can then access your dashboard
                  </li>
                </ul>
              </div>
            )}

            {status?.status === 'approved' && (
              <Button 
                className="w-full" 
                onClick={() => navigate('/')}
                data-testid="button-go-dashboard"
              >
                Go to Dashboard
              </Button>
            )}

            {!status?.hasPayment && status?.status !== 'rejected' && (
              <Button 
                variant="outline" 
                className="w-full"
                onClick={() => navigate('/onboarding/plans')}
                data-testid="button-select-plan"
              >
                Select a Plan
              </Button>
            )}

            <div className="border-t pt-6">
              <h3 className="font-medium text-gray-800 mb-3">Need Help?</h3>
              <div className="space-y-2 text-sm text-gray-600">
                <a 
                  href="mailto:support@example.com" 
                  className="flex items-center hover:text-blue-600"
                  data-testid="link-email-support"
                >
                  <Mail className="w-4 h-4 mr-2" />
                  support@example.com
                </a>
                <a 
                  href="tel:+15550000000" 
                  className="flex items-center hover:text-blue-600"
                  data-testid="link-phone-support"
                >
                  <Phone className="w-4 h-4 mr-2" />
                  +1 (555) 000-0000
                </a>
              </div>
            </div>

            <div className="flex justify-between pt-4 border-t">
              <Button 
                variant="ghost" 
                size="sm"
                onClick={() => refetch()}
                data-testid="button-refresh"
              >
                Refresh Status
              </Button>
              <Button 
                variant="ghost" 
                size="sm"
                onClick={() => logout()}
                data-testid="button-logout"
              >
                Sign Out
              </Button>
            </div>
          </CardContent>
        </Card>

        {user && (
          <p className="text-center text-sm text-gray-500 mt-4" data-testid="text-user-email">
            Logged in as {user.email}
          </p>
        )}
      </div>
    </div>
  );
}
