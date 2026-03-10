import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Bus, Clock, MapPin, User, Calendar, Timer, Building, Filter } from "lucide-react";
import { format, subDays } from "date-fns";

interface BusJourney {
  id: string;
  busId: string;
  driverId: string | null;
  routeId: string | null;
  journeyDate: string;
  departHomebaseAt: string | null;
  arriveSchoolAt: string | null;
  departSchoolAt: string | null;
  arriveHomebaseAt: string | null;
  homebaseAddress: string | null;
  schoolId: string | null;
  totalDurationMinutes: number | null;
  notes: string | null;
  bus: { id: string; busNumber: string } | null;
  driver: { id: string; firstName: string | null; lastName: string | null } | null;
  school: { id: string; name: string } | null;
  route: { id: string; name: string } | null;
}

interface JourneyResponse {
  journeys: BusJourney[];
  timezone: string;
}

export function JourneyReports() {
  const [startDate, setStartDate] = useState(format(subDays(new Date(), 7), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [driverFilter, setDriverFilter] = useState('all');
  const [busFilter, setBusFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  const { data, isLoading, refetch } = useQuery<JourneyResponse>({
    queryKey: [`/api/reports/journeys?startDate=${startDate}&endDate=${endDate}`],
  });

  const allJourneys = data?.journeys || [];
  const timezone = data?.timezone || 'America/New_York';

  // Get unique drivers and buses for filter dropdowns
  const uniqueDrivers = Array.from(
    new Map(allJourneys.filter(j => j.driver).map(j => [j.driver!.id, j.driver!])).values()
  );
  const uniqueBuses = Array.from(
    new Map(allJourneys.filter(j => j.bus).map(j => [j.bus!.id, j.bus!])).values()
  );

  // Apply filters
  const journeys = allJourneys.filter(j => {
    if (driverFilter !== 'all' && j.driverId !== driverFilter) return false;
    if (busFilter !== 'all' && j.busId !== busFilter) return false;
    if (statusFilter === 'completed' && !j.arriveHomebaseAt) return false;
    if (statusFilter === 'in_progress' && j.arriveHomebaseAt) return false;
    return true;
  });

  // Get short timezone label (e.g., "EST", "EDT")
  const getTimezoneLabel = () => {
    try {
      const now = new Date();
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'short' }).formatToParts(now);
      const tzPart = parts.find(p => p.type === 'timeZoneName');
      return tzPart?.value || timezone;
    } catch {
      return timezone;
    }
  };

  const formatTime = (dateStr: string | null) => {
    if (!dateStr) return "-";
    try {
      const date = new Date(dateStr);
      return date.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: timezone,
      });
    } catch {
      return "-";
    }
  };

  const formatDuration = (minutes: number | null) => {
    if (!minutes || minutes < 0) return "-";
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours === 0) return `${mins}m`;
    return `${hours}h ${mins}m`;
  };

  const calculateLegDuration = (start: string | null, end: string | null) => {
    if (!start || !end) return "-";
    try {
      const startTime = new Date(start);
      const endTime = new Date(end);
      const diffMs = endTime.getTime() - startTime.getTime();
      const diffMins = Math.round(diffMs / 60000);
      if (diffMins < 0) return "-";
      const hours = Math.floor(diffMins / 60);
      const mins = diffMins % 60;
      if (hours === 0) return `${mins}m`;
      return `${hours}h ${mins}m`;
    } catch {
      return "-";
    }
  };

  const getJourneyStatus = (journey: BusJourney) => {
    if (journey.arriveHomebaseAt) return { label: "Completed", variant: "default" as const };
    if (journey.departSchoolAt) return { label: "Returning", variant: "secondary" as const };
    if (journey.arriveSchoolAt) return { label: "At School", variant: "outline" as const };
    if (journey.departHomebaseAt) return { label: "En Route", variant: "secondary" as const };
    return { label: "Pending", variant: "outline" as const };
  };

  const formatJourneyDate = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: timezone,
      });
    } catch {
      return dateStr;
    }
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

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Timer className="h-5 w-5" />
            Bus Journey Reports
          </CardTitle>
          <CardDescription>
            Track bus departure and arrival times between homebase and schools — Times shown in {getTimezoneLabel()}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4 mb-6">
            <div className="flex items-center gap-2">
              <Label htmlFor="startDate">From:</Label>
              <Input
                id="startDate"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-40"
              />
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="endDate">To:</Label>
              <Input
                id="endDate"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-40"
              />
            </div>
            <Button onClick={() => refetch()} variant="outline">
              <Calendar className="h-4 w-4 mr-2" />
              Update
            </Button>
          </div>

          <div className="flex flex-wrap gap-3 p-4 bg-gray-50 rounded-lg border mb-6">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-gray-500" />
              <Label className="text-sm font-medium">Filters:</Label>
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-sm whitespace-nowrap">Driver:</Label>
              <Select value={driverFilter} onValueChange={setDriverFilter}>
                <SelectTrigger className="w-[160px] h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Drivers</SelectItem>
                  {uniqueDrivers.map(d => (
                    <SelectItem key={d.id} value={d.id}>
                      {`${d.firstName || ''} ${d.lastName || ''}`.trim() || 'Unknown'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-sm whitespace-nowrap">Bus:</Label>
              <Select value={busFilter} onValueChange={setBusFilter}>
                <SelectTrigger className="w-[130px] h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Buses</SelectItem>
                  {uniqueBuses.map(b => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.busNumber}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-sm whitespace-nowrap">Status:</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[140px] h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {journeys.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Bus className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No journey records found for this date range</p>
              <p className="text-sm">Journey data will appear here when drivers check in and complete routes</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Bus</TableHead>
                    <TableHead>Driver</TableHead>
                    <TableHead>Route</TableHead>
                    <TableHead>Left Homebase</TableHead>
                    <TableHead>Arrived School</TableHead>
                    <TableHead>Left School</TableHead>
                    <TableHead>Back to Homebase</TableHead>
                    <TableHead>Total Time</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {journeys.map((journey) => {
                    const status = getJourneyStatus(journey);
                    return (
                      <TableRow key={journey.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Calendar className="h-4 w-4 text-muted-foreground" />
                            {formatJourneyDate(journey.journeyDate)}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Bus className="h-4 w-4 text-blue-600" />
                            <span className="font-medium">{journey.bus?.busNumber || "Unknown"}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <User className="h-4 w-4 text-muted-foreground" />
                            {journey.driver
                              ? `${journey.driver.firstName || ""} ${journey.driver.lastName || ""}`.trim() || "Unknown"
                              : "Unknown"
                            }
                          </div>
                        </TableCell>
                        <TableCell>
                          {journey.route?.name || "-"}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-medium text-green-600">{formatTime(journey.departHomebaseAt)}</span>
                            {journey.homebaseAddress && (
                              <span className="text-xs text-muted-foreground flex items-center gap-1">
                                <MapPin className="h-3 w-3" />
                                {journey.homebaseAddress.substring(0, 20)}...
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-medium text-blue-600">{formatTime(journey.arriveSchoolAt)}</span>
                            {journey.departHomebaseAt && journey.arriveSchoolAt && (
                              <span className="text-xs text-muted-foreground">
                                ({calculateLegDuration(journey.departHomebaseAt, journey.arriveSchoolAt)} drive)
                              </span>
                            )}
                            {journey.school && (
                              <span className="text-xs text-muted-foreground flex items-center gap-1">
                                <Building className="h-3 w-3" />
                                {journey.school.name}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-medium text-orange-600">{formatTime(journey.departSchoolAt)}</span>
                            {journey.arriveSchoolAt && journey.departSchoolAt && (
                              <span className="text-xs text-muted-foreground">
                                ({calculateLegDuration(journey.arriveSchoolAt, journey.departSchoolAt)} at school)
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-medium text-purple-600">{formatTime(journey.arriveHomebaseAt)}</span>
                            {journey.departSchoolAt && journey.arriveHomebaseAt && (
                              <span className="text-xs text-muted-foreground">
                                ({calculateLegDuration(journey.departSchoolAt, journey.arriveHomebaseAt)} return)
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Clock className="h-4 w-4 text-muted-foreground" />
                            <span className="font-semibold">{formatDuration(journey.totalDurationMinutes)}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={status.variant}>{status.label}</Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {journeys.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Timer className="h-5 w-5" />
              Summary Statistics
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-4 bg-blue-50 rounded-lg">
                <div className="text-2xl font-bold text-blue-600">{journeys.length}</div>
                <div className="text-sm text-muted-foreground">Total Journeys</div>
              </div>
              <div className="p-4 bg-green-50 rounded-lg">
                <div className="text-2xl font-bold text-green-600">
                  {journeys.filter(j => j.arriveHomebaseAt).length}
                </div>
                <div className="text-sm text-muted-foreground">Completed</div>
              </div>
              <div className="p-4 bg-purple-50 rounded-lg">
                <div className="text-2xl font-bold text-purple-600">
                  {formatDuration(
                    Math.round(
                      journeys
                        .filter(j => j.totalDurationMinutes && j.totalDurationMinutes > 0)
                        .reduce((sum, j) => sum + (j.totalDurationMinutes || 0), 0) /
                      Math.max(journeys.filter(j => j.totalDurationMinutes && j.totalDurationMinutes > 0).length, 1)
                    )
                  )}
                </div>
                <div className="text-sm text-muted-foreground">Avg Journey Time</div>
              </div>
              <div className="p-4 bg-orange-50 rounded-lg">
                <div className="text-2xl font-bold text-orange-600">
                  {new Set(journeys.map(j => j.busId)).size}
                </div>
                <div className="text-sm text-muted-foreground">Unique Buses</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
