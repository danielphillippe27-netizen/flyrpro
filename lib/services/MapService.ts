import { createClient } from '@/lib/supabase/client';
import type { BuildingPolygon, Coordinate, CampaignAddress, Building } from '@/types/database';
import * as turf from '@turf/turf';
import * as THREE from 'three';
import { BuildingService } from './BuildingService';
import type { LineString } from '@turf/turf';

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
    'front_bearing': number; // Deprecated, use house_bearing instead
    'house_bearing'?: number; // Preferred: house_bearing from BuildingService (vector-based)
    address_id?: string; // Legacy: for backward compatibility
    building_id?: string; // Gold Standard: UUID of building (preferred)
    gers_id?: string; // Overture: GERS ID for building lookup
    latest_status?: string; // Gold Standard: cached status from buildings table
    height_m?: number;
    min_height_m?: number;
    // Dynamic spacing properties
    scale_factor?: number; // Dynamic scale multiplier (default: 1.0)
    width_meters?: number; // Calculated width in meters
    is_townhouse?: boolean; // Whether this is part of a townhouse cluster
    townhouse_cluster_id?: string; // ID for grouping townhouses
    townhouse_unit_index?: number; // Position within townhouse row
    visual_offset?: [number, number]; // Nudge offset [lon, lat] applied to prevent collisions
    street_name?: string; // Street name for neighbor grouping (legacy)
    road_bearing?: number; // Road bearing for townhouse alignment
    collision_scale_reduction?: number; // Scale reduction factor from collision detection (default: 1.0)
    color?: string; // Legacy color property (deprecated in favor of latest_status)
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
    const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    
    if (!mapboxToken) {
      console.error('Mapbox token not configured. Set NEXT_PUBLIC_MAPBOX_TOKEN environment variable.');
      throw new Error('Mapbox token missing: NEXT_PUBLIC_MAPBOX_TOKEN is not defined');
    }

    try {
      // Encode address for URL
      const encodedAddress = encodeURIComponent(address);
      
      // Mask token for logging (show first 10 chars + last 4 chars)
      const maskedToken = mapboxToken.length > 14 
        ? `${mapboxToken.substring(0, 10)}...${mapboxToken.substring(mapboxToken.length - 4)}`
        : '***';
      
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodedAddress}.json?access_token=${mapboxToken}&limit=1`;
      
      // Log the URL with masked token
      const logUrl = url.replace(mapboxToken, maskedToken);
      console.log(`[MapService] Geocoding address: "${address}"`);
      console.log(`[MapService] Encoded address: "${encodedAddress}"`);
      console.log(`[MapService] Request URL: ${logUrl}`);

      const response = await fetch(url);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[MapService] Mapbox geocoding failed: ${response.status} ${response.statusText}`);
        console.error(`[MapService] Error response body:`, errorText);
        return null;
      }

      const data = await response.json();
      
      // Log the full response for debugging
      console.log(`[MapService] Mapbox response:`, JSON.stringify(data, null, 2));
      
      // Check if we have results
      if (!data.features || data.features.length === 0) {
        console.warn(`[MapService] No geocoding results for address: "${address}"`);
        console.warn(`[MapService] Full response (no features):`, JSON.stringify(data, null, 2));
        return null;
      }

      // Extract coordinates from first result
      const feature = data.features[0];
      const coordinates = feature.geometry?.coordinates;
      
      if (!coordinates || coordinates.length < 2) {
        console.warn(`[MapService] Invalid coordinates in geocoding result for address: "${address}"`);
        console.warn(`[MapService] Feature data:`, JSON.stringify(feature, null, 2));
        return null;
      }

      // Mapbox returns [lng, lat], we need { lat, lon }
      const result = {
        lat: coordinates[1],
        lon: coordinates[0],
      };
      
      console.log(`[MapService] Successfully geocoded "${address}" to:`, result);
      return result;
    } catch (error) {
      console.error(`[MapService] Error geocoding address "${address}":`, error);
      if (error instanceof Error) {
        console.error(`[MapService] Error stack:`, error.stack);
      }
      return null;
    }
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
   * NUCLEAR REWRITE: Apply proper GIS-based house placement and orientation
   * Implements strict road alignment, safety gap scaling, and proper setback
   */
  static applySpacingAndTownhouseLogic(
    modelPoints: BuildingModelPoint[],
    addresses: Map<string, CampaignAddress>
  ): BuildingModelPoint[] {
    if (modelPoints.length === 0) return modelPoints;

    // Step 1: Group by street_name for neighbor calculations
    const streetGroups = new Map<string, BuildingModelPoint[]>();
    for (const point of modelPoints) {
      const address = addresses.get(point.properties.address_id);
      const streetName = point.properties.street_name || address?.street_name || 'unknown';
      if (!streetGroups.has(streetName)) {
        streetGroups.set(streetName, []);
      }
      streetGroups.get(streetName)!.push(point);
    }

    // Step 2: Process each point with proper GIS calculations
    const processedPoints: BuildingModelPoint[] = [];

    for (const point of modelPoints) {
      const address = addresses.get(point.properties.address_id);
      const streetName = point.properties.street_name || address?.street_name || 'unknown';
      const streetPoints = streetGroups.get(streetName) || [];
      
      // Get road bearing (from address or fallback)
      const roadBearing = point.properties.road_bearing || address?.road_bearing || 0;
      
      // Step 2a: Calculate house_bearing using 90° rule
      // If we had road_geom, we'd use turf.nearestPointOnLine, but we'll use road_bearing
      // The house_bearing should be road_bearing ± 90° based on which side of road
      let houseBearing = point.properties.house_bearing || address?.house_bearing;
      
      if (!houseBearing) {
        // Determine which side of road: use house_bearing from address if available
        // Otherwise, default to road_bearing + 90° (right side)
        houseBearing = roadBearing + 90;
        if (houseBearing >= 360) houseBearing -= 360;
      }

      // Step 2b: Calculate distance to immediate neighbor on same street
      const neighborDistance = this.findImmediateNeighborDistance(
        point,
        streetPoints,
        addresses
      );

      // Step 2c: Apply Safety Gap Scaling (65% rule = 35% gap)
      const maxWidth = neighborDistance !== null 
        ? neighborDistance * 0.65  // 35% gap enforced
        : this.BASE_HOUSE_WIDTH_M; // Fallback: 10m default
      
      const scaleFactor = maxWidth / this.BASE_HOUSE_WIDTH_M;

      // Step 2d: Calculate setback position (8m away from road)
      // All calculations in WGS84 using Turf.js
      const originalCoords = point.geometry.coordinates as [number, number];
      const housePoint = turf.point(originalCoords);
      
      // Determine offset direction: perpendicular to road, away from road center
      // If house_bearing = road_bearing + 90°, house is on right side, offset = road_bearing - 90°
      // If house_bearing = road_bearing - 90°, house is on left side, offset = road_bearing + 90°
      const bearingDiff = ((houseBearing - roadBearing + 180) % 360) - 180;
      const isOnRightSide = Math.abs(bearingDiff - 90) < Math.abs(bearingDiff + 90);
      const offsetBearing = isOnRightSide 
        ? (roadBearing - 90 + 360) % 360
        : (roadBearing + 90) % 360;
      
      // Use turf.destination() to move house 8m away from road (handles Earth's curvature)
      const setbackMeters = 8.0;
      const offsetPoint = turf.destination(housePoint, setbackMeters, offsetBearing, { units: 'meters' });
      const finalCoords = offsetPoint.geometry.coordinates as [number, number];

      // Step 2e: Create processed point with all calculated properties
      processedPoints.push({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: finalCoords, // Setback position in WGS84
        },
        properties: {
          ...point.properties,
          'house_bearing': houseBearing,
          'road_bearing': roadBearing,
          'street_name': streetName,
          'scale_factor': scaleFactor,
          'width_meters': maxWidth,
          'is_townhouse': false,
        },
      });
    }

    return processedPoints;
  }

  /**
   * Find distance to immediate neighbor on the same street
   * Returns the minimum distance to the closest neighbor, or null if none found
   */
  private static findImmediateNeighborDistance(
    point: BuildingModelPoint,
    streetPoints: BuildingModelPoint[],
    addresses: Map<string, CampaignAddress>
  ): number | null {
    if (streetPoints.length < 2) return null;

    const pointCoords = point.geometry.coordinates;
    const pointTurf = turf.point(pointCoords);
    
    // Get road bearing to determine "along street" direction
    const address = addresses.get(point.properties.address_id);
    const roadBearing = point.properties.road_bearing || address?.road_bearing || 0;

    // Find all neighbors on the same street
    const neighbors: Array<{ point: BuildingModelPoint; distance: number; alongRoad: number }> = [];
    
    for (const neighbor of streetPoints) {
      if (neighbor.properties.address_id === point.properties.address_id) continue;
      
      const neighborCoords = neighbor.geometry.coordinates;
      const neighborTurf = turf.point(neighborCoords);
      const distance = turf.distance(pointTurf, neighborTurf, { units: 'meters' });
      
      // Calculate bearing from point to neighbor
      const bearing = turf.bearing(pointTurf, neighborTurf);
      const bearingDiff = Math.abs(((bearing - roadBearing + 180) % 360) - 180);
      
      // Neighbor is "along the road" if bearing is within 45° of road bearing
      const isAlongRoad = bearingDiff < 45 || bearingDiff > 135;
      
      if (isAlongRoad && distance < 100) { // Within 100m
        neighbors.push({ point: neighbor, distance, alongRoad: bearingDiff });
      }
    }

    if (neighbors.length === 0) return null;

    // Return the minimum distance to immediate neighbor
    neighbors.sort((a, b) => a.distance - b.distance);
    return neighbors[0].distance;
  }

  /**
   * Create point features for 3D model rendering from campaign buildings
   * Uses geometry and front_bearing from campaign_buildings table
   */
  static createBuildingModelPointsFromCampaignBuildings(
    buildings: CampaignBuilding[],
    modelId: string = 'house-model',
    addresses?: Map<string, CampaignAddress>
  ): BuildingModelPoint[] {
    const result = buildings
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
            'front_bearing': frontBearing, // Keep for backward compatibility
            'house_bearing': frontBearing, // Use same value, will be overridden by address data if available
            address_id: building.address_id,
            height_m: building.height_m,
            min_height_m: building.min_height_m,
          },
        };
      });

    // Apply spacing and townhouse logic if addresses are provided
    if (addresses && addresses.size > 0) {
      return this.applySpacingAndTownhouseLogic(result, addresses);
    }

    return result;
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

  // Constants for spacing calculations
  private static readonly BASE_HOUSE_WIDTH_M = 10;
  private static readonly MIN_SCALE = 0.5;
  private static readonly TOWNHOUSE_DETECTION_DISTANCE_M = 5;
  private static readonly NEIGHBOR_SEARCH_RADIUS_M = 50;

  /**
   * Calculate distances to nearest neighbors on the same street
   * Returns a map of address_id to { left: distance | null, right: distance | null }
   */
  static calculateNeighborDistances(
    features: BuildingModelPoint[],
    addresses: Map<string, CampaignAddress>
  ): Map<string, { left: number | null; right: number | null }> {
    const distanceMap = new Map<string, { left: number | null; right: number | null }>();
    
    // Group features by street_name
    const streetGroups = new Map<string, BuildingModelPoint[]>();
    for (const feature of features) {
      const address = addresses.get(feature.properties.address_id);
      const streetName = feature.properties.street_name || address?.street_name;
      if (streetName) {
        if (!streetGroups.has(streetName)) {
          streetGroups.set(streetName, []);
        }
        streetGroups.get(streetName)!.push(feature);
      }
    }

    // For each feature, find neighbors on the same street
    for (const feature of features) {
      const address = addresses.get(feature.properties.address_id);
      const streetName = feature.properties.street_name || address?.street_name;
      if (!streetName) {
        distanceMap.set(feature.properties.address_id, { left: null, right: null });
        continue;
      }

      const streetFeatures = streetGroups.get(streetName) || [];
      if (streetFeatures.length < 2) {
        distanceMap.set(feature.properties.address_id, { left: null, right: null });
        continue;
      }

      const featurePoint = turf.point(feature.geometry.coordinates);
      const neighbors: Array<{ feature: BuildingModelPoint; distance: number }> = [];

      // Find all neighbors within search radius
      for (const neighbor of streetFeatures) {
        if (neighbor.properties.address_id === feature.properties.address_id) continue;
        
        const neighborPoint = turf.point(neighbor.geometry.coordinates);
        const distance = turf.distance(featurePoint, neighborPoint, { units: 'meters' });
        
        if (distance <= this.NEIGHBOR_SEARCH_RADIUS_M) {
          neighbors.push({ feature: neighbor, distance });
        }
      }

      // Sort by distance and find left/right neighbors based on bearing
      neighbors.sort((a, b) => a.distance - b.distance);
      
      // For now, use the minimum distance to either neighbor
      const minDistance = neighbors.length > 0 ? neighbors[0].distance : null;
      const secondDistance = neighbors.length > 1 ? neighbors[1].distance : null;

      distanceMap.set(feature.properties.address_id, {
        left: minDistance,
        right: secondDistance,
      });
    }

    return distanceMap;
  }

  /**
   * Calculate dynamic scale factor based on neighbor distance
   * Uses 70% rule: width = Math.min(baseWidth, neighborDistance * 0.7)
   * This ensures 30% gap between houses to prevent overlapping
   * Minimum scale: 0.5
   */
  static calculateDynamicScale(
    distanceToNeighbor: number | null,
    baseWidth: number = this.BASE_HOUSE_WIDTH_M,
    minScale: number = this.MIN_SCALE
  ): number {
    if (distanceToNeighbor === null) {
      return 1.0;
    }

    // 70% rule: width should be at most 70% of neighbor distance
    const constrainedWidth = Math.min(baseWidth, distanceToNeighbor * 0.7);
    const scale = constrainedWidth / baseWidth;
    return Math.max(scale, minScale);
  }

  /**
   * Detect townhouse clusters: addresses with same street_name and < 5m distance
   * Returns a map of address_id to cluster_id
   */
  static detectTownhouseClusters(
    features: BuildingModelPoint[],
    addresses: Map<string, CampaignAddress>
  ): Map<string, string> {
    const clusterMap = new Map<string, string>();
    const processed = new Set<string>();
    let clusterCounter = 0;

    // Group features by street_name
    const streetGroups = new Map<string, BuildingModelPoint[]>();
    for (const feature of features) {
      const address = addresses.get(feature.properties.address_id);
      const streetName = feature.properties.street_name || address?.street_name;
      if (streetName) {
        if (!streetGroups.has(streetName)) {
          streetGroups.set(streetName, []);
        }
        streetGroups.get(streetName)!.push(feature);
      }
    }

    // For each street, find clusters
    for (const [streetName, streetFeatures] of streetGroups.entries()) {
      // Find all pairs within townhouse detection distance
      for (let i = 0; i < streetFeatures.length; i++) {
        const feature1 = streetFeatures[i];
        if (processed.has(feature1.properties.address_id)) continue;

        const cluster: BuildingModelPoint[] = [feature1];
        const clusterId = `cluster-${clusterCounter++}`;

        for (let j = i + 1; j < streetFeatures.length; j++) {
          const feature2 = streetFeatures[j];
          if (processed.has(feature2.properties.address_id)) continue;

          const point1 = turf.point(feature1.geometry.coordinates);
          const point2 = turf.point(feature2.geometry.coordinates);
          const distance = turf.distance(point1, point2, { units: 'meters' });

          if (distance < this.TOWNHOUSE_DETECTION_DISTANCE_M) {
            cluster.push(feature2);
            processed.add(feature2.properties.address_id);
          }
        }

        // If cluster has more than one unit, mark all as townhouses
        if (cluster.length > 1) {
          for (const feature of cluster) {
            clusterMap.set(feature.properties.address_id, clusterId);
            processed.add(feature.properties.address_id);
          }
        }
      }
    }

    return clusterMap;
  }

  /**
   * Align townhouse cluster on a straight line parallel to road_bearing
   * Distributes units evenly along the line
   * For townhouses: width = neighborDistance (to make them touch but not overlap)
   * Depth is increased by 1.2x to represent narrow, deep units
   */
  static alignTownhouseCluster(
    cluster: BuildingModelPoint[],
    roadBearing: number,
    clusterId?: string,
    neighborDistance?: number
  ): BuildingModelPoint[] {
    if (cluster.length === 0) return cluster;

    // Sort cluster by position along the road (using bearing direction)
    const bearingRad = (roadBearing * Math.PI) / 180;
    const cosBearing = Math.cos(bearingRad);
    const sinBearing = Math.sin(bearingRad);

    // Project points onto road direction vector
    const projected = cluster.map((feature, index) => {
      const [lon, lat] = feature.geometry.coordinates;
      // Project onto road direction (simplified: use lon/lat as x/y)
      const projection = lon * cosBearing + lat * sinBearing;
      return { feature, projection, index };
    });

    // Sort by projection value
    projected.sort((a, b) => a.projection - b.projection);

    // Calculate unit width: use neighborDistance if provided, otherwise default to 4m
    // For townhouses, width = neighborDistance to make them touch but not overlap
    const unitWidthM = neighborDistance ?? 4.0;
    const totalLengthM = (cluster.length - 1) * unitWidthM;

    // Convert meters to degrees (approximate)
    const avgLat = cluster.reduce((sum, f) => sum + f.geometry.coordinates[1], 0) / cluster.length;
    const metersToDegrees = 1 / 111000; // 1 degree ≈ 111km
    const totalLengthDegrees = totalLengthM * metersToDegrees;

    // Calculate start point (centroid of cluster)
    const centroidLon = cluster.reduce((sum, f) => sum + f.geometry.coordinates[0], 0) / cluster.length;
    const centroidLat = cluster.reduce((sum, f) => sum + f.geometry.coordinates[1], 0) / cluster.length;

    // Distribute units along the line
    const alignedFeatures: BuildingModelPoint[] = [];
    for (let i = 0; i < projected.length; i++) {
      const { feature } = projected[i];
      const offset = (i - (cluster.length - 1) / 2) * (totalLengthDegrees / cluster.length);

      // Calculate new position along road bearing
      const newLon = centroidLon + offset * cosBearing;
      const newLat = centroidLat + offset * sinBearing;

      // Calculate scale factor for townhouse based on neighbor distance
      // Width = neighborDistance, so scale factor = neighborDistance / baseWidth
      const townhouseWidthMeters = unitWidthM;
      const townhouseScaleFactor = townhouseWidthMeters / this.BASE_HOUSE_WIDTH_M;

      alignedFeatures.push({
        ...feature,
        geometry: {
          ...feature.geometry,
          coordinates: [newLon, newLat],
        },
        properties: {
          ...feature.properties,
          is_townhouse: true,
          townhouse_cluster_id: clusterId,
          townhouse_unit_index: i,
          // Scale factor based on neighbor distance (width = neighborDistance)
          scale_factor: townhouseScaleFactor,
          width_meters: townhouseWidthMeters,
        },
      });
    }

    return alignedFeatures;
  }

  /**
   * Create a circular gradient shadow texture for contact shadows
   * Generates a canvas-based texture with a soft circular gradient
   * from rgba(0, 0, 0, 0.5) at center to rgba(0, 0, 0, 0) at edges
   * 
   * @param size - Canvas size in pixels (default: 256)
   * @returns THREE.Texture instance
   */
  static createShadowTexture(size: number = 256): THREE.Texture {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Failed to get canvas context');
    }
    
    // Create radial gradient from center to edge
    const centerX = size / 2;
    const centerY = size / 2;
    const radius = size / 2;
    
    const gradient = context.createRadialGradient(
      centerX, centerY, 0,      // Inner circle (center)
      centerX, centerY, radius   // Outer circle (edge)
    );
    
    // Gradient from semi-transparent black at center to fully transparent at edges
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0.5)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    
    // Fill canvas with gradient
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
    
    // Create Three.js texture from canvas
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    
    return texture;
  }

  /**
   * Gold Standard: Create BuildingModelPoints from buildings using BuildingService
   * Uses vector-based orientation and neighbor-aware spatial scaling
   * 
   * @param buildings - Array of Building objects (already filtered for is_hidden = false)
   * @param roadGeometry - Optional road geometry for orientation calculation
   * @param modelId - Model identifier
   * @returns Array of BuildingModelPoints ready for 3D rendering
   */
  static async createBuildingModelPointsFromBuildings(
    buildings: Building[],
    roadGeometry?: LineString | turf.Feature<LineString>,
    modelId: string = 'house-model'
  ): Promise<BuildingModelPoint[]> {
    const modelPoints: BuildingModelPoint[] = [];

    for (const building of buildings) {
      try {
        // Parse centroid for coordinates
        const centroidGeoJSON = typeof building.centroid === 'string'
          ? JSON.parse(building.centroid)
          : building.centroid;
        
        const centroid = centroidGeoJSON.type === 'Feature'
          ? centroidGeoJSON.geometry
          : centroidGeoJSON;

        if (centroid.type !== 'Point') {
          console.warn(`Building ${building.id} has invalid centroid geometry`);
          continue;
        }

        const [lon, lat] = centroid.coordinates;

        // Calculate orientation and spatial scale using BuildingService
        let houseBearing = 0;
        let setbackPoint: turf.Point | null = null;
        let spatialScale = { scaleFactor: 1.0, widthMeters: this.BASE_HOUSE_WIDTH_M, minDistance: Infinity };

        if (roadGeometry) {
          // Use BuildingService for vector-based orientation
          const orientation = BuildingService.calculateHouseBearing(building, roadGeometry);
          houseBearing = orientation.houseBearing;

          // Calculate setback
          setbackPoint = BuildingService.calculateSetback(
            centroid,
            orientation.nearestPointOnRoad
          );
        } else {
          // Fallback: use centroid directly if no road geometry
          setbackPoint = turf.point([lon, lat]);
        }

        // Find neighbors and calculate spatial scale (70% rule)
        const neighbors = await BuildingService.findNearestNeighbors(building);
        spatialScale = BuildingService.calculateSpatialScale(building, neighbors);

        // Use setback point coordinates if available, otherwise use centroid
        const finalCoords = setbackPoint
          ? setbackPoint.coordinates as [number, number]
          : [lon, lat];

        modelPoints.push({
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: finalCoords,
          },
          properties: {
            'model-id': modelId,
            'house_bearing': houseBearing,
            'building_id': building.id,
            'gers_id': building.gers_id, // Add GERS ID for Overture lookup
            'latest_status': building.latest_status,
            'scale_factor': spatialScale.scaleFactor,
            'width_meters': spatialScale.widthMeters,
            'is_townhouse': false,
          },
        });
      } catch (error) {
        console.error(`Error processing building ${building.id}:`, error);
        continue;
      }
    }

    return modelPoints;
  }
}

