/**
 * Valhalla Routing Service - Pedestrian-Optimized Navigation
 * 
 * Powered by Stadia Maps (Valhalla Engine)
 * Provides "Pedestrian-Optimized" navigation for door-knocking and
 * "Scenic Walking" routes for the Spontaneous Date app.
 * 
 * API Endpoint: https://api.stadiamaps.com
 * Docs: https://docs.stadiamaps.com/routing/
 * 
 * Free Tier: 200,000 credits/month (~2,000 route requests)
 */

export interface ValhallaLocation {
  lat: number;
  lon: number;
  type?: 'break' | 'through' | 'via';
}

export interface PedestrianOptions {
  walking_speed?: number;    // km/h, default 5.0
  step_penalty?: number;     // seconds, default 0
  alley_factor?: number;     // multiplier, default 2.0 (allows shortcuts)
  use_ferry?: number;        // 0-1, default 0 (avoid ferries)
  use_hills?: number;        // 0-1, default 0.1 (avoid steep hills)
}

export interface OptimizedRouteResult {
  polyline: string;          // Encoded polyline
  summary: {
    length: number;          // km
    time: number;            // seconds
  };
  locations: Array<{
    lat: number;
    lon: number;
    type: string;
    original_index?: number;
  }>; // Re-ordered optimized points
}

export class RoutingService {
  private static readonly API_KEY = process.env.STADIA_API_KEY;
  private static readonly BASE_URL = 'https://api.stadiamaps.com';

  /**
   * Calculates the most efficient walking loop for a list of leads
   * Solves the "Traveling Salesman Problem" for door-to-door navigation
   * 
   * @param coords - Array of lat/lon coordinates to visit
   * @returns Optimized route with polyline and re-ordered locations
   */
  static async getOptimizedWalkingLoop(
    coords: Array<{ lat: number; lon: number }>
  ): Promise<OptimizedRouteResult> {
    if (!this.API_KEY) {
      throw new Error('STADIA_API_KEY environment variable is required');
    }

    if (coords.length < 2) {
      throw new Error('Need at least 2 coordinates to create a route');
    }

    console.log(`[RoutingService] Calculating optimized loop for ${coords.length} locations...`);

    const body = {
      locations: coords.map(c => ({ lat: c.lat, lon: c.lon })),
      costing: 'pedestrian',
      costing_options: {
        pedestrian: {
          walking_speed: 5.0,     // Average walking speed km/h
          alley_factor: 2.0,      // Encourage shortcuts through alleys
          use_hills: 0.1,         // Avoid steep hills where possible
          step_penalty: 0,        // Reps are fit, stairs are ok
          use_ferry: 0,           // Can't walk on water
        }
      },
      id: 'daily_loop'
    };

    const startTime = Date.now();
    
    const response = await fetch(`${this.BASE_URL}/optimized_route/v1?api_key=${this.API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const elapsed = Date.now() - startTime;

    if (!response.ok) {
      const error = await response.text();
      console.error('[RoutingService] Valhalla error:', response.status, error);
      throw new Error(`Valhalla Routing Error: ${error}`);
    }

    const data = await response.json();
    
    if (data.trip.status !== 0) {
      throw new Error(`Valhalla error: ${data.trip.status_message}`);
    }

    console.log(`[RoutingService] Route calculated in ${elapsed}ms: ${data.trip.summary.length.toFixed(2)}km, ${Math.round(data.trip.summary.time / 60)}min`);

    // Returns the encoded polyline for the entire route
    return {
      polyline: data.trip.legs[0].shape,
      summary: data.trip.summary,
      locations: data.trip.locations // The re-ordered (optimized) points
    };
  }

  /**
   * Get a simple pedestrian route between two points
   * 
   * @param start - Starting location {lat, lon}
   * @param end - Destination {lat, lon}
   * @returns Route with polyline and summary
   */
  static async getPedestrianRoute(
    start: { lat: number; lon: number },
    end: { lat: number; lon: number }
  ): Promise<OptimizedRouteResult> {
    return this.getOptimizedWalkingLoop([start, end]);
  }

  /**
   * Get a scenic walking route (for Spontaneous Date app)
   * Prioritizes parks, trails, and pleasant paths over speed
   * 
   * @param start - Starting location
   * @param end - Destination
   * @returns Scenic walking route
   */
  static async getScenicWalk(
    start: { lat: number; lon: number },
    end: { lat: number; lon: number }
  ): Promise<OptimizedRouteResult> {
    if (!this.API_KEY) {
      throw new Error('STADIA_API_KEY environment variable is required');
    }

    console.log('[RoutingService] Calculating scenic walk...');

    const body = {
      locations: [
        { lat: start.lat, lon: start.lon },
        { lat: end.lat, lon: end.lon }
      ],
      costing: 'pedestrian',
      costing_options: {
        pedestrian: {
          walking_speed: 4.0,     // Slower pace for enjoyment
          alley_factor: 0.5,      // Avoid alleys
          use_hills: 0.5,         // Some hills ok for views
          step_penalty: 0,
          use_ferry: 0,
        }
      },
      id: 'scenic_walk'
    };

    const response = await fetch(`${this.BASE_URL}/route/v1?api_key=${this.API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Valhalla Routing Error: ${error}`);
    }

    const data = await response.json();
    
    return {
      polyline: data.trip.legs[0].shape,
      summary: data.trip.summary,
      locations: data.trip.locations
    };
  }

  /**
   * Decode Valhalla's encoded polyline into [lat, lon] pairs
   * 
   * Valhalla uses Google's Encoded Polyline Algorithm:
   * https://developers.google.com/maps/documentation/utilities/polylinealgorithm
   */
  static decodePolyline(encoded: string): Array<[number, number]> {
    const points: Array<[number, number]> = [];
    let index = 0;
    let lat = 0;
    let lng = 0;

    while (index < encoded.length) {
      let shift = 0;
      let result = 0;
      let byte;

      // Decode latitude
      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);

      const deltaLat = result & 1 ? ~(result >> 1) : result >> 1;
      lat += deltaLat;

      // Decode longitude
      shift = 0;
      result = 0;

      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);

      const deltaLng = result & 1 ? ~(result >> 1) : result >> 1;
      lng += deltaLng;

      // Valhalla uses 6 decimal places precision
      points.push([lat * 1e-6, lng * 1e-6]);
    }

    return points;
  }

  /**
   * Convert decoded polyline to GeoJSON LineString
   */
  static toGeoJSONLineString(encodedPolyline: string): GeoJSON.LineString {
    const points = this.decodePolyline(encodedPolyline);
    return {
      type: 'LineString',
      coordinates: points.map(([lat, lon]) => [lon, lat]), // GeoJSON is [lon, lat]
    };
  }

  /**
   * Format time in seconds to human-readable string
   */
  static formatDuration(seconds: number): string {
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) {
      return `${minutes} min`;
    }
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  }

  /**
   * Format distance in km to human-readable string
   */
  static formatDistance(km: number): string {
    if (km < 1) {
      return `${Math.round(km * 1000)} m`;
    }
    return `${km.toFixed(1)} km`;
  }
}
