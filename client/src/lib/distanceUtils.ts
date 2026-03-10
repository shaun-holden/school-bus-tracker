export interface Coordinates {
  lat: number;
  lng: number;
}

/**
 * Calculate the distance between two coordinates using the Haversine formula.
 * Returns distance in kilometers.
 */
function haversineDistance(coord1: Coordinates, coord2: Coordinates): number {
  const R = 6371; // Earth's radius in km
  const dLat = ((coord2.lat - coord1.lat) * Math.PI) / 180;
  const dLng = ((coord2.lng - coord1.lng) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((coord1.lat * Math.PI) / 180) *
      Math.cos((coord2.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Calculate estimated route duration in minutes from an array of coordinates.
 * Assumes an average speed of 30 km/h for a school bus.
 */
export function calculateRouteDuration(coordinates: Coordinates[]): number {
  if (coordinates.length < 2) return 0;

  let totalDistance = 0;
  for (let i = 0; i < coordinates.length - 1; i++) {
    totalDistance += haversineDistance(coordinates[i], coordinates[i + 1]);
  }

  const averageSpeedKmH = 30;
  const durationMinutes = (totalDistance / averageSpeedKmH) * 60;
  // Add 2 minutes per stop for boarding/alighting
  const stopTime = (coordinates.length - 2) * 2;
  return Math.round(durationMinutes + stopTime);
}

/**
 * Format duration in minutes to a human-readable string.
 */
export function formatDuration(minutes: number): string {
  if (minutes <= 0) return "0 min";
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours > 0 && mins > 0) return `${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h`;
  return `${mins} min`;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Clean up an address string for geocoding.
 */
function cleanAddress(address: string): string {
  return address
    .replace(/\n/g, ", ")
    .replace(/\r/g, "")
    .replace(/([a-z])([A-Z])/g, "$1, $2") // "DuluthGA" -> "Duluth, GA"
    .replace(/(\d{5})([A-Z])/g, "$1, $2") // "30096GA" -> "30096, GA"
    .replace(/([A-Z]{2})(\d{5})/g, "$1 $2") // "GA30096" -> "GA 30096"
    .trim();
}

/**
 * Geocode an address to coordinates using the Nominatim API.
 */
export async function geocodeAddress(address: string): Promise<Coordinates | null> {
  const cleaned = cleanAddress(address);
  console.log(`[Geocode] Geocoding: "${cleaned}"`);
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(cleaned)}&limit=1`,
      {
        headers: {
          "User-Agent": "SchoolBusTracker/1.0",
        },
      }
    );
    const data = await response.json();
    if (data && data.length > 0) {
      console.log(`[Geocode] Found: lat=${data[0].lat}, lon=${data[0].lon}`);
      return {
        lat: parseFloat(data[0].lat),
        lng: parseFloat(data[0].lon),
      };
    }
    console.warn(`[Geocode] No results for: "${cleaned}"`);
    return null;
  } catch (error) {
    console.error("[Geocode] Error:", error);
    return null;
  }
}

/**
 * Calculate route duration from an array of stops with addresses.
 * Uses stored lat/lng when available, geocodes otherwise.
 * Adds delay between geocoding calls to respect Nominatim rate limits.
 */
export async function calculateRouteFromStops(
  stops: Array<{ name?: string; address: string; order?: number; latitude?: number | null; longitude?: number | null }>
): Promise<number> {
  const sorted = [...stops].sort((a, b) => (a.order || 0) - (b.order || 0));
  const coordinates: Coordinates[] = [];

  console.log(`[RouteCalc] Calculating for ${sorted.length} stops`);

  for (let i = 0; i < sorted.length; i++) {
    const stop = sorted[i];

    // Use stored coordinates if available
    if (stop.latitude && stop.longitude) {
      console.log(`[RouteCalc] Using stored coords for "${stop.name}"`);
      coordinates.push({ lat: stop.latitude, lng: stop.longitude });
      continue;
    }

    if (stop.address) {
      // Add 1.1s delay between Nominatim requests (rate limit: 1 req/sec)
      if (i > 0) {
        await delay(1100);
      }
      const coords = await geocodeAddress(stop.address);
      if (coords) {
        coordinates.push(coords);
      }
    }
  }

  console.log(`[RouteCalc] Got ${coordinates.length} coordinates from ${sorted.length} stops`);

  if (coordinates.length < 2) return 0;
  const duration = calculateRouteDuration(coordinates);
  console.log(`[RouteCalc] Calculated duration: ${duration} min`);
  return duration;
}
