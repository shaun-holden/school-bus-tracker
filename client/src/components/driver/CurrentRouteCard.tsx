import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";

interface CurrentRouteCardProps {
  route?: any;
}

export default function CurrentRouteCard({ route }: CurrentRouteCardProps) {
  const { data: routeStops } = useQuery({
    queryKey: ["/api/routes", route?.id, "stops"],
    enabled: !!route?.id,
  });

  const handleStartRoute = () => {
    // In a real app, this would update the bus status to 'on_route'
    console.log("Starting route...");
  };

  if (!route) {
    return (
      <Card className="mb-6">
        <CardContent className="p-6">
          <div className="text-center text-gray-500">
            No route assigned. Please contact your administrator.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mb-6">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-semibold">
            Today's Route - {route.name || 'Afternoon Pickup'}
          </CardTitle>
          <Button 
            className="bg-primary hover:bg-primary/90"
            onClick={handleStartRoute}
            data-testid="button-start-route"
          >
            <i className="fas fa-play mr-2"></i>Start Route
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {Array.isArray(routeStops) && routeStops.length > 0 ? (
            routeStops.map((stop: any, index: number) => (
              <div 
                key={stop.id} 
                className={`flex items-center p-4 border rounded-lg ${
                  index === 0 ? 'border-success bg-green-50' :
                  index === 1 ? 'border-secondary bg-orange-50 border-2' :
                  'border-gray-200 opacity-60'
                }`}
                data-testid={`route-stop-${stop.id}`}
              >
                <div className="flex items-center mr-4">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-semibold ${
                    index === 0 ? 'bg-success' :
                    index === 1 ? 'bg-secondary animate-pulse' :
                    'bg-gray-300 text-gray-600'
                  }`}>
                    {index === 0 ? <i className="fas fa-check"></i> : index + 1}
                  </div>
                </div>
                <div className="flex-1">
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="font-semibold" data-testid={`stop-name-${stop.id}`}>
                        {stop.name}
                      </h4>
                      <p className="text-sm text-gray-600" data-testid={`stop-address-${stop.id}`}>
                        {stop.address}
                      </p>
                      <p className="text-sm text-gray-600">
                        Students: <span data-testid={`stop-student-count-${stop.id}`}>
                          {Math.floor(Math.random() * 15) + 5}
                        </span>
                      </p>
                    </div>
                    <div className="text-right">
                      <Badge variant={
                        index === 0 ? 'default' :
                        index === 1 ? 'secondary' :
                        'outline'
                      }>
                        {index === 0 ? 'Completed' : 
                         index === 1 ? 'Current Stop' : 
                         'Pending'}
                      </Badge>
                      <div className="text-xs text-gray-500 mt-1" data-testid={`stop-time-${stop.id}`}>
                        {stop.scheduledTime || `${3 + (index * 15)}:${15 + (index * 15)} PM`}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="text-center text-gray-500 py-8">
              No stops found for this route.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
