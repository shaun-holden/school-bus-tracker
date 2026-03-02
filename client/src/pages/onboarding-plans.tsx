import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Check, Loader2, ArrowRight } from "lucide-react";

interface SubscriptionPlan {
  id: string;
  productId: string;
  name: string;
  description: string;
  amount: number;
  currency: string;
  interval: string;
  intervalCount: number;
  features: string[];
}

export default function OnboardingPlans() {
  const { user, isAuthenticated } = useAuth();
  const { toast } = useToast();
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);

  const { data: plans = [], isLoading } = useQuery<SubscriptionPlan[]>({
    queryKey: ['/api/subscription-plans'],
  });

  const checkoutMutation = useMutation({
    mutationFn: (priceId: string) =>
      apiRequest('/api/business/create-checkout-session', 'POST', { priceId }),
    onSuccess: (data: { url: string }) => {
      if (data.url) {
        window.location.href = data.url;
      }
    },
    onError: (error: Error) => {
      toast({ title: error.message || "Failed to start checkout", variant: "destructive" });
    },
  });

  const formatPrice = (amount: number, currency: string) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(amount / 100);
  };

  const handleSelectPlan = (priceId: string) => {
    if (!isAuthenticated) {
      window.location.href = '/auth?redirect=/onboarding/plans';
      return;
    }
    setSelectedPlan(priceId);
    checkoutMutation.mutate(priceId);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-12 px-4">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-12">
          <h1 className="text-3xl font-bold text-gray-900 mb-4" data-testid="text-page-title">
            Choose Your Plan
          </h1>
          <p className="text-lg text-gray-600">
            Select the plan that best fits your transportation needs
          </p>
          <div className="mt-4 inline-flex items-center gap-2 bg-green-100 text-green-800 px-4 py-2 rounded-full">
            <Check className="w-5 h-5" />
            <span className="font-semibold">30-day free trial on all plans - No credit card required to start!</span>
          </div>
        </div>

        {plans.length === 0 ? (
          <Card className="max-w-md mx-auto">
            <CardContent className="py-12 text-center">
              <p className="text-gray-500" data-testid="text-no-plans">
                No subscription plans available at this time.
              </p>
              <p className="text-sm text-gray-400 mt-2">
                Please contact support for assistance.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid md:grid-cols-3 gap-6">
            {plans.map((plan, index) => {
              const isPopular = index === 1;
              return (
                <Card 
                  key={plan.id} 
                  className={`relative ${isPopular ? 'border-blue-500 border-2 shadow-lg' : ''}`}
                  data-testid={`card-plan-${plan.id}`}
                >
                  {isPopular && (
                    <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-blue-500">
                      Most Popular
                    </Badge>
                  )}
                  <CardHeader>
                    <CardTitle data-testid={`text-plan-name-${plan.id}`}>{plan.name}</CardTitle>
                    <CardDescription>{plan.description}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="mb-6">
                      <span className="text-4xl font-bold" data-testid={`text-plan-price-${plan.id}`}>
                        {formatPrice(plan.amount, plan.currency)}
                      </span>
                      <span className="text-gray-500">/{plan.interval}</span>
                    </div>
                    
                    {plan.features.length > 0 && (
                      <ul className="space-y-3">
                        {plan.features.map((feature, i) => (
                          <li key={i} className="flex items-center text-sm">
                            <Check className="w-4 h-4 text-green-500 mr-2 flex-shrink-0" />
                            <span>{feature}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                  <CardFooter>
                    <Button
                      className="w-full"
                      variant={isPopular ? "default" : "outline"}
                      onClick={() => handleSelectPlan(plan.id)}
                      disabled={checkoutMutation.isPending}
                      data-testid={`button-select-${plan.id}`}
                    >
                      {checkoutMutation.isPending && selectedPlan === plan.id ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Redirecting...
                        </>
                      ) : (
                        <>
                          Start 30-Day Free Trial
                          <ArrowRight className="w-4 h-4 ml-2" />
                        </>
                      )}
                    </Button>
                  </CardFooter>
                </Card>
              );
            })}
          </div>
        )}

        <div className="mt-12 text-center text-sm text-gray-500">
          <p className="font-medium text-gray-700">All plans include a 30-day free trial. Cancel anytime before your trial ends.</p>
          <p className="mt-2">
            Need a custom plan?{" "}
            <a href="mailto:sales@example.com" className="text-blue-600 hover:underline">
              Contact our sales team
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
