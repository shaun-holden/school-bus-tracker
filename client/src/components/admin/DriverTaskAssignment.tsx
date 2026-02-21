import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const taskSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().min(1, "Description is required"),
  assignedToId: z.string().min(1, "Please select a driver"),
  priority: z.string().default("normal"),
});

export default function DriverTaskAssignment() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const form = useForm<z.infer<typeof taskSchema>>({
    resolver: zodResolver(taskSchema),
    defaultValues: {
      title: "",
      description: "",
      assignedToId: "",
      priority: "normal",
    },
  });

  const { data: activeTasks } = useQuery({
    queryKey: ["/api/driver-tasks"],
  });

  // Mock drivers data - in real app this would come from API
  const mockDrivers = [
    { id: "driver1", name: "Robert Davis", busNumber: "A3" },
    { id: "driver2", name: "Maria Garcia", busNumber: "B1" },
    { id: "driver3", name: "John Smith", busNumber: "C2" },
  ];

  const createTaskMutation = useMutation({
    mutationFn: async (data: z.infer<typeof taskSchema>) => {
      await apiRequest("POST", "/api/driver-tasks", data);
    },
    onSuccess: () => {
      toast({
        title: "Task Created",
        description: "Driver task has been assigned successfully.",
      });
      form.reset();
      queryClient.invalidateQueries({ queryKey: ["/api/driver-tasks"] });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to create task. Please try again.",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: z.infer<typeof taskSchema>) => {
    createTaskMutation.mutate(data);
  };

  const getStatusBadge = (isCompleted: boolean, priority: string) => {
    if (isCompleted) {
      return <Badge className="bg-success">Completed</Badge>;
    }
    if (priority === 'high' || priority === 'urgent') {
      return <Badge className="bg-secondary">High Priority</Badge>;
    }
    return <Badge className="bg-warning">In Progress</Badge>;
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'urgent':
        return 'bg-red-50 border-red-200';
      case 'high':
        return 'bg-orange-50 border-orange-200';
      default:
        return 'bg-gray-50 border-gray-200';
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-semibold">Driver Task Assignment</CardTitle>
          <Button 
            className="bg-purple-600 hover:bg-purple-700 text-white"
            onClick={() => form.reset()}
            data-testid="button-create-task"
          >
            <i className="fas fa-plus mr-2"></i>Create Task
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Task Creation Form */}
          <div className="space-y-4">
            <h4 className="font-medium">New Task</h4>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="title"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Task Title</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="Enter task title"
                          {...field}
                          data-testid="input-task-title"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description</FormLabel>
                      <FormControl>
                        <Textarea 
                          placeholder="Task description"
                          rows={3}
                          {...field}
                          data-testid="textarea-task-description"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="assignedToId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Assign to Driver</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-driver">
                            <SelectValue placeholder="Select Driver" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {mockDrivers.map((driver) => (
                            <SelectItem key={driver.id} value={driver.id}>
                              {driver.name} - Bus {driver.busNumber}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="priority"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Priority</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-priority">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="normal">Normal</SelectItem>
                          <SelectItem value="high">High</SelectItem>
                          <SelectItem value="urgent">Urgent</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Button 
                  type="submit"
                  className="w-full bg-purple-600 hover:bg-purple-700"
                  disabled={createTaskMutation.isPending}
                  data-testid="button-assign-task"
                >
                  {createTaskMutation.isPending ? "Assigning..." : "Assign Task"}
                </Button>
              </form>
            </Form>
          </div>

          {/* Active Tasks List */}
          <div className="space-y-4">
            <h4 className="font-medium">Active Tasks</h4>
            <div className="space-y-3 max-h-80 overflow-y-auto">
              {Array.isArray(activeTasks) && activeTasks.length > 0 ? (
                activeTasks.map((task: any) => (
                  <div 
                    key={task.id}
                    className={`p-3 border rounded-lg ${getPriorityColor(task.priority)}`}
                    data-testid={`active-task-${task.id}`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="font-medium" data-testid={`task-title-${task.id}`}>
                          {task.title}
                        </div>
                        <div className="text-sm text-gray-600" data-testid={`task-assigned-to-${task.id}`}>
                          Assigned to: {mockDrivers.find(d => d.id === task.assignedToId)?.name || 'Unknown Driver'}
                        </div>
                        <div className="text-sm text-gray-600 mt-1" data-testid={`task-description-${task.id}`}>
                          {task.description}
                        </div>
                      </div>
                      <div className="flex flex-col items-end">
                        {getStatusBadge(task.isCompleted, task.priority)}
                        <span className="text-xs text-gray-500 mt-1" data-testid={`task-due-date-${task.id}`}>
                          {task.dueDate ? 
                            `Due: ${new Date(task.dueDate).toLocaleDateString()}` : 
                            'Due: Today'
                          }
                        </span>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center text-gray-500 py-8">
                  No active tasks found.
                </div>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
