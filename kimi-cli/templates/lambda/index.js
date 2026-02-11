const duckdb = require("duckdb");
const wkx = require("wkx");
const zlib = require("zlib");
const { S3Client, ListObjectsV2Command, PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const crypto = require("crypto");
const { defaultProvider } = require("@aws-sdk/credential-provider-node");

// ============================================
// Configuration
// ============================================

process.env.HOME ||= "/tmp";
process.env.XDG_CACHE_HOME ||= "/tmp";
process.env.XDG_CONFIG_HOME ||= "/tmp";

const REGION = process.env.AWS_REGION || "us-east-2";
const s3 = new S3Client({ region: REGION });

const SNAPSHOT_BUCKET = process.env.SNAPSHOT_BUCKET;
const SNAPSHOT_PREFIX = process.env.SNAPSHOT_PREFIX || "campaigns";

// Extracted data configuration
const EXTRACT_BUCKET = process.env.EXTRACT_BUCKET || "flyr-pro-addresses-2025";
const EXTRACT_PREFIX = process.env.EXTRACT_PREFIX || "overture_extracts";
const OVERTURE_RELEASE = process.env.OVERTURE_RELEASE || "2026-01-21.0";

// Thematic tile configuration
const TILE_CONFIG = {
  buildings: { tileDeg: 0.25, partition: true },
  roads: { tileDeg: 1.0, partition: true },
  divisions: { tileDeg: null, partition: false }
};

const MAX_TILES_PER_REQUEST = parseInt(process.env.MAX_TILES_PER_REQUEST || "400", 10);
const TILE_CACHE_TTL_MS = 10 * 60 * 1000;
const tileExistenceCache = new Map();

// Addresses bucket
const ADDRESSES_BUCKET = process.env.ADDRESSES_BUCKET || "flyr-pro-addresses-2025";

function addressesGlobForState(state) {
  return `s3://${ADDRESSES_BUCKET}/master_addresses_parquet/state=${state}/data_*.parquet`;
}

// ============================================
// S3 Helpers
// ============================================

function gzipJson(obj) {
  return zlib.gzipSync(Buffer.from(JSON.stringify(obj)));
}

async function putGzJson({ bucket, key, obj }) {
  const body = gzipJson(obj);
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: "application/geo+json",
    ContentEncoding: "gzip"
  }));
  return { key, bytes: body.length };
}

async function presignGet({ bucket, key, expiresSeconds = 3600 }) {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: expiresSeconds });
}

function newCampaignId() {
  return crypto.randomUUID();
}

// ============================================
// Tile Cache
// ============================================

async function checkTileExists(theme, regionCode, tileY, tileX) {
  const cacheKey = `${OVERTURE_RELEASE}/${theme}/${regionCode}/${tileY}/${tileX}`;
  const now = Date.now();
  
  const cached = tileExistenceCache.get(cacheKey);
  if (cached && (now - cached.timestamp) < TILE_CACHE_TTL_MS) {
    return cached.exists;
  }
  
  const prefix = `${EXTRACT_PREFIX}/${theme}/release=${OVERTURE_RELEASE}/region=${regionCode}/tile_y=${tileY}/tile_x=${tileX}/`;
  
  try {
    const response = await s3.send(new ListObjectsV2Command({
      Bucket: EXTRACT_BUCKET,
      Prefix: prefix,
      MaxKeys: 1
    }));
    const exists = response.Contents && response.Contents.length > 0;
    tileExistenceCache.set(cacheKey, { exists, timestamp: now });
    return exists;
  } catch (e) {
    tileExistenceCache.set(cacheKey, { exists: false, timestamp: now });
    return false;
  }
}

async function checkTilesExist(tiles) {
  const results = await Promise.allSettled(
    tiles.map(async (tile) => ({
      ...tile,
      exists: await checkTileExists(tile.theme, tile.regionCode, tile.tileY, tile.tileX)
    }))
  );
  return results.map((r, i) => r.status === 'fulfilled' ? r.value : { ...tiles[i], exists: false });
}

// ============================================
// Geometry Helpers
// ============================================

function bboxFromPolygon(polygon) {
  const coords = polygon?.coordinates?.[0];
  if (!coords || coords.length < 3) throw new Error("Invalid polygon: exterior ring must have at least 3 points");
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of coords) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

function polygonToWKT(polygon) {
  const coords = polygon?.coordinates?.[0];
  if (!coords || coords.length < 3) {
    throw new Error("Invalid polygon: exterior ring must have at least 3 points");
  }
  // Ensure closed ring (first and last point equal) for valid LinearRing
  const closed = coords.length >= 4 && coords[0][0] === coords[coords.length - 1][0] && coords[0][1] === coords[coords.length - 1][1]
    ? coords
    : [...coords, coords[0]];
  const ring = closed.map(([x, y]) => `${x} ${y}`).join(", ");
  return `POLYGON((${ring}))`;
}

function wkbToGeoJSON(wkb) {
  try {
    // Handle different input formats from DuckDB/Parquet
    let buffer;
    
    if (Buffer.isBuffer(wkb)) {
      buffer = wkb;
    } else if (typeof wkb === 'string') {
      // Try hex string first (common DuckDB format)
      if (wkb.match(/^[0-9a-fA-F]+$/)) {
        buffer = Buffer.from(wkb, 'hex');
      } else {
        // Try base64
        buffer = Buffer.from(wkb, 'base64');
      }
    } else if (wkb && typeof wkb === 'object') {
      // Might already be GeoJSON
      if (wkb.type && wkb.coordinates) {
        return wkb; // Already GeoJSON
      }
      // Handle DuckDB Buffer format: { type: "Buffer", data: [1,2,3,...] }
      if (wkb.type === 'Buffer' && Array.isArray(wkb.data)) {
        buffer = Buffer.from(wkb.data);
      } else if (wkb.data && Array.isArray(wkb.data)) {
        buffer = Buffer.from(wkb.data);
      } else if (wkb.buffer) {
        buffer = Buffer.from(wkb.buffer);
      }
    }
    
    if (!buffer || buffer.length === 0) {
      console.warn('Empty or invalid geometry buffer:', typeof wkb);
      return null;
    }
    
    return wkx.Geometry.parse(buffer).toGeoJSON();
  } catch (e) {
    console.warn('WKB parse failed:', e.message, 'Input type:', typeof wkb);
    return null;
  }
}

function computeTileRanges(minX, minY, maxX, maxY, tileDeg) {
  // Expand by 1 tile in each direction to catch edge cases
  const tileXMin = Math.floor((minX + 180.0) / tileDeg) - 1;
  const tileXMax = Math.floor((maxX + 180.0) / tileDeg) + 1;
  const tileYMin = Math.floor((minY + 90.0) / tileDeg) - 1;
  const tileYMax = Math.floor((maxY + 90.0) / tileDeg) + 1;
  return { tileXMin, tileXMax, tileYMin, tileYMax };
}

// ============================================
// DuckDB Connection
// ============================================

let _db = null;
let _con = null;

async function getConn() {
  if (_con) return _con;
  
  _db = new duckdb.Database(":memory:");
  const con = _db.connect();
  
  const run = (sql) => new Promise((res, rej) => con.run(sql, (e) => (e ? rej(e) : res())));
  
  await run("SET home_directory='/tmp'");
  await run("SET extension_directory='/var/task/duckdb_extensions'");
  await run("LOAD httpfs;");
  await run("LOAD spatial;");
  
  // Set up credentials for private bucket only
  const creds = await (async () => {
    try {
      return await defaultProvider()();
    } catch (e) {
      return null;
    }
  })();
  
  if (creds) {
    await run(`SET s3_access_key_id='${creds.accessKeyId}';`);
    await run(`SET s3_secret_access_key='${creds.secretAccessKey}';`);
    if (creds.sessionToken) {
      await run(`SET s3_session_token='${creds.sessionToken}';`);
    }
  }
  
  _con = con;
  return con;
}

async function queryWithIam(sql, region) {
  const con = await getConn();
  return new Promise((res, rej) => {
    con.run(`SET s3_region='${region}';`, (err) => {
      if (err) return rej(err);
      con.all(sql, (e, r) => {
        if (e) return rej(e);
        res(r);
      });
    });
  });
}

// ============================================
// Polygon-Based Tile Calculation
// ============================================

/**
 * Calculate tile indices for a coordinate
 */
function coordToTile(lon, lat, tileDeg) {
  const tileX = Math.floor((lon + 180.0) / tileDeg);
  const tileY = Math.floor((lat + 90.0) / tileDeg);
  return { tileX, tileY };
}

/**
 * Get all unique tiles that intersect with polygon edges
 * This is more accurate than bbox-based tile selection
 */
function getTilesForPolygon(polygon, tileDeg, expand = 1) {
  const tiles = new Set();
  const coords = polygon.coordinates[0]; // Outer ring
  
  // Add tiles for each vertex
  for (const [lon, lat] of coords) {
    const { tileX, tileY } = coordToTile(lon, lat, tileDeg);
    tiles.add(`${tileX},${tileY}`);
  }
  
  // Add tiles along edges (simple interpolation)
  for (let i = 0; i < coords.length - 1; i++) {
    const [x1, y1] = coords[i];
    const [x2, y2] = coords[i + 1];
    const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1)) / tileDeg * 2;
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const lon = x1 + (x2 - x1) * t;
      const lat = y1 + (y2 - y1) * t;
      const { tileX, tileY } = coordToTile(lon, lat, tileDeg);
      tiles.add(`${tileX},${tileY}`);
    }
  }
  
  // Expand by N tiles in each direction
  const expanded = new Set();
  for (const key of tiles) {
    const [tx, ty] = key.split(',').map(Number);
    for (let dy = -expand; dy <= expand; dy++) {
      for (let dx = -expand; dx <= expand; dx++) {
        expanded.add(`${tx + dx},${ty + dy}`);
      }
    }
  }
  
  return Array.from(expanded).map(key => {
    const [tileX, tileY] = key.split(',').map(Number);
    return { tileX, tileY };
  });
}

// ============================================
// Theme Queries (Optimized)
// ============================================

async function queryTheme(theme, polygon, limit, regionCode) {
  const config = TILE_CONFIG[theme];
  if (!config) throw new Error(`Unknown theme: ${theme}`);
  
  const wkt = polygonToWKT(polygon);
  
  // Divisions: single file query
  if (!config.partition) {
    const path = `s3://${EXTRACT_BUCKET}/${EXTRACT_PREFIX}/${theme}/release=${OVERTURE_RELEASE}/region=${regionCode}/divisions.parquet`;
    const sql = `
      SELECT gers_id, ST_AsGeoJSON(geometry_wkb) as geometry_geojson, name, xmin, xmax, ymin, ymax
      FROM read_parquet('${path}')
      WHERE ST_Intersects(geometry_wkb, ST_GeomFromText('${wkt}'))
      ${limit ? `LIMIT ${limit}` : ""}
    `;
    const rows = await queryWithIam(sql, REGION);
    return {
      type: "FeatureCollection",
      features: rows.map(r => {
        let geom = null;
        try {
          if (r.geometry_geojson) geom = JSON.parse(r.geometry_geojson);
        } catch (e) {}
        return geom ? {
          type: "Feature",
          geometry: geom,
          properties: { layer: theme, gers_id: r.gers_id, name: r.name }
        } : null;
      }).filter(Boolean),
      metadata: { theme, tiles_scanned: 1, features: rows.length }
    };
  }
  
  // Buildings/Roads: polygon-based tile query
  const { tileDeg } = config;
  const tileStart = Date.now();
  
  // Calculate tiles from polygon (not just bbox)
  const polygonTiles = getTilesForPolygon(polygon, tileDeg, 1); // expand by 1 tile
  
  console.log(`[${theme}] Polygon covers ${polygonTiles.length} tiles (${tileDeg}° grid)`);
  
  if (polygonTiles.length > MAX_TILES_PER_REQUEST) {
    throw new Error(`Polygon too large; would scan ${polygonTiles.length} tiles (max: ${MAX_TILES_PER_REQUEST})`);
  }
  
  // Build S3 paths for all potential tiles
  const tilePaths = polygonTiles.map(t => ({
    tileX: t.tileX,
    tileY: t.tileY,
    path: `s3://${EXTRACT_BUCKET}/${EXTRACT_PREFIX}/${theme}/release=${OVERTURE_RELEASE}/region=${regionCode}/tile_y=${t.tileY}/tile_x=${t.tileX}/*.parquet`
  }));
  
  // Create explicit file list for DuckDB
  const pathList = tilePaths.map(t => `'${t.path}'`).join(", ");
  
  console.log(`[${theme}] Querying ${tilePaths.length} tile paths in ${Date.now() - tileStart}ms`);
  
  // Theme-specific columns
  const nameCol = theme === "roads" ? "road_type" : "name";
  const heightCol = theme === "buildings" ? "height" : "NULL";
  
  // OPTIMIZED SQL:
  // 1. read_parquet with explicit file list (not wildcards)
  // 2. No bbox filter - rely on tile selection + ST_Intersects
  // 3. Use ST_AsGeoJSON to get proper GeoJSON (not raw WKB)
  const sql = `
    WITH raw AS (
      SELECT gers_id, geometry_wkb, cx, cy, ${nameCol} as feature_name, ${heightCol} as feature_height
      FROM read_parquet(
        [${pathList}], 
        hive_partitioning=1,
        union_by_name=true,
        file_row_number=false
      )
    ),
    intersected AS (
      SELECT gers_id, geometry_wkb, feature_name, feature_height
      FROM raw
      WHERE ST_Intersects(geometry_wkb, ST_GeomFromText('${wkt}'))
    ),
    deduped AS (
      SELECT DISTINCT ON (gers_id) gers_id, geometry_wkb, feature_name, feature_height
      FROM intersected
    )
    SELECT gers_id, ST_AsGeoJSON(geometry_wkb) as geometry_geojson, feature_name, feature_height
    FROM deduped
    ${limit ? `LIMIT ${limit}` : ""}
  `;
  
  const queryStart = Date.now();
  let rows = [];
  
  try {
    rows = await queryWithIam(sql, REGION);
  } catch (e) {
    // If some tiles don't exist, DuckDB errors - filter to existing tiles
    if (e.message && (e.message.includes('No files found') || e.message.includes('Could not'))) {
      console.warn(`[${theme}] Some tiles missing, checking existence...`);
      const existingPaths = [];
      const checkStart = Date.now();
      for (const t of tilePaths) {
        const exists = await checkTileExists(theme, regionCode, t.tileY, t.tileX);
        if (exists) existingPaths.push(`'${t.path}'`);
      }
      console.log(`[${theme}] Found ${existingPaths.length}/${tilePaths.length} existing tiles in ${Date.now() - checkStart}ms`);
      
      if (existingPaths.length === 0) {
        return { type: "FeatureCollection", features: [], metadata: { theme, tiles_scanned: 0, features: 0 } };
      }
      
      // Rebuild SQL with only existing paths
      const existingList = existingPaths.join(", ");
      const fallbackSql = `
        WITH raw AS (
          SELECT gers_id, geometry_wkb, cx, cy, ${nameCol} as feature_name, ${heightCol} as feature_height
          FROM read_parquet([${existingList}], hive_partitioning=1)
        ),
        intersected AS (
          SELECT gers_id, geometry_wkb, feature_name, feature_height
          FROM raw
          WHERE ST_Intersects(geometry_wkb, ST_GeomFromText('${wkt}'))
        ),
        deduped AS (
          SELECT DISTINCT ON (gers_id) gers_id, geometry_wkb, feature_name, feature_height
          FROM intersected
        )
        SELECT gers_id, ST_AsGeoJSON(geometry_wkb) as geometry_geojson, feature_name, feature_height
        FROM deduped
        ${limit ? `LIMIT ${limit}` : ""}
      `;
      rows = await queryWithIam(fallbackSql, REGION);
    } else {
      throw e;
    }
  }
  
  const queryTime = Date.now() - queryStart;
  const totalTime = Date.now() - tileStart;
  
  console.log(`[${theme}] Found ${rows.length} features in ${queryTime}ms (total: ${totalTime}ms)`);
  
  return {
    type: "FeatureCollection",
    features: rows.map(r => {
      // Parse GeoJSON from DuckDB (ST_AsGeoJSON returns a JSON string)
      let geom = null;
      try {
        if (r.geometry_geojson) {
          geom = JSON.parse(r.geometry_geojson);
        }
      } catch (e) {
        console.warn('Failed to parse GeoJSON:', e.message);
      }
      
      return {
        type: "Feature",
        geometry: geom,
        properties: {
          layer: theme,
          gers_id: r.gers_id,
          name: r.feature_name,
          ...(theme === "buildings" && r.feature_height ? { height: r.feature_height } : {}),
          ...(theme === "roads" && r.feature_name ? { road_type: r.feature_name } : {})
        }
      };
    }),
    metadata: {
      theme,
      tiles_scanned: tilePaths.length,
      features_returned: rows.length,
      timing_ms: { tile_calc: queryStart - tileStart, query: queryTime, total: totalTime }
    }
  };
}

// ============================================
// Addresses Query
// ============================================

async function queryAddresses({ state, polygon, limit }) {
  const addrGlob = addressesGlobForState(state);
  const { minX, minY, maxX, maxY } = bboxFromPolygon(polygon);
  const wkt = polygonToWKT(polygon);
  
  // Expand bbox slightly to catch edge cases (buffer by ~0.001 degrees = ~100m)
  const buffer = 0.001;
  const bufferedMinX = minX - buffer;
  const bufferedMaxX = maxX + buffer;
  const bufferedMinY = minY - buffer;
  const bufferedMaxY = maxY + buffer;
  
  // Schema detection
  const descSql = `DESCRIBE SELECT * FROM read_parquet('${addrGlob}') LIMIT 1;`;
  const cols = await queryWithIam(descSql, REGION);
  const names = new Set(cols.map(c => c.column_name));
  
  let latCol = "latitude", lonCol = "longitude";
  if (names.has("lat") && names.has("lon")) {
    latCol = "lat"; lonCol = "lon";
  }
  
  // OPTIMIZED: Use ST_Intersects instead of ST_Contains to catch boundary addresses
  // Also expand the bbox filter to ensure we don't miss edge cases
  const sql = `
    SELECT gers_id, formatted, house_number, street_name, unit, city, postal_code, state,
           ${lonCol} as longitude, ${latCol} as latitude
    FROM read_parquet('${addrGlob}')
    WHERE (${lonCol} BETWEEN ${bufferedMinX} AND ${bufferedMaxX}) 
      AND (${latCol} BETWEEN ${bufferedMinY} AND ${bufferedMaxY})
      AND ST_Intersects(ST_GeomFromText('${wkt}'), ST_Point(${lonCol}, ${latCol}))
    LIMIT ${limit}
  `;
  
  console.log(`[addresses] Querying with buffered bbox: [${bufferedMinX.toFixed(4)}, ${bufferedMinY.toFixed(4)}, ${bufferedMaxX.toFixed(4)}, ${bufferedMaxY.toFixed(4)}]`);
  
  const queryStart = Date.now();
  const rows = await queryWithIam(sql, REGION);
  const queryTime = Date.now() - queryStart;
  
  console.log(`[addresses] Found ${rows.length} addresses in ${queryTime}ms`);
  
  return {
    type: "FeatureCollection",
    features: rows.map(r => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [r.longitude, r.latitude] },
      properties: {
        layer: "addresses",
        id: r.gers_id,
        label: r.formatted || `${r.house_number} ${r.street_name}`,
        gers_id: r.gers_id,
        formatted: r.formatted,
        house_number: r.house_number,
        street_name: r.street_name,
        unit: r.unit,
        city: r.city,
        postal_code: r.postal_code,
        state: r.state
      }
    }))
  };
}

// ============================================
// Lambda Handler
// ============================================

exports.handler = async (event) => {
  const startTime = Date.now();
  
  try {
    // Auth
    const required = process.env.SLICE_SHARED_SECRET;
    if (required) {
      const got = (event.headers?.["x-slice-secret"] || event.headers?.["X-Slice-Secret"] || "").trim();
      if (got !== required) {
        return { statusCode: 401, body: JSON.stringify({ error: "Unauthorized" }) };
      }
    }
    
    // Parse request
    const body = typeof event.body === "string" ? JSON.parse(event.body) : (event.body || {});
    const polygon = body.polygon;
    const state = (body.state || "ON").toUpperCase();
    const regionCode = (body.region || state || "ON").toUpperCase();
    const campaignId = body.campaign_id || newCampaignId();
    
    const limitBuildings = body.limitBuildings ?? 500;
    const limitRoads = body.limitRoads ?? 300;
    const limitDivisions = body.limitDivisions ?? 100;
    const limitAddresses = body.limitAddresses ?? 2000;
    
    const includeRoads = body.includeRoads ?? false;
    const includeDivisions = body.includeDivisions ?? false;
    
    if (!polygon) throw new Error("Missing polygon");
    const coords = polygon?.coordinates?.[0];
    if (!coords || coords.length < 3) {
      throw new Error("Invalid polygon: exterior ring must have at least 3 points (found " + (coords?.length ?? 0) + "). Please draw a proper territory with at least 3 corners.");
    }
    if (!SNAPSHOT_BUCKET) throw new Error("Missing SNAPSHOT_BUCKET env var");
    
    console.log("Request:", JSON.stringify({
      state, regionCode, campaignId,
      limits: { buildings: limitBuildings, roads: limitRoads, divisions: limitDivisions, addresses: limitAddresses },
      includes: { roads: includeRoads, divisions: includeDivisions }
    }));
    
    // Query themes
    const buildings = await queryTheme("buildings", polygon, limitBuildings, regionCode);
    
    let roads = null;
    if (includeRoads) {
      roads = await queryTheme("roads", polygon, limitRoads, regionCode);
    }
    
    let divisions = null;
    if (includeDivisions) {
      divisions = await queryTheme("divisions", polygon, limitDivisions, regionCode);
    }
    
    const addresses = await queryAddresses({ state, polygon, limit: limitAddresses });
    
    console.log(`Results: buildings=${buildings.features.length}, addresses=${addresses.features.length}, roads=${roads?.features.length || 0}, divisions=${divisions?.features.length || 0}`);
    
    // Write snapshots
    const baseKey = `${SNAPSHOT_PREFIX}/${campaignId}`;
    const writes = {};
    
    writes.buildings = await putGzJson({ bucket: SNAPSHOT_BUCKET, key: `${baseKey}/buildings.geojson.gz`, obj: buildings });
    writes.addresses = await putGzJson({ bucket: SNAPSHOT_BUCKET, key: `${baseKey}/addresses.geojson.gz`, obj: addresses });
    
    if (roads) {
      writes.roads = await putGzJson({ bucket: SNAPSHOT_BUCKET, key: `${baseKey}/roads.geojson.gz`, obj: roads });
    }
    if (divisions) {
      writes.divisions = await putGzJson({ bucket: SNAPSHOT_BUCKET, key: `${baseKey}/divisions.geojson.gz`, obj: divisions });
    }
    
    // Metadata
    const metadata = {
      created_at: new Date().toISOString(),
      campaign_id: campaignId,
      state, region: regionCode, polygon,
      counts: {
        buildings: buildings.features.length,
        addresses: addresses.features.length,
        roads: roads?.features.length || 0,
        divisions: divisions?.features.length || 0
      },
      bbox: bboxFromPolygon(polygon),
      overture_release: OVERTURE_RELEASE,
      tile_metrics: {
        buildings: buildings.metadata,
        roads: roads?.metadata,
        divisions: divisions?.metadata
      }
    };
    
    writes.metadata = await putGzJson({ bucket: SNAPSHOT_BUCKET, key: `${baseKey}/metadata.json.gz`, obj: metadata });
    
    // URLs
    const urls = {
      buildings: await presignGet({ bucket: SNAPSHOT_BUCKET, key: writes.buildings.key }),
      addresses: await presignGet({ bucket: SNAPSHOT_BUCKET, key: writes.addresses.key }),
      metadata: await presignGet({ bucket: SNAPSHOT_BUCKET, key: writes.metadata.key })
    };
    if (roads) urls.roads = await presignGet({ bucket: SNAPSHOT_BUCKET, key: writes.roads.key });
    if (divisions) urls.divisions = await presignGet({ bucket: SNAPSHOT_BUCKET, key: writes.divisions.key });
    
    const elapsed = Date.now() - startTime;
    console.log(`✅ Success in ${elapsed}ms`);
    
    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        campaign_id: campaignId,
        bucket: SNAPSHOT_BUCKET,
        prefix: baseKey,
        counts: metadata.counts,
        s3_keys: {
          buildings: writes.buildings.key,
          addresses: writes.addresses.key,
          metadata: writes.metadata.key,
          ...(roads ? { roads: writes.roads.key } : {}),
          ...(divisions ? { divisions: writes.divisions.key } : {})
        },
        urls,
        metadata: { elapsed_ms: elapsed, overture_release: OVERTURE_RELEASE }
      })
    };
    
  } catch (e) {
    const elapsed = Date.now() - startTime;
    console.error(`❌ Error after ${elapsed}ms:`, e);
    
    return {
      statusCode: e.message?.includes("Polygon too large") ? 400 : 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: e.message || String(e) })
    };
  }
};
