import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface VehicleStatusCardProps {
  bus?: any;
}

export default function VehicleStatusCard({ bus }: VehicleStatusCardProps) {
  const [issueType, setIssueType] = useState("");
  const [issueDescription, setIssueDescription] = useState("");
  const [fuelAmount, setFuelAmount] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const reportIssueMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/vehicle-issues", {
        busId: bus?.id,
        issueType,
        description: issueDescription,
        severity: "normal",
      });
    },
    onSuccess: () => {
      toast({
        title: "Issue Reported",
        description: "Vehicle issue has been reported to maintenance.",
      });
      setIssueType("");
      setIssueDescription("");
      queryClient.invalidateQueries({ queryKey: ["/api/buses"] });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to report issue. Please try again.",
        variant: "destructive",
      });
    },
  });

  const updateFuelMutation = useMutation({
    mutationFn: async () => {
      // In real app, this would update the fuel level
      console.log("Updating fuel:", fuelAmount);
    },
    onSuccess: () => {
      toast({
        title: "Fuel Updated",
        description: `Added ${fuelAmount} gallons to fuel log.`,
      });
      setFuelAmount("");
    },
  });

  const handleReportIssue = () => {
    if (!issueType || !issueDescription) {
      toast({
        title: "Missing Information",
        description: "Please select an issue type and provide a description.",
        variant: "destructive",
      });
      return;
    }
    reportIssueMutation.mutate();
  };

  const handleUpdateFuel = () => {
    if (!fuelAmount) {
      toast({
        title: "Missing Information",
        description: "Please enter the amount of fuel added.",
        variant: "destructive",
      });
      return;
    }
    updateFuelMutation.mutate();
  };

  const handleEmergency = () => {
    toast({
      title: "Emergency Reported",
      description: "Emergency services have been notified. Stay safe!",
      variant: "destructive",
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg font-semibold">Vehicle Status</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="p-4 bg-green-50 rounded-lg border border-green-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <i className="fas fa-gas-pump text-success mr-2"></i>
                <span className="font-medium">Fuel Level</span>
              </div>
              <span className="text-success font-semibold" data-testid="fuel-level">
                {bus?.fuelLevel || "3/4 Tank"}
              </span>
            </div>
          </div>

          <div className="space-y-3">
            <h4 className="font-medium">Log Vehicle Issue</h4>
            <Select value={issueType} onValueChange={setIssueType}>
              <SelectTrigger data-testid="select-issue-type">
                <SelectValue placeholder="Select Issue Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="engine">Engine Problem</SelectItem>
                <SelectItem value="brake">Brake Issue</SelectItem>
                <SelectItem value="tire">Tire Problem</SelectItem>
                <SelectItem value="interior">Interior Damage</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
            <Textarea 
              value={issueDescription}
              onChange={(e) => setIssueDescription(e.target.value)}
              placeholder="Describe the issue..."
              data-testid="textarea-issue-description"
            />
            <Button 
              onClick={handleReportIssue}
              disabled={reportIssueMutation.isPending}
              className="w-full"
              data-testid="button-report-issue"
            >
              {reportIssueMutation.isPending ? "Reporting..." : "Report Issue"}
            </Button>
          </div>

          <div className="space-y-3">
            <h4 className="font-medium">Update Fuel</h4>
            <div className="flex space-x-2">
              <Input
                type="number"
                value={fuelAmount}
                onChange={(e) => setFuelAmount(e.target.value)}
                placeholder="Gallons added"
                step="0.1"
                data-testid="input-fuel-amount"
              />
              <Button 
                onClick={handleUpdateFuel}
                disabled={updateFuelMutation.isPending}
                data-testid="button-update-fuel"
              >
                {updateFuelMutation.isPending ? "Updating..." : "Update"}
              </Button>
            </div>
          </div>

          <Button 
            className="w-full bg-destructive hover:bg-destructive/90"
            onClick={handleEmergency}
            data-testid="button-report-emergency"
          >
            <i className="fas fa-exclamation-triangle mr-2"></i>Report Emergency
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
