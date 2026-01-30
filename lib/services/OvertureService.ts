/**
 * Overture Service - DuckDB Integration for Overture Maps Data
 * 
 * This service handles extraction of buildings and transportation segments
 * from Overture S3 buckets using DuckDB via MotherDuck (cloud) or local DuckDB.
 */

// @ts-ignore - duckdb types may not be available
import duckdb from 'duckdb';

// --- Singleton Setup ---
// We attach the database instance and connection to the global object to survive Next.js hot-reloads.
// Otherwise, every time you save a file, Next.js creates a new DB instance, causing conflicts.
const globalForDuckDB = global as unknown as { 
  overtureDb: any | undefined;
  overtureConnection: any | undefined;
};

export interface OvertureBuilding {
  gers_id: string;
  geometry: any; // GeoJSON MultiPolygon
  centroid: any; // GeoJSON Point
  height?: number;
  house_name?: string;
  addr_housenumber?: string;
  addr_street?: string;
  addr_unit?: string;
  b_house_number?: string; // Address properties extracted from building theme
  b_street_name?: string; // Address properties extracted from building theme
}

export interface OvertureTransportation {
  gers_id: string;
  geometry: any; // GeoJSON LineString
  class: string;
}

export interface OvertureAddress {
  gers_id: string;
  geometry: any; // GeoJSON Point
  house_number?: string;
  street?: string;
  unit?: string;
  locality?: string;
  postcode?: string;
  region?: string;
  country?: string;
  building_gers_id?: string; // parent_id from Overture for handshake optimization
  /** Single-line display address (house_number + street + postcode). Built in processAddressResults if not from query. */
  formatted?: string;
}

export interface BoundingBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

export class OvertureService {
  private static readonly OVERTURE_RELEASE = '2025-12-17.0';
  private static readonly S3_REGION = 'us-west-2';
  private static readonly BUILDINGS_BUCKET = `s3://overturemaps-us-west-2/release/${this.OVERTURE_RELEASE}/theme=buildings/type=building/*`;
  private static readonly ADDRESSES_BUCKET = `s3://overturemaps-us-west-2/release/${this.OVERTURE_RELEASE}/theme=addresses/type=address/*`;
  private static readonly TRANSPORTATION_BUCKET = `s3://overturemaps-us-west-2/release/${this.OVERTURE_RELEASE}/theme=transportation/type=segment/*`;
  
  // MotherDuck configuration
  private static readonly MOTHERDUCK_TOKEN = process.env.MOTHERDUCK_TOKEN;
  private static readonly USE_MOTHERDUCK: boolean = !!process.env.MOTHERDUCK_TOKEN;

  /**
   * Get or Create the Singleton Database Instance
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

    console.log(`[Overture] Initializing DuckDB Singleton (${this.USE_MOTHERDUCK ? 'MotherDuck' : 'Local'})...`);
    console.log(`[Overture] Using connection string: ${connectionString}`);
    
    try {
      // Create the database instance ONCE
      // If token exists, connect to Cloud. If not, fallback to local (which crashes on Vercel).
      const db = new duckdb.Database(connectionString);
      
      // For MotherDuck, wait a bit for initialization
      if (this.USE_MOTHERDUCK) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      // Save to global scope
      globalForDuckDB.overtureDb = db;
      console.log(`[Overture] Database initialized successfully`);
      return db;
    } catch (error: any) {
      console.error(`[Overture] Failed to initialize database:`, error.message);
      throw new Error(
        `Failed to initialize MotherDuck database. ` +
        `Error: ${error.message}. ` +
        `Please verify: 1) MOTHERDUCK_TOKEN is valid and not expired, 2) Network connectivity to MotherDuck, 3) SSL certificates are installed.`
      );
    }
  }

  /**
   * Get or Create the Singleton Connection Instance
   * Includes "Warm-Up" handshake to verify connection is established
   * Loads the Spatial extension required for ST_Centroid and other spatial functions
   */
  private static async getConnection() {
    // 1. Return existing if valid
    if (globalForDuckDB.overtureConnection) {
      return globalForDuckDB.overtureConnection;
    }

    const db = await this.getDatabase();
    console.log('[Overture] Opening new MotherDuck connection...');
    const conn = db.connect();

    // Set home directory to /tmp to avoid Mac permission issues
    try {
      await new Promise((resolve, reject) => {
        conn.exec("SET home_directory='/tmp/duckdb';", (err: any) => {
          if (err) {
            console.warn(`[Overture] Failed to set home_directory:`, err.message);
            // Don't reject - continue anyway as this is a best practice, not required
          }
          resolve(null);
        });
      });
    } catch (err: any) {
      console.warn(`[Overture] Error setting home_directory:`, err.message);
    }

    // 2. THE FIX: Load the Spatial Extension & Warm Up
    // We combine them into one promise to ensure everything is ready
    try {
      await new Promise((resolve, reject) => {
        // Run these 3 commands in sequence
        conn.exec(`
          INSTALL spatial; 
          LOAD spatial; 
          SELECT 1;
        `, (err: any, res: any) => {
          if (err) reject(err);
          else resolve(res);
        });
      });
      
      console.log('[Overture] Spatial extension loaded & connection warm.');
    } catch (err: any) {
      console.error('[Overture] Connection setup failed:', err.message);
      // Don't save the broken connection
      throw err;
    }

    globalForDuckDB.overtureConnection = conn;
    return conn;
  }

  /**
   * Execute query via DuckDB (MotherDuck or local)
   * Includes robust retry logic for stale connections.
   */
  private static async executeDuckDBQuery(query: string, attempt: number = 0): Promise<any> {
    const MAX_RETRIES = 1;
    
    try {
      const conn = await this.getConnection();
      
      // Wrap callback-based DuckDB API in Promise
      return await new Promise((resolve, reject) => {
        conn.all(query, (err: any, res: any) => {
          if (err) reject(err);
          else resolve(res || []);
        });
      });

    } catch (error: any) {
      // Detect connection errors (stale/dead connections)
      const isConnectionError = 
        error.message?.includes('Connection was never established') || 
        error.message?.includes('closed') ||
        error.message?.includes('Connection Error') ||
        error.message?.includes('Connection') ||
        error.message?.includes('connection');
      
      // Retry with fresh connection if it's a connection error
      if (isConnectionError && attempt < MAX_RETRIES) {
        console.warn('[Overture] Connection error detected. Resetting singletons and retrying...');
        
        // FORCE RESET BOTH SINGLETONS before retrying
        globalForDuckDB.overtureConnection = undefined;
        globalForDuckDB.overtureDb = undefined;
        
        // Retry with fresh connection (will trigger warm-up handshake again)
        return this.executeDuckDBQuery(query, attempt + 1);
      }

      // SQL error or max retries exceeded - throw it
      const errorMsg = this.USE_MOTHERDUCK 
        ? `MotherDuck Query Failed: ${error.message}`
        : `DuckDB Query Failed: ${error.message}`;
      throw new Error(errorMsg);
    }
  }

  /**
   * Extract buildings and addresses from Overture for a bounding box
   * Uses DuckDB via MotherDuck (cloud) or local DuckDB binary
   */
  static async extractBuildings(bbox: BoundingBox): Promise<OvertureBuilding[]> {
    try {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/a6f366c9-64c5-41b8-a570-53cdd9ef80a7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'OvertureService.ts:214',message:'extractBuildings called',data:{bbox,USE_MOTHERDUCK:this.USE_MOTHERDUCK,BUILDINGS_BUCKET:this.BUILDINGS_BUCKET},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      
      // Build DuckDB query
      // Note: For MotherDuck, extensions are pre-installed
      // For local DuckDB, we need to install them first
      const setupQuery = this.USE_MOTHERDUCK ? '' : `
INSTALL spatial; LOAD spatial;
INSTALL httpfs; LOAD httpfs;
`;
      
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/a6f366c9-64c5-41b8-a570-53cdd9ef80a7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'OvertureService.ts:224',message:'Building query with filters',data:{bbox,subtypeFilter:'residential',classFilter:'NOT IN (garage, shed)',bboxLogic:'BETWEEN'},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
      // #endregion
      
      // Test query: Check if ANY buildings exist in bbox (no filters)
      const testQuery = `${setupQuery}
SET s3_region='${this.S3_REGION}';
SELECT COUNT(*) as total_count
FROM read_parquet('${this.BUILDINGS_BUCKET}')
WHERE bbox.xmin <= ${bbox.east} AND bbox.xmax >= ${bbox.west}
  AND bbox.ymin <= ${bbox.north} AND bbox.ymax >= ${bbox.south}
  AND geometry IS NOT NULL;
`;
      
      try {
        const testResult = await this.executeDuckDBQuery(testQuery);
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/a6f366c9-64c5-41b8-a570-53cdd9ef80a7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'OvertureService.ts:232',message:'Test query: buildings in bbox (no filters)',data:{testResult,overlapLogic:true},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'G'})}).catch(()=>{});
        // #endregion
      } catch (testErr: any) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/a6f366c9-64c5-41b8-a570-53cdd9ef80a7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'OvertureService.ts:237',message:'Test query failed',data:{error:testErr.message},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'G'})}).catch(()=>{});
        // #endregion
      }
      
      const query = `${setupQuery}
SET s3_region='${this.S3_REGION}';

WITH b AS (
    SELECT 
        -- GERS ID: Direct pass-through from Overture (no transformations)
        -- Overture IDs are UUIDs with hyphens - any transformation breaks the handshake
        id as gers_id, 
        geometry, 
        height, 
        names.primary as house_name,
        bbox.xmin as west,
        bbox.ymin as south,
        bbox.xmax as east,
        bbox.ymax as north
    FROM read_parquet('${this.BUILDINGS_BUCKET}')
    WHERE 
      -- Coarse Filter: Use BBox overlap logic (Fast) - matches working address query pattern
      bbox.xmin <= ${bbox.east} AND bbox.xmax >= ${bbox.west}
      AND bbox.ymin <= ${bbox.north} AND bbox.ymax >= ${bbox.south}
      -- Fine Filter: Use exact BBox geometry (Precise)
      AND ST_Intersects(
        geometry,
        ST_MakeEnvelope(${bbox.west}, ${bbox.south}, ${bbox.east}, ${bbox.north})
      )
      AND geometry IS NOT NULL
      -- Optional filters (may be too restrictive - comment out if needed)
      AND (subtype = 'residential' OR subtype IS NULL)
      AND (class IS NULL OR class NOT IN ('garage', 'shed'))
),
a AS (
    SELECT 
        id as gers_id,
        unit as addr_unit,
        street as addr_street,
        geometry as address_geom
    FROM read_parquet('${this.ADDRESSES_BUCKET}')
    WHERE bbox.xmin BETWEEN ${bbox.west} AND ${bbox.east} 
      AND bbox.ymin BETWEEN ${bbox.south} AND ${bbox.north}
)
SELECT 
    b.gers_id,
    ST_AsGeoJSON(b.geometry) AS geometry,
    COALESCE(a.address_geom, ST_Centroid(b.geometry)) as centroid,
    b.height,
    b.house_name,
    a.addr_street,
    a.addr_unit
FROM b 
LEFT JOIN a ON b.gers_id = a.gers_id;
`;

      if (this.USE_MOTHERDUCK) {
        console.log('Using MotherDuck for Overture extraction...');
      } else {
        console.log('Using local DuckDB for Overture extraction...');
      }

      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/a6f366c9-64c5-41b8-a570-53cdd9ef80a7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'OvertureService.ts:265',message:'About to execute query',data:{queryLength:query.length,queryPreview:query.substring(0,200)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
      // #endregion

      let result;
      try {
        result = await this.executeDuckDBQuery(query);
      } catch (queryError: any) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/a6f366c9-64c5-41b8-a570-53cdd9ef80a7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'OvertureService.ts:271',message:'Query execution error',data:{error:queryError.message,errorStack:queryError.stack?.substring(0,200)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
        // #endregion
        throw queryError;
      }
      
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/a6f366c9-64c5-41b8-a570-53cdd9ef80a7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'OvertureService.ts:275',message:'Query result received',data:{resultType:typeof result,isArray:Array.isArray(result),resultLength:Array.isArray(result)?result.length:1,firstResult:Array.isArray(result)&&result.length>0?{gers_id:result[0].gers_id,hasGeometry:!!result[0].geometry,hasHeight:!!result[0].height}:null},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
      // #endregion
      
      // DuckDB returns array of objects directly
      const processed = this.processBuildingResults(Array.isArray(result) ? result : [result]);
      
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/a6f366c9-64c5-41b8-a570-53cdd9ef80a7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'OvertureService.ts:274',message:'Processed results',data:{processedLength:processed.length,firstBuilding:processed.length>0?{gers_id:processed[0].gers_id,hasGeometry:!!processed[0].geometry,hasHeight:!!processed[0].height}:null},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
      // #endregion
      
      return processed;
    } catch (error) {
      console.error('Error extracting buildings from Overture:', error);
      throw error;
    }
  }

  /**
   * Extract buildings in a bounding box (Wide Net approach)
   * "Stable Surgical" pattern: Fetches all buildings in BBox from MotherDuck
   * Matching to addresses is done in PostGIS (sync_buildings_pro RPC)
   * This avoids MotherDuck planning errors from complex spatial joins
   */
  static async extractBuildingsForAddresses(
    bbox: BoundingBox
  ): Promise<OvertureBuilding[]> {
    try {
      const setupQuery = this.USE_MOTHERDUCK ? '' : `
INSTALL spatial; LOAD spatial;
INSTALL httpfs; LOAD httpfs;
`;

      // Buffer the BBox by ~50m (0.0005 degrees) to catch nearby footprints
      const buffer = 0.0005;

      // Wide Net Query: Fetch all buildings in BBox (spatial matching only)
      // This is fast and stable - avoids MotherDuck planning errors
      const query = `${setupQuery}
SET s3_region='${this.S3_REGION}';

SELECT 
    id as gers_id,
    ST_AsGeoJSON(geometry) AS geometry,
    COALESCE(height, (num_floors * 3.5), 8) as height
FROM read_parquet('${this.BUILDINGS_BUCKET}', hive_partitioning=1)
WHERE 
    -- Coarse Filter: Use BBox overlap logic (Fast) with buffer
    bbox.xmin <= ${bbox.east + buffer} AND bbox.xmax >= ${bbox.west - buffer}
    AND bbox.ymin <= ${bbox.north + buffer} AND bbox.ymax >= ${bbox.south - buffer}
    -- Fine Filter: Use exact BBox geometry (Precise) with buffer
    AND ST_Intersects(
      geometry,
      ST_MakeEnvelope(${bbox.west - buffer}, ${bbox.south - buffer}, ${bbox.east + buffer}, ${bbox.north + buffer})
    )
    AND geometry IS NOT NULL
    -- Optional filters
    AND (subtype = 'residential' OR subtype IS NULL)
    AND (class IS NULL OR class NOT IN ('garage', 'shed'));
`;

      console.log(`[Overture] Wide Net: Fetching all buildings in BBox [${bbox.west - buffer}, ${bbox.south - buffer}, ${bbox.east + buffer}, ${bbox.north + buffer}]...`);

      const result = await this.executeDuckDBQuery(query);
      const processed = this.processBuildingResults(Array.isArray(result) ? result : [result]);

      console.log(`[Overture] Wide Net: Fetched ${processed.length} buildings from MotherDuck`);

      return processed;
    } catch (error) {
      console.error('Error extracting buildings from Overture:', error);
      throw error;
    }
  }

  /**
   * SURGICAL PROVISIONING: Get buildings inside a polygon
   * Uses ST_Intersects at the MotherDuck level for precision filtering
   * No neighbors from BBox corners - only buildings touching your drawing
   */
  static async getBuildingsInPolygon(input: any): Promise<OvertureBuilding[]> {
    console.log('[Overture] Surgical: Fetching buildings inside polygon...');

    // --- ROBUST GEOJSON PARSING ---
    let polygon = input;
    if (input.type === 'FeatureCollection' && input.features?.length > 0) {
      polygon = input.features[0].geometry;
    } else if (input.type === 'Feature') {
      polygon = input.geometry;
    }

    if (!polygon || !polygon.coordinates) {
      console.error('[Overture] Invalid polygon for buildings:', JSON.stringify(input).substring(0, 100));
      return [];
    }

    // Calculate BBox for coarse filter (S3 partition pruning)
    let minX = 180, minY = 90, maxX = -180, maxY = -90;
    const coordinates = polygon.type === 'MultiPolygon'
      ? polygon.coordinates.flat(1)
      : polygon.coordinates;

    if (coordinates && coordinates.length > 0) {
      coordinates[0].forEach((coord: number[]) => {
        const [lng, lat] = coord;
        if (lng < minX) minX = lng;
        if (lng > maxX) maxX = lng;
        if (lat < minY) minY = lat;
        if (lat > maxY) maxY = lat;
      });
    }

    const bbox = { west: minX - 0.001, south: minY - 0.001, east: maxX + 0.001, north: maxY + 0.001 };
    console.log(`[Overture] Polygon BBox: [${bbox.west}, ${bbox.south}, ${bbox.east}, ${bbox.north}]`);

    // Convert polygon to GeoJSON string for DuckDB (escape single quotes)
    const polygonGeoJSON = JSON.stringify(polygon);

    const setupQuery = this.USE_MOTHERDUCK ? '' : `
INSTALL spatial; LOAD spatial;
INSTALL httpfs; LOAD httpfs;
`;

    // Surgical Query: ST_Intersects with the exact polygon
    const query = `${setupQuery}
SET s3_region='${this.S3_REGION}';

SELECT 
    id as gers_id,
    ST_AsGeoJSON(geometry) AS geometry,
    COALESCE(height, (num_floors * 3.5), 8) as height
FROM read_parquet('${this.BUILDINGS_BUCKET}', hive_partitioning=1)
WHERE 
    -- Coarse Filter: BBox overlap (fast S3 partition pruning)
    bbox.xmin <= ${bbox.east} AND bbox.xmax >= ${bbox.west}
    AND bbox.ymin <= ${bbox.north} AND bbox.ymax >= ${bbox.south}
    -- Fine Filter: Exact polygon intersection (surgical precision)
    AND ST_Intersects(
      geometry,
      ST_GeomFromGeoJSON('${polygonGeoJSON.replace(/'/g, "''")}')
    )
    AND geometry IS NOT NULL
    -- Optional filters
    AND (subtype = 'residential' OR subtype IS NULL)
    AND (class IS NULL OR class NOT IN ('garage', 'shed'));
`;

    try {
      const result = await this.executeDuckDBQuery(query);
      const processed = this.processBuildingResults(Array.isArray(result) ? result : [result]);
      console.log(`[Overture] Surgical: Found ${processed.length} buildings inside polygon`);
      return processed;
    } catch (error) {
      console.error('[Overture] Polygon buildings query error:', error);
      throw error;
    }
  }

  /**
   * Extract addresses in a bounding box from BOTH private S3 bucket AND Overture
   * "Ultimate Coverage" - merges your 160M database with Overture's public data
   * 
   * SPLIT QUERY ARCHITECTURE (v2):
   * - Two separate queries with explicit region settings to avoid cross-region conflicts
   * - Private S3 (us-east-1) and Overture S3 (us-west-2) run independently
   * - Fault-tolerant: if one fails, the other still returns results
   * - Optional polygon filter for surgical precision (solves 32 vs 15 bloat)
   * 
   * @param bbox - Bounding box to search within
   * @param polygon - Optional GeoJSON polygon for precise filtering
   */
  static async extractAddressesForBBox(
    bbox: BoundingBox,
    polygon?: any
  ): Promise<OvertureAddress[]> {
    // 1. Fetch from Private S3 (us-east-1) - Your 160M "Data Moat"
    let privateAddrs: OvertureAddress[] = [];
    try {
      privateAddrs = await this.extractAddressesFromPrivateS3(bbox);
      console.log(`[FLYR] Private S3 Search found: ${privateAddrs.length} addresses`);
    } catch (error: any) {
      console.warn(`[FLYR] Private S3 fetch failed (continuing with Overture): ${error.message}`);
      // Don't throw - continue with Overture only
    }

    // 2. Fetch from Overture Public S3 (us-west-2) - Bonus coverage
    let overtureAddrs: OvertureAddress[] = [];
    try {
      overtureAddrs = await this.extractAddressesFromOverture(bbox);
      console.log(`[FLYR] Overture Search found: ${overtureAddrs.length} addresses`);
    } catch (error: any) {
      console.warn(`[FLYR] Overture fetch failed (continuing with private data): ${error.message}`);
      // Don't throw - continue with private only
    }

    // 3. Intelligent Merge & Deduplicate (PRIVATE priority)
    const merged = this.mergeAddresses(privateAddrs, overtureAddrs);
    console.log(`[FLYR] Ultimate Coverage: ${merged.length} total addresses (${privateAddrs.length} PRIVATE priority, ${overtureAddrs.length} OVERTURE bonus)`);

    // 4. THE SURGICAL FILTER: If polygon provided, filter results to polygon bounds
    if (polygon) {
      const filtered = this.filterByPolygon(merged, polygon);
      console.log(`[FLYR] Polygon Filter: ${merged.length} → ${filtered.length} addresses (surgical precision)`);
      return filtered;
    }

    return merged;
  }

  /**
   * Fetch addresses from Private S3 bucket (us-east-1)
   * Your 160M address "Data Moat"
   */
  private static async extractAddressesFromPrivateS3(
    bbox: BoundingBox
  ): Promise<OvertureAddress[]> {
    const bucket = process.env.FLYR_ADDRESSES_S3_BUCKET || 'flyr-pro-addresses-2025';
    const region = process.env.FLYR_ADDRESSES_S3_REGION || 'us-east-1';
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

    // If no AWS credentials, return empty (will fall back to Overture)
    if (!accessKeyId || !secretAccessKey) {
      console.warn('[FLYR] AWS credentials not configured, skipping private S3');
      return [];
    }

    const setupQuery = this.USE_MOTHERDUCK ? '' : `
INSTALL spatial; LOAD spatial;
INSTALL httpfs; LOAD httpfs;
`;

    // CRITICAL: Set region to us-east-1 for private bucket
    const query = `${setupQuery}
SET s3_region='${region}';
SET s3_access_key_id='${accessKeyId}';
SET s3_secret_access_key='${secretAccessKey}';

SELECT 
    gers_id,
    house_number,
    street_name,
    COALESCE(unit, '') as unit,
    city as locality,
    state as region,
    postal_code,
    latitude,
    longitude,
    formatted,
    'PRIVATE' as source
FROM read_parquet('s3://${bucket}/master_addresses_parquet/state=*/data_0.parquet', hive_partitioning=1)
WHERE 
    latitude BETWEEN ${bbox.south} AND ${bbox.north}
    AND longitude BETWEEN ${bbox.west} AND ${bbox.east}
    AND latitude IS NOT NULL
    AND longitude IS NOT NULL
    AND house_number IS NOT NULL AND house_number != ''
    AND street_name IS NOT NULL AND street_name != '';
`;

    console.log(`[FLYR] Private S3: Fetching from ${bucket} (${region})...`);
    console.log(`[FLYR] BBox: [${bbox.west}, ${bbox.south}, ${bbox.east}, ${bbox.north}]`);

    const result = await this.executeDuckDBQuery(query);
    return this.processAddressResults(Array.isArray(result) ? result : [result]);
  }

  /**
   * Fetch addresses from Overture public S3 (us-west-2)
   * Bonus coverage from open data
   */
  private static async extractAddressesFromOverture(
    bbox: BoundingBox
  ): Promise<OvertureAddress[]> {
    const setupQuery = this.USE_MOTHERDUCK ? '' : `
INSTALL spatial; LOAD spatial;
INSTALL httpfs; LOAD httpfs;
`;

    // CRITICAL: Set region to us-west-2 for Overture bucket
    const query = `${setupQuery}
SET s3_region='${this.S3_REGION}';

SELECT 
    id as gers_id,
    ST_AsGeoJSON(geometry) AS geometry,
    COALESCE(number, '') as house_number,
    COALESCE(street, '') as street_name,
    COALESCE(postcode, '') as postal_code,
    COALESCE(postal_city, '') as locality,
    COALESCE(unit, '') as unit,
    'OVERTURE' as source
FROM read_parquet('${this.ADDRESSES_BUCKET}', hive_partitioning=1)
WHERE 
    bbox.xmin <= ${bbox.east} AND bbox.xmax >= ${bbox.west}
    AND bbox.ymin <= ${bbox.north} AND bbox.ymax >= ${bbox.south}
    AND ST_Intersects(
      geometry,
      ST_MakeEnvelope(${bbox.west}, ${bbox.south}, ${bbox.east}, ${bbox.north})
    )
    AND geometry IS NOT NULL;
`;

    console.log(`[FLYR] Overture: Fetching from ${this.ADDRESSES_BUCKET} (${this.S3_REGION})...`);

    const result = await this.executeDuckDBQuery(query);
    return this.processAddressResults(Array.isArray(result) ? result : [result]);
  }

  /**
   * Merge addresses from two sources with PRIVATE priority
   * Deduplicates by (house_number, street_name) - PRIVATE wins on conflict
   */
  private static mergeAddresses(
    privateAddrs: OvertureAddress[],
    overtureAddrs: OvertureAddress[]
  ): OvertureAddress[] {
    const seen = new Map<string, OvertureAddress>();

    // Add PRIVATE first (they have priority)
    for (const addr of privateAddrs) {
      const key = `${(addr.house_number || '').toLowerCase()}|${(addr.street || '').toLowerCase()}`;
      if (key !== '|') { // Skip empty entries
        seen.set(key, addr);
      }
    }

    // Add OVERTURE only if not already present (no duplicates)
    for (const addr of overtureAddrs) {
      const key = `${(addr.house_number || '').toLowerCase()}|${(addr.street || '').toLowerCase()}`;
      if (key !== '|' && !seen.has(key)) {
        seen.set(key, addr);
      }
    }

    return Array.from(seen.values());
  }

  /**
   * Filter addresses to only those within a GeoJSON polygon
   * Solves the "32 vs 15" bloat problem - surgical precision
   */
  private static filterByPolygon(
    addresses: OvertureAddress[],
    polygonInput: any
  ): OvertureAddress[] {
    // Unwrap GeoJSON to get raw polygon geometry
    let polygon = polygonInput;
    if (polygonInput.type === 'FeatureCollection' && polygonInput.features?.length > 0) {
      polygon = polygonInput.features[0].geometry;
    } else if (polygonInput.type === 'Feature') {
      polygon = polygonInput.geometry;
    }

    if (!polygon || !polygon.coordinates) {
      console.warn('[FLYR] Invalid polygon for filtering, returning all addresses');
      return addresses;
    }

    // Get the outer ring of the polygon
    const ring = polygon.type === 'MultiPolygon' 
      ? polygon.coordinates[0][0] 
      : polygon.coordinates[0];

    if (!ring || ring.length < 3) {
      console.warn('[FLYR] Polygon ring too small, returning all addresses');
      return addresses;
    }

    // Point-in-polygon test using ray casting algorithm
    const pointInPolygon = (lng: number, lat: number): boolean => {
      let inside = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0], yi = ring[i][1];
        const xj = ring[j][0], yj = ring[j][1];
        
        const intersect = ((yi > lat) !== (yj > lat)) &&
          (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
      }
      return inside;
    };

    // Filter addresses to those inside the polygon
    return addresses.filter(addr => {
      if (!addr.geometry || addr.geometry.type !== 'Point') return false;
      const [lng, lat] = addr.geometry.coordinates;
      return pointInPolygon(lng, lat);
    });
  }

  /**
   * Process raw address query results into OvertureAddress array
   * Handles both Overture schema and private 160M database schema
   */
  private static processAddressResults(results: any[]): OvertureAddress[] {
    return results.map((row: any) => {
      // Parse geometry (could be string or object)
      let geometry = row.geometry;
      if (typeof geometry === 'string') {
        try {
          geometry = JSON.parse(geometry);
        } catch {
          geometry = { type: 'Point', coordinates: [0, 0] };
        }
      }

      // If geometry is still missing but we have lat/lng, construct it
      if ((!geometry || geometry.type !== 'Point') && row.latitude && row.longitude) {
        geometry = { type: 'Point', coordinates: [row.longitude, row.latitude] };
      }

      // Ensure geometry is a Point
      if (!geometry || geometry.type !== 'Point') {
        geometry = { type: 'Point', coordinates: [0, 0] };
      }

      const houseNumber = row.house_number && row.house_number.trim() ? row.house_number : undefined;
      const street = row.street_name && row.street_name.trim() ? row.street_name : undefined;
      const postcode = row.postal_code && row.postal_code.trim() ? row.postal_code : undefined;
      const locality = row.locality && row.locality.trim() ? row.locality : undefined;
      const region = row.region && row.region.trim() ? row.region : undefined;
      const unit = row.unit && row.unit.trim() ? row.unit : undefined;
      
      const formatted =
        row.formatted && String(row.formatted).trim()
          ? String(row.formatted).trim()
          : [houseNumber, street, unit, locality, region, postcode].filter(Boolean).join(' ').trim() || undefined;

      return {
        gers_id: row.gers_id || row.id || '',
        geometry,
        house_number: houseNumber,
        street,
        unit,
        locality,
        postcode,
        region,
        country: row.country && row.country.trim() ? row.country : undefined,
        building_gers_id: undefined,
        formatted,
      };
    });
  }

  /**
   * Process raw query results into OvertureBuilding array with address_id
   */
  private static processBuildingResultsWithAddressId(results: any[]): Array<OvertureBuilding & { address_id: string }> {
    return results.map((row: any) => {
      // Parse geometry (could be string or object)
      let geometry = row.geometry;
      if (typeof geometry === 'string') {
        try {
          geometry = JSON.parse(geometry);
        } catch {
          geometry = { type: 'MultiPolygon', coordinates: [] };
        }
      }

      // Parse centroid (calculate from geometry)
      let centroid: any;
      if (geometry.type === 'MultiPolygon' && geometry.coordinates?.[0]?.[0]) {
        const coords = geometry.coordinates[0][0];
        const avgLon = coords.reduce((sum: number, c: number[]) => sum + c[0], 0) / coords.length;
        const avgLat = coords.reduce((sum: number, c: number[]) => sum + c[1], 0) / coords.length;
        centroid = { type: 'Point', coordinates: [avgLon, avgLat] };
      } else {
        centroid = { type: 'Point', coordinates: [0, 0] };
      }

      // CRITICAL: GERS ID must be passed through unchanged
      return {
        gers_id: row.gers_id || row.id || '',
        geometry,
        centroid,
        height: row.height,
        address_id: row.address_id || '',
      };
    });
  }

  /**
   * Process raw query results into OvertureBuilding array
   */
  private static processBuildingResults(results: any[]): OvertureBuilding[] {
    return results.map((row: any) => {
      // Parse geometry (could be string or object)
      let geometry = row.geometry;
      if (typeof geometry === 'string') {
        try {
          geometry = JSON.parse(geometry);
        } catch {
          geometry = { type: 'MultiPolygon', coordinates: [] };
        }
      }

      // Parse centroid (could be string or object)
      let centroid = row.centroid;
      if (typeof centroid === 'string') {
        try {
          centroid = JSON.parse(centroid);
        } catch {
          // Calculate from geometry if centroid parsing fails
          if (geometry.type === 'MultiPolygon' && geometry.coordinates?.[0]?.[0]) {
            const coords = geometry.coordinates[0][0];
            const avgLon = coords.reduce((sum: number, c: number[]) => sum + c[0], 0) / coords.length;
            const avgLat = coords.reduce((sum: number, c: number[]) => sum + c[1], 0) / coords.length;
            centroid = { type: 'Point', coordinates: [avgLon, avgLat] };
          } else {
            centroid = { type: 'Point', coordinates: [0, 0] };
          }
        }
      }

      // Ensure centroid is a Point
      if (!centroid || centroid.type !== 'Point') {
        centroid = { type: 'Point', coordinates: [0, 0] };
      }

      // CRITICAL: GERS ID must be passed through unchanged (no case conversion, no hyphen stripping)
      // Overture IDs are UUIDs with hyphens - any transformation breaks the handshake
      return {
        gers_id: row.gers_id || row.id || '',
        geometry,
        centroid,
        height: row.height,
        house_name: row.house_name,
        addr_housenumber: row.addr_housenumber,
        addr_street: row.addr_street,
        addr_unit: row.addr_unit,
      };
    });
  }

  /**
   * Extract transportation segments from Overture for a bounding box
   */
  static async extractTransportation(bbox: BoundingBox): Promise<OvertureTransportation[]> {
    try {
      // Build DuckDB query
      const setupQuery = this.USE_MOTHERDUCK ? '' : `
INSTALL spatial; LOAD spatial;
INSTALL httpfs; LOAD httpfs;
`;
      
      const query = `${setupQuery}
SET s3_region='${this.S3_REGION}';

SELECT 
    id as gers_id,
    geometry,
    class
FROM read_parquet('${this.TRANSPORTATION_BUCKET}')
WHERE bbox.xmin BETWEEN ${bbox.west} AND ${bbox.east} 
  AND bbox.ymin BETWEEN ${bbox.south} AND ${bbox.north}
  AND class IN ('primary', 'secondary', 'residential', 'tertiary');
`;

      if (this.USE_MOTHERDUCK) {
        console.log('Using MotherDuck for transportation extraction...');
      } else {
        console.log('Using local DuckDB for transportation extraction...');
      }

      const result = await this.executeDuckDBQuery(query);
      
      // DuckDB returns array of objects directly
      return this.processTransportationResults(Array.isArray(result) ? result : [result]);
    } catch (error) {
      console.error('Error extracting transportation from Overture:', error);
      throw error;
    }
  }

  /**
   * SURGICAL PROVISIONING: Get roads inside a polygon
   * Uses ST_Intersects at the MotherDuck level for precision filtering
   */
  static async getRoadsInPolygon(input: any): Promise<OvertureTransportation[]> {
    console.log('[Overture] Surgical: Fetching roads inside polygon...');

    // --- ROBUST GEOJSON PARSING ---
    let polygon = input;
    if (input.type === 'FeatureCollection' && input.features?.length > 0) {
      polygon = input.features[0].geometry;
    } else if (input.type === 'Feature') {
      polygon = input.geometry;
    }

    if (!polygon || !polygon.coordinates) {
      console.error('[Overture] Invalid polygon for roads:', JSON.stringify(input).substring(0, 100));
      return [];
    }

    // Calculate BBox for coarse filter (S3 partition pruning)
    let minX = 180, minY = 90, maxX = -180, maxY = -90;
    const coordinates = polygon.type === 'MultiPolygon'
      ? polygon.coordinates.flat(1)
      : polygon.coordinates;

    if (coordinates && coordinates.length > 0) {
      coordinates[0].forEach((coord: number[]) => {
        const [lng, lat] = coord;
        if (lng < minX) minX = lng;
        if (lng > maxX) maxX = lng;
        if (lat < minY) minY = lat;
        if (lat > maxY) maxY = lat;
      });
    }

    const bbox = { west: minX - 0.001, south: minY - 0.001, east: maxX + 0.001, north: maxY + 0.001 };

    // Convert polygon to GeoJSON string for DuckDB (escape single quotes)
    const polygonGeoJSON = JSON.stringify(polygon);

    const setupQuery = this.USE_MOTHERDUCK ? '' : `
INSTALL spatial; LOAD spatial;
INSTALL httpfs; LOAD httpfs;
`;

    // Surgical Query: ST_Intersects with the exact polygon
    const query = `${setupQuery}
SET s3_region='${this.S3_REGION}';

SELECT 
    id as gers_id,
    geometry,
    class
FROM read_parquet('${this.TRANSPORTATION_BUCKET}')
WHERE 
    -- Coarse Filter: BBox overlap (fast S3 partition pruning)
    bbox.xmin <= ${bbox.east} AND bbox.xmax >= ${bbox.west}
    AND bbox.ymin <= ${bbox.north} AND bbox.ymax >= ${bbox.south}
    -- Fine Filter: Exact polygon intersection (surgical precision)
    AND ST_Intersects(
      geometry,
      ST_GeomFromGeoJSON('${polygonGeoJSON.replace(/'/g, "''")}')
    )
    AND class IN ('primary', 'secondary', 'residential', 'tertiary');
`;

    try {
      const result = await this.executeDuckDBQuery(query);
      const processed = this.processTransportationResults(Array.isArray(result) ? result : [result]);
      console.log(`[Overture] Surgical: Found ${processed.length} roads inside polygon`);
      return processed;
    } catch (error) {
      console.error('[Overture] Polygon roads query error:', error);
      throw error;
    }
  }

  /**
   * Process raw transportation query results
   */
  private static processTransportationResults(results: any[]): OvertureTransportation[] {
    return results.map((row: any) => {
      let geometry = row.geometry;
      if (typeof geometry === 'string') {
        try {
          geometry = JSON.parse(geometry);
        } catch {
          geometry = { type: 'LineString', coordinates: [] };
        }
      }

      return {
        gers_id: row.gers_id || row.id || '',
        geometry,
        class: row.class || 'residential',
      };
    });
  }

  /**
   * Get nearest residential addresses from Overture addresses theme
   * Queries addresses (not buildings) since we need address data for mailing lists
   * @param lat Starting latitude
   * @param lng Starting longitude
   * @param limit Maximum number of addresses to return
   * @returns Array of Overture address records sorted by distance
   */
  static async getNearestHomes(lat: number, lng: number, limit: number = 50): Promise<OvertureAddress[]> {
    try {
      // Calculate bounding box around the point (~5km radius for performance)
      // Approximate: 1 degree latitude ≈ 111 km, 1 degree longitude ≈ 111 km * cos(latitude)
      const radiusKm = 5;
      const latDelta = radiusKm / 111;
      const lngDelta = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));
      
      const bbox = {
        west: lng - lngDelta,
        south: lat - latDelta,
        east: lng + lngDelta,
        north: lat + latDelta,
      };

      console.log(`Searching Overture in bbox: [${bbox.west}, ${bbox.south}, ${bbox.east}, ${bbox.north}]`);

      // Query with flat schema (Overture uses 'postal_city' instead of 'locality' in some releases)
      const query = `
      INSTALL spatial; LOAD spatial;
      INSTALL httpfs; LOAD httpfs;
      SET s3_region='${this.S3_REGION}';
      
      SELECT 
        id as gers_id,
        -- parent_id as building_gers_id,  <-- REMOVED: parent_id column not available in all Overture releases
        ST_AsGeoJSON(geometry) as geometry_json,
        -- Universal Address Query: Handles NULL values gracefully
        -- Schema confirmed: number, street, postal_city, postcode, unit, country all exist
        -- locality and region do NOT exist in this release
        COALESCE(number, '') as house_number,
        COALESCE(street, '') as street_name,
        COALESCE(postal_city, '') as town,
        NULL as region,
        COALESCE(postcode, '') as postal_code,
        COALESCE(unit, '') as addr_unit,
        COALESCE(country, '') as country,
        ST_Distance(
          geometry, 
          ST_Point(${lng}, ${lat})
        ) * 111.0 as distance_km
      FROM read_parquet('${this.ADDRESSES_BUCKET}')
      WHERE 
        bbox.xmin > ${bbox.west} AND bbox.xmax < ${bbox.east}
        AND bbox.ymin > ${bbox.south} AND bbox.ymax < ${bbox.north}
      ORDER BY distance_km ASC
      LIMIT ${limit};
    `;

      if (this.USE_MOTHERDUCK) {
        console.log('Using MotherDuck for nearest addresses query...');
      } else {
        console.log('Using local DuckDB for nearest addresses query...');
      }

      const rows = await this.executeDuckDBQuery(query);
      console.log(`Query returned ${rows.length} rows.`);

      // Map raw rows to our interface
      return rows.map((row: any) => {
        let geo = row.geometry_json;
        if (typeof geo === 'string') {
          try { geo = JSON.parse(geo); } catch (e) {}
        }

        return {
          gers_id: row.gers_id,
          geometry: geo || { type: 'Point', coordinates: [0, 0] },
          // Handle empty strings from COALESCE by converting to undefined
          house_number: row.house_number && row.house_number.trim() ? row.house_number : undefined,
          street: row.street_name && row.street_name.trim() ? row.street_name : undefined,
          unit: row.addr_unit && row.addr_unit.trim() ? row.addr_unit : undefined,
          locality: row.town && row.town.trim() ? row.town : undefined, // Map 'town' alias back to 'locality' for app compatibility
          postcode: (row.postal_code || row.postcode) && (row.postal_code || row.postcode).trim() ? (row.postal_code || row.postcode) : undefined,
          region: row.region || undefined,
          country: row.country && row.country.trim() ? row.country : undefined,
          building_gers_id: undefined, // parent_id not available - will use ST_Intersects fallback
        };
      });
    } catch (error) {
      console.error('Error getting nearest addresses from Overture:', error);
      throw error;
    }
  }

  /**
   * SURGICAL PROVISIONING: Get addresses inside a polygon
   * Queries BOTH private S3 (160M addresses) AND Overture with SQL-level filtering
   * Uses ST_Intersects at MotherDuck level - no client-side filtering needed
   */
  static async getAddressesInPolygon(input: any): Promise<OvertureAddress[]> {
    console.log('[Overture] Surgical: Fetching addresses inside polygon...');

    // --- ROBUST GEOJSON PARSING ---
    let polygon = input;
    if (input.type === 'FeatureCollection' && input.features?.length > 0) {
      polygon = input.features[0].geometry;
    } else if (input.type === 'Feature') {
      polygon = input.geometry;
    }

    if (!polygon || !polygon.coordinates) {
      console.error('[Overture] Invalid polygon for addresses:', JSON.stringify(input).substring(0, 100));
      return [];
    }

    // Calculate BBox for coarse filter (S3 partition pruning)
    let minX = 180, minY = 90, maxX = -180, maxY = -90;
    const coordinates = polygon.type === 'MultiPolygon'
      ? polygon.coordinates.flat(1)
      : polygon.coordinates;

    if (coordinates && coordinates.length > 0) {
      coordinates[0].forEach((coord: number[]) => {
        const [lng, lat] = coord;
        if (lng < minX) minX = lng;
        if (lng > maxX) maxX = lng;
        if (lat < minY) minY = lat;
        if (lat > maxY) maxY = lat;
      });
    }

    const bbox = { west: minX - 0.001, south: minY - 0.001, east: maxX + 0.001, north: maxY + 0.001 };
    console.log(`[Overture] Polygon BBox: [${bbox.west}, ${bbox.south}, ${bbox.east}, ${bbox.north}]`);

    // Convert polygon to GeoJSON string (for SQL-level filtering)
    const polygonGeoJSON = JSON.stringify(polygon);

    // Query BOTH sources with SQL-level polygon filtering (Ultimate Coverage + Surgical Precision)
    let privateAddrs: OvertureAddress[] = [];
    let overtureAddrs: OvertureAddress[] = [];

    // 1. Private S3 (us-east-1) - Your 160M "Data Moat"
    try {
      privateAddrs = await this.extractAddressesFromPrivateS3InPolygon(bbox, polygonGeoJSON);
      console.log(`[Overture] Private S3 Surgical: ${privateAddrs.length} addresses`);
    } catch (error: any) {
      console.warn(`[Overture] Private S3 polygon fetch failed: ${error.message}`);
    }

    // 2. Overture Public S3 (us-west-2)
    try {
      overtureAddrs = await this.extractAddressesFromOvertureInPolygon(bbox, polygonGeoJSON);
      console.log(`[Overture] Overture Surgical: ${overtureAddrs.length} addresses`);
    } catch (error: any) {
      console.warn(`[Overture] Overture polygon fetch failed: ${error.message}`);
    }

    // Merge with PRIVATE priority (no duplicates)
    const merged = this.mergeAddresses(privateAddrs, overtureAddrs);
    console.log(`[Overture] Surgical Total: ${merged.length} addresses (${privateAddrs.length} private + ${overtureAddrs.length} overture, deduplicated)`);

    return merged;
  }

  /**
   * Private S3 addresses with SQL-level polygon filtering
   */
  private static async extractAddressesFromPrivateS3InPolygon(
    bbox: BoundingBox,
    polygonGeoJSON: string
  ): Promise<OvertureAddress[]> {
    const bucket = process.env.FLYR_ADDRESSES_S3_BUCKET || 'flyr-pro-addresses-2025';
    const region = process.env.FLYR_ADDRESSES_S3_REGION || 'us-east-1';
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

    if (!accessKeyId || !secretAccessKey) {
      console.warn('[Overture] AWS credentials not configured, skipping private S3');
      return [];
    }

    const setupQuery = this.USE_MOTHERDUCK ? '' : `
INSTALL spatial; LOAD spatial;
INSTALL httpfs; LOAD httpfs;
`;

    // Surgical query with ST_Intersects on the point geometry
    const query = `${setupQuery}
SET s3_region='${region}';
SET s3_access_key_id='${accessKeyId}';
SET s3_secret_access_key='${secretAccessKey}';

SELECT 
    gers_id,
    house_number,
    street_name,
    COALESCE(unit, '') as unit,
    city as locality,
    state as region,
    postal_code,
    latitude,
    longitude,
    formatted,
    'PRIVATE' as source
FROM read_parquet('s3://${bucket}/master_addresses_parquet/state=*/data_0.parquet', hive_partitioning=1)
WHERE 
    -- Coarse Filter: BBox (fast S3 partition pruning)
    latitude BETWEEN ${bbox.south} AND ${bbox.north}
    AND longitude BETWEEN ${bbox.west} AND ${bbox.east}
    AND latitude IS NOT NULL
    AND longitude IS NOT NULL
    AND house_number IS NOT NULL AND house_number != ''
    AND street_name IS NOT NULL AND street_name != ''
    -- Fine Filter: Exact polygon intersection (surgical precision)
    AND ST_Intersects(
      ST_Point(longitude, latitude),
      ST_GeomFromGeoJSON('${polygonGeoJSON.replace(/'/g, "''")}')
    );
`;

    const result = await this.executeDuckDBQuery(query);
    return this.processAddressResults(Array.isArray(result) ? result : [result]);
  }

  /**
   * Overture addresses with SQL-level polygon filtering
   */
  private static async extractAddressesFromOvertureInPolygon(
    bbox: BoundingBox,
    polygonGeoJSON: string
  ): Promise<OvertureAddress[]> {
    const setupQuery = this.USE_MOTHERDUCK ? '' : `
INSTALL spatial; LOAD spatial;
INSTALL httpfs; LOAD httpfs;
`;

    // Surgical query with ST_Intersects
    const query = `${setupQuery}
SET s3_region='${this.S3_REGION}';

SELECT 
    id as gers_id,
    ST_AsGeoJSON(geometry) AS geometry,
    COALESCE(number, '') as house_number,
    COALESCE(street, '') as street_name,
    COALESCE(postcode, '') as postal_code,
    COALESCE(postal_city, '') as locality,
    COALESCE(unit, '') as unit,
    'OVERTURE' as source
FROM read_parquet('${this.ADDRESSES_BUCKET}', hive_partitioning=1)
WHERE 
    -- Coarse Filter: BBox overlap (fast S3 partition pruning)
    bbox.xmin <= ${bbox.east} AND bbox.xmax >= ${bbox.west}
    AND bbox.ymin <= ${bbox.north} AND bbox.ymax >= ${bbox.south}
    -- Fine Filter: Exact polygon intersection (surgical precision)
    AND ST_Intersects(
      geometry,
      ST_GeomFromGeoJSON('${polygonGeoJSON.replace(/'/g, "''")}')
    )
    AND geometry IS NOT NULL;
`;

    const result = await this.executeDuckDBQuery(query);
    return this.processAddressResults(Array.isArray(result) ? result : [result]);
  }

  /**
   * Reverse geocode a lat/lon coordinate using Mapbox Geocoding API
   * Used by the Discovery Brain to find addresses for orphan buildings
   * 
   * @param lat - Latitude coordinate
   * @param lon - Longitude coordinate
   * @returns Address components or null if not found
   */
  static async reverseGeocode(lat: number, lon: number): Promise<{
    house_number: string;
    street_name: string;
    postal_code: string;
    formatted_address: string;
  } | null> {
    // Use MAPBOX_TOKEN for server-side (not NEXT_PUBLIC_MAPBOX_TOKEN)
    const token = process.env.MAPBOX_TOKEN || process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    
    if (!token) {
      console.warn('[OvertureService] MAPBOX_TOKEN not set, skipping reverse geocode');
      return null;
    }

    try {
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lon},${lat}.json?types=address&access_token=${token}`;
      
      console.log(`[OvertureService] Reverse geocoding: ${lat}, ${lon}`);
      
      const res = await fetch(url);
      
      if (!res.ok) {
        console.error(`[OvertureService] Mapbox API error: ${res.status} ${res.statusText}`);
        return null;
      }
      
      const data = await res.json();
      
      if (!data.features?.length) {
        console.log(`[OvertureService] No address found at ${lat}, ${lon}`);
        return null;
      }
      
      const feature = data.features[0];
      
      // Extract address components from Mapbox response
      // Mapbox returns: address (house number), text (street name), place_name (full address)
      // Context array contains: postcode, place, region, country
      const postcode = feature.context?.find((c: any) => c.id?.startsWith('postcode'))?.text || '';
      
      const result = {
        house_number: feature.address || '',
        street_name: feature.text || '',
        postal_code: postcode,
        formatted_address: feature.place_name || '',
      };
      
      console.log(`[OvertureService] Reverse geocoded: ${result.formatted_address}`);
      
      return result;
    } catch (error) {
      console.error('[OvertureService] Reverse geocode error:', error);
      return null;
    }
  }

}
