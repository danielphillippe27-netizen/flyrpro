/**
 * BuildingAdapter - Normalizes buildings from any source to standard GeoJSON
 * 
 * This module implements the Adapter Pattern:
 * - Gold: Database rows → Standard GeoJSON
 * - Silver (Lambda): S3 GeoJSON → Standard GeoJSON (pass-through with validation)
 */

export interface GoldBuildingRow {
  id: string;
  source_id?: string;
  external_id?: string;
  area_sqm?: number;
  geom_geojson: string; // GeoJSON string from ST_AsGeoJSON
  centroid_geojson?: string;
  building_type?: string;
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
    [key: string]: any;
  };
}

export interface StandardBuildingCollection {
  type: 'FeatureCollection';
  features: StandardBuildingFeature[];
}

export class BuildingAdapter {
  private static isGoldRowArray(rows: unknown[]): rows is GoldBuildingRow[] {
    if (rows.length === 0) return false;
    const first = rows[0] as Record<string, unknown>;
    return typeof first?.geom_geojson === 'string';
  }

  private static coerceFeatureCollection(input: unknown): StandardBuildingCollection | null {
    if (!input || typeof input !== 'object') return null;
    const maybe = input as { features?: unknown[]; type?: string };
    if (!Array.isArray(maybe.features)) return null;
    return this.fromLambdaGeoJSON({
      type: maybe.type || 'FeatureCollection',
      features: maybe.features,
    });
  }

  /**
   * Convert Gold database rows to standard GeoJSON
   */
  static fromGoldRows(rows: GoldBuildingRow[]): StandardBuildingCollection {
    return {
      type: 'FeatureCollection',
      features: rows.map((row) => ({
        type: 'Feature',
        geometry: JSON.parse(row.geom_geojson),
        properties: {
          gers_id: row.id,
          external_id: row.external_id || row.source_id,
          area: row.area_sqm,
          height: null,
          layer: 'building',
        },
      })),
    };
  }

  /**
   * Validate and normalize Lambda/Silver GeoJSON
   * Ensures consistent property names even if Lambda format changes
   */
  static fromLambdaGeoJSON(geojson: any): StandardBuildingCollection {
    if (!geojson || !Array.isArray(geojson.features)) {
      console.warn('[BuildingAdapter] Invalid Lambda GeoJSON, returning empty collection');
      return { type: 'FeatureCollection', features: [] };
    }

    return {
      type: 'FeatureCollection',
      features: geojson.features.map((f: any) => ({
        type: 'Feature',
        geometry: f.geometry,
        properties: {
          gers_id: f.properties?.gers_id || f.properties?.id || f.properties?.external_id,
          external_id: f.properties?.external_id || f.properties?.id,
          area: f.properties?.area || f.properties?.area_sqm,
          height: f.properties?.height || null,
          layer: 'building',
          ...f.properties, // Preserve any additional properties
        },
      })),
    };
  }

  /**
   * Fetch and normalize from either source
   * This is the main entry point for the adapter pattern.
   * When preFetchedBuildingsGeo is provided (e.g. from parallel S3 fetch), skips building download.
   */
  static async fetchAndNormalize(
    goldBuildings: GoldBuildingRow[] | unknown | null | undefined,
    snapshot: { urls: { buildings: string }; metadata?: { overture_release?: string } } | null,
    preFetchedBuildingsGeo?: unknown
  ): Promise<{ buildings: StandardBuildingCollection; overtureRelease: string; source: 'gold' | 'lambda' }> {
    // Gold path: Database rows
    if (Array.isArray(goldBuildings) && goldBuildings.length > 0) {
      if (this.isGoldRowArray(goldBuildings)) {
        console.log(`[BuildingAdapter] Normalizing ${goldBuildings.length} Gold buildings`);
        return {
          buildings: this.fromGoldRows(goldBuildings),
          overtureRelease: '2026-01-21.0',
          source: 'gold',
        };
      }

      // Some environments return raw GeoJSON features instead of SQL rows.
      console.log(`[BuildingAdapter] Gold buildings returned as features: ${goldBuildings.length}`);
      return {
        buildings: this.fromLambdaGeoJSON({
          type: 'FeatureCollection',
          features: goldBuildings,
        }),
        overtureRelease: '2026-01-21.0',
        source: 'gold',
      };
    }

    const featureCollection = this.coerceFeatureCollection(goldBuildings);
    if (featureCollection && featureCollection.features.length > 0) {
      console.log(`[BuildingAdapter] Gold buildings returned as FeatureCollection: ${featureCollection.features.length}`);
      return {
        buildings: featureCollection,
        overtureRelease: '2026-01-21.0',
        source: 'gold',
      };
    }

    // Silver path: use pre-fetched GeoJSON or download from S3
    if (snapshot) {
      let geojson: any;
      if (preFetchedBuildingsGeo != null) {
        geojson = preFetchedBuildingsGeo;
        console.log(`[BuildingAdapter] Using ${geojson?.features?.length ?? 0} pre-fetched Lambda buildings`);
      } else {
        console.log(`[BuildingAdapter] Fetching from Lambda: ${snapshot.urls.buildings}`);
        const response = await fetch(snapshot.urls.buildings);
        if (!response.ok) {
          throw new Error(`Failed to fetch buildings: ${response.status}`);
        }
        geojson = await response.json();
        console.log(`[BuildingAdapter] Downloaded ${geojson.features?.length || 0} Lambda buildings`);
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
