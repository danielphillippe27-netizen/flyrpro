/**
 * Overture Service - DuckDB Integration for Overture Maps Data
 * 
 * This service handles extraction of buildings and transportation segments
 * from Overture S3 buckets using DuckDB via MotherDuck (cloud) or local DuckDB.
 */

// @ts-ignore - duckdb types may not be available until package is installed
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
}

export interface OvertureTransportation {
  gers_id: string;
  geometry: any; // GeoJSON LineString
  class: string;
}

export interface OvertureAddress {
  gers_id: string;
  geometry: any; // GeoJSON Point
  street?: string;
  unit?: string;
  locality?: string;
  postcode?: string;
  region?: string;
  country?: string;
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

    // Try multiple connection string formats for compatibility
    const connectionStrings = this.USE_MOTHERDUCK && this.MOTHERDUCK_TOKEN
      ? [
          `md:my_db?motherduck_token=${this.MOTHERDUCK_TOKEN}`, // With dummy DB name
          `md:?motherduck_token=${this.MOTHERDUCK_TOKEN}`,      // Without DB name
        ]
      : [':memory:'];

    console.log(`[Overture] Initializing DuckDB Singleton (${this.USE_MOTHERDUCK ? 'MotherDuck' : 'Local'})...`);
    
    // Try each connection string format
    let lastError: Error | null = null;
    for (const dbPath of connectionStrings) {
      try {
        // Create the database instance ONCE
        const db = new duckdb.Database(dbPath);
        
        // For MotherDuck, wait a bit for initialization
        if (this.USE_MOTHERDUCK) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        // Save to global scope
        globalForDuckDB.overtureDb = db;
        console.log(`[Overture] Database initialized with connection string format: ${dbPath.substring(0, 30)}...`);
        return db;
      } catch (error: any) {
        lastError = error;
        console.warn(`[Overture] Failed to initialize with connection string format: ${dbPath.substring(0, 30)}...`, error.message);
        // Try next format
        continue;
      }
    }
    
    // If all formats failed, throw the last error with helpful message
    throw new Error(
      `Failed to initialize MotherDuck database. ` +
      `Last error: ${lastError?.message}. ` +
      `Please verify: 1) MOTHERDUCK_TOKEN is valid and not expired, 2) Network connectivity to MotherDuck, 3) SSL certificates are installed.`
    );
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
      // Build DuckDB query
      // Note: For MotherDuck, extensions are pre-installed
      // For local DuckDB, we need to install them first
      const setupQuery = this.USE_MOTHERDUCK ? '' : `
INSTALL spatial; LOAD spatial;
INSTALL httpfs; LOAD httpfs;
`;
      
      const query = `${setupQuery}
SET s3_region='${this.S3_REGION}';

WITH b AS (
    SELECT 
        id as gers_id, 
        geometry, 
        height, 
        names.primary as house_name,
        bbox.xmin as west,
        bbox.ymin as south,
        bbox.xmax as east,
        bbox.ymax as north
    FROM read_parquet('${this.BUILDINGS_BUCKET}')
    WHERE bbox.xmin BETWEEN ${bbox.west} AND ${bbox.east} 
      AND bbox.ymin BETWEEN ${bbox.south} AND ${bbox.north}
      AND subtype = 'residential' 
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
    b.geometry,
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

      const result = await this.executeDuckDBQuery(query);
      
      // DuckDB returns array of objects directly
      return this.processBuildingResults(Array.isArray(result) ? result : [result]);
    } catch (error) {
      console.error('Error extracting buildings from Overture:', error);
      throw error;
    }
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

      // Query with CONFIRMED Overture Column Names
      const query = `
      INSTALL spatial; LOAD spatial;
      INSTALL httpfs; LOAD httpfs;
      SET s3_region='${this.S3_REGION}';
      
      SELECT 
        id as gers_id,
        ST_AsGeoJSON(geometry) as geometry_json,
        number as addr_housenumber,
        street as addr_street,
        unit as addr_unit,
        postal_city as locality,
        postcode,
        country,
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
          unit: row.addr_housenumber || row.addr_unit || undefined,
          street: row.addr_street || undefined,
          locality: row.locality || undefined,
          postcode: row.postcode || undefined,
          country: row.country || undefined,
          region: undefined, // Region doesn't exist in addresses table
        };
      });
    } catch (error) {
      console.error('Error getting nearest addresses from Overture:', error);
      throw error;
    }
  }

  /**
   * Find addresses inside a custom drawn polygon
   * Uses ST_Within for precise spatial filtering within the polygon boundary
   */
  static async getAddressesInPolygon(input: any): Promise<OvertureAddress[]> {
    console.log('Searching Overture inside polygon boundary...');

    // --- ROBUST GEOJSON PARSING ---
    // 1. Unwrap FeatureCollection or Feature to get the raw Geometry
    let polygon = input;
    
    // If it's a FeatureCollection, take the first feature
    if (input.type === 'FeatureCollection' && input.features?.length > 0) {
      polygon = input.features[0].geometry;
    }
    // If it's a Feature, extract the geometry
    else if (input.type === 'Feature') {
      polygon = input.geometry;
    }
    
    // Safety Check
    if (!polygon || !polygon.coordinates) {
      console.error('Invalid Polygon Input:', JSON.stringify(input).substring(0, 100));
      return [];
    }
    // -----------------------------

    // 2. Calculate Bounding Box (To optimize S3 read)
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

    // Add buffer
    const bbox = { west: minX - 0.001, south: minY - 0.001, east: maxX + 0.001, north: maxY + 0.001 };
    
    console.log(`Calculated BBox: [${bbox.west}, ${bbox.south}, ${bbox.east}, ${bbox.north}]`);

    // Convert polygon to GeoJSON string for DuckDB
    const polygonGeoJSON = JSON.stringify(polygon);

    // 2. Query using ST_Within for precise polygon filtering
    const setupQuery = this.USE_MOTHERDUCK ? '' : `
INSTALL spatial; LOAD spatial;
INSTALL httpfs; LOAD httpfs;
`;
    
    const query = `${setupQuery}
SET s3_region='${this.S3_REGION}';

SELECT 
  id as gers_id,
  ST_AsGeoJSON(geometry) as geometry_json,
  number as addr_housenumber,
  street as addr_street,
  unit as addr_unit,
  postal_city as locality,
  postcode,
  country
FROM read_parquet('${this.ADDRESSES_BUCKET}')
WHERE 
  -- Coarse Filter: Use BBox first (Fast)
  bbox.xmin > ${bbox.west} AND bbox.xmax < ${bbox.east}
  AND bbox.ymin > ${bbox.south} AND bbox.ymax < ${bbox.north}
  -- Fine Filter: Use exact Polygon shape (Precise)
  AND ST_Within(
    geometry,
    ST_GeomFromGeoJSON('${polygonGeoJSON.replace(/'/g, "''")}')
  );
`;

    try {
      if (this.USE_MOTHERDUCK) {
        console.log('Using MotherDuck for polygon address query...');
      } else {
        console.log('Using local DuckDB for polygon address query...');
      }

      const rows = await this.executeDuckDBQuery(query);
      console.log(`Polygon Query returned ${rows.length} rows.`);

      return rows.map((row: any) => {
        let geo = row.geometry_json;
        if (typeof geo === 'string') {
          try { geo = JSON.parse(geo); } catch (e) {
            console.warn('Failed to parse geometry JSON:', e);
          }
        }
        return {
          gers_id: row.gers_id,
          geometry: geo || { type: 'Point', coordinates: [0, 0] },
          unit: row.addr_housenumber || row.addr_unit || undefined,
          street: row.addr_street || undefined,
          locality: row.locality || undefined,
          postcode: row.postcode || undefined,
          country: row.country || undefined,
          region: undefined, // Region doesn't exist in addresses table
        };
      });
    } catch (error) {
      console.error('Overture Polygon Query Error:', error);
      throw error;
    }
  }

}
