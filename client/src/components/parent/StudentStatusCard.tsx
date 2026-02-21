import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Clock, Bus, CheckCircle2, X, UserCheck, UserX, ChevronDown } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface StudentStatusCardProps {
  student: any;
}

interface CheckInStatus {
  id: string;
  studentId: string;
  status: "waiting" | "boarded" | "dropped_off";
  boardedAt: string | null;
  droppedOffAt: string | null;
}

interface AttendanceRecord {
  id: string;
  studentId: string;
  status: "present" | "absent";
  attendanceDate: string;
}

export default function StudentStatusCard({ student }: StudentStatusCardProps) {
  const { toast } = useToast();
  
  const { data: checkInStatuses = [] } = useQuery<CheckInStatus[]>({
    queryKey: ["/api/check-in/status"],
    refetchInterval: 10000,
  });

  const { data: attendanceRecords = [] } = useQuery<AttendanceRecord[]>({
    queryKey: ["/api/parent/children-attendance"],
    refetchInterval: 10000,
  });

  const studentCheckIn = checkInStatuses.find(s => s.studentId === student.id);
  const studentAttendance = attendanceRecords.find(a => a.studentId === student.id);

  const disableCheckInMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("/api/check-in/disable", "POST", { studentId: student.id });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/check-in/status"] });
      toast({
        title: "Check-in Reset",
        description: `Check-in status has been reset for ${student.firstName}.`,
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to reset check-in status.",
        variant: "destructive",
      });
    },
  });

  const setCheckInStatusMutation = useMutation({
    mutationFn: async (status: string) => {
      return await apiRequest("/api/parent/set-check-in", "POST", { 
        studentId: student.id, 
        status 
      });
    },
    onSuccess: (_, status) => {
      queryClient.invalidateQueries({ queryKey: ["/api/check-in/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/parent/children-attendance"] });
      toast({
        title: "Status Updated",
        description: status === "riding" 
          ? `${student.firstName} is marked as riding the bus today.`
          : `${student.firstName} is marked as not riding the bus today.`,
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update check-in status.",
        variant: "destructive",
      });
    },
  });

  const handleCheckInChange = (value: string) => {
    if (value === "clear") {
      disableCheckInMutation.mutate();
    } else {
      setCheckInStatusMutation.mutate(value);
    }
  };

  const getCurrentCheckInValue = () => {
    if (studentAttendance) {
      return studentAttendance.status === "present" ? "riding" : "not_riding";
    }
    if (studentCheckIn) {
      return studentCheckIn.status === "waiting" ? "riding" : undefined;
    }
    return undefined;
  };

  const getStatusBadge = () => {
    // Priority: Driver-marked attendance takes precedence
    if (studentAttendance) {
      if (studentAttendance.status === "present") {
        return (
          <Badge className="bg-green-100 text-green-800 border-green-300">
            <UserCheck className="w-3 h-3 mr-1" />
            Present
          </Badge>
        );
      } else if (studentAttendance.status === "absent") {
        return (
          <Badge className="bg-red-100 text-red-800 border-red-300">
            <UserX className="w-3 h-3 mr-1" />
            Absent
          </Badge>
        );
      }
    }

    // Fall back to check-in status if no driver attendance
    if (!studentCheckIn) {
      return (
        <Badge variant="secondary" className="bg-gray-100 text-gray-600">
          <Clock className="w-3 h-3 mr-1" />
          Not Checked In
        </Badge>
      );
    }

    switch (studentCheckIn.status) {
      case "boarded":
        return (
          <Badge className="bg-green-100 text-green-800 border-green-300">
            <Bus className="w-3 h-3 mr-1" />
            On Bus
          </Badge>
        );
      case "waiting":
        return (
          <Badge className="bg-yellow-100 text-yellow-800 border-yellow-300">
            <Clock className="w-3 h-3 mr-1" />
            Waiting
          </Badge>
        );
      case "dropped_off":
        return (
          <Badge className="bg-blue-100 text-blue-800 border-blue-300">
            <CheckCircle2 className="w-3 h-3 mr-1" />
            Arrived
          </Badge>
        );
      default:
        return (
          <Badge variant="secondary" className="bg-gray-100 text-gray-600">
            <Clock className="w-3 h-3 mr-1" />
            Not Checked In
          </Badge>
        );
    }
  };

  return (
    <Card data-testid={`card-student-${student.id}`}>
      <CardContent className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center">
            <div className="w-10 h-10 bg-gray-300 rounded-full mr-3"></div>
            <div>
              <h4 className="font-semibold" data-testid={`text-student-name-${student.id}`}>
                {student.firstName} {student.lastName}
              </h4>
              <p className="text-sm text-gray-600" data-testid={`text-student-grade-${student.id}`}>
                {student.grade ? `Grade ${student.grade}` : 'No grade assigned'}
              </p>
            </div>
          </div>
          <div className="text-right flex items-center gap-2">
            {getStatusBadge()}
            {studentCheckIn && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => disableCheckInMutation.mutate()}
                disabled={disableCheckInMutation.isPending}
                title="Reset check-in status"
                className="h-6 w-6 p-0 text-gray-400 hover:text-red-500"
              >
                <X className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>
        {/* Bus Check-in Dropdown */}
        <div className="mb-4 p-3 bg-blue-50 rounded-lg border border-blue-100">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-blue-900">Bus Check-in</span>
            <Select
              value={getCurrentCheckInValue()}
              onValueChange={handleCheckInChange}
              disabled={setCheckInStatusMutation.isPending || disableCheckInMutation.isPending}
            >
              <SelectTrigger className="w-[160px] h-8 text-sm">
                <SelectValue placeholder="Select status..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="riding">Riding Today</SelectItem>
                <SelectItem value="not_riding">Not Riding Today</SelectItem>
                <SelectItem value="clear">Clear Status</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-600">School:</span>
            <span className="font-medium" data-testid={`text-school-${student.id}`}>
              {student.school?.name || 'School not assigned'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">Route:</span>
            <span className="font-medium" data-testid={`text-route-${student.id}`}>
              {student.route?.name || 'Route not assigned'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">Bus:</span>
            <span className="font-medium" data-testid={`text-bus-${student.id}`}>
              {student.bus?.busNumber ? `#${student.bus.busNumber}` : 'Bus not assigned'}
            </span>
          </div>
          {student.stop?.name && (
            <div className="flex justify-between">
              <span className="text-gray-600">Stop:</span>
              <span className="font-medium" data-testid={`text-stop-${student.id}`}>
                {student.stop.name}
              </span>
            </div>
          )}
          {studentCheckIn?.boardedAt && (
            <div className="flex justify-between">
              <span className="text-gray-600">Boarded at:</span>
              <span className="font-medium">
                {new Date(studentCheckIn.boardedAt).toLocaleTimeString()}
              </span>
            </div>
          )}
          {studentCheckIn?.droppedOffAt && (
            <div className="flex justify-between">
              <span className="text-gray-600">Arrived at:</span>
              <span className="font-medium">
                {new Date(studentCheckIn.droppedOffAt).toLocaleTimeString()}
              </span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
