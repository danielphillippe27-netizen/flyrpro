// DuckDB is dynamically imported to avoid Vercel build failures
// The native binary is not compatible with Vercel's serverless environment
// This service is primarily used by Node scripts (not API routes on Vercel)
type DuckDBModule = typeof import('duckdb');
let duckdb: DuckDBModule | null = null;

// Global singleton for DuckDB connection (shared with OvertureService)
const globalForDuckDB = globalThis as unknown as {
  overtureDb: any | undefined;
  overtureConnection: any | undefined;
};

async function getDuckDB(): Promise<DuckDBModule> {
  if (!duckdb) {
    try {
      duckdb = await import('duckdb');
    } catch (error: any) {
      throw new Error(
        `DuckDB native module failed to load. This service is only available in Node.js scripts, not Vercel serverless. ` +
        `Error: ${error.message}`
      );
    }
  }
  return duckdb;
}

export interface UnifiedBuildingFeature {
  building_id: string;
  render_height: number;
  full_address: string;
  campaign_name: string;
  campaign_status: string;
  geometry: any; // GeoJSON geometry
  address_id?: string;
  height?: number;
  min_height?: number;
}

export class MotherDuckUnifiedService {
  // Read from process.env dynamically instead of at class definition time
  // This allows dotenv.config() to run before the class is used
  private static get MOTHERDUCK_TOKEN(): string | undefined {
    return process.env.MOTHERDUCK_TOKEN;
  }
  private static get USE_MOTHERDUCK(): boolean {
    return !!this.MOTHERDUCK_TOKEN;
  }
  private static readonly OVERTURE_RELEASE = '2025-12-17.0';
  private static readonly SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kfnsnwqylsdsbgnwgxva.supabase.co';
  private static readonly SUPABASE_DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD || process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  // Note: Service role key can be used as database password for Postgres connection

  /**
   * Get or create DuckDB database connection
   */
  private static async getDatabase(): Promise<any> {
    if (globalForDuckDB.overtureDb) {
      return globalForDuckDB.overtureDb;
    }

    console.log(`[MotherDuckUnified] Initializing database connection...`);
    console.log(`[MotherDuckUnified] MOTHERDUCK_TOKEN is ${this.MOTHERDUCK_TOKEN ? 'SET' : 'NOT SET'}`);
    
    if (this.USE_MOTHERDUCK && !this.MOTHERDUCK_TOKEN) {
      throw new Error('MotherDuck token is required but not provided.');
    }

    // Dynamically import DuckDB to avoid Vercel build failures
    const duckdbModule = await getDuckDB();

    // Use simple connection string - rely on MOTHERDUCK_TOKEN environment variable
    const connectionString = this.USE_MOTHERDUCK ? 'md:' : ':memory:';

    console.log(`[MotherDuckUnified] Initializing DuckDB (${this.USE_MOTHERDUCK ? 'MotherDuck' : 'Local'})...`);
    console.log(`[MotherDuckUnified] Using connection string: ${connectionString}`);

    try {
      const db = new duckdbModule.Database(connectionString);

      if (this.USE_MOTHERDUCK) {
        // Give MotherDuck a moment to establish connection
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      globalForDuckDB.overtureDb = db;
      console.log(`[MotherDuckUnified] Database initialized successfully`);
      return db;
    } catch (error: any) {
      console.error(`[MotherDuckUnified] Failed to initialize database:`, error.message);
      console.error(`[MotherDuckUnified] Error details:`, {
        message: error.message,
        name: error.name,
        stack: error.stack?.substring(0, 200),
      });
      throw error;
    }
  }

  /**
   * Get or create connection with spatial extension
   */
  private static async getConnection(): Promise<any> {
    if (globalForDuckDB.overtureConnection) {
      return globalForDuckDB.overtureConnection;
    }

    const db = await this.getDatabase();
    const conn = db.connect();

    // Set home directory to /tmp to avoid Mac permission issues
    await new Promise<void>((resolve, reject) => {
      conn.exec("SET home_directory='/tmp/duckdb';", (err) => {
        if (err) {
          console.warn(`[MotherDuckUnified] Failed to set home_directory:`, err.message);
          // Don't reject - continue anyway as this is a best practice, not required
        }
        resolve();
      });
    });

    // Load spatial extension
    await new Promise<void>((resolve, reject) => {
      conn.exec('INSTALL spatial; LOAD spatial;', (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    globalForDuckDB.overtureConnection = conn;
    return conn;
  }

  /**
   * Extract Supabase host from URL
   */
  private static getSupabaseHost(): string {
    const url = new URL(this.SUPABASE_URL);
    // Convert https://kfnsnwqylsdsbgnwgxva.supabase.co to db.kfnsnwqylsdsbgnwgxva.supabase.co
    const hostname = url.hostname;
    if (hostname.includes('supabase.co')) {
      return `db.${hostname}`;
    }
    return hostname;
  }

  /**
   * Fetch buildings by GERS IDs from Overture S3
   * Node-First Architecture: 100% Node-First - No ATTACH POSTGRES required
   * 
   * This method:
   * - Connects ONLY to MotherDuck (md:) - no Supabase database connection
   * - Queries Overture S3 Parquet files directly using WHERE id IN (...)
   * - Uses bounding box filtering to prevent OOM errors (only scans relevant area)
   * - Returns building features with geometry and properties
   * - Used by export-overture-tiles.ts which fetches IDs via Supabase JS client (HTTPS)
   * 
   * @param ids - Array of Overture GERS IDs to fetch (provided by Node script via Supabase API)
   * @param bbox - Optional bounding box [minLon, minLat, maxLon, maxLat] to limit search area and prevent OOM
   * @returns Array of building features with geometry and properties
   */
  static async fetchBuildingsByIds(ids: string[], bbox?: { minLon: number; minLat: number; maxLon: number; maxLat: number }): Promise<UnifiedBuildingFeature[]> {
    console.log('[DEBUG] fetchBuildingsByIds called');
    console.log('[DEBUG] this.USE_MOTHERDUCK:', this.USE_MOTHERDUCK);
    console.log('[DEBUG] this.MOTHERDUCK_TOKEN exists:', !!this.MOTHERDUCK_TOKEN);
    console.log('[DEBUG] process.env.MOTHERDUCK_TOKEN exists:', !!process.env.MOTHERDUCK_TOKEN);
    console.log('[DEBUG] process.env.MOTHERDUCK_TOKEN length:', process.env.MOTHERDUCK_TOKEN?.length || 0);
    if (!this.USE_MOTHERDUCK) {
      console.log('[DEBUG] ERROR: USE_MOTHERDUCK is false');
      console.log('[DEBUG] getter MOTHERDUCK_TOKEN:', this.MOTHERDUCK_TOKEN ? 'SET' : 'NOT SET');
      console.log('[DEBUG] direct process.env.MOTHERDUCK_TOKEN:', process.env.MOTHERDUCK_TOKEN ? 'SET' : 'NOT SET');
      throw new Error('MotherDuck is not enabled. Set MOTHERDUCK_TOKEN environment variable.');
    }

    if (!ids || ids.length === 0) {
      console.warn('[MotherDuckUnified] No GERS IDs provided');
      return [];
    }

    // Connect to MotherDuck only (md:) - NO ATTACH POSTGRES
    // getConnection() only loads spatial extension and connects to MotherDuck
    const conn = await this.getConnection();

    // Set S3 region for Overture access
    await new Promise<void>((resolve, reject) => {
      conn.exec("SET s3_region='us-west-2';", (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // Escape IDs for SQL (handle single quotes)
    const escapedIds = ids.map(id => `'${String(id).replace(/'/g, "''")}'`).join(',');
    
    // Build bounding box filter to prevent OOM errors
    // Only scan relevant area instead of entire world's address data
    // Overture Parquet files use bbox column (xmin, xmax, ymin, ymax) for spatial partitioning
    // 
    // Spatial intersection logic:
    // - For longitude: bbox.xmin <= maxLon AND bbox.xmax >= minLon (bbox overlaps query range)
    // - For latitude: bbox.ymin <= maxLat AND bbox.ymax >= minLat (bbox overlaps query range)
    // This ensures we only scan Parquet files that contain data within our bounding box
    let bboxFilterBuildings = '';
    let bboxFilterAddresses = '';
    if (bbox) {
      // Use bbox values directly (padding already applied in export script)
      // bbox.xmin/xmax are longitude bounds, bbox.ymin/ymax are latitude bounds
      // Apply to both Buildings and Addresses themes
      bboxFilterBuildings = `
        AND bbox.xmin <= ${bbox.maxLon}
        AND bbox.xmax >= ${bbox.minLon}
        AND bbox.ymin <= ${bbox.maxLat}
        AND bbox.ymax >= ${bbox.minLat}
      `;
      bboxFilterAddresses = bboxFilterBuildings; // Same filter for addresses
    }
    
    // Query Overture S3 Parquet with spatial join to addresses theme
    // CRITICAL: This is a pure Overture query - NO ATTACH POSTGRES needed
    // The IDs come from the Node script which fetched them via Supabase JS client (HTTPS)
    // 
    // Double-Fetch Strategy: Join buildings (shapes) with addresses (labels)
    // BBox filtering on BOTH themes prevents OOM by only scanning relevant area
    const query = `
      WITH building_data AS (
        -- Step 1: Get buildings (3D footprints and height) for the requested IDs
        -- BBox filter limits scan to relevant area (prevents OOM)
        -- ST_Subdivide optimizes complex polygons (U-shaped buildings, large complexes)
        -- 255 vertices per polygon is optimal for GIST index performance
        SELECT 
          id AS building_id,
          id AS gers_id,
          -- Apply ST_Subdivide to complex polygons for better GIST index performance
          -- This reduces false positives in spatial queries for U-shaped buildings
          ST_Subdivide(geometry, 255) AS building_geometry,
          COALESCE(height, (num_floors * 3.5), 10) AS render_height,
          -- Use names.primary (STRUCT, not LIST) for building name
          -- Robust struct access: handle NULL structs and missing fields gracefully
          CASE 
            WHEN names IS NOT NULL 
              AND typeof(names) = 'STRUCT'
              AND names.primary IS NOT NULL
            THEN names.primary
            ELSE NULL
          END AS overture_name
        FROM read_parquet('s3://overturemaps-us-west-2/release/${this.OVERTURE_RELEASE}/theme=buildings/type=building/*')
        WHERE id IN (${escapedIds})
          AND geometry IS NOT NULL
          ${bboxFilterBuildings}
      ),
      address_data AS (
        -- Step 2: Get addresses (official address points) that might match our buildings
        -- CRITICAL: BBox filter here prevents scanning entire world's address data (prevents OOM)
        SELECT 
          geometry AS address_geometry,
          -- Build address from number and street: number || ' ' || street
          TRIM(
            COALESCE(number, '') || ' ' ||
            COALESCE(street, '')
          ) AS overture_address,
          number,
          street
        FROM read_parquet('s3://overturemaps-us-west-2/release/${this.OVERTURE_RELEASE}/theme=addresses/type=address/*')
        WHERE geometry IS NOT NULL
          ${bboxFilterAddresses}
      )
      -- Step 3: Spatial join - find address points inside building polygons
      SELECT 
        b.building_id,
        b.gers_id,
        ST_AsGeoJSON(b.building_geometry) AS geometry,
        b.render_height,
        -- Address priority: Overture address > Building name > Unknown
        COALESCE(
          a.overture_address,  -- First: Official address from addresses theme (number || ' ' || street)
          b.overture_name,     -- Second: Building name (names.primary) from buildings theme
          'Unknown'            -- Third: Default fallback
        ) AS full_address
      FROM building_data b
      LEFT JOIN address_data a 
        ON ST_Intersects(a.address_geometry, b.building_geometry)
      -- If multiple addresses match, pick the closest one to building centroid
      QUALIFY ROW_NUMBER() OVER (
        PARTITION BY b.building_id 
        ORDER BY CASE 
          WHEN a.address_geometry IS NOT NULL 
          THEN ST_Distance(a.address_geometry, ST_Centroid(b.building_geometry))
          ELSE 999999
        END
      ) = 1
    `;

    console.log(`[MotherDuckUnified] Fetching ${ids.length} buildings by GERS IDs from Overture S3...`);
    console.time('[MotherDuckUnified] Overture ID query');

    return new Promise((resolve, reject) => {
      const results: UnifiedBuildingFeature[] = [];

      conn.all(query, (err, rows: any[]) => {
        if (err) {
          console.timeEnd('[MotherDuckUnified] Overture ID query');
          console.error('[MotherDuckUnified] Query error:', err);
          reject(err);
          return;
        }

        console.timeEnd('[MotherDuckUnified] Overture ID query');

        if (!rows || rows.length === 0) {
          console.warn(`[MotherDuckUnified] No buildings found for provided GERS IDs`);
          resolve([]);
          return;
        }

        console.log(`[MotherDuckUnified] Found ${rows.length} buildings out of ${ids.length} requested IDs`);

        // Transform results
        for (const row of rows) {
          try {
            let geometry;
            if (typeof row.geometry === 'string') {
              geometry = JSON.parse(row.geometry);
            } else if (row.geometry && typeof row.geometry === 'object') {
              geometry = row.geometry;
            } else {
              console.warn('[MotherDuckUnified] Invalid geometry format:', typeof row.geometry);
              continue;
            }

            if (!geometry || !geometry.type || !geometry.coordinates) {
              console.warn('[MotherDuckUnified] Invalid geometry structure:', geometry);
              continue;
            }

            results.push({
              building_id: String(row.building_id || row.gers_id || ''),
              render_height: Number(row.render_height) || 10,
              full_address: String(row.full_address || 'Address not available'),
              campaign_name: 'Unknown Campaign', // Not available in this query
              campaign_status: 'pending', // Not available in this query
              geometry,
              height: Number(row.render_height) || 10,
              min_height: 0,
            });
          } catch (e: any) {
            console.warn('[MotherDuckUnified] Failed to parse row:', e.message);
          }
        }

        console.log(`[MotherDuckUnified] Successfully parsed ${results.length} building features`);
        resolve(results);
      });
    });
  }

  /**
   * Fetch buildings by bounding box from Overture S3 (spatial fallback)
   * Node-First Architecture: 100% Node-First - No ATTACH POSTGRES required
   * 
   * This method is used as a fallback when ID-based lookup fails.
   * It queries all buildings within a bounding box, regardless of IDs.
   * 
   * @param bbox - Bounding box [minLon, minLat, maxLon, maxLat] to limit search area
   * @returns Array of building features with geometry and properties
   */
  static async fetchBuildingsByBBox(bbox: { minLon: number; minLat: number; maxLon: number; maxLat: number }): Promise<UnifiedBuildingFeature[]> {
    console.log('[MotherDuckUnified] fetchBuildingsByBBox called (spatial fallback)');
    
    if (!this.USE_MOTHERDUCK) {
      throw new Error('MotherDuck is not enabled. Set MOTHERDUCK_TOKEN environment variable.');
    }

    if (!bbox) {
      throw new Error('Bounding box is required for spatial search');
    }

    // Connect to MotherDuck only (md:) - NO ATTACH POSTGRES
    const conn = await this.getConnection();

    // Set S3 region for Overture access
    await new Promise<void>((resolve, reject) => {
      conn.exec("SET s3_region='us-west-2';", (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // Build bounding box filter to prevent OOM errors
    // Overture Parquet files use bbox column (xmin, xmax, ymin, ymax) for spatial partitioning
    const bboxFilterBuildings = `
      AND bbox.xmin <= ${bbox.maxLon}
      AND bbox.xmax >= ${bbox.minLon}
      AND bbox.ymin <= ${bbox.maxLat}
      AND bbox.ymax >= ${bbox.minLat}
    `;
    const bboxFilterAddresses = bboxFilterBuildings; // Same filter for addresses

    // Query Overture S3 Parquet with spatial filtering (no ID filter)
    // This fetches ALL buildings in the bounding box
    const query = `
      WITH building_data AS (
        -- Step 1: Get all buildings (3D footprints and height) within bounding box
        -- BBox filter limits scan to relevant area (prevents OOM)
        -- ST_Subdivide optimizes complex polygons (U-shaped buildings, large complexes)
        -- 255 vertices per polygon is optimal for GIST index performance
        SELECT 
          id AS building_id,
          id AS gers_id,
          -- Apply ST_Subdivide to complex polygons for better GIST index performance
          -- This reduces false positives in spatial queries for U-shaped buildings
          ST_Subdivide(geometry, 255) AS building_geometry,
          COALESCE(height, (num_floors * 3.5), 10) AS render_height,
          -- Use names.primary (STRUCT, not LIST) for building name
          CASE 
            WHEN names IS NOT NULL 
              AND typeof(names) = 'STRUCT'
              AND names.primary IS NOT NULL
            THEN names.primary
            ELSE NULL
          END AS overture_name
        FROM read_parquet('s3://overturemaps-us-west-2/release/${this.OVERTURE_RELEASE}/theme=buildings/type=building/*')
        WHERE 
          -- Coarse Filter: Use BBox first (Fast) - filters parquet files by spatial partitioning
          bbox.xmin <= ${bbox.maxLon}
          AND bbox.xmax >= ${bbox.minLon}
          AND bbox.ymin <= ${bbox.maxLat}
          AND bbox.ymax >= ${bbox.minLat}
          -- Fine Filter: Use exact BBox geometry (Precise) - matches working Address query pattern
          -- Note: If query still returns 0 results, try:
          -- 1. Changing OVERTURE_RELEASE to '2024-12-11-0' (if release is unavailable)
          -- 2. Removing 'type=building' from path: 'theme=buildings/*' (if type filtering changed)
          AND ST_Intersects(
            geometry,
            ST_MakeEnvelope(${bbox.minLon}, ${bbox.minLat}, ${bbox.maxLon}, ${bbox.maxLat})
          )
          AND geometry IS NOT NULL
      ),
      address_data AS (
        -- Step 2: Get addresses (official address points) within bounding box
        -- CRITICAL: BBox filter here prevents scanning entire world's address data (prevents OOM)
        SELECT 
          geometry AS address_geometry,
          -- Build address from number and street: number || ' ' || street
          TRIM(
            COALESCE(number, '') || ' ' ||
            COALESCE(street, '')
          ) AS overture_address,
          number,
          street
        FROM read_parquet('s3://overturemaps-us-west-2/release/${this.OVERTURE_RELEASE}/theme=addresses/type=address/*')
        WHERE geometry IS NOT NULL
          ${bboxFilterAddresses}
      )
      -- Step 3: Spatial join - find address points inside building polygons
      SELECT 
        b.building_id,
        b.gers_id,
        ST_AsGeoJSON(b.building_geometry) AS geometry,
        b.render_height,
        -- Address priority: Overture address > Building name > Unknown
        COALESCE(
          a.overture_address,  -- First: Official address from addresses theme (number || ' ' || street)
          b.overture_name,     -- Second: Building name (names.primary) from buildings theme
          'Unknown'            -- Third: Default fallback
        ) AS full_address
      FROM building_data b
      LEFT JOIN address_data a 
        ON ST_Intersects(a.address_geometry, b.building_geometry)
      -- If multiple addresses match, pick the closest one to building centroid
      QUALIFY ROW_NUMBER() OVER (
        PARTITION BY b.building_id 
        ORDER BY CASE 
          WHEN a.address_geometry IS NOT NULL 
          THEN ST_Distance(a.address_geometry, ST_Centroid(b.building_geometry))
          ELSE 999999
        END
      ) = 1
    `;

    console.log(`[MotherDuckUnified] Fetching buildings by bounding box from Overture S3...`);
    console.log(`[MotherDuckUnified] BBox: [${bbox.minLon}, ${bbox.minLat}] to [${bbox.maxLon}, ${bbox.maxLat}]`);
    console.log('[DEBUG] Building SQL:', query);
    console.time('[MotherDuckUnified] Overture BBox query');

    return new Promise((resolve, reject) => {
      const results: UnifiedBuildingFeature[] = [];

      conn.all(query, (err, rows: any[]) => {
        if (err) {
          console.timeEnd('[MotherDuckUnified] Overture BBox query');
          console.error('[MotherDuckUnified] Query error:', err);
          reject(err);
          return;
        }

        console.timeEnd('[MotherDuckUnified] Overture BBox query');

        if (!rows || rows.length === 0) {
          console.warn(`[MotherDuckUnified] No buildings found in bounding box`);
          resolve([]);
          return;
        }

        console.log(`[MotherDuckUnified] Found ${rows.length} buildings in bounding box`);

        // Transform results
        for (const row of rows) {
          try {
            let geometry;
            if (typeof row.geometry === 'string') {
              geometry = JSON.parse(row.geometry);
            } else if (row.geometry && typeof row.geometry === 'object') {
              geometry = row.geometry;
            } else {
              console.warn('[MotherDuckUnified] Invalid geometry format:', typeof row.geometry);
              continue;
            }

            if (!geometry || !geometry.type || !geometry.coordinates) {
              console.warn('[MotherDuckUnified] Invalid geometry structure:', geometry);
              continue;
            }

            results.push({
              building_id: String(row.building_id || row.gers_id || ''),
              render_height: Number(row.render_height) || 10,
              full_address: String(row.full_address || 'Address not available'),
              campaign_name: 'Unknown Campaign', // Not available in this query
              campaign_status: 'pending', // Not available in this query
              geometry,
              height: Number(row.render_height) || 10,
              min_height: 0,
            });
          } catch (e: any) {
            console.warn('[MotherDuckUnified] Failed to parse row:', e.message);
          }
        }

        console.log(`[MotherDuckUnified] Successfully parsed ${results.length} building features`);
        resolve(results);
      });
    });
  }

  /**
   * Fetch unified buildings for a campaign using MotherDuck
   */
  static async fetchUnifiedBuildings(campaignId: string): Promise<UnifiedBuildingFeature[]> {
    if (!this.USE_MOTHERDUCK) {
      throw new Error('MotherDuck is not enabled. Set MOTHERDUCK_TOKEN environment variable.');
    }

    const conn = await this.getConnection();

    // First, get campaign addresses from Supabase to calculate bounding box
    // We'll use a simpler approach: fetch addresses via API, then query Overture
    // For now, we'll use the existing services to get addresses, then query Overture
    
    // Extract Supabase connection info
    const supabaseHost = this.getSupabaseHost();
    const supabaseUser = 'postgres';
    const supabaseDb = 'postgres';
    
    // Note: We need the database password for Postgres connection
    // For now, we'll use a hybrid approach: fetch addresses from Supabase API,
    // then query Overture buildings and match them

    // This is a simplified version - in production, you'd want to:
    // 1. ATTACH Supabase as Postgres in MotherDuck
    // 2. Run the full SQL query as described in MOTHERDUCK_ARCHITECTURE.md
    
    // For now, return empty array and log that full implementation is needed
    console.warn('[MotherDuckUnified] Full MotherDuck integration requires Supabase database password. Using fallback approach.');
    
    return [];
  }

  /**
   * Execute MotherDuck SQL query to get unified buildings
   * This is the full implementation that requires Supabase DB password
   * 
   * @deprecated This method uses expensive spatial joins (ST_Intersects).
   * Use GERS-First ID-based architecture instead:
   * 1. Run stamp-addresses-with-gers.ts to populate source_id
   * 2. Use bake.sql with WHERE id IN (SELECT source_id...) instead
   * 3. Query buildings by GERS ID via /api/buildings/[gersId]
   * 
   * This method is kept for backward compatibility with export-overture-tiles.ts
   * but should be replaced with ID-based lookups for better performance.
   */
  static async fetchUnifiedBuildingsWithSQL(
    campaignId: string,
    supabasePassword: string
  ): Promise<UnifiedBuildingFeature[]> {
    console.warn(
      '[MotherDuckUnified] fetchUnifiedBuildingsWithSQL is deprecated. ' +
      'Use GERS-First ID-based architecture for 100x better performance. ' +
      'See scripts/stamp-addresses-with-gers.ts and scripts/bake.sql'
    );
    if (!this.USE_MOTHERDUCK) {
      throw new Error('MotherDuck is not enabled. Set MOTHERDUCK_TOKEN environment variable.');
    }

    const conn = await this.getConnection();
    const supabaseHost = this.getSupabaseHost();

    // Load Postgres extension for Supabase connection
    console.time('[MotherDuckUnified] Postgres extension load');
    try {
      await new Promise<void>((resolve, reject) => {
        conn.exec('INSTALL postgres; LOAD postgres;', (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      console.timeEnd('[MotherDuckUnified] Postgres extension load');
      console.log('[MotherDuckUnified] Postgres extension loaded successfully');
    } catch (error: any) {
      console.timeEnd('[MotherDuckUnified] Postgres extension load');
      throw new Error(`Failed to load Postgres extension: ${error.message}`);
    }

    // ATTACH Supabase as Postgres
    // Connection string format: postgresql://postgres:[PASSWORD]@db.kfnsnwqylsdsbgnwgxva.supabase.co:5432/postgres
    // We extract just the password part for the ATTACH command
    // NOTE: ATTACH can take 5-10 seconds, may timeout if API timeout is shorter
    const attachSQL = `
      ATTACH 'host=${supabaseHost} user=postgres password=${supabasePassword} dbname=postgres port=5432 sslmode=require' 
      AS supabase (TYPE POSTGRES);
    `;

    console.time('[MotherDuckUnified] ATTACH Supabase');
    console.log(`[MotherDuckUnified] Attaching Supabase at ${supabaseHost}...`);
    try {
      await new Promise<void>((resolve, reject) => {
        conn.exec(attachSQL, (err) => {
          if (err) {
            console.timeEnd('[MotherDuckUnified] ATTACH Supabase');
            console.error('[MotherDuckUnified] Failed to attach Supabase:', err.message);
            reject(new Error(`Failed to attach Supabase: ${err.message}`));
            return;
          }
          resolve();
        });
      });
      console.timeEnd('[MotherDuckUnified] ATTACH Supabase');
      console.log('[MotherDuckUnified] Supabase attached successfully');
    } catch (error: any) {
      console.timeEnd('[MotherDuckUnified] ATTACH Supabase');
      throw new Error(`Failed to attach Supabase database: ${error.message}. Please verify SUPABASE_DB_PASSWORD is correct.`);
    }

    // First, get campaign addresses to calculate bounding box
    // This helps filter Overture buildings more efficiently
    const addressQuery = `
      SELECT 
        id,
        campaign_id,
        formatted,
        address,
        ST_AsGeoJSON(geom)::json AS geom_json,
        coordinate,
        visited,
        ST_X(ST_Centroid(geom)) AS lon,
        ST_Y(ST_Centroid(geom)) AS lat
      FROM supabase.campaign_addresses
      WHERE campaign_id = '${campaignId}'
        AND geom IS NOT NULL
      LIMIT 1000
    `;

    // Get campaign info
    const campaignQuery = `
      SELECT 
        id,
        COALESCE(title, name) AS campaign_name
      FROM supabase.campaigns
      WHERE id = '${campaignId}'
    `;

    // Execute address query to get bounding box
    console.time('[MotherDuckUnified] Address query');
    const addresses = await new Promise<any[]>((resolve, reject) => {
      conn.all(addressQuery, (err, rows: any[]) => {
        if (err) {
          console.timeEnd('[MotherDuckUnified] Address query');
          console.warn('[MotherDuckUnified] Failed to fetch addresses:', err.message);
          resolve([]);
          return;
        }
        console.timeEnd('[MotherDuckUnified] Address query');
        resolve(rows || []);
      });
    });

    if (addresses.length === 0) {
      console.warn('[MotherDuckUnified] No addresses found for campaign');
      return [];
    }

    // Calculate bounding box with padding
    const lons = addresses.map(a => a.lon).filter(Boolean);
    const lats = addresses.map(a => a.lat).filter(Boolean);
    
    if (lons.length === 0 || lats.length === 0) {
      console.warn('[MotherDuckUnified] No valid coordinates in addresses');
      return [];
    }

    const minLon = Math.min(...lons) - 0.01; // ~1km padding
    const maxLon = Math.max(...lons) + 0.01;
    const minLat = Math.min(...lats) - 0.01;
    const maxLat = Math.max(...lats) + 0.01;

    // Get campaign name
    console.time('[MotherDuckUnified] Campaign query');
    const campaignRows = await new Promise<any[]>((resolve, reject) => {
      conn.all(campaignQuery, (err, rows: any[]) => {
        if (err) {
          console.timeEnd('[MotherDuckUnified] Campaign query');
          console.warn('[MotherDuckUnified] Failed to fetch campaign:', err.message);
          resolve([]);
          return;
        }
        console.timeEnd('[MotherDuckUnified] Campaign query');
        resolve(rows || []);
      });
    });

    const campaignName = campaignRows[0]?.campaign_name || 'Unknown Campaign';

    // Create temporary table for address points
    await new Promise<void>((resolve, reject) => {
      conn.exec(`
        CREATE TEMP TABLE IF NOT EXISTS temp_address_points (
          id VARCHAR,
          formatted VARCHAR,
          address VARCHAR,
          visited BOOLEAN,
          point_geom GEOMETRY
        );
      `, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // Insert address points
    for (const addr of addresses) {
      if (!addr.lon || !addr.lat) continue;
      
      const insertSQL = `
        INSERT INTO temp_address_points (id, formatted, address, visited, point_geom)
        VALUES (
          '${addr.id.replace(/'/g, "''")}',
          '${(addr.formatted || '').replace(/'/g, "''")}',
          '${(addr.address || '').replace(/'/g, "''")}',
          ${addr.visited ? 'true' : 'false'},
          ST_Point(${addr.lon}, ${addr.lat})
        );
      `;

      await new Promise<void>((resolve, reject) => {
        conn.exec(insertSQL, (err) => {
          if (err) {
            console.warn(`[MotherDuckUnified] Failed to insert address ${addr.id}:`, err.message);
          }
          resolve(); // Don't reject - continue with other addresses
        });
      });
    }

    // Build the unified query with bounding box filter
    // Note: Overture addresses are stored as a list/array, we extract the first one's freeform field
    const query = `
      WITH overture_buildings AS (
        SELECT 
          id AS building_id,
          geometry,
          COALESCE(height, 10) AS render_height,
          -- Extract address from nested structure: addresses[1].freeform
          -- Handle case where addresses might be null or empty
          CASE 
            WHEN addresses IS NOT NULL 
              AND len(addresses) > 0 
              AND addresses[1] IS NOT NULL
              AND addresses[1].freeform IS NOT NULL
            THEN addresses[1].freeform
            ELSE NULL
          END AS full_address,
          bbox
        FROM read_parquet('s3://overturemaps-us-west-2/release/${this.OVERTURE_RELEASE}/theme=buildings/type=building/*')
        WHERE geometry IS NOT NULL
          AND bbox.xmin <= ${maxLon}
          AND bbox.xmax >= ${minLon}
          AND bbox.ymin <= ${maxLat}
          AND bbox.ymax >= ${minLat}
      )
      SELECT 
        o.building_id,
        o.render_height,
        COALESCE(o.full_address, a.formatted, a.address, 'Address not available') AS full_address,
        '${campaignName.replace(/'/g, "''")}' AS campaign_name,
        CASE WHEN a.visited THEN 'visited' ELSE 'pending' END AS campaign_status,
        ST_AsGeoJSON(o.geometry)::json AS geometry,
        a.id AS address_id,
        o.render_height AS height,
        0 AS min_height
      FROM overture_buildings o
      -- DEPRECATED: Spatial join (ST_Intersects) - expensive and error-prone
      -- GERS-First Architecture: Use WHERE id IN (SELECT source_id...) instead
      -- This join is kept for backward compatibility only
      INNER JOIN temp_address_points a ON ST_Intersects(a.point_geom, o.geometry)
      WHERE o.render_height IS NOT NULL
    `;

    return new Promise((resolve, reject) => {
      const results: UnifiedBuildingFeature[] = [];

      console.log(`[MotherDuckUnified] Executing Overture join query for campaign ${campaignId} with ${addresses.length} addresses`);
      console.log(`[MotherDuckUnified] Bounding box: [${minLon}, ${minLat}] to [${maxLon}, ${maxLat}]`);
      console.time('[MotherDuckUnified] Overture join query');

      conn.all(query, (err, rows: any[]) => {
        if (err) {
          console.timeEnd('[MotherDuckUnified] Overture join query');
          console.error('[MotherDuckUnified] Query error:', err);
          reject(err);
          return;
        }

        console.timeEnd('[MotherDuckUnified] Overture join query');

        if (!rows || rows.length === 0) {
          console.warn(`[MotherDuckUnified] No buildings found for campaign ${campaignId}`);
          resolve([]);
          return;
        }

        console.log(`[MotherDuckUnified] Found ${rows.length} buildings for campaign ${campaignId}`);

        // Transform results
        console.time('[MotherDuckUnified] Parse geometry results');
        for (const row of rows) {
          try {
            let geometry;
            if (typeof row.geometry === 'string') {
              geometry = JSON.parse(row.geometry);
            } else if (row.geometry && typeof row.geometry === 'object') {
              geometry = row.geometry;
            } else {
              console.warn('[MotherDuckUnified] Invalid geometry format:', typeof row.geometry);
              continue;
            }

            if (!geometry || !geometry.type || !geometry.coordinates) {
              console.warn('[MotherDuckUnified] Invalid geometry structure:', geometry);
              continue;
            }
            
            // Validate ST_AsGeoJSON output is valid GeoJSON
            if (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon') {
              console.warn('[MotherDuckUnified] Unexpected geometry type (expected Polygon/MultiPolygon):', geometry.type);
            }

            results.push({
              building_id: String(row.building_id || ''),
              render_height: Number(row.render_height) || 10,
              full_address: String(row.full_address || 'Address not available'),
              campaign_name: String(row.campaign_name || 'Unknown Campaign'),
              campaign_status: String(row.campaign_status || 'pending'),
              geometry,
              address_id: row.address_id ? String(row.address_id) : undefined,
              height: Number(row.height || row.render_height || 10),
              min_height: Number(row.min_height || 0),
            });
          } catch (e: any) {
            console.warn('[MotherDuckUnified] Failed to parse row:', e.message, row);
          }
        }

        console.timeEnd('[MotherDuckUnified] Parse geometry results');
        console.log(`[MotherDuckUnified] Successfully parsed ${results.length} building features`);
        resolve(results);
      });
    }).finally(() => {
      // Cleanup: Drop temporary table
      conn.exec('DROP TABLE IF EXISTS temp_address_points;', (err) => {
        if (err) {
          console.warn('[MotherDuckUnified] Failed to cleanup temp table:', err.message);
        }
      });
    });
  }
}
