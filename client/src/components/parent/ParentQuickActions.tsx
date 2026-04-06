import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const absenceSchema = z.object({
  studentId: z.string().min(1, "Please select a student"),
  date: z.string().min(1, "Please select a date"),
  notes: z.string().optional(),
});

export default function ParentQuickActions() {
  const [isAbsenceDialogOpen, setIsAbsenceDialogOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: students } = useQuery({
    queryKey: ["/api/students"],
  });

  const form = useForm<z.infer<typeof absenceSchema>>({
    resolver: zodResolver(absenceSchema),
    defaultValues: {
      studentId: "",
      date: new Date().toISOString().split('T')[0],
      notes: "",
    },
  });

  const reportAbsenceMutation = useMutation({
    mutationFn: async (data: z.infer<typeof absenceSchema>) => {
      await apiRequest(`/api/students/${data.studentId}/absence`, "POST", {
        date: data.date,
        notes: data.notes,
      });
    },
    onSuccess: () => {
      toast({
        title: "Absence Reported",
        description: "Your child's absence has been reported successfully.",
      });
      setIsAbsenceDialogOpen(false);
      form.reset();
      queryClient.invalidateQueries({ queryKey: ["/api/students"] });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: "Failed to report absence. Please try again.",
        variant: "destructive",
      });
    },
  });

  const onSubmitAbsence = (data: z.infer<typeof absenceSchema>) => {
    reportAbsenceMutation.mutate(data);
  };

  const handleEmergencyContact = () => {
    toast({
      title: "Emergency Contact",
      description: "Emergency services have been notified. Please call 911 if immediate assistance is needed.",
      variant: "destructive",
    });
  };

  const studentsList = Array.isArray(students) ? students : [];
  const hasSingleChild = studentsList.length === 1;

  const handleQuickAbsentToday = () => {
    if (hasSingleChild) {
      reportAbsenceMutation.mutate({
        studentId: studentsList[0].id,
        date: new Date().toISOString().split('T')[0],
        notes: "",
      });
    } else {
      setIsAbsenceDialogOpen(true);
      form.setValue("date", new Date().toISOString().split('T')[0]);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg font-semibold">Quick Actions</CardTitle>
      </CardHeader>
      <CardContent>
        {hasSingleChild && (
          <Button
            className="w-full mb-3 bg-warning hover:bg-warning/90 text-white h-12"
            onClick={handleQuickAbsentToday}
            disabled={reportAbsenceMutation.isPending}
            data-testid="button-quick-absent-today"
          >
            <i className="fas fa-user-times mr-2"></i>
            Mark {studentsList[0].firstName} Absent Today
          </Button>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Dialog open={isAbsenceDialogOpen} onOpenChange={setIsAbsenceDialogOpen}>
            <DialogTrigger asChild>
              <Button 
                className="bg-warning hover:bg-warning/90 text-white p-4 h-auto"
                data-testid="button-report-absence"
              >
                <i className="fas fa-user-times mr-2"></i>
                Report Child Absence
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Report Student Absence</DialogTitle>
              </DialogHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmitAbsence)} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="studentId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Student</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger data-testid="select-student">
                              <SelectValue placeholder="Select a student" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {Array.isArray(students) ? students.map((student: any) => (
                              <SelectItem key={student.id} value={student.id}>
                                {student.firstName} {student.lastName}
                              </SelectItem>
                            )) : null}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="date"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Date</FormLabel>
                        <div className="flex gap-2 mb-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="flex-1"
                            onClick={() => field.onChange(new Date().toISOString().split('T')[0])}
                            data-testid="button-absent-today"
                          >
                            Today
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="flex-1"
                            onClick={() => {
                              const tomorrow = new Date();
                              tomorrow.setDate(tomorrow.getDate() + 1);
                              field.onChange(tomorrow.toISOString().split('T')[0]);
                            }}
                            data-testid="button-absent-tomorrow"
                          >
                            Tomorrow
                          </Button>
                        </div>
                        <FormControl>
                          <input
                            type="date"
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
                            {...field}
                            data-testid="input-absence-date"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="notes"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Notes (Optional)</FormLabel>
                        <FormControl>
                          <Textarea 
                            placeholder="Reason for absence..."
                            {...field}
                            data-testid="textarea-absence-notes"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="flex justify-end space-x-2">
                    <Button 
                      type="button" 
                      variant="outline" 
                      onClick={() => setIsAbsenceDialogOpen(false)}
                      data-testid="button-cancel-absence"
                    >
                      Cancel
                    </Button>
                    <Button 
                      type="submit" 
                      disabled={reportAbsenceMutation.isPending}
                      data-testid="button-submit-absence"
                    >
                      {reportAbsenceMutation.isPending ? "Reporting..." : "Report Absence"}
                    </Button>
                  </div>
                </form>
              </Form>
            </DialogContent>
          </Dialog>

          <Button 
            className="bg-destructive hover:bg-destructive/90 text-white p-4 h-auto"
            onClick={handleEmergencyContact}
            data-testid="button-emergency-contact"
          >
            <i className="fas fa-phone-alt mr-2"></i>
            Emergency Contact
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
