import { createClient } from '@/lib/supabase/client';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { MapBuilding } from '@/types/map-buildings';
import type { Building as GersBuilding } from '@/types/database';
import * as turf from '@turf/turf';
import { prepareDoubleWrite } from '@/lib/utils/double-write';

/**
 * Service for managing map_buildings table data
 * Handles importing, converting, and managing building footprints for fill-extrusion visualization
 */
export class MapBuildingsService {
  private static client = createClient();

  /**
   * Import Overture buildings into map_buildings table
   * Converts MultiPolygon to Polygon (taking first polygon if multipolygon)
   * Links to campaign_addresses if address_id is provided
   */
  static async importOvertureBuildings(
    buildings: Array<{
      gers_id: string;
      geometry: GeoJSON.MultiPolygon | GeoJSON.Polygon;
      height?: number;
      campaign_id?: string;
      address_id?: string;
      house_number?: string;
      street_name?: string;
    }>
  ): Promise<{ created: number; updated: number; errors: number }> {
    let created = 0;
    let updated = 0;
    let errors = 0;

    for (const building of buildings) {
      try {
        // Convert MultiPolygon to Polygon (take first polygon)
        let polygon: GeoJSON.Polygon;
        if (building.geometry.type === 'MultiPolygon') {
          if (building.geometry.coordinates.length === 0) {
            console.warn(`Skipping building ${building.gers_id}: empty MultiPolygon`);
            errors++;
            continue;
          }
          polygon = {
            type: 'Polygon',
            coordinates: building.geometry.coordinates[0],
          };
        } else {
          polygon = building.geometry;
        }

        // Calculate height (default to 6m if not provided)
        const height_m = building.height || 6;
        const levels = Math.ceil(height_m / 3); // Approximate: 3m per level

        // Detect if this might be a townhome row
        // Simple heuristic: if building is narrow and long, it might be a townhome
        const isTownhome = this.detectTownhomeRow(polygon);
        const unitsCount = isTownhome ? this.estimateTownhomeUnits(polygon) : 0;

        // Insert or update building
        // During UUID migration: double-write to both source_id and source_id_uuid
        const upsertData = prepareDoubleWrite(
          {
            source: 'overture',
            source_id: building.gers_id,
            geom: JSON.stringify(polygon), // PostGIS will convert GeoJSON to geometry
            // Note: For high-volume batch imports, prefer WKB format via batch_insert_map_buildings_from_wkb()
            // WKB is 3x-5x faster than GeoJSON (no JSON parsing overhead)
            height_m: height_m,
            levels: levels,
            is_townhome_row: isTownhome,
            units_count: unitsCount,
            campaign_id: building.campaign_id || null,
            address_id: building.address_id || null,
            house_number: building.house_number || null,
            street_name: building.street_name || null,
          },
          'source_id'
        );

        const { data, error } = await this.client
          .from('map_buildings')
          .upsert(upsertData, {
            onConflict: 'source_id,campaign_id',
            ignoreDuplicates: false,
          })
          .select();

        if (error) {
          console.error(`Error importing building ${building.gers_id}:`, error);
          errors++;
        } else if (data && data.length > 0) {
          // Check if this was an insert or update
          const existing = await this.client
            .from('map_buildings')
            .select('id')
            .eq('source_id', building.gers_id)
            .single();

          if (existing.data) {
            updated++;
          } else {
            created++;
          }
        }
      } catch (err) {
        console.error(`Error processing building ${building.gers_id}:`, err);
        errors++;
      }
    }

    return { created, updated, errors };
  }

  /**
   * Convert existing buildings table data to map_buildings
   * Takes MultiPolygon and converts to Polygon (first polygon only)
   */
  static async convertGersBuildingsToMapBuildings(
    campaignId: string
  ): Promise<{ converted: number; errors: number }> {
    let converted = 0;
    let errors = 0;

    try {
      // Fetch buildings from existing buildings table
      const { data: buildings, error } = await this.client
        .from('buildings')
        .select('*')
        .eq('campaign_id', campaignId)
        .eq('is_hidden', false);

      if (error) {
        console.error('Error fetching buildings:', error);
        return { converted: 0, errors: 1 };
      }

      if (!buildings || buildings.length === 0) {
        return { converted: 0, errors: 0 };
      }

      // Convert each building
      for (const building of buildings as GersBuilding[]) {
        try {
          // Parse geometry
          const geom = typeof building.geom === 'string' 
            ? JSON.parse(building.geom) 
            : building.geom;

          if (!geom || (geom.type !== 'MultiPolygon' && geom.type !== 'Polygon')) {
            console.warn(`Skipping building ${building.id}: invalid geometry type`);
            errors++;
            continue;
          }

          // Convert MultiPolygon to Polygon
          let polygon: GeoJSON.Polygon;
          if (geom.type === 'MultiPolygon') {
            if (geom.coordinates.length === 0) {
              console.warn(`Skipping building ${building.id}: empty MultiPolygon`);
              errors++;
              continue;
            }
            polygon = {
              type: 'Polygon',
              coordinates: geom.coordinates[0],
            };
          } else {
            polygon = geom;
          }

          // Detect townhome
          const isTownhome = this.detectTownhomeRow(polygon);
          const unitsCount = isTownhome ? this.estimateTownhomeUnits(polygon) : 0;

          // Insert into map_buildings
          const { error: insertError } = await this.client
            .from('map_buildings')
            .upsert(
              {
                source: 'gers',
                source_id: building.gers_id,
                geom: JSON.stringify(polygon),
                height_m: building.height || 6,
                levels: building.height ? Math.ceil(building.height / 3) : 2,
                is_townhome_row: isTownhome,
                units_count: unitsCount,
                campaign_id: building.campaign_id || null,
              },
              {
                onConflict: 'source_id,campaign_id',
                ignoreDuplicates: false,
              }
            );

          if (insertError) {
            console.error(`Error converting building ${building.id}:`, insertError);
            errors++;
          } else {
            converted++;
          }
        } catch (err) {
          console.error(`Error processing building ${building.id}:`, err);
          errors++;
        }
      }
    } catch (err) {
      console.error('Error in convertGersBuildingsToMapBuildings:', err);
      errors++;
    }

    return { converted, errors };
  }

  /**
   * Link map_buildings to campaign_addresses via source_id matching
   * This creates the relationship needed for scan tracking
   */
  static async linkBuildingsToAddresses(campaignId: string): Promise<{ linked: number; errors: number }> {
    let linked = 0;
    let errors = 0;

    try {
      // Fetch addresses with source_id
      const { data: addresses, error: addressesError } = await this.client
        .from('campaign_addresses')
        .select('id, source_id')
        .eq('campaign_id', campaignId)
        .not('source_id', 'is', null);

      if (addressesError) {
        console.error('Error fetching addresses:', addressesError);
        return { linked: 0, errors: 1 };
      }

      if (!addresses || addresses.length === 0) {
        return { linked: 0, errors: 0 };
      }

      // Link each address to its building
      for (const address of addresses) {
        try {
          const { error: updateError } = await this.client
            .from('map_buildings')
            .update({ address_id: address.id })
            .eq('source_id', address.source_id)
            .eq('campaign_id', campaignId);

          if (updateError) {
            console.error(`Error linking address ${address.id}:`, updateError);
            errors++;
          } else {
            linked++;
          }
        } catch (err) {
          console.error(`Error processing address ${address.id}:`, err);
          errors++;
        }
      }
    } catch (err) {
      console.error('Error in linkBuildingsToAddresses:', err);
      errors++;
    }

    return { linked, errors };
  }

  /**
   * Simple heuristic to detect if a polygon represents a townhome row
   * Checks if the building is narrow and long (aspect ratio > 3:1)
   */
  private static detectTownhomeRow(polygon: GeoJSON.Polygon): boolean {
    try {
      const bbox = turf.bbox(polygon);
      const width = bbox[2] - bbox[0]; // lon difference
      const height = bbox[3] - bbox[1]; // lat difference

      // Convert to approximate meters (rough conversion for small areas)
      const avgLat = (bbox[1] + bbox[3]) / 2;
      const metersPerDegreeLat = 111000;
      const metersPerDegreeLon = 111000 * Math.cos((avgLat * Math.PI) / 180);

      const widthMeters = Math.abs(width * metersPerDegreeLon);
      const heightMeters = Math.abs(height * metersPerDegreeLat);

      // Townhome rows are typically narrow (one dimension much smaller than the other)
      const aspectRatio = Math.max(widthMeters / heightMeters, heightMeters / widthMeters);

      // If aspect ratio > 3:1 and one dimension < 10m, likely a townhome row
      return aspectRatio > 3 && Math.min(widthMeters, heightMeters) < 10;
    } catch (err) {
      console.warn('Error detecting townhome row:', err);
      return false;
    }
  }

  /**
   * Estimate number of townhome units based on building dimensions
   * Assumes average unit width of 6-8 meters
   */
  private static estimateTownhomeUnits(polygon: GeoJSON.Polygon): number {
    try {
      const bbox = turf.bbox(polygon);
      const width = bbox[2] - bbox[0];
      const height = bbox[3] - bbox[1];

      const avgLat = (bbox[1] + bbox[3]) / 2;
      const metersPerDegreeLat = 111000;
      const metersPerDegreeLon = 111000 * Math.cos((avgLat * Math.PI) / 180);

      const widthMeters = Math.abs(width * metersPerDegreeLon);
      const heightMeters = Math.abs(height * metersPerDegreeLat);

      // Use the longer dimension as the row length
      const rowLengthMeters = Math.max(widthMeters, heightMeters);

      // Estimate units (average 7m per unit)
      const estimatedUnits = Math.max(2, Math.floor(rowLengthMeters / 7));

      return estimatedUnits;
    } catch (err) {
      console.warn('Error estimating townhome units:', err);
      return 2; // Default to 2 units
    }
  }

  /**
   * Batch insert buildings with PostGIS geometry
   * More efficient than individual inserts
   * 
   * Note: For high-volume imports (1000+ buildings), use batchInsertBuildingsFromWKB()
   * instead for 3x-5x better performance (WKB format avoids JSON parsing overhead).
   * 
   * @param buildings - Array of building data to insert
   * @param client - Optional Supabase client (for server-side routes, pass admin client to bypass RLS)
   */
  static async batchInsertBuildings(
    buildings: Array<{
      source: string;
      source_id: string;
      geometry: GeoJSON.Polygon;
      height_m?: number;
      campaign_id?: string;
      address_id?: string;
      house_number?: string;
      street_name?: string;
    }>,
    client?: SupabaseClient<any>
  ): Promise<{ inserted: number; errors: number }> {
    let inserted = 0;
    let errors = 0;

    // Use provided client or fall back to default client
    const supabaseClient = client || this.client;

    // Process in batches of 100
    const batchSize = 100;
    for (let i = 0; i < buildings.length; i += batchSize) {
      const batch = buildings.slice(i, i + batchSize);

      try {
        const inserts = batch.map((building) => ({
          source: building.source,
          gers_id: building.gers_id,
          geom: JSON.stringify(building.geometry),
          height_m: building.height_m || 6,
          levels: building.height_m ? Math.ceil(building.height_m / 3) : 2,
          campaign_id: building.campaign_id || null,
          address_id: building.address_id || null,
          house_number: building.house_number || undefined,
          street_name: building.street_name || undefined,
        }));

        const { error } = await supabaseClient
          .from('map_buildings')
          .upsert(inserts, {
            onConflict: 'source_id,campaign_id',
            ignoreDuplicates: false,
          });

        if (error) {
          console.error(`Error batch inserting buildings (batch ${i / batchSize + 1}):`, error);
          errors += batch.length;
        } else {
          inserted += batch.length;
        }
      } catch (err) {
        console.error(`Error processing batch ${i / batchSize + 1}:`, err);
        errors += batch.length;
      }
    }

    return { inserted, errors };
  }

  /**
   * Batch insert buildings using WKB (Well-Known Binary) format
   * 
   * Performance: 3x-5x faster than GeoJSON format for high-volume imports
   * because WKB avoids JSON parsing overhead in PostGIS.
   * 
   * Use this method when:
   * - Importing 1000+ buildings at once
   * - You already have geometry in WKB format (e.g., from DuckDB/MotherDuck)
   * - Performance is critical
   * 
   * @param buildings - Array of buildings with WKB hex strings
   * @returns Result with created, updated, and error counts
   */
  static async batchInsertBuildingsFromWKB(
    buildings: Array<{
      source_id: string;
      geom_wkb_hex: string; // WKB hex string (from Buffer.toString('hex') or DuckDB ST_AsWKB)
      height_m?: number;
      levels?: number;
      campaign_id?: string;
    }>
  ): Promise<{ created: number; updated: number; errors: number }> {
    // Use the RPC function for efficient WKB batch processing
    const batchSize = 500; // Larger batches for WKB (more efficient)
    let totalCreated = 0;
    let totalUpdated = 0;
    let totalErrors = 0;

    for (let i = 0; i < buildings.length; i += batchSize) {
      const batch = buildings.slice(i, i + batchSize);

      try {
        // Prepare batch data for RPC
        const batchData = batch.map((building) => ({
          gers_id: building.gers_id,
          geom_wkb_hex: building.geom_wkb_hex,
          height_m: building.height_m || 6,
          levels: building.levels || (building.height_m ? Math.ceil(building.height_m / 3) : 2),
          campaign_id: building.campaign_id || null,
        }));

        const { data, error } = await this.client.rpc('batch_insert_map_buildings_from_wkb', {
          p_buildings: batchData,
        });

        if (error) {
          console.error(`Error in WKB batch insert (batch ${Math.floor(i / batchSize) + 1}):`, error);
          totalErrors += batch.length;
        } else if (data) {
          totalCreated += data.created || 0;
          totalUpdated += data.updated || 0;
          totalErrors += data.errors || 0;
        }
      } catch (err) {
        console.error(`Error processing WKB batch ${Math.floor(i / batchSize) + 1}:`, err);
        totalErrors += batch.length;
      }
    }

    return {
      created: totalCreated,
      updated: totalUpdated,
      errors: totalErrors,
    };
  }

  /**
   * Fetch map buildings for a campaign
   */
  static async fetchCampaignBuildings(campaignId: string): Promise<MapBuilding[]> {
    const { data, error } = await this.client
      .from('map_buildings')
      .select('*')
      .eq('campaign_id', campaignId);

    if (error) {
      console.error('Error fetching campaign buildings:', error);
      throw error;
    }

    return (data || []) as MapBuilding[];
  }
}
