import { createClient } from '@/lib/supabase/client';
import type { BuildingPolygon, Coordinate } from '@/types/database';

export interface CampaignBuilding {
  id: string;
  campaign_id: string;
  address_id: string;
  building_id?: string;
  geometry: string; // PostGIS geometry as GeoJSON string
  height_m?: number;
  min_height_m?: number;
  front_bearing?: number;
  source: string;
  created_at: string;
  updated_at: string;
}

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
    height_m?: number;
    min_height_m?: number;
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

  /**
   * Fetch campaign buildings for a specific campaign
   * Uses the campaign_buildings table which has geometry, front_bearing, and height data
   */
  static async fetchCampaignBuildings(campaignId: string): Promise<CampaignBuilding[]> {
    // Use RPC to convert PostGIS geometry to GeoJSON, or select with geometry conversion
    // Supabase automatically converts PostGIS geometry to GeoJSON when selecting
    const { data, error } = await this.client
      .from('campaign_buildings')
      .select('id, campaign_id, address_id, building_id, geometry, height_m, min_height_m, front_bearing, source, created_at, updated_at')
      .eq('campaign_id', campaignId);

    if (error) throw error;
    
    // PostGIS geometry is returned as GeoJSON string by Supabase
    // Parse it if needed
    return (data || []).map((building: any) => ({
      ...building,
      // Geometry might be a string (GeoJSON) or already parsed
      geometry: typeof building.geometry === 'string' 
        ? building.geometry 
        : JSON.stringify(building.geometry),
    })) as CampaignBuilding[];
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

  /**
   * Create point features for 3D model rendering from campaign buildings
   * Uses geometry and front_bearing from campaign_buildings table
   */
  static createBuildingModelPointsFromCampaignBuildings(
    buildings: CampaignBuilding[],
    modelId: string = 'house-model'
  ): BuildingModelPoint[] {
    return buildings
      .filter((building) => {
        // Filter out buildings without valid geometry
        if (!building.geometry) {
          console.warn(`Building ${building.id} has no geometry`);
          return false;
        }
        return true;
      })
      .map((building) => {
        // Convert PostGIS geometry to GeoJSON
        // Supabase PostGIS returns geometry as GeoJSON object or string
        let geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
        try {
          // If geometry is a string, parse it
          if (typeof building.geometry === 'string') {
            const parsed = JSON.parse(building.geometry);
            // Check if it's a Feature or FeatureCollection and extract geometry
            if (parsed.type === 'Feature') {
              geometry = parsed.geometry;
            } else if (parsed.type === 'FeatureCollection' && parsed.features?.[0]) {
              geometry = parsed.features[0].geometry;
            } else if (parsed.type === 'Polygon' || parsed.type === 'MultiPolygon') {
              geometry = parsed;
            } else {
              throw new Error(`Unexpected geometry format: ${parsed.type}`);
            }
          } else if (building.geometry && typeof building.geometry === 'object') {
            // Already an object - might be GeoJSON directly
            const geom = building.geometry as any;
            if (geom.type === 'Feature') {
              geometry = geom.geometry;
            } else if (geom.type === 'Polygon' || geom.type === 'MultiPolygon') {
              geometry = geom;
            } else {
              throw new Error(`Unexpected geometry object type: ${geom.type}`);
            }
          } else {
            throw new Error('Geometry is neither string nor object');
          }
        } catch (e) {
          console.error('Error parsing geometry for building:', building.id, building.geometry, e);
          throw new Error(`Invalid geometry format for building ${building.id}: ${e instanceof Error ? e.message : String(e)}`);
        }

        const centroid = this.calculatePolygonCentroid(geometry);
        // Use front_bearing from database, or calculate if missing
        const frontBearing = building.front_bearing ?? this.calculateFrontBearing(geometry);
        
        return {
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: centroid,
          },
          properties: {
            'model-id': modelId,
            'front_bearing': frontBearing,
            address_id: building.address_id,
            height_m: building.height_m,
            min_height_m: building.min_height_m,
          },
        };
      });
  }
}

