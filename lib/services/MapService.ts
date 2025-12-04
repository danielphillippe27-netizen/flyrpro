import { createClient } from '@/lib/supabase/client';
import type { BuildingPolygon, Coordinate } from '@/types/database';

export interface BuildingModelPoint {
  type: 'Feature';
  geometry: {
    type: 'Point';
    coordinates: [number, number]; // [lon, lat]
  };
  properties: {
    'model-id': string;
    'front_bearing': number;
    address_id: string;
  };
}

export class MapService {
  private static client = createClient();

  static async fetchBuildingPolygons(addressIds: string[]): Promise<BuildingPolygon[]> {
    if (addressIds.length === 0) return [];

    const { data, error } = await this.client
      .from('building_polygons')
      .select('*')
      .in('address_id', addressIds);

    if (error) throw error;
    return data || [];
  }

  static async fetchBuildingPolygonForAddress(addressId: string): Promise<BuildingPolygon | null> {
    const { data, error } = await this.client
      .from('building_polygons')
      .select('*')
      .eq('address_id', addressId)
      .single();

    if (error && error.code !== 'PGRST116') throw error; // PGRST116 = not found
    return data || null;
  }

  static async requestBuildingPolygons(addresses: Array<{ id: string; lat: number; lon: number }>): Promise<{
    created: number;
    updated: number;
  }> {
    // Call Supabase Edge Function or API route
    const response = await fetch('/api/mapbox/tilequery-buildings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ addresses }),
    });

    if (!response.ok) {
      throw new Error('Failed to fetch building polygons');
    }

    return response.json();
  }

  static async geocodeAddress(address: string): Promise<Coordinate | null> {
    // Use Mapbox Geocoding API or Supabase function
    // For now, return null - implement based on your geocoding solution
    return null;
  }

  /**
   * Calculate the centroid of a polygon geometry
   */
  static calculatePolygonCentroid(geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon): [number, number] {
    let coordinates: number[][][] = [];
    
    if (geometry.type === 'Polygon') {
      coordinates = [geometry.coordinates];
    } else if (geometry.type === 'MultiPolygon') {
      coordinates = geometry.coordinates;
    } else {
      throw new Error('Unsupported geometry type');
    }

    // Use the first ring of the first polygon
    const ring = coordinates[0][0];
    
    let sumLon = 0;
    let sumLat = 0;
    const count = ring.length - 1; // Exclude last point if it's the same as first
    
    for (let i = 0; i < count; i++) {
      sumLon += ring[i][0];
      sumLat += ring[i][1];
    }
    
    return [sumLon / count, sumLat / count];
  }

  /**
   * Calculate the front bearing (orientation) of a building polygon
   * Uses the longest edge of the polygon as the front direction
   */
  static calculateFrontBearing(geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon): number {
    let coordinates: number[][][] = [];
    
    if (geometry.type === 'Polygon') {
      coordinates = [geometry.coordinates];
    } else if (geometry.type === 'MultiPolygon') {
      coordinates = geometry.coordinates;
    } else {
      return 0; // Default bearing
    }

    const ring = coordinates[0][0];
    let maxLength = 0;
    let maxBearing = 0;
    
    // Find the longest edge
    for (let i = 0; i < ring.length - 1; i++) {
      const [lon1, lat1] = ring[i];
      const [lon2, lat2] = ring[i + 1];
      
      // Calculate distance
      const dx = lon2 - lon1;
      const dy = lat2 - lat1;
      const length = Math.sqrt(dx * dx + dy * dy);
      
      if (length > maxLength) {
        maxLength = length;
        // Calculate bearing in degrees (0-360, where 0 is north)
        // Mapbox uses bearing where 0 is north, positive is clockwise
        const bearing = (Math.atan2(dx, dy) * 180) / Math.PI;
        maxBearing = bearing < 0 ? bearing + 360 : bearing;
      }
    }
    
    return maxBearing;
  }

  /**
   * Create point features for 3D model rendering from building polygons
   */
  static createBuildingModelPoints(polygons: BuildingPolygon[], modelId: string = 'house-model'): BuildingModelPoint[] {
    return polygons.map((polygon) => {
      const geometry = JSON.parse(polygon.geom) as GeoJSON.Polygon | GeoJSON.MultiPolygon;
      const centroid = this.calculatePolygonCentroid(geometry);
      const frontBearing = this.calculateFrontBearing(geometry);
      
      return {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: centroid,
        },
        properties: {
          'model-id': modelId,
          'front_bearing': frontBearing,
          address_id: polygon.address_id,
        },
      };
    });
  }
}

