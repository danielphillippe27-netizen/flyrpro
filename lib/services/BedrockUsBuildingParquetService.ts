import * as turf from '@turf/turf';
import { duckDbRuntimeSetupStatements } from '@/lib/services/duckdbRuntime';
import type { CampaignSnapshotRow } from '@/lib/diamond/geometry';
import type duckdbModule from 'duckdb';

export type BedrockUsBuildingFeatureCollection = {
  type: 'FeatureCollection';
  features: Array<GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>>;
};

type BedrockBuildingParquetRow = {
  building_id?: string | null;
  source_id?: string | null;
  subtype?: string | null;
  class?: string | null;
  height?: string | number | null;
  minx?: number | null;
  miny?: number | null;
  maxx?: number | null;
  maxy?: number | null;
  geometry_geojson?: string | null;
  properties_json?: string | null;
  source?: string | null;
  state?: string | null;
};

let duckdbModulePromise: Promise<typeof duckdbModule> | null = null;
let httpfsInstallPromise: Promise<unknown> | null = null;
let httpfsInstalled = false;

function sqlString(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function sqlNumber(value: number) {
  if (!Number.isFinite(value)) throw new Error(`Invalid SQL number: ${value}`);
  return String(value);
}

function loadDuckDbModule() {
  if (!duckdbModulePromise) {
    duckdbModulePromise = import('duckdb');
  }
  return duckdbModulePromise;
}

async function getRows(sql: string): Promise<BedrockBuildingParquetRow[]> {
  const duckdb = await loadDuckDbModule();
  const db = new duckdb.Database(':memory:');
  const all = (statement: string) =>
    new Promise<BedrockBuildingParquetRow[]>((resolve, reject) => {
      db.all(statement, (error: Error | null, rows: BedrockBuildingParquetRow[]) => {
        if (error) reject(error);
        else resolve(rows);
      });
    });

  try {
    for (const statement of duckDbRuntimeSetupStatements()) {
      await all(statement);
    }
    if (!httpfsInstalled) {
      if (!httpfsInstallPromise) {
        httpfsInstallPromise = all('INSTALL httpfs')
          .then(() => {
            httpfsInstalled = true;
          })
          .catch((error) => {
            httpfsInstallPromise = null;
            throw error;
          });
      }
      await httpfsInstallPromise;
    }
    await all('LOAD httpfs');
    await all(`SET s3_region=${sqlString(process.env.AWS_REGION || process.env.AWS_S3_BUCKET_REGION || 'us-east-2')}`);
    if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      await all(`SET s3_access_key_id=${sqlString(process.env.AWS_ACCESS_KEY_ID)}`);
      await all(`SET s3_secret_access_key=${sqlString(process.env.AWS_SECRET_ACCESS_KEY)}`);
      if (process.env.AWS_SESSION_TOKEN) {
        await all(`SET s3_session_token=${sqlString(process.env.AWS_SESSION_TOKEN)}`);
      }
    }

    return await all(sql);
  } finally {
    db.close();
  }
}

function stateFromSnapshot(snapshot: CampaignSnapshotRow): string | null {
  const candidates = [
    snapshot.buildings_key,
    typeof snapshot.tile_metrics?.pmtiles_key === 'string' ? snapshot.tile_metrics.pmtiles_key : null,
  ];

  for (const candidate of candidates) {
    const match = candidate?.match(/state=([A-Z]{2})\//i);
    if (match?.[1]) return match[1].toUpperCase();
  }

  return null;
}

function parseProperties(row: BedrockBuildingParquetRow) {
  if (!row.properties_json?.trim()) return {};
  try {
    return JSON.parse(row.properties_json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function numeric(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeRow(row: BedrockBuildingParquetRow): GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null {
  if (!row.geometry_geojson?.trim()) return null;

  let geometry: GeoJSON.Geometry;
  try {
    geometry = JSON.parse(row.geometry_geojson) as GeoJSON.Geometry;
  } catch {
    return null;
  }

  if (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon') return null;

  const properties = parseProperties(row);
  const buildingId = String(
    row.building_id ??
    properties.building_id ??
    properties.gers_id ??
    properties.id ??
    row.source_id ??
    ''
  ).trim();
  if (!buildingId) return null;

  const height = Math.max(numeric(row.height) ?? numeric(properties.height) ?? numeric(properties.height_m) ?? 10, 10);

  return {
    type: 'Feature',
    id: buildingId,
    geometry,
    properties: {
      ...properties,
      id: buildingId,
      building_id: buildingId,
      gers_id: buildingId,
      source_id: row.source_id ?? properties.source_id,
      source: row.source ?? properties.source ?? 'Overture Maps Buildings',
      source_region: row.state ?? properties.source_region ?? properties.state,
      subtype: row.subtype ?? properties.subtype,
      class: row.class ?? properties.class,
      height,
      height_m: height,
      min_height: numeric(properties.min_height) ?? 0,
      feature_type: 'matched_house',
      feature_status: 'matched',
      status: 'not_visited',
      scans_total: 0,
      qr_scanned: false,
    },
  };
}

export async function fetchBedrockUsParquetBuildingFeatures(
  snapshot: CampaignSnapshotRow,
  bbox: [number, number, number, number],
  boundary: GeoJSON.Polygon | null = null
): Promise<BedrockUsBuildingFeatureCollection | null> {
  if (!snapshot.bucket) return null;

  const state = stateFromSnapshot(snapshot);
  if (!state) return null;

  const parquetPath = `s3://${snapshot.bucket}/bedrock/usa/current/buildings/parquet_by_state/state=${state}/buildings.spatial.parquet`;
  const rows = await getRows(`
    SELECT building_id, source_id, subtype, class, height, minx, miny, maxx, maxy, geometry_geojson, properties_json, source, state
    FROM read_parquet(${sqlString(parquetPath)}, union_by_name=true)
    WHERE maxx >= ${sqlNumber(bbox[0])} AND minx <= ${sqlNumber(bbox[2])}
      AND maxy >= ${sqlNumber(bbox[1])} AND miny <= ${sqlNumber(bbox[3])}
  `);

  const boundaryFeature = boundary ? turf.feature(boundary) : null;
  const byBuildingId = new Map<string, GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>>();
  for (const row of rows) {
    const feature = normalizeRow(row);
    if (!feature) continue;
    if (boundaryFeature && !turf.booleanIntersects(feature, boundaryFeature)) continue;
    const buildingId = String(feature.id ?? feature.properties?.building_id ?? '').trim();
    if (!buildingId) continue;
    byBuildingId.set(buildingId, feature);
  }

  return {
    type: 'FeatureCollection',
    features: Array.from(byBuildingId.values()),
  };
}
