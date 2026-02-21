import { useState, useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Bus, CheckCircle, AlertCircle } from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

const passwordSetupSchema = z.object({
  password: z.string().min(8, "Password must be at least 8 characters"),
  confirmPassword: z.string().min(1, "Please confirm your password"),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

type PasswordSetupFormValues = z.infer<typeof passwordSetupSchema>;

interface InvitationVerifyResponse {
  valid: boolean;
  email: string;
  firstName?: string;
  lastName?: string;
}

export default function DriverPasswordSetupPage() {
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const searchParams = new URLSearchParams(searchString);
  const token = searchParams.get("token");
  const [setupSuccess, setSetupSuccess] = useState(false);
  const { toast } = useToast();

  const { data: invitationData, isLoading: isVerifying, error: verifyError } = useQuery<InvitationVerifyResponse>({
    queryKey: ['/api/driver-invitation/verify', token],
    queryFn: async () => {
      if (!token) throw new Error("No token provided");
      const response = await fetch(`/api/driver-invitation/verify?token=${encodeURIComponent(token)}`);
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || "Invalid or expired invitation");
      }
      return response.json();
    },
    enabled: !!token,
    retry: false,
  });

  const form = useForm<PasswordSetupFormValues>({
    resolver: zodResolver(passwordSetupSchema),
    defaultValues: {
      password: "",
      confirmPassword: "",
    },
  });

  const setupPasswordMutation = useMutation({
    mutationFn: async (data: { token: string; password: string }) => {
      return await apiRequest("/api/driver-invitation/complete", "POST", data);
    },
    onSuccess: () => {
      setSetupSuccess(true);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to set up password",
        variant: "destructive",
      });
    },
  });

  function onSubmit(values: PasswordSetupFormValues) {
    if (!token) {
      toast({
        title: "Error",
        description: "Invalid setup link",
        variant: "destructive",
      });
      return;
    }
    setupPasswordMutation.mutate({ token, password: values.password });
  }

  if (!token) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-orange-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
              <div className="bg-red-500 p-3 rounded-full">
                <AlertCircle className="h-8 w-8 text-white" />
              </div>
            </div>
            <CardTitle className="text-2xl">Invalid Link</CardTitle>
            <CardDescription>
              This password setup link is invalid.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <p className="text-sm text-gray-500 mb-4">
              Please contact your administrator for a new invitation.
            </p>
            <Button onClick={() => setLocation("/auth")}>
              Go to Login
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isVerifying) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-orange-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
              <div className="bg-orange-500 p-3 rounded-full">
                <Bus className="h-8 w-8 text-white" />
              </div>
            </div>
            <CardTitle className="text-2xl">Verifying Invitation</CardTitle>
          </CardHeader>
          <CardContent className="flex justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (verifyError || !invitationData?.valid) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-orange-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
              <div className="bg-red-500 p-3 rounded-full">
                <AlertCircle className="h-8 w-8 text-white" />
              </div>
            </div>
            <CardTitle className="text-2xl">Invalid or Expired Link</CardTitle>
            <CardDescription>
              {(verifyError as Error)?.message || "This invitation link is invalid or has expired."}
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <p className="text-sm text-gray-500 mb-4">
              Please contact your administrator for a new invitation.
            </p>
            <Button onClick={() => setLocation("/auth")}>
              Go to Login
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (setupSuccess) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-orange-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
              <div className="bg-green-500 p-3 rounded-full">
                <CheckCircle className="h-8 w-8 text-white" />
              </div>
            </div>
            <CardTitle className="text-2xl">Password Set Up!</CardTitle>
            <CardDescription>
              Your driver account is now ready. You can log in with your email and password.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <Button onClick={() => setLocation("/auth")} className="w-full">
              Sign In
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const driverName = [invitationData?.firstName, invitationData?.lastName].filter(Boolean).join(' ') || 'Driver';

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-orange-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <div className="bg-orange-500 p-3 rounded-full">
              <Bus className="h-8 w-8 text-white" />
            </div>
          </div>
          <CardTitle className="text-2xl">Welcome, {driverName}!</CardTitle>
          <CardDescription>
            Set up your password to complete your driver account registration.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-4 p-3 bg-gray-50 rounded-lg">
            <p className="text-sm text-gray-600">
              <span className="font-medium">Email:</span> {invitationData?.email}
            </p>
          </div>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <Input 
                        type="password" 
                        placeholder="At least 8 characters"
                        {...field} 
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="confirmPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Confirm Password</FormLabel>
                    <FormControl>
                      <Input 
                        type="password" 
                        placeholder="Confirm your password"
                        {...field} 
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button 
                type="submit" 
                className="w-full" 
                disabled={setupPasswordMutation.isPending}
              >
                {setupPasswordMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Setting Up...
                  </>
                ) : (
                  "Set Up Password"
                )}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
