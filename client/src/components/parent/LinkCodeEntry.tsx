import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Link, UserPlus, CheckCircle } from "lucide-react";

export function LinkCodeEntry() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [success, setSuccess] = useState(false);
  const [linkedStudent, setLinkedStudent] = useState<string | null>(null);

  const linkMutation = useMutation({
    mutationFn: async (linkCode: string) => {
      return await apiRequest('/api/link-child', 'POST', { code: linkCode.toUpperCase().trim() });
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/students'] });
      setSuccess(true);
      setLinkedStudent(data.student ? `${data.student.firstName} ${data.student.lastName}` : 'your child');
      toast({ 
        title: "Successfully linked!", 
        description: `You are now connected to ${data.student ? `${data.student.firstName} ${data.student.lastName}` : 'your child'}'s account.`
      });
    },
    onError: (error: any) => {
      const message = error.message || "Failed to use link code";
      let description = "Please check the code and try again.";
      
      if (message.includes("expired")) {
        description = "This code has expired. Please request a new one from your administrator.";
      } else if (message.includes("used") || message.includes("max")) {
        description = "This code has already been used the maximum number of times.";
      } else if (message.includes("not found") || message.includes("invalid")) {
        description = "This code was not found. Please check for typos.";
      } else if (message.includes("already linked")) {
        description = "You are already linked to this child's account.";
      }
      
      toast({ 
        title: "Link failed", 
        description,
        variant: "destructive" 
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (code.trim()) {
      linkMutation.mutate(code);
    }
  };

  const handleClose = () => {
    setOpen(false);
    setCode("");
    setSuccess(false);
    setLinkedStudent(null);
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => {
      if (!isOpen) handleClose();
      else setOpen(true);
    }}>
      <DialogTrigger asChild>
        <Card className="cursor-pointer hover:shadow-md transition-shadow border-dashed border-2 border-orange-200 bg-orange-50/50">
          <CardContent className="flex items-center justify-center py-8">
            <div className="text-center">
              <div className="mx-auto w-12 h-12 bg-orange-100 rounded-full flex items-center justify-center mb-3">
                <UserPlus className="w-6 h-6 text-orange-600" />
              </div>
              <h3 className="font-semibold text-lg text-gray-800">Add a Child</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Enter a link code from your school
              </p>
            </div>
          </CardContent>
        </Card>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2">
            <Link className="w-5 h-5 text-orange-600" />
            <span>Link to Your Child</span>
          </DialogTitle>
          <DialogDescription>
            Enter the linking code provided by your school administrator to connect to your child's transportation account.
          </DialogDescription>
        </DialogHeader>
        
        {success ? (
          <div className="text-center py-6">
            <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
              <CheckCircle className="w-8 h-8 text-green-600" />
            </div>
            <h3 className="font-semibold text-lg">Successfully Linked!</h3>
            <p className="text-muted-foreground mt-2">
              You are now connected to {linkedStudent}'s account. You can view their bus tracking information on your dashboard.
            </p>
            <Button onClick={handleClose} className="mt-4" data-testid="button-done">
              Done
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="link-code">Link Code</Label>
              <Input
                id="link-code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="e.g., TNT-483921"
                className="text-center font-mono text-lg tracking-wider"
                maxLength={15}
                disabled={linkMutation.isPending}
                data-testid="input-link-code"
              />
              <p className="text-xs text-muted-foreground">
                The code format is usually like: ABC-123456
              </p>
            </div>
            
            <div className="flex space-x-3">
              <Button 
                type="button" 
                variant="outline" 
                className="flex-1"
                onClick={handleClose}
                disabled={linkMutation.isPending}
              >
                Cancel
              </Button>
              <Button 
                type="submit" 
                className="flex-1"
                disabled={!code.trim() || linkMutation.isPending}
                data-testid="button-submit-link-code"
              >
                {linkMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Linking...
                  </>
                ) : (
                  <>
                    <Link className="w-4 h-4 mr-2" />
                    Link Account
                  </>
                )}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
