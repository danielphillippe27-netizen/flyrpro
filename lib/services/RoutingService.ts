/**
 * Valhalla Routing Service - Pedestrian route geometry only
 *
 * No TSP or sequencing. Used only for optional polyline when include_geometry=true.
 * Stadia Maps (Valhalla) route/v1 with waypoints in fixed order.
 */

export interface ValhallaLocation {
  lat: number;
  lon: number;
  type?: 'break' | 'through' | 'via';
}

export interface PedestrianOptions {
  walking_speed?: number;
  step_penalty?: number;
  alley_factor?: number;
  use_ferry?: number;
  use_hills?: number;
}

export interface OptimizedRouteResult {
  polyline: string;
  summary: { length: number; time: number };
  locations: Array<{ lat: number; lon: number; type?: string; original_index?: number }>;
}

export interface RouteGeometryResult {
  polyline: string;
  distance_m: number;
  time_sec: number;
}

const MAX_VALHALLA_WAYPOINTS = 25;

export class RoutingService {
  private static readonly API_KEY = process.env.STADIA_API_KEY;
  private static readonly BASE_URL = 'https://api.stadiamaps.com';

  /**
   * Get pedestrian route geometry for an ordered list of waypoints (no optimization).
   * Chunks at 25 waypoints per request and merges polylines.
   * Requires STADIA_API_KEY.
   */
  static async getRouteGeometry(
    orderedCoords: Array<{ lat: number; lon: number }>
  ): Promise<RouteGeometryResult> {
    if (!this.API_KEY) {
      throw new Error('STADIA_API_KEY required for route geometry');
    }
    if (orderedCoords.length < 2) {
      throw new Error('Need at least 2 coordinates for a route');
    }

    const valid = orderedCoords
      .map(c => ({ lat: Number(c.lat), lon: Number(c.lon) }))
      .filter(c => Number.isFinite(c.lat) && Number.isFinite(c.lon) && Math.abs(c.lat) <= 90 && Math.abs(c.lon) <= 180);
    if (valid.length < 2) {
      throw new Error('At least 2 valid coordinates required');
    }

    let totalTimeSec = 0;
    let totalLengthKm = 0;
    const decodedArrays: Array<[number, number][]> = [];

    if (valid.length <= MAX_VALHALLA_WAYPOINTS) {
      const r = await this.requestPedestrianRoute(valid);
      totalTimeSec = r.time_sec;
      totalLengthKm = r.length_km;
      if (r.polyline) decodedArrays.push(this.decodePolyline(r.polyline));
    } else {
      const step = MAX_VALHALLA_WAYPOINTS - 1;
      for (let i = 0; i < valid.length; i += step) {
        const chunk = valid.slice(i, i + MAX_VALHALLA_WAYPOINTS);
        if (chunk.length < 2) continue;
        const r = await this.requestPedestrianRoute(chunk);
        totalTimeSec += r.time_sec;
        totalLengthKm += r.length_km;
        if (r.polyline) decodedArrays.push(this.decodePolyline(r.polyline));
      }
    }

    const merged = this.mergePolylines(decodedArrays);
    const polyline = merged.length >= 2 ? this.encodePolyline(merged) : '';

    return {
      polyline,
      distance_m: totalLengthKm * 1000,
      time_sec: totalTimeSec
    };
  }

  private static async requestPedestrianRoute(
    locations: Array<{ lat: number; lon: number }>
  ): Promise<{ polyline: string; length_km: number; time_sec: number }> {
    const response = await fetch(`${this.BASE_URL}/route/v1?api_key=${this.API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        locations: locations.map(c => ({ lat: c.lat, lon: c.lon })),
        costing: 'pedestrian',
        costing_options: {
          pedestrian: {
            walking_speed: 5.1,
            step_penalty: 30,
            use_hills: 0.3,
            shortest: false,
            alley_factor: 0.5
          }
        }
      })
    });

    const text = await response.text();
    if (!response.ok) {
      let detail = text;
      try {
        const err = JSON.parse(text);
        detail = err.error?.message ?? err.message ?? text;
      } catch {
        // use text
      }
      throw new Error(`Valhalla route error: ${response.status} — ${detail}`);
    }

    const data = JSON.parse(text);
    const leg = data.trip?.legs?.[0];
    const summary = data.trip?.summary ?? { length: 0, time: 0 };
    return {
      polyline: leg?.shape ?? '',
      length_km: summary.length ?? 0,
      time_sec: summary.time ?? 0
    };
  }

  private static mergePolylines(decodedArrays: Array<[number, number][]>): Array<[number, number]> {
    if (decodedArrays.length === 0) return [];
    const out = [...decodedArrays[0]];
    for (let i = 1; i < decodedArrays.length; i++) {
      const seg = decodedArrays[i];
      for (let j = 1; j < seg.length; j++) out.push(seg[j]);
    }
    return out;
  }

  private static encodePolyline(points: Array<[number, number]>): string {
    let encoded = '';
    let prevLat = 0;
    let prevLng = 0;
    for (const [lat, lng] of points) {
      const latInt = Math.round(lat * 1e6);
      const lngInt = Math.round(lng * 1e6);
      encoded += this.encodeSignedInt(latInt - prevLat);
      encoded += this.encodeSignedInt(lngInt - prevLng);
      prevLat = latInt;
      prevLng = lngInt;
    }
    return encoded;
  }

  private static encodeSignedInt(value: number): string {
    let s = value < 0 ? ~(value << 1) : value << 1;
    let result = '';
    while (s >= 32) {
      result += String.fromCharCode((32 | (s & 31)) + 63);
      s >>= 5;
    }
    result += String.fromCharCode(s + 63);
    return result;
  }

  /**
   * Get a simple pedestrian route between two points (fixed order, no optimization).
   */
  static async getPedestrianRoute(
    start: { lat: number; lon: number },
    end: { lat: number; lon: number }
  ): Promise<OptimizedRouteResult> {
    const geom = await this.getRouteGeometry([start, end]);
    return {
      polyline: geom.polyline,
      summary: { length: geom.distance_m / 1000, time: geom.time_sec },
      locations: [start, end]
    };
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
