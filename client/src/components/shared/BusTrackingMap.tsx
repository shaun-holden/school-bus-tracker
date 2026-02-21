import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import { useEffect, useMemo } from 'react';
import { Badge } from "@/components/ui/badge";
import { Bus, Clock, Fuel, MapPin, User } from "lucide-react";

const busIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

const busOnRouteIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

const busMaintenanceIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-orange.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

const busEmergencyIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

interface BusData {
  id: string;
  busNumber: string;
  make?: string;
  model?: string;
  status: 'idle' | 'on_route' | 'maintenance' | 'emergency' | 'inactive';
  currentLatitude?: string | null;
  currentLongitude?: string | null;
  speed?: string | null;
  fuelLevel?: string | null;
  capacity?: number;
  driverId?: string | null;
  lastUpdated?: string | null;
}

interface DriverData {
  id: string;
  firstName?: string;
  lastName?: string;
}

interface BusTrackingMapProps {
  buses: BusData[];
  drivers?: DriverData[];
  height?: string;
  center?: [number, number];
  zoom?: number;
  showOnlyActive?: boolean;
}

function MapBoundsUpdater({ buses }: { buses: BusData[] }) {
  const map = useMap();
  
  useEffect(() => {
    const busesWithLocation = buses.filter(
      bus => bus.currentLatitude && bus.currentLongitude
    );
    
    if (busesWithLocation.length > 0) {
      const bounds = L.latLngBounds(
        busesWithLocation.map(bus => [
          parseFloat(bus.currentLatitude!),
          parseFloat(bus.currentLongitude!)
        ])
      );
      map.fitBounds(bounds, { padding: [50, 50] });
    }
  }, [buses, map]);
  
  return null;
}

function getBusIcon(status: string) {
  switch (status) {
    case 'on_route':
      return busOnRouteIcon;
    case 'maintenance':
      return busMaintenanceIcon;
    case 'emergency':
      return busEmergencyIcon;
    default:
      return busIcon;
  }
}

function getStatusBadgeVariant(status: string) {
  switch (status) {
    case 'on_route':
      return 'default';
    case 'maintenance':
      return 'secondary';
    case 'emergency':
      return 'destructive';
    case 'idle':
      return 'outline';
    default:
      return 'secondary';
  }
}

function formatLastUpdated(dateString: string | null | undefined): string {
  if (!dateString) return 'Unknown';
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return date.toLocaleDateString();
}

export function BusTrackingMap({ 
  buses, 
  drivers = [], 
  height = "400px", 
  center = [33.749, -84.388],
  zoom = 10,
  showOnlyActive = false
}: BusTrackingMapProps) {
  const busesWithLocation = useMemo(() => {
    let filtered = buses.filter(
      bus => bus.currentLatitude && bus.currentLongitude && bus.status !== 'inactive'
    );
    
    if (showOnlyActive) {
      filtered = filtered.filter(bus => bus.status === 'on_route');
    }
    
    return filtered;
  }, [buses, showOnlyActive]);

  const getDriverName = (driverId: string | null | undefined): string => {
    if (!driverId) return 'Unassigned';
    const driver = drivers.find(d => d.id === driverId);
    return driver ? `${driver.firstName || ''} ${driver.lastName || ''}`.trim() : 'Unknown';
  };

  return (
    <div style={{ height, width: '100%' }} className="rounded-lg overflow-hidden border">
      <MapContainer
        center={center}
        zoom={zoom}
        style={{ height: '100%', width: '100%' }}
        scrollWheelZoom={true}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapBoundsUpdater buses={busesWithLocation} />
        
        {busesWithLocation.map((bus) => (
          <Marker
            key={bus.id}
            position={[
              parseFloat(bus.currentLatitude!),
              parseFloat(bus.currentLongitude!)
            ]}
            icon={getBusIcon(bus.status)}
          >
            <Popup>
              <div className="p-2 min-w-[200px]">
                <div className="flex items-center gap-2 mb-2">
                  <Bus className="w-5 h-5 text-blue-600" />
                  <span className="font-bold text-lg">Bus #{bus.busNumber}</span>
                </div>
                
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-600">Status:</span>
                    <Badge variant={getStatusBadgeVariant(bus.status) as any}>
                      {bus.status.replace('_', ' ')}
                    </Badge>
                  </div>
                  
                  {bus.make && bus.model && (
                    <div className="flex items-center justify-between">
                      <span className="text-gray-600">Vehicle:</span>
                      <span>{bus.make} {bus.model}</span>
                    </div>
                  )}
                  
                  <div className="flex items-center gap-1">
                    <User className="w-4 h-4 text-gray-500" />
                    <span className="text-gray-600">Driver:</span>
                    <span className="ml-auto">{getDriverName(bus.driverId)}</span>
                  </div>
                  
                  {bus.speed && parseFloat(bus.speed) > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-gray-600">Speed:</span>
                      <span>{parseFloat(bus.speed).toFixed(1)} mph</span>
                    </div>
                  )}
                  
                  {bus.fuelLevel && (
                    <div className="flex items-center gap-1">
                      <Fuel className="w-4 h-4 text-gray-500" />
                      <span className="text-gray-600">Fuel:</span>
                      <span className="ml-auto">{bus.fuelLevel}</span>
                    </div>
                  )}
                  
                  {bus.capacity && (
                    <div className="flex items-center justify-between">
                      <span className="text-gray-600">Capacity:</span>
                      <span>{bus.capacity} passengers</span>
                    </div>
                  )}
                  
                  <div className="flex items-center gap-1 pt-1 border-t">
                    <Clock className="w-4 h-4 text-gray-400" />
                    <span className="text-gray-500 text-xs">
                      Updated: {formatLastUpdated(bus.lastUpdated)}
                    </span>
                  </div>
                  
                  <div className="flex items-center gap-1">
                    <MapPin className="w-4 h-4 text-gray-400" />
                    <span className="text-gray-500 text-xs">
                      {parseFloat(bus.currentLatitude!).toFixed(6)}, {parseFloat(bus.currentLongitude!).toFixed(6)}
                    </span>
                  </div>
                </div>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
      
      {busesWithLocation.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-100/80 pointer-events-none">
          <div className="text-center text-gray-500">
            <MapPin className="w-12 h-12 mx-auto mb-2 opacity-50" />
            <p className="font-medium">No buses with location data</p>
            <p className="text-sm">Buses will appear here when they report their location</p>
          </div>
        </div>
      )}
    </div>
  );
}

export function BusTrackingLegend() {
  return (
    <div className="flex flex-wrap gap-4 text-sm">
      <div className="flex items-center gap-2">
        <div className="w-4 h-4 rounded-full bg-green-500"></div>
        <span>On Route</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="w-4 h-4 rounded-full bg-blue-500"></div>
        <span>Idle</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="w-4 h-4 rounded-full bg-orange-500"></div>
        <span>Maintenance</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="w-4 h-4 rounded-full bg-red-500"></div>
        <span>Emergency</span>
      </div>
    </div>
  );
}
