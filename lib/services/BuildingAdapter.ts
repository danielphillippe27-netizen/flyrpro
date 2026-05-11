/**
 * BuildingAdapter - Normalizes buildings from any source to standard GeoJSON
 * 
 * This module implements the Adapter Pattern:
 * - Gold: Database rows → Standard GeoJSON
 * - Silver (Lambda): S3 GeoJSON → Standard GeoJSON (pass-through with validation)
 */

import { filterLinkableBuildingFootprints } from '@/lib/geo/buildingFootprintFilter';

export interface GoldBuildingRow {
  id: string;
  source_id?: string;
  external_id?: string;
  area_sqm?: number;
  height_m?: number | null;
  floors?: number | null;
  geom_geojson: string; // GeoJSON string from ST_AsGeoJSON
  centroid_geojson?: string;
  building_type?: string;
  subtype?: string;
}

export interface StandardBuildingFeature {
  type: 'Feature';
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  properties: {
    gers_id: string;
    external_id?: string;
    area?: number;
    height?: number | null;
    layer: 'building';
    [key: string]: unknown;
  };
}

export interface StandardBuildingCollection {
  type: 'FeatureCollection';
  features: StandardBuildingFeature[];
}

type RawBuildingFeature = {
  geometry?: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  properties?: Record<string, unknown>;
};

export class BuildingAdapter {
  private static filterRenderableRows<T extends GoldBuildingRow>(rows: T[], source: 'Gold' | 'Lambda'): T[] {
    const filtered = filterLinkableBuildingFootprints(rows);
    const removed = rows.length - filtered.length;
    if (removed > 0) {
      console.log(`[BuildingAdapter] Filtered ${removed} shed/accessory ${source} building footprint(s)`);
    }
    return filtered;
  }

  private static filterRenderableFeatures<T extends StandardBuildingFeature>(features: T[], source: 'Gold' | 'Lambda'): T[] {
    const filtered = filterLinkableBuildingFootprints(features);
    const removed = features.length - filtered.length;
    if (removed > 0) {
      console.log(`[BuildingAdapter] Filtered ${removed} shed/accessory ${source} building feature(s)`);
    }
    return filtered;
  }

  private static inferredHeightMeters(row: GoldBuildingRow): number {
    if (typeof row.height_m === 'number' && Number.isFinite(row.height_m) && row.height_m > 0) {
      return row.height_m;
    }
    if (typeof row.floors === 'number' && Number.isFinite(row.floors) && row.floors > 0) {
      return Math.max(row.floors * 3, 3);
    }

    const area = typeof row.area_sqm === 'number' && Number.isFinite(row.area_sqm)
      ? row.area_sqm
      : 0;
    if (area >= 1000) return 14;
    if (area >= 450) return 12;
    if (area >= 220) return 10;
    if (area >= 90) return 8;
    return 6;
  }

  /**
   * Convert Gold database rows to standard GeoJSON
   */
  static fromGoldRows(rows: GoldBuildingRow[]): StandardBuildingCollection {
    const renderableRows = this.filterRenderableRows(rows, 'Gold');
    return {
      type: 'FeatureCollection',
      features: renderableRows.map((row): StandardBuildingFeature => ({
        type: 'Feature',
        geometry: JSON.parse(row.geom_geojson) as GeoJSON.Polygon | GeoJSON.MultiPolygon,
        properties: {
          gers_id: row.id,
          external_id: row.external_id || row.source_id,
          area: row.area_sqm,
          area_sqm: row.area_sqm,
          height: this.inferredHeightMeters(row),
          height_m: this.inferredHeightMeters(row),
          floors: row.floors,
          building_type: row.building_type,
          subtype: row.subtype,
          layer: 'building',
        },
      })),
    };
  }

  /**
   * Validate and normalize Lambda/Silver GeoJSON
   * Ensures consistent property names even if Lambda format changes
   */
  static fromLambdaGeoJSON(geojson: unknown): StandardBuildingCollection {
    const featuresRaw = geojson && typeof geojson === 'object'
      ? (geojson as { features?: unknown }).features
      : null;
    if (!Array.isArray(featuresRaw)) {
      console.warn('[BuildingAdapter] Invalid Lambda GeoJSON, returning empty collection');
      return { type: 'FeatureCollection', features: [] };
    }

    const features: StandardBuildingFeature[] = featuresRaw.flatMap((feature) => {
      const raw = feature as RawBuildingFeature;
      if (!raw.geometry || !['Polygon', 'MultiPolygon'].includes(String(raw.geometry.type))) return [];
      const properties = raw.properties ?? {};
      const area = typeof properties.area === 'number'
        ? properties.area
        : typeof properties.area_sqm === 'number'
          ? properties.area_sqm
          : undefined;
      const externalId = typeof properties.external_id === 'string'
        ? properties.external_id
        : typeof properties.id === 'string'
          ? properties.id
          : undefined;
      return [{
        type: 'Feature' as const,
        geometry: raw.geometry,
        properties: {
          gers_id: String(properties.gers_id || properties.id || properties.external_id || ''),
          ...(externalId ? { external_id: externalId } : {}),
          ...(area !== undefined ? { area } : {}),
          height: typeof properties.height === 'number' ? properties.height : null,
          layer: 'building',
          ...properties, // Preserve any additional properties
        },
      }];
    });

    return {
      type: 'FeatureCollection',
      features: this.filterRenderableFeatures(features, 'Lambda'),
    };
  }

  /**
   * Fetch and normalize from either source
   * This is the main entry point for the adapter pattern.
   * When preFetchedBuildingsGeo is provided (e.g. from parallel S3 fetch), skips building download.
   */
  static async fetchAndNormalize(
    goldBuildings: GoldBuildingRow[] | null | undefined,
    snapshot: { urls: { buildings: string }; metadata?: { overture_release?: string } } | null,
    preFetchedBuildingsGeo?: unknown
  ): Promise<{ buildings: StandardBuildingCollection; overtureRelease: string; source: 'gold' | 'lambda' }> {
    // Gold path: Database rows
    if (goldBuildings && goldBuildings.length > 0) {
      console.log(`[BuildingAdapter] Normalizing ${goldBuildings.length} Gold buildings`);
      return {
        buildings: this.fromGoldRows(goldBuildings),
        overtureRelease: '2026-01-21.0',
        source: 'gold',
      };
    }

    // Silver path: use pre-fetched GeoJSON or download from S3
    if (snapshot) {
      let geojson: unknown;
      if (preFetchedBuildingsGeo != null) {
        geojson = preFetchedBuildingsGeo;
        const featureCount = geojson && typeof geojson === 'object' && Array.isArray((geojson as { features?: unknown }).features)
          ? (geojson as { features: unknown[] }).features.length
          : 0;
        console.log(`[BuildingAdapter] Using ${featureCount} pre-fetched Lambda buildings`);
      } else {
        console.log(`[BuildingAdapter] Fetching from Lambda: ${snapshot.urls.buildings}`);
        const response = await fetch(snapshot.urls.buildings);
        if (!response.ok) {
          throw new Error(`Failed to fetch buildings: ${response.status}`);
        }
        geojson = await response.json();
        const featureCount = geojson && typeof geojson === 'object' && Array.isArray((geojson as { features?: unknown }).features)
          ? (geojson as { features: unknown[] }).features.length
          : 0;
        console.log(`[BuildingAdapter] Downloaded ${featureCount} Lambda buildings`);
      }
      return {
        buildings: this.fromLambdaGeoJSON(geojson),
        overtureRelease: snapshot.metadata?.overture_release || '2026-01-21.0',
        source: 'lambda',
      };
    }

    // No buildings available
    console.warn('[BuildingAdapter] No buildings available from any source');
    return {
      buildings: { type: 'FeatureCollection', features: [] },
      overtureRelease: '2026-01-21.0',
      source: 'lambda',
    };
  }
}
