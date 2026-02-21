import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Bluetooth, CheckCircle2, Clock, Bus, Loader2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface Student {
  id: string;
  firstName: string;
  lastName: string;
  grade: string | null;
}

interface CheckInStatus {
  id: string;
  studentId: string;
  status: "waiting" | "boarded" | "dropped_off";
  boardedAt: string | null;
  droppedOffAt: string | null;
}

interface BluetoothCheckInProps {
  students: Student[];
}

export function BluetoothCheckIn({ students }: BluetoothCheckInProps) {
  const { toast } = useToast();
  const [enabledStudents, setEnabledStudents] = useState<Set<string>>(new Set());
  const [deviceId] = useState(() => {
    let id = localStorage.getItem("bluetooth_device_id");
    if (!id) {
      id = `device_${crypto.randomUUID()}`;
      localStorage.setItem("bluetooth_device_id", id);
    }
    return id;
  });

  const { data: checkInStatuses = [], isLoading } = useQuery<CheckInStatus[]>({
    queryKey: ["/api/check-in/status"],
    refetchInterval: 10000,
  });

  const enableCheckInMutation = useMutation({
    mutationFn: async ({ studentId }: { studentId: string }) => {
      return apiRequest("/api/check-in/enable", "POST", { studentId, deviceId });
    },
    onSuccess: (_, { studentId }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/check-in/status"] });
      setEnabledStudents((prev) => new Set(Array.from(prev).concat(studentId)));
      toast({
        title: "Check-in Enabled",
        description: "Your device is now broadcasting. The driver will detect when your child boards.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to enable check-in. Please try again.",
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    const enabledIds = checkInStatuses
      .filter((status) => status.status === "waiting" || status.status === "boarded")
      .map((status) => status.studentId);
    
    setEnabledStudents((prev) => {
      const prevIds = Array.from(prev).sort().join(",");
      const newIds = enabledIds.sort().join(",");
      if (prevIds === newIds) return prev;
      return new Set(enabledIds);
    });
  }, [checkInStatuses]);

  const getStatusForStudent = (studentId: string): CheckInStatus | undefined => {
    return checkInStatuses.find((s) => s.studentId === studentId);
  };

  const getStatusBadge = (status: CheckInStatus | undefined) => {
    if (!status) return null;

    switch (status.status) {
      case "waiting":
        return (
          <Badge variant="outline" className="bg-yellow-100 text-yellow-800 border-yellow-300">
            <Clock className="w-3 h-3 mr-1" />
            Waiting for Bus
          </Badge>
        );
      case "boarded":
        return (
          <Badge variant="outline" className="bg-green-100 text-green-800 border-green-300">
            <Bus className="w-3 h-3 mr-1" />
            On Bus
          </Badge>
        );
      case "dropped_off":
        return (
          <Badge variant="outline" className="bg-blue-100 text-blue-800 border-blue-300">
            <CheckCircle2 className="w-3 h-3 mr-1" />
            Arrived Safely
          </Badge>
        );
    }
  };

  const handleToggle = (studentId: string, enabled: boolean) => {
    if (enabled) {
      enableCheckInMutation.mutate({ studentId });
    } else {
      setEnabledStudents((prev) => {
        const next = new Set(prev);
        next.delete(studentId);
        return next;
      });
    }
  };

  if (students.length === 0) {
    return null;
  }

  return (
    <Card className="mb-6" data-testid="bluetooth-checkin-card">
      <CardHeader>
        <CardTitle className="flex items-center text-lg">
          <Bluetooth className="w-5 h-5 mr-2 text-blue-600" />
          Bus Check-In
        </CardTitle>
        <p className="text-sm text-gray-500 mt-1">
          Enable check-in when your child is at the bus stop. The driver's device will automatically detect when they board.
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            <span className="text-gray-500">Loading status...</span>
          </div>
        ) : (
          <div className="space-y-4">
            {students.map((student) => {
              const status = getStatusForStudent(student.id);
              const isEnabled = enabledStudents.has(student.id);
              const isBoarded = status?.status === "boarded";
              const isDroppedOff = status?.status === "dropped_off";

              return (
                <div
                  key={student.id}
                  className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                  data-testid={`checkin-row-${student.id}`}
                >
                  <div className="flex-1">
                    <p className="font-medium">
                      {student.firstName} {student.lastName}
                    </p>
                    {student.grade && (
                      <p className="text-sm text-gray-500">Grade {student.grade}</p>
                    )}
                    <div className="mt-1">{getStatusBadge(status)}</div>
                  </div>
                  
                  <div className="flex items-center space-x-2">
                    {!isBoarded && !isDroppedOff && (
                      <>
                        <Switch
                          id={`checkin-${student.id}`}
                          checked={isEnabled}
                          onCheckedChange={(checked) => handleToggle(student.id, checked)}
                          disabled={enableCheckInMutation.isPending}
                          data-testid={`switch-checkin-${student.id}`}
                        />
                        <Label
                          htmlFor={`checkin-${student.id}`}
                          className="text-sm cursor-pointer"
                        >
                          {isEnabled ? "Broadcasting" : "Enable"}
                        </Label>
                      </>
                    )}
                    {isEnabled && !isBoarded && (
                      <div className="flex items-center text-blue-600">
                        <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse mr-1"></div>
                        <span className="text-xs">Active</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        
        <div className="mt-4 p-3 bg-blue-50 rounded-lg text-sm text-blue-800">
          <p className="font-medium">How it works:</p>
          <ul className="mt-1 list-disc list-inside space-y-1 text-blue-700">
            <li>Enable check-in when your child is ready at the bus stop</li>
            <li>Keep this app open on your phone</li>
            <li>The driver's device will detect your child when they board</li>
            <li>You'll receive a notification when they're safely on the bus</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
