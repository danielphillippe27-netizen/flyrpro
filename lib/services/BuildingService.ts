import { createClient } from '@/lib/supabase/client';
import type { Building, BuildingInteraction, BuildingStatus } from '@/types/database';
import * as turf from '@turf/turf';
import type { Feature, Point, LineString, MultiPolygon, Polygon } from '@turf/turf';

export interface HouseOrientation {
  houseBearing: number; // Bearing from centroid to nearest point on road (0-360)
  nearestPointOnRoad: Point; // The closest point on the road to the building centroid
  setbackPoint: Point; // Final placement point after applying setback
}

export interface NeighborInfo {
  building: Building;
  distance: number; // Distance in meters
}

export interface SpatialScaleResult {
  scaleFactor: number; // Multiplier for model width (0.0 - 1.0)
  widthMeters: number; // Calculated width in meters
  minDistance: number; // Minimum distance to nearest neighbor
}

export class BuildingService {
  private static client = createClient();
  private static readonly BASE_HOUSE_WIDTH_M = 10; // Base width in meters
  private static readonly DEFAULT_SETBACK_M = 10; // Overture standard: 10 meters from road center
  private static readonly MAX_HOUSE_WIDTH_M = 12; // Maximum house width constraint
  private static readonly NEIGHBOR_SEARCH_RADIUS_M = 50; // Search radius for neighbors
  private static readonly NEIGHBOR_COUNT = 3; // Number of nearest neighbors to find
  private static readonly SCALE_RULE_PERCENT = 0.7; // 70% rule for width calculation

  /**
   * Calculate house bearing using vector-based orientation
   * Finds the nearest point on the road from the building centroid,
   * then calculates the bearing from centroid to that point.
   * 
   * @param building - Building with centroid geometry
   * @param roadGeometry - Road line geometry (LineString or MultiLineString)
   * @returns HouseOrientation with bearing and points
   */
  static calculateHouseBearing(
    building: Building,
    roadGeometry: LineString | Feature<LineString>
  ): HouseOrientation {
    // Parse building centroid
    const centroidGeoJSON = typeof building.centroid === 'string'
      ? JSON.parse(building.centroid)
      : building.centroid;
    
    const centroid = centroidGeoJSON.type === 'Feature'
      ? centroidGeoJSON.geometry
      : centroidGeoJSON;
    
    if (centroid.type !== 'Point') {
      throw new Error('Building centroid must be a Point geometry');
    }

    const centroidPoint = turf.point(centroid.coordinates);
    
    // Ensure roadGeometry is a Feature<LineString>
    const roadLine = roadGeometry.type === 'Feature'
      ? roadGeometry
      : turf.lineString((roadGeometry as LineString).coordinates);

    // Find nearest point on road using Turf.js
    const nearestPoint = turf.nearestPointOnLine(roadLine, centroidPoint, { units: 'meters' });
    
    // Calculate bearing from centroid to nearest point on road
    // This gives us the direction the house should face (toward the street)
    const houseBearing = turf.bearing(centroidPoint, nearestPoint.geometry);
    
    // Normalize bearing to 0-360 range
    const normalizedBearing = houseBearing < 0 ? houseBearing + 360 : houseBearing;

    return {
      houseBearing: normalizedBearing,
      nearestPointOnRoad: nearestPoint.geometry,
      setbackPoint: nearestPoint.geometry, // Will be updated by calculateSetback
    };
  }

  /**
   * Calculate setback position for house placement
   * Moves the placement point 10 meters along the vector from
   * nearestPointOnRoad to centroid, ensuring the house sits properly within its parcel.
   * Overture standard: 10 meters from road center to building placement.
   * 
   * @param centroid - Building centroid point
   * @param nearestPointOnRoad - Nearest point on road
   * @param distanceMeters - Setback distance (default: 10m per Overture standard)
   * @returns Point geometry for final house placement
   */
  static calculateSetback(
    centroid: Point | Feature<Point>,
    nearestPointOnRoad: Point | Feature<Point>,
    distanceMeters: number = this.DEFAULT_SETBACK_M
  ): Point {
    const centroidPoint = centroid.type === 'Feature' ? centroid : turf.point(centroid.coordinates);
    const roadPoint = nearestPointOnRoad.type === 'Feature'
      ? nearestPointOnRoad
      : turf.point(nearestPointOnRoad.coordinates);

    // Calculate bearing from nearestPointOnRoad to centroid
    // This is the direction we want to move along
    const bearing = turf.bearing(roadPoint, centroidPoint);
    
    // Use turf.destination to move along the vector from road to centroid
    // This handles Earth's curvature correctly
    const setbackPoint = turf.destination(roadPoint, distanceMeters, bearing, { units: 'meters' });
    
    return setbackPoint.geometry;
  }

  /**
   * Find nearest neighbor buildings within a specified radius
   * Performs spatial search to find the N nearest neighbor footprints.
   * 
   * @param building - Building to find neighbors for
   * @param radiusMeters - Search radius (default: 50m)
   * @param count - Number of neighbors to find (default: 3)
   * @returns Array of neighbor info sorted by distance
   */
  static async findNearestNeighbors(
    building: Building,
    radiusMeters: number = this.NEIGHBOR_SEARCH_RADIUS_M,
    count: number = this.NEIGHBOR_COUNT,
    campaignId?: string
  ): Promise<NeighborInfo[]> {
    // Parse building geometry
    const buildingGeoJSON = typeof building.geom === 'string'
      ? JSON.parse(building.geom)
      : building.geom;
    
    const buildingGeom = buildingGeoJSON.type === 'Feature'
      ? buildingGeoJSON.geometry
      : buildingGeoJSON;

    // Parse centroid for distance calculations
    const centroidGeoJSON = typeof building.centroid === 'string'
      ? JSON.parse(building.centroid)
      : building.centroid;
    
    const centroid = centroidGeoJSON.type === 'Feature'
      ? centroidGeoJSON.geometry
      : centroidGeoJSON;

    if (centroid.type !== 'Point') {
      throw new Error('Building centroid must be a Point geometry');
    }

    const buildingCentroid = turf.point(centroid.coordinates);

    // Query for buildings within radius using PostGIS
    // Using ST_DWithin for efficient spatial search
    // Filter by campaign_id if provided (mission-based exclusivity)
    let query = this.client
      .from('buildings')
      .select('id, gers_id, geom, centroid, latest_status, is_hidden, campaign_id')
      .eq('is_hidden', false)
      .neq('id', building.id);
    
    // Filter by campaign_id if provided (mission-based exclusivity)
    if (campaignId) {
      query = query.eq('campaign_id', campaignId);
    }
    
    const { data: nearbyBuildings, error } = await query.limit(100); // Get more than needed, then filter and sort

    if (error) {
      console.error('Error fetching nearby buildings:', error);
      return [];
    }

    if (!nearbyBuildings || nearbyBuildings.length === 0) {
      return [];
    }

    // Calculate distances and filter by radius
    const neighbors: NeighborInfo[] = [];

    for (const neighbor of nearbyBuildings) {
      try {
        const neighborCentroidGeoJSON = typeof neighbor.centroid === 'string'
          ? JSON.parse(neighbor.centroid)
          : neighbor.centroid;
        
        const neighborCentroid = neighborCentroidGeoJSON.type === 'Feature'
          ? neighborCentroidGeoJSON.geometry
          : neighborCentroidGeoJSON;

        if (neighborCentroid.type !== 'Point') continue;

        const neighborPoint = turf.point(neighborCentroid.coordinates);
        const distance = turf.distance(buildingCentroid, neighborPoint, { units: 'meters' });

        if (distance <= radiusMeters) {
          neighbors.push({
            building: neighbor as Building,
            distance,
          });
        }
      } catch (e) {
        console.warn('Error processing neighbor building:', e);
        continue;
      }
    }

    // Sort by distance and return top N
    neighbors.sort((a, b) => a.distance - b.distance);
    return neighbors.slice(0, count);
  }

  /**
   * Calculate spatial scale using the 70% rule with 12m maximum
   * Implements: width = min(0.7 * minDistance, 12)
   * This ensures guaranteed "lawn" gaps while capping maximum house width.
   * 
   * @param building - Building to calculate scale for
   * @param neighbors - Nearest neighbor information
   * @returns SpatialScaleResult with scale factor and width
   */
  static calculateSpatialScale(
    building: Building,
    neighbors: NeighborInfo[]
  ): SpatialScaleResult {
    if (neighbors.length === 0) {
      // No neighbors found, use base width (capped at 12m)
      return {
        scaleFactor: 1.0,
        widthMeters: Math.min(this.BASE_HOUSE_WIDTH_M, this.MAX_HOUSE_WIDTH_M),
        minDistance: Infinity,
      };
    }

    // Find minimum distance to nearest neighbor using turf.distance between centroids
    const minDistance = Math.min(...neighbors.map(n => n.distance));

    // Apply 70% rule with 12m cap: width = min(0.7 * minDistance, 12)
    // This ensures 30% gap between structures, capped at 12m max width
    const constrainedWidth = Math.min(
      minDistance * this.SCALE_RULE_PERCENT,
      this.MAX_HOUSE_WIDTH_M
    );
    
    // Calculate scale factor relative to base width
    const scaleFactor = constrainedWidth / this.BASE_HOUSE_WIDTH_M;

    return {
      scaleFactor: Math.max(scaleFactor, 0.1), // Minimum scale of 0.1 (10%)
      widthMeters: constrainedWidth,
      minDistance,
    };
  }

  /**
   * Complete orientation and placement calculation
   * Combines bearing calculation, setback, and spatial scaling.
   * 
   * @param building - Building to process
   * @param roadGeometry - Road line geometry
   * @returns Complete orientation and placement data
   */
  static async calculateCompleteOrientation(
    building: Building,
    roadGeometry: LineString | Feature<LineString>
  ): Promise<{
    orientation: HouseOrientation;
    setbackPoint: Point;
    spatialScale: SpatialScaleResult;
  }> {
    // Calculate house bearing
    const orientation = this.calculateHouseBearing(building, roadGeometry);

    // Calculate setback position
    const setbackPoint = this.calculateSetback(
      typeof building.centroid === 'string'
        ? JSON.parse(building.centroid)
        : building.centroid,
      orientation.nearestPointOnRoad
    );

    // Find neighbors and calculate spatial scale
    const neighbors = await this.findNearestNeighbors(building);
    const spatialScale = this.calculateSpatialScale(building, neighbors);

    return {
      orientation: {
        ...orientation,
        setbackPoint,
      },
      setbackPoint,
      spatialScale,
    };
  }

  /**
   * Fetch building by ID
   */
  static async fetchBuilding(buildingId: string): Promise<Building | null> {
    const { data, error } = await this.client
      .from('buildings')
      .select('*')
      .eq('id', buildingId)
      .single();

    if (error) {
      console.error('Error fetching building:', error);
      return null;
    }

    return data as Building;
  }

  /**
   * Fetch building by GERS ID
   */
  static async fetchBuildingByGersId(gersId: string): Promise<Building | null> {
    const { data, error } = await this.client
      .from('buildings')
      .select('*')
      .eq('gers_id', gersId)
      .single();

    if (error) {
      console.error('Error fetching building by GERS ID:', error);
      return null;
    }

    return data as Building;
  }

  /**
   * Fetch all visible buildings (is_hidden = false)
   * @deprecated Use fetchCampaignBuildings for campaign-specific queries
   */
  static async fetchVisibleBuildings(): Promise<Building[]> {
    const { data, error } = await this.client
      .from('buildings')
      .select('*')
      .eq('is_hidden', false)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching visible buildings:', error);
      return [];
    }

    return (data || []) as Building[];
  }

  /**
   * Fetch buildings for a specific campaign
   * Mission-based provisioning: Only returns buildings tagged with campaign_id
   */
  static async fetchCampaignBuildings(campaignId: string): Promise<Building[]> {
    const { data, error } = await this.client
      .from('buildings')
      .select('*')
      .eq('campaign_id', campaignId)
      .eq('is_hidden', false)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching campaign buildings:', error);
      return [];
    }

    return (data || []) as Building[];
  }

  /**
   * Fetch interaction history for a building
   */
  static async fetchBuildingInteractions(buildingId: string): Promise<BuildingInteraction[]> {
    const { data, error } = await this.client
      .from('building_interactions')
      .select('*')
      .eq('building_id', buildingId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching building interactions:', error);
      return [];
    }

    return (data || []) as BuildingInteraction[];
  }

  /**
   * Create a new building interaction
   * This will trigger the database trigger to update latest_status
   */
  static async createInteraction(
    buildingId: string,
    status: BuildingStatus,
    notes?: string,
    userId?: string
  ): Promise<BuildingInteraction | null> {
    const { data, error } = await this.client
      .from('building_interactions')
      .insert({
        building_id: buildingId,
        status,
        notes,
        user_id: userId,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating interaction:', error);
      return null;
    }

    return data as BuildingInteraction;
  }

  /**
   * Hide a building (set is_hidden = true)
   */
  static async hideBuilding(buildingId: string): Promise<boolean> {
    const { error } = await this.client
      .from('buildings')
      .update({ is_hidden: true })
      .eq('id', buildingId);

    if (error) {
      console.error('Error hiding building:', error);
      return false;
    }

    return true;
  }

  /**
   * Find nearest Overture transportation segment for orientation
   * Queries the overture_transportation table in Supabase
   * 
   * @param building - Building with centroid
   * @returns LineString geometry of nearest road segment, or null if not found
   */
  static async findNearestTransportationSegment(
    building: Building
  ): Promise<LineString | Feature<LineString> | null> {
    // Parse centroid
    const centroidGeoJSON = typeof building.centroid === 'string'
      ? JSON.parse(building.centroid)
      : building.centroid;
    
    const centroid = centroidGeoJSON.type === 'Feature'
      ? centroidGeoJSON.geometry
      : centroidGeoJSON;

    if (centroid.type !== 'Point') {
      return null;
    }

    const [lon, lat] = centroid.coordinates;

    // Query Supabase for nearest transportation segment using PostGIS
    // Using RPC function for spatial distance query
    const { data, error } = await this.client
      .rpc('find_nearest_transportation', {
        p_lon: lon,
        p_lat: lat,
        p_radius: 100, // Search within 100 meters
      });

    if (error) {
      console.error('Error finding nearest transportation:', error);
      // Fallback: try direct query if RPC doesn't exist
      const { data: fallbackData } = await this.client
        .from('overture_transportation')
        .select('geom')
        .limit(10); // Get a few segments and find nearest client-side

      if (fallbackData && fallbackData.length > 0) {
        // Find nearest using Turf.js
        const buildingPoint = turf.point([lon, lat]);
        let nearest: any = null;
        let minDist = Infinity;

        for (const segment of fallbackData) {
          const segmentGeom = typeof segment.geom === 'string' 
            ? JSON.parse(segment.geom) 
            : segment.geom;
          const segmentLine = segmentGeom.type === 'Feature'
            ? segmentGeom
            : turf.lineString(segmentGeom.coordinates);
          
          const dist = turf.pointToLineDistance(buildingPoint, segmentLine, { units: 'meters' });
          if (dist < minDist) {
            minDist = dist;
            nearest = segmentLine;
          }
        }

        return nearest;
      }

      return null;
    }

    if (data && data.geom) {
      const geom = typeof data.geom === 'string' ? JSON.parse(data.geom) : data.geom;
      return geom.type === 'Feature' ? geom : turf.lineString(geom.coordinates);
    }

    return null;
  }
}

