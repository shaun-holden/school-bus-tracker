import { useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle, Clock, Loader2 } from "lucide-react";

interface BusinessStatus {
  status: string;
  billingStatus: string;
  isActive: boolean;
  hasPayment: boolean;
}

export default function OnboardingSuccess() {
  const [, navigate] = useLocation();

  const { data: status, isLoading } = useQuery<BusinessStatus>({
    queryKey: ['/api/business/status'],
    refetchInterval: 5000,
  });

  useEffect(() => {
    if (status?.status === 'approved' && status?.isActive) {
      navigate('/');
    }
  }, [status, navigate]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-green-50 to-emerald-100">
        <Loader2 className="w-8 h-8 animate-spin text-green-500" />
      </div>
    );
  }

  const isPending = status?.status === 'pending_approval';
  const isApproved = status?.status === 'approved';

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-emerald-100 flex items-center justify-center p-4">
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <div className="mx-auto mb-4 w-16 h-16 rounded-full flex items-center justify-center bg-green-100">
            <CheckCircle className="w-10 h-10 text-green-600" />
          </div>
          <CardTitle className="text-2xl" data-testid="text-page-title">
            Payment Successful!
          </CardTitle>
          <CardDescription>
            Thank you for your subscription
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-gray-600">
            Your payment has been processed successfully. 
            {isPending && " Your account is now pending approval."}
            {isApproved && " Your account is now active!"}
          </p>

          {isPending && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <div className="flex items-center justify-center mb-2">
                <Clock className="w-5 h-5 text-yellow-600 mr-2" />
                <span className="font-medium text-yellow-800">Pending Approval</span>
              </div>
              <p className="text-sm text-yellow-700">
                Our team is reviewing your application. You'll receive an email once your account is approved.
              </p>
            </div>
          )}

          {isApproved && (
            <Button 
              onClick={() => navigate('/')} 
              className="w-full"
              data-testid="button-go-dashboard"
            >
              Go to Dashboard
            </Button>
          )}

          {isPending && (
            <Button 
              variant="outline" 
              onClick={() => navigate('/onboarding/pending')}
              className="w-full"
              data-testid="button-view-status"
            >
              View Application Status
            </Button>
          )}

          <p className="text-xs text-gray-500">
            A confirmation email has been sent to your registered email address.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
