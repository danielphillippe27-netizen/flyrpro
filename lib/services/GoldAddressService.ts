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
  private static toCampaignAddress(addr: any, campaignId: string, regionCode: string) {
    const houseNumber = addr.street_number ?? addr.house_number ?? '';
    const streetName = addr.street_name ?? addr.street ?? '';
    const locality = addr.city ?? addr.locality ?? '';
    const region = addr.province ?? addr.region ?? regionCode;
    const postalCode = addr.zip ?? addr.postal_code ?? undefined;

    let lon = Number(addr.lon);
    let lat = Number(addr.lat);

    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      const coord = addr.coordinate as { lon?: number; lat?: number } | undefined;
      lon = Number(coord?.lon);
      lat = Number(coord?.lat);
    }

    let geom: any = addr.geom_geojson ?? addr.geom ?? null;
    if (typeof geom === 'string') {
      try {
        geom = JSON.parse(geom);
      } catch {
        geom = null;
      }
    }

    if ((!Number.isFinite(lon) || !Number.isFinite(lat)) && geom?.type === 'Point' && Array.isArray(geom.coordinates)) {
      lon = Number(geom.coordinates[0]);
      lat = Number(geom.coordinates[1]);
    }

    const hasCoords = Number.isFinite(lon) && Number.isFinite(lat);
    const formattedFromDb = typeof addr.formatted === 'string' ? addr.formatted.trim() : '';
    const formatted =
      formattedFromDb ||
      `${houseNumber || ''} ${streetName || ''}`.trim() +
        (locality ? `, ${locality}` : '');

    return {
      campaign_id: campaignId,
      formatted,
      house_number: houseNumber || undefined,
      street_name: streetName || undefined,
      locality: locality || undefined,
      region: region || regionCode,
      postal_code: postalCode,
      coordinate: hasCoords ? { lat, lon } : undefined,
      geom: geom ?? (hasCoords ? { type: 'Point', coordinates: [lon, lat] } : null),
      source: 'gold' as const,
      gers_id: addr.source_id ?? addr.gers_id ?? null,
    };
  }

  private static normalizeGoldAddresses(
    addresses: any[] | null | undefined,
    campaignId: string,
    regionCode: string
  ) {
    return (addresses ?? []).map((addr) => this.toCampaignAddress(addr, campaignId, regionCode));
  }

  /**
   * Some environments expose `get_gold_addresses_in_polygon_geojson(text)`,
   * others expose `get_gold_addresses_in_polygon_geojson(text, text)`.
   * Try province-aware call first when region is available, then fall back.
   */
  private static async queryGoldAddressesRpc(
    supabase: ReturnType<typeof createAdminClient>,
    polygonGeoJSON: string,
    regionCode?: string
  ) {
    const province = regionCode?.trim().toUpperCase();

    if (province) {
      const withProvince = await supabase.rpc('get_gold_addresses_in_polygon_geojson', {
        p_polygon_geojson: polygonGeoJSON,
        p_province: province,
      });
      if (!withProvince.error) {
        return withProvince;
      }

      // Fall back when DB only has the single-arg signature.
      if (withProvince.error.code === 'PGRST202') {
        console.log('[GoldAddressService] Province-aware Gold RPC unavailable, retrying polygon-only signature');
      } else {
        return withProvince;
      }
    }

    return await supabase.rpc('get_gold_addresses_in_polygon_geojson', {
      p_polygon_geojson: polygonGeoJSON,
    });
  }

  /**
   * Fetch addresses from Gold Standard database
   * Returns addresses with geom as GeoJSON string for easy insertion
   */
  static async fetchAddressesInPolygon(
    polygon: GeoJSON.Polygon,
    regionCode?: string
  ): Promise<any[]> {
    const supabase = createAdminClient();
    const polygonGeoJSON = JSON.stringify(polygon);
    
    console.log('[GoldAddressService] Querying Gold Standard addresses...');
    
    // Query addresses with geom as GeoJSON string
    const { data: goldAddresses, error } = await this.queryGoldAddressesRpc(
      supabase,
      polygonGeoJSON,
      regionCode
    );
    
    if (error) {
      console.warn('[GoldAddressService] Gold query error:', error.message);
      return [];
    }
    
    console.log(`[GoldAddressService] Found ${goldAddresses?.length || 0} Gold addresses`);
    return goldAddresses || [];
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
    
    const { data: goldAddresses, error: goldError } = await this.queryGoldAddressesRpc(
      supabase,
      polygonGeoJSON,
      regionCode
    );
    
    if (goldError) {
      console.warn('[GoldAddressService] Gold query error:', goldError.message);
    }
    
    const goldCount = goldAddresses?.length || 0;
    const normalizedGoldAddresses = this.normalizeGoldAddresses(goldAddresses, campaignId, regionCode);
    console.log(`[GoldAddressService] Found ${goldCount} Gold Standard addresses`);
    
    // =============================================================================
    // STEP 2: If Gold has good coverage, use it exclusively
    // =============================================================================
    if (goldCount >= 10) {
      console.log('[GoldAddressService] Using Gold Standard exclusively');
      
      // Also get buildings from Gold if available (with GeoJSON)
      const { data: goldBuildings, error: buildingsError } = await supabase.rpc(
        'get_gold_buildings_in_polygon_geojson',
        { p_polygon_geojson: polygonGeoJSON }
      );
      
      if (buildingsError) {
        console.warn('[GoldAddressService] Gold buildings query error:', buildingsError.message);
      }
      
      return {
        source: 'gold',
        addresses: normalizedGoldAddresses,
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
      // Deduplicate: Prefer Gold over Lambda for same location
      const addressMap = new Map();
      
      // Add Lambda addresses first
      lambdaAddresses.forEach((addr: any) => {
        const key = `${addr.house_number?.toLowerCase()}|${addr.street_name?.toLowerCase()}`;
        addressMap.set(key, addr);
      });
      
      // Overwrite with Gold addresses (higher priority)
      normalizedGoldAddresses.forEach((addr: any) => {
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
