/**
 * Gold Address Service
 * 
 * Queries the Gold Standard municipal address table first,
 * falls back to Tile Lambda for areas not covered by Gold data.
 */

import { createAdminClient } from '@/lib/supabase/server';
import { TileLambdaService, type LambdaSnapshotResponse } from './TileLambdaService';

export interface GoldAddressResult {
  source: 'gold' | 'silver' | 'lambda';
  addresses: any[];
  buildings: any[];
  counts: {
    gold: number;
    lambda: number;
    total: number;
  };
  /** When source is lambda/silver, the Lambda snapshot so callers can reuse for buildings (avoid duplicate Lambda call). */
  snapshot?: LambdaSnapshotResponse | null;
}

export class GoldAddressService {
  private static parseGoldAddressRows(raw: unknown): any[] {
    if (!raw) return [];

    if (Array.isArray(raw)) return raw;

    if (typeof raw === 'string') {
      try {
        return this.parseGoldAddressRows(JSON.parse(raw));
      } catch {
        return [];
      }
    }

    if (typeof raw === 'object') {
      const obj = raw as Record<string, unknown>;
      if ('get_gold_addresses_in_polygon_geojson' in obj) {
        return this.parseGoldAddressRows(obj.get_gold_addresses_in_polygon_geojson);
      }
      if ('street_name' in obj || 'street_number' in obj || 'id' in obj) {
        return [obj];
      }
    }

    return [];
  }

  private static parseGoldBuildingRows(raw: unknown): any[] {
    if (!raw) return [];

    if (Array.isArray(raw)) {
      // Row shape from RETURNS TABLE rpc
      if (raw.length === 0) return [];
      const first = raw[0] as Record<string, unknown>;
      if ('geom_geojson' in first) return raw;
      if (first?.type === 'Feature') {
        return raw.map((feature) => this.featureToGoldBuildingRow(feature as Record<string, unknown>)).filter(Boolean);
      }
      return raw;
    }

    if (typeof raw === 'string') {
      try {
        return this.parseGoldBuildingRows(JSON.parse(raw));
      } catch {
        return [];
      }
    }

    if (typeof raw === 'object') {
      const obj = raw as Record<string, unknown>;

      if ('get_gold_buildings_in_polygon_geojson' in obj) {
        return this.parseGoldBuildingRows(obj.get_gold_buildings_in_polygon_geojson);
      }

      if (obj.type === 'FeatureCollection' && Array.isArray(obj.features)) {
        return obj.features
          .map((feature) => this.featureToGoldBuildingRow(feature as Record<string, unknown>))
          .filter(Boolean);
      }

      if (obj.type === 'Feature') {
        const one = this.featureToGoldBuildingRow(obj);
        return one ? [one] : [];
      }
    }

    return [];
  }

  private static featureToGoldBuildingRow(feature: Record<string, unknown>): any | null {
    const geometry = feature.geometry as Record<string, unknown> | undefined;
    if (!geometry) return null;
    const props = (feature.properties as Record<string, unknown> | undefined) ?? {};
    return {
      id: props.id ?? feature.id ?? null,
      source_id: props.source_id ?? null,
      external_id: props.external_id ?? null,
      area_sqm: props.area_sqm ?? null,
      geom_geojson: JSON.stringify(geometry),
      centroid_geojson: props.centroid_geojson ?? null,
      building_type: props.building_type ?? null,
    };
  }

  /**
   * Handles mixed DB states where either 1-arg or 2-arg RPC signatures may exist.
   */
  private static async queryGoldAddresses(
    supabase: ReturnType<typeof createAdminClient>,
    polygonGeoJSON: string,
    province?: string
  ) {
    const normalizedProvince = province?.trim().toUpperCase();

    if (normalizedProvince) {
      const twoArgResult = await supabase.rpc(
        'get_gold_addresses_in_polygon_geojson',
        { p_polygon_geojson: polygonGeoJSON, p_province: normalizedProvince }
      );

      if (!twoArgResult.error) {
        return twoArgResult;
      }

      const errorMessage = twoArgResult.error.message || '';
      const twoArgMissing =
        errorMessage.includes('Could not find the function public.get_gold_addresses_in_polygon_geojson') &&
        errorMessage.includes('p_province');

      if (!twoArgMissing) {
        return twoArgResult;
      }
    }

    return supabase.rpc(
      'get_gold_addresses_in_polygon_geojson',
      { p_polygon_geojson: polygonGeoJSON }
    );
  }

  /**
   * Fetch addresses from Gold Standard database
   * Returns addresses with geom as GeoJSON string for easy insertion
   */
  static async fetchAddressesInPolygon(
    polygon: GeoJSON.Polygon,
    province?: string
  ): Promise<any[]> {
    const supabase = createAdminClient();
    const polygonGeoJSON = JSON.stringify(polygon);
    
    console.log('[GoldAddressService] Querying Gold Standard addresses...');
    
    // Query addresses with geom as GeoJSON string
    const { data: goldAddressesRaw, error } = await this.queryGoldAddresses(
      supabase,
      polygonGeoJSON,
      province
    );
    
    if (error) {
      console.warn('[GoldAddressService] Gold query error:', error.message);
      return [];
    }
    
    const goldAddresses = this.parseGoldAddressRows(goldAddressesRaw);
    console.log(`[GoldAddressService] Found ${goldAddresses.length} Gold addresses`);
    return goldAddresses;
  }

  /**
   * Get addresses for a campaign polygon
   * Priority: Gold table → Tile Lambda (fallback)
   */
  static async getAddressesForPolygon(
    campaignId: string,
    polygon: GeoJSON.Polygon,
    regionCode: string = 'ON'
  ): Promise<GoldAddressResult> {
    console.log('[GoldAddressService] Starting hybrid address lookup...');
    
    const supabase = createAdminClient();
    
    // Convert polygon to GeoJSON string for PostGIS
    const polygonGeoJSON = JSON.stringify(polygon);
    
    // =============================================================================
    // STEP 1: Query Gold Standard addresses within polygon (with GeoJSON geom)
    // =============================================================================
    console.log('[GoldAddressService] Querying Gold Standard table...');
    
    const normalizedRegion = regionCode?.trim().toUpperCase();
    const { data: goldAddressesRaw, error: goldError } = await this.queryGoldAddresses(
      supabase,
      polygonGeoJSON,
      normalizedRegion
    );
    
    if (goldError) {
      console.warn('[GoldAddressService] Gold query error:', goldError.message);
    }
    
    let goldAddresses = this.parseGoldAddressRows(goldAddressesRaw);

    // Province filter can be stale/wrong; retry once without it when it yields zero.
    if (goldAddresses.length === 0 && normalizedRegion) {
      const fallback = await this.queryGoldAddresses(supabase, polygonGeoJSON);
      if (!fallback.error) {
        const unfiltered = this.parseGoldAddressRows(fallback.data);
        if (unfiltered.length > 0) {
          console.warn(
            `[GoldAddressService] Province-filtered query returned 0 for ${normalizedRegion}; unfiltered returned ${unfiltered.length}`
          );
          goldAddresses = unfiltered;
        }
      }
    }

    const goldCount = goldAddresses.length;
    console.log(`[GoldAddressService] Found ${goldCount} Gold Standard addresses`);
    
    // =============================================================================
    // STEP 2: If Gold has good coverage, use it exclusively
    // =============================================================================
    if (goldCount >= 10) {
      console.log('[GoldAddressService] Using Gold Standard exclusively');
      
      // Also get buildings from Gold if available (with GeoJSON)
      const { data: goldBuildingsRaw, error: buildingsError } = await supabase.rpc(
        'get_gold_buildings_in_polygon_geojson',
        { p_polygon_geojson: polygonGeoJSON }
      );
      
      if (buildingsError) {
        console.warn('[GoldAddressService] Gold buildings query error:', buildingsError.message);
      }
      
      const goldBuildings = this.parseGoldBuildingRows(goldBuildingsRaw);

      return {
        source: 'gold',
        addresses: goldAddresses || [],
        buildings: goldBuildings || [],
        counts: {
          gold: goldCount,
          lambda: 0,
          total: goldCount
        }
      };
    }
    
    // =============================================================================
    // STEP 3: Fallback to Tile Lambda for areas not covered by Gold
    // =============================================================================
    console.log('[GoldAddressService] Gold coverage insufficient, falling back to Tile Lambda...');
    
    const snapshot = await TileLambdaService.generateSnapshots(
      polygon,
      regionCode,
      campaignId,
      {
        limitBuildings: 10000,
        limitAddresses: 10000,
        limitRoads: 5000,
        includeRoads: true,
      }
    );
    
    const addressData = await TileLambdaService.downloadAddresses(snapshot.urls.addresses);
    const lambdaAddresses = TileLambdaService.convertToCampaignAddresses(
      addressData.features,
      campaignId
    );
    
    console.log(`[GoldAddressService] Tile Lambda returned ${lambdaAddresses.length} addresses`);
    
    // =============================================================================
    // STEP 4: Merge Gold + Lambda (if we had some Gold addresses)
    // =============================================================================
    let finalAddresses = lambdaAddresses;
    
    if (goldCount > 0 && goldAddresses) {
      // Convert Gold addresses to campaign format
      const goldAsCampaign = goldAddresses.map((addr: any) => ({
        campaign_id: campaignId,
        formatted: `${addr.street_number} ${addr.street_name}${addr.unit ? ' ' + addr.unit : ''}, ${addr.city}`,
        house_number: addr.street_number,
        street_name: addr.street_name,
        locality: addr.city,
        region: addr.province || 'ON',
        postal_code: addr.zip,
        coordinate: { lat: addr.lat, lon: addr.lon },
        geom: addr.geom_geojson, // GeoJSON string from RPC
        source: 'gold' as const,
        gers_id: null,
      }));
      
      // Deduplicate: Prefer Gold over Lambda for same location
      const addressMap = new Map();
      
      // Add Lambda addresses first
      lambdaAddresses.forEach((addr: any) => {
        const key = `${addr.house_number?.toLowerCase()}|${addr.street_name?.toLowerCase()}`;
        addressMap.set(key, addr);
      });
      
      // Overwrite with Gold addresses (higher priority)
      goldAsCampaign.forEach((addr: any) => {
        const key = `${addr.house_number?.toLowerCase()}|${addr.street_name?.toLowerCase()}`;
        addressMap.set(key, addr);
      });
      
      finalAddresses = Array.from(addressMap.values());
      console.log(`[GoldAddressService] Merged: ${goldCount} Gold + ${lambdaAddresses.length} Lambda = ${finalAddresses.length} total`);
    }
    
    return {
      source: goldCount > 0 ? 'silver' : 'lambda',
      addresses: finalAddresses,
      buildings: [], // Buildings come from Lambda snapshot (use result.snapshot for BuildingAdapter)
      counts: {
        gold: goldCount,
        lambda: lambdaAddresses.length,
        total: finalAddresses.length
      },
      snapshot, // Reuse in provision so we don't call Lambda again for buildings
    };
  }
  
  /**
   * Get buildings for a campaign polygon
   * Uses Gold table first, falls back to Lambda
   */
  static async getBuildingsForPolygon(
    polygon: GeoJSON.Polygon
  ): Promise<{ buildings: any[]; source: 'gold' | 'lambda' }> {
    const supabase = createAdminClient();
    const polygonGeoJSON = JSON.stringify(polygon);
    
    // Try Gold first (with GeoJSON)
    const { data: goldBuildings, error } = await supabase.rpc(
      'get_gold_buildings_in_polygon_geojson',
      { p_polygon_geojson: polygonGeoJSON }
    );
    
    if (!error && goldBuildings && goldBuildings.length > 0) {
      console.log(`[GoldAddressService] Using ${goldBuildings.length} Gold buildings`);
      return { buildings: goldBuildings, source: 'gold' };
    }
    
    // Fall back to Lambda buildings (returned separately)
    return { buildings: [], source: 'lambda' };
  }
}
