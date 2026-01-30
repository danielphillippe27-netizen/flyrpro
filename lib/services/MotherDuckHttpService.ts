/**
 * MotherDuck HTTP Service
 * 
 * Executes SQL queries against MotherDuck using the MCP HTTP API.
 * This service works on Vercel serverless without native binary dependencies.
 * 
 * API Endpoint: https://api.motherduck.com/mcp
 * Protocol: JSON-RPC 2.0 / MCP (Model Context Protocol)
 * 
 * IMPORTANT LIMITATIONS:
 * - 55 second timeout (queries exceeding this are cancelled)
 * - 2,000 rows per request (we set this limit, API max is 2,048)
 * - Read-only operations
 * 
 * CRITICAL: Querying Overture S3 directly (s3://overturemaps-*) times out
 * because the parquet files are too large. The HTTP API is only suitable for:
 * - Pre-loaded MotherDuck databases with indexed data
 * - Small, simple queries (no large parquet scans)
 * 
 * For Overture provisioning, use native DuckDB locally instead.
 */

export interface MotherDuckQueryResult {
  success: boolean;
  columns?: string[];
  columnTypes?: string[];
  rows?: any[][];
  rowCount?: number;
  error?: string;
  errorType?: string;
}

export interface OvertureBuilding {
  gers_id: string;
  geometry: any;
  centroid: any;
  height?: number;
  house_name?: string;
  addr_housenumber?: string;
  addr_street?: string;
  addr_unit?: string;
  b_house_number?: string;
  b_street_name?: string;
}

export interface OvertureAddress {
  gers_id: string;
  geometry: any;
  house_number?: string;
  street?: string;
  unit?: string;
  locality?: string;
  postcode?: string;
  region?: string;
  country?: string;
  building_gers_id?: string;
  formatted?: string;
}

export interface OvertureTransportation {
  gers_id: string;
  geometry: any;
  class: string;
}

export interface BoundingBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

export class MotherDuckHttpService {
  private static readonly MCP_ENDPOINT = 'https://api.motherduck.com/mcp';
  private static readonly OVERTURE_RELEASE = '2025-12-17.0';
  private static readonly S3_REGION = 'us-west-2';
  private static readonly ROW_LIMIT = 2000; // Stay under 2,048 API limit
  
  private static readonly BUILDINGS_BUCKET = `s3://overturemaps-us-west-2/release/${MotherDuckHttpService.OVERTURE_RELEASE}/theme=buildings/type=building/*`;
  private static readonly ADDRESSES_BUCKET = `s3://overturemaps-us-west-2/release/${MotherDuckHttpService.OVERTURE_RELEASE}/theme=addresses/type=address/*`;
  private static readonly TRANSPORTATION_BUCKET = `s3://overturemaps-us-west-2/release/${MotherDuckHttpService.OVERTURE_RELEASE}/theme=transportation/type=segment/*`;

  private static get MOTHERDUCK_TOKEN(): string | undefined {
    return process.env.MOTHERDUCK_TOKEN;
  }

  /**
   * Check if HTTP API is available (has token)
   */
  static isAvailable(): boolean {
    return !!this.MOTHERDUCK_TOKEN;
  }

  /**
   * Execute SQL query via MotherDuck MCP HTTP API
   * 
   * Uses MCP Streamable HTTP transport with JSON-RPC 2.0 messages.
   * Handles both JSON and SSE response formats.
   */
  static async executeQuery(sql: string, database: string = 'my_db'): Promise<any[]> {
    if (!this.MOTHERDUCK_TOKEN) {
      throw new Error('MOTHERDUCK_TOKEN is required for HTTP API');
    }

    console.log('[MotherDuckHttp] Executing query via MCP API...');
    console.log('[MotherDuckHttp] Query preview:', sql.substring(0, 200) + '...');

    try {
      // MCP Protocol: JSON-RPC 2.0 request format for tool call
      const requestBody = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'query',
          arguments: {
            database,
            sql,
          },
        },
        id: Date.now(),
      };

      const response = await fetch(this.MCP_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // MCP HTTP transport requires Accept header with both types
          'Accept': 'application/json, text/event-stream',
          'Authorization': `Bearer ${this.MOTHERDUCK_TOKEN}`,
          // Protocol version header
          'MCP-Protocol-Version': '2025-03-26',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`MCP API error (${response.status}): ${errorText}`);
      }

      // Check content type to determine response format
      const contentType = response.headers.get('content-type') || '';
      
      let jsonRpcResponse: any;
      
      if (contentType.includes('text/event-stream')) {
        // Handle SSE response - read until we get the JSON-RPC response
        jsonRpcResponse = await this.parseSSEResponse(response);
      } else {
        // Standard JSON response
        jsonRpcResponse = await response.json();
      }
      
      // Handle JSON-RPC error response
      if (jsonRpcResponse.error) {
        throw new Error(`MCP RPC Error: ${jsonRpcResponse.error.message || JSON.stringify(jsonRpcResponse.error)}`);
      }

      // Extract the result from JSON-RPC response
      // The result contains the MCP tool response
      const result = jsonRpcResponse.result;
      
      if (!result) {
        console.warn('[MotherDuckHttp] Empty result from MCP API');
        return [];
      }

      // Parse MCP query tool response
      // The response format may vary based on MCP implementation
      let queryResult: MotherDuckQueryResult;
      
      if (typeof result === 'string') {
        // Result might be a JSON string
        try {
          queryResult = JSON.parse(result);
        } catch {
          console.warn('[MotherDuckHttp] Could not parse result as JSON:', result);
          return [];
        }
      } else if (result.content && Array.isArray(result.content)) {
        // MCP tool response format: { content: [{ type: 'text', text: '...' }] }
        const textContent = result.content.find((c: any) => c.type === 'text');
        if (textContent?.text) {
          try {
            queryResult = JSON.parse(textContent.text);
          } catch {
            console.warn('[MotherDuckHttp] Could not parse content text as JSON');
            return [];
          }
        } else {
          console.warn('[MotherDuckHttp] No text content in response');
          return [];
        }
      } else {
        queryResult = result as MotherDuckQueryResult;
      }

      if (!queryResult.success) {
        throw new Error(`Query failed: ${queryResult.error || 'Unknown error'} (${queryResult.errorType || 'UnknownError'})`);
      }

      console.log(`[MotherDuckHttp] Query returned ${queryResult.rowCount || 0} rows`);

      // Convert columnar response to row objects
      if (!queryResult.columns || !queryResult.rows) {
        return [];
      }

      return queryResult.rows.map((row) => {
        const obj: any = {};
        queryResult.columns!.forEach((col, idx) => {
          obj[col] = row[idx];
        });
        return obj;
      });

    } catch (error: any) {
      console.error('[MotherDuckHttp] Query execution failed:', error.message);
      throw new Error(`MotherDuck HTTP Query Failed: ${error.message}`);
    }
  }

  /**
   * Parse SSE (Server-Sent Events) response to extract JSON-RPC result
   */
  private static async parseSSEResponse(response: Response): Promise<any> {
    const text = await response.text();
    const lines = text.split('\n');
    
    let lastData = '';
    for (const line of lines) {
      if (line.startsWith('data:')) {
        lastData = line.substring(5).trim();
      }
    }
    
    if (!lastData) {
      throw new Error('No data found in SSE response');
    }
    
    try {
      return JSON.parse(lastData);
    } catch {
      throw new Error(`Failed to parse SSE data: ${lastData.substring(0, 100)}`);
    }
  }

  /**
   * Get buildings inside a polygon using HTTP API
   * 
   * Note: Uses bbox filtering at SQL level for performance (avoids 55s timeout).
   * Client-side polygon filtering is applied after fetching results.
   */
  static async getBuildingsInPolygon(input: any): Promise<OvertureBuilding[]> {
    console.log('[MotherDuckHttp] Fetching buildings inside polygon...');

    // Parse polygon from various input formats
    let polygon = input;
    if (input.type === 'FeatureCollection' && input.features?.length > 0) {
      polygon = input.features[0].geometry;
    } else if (input.type === 'Feature') {
      polygon = input.geometry;
    }

    if (!polygon || !polygon.coordinates) {
      console.error('[MotherDuckHttp] Invalid polygon:', JSON.stringify(input).substring(0, 100));
      return [];
    }

    // Calculate BBox for coarse filter
    const bbox = this.calculateBBox(polygon);
    console.log(`[MotherDuckHttp] Polygon BBox: [${bbox.west}, ${bbox.south}, ${bbox.east}, ${bbox.north}]`);

    // Note: MotherDuck MCP API handles S3 region configuration automatically
    // Use bbox filtering only at SQL level (ST_Intersects times out on large scans)
    // Avoid ST_AsGeoJSON which is expensive - use geometry directly
    // Client-side polygon filtering is applied after
    const query = `
SELECT 
    id as gers_id,
    geometry,
    COALESCE(height, (num_floors * 3.5), 8) as height
FROM read_parquet('${this.BUILDINGS_BUCKET}', hive_partitioning=1)
WHERE 
    bbox.xmin BETWEEN ${bbox.west} AND ${bbox.east}
    AND bbox.ymin BETWEEN ${bbox.south} AND ${bbox.north}
    AND (subtype = 'residential' OR subtype IS NULL)
    AND (class IS NULL OR class NOT IN ('garage', 'shed'))
LIMIT ${this.ROW_LIMIT};
`;

    try {
      const result = await this.executeQuery(query);
      const processed = this.processBuildingResults(result);
      console.log(`[MotherDuckHttp] BBox query returned ${processed.length} buildings`);
      
      // Apply client-side polygon filtering for precision
      const filtered = this.filterBuildingsByPolygon(processed, polygon);
      console.log(`[MotherDuckHttp] After polygon filter: ${filtered.length} buildings inside polygon`);
      return filtered;
    } catch (error: any) {
      console.error('[MotherDuckHttp] Buildings query error:', error.message);
      throw error;
    }
  }
  
  /**
   * Filter buildings by checking if their centroid is inside the polygon
   */
  private static filterBuildingsByPolygon(buildings: OvertureBuilding[], polygon: any): OvertureBuilding[] {
    return buildings.filter(building => {
      const centroid = building.centroid;
      if (!centroid?.coordinates) return false;
      
      const [lng, lat] = centroid.coordinates;
      return this.pointInPolygon([lng, lat], polygon);
    });
  }

  /**
   * Get addresses inside a polygon using HTTP API
   * 
   * Note: Uses bbox filtering at SQL level for performance (avoids 55s timeout).
   * Client-side polygon filtering is applied after fetching results.
   */
  static async getAddressesInPolygon(input: any): Promise<OvertureAddress[]> {
    console.log('[MotherDuckHttp] Fetching addresses inside polygon...');

    // Parse polygon from various input formats
    let polygon = input;
    if (input.type === 'FeatureCollection' && input.features?.length > 0) {
      polygon = input.features[0].geometry;
    } else if (input.type === 'Feature') {
      polygon = input.geometry;
    }

    if (!polygon || !polygon.coordinates) {
      console.error('[MotherDuckHttp] Invalid polygon:', JSON.stringify(input).substring(0, 100));
      return [];
    }

    // Calculate BBox for coarse filter
    const bbox = this.calculateBBox(polygon);
    console.log(`[MotherDuckHttp] Polygon BBox: [${bbox.west}, ${bbox.south}, ${bbox.east}, ${bbox.north}]`);

    // Note: MotherDuck MCP API handles S3 region configuration automatically
    // Use bbox filtering only at SQL level (ST_Intersects times out on large scans)
    // Avoid ST_AsGeoJSON which is expensive - use geometry directly
    const query = `
SELECT 
    id as gers_id,
    geometry,
    number as house_number,
    street as street_name,
    unit,
    postcode as postal_code,
    address_levels[1].value as locality,
    address_levels[2].value as region,
    country
FROM read_parquet('${this.ADDRESSES_BUCKET}', hive_partitioning=1)
WHERE 
    bbox.xmin BETWEEN ${bbox.west} AND ${bbox.east}
    AND bbox.ymin BETWEEN ${bbox.south} AND ${bbox.north}
LIMIT ${this.ROW_LIMIT};
`;

    try {
      const result = await this.executeQuery(query);
      const processed = this.processAddressResults(result);
      console.log(`[MotherDuckHttp] BBox query returned ${processed.length} addresses`);
      
      // Apply client-side polygon filtering for precision
      const filtered = this.filterAddressesByPolygon(processed, polygon);
      console.log(`[MotherDuckHttp] After polygon filter: ${filtered.length} addresses inside polygon`);
      return filtered;
    } catch (error: any) {
      console.error('[MotherDuckHttp] Addresses query error:', error.message);
      throw error;
    }
  }
  
  /**
   * Filter addresses by checking if their point is inside the polygon
   */
  private static filterAddressesByPolygon(addresses: OvertureAddress[], polygon: any): OvertureAddress[] {
    return addresses.filter(address => {
      const geometry = address.geometry;
      if (!geometry?.coordinates) return false;
      
      const [lng, lat] = geometry.coordinates;
      return this.pointInPolygon([lng, lat], polygon);
    });
  }

  /**
   * Get transportation segments inside a polygon using HTTP API
   * 
   * Note: Uses bbox filtering at SQL level for performance (avoids 55s timeout).
   * Roads are not filtered by polygon on client side (they cross boundaries).
   */
  static async getRoadsInPolygon(input: any): Promise<OvertureTransportation[]> {
    console.log('[MotherDuckHttp] Fetching roads inside polygon...');

    // Parse polygon from various input formats
    let polygon = input;
    if (input.type === 'FeatureCollection' && input.features?.length > 0) {
      polygon = input.features[0].geometry;
    } else if (input.type === 'Feature') {
      polygon = input.geometry;
    }

    if (!polygon || !polygon.coordinates) {
      console.error('[MotherDuckHttp] Invalid polygon:', JSON.stringify(input).substring(0, 100));
      return [];
    }

    // Calculate BBox for coarse filter
    const bbox = this.calculateBBox(polygon);

    // Note: MotherDuck MCP API handles S3 region configuration automatically
    // Use bbox filtering only (roads often cross polygon boundaries anyway)
    // Avoid ST_AsGeoJSON which is expensive - use geometry directly
    const query = `
SELECT 
    id as gers_id,
    geometry,
    class
FROM read_parquet('${this.TRANSPORTATION_BUCKET}', hive_partitioning=1)
WHERE 
    bbox.xmin BETWEEN ${bbox.west} AND ${bbox.east}
    AND bbox.ymin BETWEEN ${bbox.south} AND ${bbox.north}
    AND class IN ('primary', 'secondary', 'tertiary', 'residential', 'unclassified')
LIMIT ${this.ROW_LIMIT};
`;

    try {
      const result = await this.executeQuery(query);
      const processed = this.processTransportationResults(result);
      console.log(`[MotherDuckHttp] Found ${processed.length} roads in bbox`);
      return processed;
    } catch (error: any) {
      console.error('[MotherDuckHttp] Roads query error:', error.message);
      throw error;
    }
  }
  
  /**
   * Check if a point is inside a polygon using ray casting algorithm
   */
  private static pointInPolygon(point: [number, number], polygon: any): boolean {
    const [x, y] = point;
    
    // Get the coordinates array (handle both Polygon and MultiPolygon)
    let rings: number[][][];
    if (polygon.type === 'MultiPolygon') {
      // For MultiPolygon, check if point is in any of the polygons
      for (const poly of polygon.coordinates) {
        if (this.pointInRings([x, y], poly)) {
          return true;
        }
      }
      return false;
    } else if (polygon.type === 'Polygon') {
      rings = polygon.coordinates;
    } else {
      return false;
    }
    
    return this.pointInRings([x, y], rings);
  }
  
  /**
   * Check if point is inside polygon rings (outer ring + holes)
   */
  private static pointInRings(point: [number, number], rings: number[][][]): boolean {
    const [x, y] = point;
    
    // Check outer ring
    if (!this.pointInRing([x, y], rings[0])) {
      return false;
    }
    
    // Check holes (if any)
    for (let i = 1; i < rings.length; i++) {
      if (this.pointInRing([x, y], rings[i])) {
        return false; // Point is in a hole
      }
    }
    
    return true;
  }
  
  /**
   * Check if point is inside a single ring using ray casting
   */
  private static pointInRing(point: [number, number], ring: number[][]): boolean {
    const [x, y] = point;
    let inside = false;
    
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1];
      const xj = ring[j][0], yj = ring[j][1];
      
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }
    
    return inside;
  }

  /**
   * Calculate bounding box from polygon coordinates
   */
  private static calculateBBox(polygon: any): BoundingBox {
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

    // Add small padding
    return {
      west: minX - 0.001,
      south: minY - 0.001,
      east: maxX + 0.001,
      north: maxY + 0.001,
    };
  }

  /**
   * Process building results into OvertureBuilding array
   */
  private static processBuildingResults(results: any[]): OvertureBuilding[] {
    return results.map((row: any) => {
      let geometry = row.geometry;
      if (typeof geometry === 'string') {
        try {
          geometry = JSON.parse(geometry);
        } catch {
          geometry = { type: 'MultiPolygon', coordinates: [] };
        }
      }

      // Calculate centroid from geometry
      let centroid: any = { type: 'Point', coordinates: [0, 0] };
      if (geometry?.type === 'Polygon' && geometry.coordinates?.[0]) {
        const coords = geometry.coordinates[0];
        const avgLon = coords.reduce((sum: number, c: number[]) => sum + c[0], 0) / coords.length;
        const avgLat = coords.reduce((sum: number, c: number[]) => sum + c[1], 0) / coords.length;
        centroid = { type: 'Point', coordinates: [avgLon, avgLat] };
      } else if (geometry?.type === 'MultiPolygon' && geometry.coordinates?.[0]?.[0]) {
        const coords = geometry.coordinates[0][0];
        const avgLon = coords.reduce((sum: number, c: number[]) => sum + c[0], 0) / coords.length;
        const avgLat = coords.reduce((sum: number, c: number[]) => sum + c[1], 0) / coords.length;
        centroid = { type: 'Point', coordinates: [avgLon, avgLat] };
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
   * Process address results into OvertureAddress array
   */
  private static processAddressResults(results: any[]): OvertureAddress[] {
    return results.map((row: any) => {
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

      if (!geometry || geometry.type !== 'Point') {
        geometry = { type: 'Point', coordinates: [0, 0] };
      }

      const houseNumber = row.house_number?.trim() || undefined;
      const street = row.street_name?.trim() || row.street?.trim() || undefined;
      const postcode = row.postal_code?.trim() || row.postcode?.trim() || undefined;
      const locality = row.locality?.trim() || undefined;
      const region = row.region?.trim() || undefined;
      const unit = row.unit?.trim() || undefined;

      const formatted = row.formatted?.trim() || 
        [houseNumber, street, unit, locality, region, postcode].filter(Boolean).join(' ').trim() || 
        undefined;

      return {
        gers_id: row.gers_id || row.id || '',
        geometry,
        house_number: houseNumber,
        street,
        unit,
        locality,
        postcode,
        region,
        country: row.country?.trim() || undefined,
        building_gers_id: undefined,
        formatted,
      };
    });
  }

  /**
   * Process transportation results into OvertureTransportation array
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
        class: row.class || 'unknown',
      };
    });
  }
}
