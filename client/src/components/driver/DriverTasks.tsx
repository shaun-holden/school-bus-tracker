import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export default function DriverTasks() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: tasks, isLoading } = useQuery({
    queryKey: ["/api/driver-tasks"],
  });

  const updateTaskMutation = useMutation({
    mutationFn: async ({ taskId, isCompleted }: { taskId: string; isCompleted: boolean }) => {
      await apiRequest("PUT", `/api/driver-tasks/${taskId}/complete`, { isCompleted });
    },
    onSuccess: () => {
      toast({
        title: "Task Updated",
        description: "Task status has been updated.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/driver-tasks"] });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update task. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleTaskChange = (taskId: string, isCompleted: boolean) => {
    updateTaskMutation.mutate({ taskId, isCompleted });
  };

  const getStatusBadge = (isCompleted: boolean, priority: string) => {
    if (isCompleted) {
      return <Badge className="bg-success">Completed</Badge>;
    }
    if (priority === 'high' || priority === 'urgent') {
      return <Badge className="bg-warning">High Priority</Badge>;
    }
    return <Badge variant="secondary">Pending</Badge>;
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="text-center">Loading tasks...</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg font-semibold">Today's Tasks</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {Array.isArray(tasks) && tasks.length > 0 ? (
            tasks.map((task: any) => (
              <div 
                key={task.id}
                className="flex items-center justify-between p-4 border border-gray-200 rounded-lg"
                data-testid={`task-${task.id}`}
              >
                <div className="flex items-center">
                  <Checkbox
                    checked={task.isCompleted}
                    onCheckedChange={(checked) => 
                      handleTaskChange(task.id, checked as boolean)
                    }
                    disabled={updateTaskMutation.isPending}
                    className="mr-3"
                    data-testid={`checkbox-task-${task.id}`}
                  />
                  <div>
                    <div className="font-medium" data-testid={`task-title-${task.id}`}>
                      {task.title}
                    </div>
                    <div className="text-sm text-gray-600" data-testid={`task-description-${task.id}`}>
                      {task.description}
                    </div>
                  </div>
                </div>
                {getStatusBadge(task.isCompleted, task.priority)}
              </div>
            ))
          ) : (
            <div className="text-center text-gray-500 py-8">
              No tasks assigned for today.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
