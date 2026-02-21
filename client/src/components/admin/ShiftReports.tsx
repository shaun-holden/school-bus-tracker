import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Clock, User, Bus, Route, MapPin, Users, AlertCircle } from "lucide-react";
import { format } from "date-fns";

interface DriverShiftReport {
  id: string;
  driverId: string;
  driverName: string;
  busId: string | null;
  busNumber: string | null;
  routeId: string | null;
  routeName: string | null;
  shiftStartTime: string;
  shiftEndTime: string;
  totalDurationMinutes: number;
  startingFuelLevel: string | null;
  endingFuelLevel: string | null;
  startingMileage: number | null;
  endingMileage: number | null;
  milesDriven: number | null;
  schoolsVisited: number;
  studentsPickedUp: number;
  studentsDroppedOff: number;
  issuesReported: number;
  interiorCleanStart: boolean | null;
  exteriorCleanStart: boolean | null;
  notes: string | null;
  createdAt: string;
}

export function ShiftReports() {
  const { data: reports = [], isLoading } = useQuery<DriverShiftReport[]>({
    queryKey: ["/api/driver-shift-reports"],
  });

  const formatDuration = (minutes: number) => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
  };

  const formatFuelLevel = (level: string | null) => {
    if (!level) return "Unknown";
    return level;
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="animate-pulse">
          <div className="h-6 bg-gray-200 rounded w-1/4 mb-4"></div>
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-16 bg-gray-200 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (reports.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Driver Shift Reports
          </CardTitle>
          <CardDescription>View detailed reports from completed driver shifts</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            <Clock className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No shift reports available yet</p>
            <p className="text-sm">Reports will appear here when drivers complete their shifts</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Driver Shift Reports
          </CardTitle>
          <CardDescription>
            Detailed reports from completed driver shifts ({reports.length} reports)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Driver</TableHead>
                  <TableHead>Date & Duration</TableHead>
                  <TableHead>Vehicle</TableHead>
                  <TableHead>Route</TableHead>
                  <TableHead>Activity</TableHead>
                  <TableHead>Vehicle Condition</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reports.map((report) => (
                  <TableRow key={report.id} data-testid={`shift-report-${report.id}`}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <User className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <div className="font-medium">{report.driverName}</div>
                          <div className="text-xs text-muted-foreground">ID: {report.driverId.slice(0, 8)}...</div>
                        </div>
                      </div>
                    </TableCell>
                    
                    <TableCell>
                      <div className="space-y-1">
                        <div className="text-sm font-medium">
                          {format(new Date(report.shiftStartTime), "MMM d, yyyy")}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {format(new Date(report.shiftStartTime), "h:mm a")} - {format(new Date(report.shiftEndTime), "h:mm a")}
                        </div>
                        <Badge variant="outline" className="text-xs">
                          <Clock className="h-3 w-3 mr-1" />
                          {formatDuration(report.totalDurationMinutes)}
                        </Badge>
                      </div>
                    </TableCell>

                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Bus className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <div className="font-medium">Bus #{report.busNumber || "N/A"}</div>
                          <div className="text-xs text-muted-foreground">
                            Fuel: {formatFuelLevel(report.startingFuelLevel)} → {formatFuelLevel(report.endingFuelLevel)}
                          </div>
                        </div>
                      </div>
                    </TableCell>

                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Route className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <div className="font-medium">{report.routeName || "No Route"}</div>
                          <div className="text-xs text-muted-foreground flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {report.schoolsVisited} schools visited
                          </div>
                        </div>
                      </div>
                    </TableCell>

                    <TableCell>
                      <div className="space-y-1">
                        <div className="flex items-center gap-1 text-sm">
                          <Users className="h-3 w-3 text-green-600" />
                          <span className="text-green-600">{report.studentsPickedUp} picked up</span>
                        </div>
                        <div className="flex items-center gap-1 text-sm">
                          <Users className="h-3 w-3 text-blue-600" />
                          <span className="text-blue-600">{report.studentsDroppedOff} dropped off</span>
                        </div>
                        {report.issuesReported > 0 && (
                          <div className="flex items-center gap-1 text-sm">
                            <AlertCircle className="h-3 w-3 text-red-600" />
                            <span className="text-red-600">{report.issuesReported} issues</span>
                          </div>
                        )}
                      </div>
                    </TableCell>

                    <TableCell>
                      <div className="space-y-1">
                        {report.interiorCleanStart !== null && (
                          <Badge variant={report.interiorCleanStart ? "default" : "destructive"} className="text-xs">
                            Interior: {report.interiorCleanStart ? "Clean" : "Dirty"}
                          </Badge>
                        )}
                        {report.exteriorCleanStart !== null && (
                          <Badge variant={report.exteriorCleanStart ? "default" : "destructive"} className="text-xs">
                            Exterior: {report.exteriorCleanStart ? "Clean" : "Dirty"}
                          </Badge>
                        )}
                      </div>
                    </TableCell>

                    <TableCell>
                      <div className="max-w-xs">
                        <p className="text-xs text-muted-foreground truncate" title={report.notes || ""}>
                          {report.notes || "No notes"}
                        </p>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}