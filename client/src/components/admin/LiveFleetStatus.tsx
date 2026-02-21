import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface LiveFleetStatusProps {
  buses: any[];
}

export default function LiveFleetStatus({ buses }: LiveFleetStatusProps) {
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'on_route':
        return <Badge className="bg-success"><i className="fas fa-check mr-1"></i>On Route</Badge>;
      case 'idle':
        return <Badge className="bg-warning"><i className="fas fa-clock mr-1"></i>Waiting</Badge>;
      case 'maintenance':
        return <Badge className="bg-destructive"><i className="fas fa-wrench mr-1"></i>Maintenance</Badge>;
      default:
        return <Badge variant="secondary">Unknown</Badge>;
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg font-semibold">Live Fleet Status</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {buses && buses.length > 0 ? (
            buses.map((bus) => (
              <div 
                key={bus.id}
                className={`flex items-center justify-between p-4 border rounded-lg ${
                  bus.status === 'maintenance' ? 'border-red-200 bg-red-50' : 'border-gray-200'
                }`}
                data-testid={`bus-status-${bus.id}`}
              >
                <div className="flex items-center">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white ${
                    bus.status === 'maintenance' ? 'bg-destructive' : 'bg-primary'
                  }`}>
                    {bus.status === 'maintenance' ? 
                      <i className="fas fa-exclamation-triangle"></i> : 
                      <i className="fas fa-bus"></i>
                    }
                  </div>
                  <div className="ml-4">
                    <div className="font-semibold" data-testid={`bus-number-${bus.id}`}>
                      Bus {bus.busNumber}
                    </div>
                    <div className="text-sm text-gray-600" data-testid={`bus-driver-${bus.id}`}>
                      {bus.driverId ? `Driver ID: ${bus.driverId}` : 'No driver assigned'}
                    </div>
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-sm font-medium" data-testid={`bus-location-${bus.id}`}>
                    {bus.currentLatitude && bus.currentLongitude ? 
                      `Lat: ${parseFloat(bus.currentLatitude).toFixed(4)}, Lng: ${parseFloat(bus.currentLongitude).toFixed(4)}` : 
                      'Location unknown'
                    }
                  </div>
                  <div className="text-xs text-gray-600">
                    {bus.speed ? `Speed: ${bus.speed} mph` : 'Speed unknown'}
                  </div>
                </div>
                <div className="text-right">
                  {getStatusBadge(bus.status)}
                  <div className="text-xs text-gray-600 mt-1">
                    {bus.lastUpdated ? 
                      `Updated: ${new Date(bus.lastUpdated).toLocaleTimeString()}` : 
                      'Never updated'
                    }
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="text-center text-gray-500 py-8">
              No buses found in the fleet.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
