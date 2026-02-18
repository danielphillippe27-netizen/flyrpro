/**
 * Tile Lambda Service - Hybrid Provisioning
 * 
 * This service implements the "Gold Standard" architecture:
 * - Calls Lambda to generate campaign snapshots from tiled S3 data
 * - Lambda queries flyr-data-lake (master tiled data)
 * - Lambda writes to flyr-snapshots (campaign assets with 30-day TTL)
 * - Only addresses (leads) are ingested into Supabase
 * - Buildings/Roads stay in S3 for direct rendering
 * 
 * Environment Variables:
 * - SLICE_LAMBDA_URL: The Lambda function URL
 * - SLICE_SHARED_SECRET: Auth secret for Lambda
 */

export interface LambdaSnapshotResponse {
  campaign_id: string;
  bucket: string;
  prefix: string;
  counts: {
    buildings: number;
    addresses: number;
    roads: number;
  };
  s3_keys: {
    buildings: string;
    addresses: string;
    metadata: string;
    roads?: string;
  };
  urls: {
    buildings: string;
    addresses: string;
    metadata: string;
    roads?: string;
  };
  warning?: string;
  metadata?: {
    elapsed_ms: number;
    snapshot_size_bytes: number;
    overture_release?: string;
    tile_metrics?: {
      tiles_requested: number;
      tiles_found: number;
      tiles_scanned: number;
      features_returned?: number;
      timing_ms?: {
        tile_check: number;
        query: number;
        total: number;
      };
    };
  };
}

export interface AddressFeature {
  type: 'Feature';
  geometry: {
    type: 'Point';
    coordinates: [number, number];
  };
  properties: {
    layer: 'addresses';
    id: string;
    label: string;
    gers_id: string;
    formatted: string;
    house_number?: string;
    street_name?: string;
    unit?: string;
    city?: string;
    postal_code?: string;
    state?: string;
  };
}

export interface AddressGeoJSON {
  type: 'FeatureCollection';
  features: AddressFeature[];
}

export class TileLambdaService {
  private static get LAMBDA_URL(): string {
    const url = process.env.SLICE_LAMBDA_URL;
    if (!url) {
      throw new Error('SLICE_LAMBDA_URL environment variable is required');
    }
    return url;
  }

  private static get SHARED_SECRET(): string {
    const secret = process.env.SLICE_SHARED_SECRET;
    if (!secret) {
      throw new Error('SLICE_SHARED_SECRET environment variable is required');
    }
    return secret;
  }

  /**
   * Generate campaign snapshots via Lambda
   * 
   * @param polygon - GeoJSON Polygon for the campaign area
   * @param region - Region code (e.g., "ON" for Ontario)
   * @param campaignId - Campaign UUID
   * @param options - Optional limits
   */
  static async generateSnapshots(
    polygon: GeoJSON.Polygon,
    region: string,
    campaignId: string,
    options?: {
      limitBuildings?: number;
      limitAddresses?: number;
      limitRoads?: number;
      includeRoads?: boolean;
    }
  ): Promise<LambdaSnapshotResponse> {
    const startTime = Date.now();
    
    console.log('[TileLambda] Generating snapshots for campaign:', campaignId);
    console.log('[TileLambda] Region:', region);
    console.log('[TileLambda] Polygon bbox:', this.calculateBBox(polygon));

    const response = await fetch(this.LAMBDA_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-slice-secret': this.SHARED_SECRET,
      },
      body: JSON.stringify({
        polygon,
        region: region.toUpperCase(),
        state: region.toUpperCase(), // Lambda uses both
        campaign_id: campaignId,
        limitBuildings: options?.limitBuildings ?? 5000,
        limitAddresses: options?.limitAddresses ?? 5000,
        limitRoads: options?.limitRoads ?? 1000,
        includeRoads: options?.includeRoads ?? true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[TileLambda] Lambda error:', response.status, errorText);
      let message = errorText;
      try {
        const errJson = JSON.parse(errorText) as { error?: string; message?: string };
        message = errJson.error ?? errJson.message ?? errorText;
      } catch {
        // keep errorText
      }
      if (response.status === 502) {
        console.error('[TileLambda] 502 usually means Lambda crashed or timed out. Check CloudWatch Logs for the function.');
      }
      throw new Error(`Lambda failed (${response.status}): ${message}`);
    }

    const result: LambdaSnapshotResponse = await response.json();
    const elapsed = Date.now() - startTime;
    
    console.log('[TileLambda] Snapshots generated in', elapsed, 'ms');
    console.log('[TileLambda] Buildings:', result.counts.buildings);
    console.log('[TileLambda] Addresses:', result.counts.addresses);
    console.log('[TileLambda] Roads:', result.counts.roads);
    
    if (result.warning) {
      console.warn('[TileLambda] Warning:', result.warning);
    }

    return result;
  }

  /**
   * Download and parse addresses from S3
   * This is for the "lean ingest" - only addresses go into Supabase
   */
  static async downloadAddresses(url: string): Promise<AddressGeoJSON> {
    console.log('[TileLambda] Downloading addresses from S3...');
    
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Failed to download addresses: ${response.status}`);
    }

    // The file is gzipped, but S3/CloudFront should handle decompression
    // If not, we'd need to decompress here
    const data: AddressGeoJSON = await response.json();
    
    console.log('[TileLambda] Downloaded', data.features.length, 'addresses');
    return data;
  }

  /**
   * Get direct S3 URL for buildings (for iOS app to render)
   * The iOS app will download and render directly from S3
   */
  static getBuildingsUrl(snapshot: LambdaSnapshotResponse): string {
    return snapshot.urls.buildings;
  }

  /**
   * Get direct S3 URL for roads (for iOS app to render)
   */
  static getRoadsUrl(snapshot: LambdaSnapshotResponse): string | undefined {
    return snapshot.urls.roads;
  }

  /**
   * Convert address features to campaign_addresses format
   * This is the "lean" version - only essential lead tracking data
   */
  static convertToCampaignAddresses(
    features: AddressFeature[],
    campaignId: string
  ): Array<{
    campaign_id: string;
    gers_id: string;
    house_number?: string;
    street_name?: string;
    postal_code?: string;
    locality?: string;
    formatted?: string;
    geom: { type: 'Point'; coordinates: [number, number] };
    status?: string;
  }> {
    return features.map((f) => ({
      campaign_id: campaignId,
      gers_id: f.properties.gers_id,
      house_number: f.properties.house_number,
      street_name: f.properties.street_name,
      postal_code: f.properties.postal_code,
      locality: f.properties.city,
      formatted: f.properties.formatted || f.properties.label,
      geom: f.geometry,
      status: 'new', // Initial status for lead tracking
    }));
  }

  /**
   * Calculate bounding box from polygon
   */
  private static calculateBBox(polygon: GeoJSON.Polygon): [number, number, number, number] {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    
    const coords = polygon.coordinates[0];
    for (const [lng, lat] of coords) {
      if (lng < minX) minX = lng;
      if (lng > maxX) maxX = lng;
      if (lat < minY) minY = lat;
      if (lat > maxY) maxY = lat;
    }
    
    return [minX, minY, maxX, maxY];
  }
}
