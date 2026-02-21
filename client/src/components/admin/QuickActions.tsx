import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

export default function QuickActions() {
  const { toast } = useToast();

  const handleAction = (action: string) => {
    toast({
      title: "Feature Coming Soon",
      description: `${action} functionality will be available in a future update.`,
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg font-semibold">Quick Actions</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <Button 
            className="w-full bg-primary hover:bg-primary/90 p-3 h-auto"
            onClick={() => handleAction("Add Student")}
            data-testid="button-add-student"
          >
            <i className="fas fa-user-plus mr-2"></i>Add Student
          </Button>
          <Button 
            className="w-full bg-secondary hover:bg-secondary/90 text-white p-3 h-auto"
            onClick={() => handleAction("Create Route")}
            data-testid="button-create-route"
          >
            <i className="fas fa-route mr-2"></i>Create Route
          </Button>
          <Button 
            className="w-full bg-success hover:bg-success/90 p-3 h-auto"
            onClick={() => handleAction("Assign Driver")}
            data-testid="button-assign-driver"
          >
            <i className="fas fa-id-badge mr-2"></i>Assign Driver
          </Button>
          <Button 
            className="w-full bg-purple-600 hover:bg-purple-700 text-white p-3 h-auto"
            onClick={() => handleAction("Add Task")}
            data-testid="button-add-task"
          >
            <i className="fas fa-tasks mr-2"></i>Add Task
          </Button>
          <Button 
            className="w-full bg-gray-600 hover:bg-gray-700 text-white p-3 h-auto"
            onClick={() => handleAction("Generate Report")}
            data-testid="button-generate-report"
          >
            <i className="fas fa-chart-bar mr-2"></i>Generate Report
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
