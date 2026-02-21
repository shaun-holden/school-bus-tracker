import { useQuery, useQueries } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Wrench, AlertTriangle, Bus, Loader2, MapPin, CheckCircle2, Clock, RefreshCw, UserCheck, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "date-fns";
import { BusTrackingMap } from "@/components/shared/BusTrackingMap";

interface ChildBusData {
  student: {
    id: string;
    firstName: string;
    lastName: string;
    grade: string | null;
  };
  bus: {
    id: string;
    busNumber: string;
    status: string | null;
    latitude: string | null;
    longitude: string | null;
    speed: string | null;
    lastUpdated: string | null;
  } | null;
  route: {
    id: string;
    name: string;
  } | null;
  stop: {
    id: string;
    name: string;
    estimatedTime: string | null;
  } | null;
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

interface StopProgress {
  hasRoute: boolean;
  hasStop: boolean;
  studentStopId: string | null;
  studentStopAddress: string;
  studentStopSequence: number;
  totalStops: number;
  completedStopsCount: number;
  stopsAway: number;
  hasArrived: boolean;
  lastCompletedStopId: string | null;
  message?: string;
}

export default function LiveTrackingCard() {
  const { data: childrenBuses = [], isLoading, error, refetch, isFetching, dataUpdatedAt } = useQuery<ChildBusData[]>({
    queryKey: ['/api/parent/children-buses'],
    refetchInterval: 30000,
  });

  const { data: checkInStatuses = [] } = useQuery<CheckInStatus[]>({
    queryKey: ['/api/check-in/status'],
    refetchInterval: 10000,
  });

  const { data: attendanceRecords = [] } = useQuery<AttendanceRecord[]>({
    queryKey: ['/api/parent/children-attendance'],
    refetchInterval: 10000,
  });

  // Get all student IDs for fetching stop progress
  const studentIds = childrenBuses.map(cb => cb.student.id);
  
  // Query for stop progress for all children using useQueries
  const stopProgressResults = useQueries({
    queries: studentIds.map(studentId => ({
      queryKey: ['/api/parent/stop-progress', studentId],
      enabled: studentIds.length > 0,
      refetchInterval: 10000,
    })),
  });

  // Create a map of student ID to stop progress
  const stopProgressMap: Record<string, StopProgress | undefined> = {};
  studentIds.forEach((studentId, index) => {
    stopProgressMap[studentId] = stopProgressResults[index]?.data as StopProgress | undefined;
  });

  const getCheckInStatusForStudent = (studentId: string): CheckInStatus | undefined => {
    return checkInStatuses.find(s => s.studentId === studentId);
  };

  const getStopProgress = (studentId: string): StopProgress | undefined => {
    return stopProgressMap[studentId];
  };

  const getAttendanceForStudent = (studentId: string): AttendanceRecord | undefined => {
    return attendanceRecords.find(a => a.studentId === studentId);
  };

  const getBoardingStatusBadge = (studentId: string, checkIn: CheckInStatus | undefined) => {
    // Priority: Driver-marked attendance takes precedence
    const attendance = getAttendanceForStudent(studentId);
    if (attendance) {
      if (attendance.status === "present") {
        return (
          <Badge variant="outline" className="bg-green-100 text-green-800 border-green-300 ml-2">
            <UserCheck className="w-3 h-3 mr-1" />
            Picked Up
          </Badge>
        );
      } else if (attendance.status === "absent") {
        return (
          <Badge variant="outline" className="bg-red-100 text-red-800 border-red-300 ml-2">
            <UserX className="w-3 h-3 mr-1" />
            Absent
          </Badge>
        );
      }
    }

    // Fall back to check-in status
    if (!checkIn) return null;

    switch (checkIn.status) {
      case "waiting":
        return (
          <Badge variant="outline" className="bg-yellow-100 text-yellow-800 border-yellow-300 ml-2">
            <Clock className="w-3 h-3 mr-1" />
            Waiting at Stop
          </Badge>
        );
      case "boarded":
        return (
          <Badge variant="outline" className="bg-green-100 text-green-800 border-green-300 ml-2">
            <Bus className="w-3 h-3 mr-1" />
            On Bus
          </Badge>
        );
      case "dropped_off":
        return (
          <Badge variant="outline" className="bg-blue-100 text-blue-800 border-blue-300 ml-2">
            <CheckCircle2 className="w-3 h-3 mr-1" />
            Arrived
          </Badge>
        );
    }
  };

  const getStatusDisplay = (status: string | null) => {
    switch (status) {
      case "on_route":
        return {
          color: "bg-green-500",
          badge: { className: "bg-green-100 text-green-800", variant: "default", text: "On Route" }
        };
      case "idle":
        return {
          color: "bg-blue-500",
          badge: { className: "bg-blue-100 text-blue-800", variant: "secondary", text: "Idle" }
        };
      case "maintenance":
        return {
          color: "bg-orange-500",
          badge: { className: "bg-orange-100 text-orange-800 border-orange-300", variant: "outline", text: "Under Maintenance" }
        };
      case "emergency":
        return {
          color: "bg-red-500",
          badge: { className: "bg-red-100 text-red-800", variant: "destructive", text: "Emergency" }
        };
      case "inactive":
        return {
          color: "bg-gray-500",
          badge: { className: "bg-gray-100 text-gray-800", variant: "secondary", text: "Inactive" }
        };
      default:
        return {
          color: "bg-gray-500",
          badge: { className: "bg-gray-100 text-gray-800", variant: "secondary", text: "Unknown" }
        };
    }
  };

  if (isLoading) {
    return (
      <Card className="mb-6">
        <CardContent className="py-12 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-blue-500 mr-2" />
          <span className="text-gray-500">Loading bus information...</span>
        </CardContent>
      </Card>
    );
  }

  if (error || childrenBuses.length === 0) {
    return (
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-lg font-semibold">Bus Tracking</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-gray-500">
            <Bus className="w-12 h-12 mx-auto mb-4 text-gray-300" />
            <p>No bus information available for your children.</p>
            <p className="text-sm mt-2">Please contact the school to assign bus routes.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      {childrenBuses.map((childData) => {
        const { student, bus, route, stop } = childData;
        const busStatus = bus?.status || null;
        const statusDisplay = getStatusDisplay(busStatus);
        const isMaintenanceMode = busStatus === "maintenance";
        const isEmergencyMode = busStatus === "emergency";

        const checkInStatus = getCheckInStatusForStudent(student.id);

        return (
          <Card key={student.id} className="mb-6" data-testid={`bus-card-${student.id}`}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg font-semibold">
                    {isMaintenanceMode ? "Bus Status Update" : "Live Bus Tracking"}
                  </CardTitle>
                  <div className="flex items-center mt-1">
                    <p className="text-sm text-gray-500">
                      {student.firstName} {student.lastName} {student.grade && `(Grade ${student.grade})`}
                    </p>
                    {getBoardingStatusBadge(student.id, checkInStatus)}
                  </div>
                </div>
                <div className="flex items-center">
                  {bus ? (
                    <>
                      {isMaintenanceMode ? (
                        <Wrench className="w-4 h-4 mr-2 text-orange-500" />
                      ) : (
                        <div className={`w-3 h-3 ${statusDisplay.color} rounded-full animate-pulse mr-2`}></div>
                      )}
                      <Badge variant={statusDisplay.badge.variant as any} className={statusDisplay.badge.className}>
                        {statusDisplay.badge.text}
                      </Badge>
                    </>
                  ) : (
                    <Badge variant="secondary" className="bg-gray-100 text-gray-600">
                      No Bus Assigned
                    </Badge>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {!bus ? (
                <div className="text-center py-6 text-gray-500">
                  <Bus className="w-10 h-10 mx-auto mb-3 text-gray-300" />
                  <p>No bus currently assigned to this child's route.</p>
                </div>
              ) : isMaintenanceMode ? (
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-6 mb-4" data-testid="maintenance-notice">
                  <div className="flex items-center mb-4">
                    <Wrench className="w-8 h-8 text-orange-500 mr-3" />
                    <div>
                      <h3 className="text-lg font-semibold text-orange-800">Bus #{bus.busNumber} Under Maintenance</h3>
                      <p className="text-orange-700">Service temporarily unavailable</p>
                    </div>
                  </div>
                  
                  <div className="space-y-3 text-sm text-orange-800">
                    <div className="flex items-center">
                      <AlertTriangle className="w-4 h-4 mr-2" />
                      <span>Your child's bus is currently undergoing scheduled maintenance</span>
                    </div>
                    <div className="flex items-center">
                      <AlertTriangle className="w-4 h-4 mr-2" />
                      <span>Alternative transportation arrangements may be needed</span>
                    </div>
                    <div className="flex items-center">
                      <AlertTriangle className="w-4 h-4 mr-2" />
                      <span>You will be notified when the bus returns to service</span>
                    </div>
                  </div>

                  <div className="mt-4 p-3 bg-orange-100 rounded border border-orange-300">
                    <p className="text-sm font-medium text-orange-800">
                      Contact school administration for alternative arrangements
                    </p>
                  </div>
                </div>
              ) : isEmergencyMode ? (
                <div className="bg-red-50 border border-red-200 rounded-lg p-6 mb-4" data-testid="emergency-notice">
                  <div className="flex items-center mb-4">
                    <AlertTriangle className="w-8 h-8 text-red-500 mr-3" />
                    <div>
                      <h3 className="text-lg font-semibold text-red-800">Bus #{bus.busNumber} - Emergency Alert</h3>
                      <p className="text-red-700">Please check your notifications for updates</p>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  {/* Live Map with Bus Location */}
                  <div className="mb-4" data-testid="map-container">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500">
                          {dataUpdatedAt ? `Updated: ${new Date(dataUpdatedAt).toLocaleTimeString()}` : ''}
                        </span>
                        <Badge variant="outline" className="text-xs">Auto-refresh: 30s</Badge>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => refetch()}
                        disabled={isFetching}
                      >
                        {isFetching ? (
                          <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                        ) : (
                          <RefreshCw className="w-4 h-4 mr-1" />
                        )}
                        Refresh
                      </Button>
                    </div>
                    {bus.latitude && bus.longitude ? (
                      <BusTrackingMap
                        buses={[{
                          id: bus.id,
                          busNumber: bus.busNumber,
                          status: (bus.status as 'idle' | 'on_route' | 'maintenance' | 'emergency' | 'inactive') || 'idle',
                          currentLatitude: bus.latitude,
                          currentLongitude: bus.longitude,
                          speed: bus.speed,
                          lastUpdated: bus.lastUpdated
                        }]}
                        height="200px"
                        center={[parseFloat(bus.latitude), parseFloat(bus.longitude)]}
                        zoom={14}
                      />
                    ) : (
                      <div className="bg-gray-100 rounded-lg h-48 flex items-center justify-center">
                        <div className="text-center text-gray-500">
                          <MapPin className="w-8 h-8 mx-auto mb-2 text-gray-400" />
                          <p className="text-sm">Bus location not available</p>
                          <p className="text-xs mt-1">The bus may not be active yet</p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Stop Progress Banner */}
                  {(() => {
                    const stopProgress = getStopProgress(student.id);
                    if (stopProgress?.hasRoute && stopProgress?.hasStop) {
                      if (stopProgress.hasArrived) {
                        return (
                          <div className="mb-4 p-4 bg-green-100 border border-green-300 rounded-lg">
                            <div className="flex items-center gap-3">
                              <CheckCircle2 className="w-8 h-8 text-green-600" />
                              <div>
                                <div className="text-lg font-semibold text-green-800">Bus has arrived at your stop!</div>
                                <div className="text-sm text-green-700">{stopProgress.studentStopAddress}</div>
                              </div>
                            </div>
                          </div>
                        );
                      } else if (stopProgress.stopsAway > 0) {
                        return (
                          <div className="mb-4 p-4 bg-blue-100 border border-blue-300 rounded-lg">
                            <div className="flex items-center gap-3">
                              <Bus className="w-8 h-8 text-blue-600" />
                              <div>
                                <div className="text-lg font-semibold text-blue-800">
                                  Bus is {stopProgress.stopsAway} stop{stopProgress.stopsAway > 1 ? 's' : ''} away
                                </div>
                                <div className="text-sm text-blue-700">
                                  Your stop: {stopProgress.studentStopAddress} (Stop #{stopProgress.studentStopSequence} of {stopProgress.totalStops})
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      } else if (stopProgress.completedStopsCount === 0) {
                        return (
                          <div className="mb-4 p-4 bg-gray-100 border border-gray-300 rounded-lg">
                            <div className="flex items-center gap-3">
                              <Clock className="w-8 h-8 text-gray-600" />
                              <div>
                                <div className="text-lg font-semibold text-gray-800">Waiting for route to start</div>
                                <div className="text-sm text-gray-700">
                                  Your stop: {stopProgress.studentStopAddress} (Stop #{stopProgress.studentStopSequence})
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      }
                    }
                    return null;
                  })()}

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="text-center p-4 bg-blue-50 rounded-lg">
                      <div className="text-2xl font-bold text-primary" data-testid="bus-number">
                        #{bus.busNumber}
                      </div>
                      <div className="text-sm text-gray-600">Bus Number</div>
                    </div>
                    <div className="text-center p-4 bg-green-50 rounded-lg">
                      <div className="text-2xl font-bold text-green-600" data-testid="current-speed">
                        {bus.speed ? `${parseFloat(bus.speed).toFixed(0)} mph` : '--'}
                      </div>
                      <div className="text-sm text-gray-600">Current Speed</div>
                    </div>
                    <div className="text-center p-4 bg-orange-50 rounded-lg">
                      <div className="flex items-center justify-center gap-1">
                        <MapPin className="w-5 h-5 text-orange-500" />
                        <div className="text-lg font-bold text-orange-600" data-testid="next-stop">
                          {stop?.name || 'N/A'}
                        </div>
                      </div>
                      <div className="text-sm text-gray-600">Your Stop</div>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        );
      })}
    </>
  );
}
