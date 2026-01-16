import * as turf from '@turf/turf';
import type { CampaignAddress } from '@/types/database';
import type { GeoJSON } from 'geojson';

export interface OrientationResult {
  addressId: string;
  roadBearing: number;
  houseBearing: number;
  streetName: string;
  success: boolean;
  error?: string;
}

export class OrientationService {
  private static readonly MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || '';
  private static readonly MAPBOX_BASE_URL = 'https://api.mapbox.com';

  /**
   * Main entry point: Compute orientation for a list of addresses
   */
  static async computeAddressOrientation(
    addresses: CampaignAddress[]
  ): Promise<OrientationResult[]> {
    const results: OrientationResult[] = [];

    // Filter out addresses that are already oriented and locked
    const unorientedAddresses = addresses.filter(
      (addr) => !addr.is_oriented && !addr.orientation_locked
    );

    if (unorientedAddresses.length === 0) {
      return results;
    }

    // Extract street names for all addresses
    const addressesWithStreet = unorientedAddresses.map((addr) => ({
      ...addr,
      extractedStreetName: this.extractStreetName(addr.address || addr.formatted || ''),
    }));

    // Group addresses by street name (primary) or proximity (fallback)
    const groups = this.groupAddressesByStreet(addressesWithStreet);

    // Process each group
    for (const group of groups) {
      try {
        const groupResults = await this.processAddressGroup(group);
        results.push(...groupResults);
      } catch (error) {
        // If group processing fails, mark all addresses in group as failed
        console.error('Error processing address group:', error);
        for (const addr of group) {
          results.push({
            addressId: addr.id,
            roadBearing: 0,
            houseBearing: 0,
            streetName: addr.extractedStreetName,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }
    }

    return results;
  }

  /**
   * Group addresses by street name (primary) or proximity (fallback)
   */
  private static groupAddressesByStreet(
    addresses: Array<CampaignAddress & { extractedStreetName: string }>
  ): Array<Array<CampaignAddress & { extractedStreetName: string }>> {
    const groups: Array<Array<CampaignAddress & { extractedStreetName: string }>> = [];
    const processed = new Set<string>();

    // Primary: Group by street name
    const streetGroups = new Map<string, Array<CampaignAddress & { extractedStreetName: string }>>();

    for (const addr of addresses) {
      const streetName = addr.extractedStreetName || addr.street_name;
      
      if (streetName && streetName.trim().length > 0) {
        const normalizedStreet = this.normalizeStreetName(streetName);
        if (!streetGroups.has(normalizedStreet)) {
          streetGroups.set(normalizedStreet, []);
        }
        streetGroups.get(normalizedStreet)!.push(addr);
      }
    }

    // Add street-based groups
    for (const [streetName, group] of streetGroups.entries()) {
      if (group.length > 0) {
        groups.push(group);
        group.forEach((addr) => processed.add(addr.id));
      }
    }

    // Fallback: Group remaining addresses by proximity (50-100m)
    const remaining = addresses.filter((addr) => !processed.has(addr.id));
    if (remaining.length > 0) {
      const proximityGroups = this.groupByProximity(remaining, 75); // 75m threshold
      groups.push(...proximityGroups);
    }

    return groups;
  }

  /**
   * Group addresses by proximity using Turf.js
   */
  private static groupByProximity(
    addresses: Array<CampaignAddress & { extractedStreetName: string }>,
    thresholdMeters: number
  ): Array<Array<CampaignAddress & { extractedStreetName: string }>> {
    const groups: Array<Array<CampaignAddress & { extractedStreetName: string }>> = [];
    const processed = new Set<string>();

    for (const addr of addresses) {
      if (processed.has(addr.id)) continue;

      const coord = this.getCoordinate(addr);
      if (!coord) continue;

      const group: Array<CampaignAddress & { extractedStreetName: string }> = [addr];
      processed.add(addr.id);

      // Find nearby addresses
      for (const otherAddr of addresses) {
        if (processed.has(otherAddr.id)) continue;

        const otherCoord = this.getCoordinate(otherAddr);
        if (!otherCoord) continue;

        const distance = turf.distance(
          [coord.lon, coord.lat],
          [otherCoord.lon, otherCoord.lat],
          { units: 'meters' }
        );

        if (distance <= thresholdMeters) {
          group.push(otherAddr);
          processed.add(otherAddr.id);
        }
      }

      if (group.length > 0) {
        groups.push(group);
      }
    }

    return groups;
  }

  /**
   * Process a group of addresses using Mapbox Map Matching API
   */
  private static async processAddressGroup(
    group: Array<CampaignAddress & { extractedStreetName: string }>
  ): Promise<OrientationResult[]> {
    const results: OrientationResult[] = [];

    // Get coordinates for all addresses in group
    const coordinates: Array<{ coord: [number, number]; address: CampaignAddress }> = [];
    for (const addr of group) {
      const coord = this.getCoordinate(addr);
      if (coord) {
        coordinates.push({
          coord: [coord.lon, coord.lat],
          address: addr,
        });
      }
    }

    if (coordinates.length === 0) {
      // No valid coordinates, mark all as failed
      for (const addr of group) {
        results.push({
          addressId: addr.id,
          roadBearing: 0,
          houseBearing: 0,
          streetName: addr.extractedStreetName,
          success: false,
          error: 'No valid coordinates',
        });
      }
      return results;
    }

    // Fetch road geometry using Mapbox Map Matching API
    let roadGeometry: GeoJSON.LineString | null = null;
    try {
      roadGeometry = await this.fetchRoadGeometry(
        coordinates.map((c) => c.coord)
      );
    } catch (error) {
      console.error('Error fetching road geometry:', error);
      // Mark all as failed
      for (const addr of group) {
        results.push({
          addressId: addr.id,
          roadBearing: 0,
          houseBearing: 0,
          streetName: addr.extractedStreetName,
          success: false,
          error: error instanceof Error ? error.message : 'Failed to fetch road geometry',
        });
      }
      return results;
    }

    if (!roadGeometry || roadGeometry.coordinates.length < 2) {
      // No road found, mark all as oriented with default bearing
      for (const addr of group) {
        results.push({
          addressId: addr.id,
          roadBearing: 0,
          houseBearing: 0,
          streetName: addr.extractedStreetName,
          success: true, // Mark as success but with default bearing
        });
      }
      return results;
    }

    // Calculate road bearing from geometry
    const roadBearing = this.calculateRoadBearing(roadGeometry);

    // Calculate house bearing for each address
    for (const { coord, address } of coordinates) {
      try {
        const houseBearing = this.calculateSmartBearing(
          coord,
          address.extractedStreetName,
          roadGeometry
        );

        results.push({
          addressId: address.id,
          roadBearing,
          houseBearing,
          streetName: address.extractedStreetName,
          success: true,
        });
      } catch (error) {
        results.push({
          addressId: address.id,
          roadBearing,
          houseBearing: 0,
          streetName: address.extractedStreetName,
          success: false,
          error: error instanceof Error ? error.message : 'Failed to calculate house bearing',
        });
      }
    }

    return results;
  }

  /**
   * Fetch road geometry using Mapbox Map Matching API
   */
  private static async fetchRoadGeometry(
    coordinates: [number, number][]
  ): Promise<GeoJSON.LineString> {
    if (!this.MAPBOX_TOKEN) {
      throw new Error('Mapbox token not configured');
    }

    // Map Matching API requires coordinates in specific format
    // We'll use the Directions API instead for simplicity, or Map Matching if available
    // For now, let's use a simplified approach: get directions between first and last point
    // This gives us a road segment we can use

    if (coordinates.length < 2) {
      throw new Error('Need at least 2 coordinates');
    }

    // Use Directions API to get route geometry
    const start = coordinates[0];
    const end = coordinates[coordinates.length - 1];

    const url = `${this.MAPBOX_BASE_URL}/directions/v5/mapbox/driving/${start[0]},${start[1]};${end[0]},${end[1]}?geometries=geojson&access_token=${this.MAPBOX_TOKEN}`;

    const response = await fetch(url);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Mapbox API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    if (!data.routes || data.routes.length === 0) {
      throw new Error('No route found');
    }

    const route = data.routes[0];
    if (!route.geometry || route.geometry.type !== 'LineString') {
      throw new Error('Invalid route geometry');
    }

    return route.geometry as GeoJSON.LineString;
  }

  /**
   * Calculate road bearing from LineString geometry
   */
  private static calculateRoadBearing(geometry: GeoJSON.LineString): number {
    const coords = geometry.coordinates;
    if (coords.length < 2) {
      return 0;
    }

    // Use first and last point, or two points from the middle for better accuracy
    const startIdx = Math.floor(coords.length * 0.1);
    const endIdx = Math.floor(coords.length * 0.9);

    const start = coords[startIdx] as [number, number];
    const end = coords[endIdx] as [number, number];

    // Calculate bearing using Turf.js
    const bearing = turf.bearing(start, end);

    // Normalize to 0-360
    return bearing < 0 ? bearing + 360 : bearing;
  }

  /**
   * Calculate house bearing based on road bearing and house position
   */
  private static calculateSmartBearing(
    housePoint: [number, number],
    streetName: string,
    roadLine: GeoJSON.LineString
  ): number {
    const normalizedStreet = this.normalizeStreetName(streetName || '');
    if (!normalizedStreet) {
      // Fall back to geometry-only logic when street name is missing
      return this.calculateBearingToRoad(housePoint, roadLine);
    }

    // Grouping by street name already happens upstream; keep the hook here
    // for future road-name matching when richer road metadata is available.
    return this.calculateBearingToRoad(housePoint, roadLine);
  }

  private static calculateBearingToRoad(
    housePoint: [number, number],
    roadLine: GeoJSON.LineString
  ): number {
    // Find the closest point on the road line to the house
    const closestPoint = turf.nearestPointOnLine(roadLine, housePoint);

    // Bearing from house to the closest point on the road
    const bearing = turf.bearing(
      turf.point(housePoint),
      closestPoint.geometry
    );

    // Normalize to 0-360
    return bearing < 0 ? bearing + 360 : bearing;
  }

  /**
   * Extract street name from address string
   */
  static extractStreetName(address: string): string {
    if (!address) return '';

    // Common patterns:
    // "123 Main St, Toronto, ON" -> "Main St"
    // "456 Oak Avenue" -> "Oak Avenue"
    // "789 Park Road, Apt 2" -> "Park Road"

    // Remove common suffixes and prefixes
    let cleaned = address.trim();

    // Remove postal codes (e.g., "M5H 2N2" or "90210")
    cleaned = cleaned.replace(/\b[A-Z0-9]{3,}\s?[A-Z0-9]{3,}\b/g, '');

    // Remove city/state/province (everything after last comma)
    const parts = cleaned.split(',').map((p) => p.trim());
    if (parts.length > 1) {
      cleaned = parts[0];
    }

    // Extract street name (everything after the first number)
    const match = cleaned.match(/\d+\s+(.+)/);
    if (match && match[1]) {
      let streetName = match[1].trim();

      // Remove apartment/unit numbers
      streetName = streetName.replace(/\s*(Apt|Unit|Suite|#)\s*\d+/i, '');

      return streetName.trim();
    }

    // If no number found, try to extract the street part
    // Remove common prefixes
    cleaned = cleaned.replace(/^(PO\s*Box|P\.?O\.?\s*Box)\s*\d+/i, '');

    return cleaned.trim();
  }

  /**
   * Normalize street name for grouping
   */
  private static normalizeStreetName(streetName: string): string {
    return streetName
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/\b(st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|ct|court|pl|place|way|cir|circle)\b/gi, (match) => {
        const abbrev: Record<string, string> = {
          street: 'st',
          avenue: 'ave',
          road: 'rd',
          boulevard: 'blvd',
          drive: 'dr',
          lane: 'ln',
          court: 'ct',
          place: 'pl',
          circle: 'cir',
        };
        return abbrev[match.toLowerCase()] || match.toLowerCase();
      })
      .trim();
  }

  /**
   * Get coordinate from address (from coordinate field or geom)
   */
  private static getCoordinate(
    address: CampaignAddress
  ): { lat: number; lon: number } | null {
    // Try direct coordinate
    if (address.coordinate) {
      return address.coordinate;
    }

    // Try parsing from geom
    if (address.geom) {
      try {
        const geom = typeof address.geom === 'string' ? JSON.parse(address.geom) : address.geom;
        if (geom && geom.coordinates && Array.isArray(geom.coordinates) && geom.coordinates.length >= 2) {
          return { lon: geom.coordinates[0], lat: geom.coordinates[1] };
        }
      } catch (e) {
        // Invalid geometry
      }
    }

    return null;
  }
}


