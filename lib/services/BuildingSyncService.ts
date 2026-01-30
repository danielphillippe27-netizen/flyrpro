/**
 * Building Sync Service
 * Syncs building footprints from MotherDuck views to Supabase map_buildings table
 * Uses WKB geometry format for efficient transfer
 */

// @ts-ignore - duckdb types may not be available
import duckdb from 'duckdb';
import { createAdminClient } from '@/lib/supabase/server';

// Reuse OvertureService singleton pattern
const globalForDuckDB = global as unknown as { 
  overtureDb: any | undefined;
  overtureConnection: any | undefined;
};

export interface BoundingBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface SyncResult {
  created: number;
  updated: number;
  errors: number;
  total: number;
}

export interface BuildingFromMotherDuck {
  source_id: string;
  geom_wkb: Buffer | string; // WKB geometry
  height: number | null;
  levels: number;
  bbox_minx: number;
  bbox_miny: number;
  bbox_maxx: number;
  bbox_maxy: number;
}

export class BuildingSyncService {
  private static readonly OVERTURE_RELEASE = '2025-12-17.0';
  private static readonly MOTHERDUCK_TOKEN = process.env.MOTHERDUCK_TOKEN;
  private static readonly USE_MOTHERDUCK: boolean = !!process.env.MOTHERDUCK_TOKEN;
  private static readonly BATCH_SIZE = 1000;

  /**
   * Get or Create the Singleton Database Instance
   * Reuses OvertureService pattern
   */
  private static async getDatabase() {
    if (globalForDuckDB.overtureDb) {
      return globalForDuckDB.overtureDb;
    }

    if (this.USE_MOTHERDUCK && !this.MOTHERDUCK_TOKEN) {
      throw new Error('MotherDuck token is required but not provided.');
    }

    // Use simple connection string - rely on MOTHERDUCK_TOKEN environment variable
    const connectionString = this.USE_MOTHERDUCK ? 'md:' : ':memory:';

    console.log(`[BuildingSync] Initializing DuckDB (${this.USE_MOTHERDUCK ? 'MotherDuck' : 'Local'})...`);
    console.log(`[BuildingSync] Using connection string: ${connectionString}`);
    
    try {
      const db = new duckdb.Database(connectionString);
      
      if (this.USE_MOTHERDUCK) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      globalForDuckDB.overtureDb = db;
      console.log(`[BuildingSync] Database initialized successfully`);
      return db;
    } catch (error: any) {
      console.error(`[BuildingSync] Failed to initialize database:`, error.message);
      throw new Error(
        `Failed to initialize MotherDuck database. ` +
        `Error: ${error.message}. ` +
        `Please verify: 1) MOTHERDUCK_TOKEN is valid, 2) Network connectivity, 3) SSL certificates.`
      );
    }
  }

  /**
   * Get or Create the Singleton Connection Instance
   */
  private static async getConnection() {
    if (globalForDuckDB.overtureConnection) {
      return globalForDuckDB.overtureConnection;
    }

    const db = await this.getDatabase();
    console.log('[BuildingSync] Opening new connection...');
    const conn = db.connect();

    // Set home directory to /tmp to avoid Mac permission issues
    try {
      await new Promise((resolve, reject) => {
        conn.exec("SET home_directory='/tmp/duckdb';", (err: any) => {
          if (err) {
            console.warn(`[BuildingSync] Failed to set home_directory:`, err.message);
            // Don't reject - continue anyway as this is a best practice, not required
          }
          resolve(null);
        });
      });
    } catch (err: any) {
      console.warn(`[BuildingSync] Error setting home_directory:`, err.message);
    }

    try {
      await new Promise((resolve, reject) => {
        conn.exec(`
          INSTALL spatial; 
          LOAD spatial; 
          SELECT 1;
        `, (err: any, res: any) => {
          if (err) reject(err);
          else resolve(res);
        });
      });
      
      console.log('[BuildingSync] Spatial extension loaded & connection warm.');
    } catch (err: any) {
      console.error('[BuildingSync] Connection setup failed:', err.message);
      throw err;
    }

    globalForDuckDB.overtureConnection = conn;
    return conn;
  }

  /**
   * Execute query via DuckDB
   */
  private static async executeDuckDBQuery(query: string, attempt: number = 0): Promise<any> {
    const MAX_RETRIES = 1;
    
    try {
      const conn = await this.getConnection();
      
      return await new Promise((resolve, reject) => {
        conn.all(query, (err: any, res: any) => {
          if (err) reject(err);
          else resolve(res || []);
        });
      });

    } catch (error: any) {
      const isConnectionError = 
        error.message?.includes('Connection was never established') || 
        error.message?.includes('closed') ||
        error.message?.includes('Connection Error');
      
      if (isConnectionError && attempt < MAX_RETRIES) {
        console.warn('[BuildingSync] Connection error detected. Resetting and retrying...');
        
        globalForDuckDB.overtureConnection = undefined;
        globalForDuckDB.overtureDb = undefined;
        
        return this.executeDuckDBQuery(query, attempt + 1);
      }

      const errorMsg = this.USE_MOTHERDUCK 
        ? `MotherDuck Query Failed: ${error.message}`
        : `DuckDB Query Failed: ${error.message}`;
      throw new Error(errorMsg);
    }
  }

  /**
   * Load MotherDuck views from SQL file
   * This should be run once to create the views in MotherDuck
   */
  static async createViews(): Promise<void> {
    // For now, views should be created manually via MotherDuck UI or CLI
    // This method is a placeholder for future automation
    console.log('[BuildingSync] Views should be created manually. See scripts/motherduck/create_building_views.sql');
  }

  /**
   * Query buildings from MotherDuck render_ready view for a bounding box
   */
  private static async queryBuildingsFromMotherDuck(bbox: BoundingBox): Promise<BuildingFromMotherDuck[]> {
    const query = `
      SELECT 
        source_id,
        geom_wkb,
        height,
        levels,
        bbox_minx,
        bbox_miny,
        bbox_maxx,
        bbox_maxy
      FROM md_buildings_render_ready
      WHERE 
        -- BBox overlap logic: building bbox overlaps query bbox
        bbox_maxx >= ${bbox.west} AND bbox_minx <= ${bbox.east}
        AND bbox_maxy >= ${bbox.south} AND bbox_miny <= ${bbox.north}
    `;

    console.log(`[BuildingSync] Querying MotherDuck for bbox: [${bbox.west}, ${bbox.south}, ${bbox.east}, ${bbox.north}]`);
    
    const results = await this.executeDuckDBQuery(query);
    
    console.log(`[BuildingSync] Found ${results.length} buildings in MotherDuck view`);
    
    return results.map((row: any) => ({
      source_id: row.source_id,
      geom_wkb: row.geom_wkb, // Buffer or hex string
      height: row.height,
      levels: row.levels || 2,
      bbox_minx: row.bbox_minx,
      bbox_miny: row.bbox_miny,
      bbox_maxx: row.bbox_maxx,
      bbox_maxy: row.bbox_maxy,
    }));
  }

  /**
   * Convert WKB Buffer to hex string for PostGIS
   */
  private static wkbToHex(wkb: Buffer | string): string {
    if (typeof wkb === 'string') {
      // Already a hex string or needs conversion
      if (wkb.startsWith('\\x') || wkb.startsWith('0x')) {
        return wkb.replace(/^\\x|^0x/i, '');
      }
      // If it's already hex, return as-is
      // DuckDB might return hex strings directly
      return wkb;
    }
    // Buffer to hex
    return wkb.toString('hex');
  }

  /**
   * Batch upsert buildings to Supabase using WKB geometry
   */
  private static async batchUpsertBuildings(
    buildings: BuildingFromMotherDuck[],
    campaignId?: string
  ): Promise<SyncResult> {
    const supabase = createAdminClient();
    let totalCreated = 0;
    let totalUpdated = 0;
    let totalErrors = 0;

    // Process in batches
    for (let i = 0; i < buildings.length; i += this.BATCH_SIZE) {
      const batch = buildings.slice(i, i + this.BATCH_SIZE);
      
      try {
        // Prepare batch data for RPC
        const batchData = batch.map((building) => {
          const wkbHex = this.wkbToHex(building.geom_wkb);
          return {
            source_id: building.source_id,
            geom_wkb_hex: wkbHex,
            height_m: building.height || 6,
            levels: building.levels || 2,
            campaign_id: campaignId || null,
          };
        });

        // Call batch RPC function
        const { data, error } = await supabase.rpc('batch_insert_map_buildings_from_wkb', {
          p_buildings: batchData,
        });

        if (error) {
          console.error(`[BuildingSync] Error in batch insert (batch ${Math.floor(i / this.BATCH_SIZE) + 1}):`, error);
          totalErrors += batch.length;
        } else if (data) {
          totalCreated += data.created || 0;
          totalUpdated += data.updated || 0;
          totalErrors += data.errors || 0;
          
          console.log(
            `[BuildingSync] Batch ${Math.floor(i / this.BATCH_SIZE) + 1}: ` +
            `${data.created || 0} created, ${data.updated || 0} updated, ${data.errors || 0} errors`
          );
        }
      } catch (err) {
        console.error(`[BuildingSync] Error processing batch ${Math.floor(i / this.BATCH_SIZE) + 1}:`, err);
        totalErrors += batch.length;
      }
    }

    return {
      created: totalCreated,
      updated: totalUpdated,
      errors: totalErrors,
      total: buildings.length,
    };
  }

  /**
   * Sync buildings for a bounding box (campaign-specific or region)
   */
  static async syncBbox(
    bbox: BoundingBox,
    campaignId?: string
  ): Promise<SyncResult> {
    console.log(`[BuildingSync] Starting bbox sync: [${bbox.west}, ${bbox.south}, ${bbox.east}, ${bbox.north}]`);
    
    try {
      // 1. Query buildings from MotherDuck
      const buildings = await this.queryBuildingsFromMotherDuck(bbox);
      
      if (buildings.length === 0) {
        console.log('[BuildingSync] No buildings found in MotherDuck view for this bbox');
        return { created: 0, updated: 0, errors: 0, total: 0 };
      }

      // 2. Batch upsert to Supabase
      const result = await this.batchUpsertBuildings(buildings, campaignId);
      
      console.log(`[BuildingSync] Sync complete: ${result.created} created, ${result.updated} updated, ${result.errors} errors`);
      return result;
    } catch (error) {
      console.error('[BuildingSync] Sync failed:', error);
      throw error;
    }
  }

  /**
   * Sync buildings for a region (pre-population)
   */
  static async syncRegion(
    regionName: string,
    bbox: BoundingBox
  ): Promise<SyncResult> {
    console.log(`[BuildingSync] Starting region sync: ${regionName}`);
    return this.syncBbox(bbox);
  }
}
