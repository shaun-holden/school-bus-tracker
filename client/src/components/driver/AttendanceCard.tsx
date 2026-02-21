import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export default function AttendanceCard() {
  const [attendance, setAttendance] = useState<{[key: string]: boolean}>({});
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Mock current stop students - in real app this would be based on current route position
  const mockStudents = [
    { id: "1", firstName: "Michael", lastName: "Johnson", grade: "Grade 3", isAbsent: false },
    { id: "2", firstName: "Sarah", lastName: "Williams", grade: "Grade 6", isAbsent: false },
    { id: "3", firstName: "Alex", lastName: "Chen", grade: "Grade 4", isAbsent: true },
  ];

  const completeStopMutation = useMutation({
    mutationFn: async () => {
      // In real app, this would submit attendance for all students at current stop
      const attendancePromises = Object.entries(attendance).map(([studentId, isPresent]) =>
        apiRequest("POST", "/api/attendance", {
          studentId,
          routeId: "mock-route-id",
          date: new Date(),
          isPresent,
          pickupTime: isPresent ? new Date() : null,
        })
      );
      await Promise.all(attendancePromises);
    },
    onSuccess: () => {
      toast({
        title: "Stop Completed",
        description: "Attendance has been recorded for this stop.",
      });
      setAttendance({});
      queryClient.invalidateQueries({ queryKey: ["/api/attendance"] });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to record attendance. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleAttendanceChange = (studentId: string, isPresent: boolean) => {
    setAttendance(prev => ({
      ...prev,
      [studentId]: isPresent
    }));
  };

  const handleCompleteStop = () => {
    completeStopMutation.mutate();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg font-semibold">
          Student Attendance - Roosevelt Middle
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {mockStudents.map((student) => (
            <div 
              key={student.id}
              className={`flex items-center justify-between p-3 rounded-lg ${
                student.isAbsent ? 'bg-red-50 border border-red-200' : 'bg-gray-50'
              }`}
              data-testid={`attendance-student-${student.id}`}
            >
              <div className="flex items-center">
                <div className="w-8 h-8 bg-gray-300 rounded-full mr-3"></div>
                <div>
                  <div className="font-medium" data-testid={`student-name-${student.id}`}>
                    {student.firstName} {student.lastName}
                  </div>
                  <div className="text-sm text-gray-600" data-testid={`student-grade-${student.id}`}>
                    {student.grade}
                  </div>
                </div>
              </div>
              {student.isAbsent ? (
                <div className="text-sm text-destructive font-medium">
                  <i className="fas fa-user-times mr-1"></i>Absent Today
                </div>
              ) : (
                <label className="flex items-center">
                  <Checkbox
                    checked={attendance[student.id] || false}
                    onCheckedChange={(checked) => 
                      handleAttendanceChange(student.id, checked as boolean)
                    }
                    data-testid={`checkbox-present-${student.id}`}
                  />
                  <span className="ml-2 text-sm">Present</span>
                </label>
              )}
            </div>
          ))}
        </div>
        <Button 
          className="w-full mt-4 bg-success hover:bg-success/90"
          onClick={handleCompleteStop}
          disabled={completeStopMutation.isPending}
          data-testid="button-complete-stop"
        >
          {completeStopMutation.isPending ? "Recording..." : "Complete Stop"}
        </Button>
      </CardContent>
    </Card>
  );
}
