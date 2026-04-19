/**
 * Gold Address Service
 * 
 * Queries the Gold Standard municipal address table first,
 * falls back to Tile Lambda for areas not covered by Gold data.
 */

import { createAdminClient } from '@/lib/supabase/server';
import { TileLambdaService, type LambdaSnapshotResponse } from './TileLambdaService';

const DEFAULT_GOLD_ADDRESS_LIMIT = 5000;
const GOLD_ADDRESS_RPC_FILTERED = 'get_gold_addresses_in_polygon_geojson_filtered';
const GOLD_RPC_PAGE_SIZE = 1000;
const LEGACY_GOLD_RPC_CAP = 2500;

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
  private static applyRpcRange<T>(builder: T, from: number, to: number): T {
    const query = builder as T & { range?: (from: number, to: number) => T };
    return typeof query.range === 'function' ? query.range(from, to) : builder;
  }

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
      if (GOLD_ADDRESS_RPC_FILTERED in obj) {
        return this.parseGoldAddressRows(obj[GOLD_ADDRESS_RPC_FILTERED]);
      }
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

  private static normalizeProvince(value?: string | null): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim().toUpperCase();
    return trimmed || null;
  }

  private static isMissingFunctionError(message: string, functionName: string): boolean {
    return (
      message.includes(`Could not find the function public.${functionName}`) ||
      message.includes(`Could not find the function ${functionName}`)
    );
  }

  private static async queryLegacyGoldAddresses(
    supabase: ReturnType<typeof createAdminClient>,
    polygonGeoJSON: string,
    province?: string
  ) {
    const normalizedProvince = this.normalizeProvince(province);

    const twoArgResult = await supabase.rpc(
      'get_gold_addresses_in_polygon_geojson',
      { p_polygon_geojson: polygonGeoJSON, p_province: normalizedProvince }
    );

    if (!twoArgResult.error) {
      return twoArgResult;
    }

    const errorMessage = twoArgResult.error.message || '';
    const twoArgMissing =
      this.isMissingFunctionError(errorMessage, 'get_gold_addresses_in_polygon_geojson') &&
      errorMessage.includes('p_province');

    if (!twoArgMissing) {
      return twoArgResult;
    }

    return supabase.rpc(
      'get_gold_addresses_in_polygon_geojson',
      { p_polygon_geojson: polygonGeoJSON }
    );
  }

  private static async queryLegacyGoldAddressesPage(
    supabase: ReturnType<typeof createAdminClient>,
    polygonGeoJSON: string,
    province: string | undefined,
    from: number,
    to: number
  ) {
    const normalizedProvince = this.normalizeProvince(province);

    const twoArgResult = await this.applyRpcRange(
      supabase.rpc(
        'get_gold_addresses_in_polygon_geojson',
        { p_polygon_geojson: polygonGeoJSON, p_province: normalizedProvince }
      ),
      from,
      to
    );

    if (!twoArgResult.error) {
      return twoArgResult;
    }

    const errorMessage = twoArgResult.error.message || '';
    const twoArgMissing =
      this.isMissingFunctionError(errorMessage, 'get_gold_addresses_in_polygon_geojson') &&
      errorMessage.includes('p_province');

    if (!twoArgMissing) {
      return twoArgResult;
    }

    return this.applyRpcRange(
      supabase.rpc(
        'get_gold_addresses_in_polygon_geojson',
        { p_polygon_geojson: polygonGeoJSON }
      ),
      from,
      to
    );
  }

  /**
   * Handles mixed DB states where either the new single-signature RPC exists
   * or older overloaded RPC signatures are still deployed.
   */
  private static async queryGoldAddresses(
    supabase: ReturnType<typeof createAdminClient>,
    polygonGeoJSON: string,
    province?: string
  ) {
    const normalizedProvince = this.normalizeProvince(province);
    const filteredResult = await supabase.rpc(
      GOLD_ADDRESS_RPC_FILTERED,
      { p_polygon_geojson: polygonGeoJSON, p_province: normalizedProvince }
    );

    if (!filteredResult.error) {
      return filteredResult;
    }

    const errorMessage = filteredResult.error.message || '';
    if (!this.isMissingFunctionError(errorMessage, GOLD_ADDRESS_RPC_FILTERED)) {
      return filteredResult;
    }

    return this.queryLegacyGoldAddresses(supabase, polygonGeoJSON, normalizedProvince ?? undefined);
  }

  private static async queryGoldAddressesPage(
    supabase: ReturnType<typeof createAdminClient>,
    polygonGeoJSON: string,
    province: string | undefined,
    from: number,
    to: number
  ) {
    const normalizedProvince = this.normalizeProvince(province);
    const filteredResult = await this.applyRpcRange(
      supabase.rpc(
        GOLD_ADDRESS_RPC_FILTERED,
        { p_polygon_geojson: polygonGeoJSON, p_province: normalizedProvince }
      ),
      from,
      to
    );

    if (!filteredResult.error) {
      return filteredResult;
    }

    const errorMessage = filteredResult.error.message || '';
    if (!this.isMissingFunctionError(errorMessage, GOLD_ADDRESS_RPC_FILTERED)) {
      return filteredResult;
    }

    return this.queryLegacyGoldAddressesPage(
      supabase,
      polygonGeoJSON,
      normalizedProvince ?? undefined,
      from,
      to
    );
  }

  private static async fetchGoldAddressesWithLimit(
    supabase: ReturnType<typeof createAdminClient>,
    polygonGeoJSON: string,
    province: string | undefined,
    limit: number
  ): Promise<any[]> {
    const collectPages = async (provinceOverride?: string) => {
      const rows: any[] = [];

      for (let from = 0; rows.length < limit; from += GOLD_RPC_PAGE_SIZE) {
        const to = from + Math.min(GOLD_RPC_PAGE_SIZE, limit - rows.length) - 1;
        const { data, error } = await this.queryGoldAddressesPage(
          supabase,
          polygonGeoJSON,
          provinceOverride,
          from,
          to
        );

        if (error) {
          throw error;
        }

        const batch = this.parseGoldAddressRows(data);
        if (batch.length === 0) break;

        rows.push(...batch);
        if (batch.length < GOLD_RPC_PAGE_SIZE) break;
      }

      return rows.slice(0, limit);
    };

    const normalizedProvince = this.normalizeProvince(province);
    const primaryRows = await collectPages(normalizedProvince ?? undefined);

    if (primaryRows.length === 0 && normalizedProvince) {
      const fallbackRows = await collectPages(undefined);
      if (fallbackRows.length > 0) {
        console.warn(
          `[GoldAddressService] Province-filtered query returned 0 for ${normalizedProvince}; unfiltered returned ${fallbackRows.length}`
        );
        return fallbackRows;
      }
    }

    return primaryRows;
  }

  /**
   * Fetch addresses from Gold Standard database
   * Returns addresses with geom as GeoJSON string for easy insertion
   */
  static async fetchAddressesInPolygon(
    polygon: GeoJSON.Polygon,
    province?: string,
    limit: number = DEFAULT_GOLD_ADDRESS_LIMIT
  ): Promise<any[]> {
    const supabase = createAdminClient();
    const polygonGeoJSON = JSON.stringify(polygon);
    
    console.log('[GoldAddressService] Querying Gold Standard addresses...');
    
    try {
      const goldAddresses = await this.fetchGoldAddressesWithLimit(
        supabase,
        polygonGeoJSON,
        province,
        limit
      );

      console.log(`[GoldAddressService] Found ${goldAddresses.length} Gold addresses`);
      return goldAddresses;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn('[GoldAddressService] Gold query error:', message);
      return [];
    }
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
    
    const normalizedRegion = this.normalizeProvince(regionCode);
    let goldAddresses: any[] = [];

    try {
      goldAddresses = await this.fetchGoldAddressesWithLimit(
        supabase,
        polygonGeoJSON,
        normalizedRegion ?? undefined,
        DEFAULT_GOLD_ADDRESS_LIMIT
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn('[GoldAddressService] Gold query error:', message);
    }

    const goldCount = goldAddresses.length;
    console.log(`[GoldAddressService] Found ${goldCount} Gold Standard addresses`);
    const shouldTopUpFromLambda =
      goldCount >= LEGACY_GOLD_RPC_CAP && DEFAULT_GOLD_ADDRESS_LIMIT > goldCount;
    
    // =============================================================================
    // STEP 2: If Gold has good coverage, use it exclusively
    // =============================================================================
    if (goldCount >= 10 && !shouldTopUpFromLambda) {
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

    if (shouldTopUpFromLambda) {
      console.log('[GoldAddressService] Gold RPC appears capped at 2500 rows, topping up with Lambda...');
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
        includeRoads: false,
      }
    );
    
    const addressData = await TileLambdaService.downloadAddresses(snapshot.urls.addresses);
    const lambdaAddresses = TileLambdaService.convertToCampaignAddresses(
      addressData.features,
      campaignId,
      normalizedRegion
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
        region: this.normalizeProvince(addr.province) ?? normalizedRegion,
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
      
      finalAddresses = Array.from(addressMap.values()).slice(0, DEFAULT_GOLD_ADDRESS_LIMIT);
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
