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

  /**
   * Generate a Monopoly house footprint polygon
   * Creates an 8m × 8m rectangle with a triangular roof peak (3m depth)
   * Centered at the given coordinate
   * 
   * @param center - [lon, lat] center point
   * @param widthMeters - Width of house base (default 8m)
   * @param depthMeters - Depth of house base (default 8m)
   * @param roofDepthMeters - Depth of triangular roof peak (default 3m)
   * @param frontBearing - Rotation angle in degrees (0-360, where 0 is north)
   * @returns GeoJSON Polygon representing the house footprint
   */
  static makeHouseFootprint(
    center: [number, number],
    widthMeters: number = 8,
    depthMeters: number = 8,
    roofDepthMeters: number = 3,
    frontBearing: number = 0
  ): GeoJSON.Polygon {
    const [centerLon, centerLat] = center;
    
    // Convert meters to degrees (approximate, works well for small distances)
    // 1 degree latitude ≈ 111,000 meters
    // 1 degree longitude ≈ 111,000 * cos(latitude) meters
    const latToMeters = 111000;
    const lonToMeters = 111000 * Math.cos(centerLat * Math.PI / 180);
    
    const halfWidth = widthMeters / 2 / lonToMeters;
    const halfDepth = depthMeters / 2 / latToMeters;
    const roofDepth = roofDepthMeters / latToMeters;
    
    // Create house shape: rectangle base + triangular roof peak
    // Start with rectangle corners (before rotation)
    const corners: [number, number][] = [
      [-halfWidth, -halfDepth], // Bottom-left
      [halfWidth, -halfDepth],  // Bottom-right
      [halfWidth, halfDepth],   // Top-right
      [-halfWidth, halfDepth],  // Top-left
    ];
    
    // Add roof peak at the front (top of rectangle)
    // Roof peak extends forward (in the direction of front bearing)
    const roofPeak: [number, number] = [0, halfDepth + roofDepth];
    
    // Rotate all points around center based on front bearing
    const bearingRad = (frontBearing * Math.PI) / 180;
    const cosBearing = Math.cos(bearingRad);
    const sinBearing = Math.sin(bearingRad);
    
    const rotatePoint = (point: [number, number]): [number, number] => {
      const [x, y] = point;
      const rotatedX = x * cosBearing - y * sinBearing;
      const rotatedY = x * sinBearing + y * cosBearing;
      return [rotatedX, rotatedY];
    };
    
    // Rotate all corners and roof peak
    const rotatedCorners = corners.map(rotatePoint);
    const rotatedRoofPeak = rotatePoint(roofPeak);
    
    // Build polygon: rectangle + roof peak
    // Order: bottom-left → bottom-right → top-right → roof peak → top-left → back to start
    const polygon: [number, number][] = [
      [centerLon + rotatedCorners[0][0], centerLat + rotatedCorners[0][1]], // Bottom-left
      [centerLon + rotatedCorners[1][0], centerLat + rotatedCorners[1][1]], // Bottom-right
      [centerLon + rotatedCorners[2][0], centerLat + rotatedCorners[2][1]], // Top-right
      [centerLon + rotatedRoofPeak[0], centerLat + rotatedRoofPeak[1]],    // Roof peak
      [centerLon + rotatedCorners[3][0], centerLat + rotatedCorners[3][1]], // Top-left
      [centerLon + rotatedCorners[0][0], centerLat + rotatedCorners[0][1]], // Close polygon
    ];
    
    return {
      type: 'Polygon',
      coordinates: [polygon],
    };
  }

  /**
   * Convert campaign buildings to house-shaped polygon features for 2D extrusion
   * Creates Monopoly house footprints at building centroids
   */
  static convertCampaignBuildingsToHouseFeatureCollection(
    buildings: CampaignBuilding[],
    statusMap?: Map<string, 'pending' | 'done'>
  ): GeoJSON.FeatureCollection {
    const features: GeoJSON.Feature[] = buildings
      .filter((building) => building.geometry)
      .map((building) => {
        // Parse geometry to get centroid
        let geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
        try {
          if (typeof building.geometry === 'string') {
            const parsed = JSON.parse(building.geometry);
            geometry = parsed.type === 'Feature' ? parsed.geometry : parsed;
          } else {
            geometry = building.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon;
          }
        } catch (e) {
          console.error('Error parsing building geometry:', e);
          return null;
        }
        
        const centroid = this.calculatePolygonCentroid(geometry);
        const frontBearing = building.front_bearing ?? this.calculateFrontBearing(geometry);
        
        // Generate house footprint
        const houseFootprint = this.makeHouseFootprint(
          centroid,
          8, // 8m width
          8, // 8m depth
          3, // 3m roof depth
          frontBearing
        );
        
        // Determine status (default to pending if not provided)
        const status = statusMap?.get(building.address_id) || 'pending';
        
        return {
          type: 'Feature',
          geometry: houseFootprint,
          properties: {
            address_id: building.address_id,
            height: building.height_m || 18.0, // Default 18m height
            min_height: building.min_height_m || 0.0,
            status: status,
          },
        };
      })
      .filter((f): f is GeoJSON.Feature => f !== null);
    
    return {
      type: 'FeatureCollection',
      features,
    };
  }
}

