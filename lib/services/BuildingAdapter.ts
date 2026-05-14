/**
 * BuildingAdapter - Normalizes static CloudFront/S3 building geometry to standard GeoJSON.
 */

import { filterLinkableBuildingFootprints } from '@/lib/geo/buildingFootprintFilter';

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
  private static isPmtilesUrl(url: string | null | undefined): boolean {
    return Boolean(url?.split('?')[0]?.toLowerCase().endsWith('.pmtiles'));
  }

  private static filterRenderableFeatures<T extends StandardBuildingFeature>(features: T[], source: 'CloudFront/S3'): T[] {
    const filtered = filterLinkableBuildingFootprints(features);
    const removed = features.length - filtered.length;
    if (removed > 0) {
      console.log(`[BuildingAdapter] Filtered ${removed} shed/accessory ${source} building feature(s)`);
    }
    return filtered;
  }

  /**
   * Validate and normalize CloudFront/S3 GeoJSON.
   * Ensures consistent property names even if the static geometry format changes.
   */
  static fromStaticGeometryGeoJSON(geojson: unknown): StandardBuildingCollection {
    const featuresRaw = geojson && typeof geojson === 'object'
      ? (geojson as { features?: unknown }).features
      : null;
    if (!Array.isArray(featuresRaw)) {
      console.warn('[BuildingAdapter] Invalid CloudFront/S3 GeoJSON, returning empty collection');
      return { type: 'FeatureCollection', features: [] };
    }

    const features: StandardBuildingFeature[] = featuresRaw.flatMap((feature) => {
      const raw = feature as RawBuildingFeature;
      if (!raw.geometry || !['Polygon', 'MultiPolygon'].includes(String(raw.geometry.type))) return [];
      const properties = raw.properties ?? {};
      const externalId = properties.external_id ?? properties.id;
      const area = properties.area ?? properties.area_sqm;
      return [{
        type: 'Feature' as const,
        geometry: raw.geometry,
        properties: {
          ...properties, // Preserve any additional properties
          gers_id: String(properties.gers_id || properties.id || properties.external_id || ''),
          external_id:
            typeof externalId === 'string' || typeof externalId === 'number'
              ? String(externalId)
              : undefined,
          area: typeof area === 'number' && Number.isFinite(area) ? area : undefined,
          height: typeof properties.height === 'number' ? properties.height : null,
          layer: 'building',
        },
      }];
    });

    return {
      type: 'FeatureCollection',
      features: this.filterRenderableFeatures(features, 'CloudFront/S3'),
    };
  }

  /**
   * Fetch and normalize CloudFront/S3 static building geometry.
   * When preFetchedBuildingsGeo is provided, skips building download.
   */
  static async fetchAndNormalize(
    snapshot: { urls: { buildings: string }; metadata?: { overture_release?: string } } | null,
    preFetchedBuildingsGeo?: unknown
  ): Promise<{ buildings: StandardBuildingCollection; overtureRelease: string; source: 'static_geometry' }> {
    if (snapshot) {
      let geojson: unknown;
      if (preFetchedBuildingsGeo != null) {
        geojson = preFetchedBuildingsGeo;
        const featureCount = geojson && typeof geojson === 'object' && Array.isArray((geojson as { features?: unknown }).features)
          ? (geojson as { features: unknown[] }).features.length
          : 0;
        console.log(`[BuildingAdapter] Using ${featureCount} pre-fetched CloudFront/S3 buildings`);
      } else {
        if (!snapshot.urls.buildings) {
          console.log('[BuildingAdapter] No building URL available; using empty building collection');
          return {
            buildings: { type: 'FeatureCollection', features: [] },
            overtureRelease: snapshot.metadata?.overture_release || '2026-01-21.0',
            source: 'static_geometry',
          };
        }

        if (this.isPmtilesUrl(snapshot.urls.buildings)) {
          console.log('[BuildingAdapter] Skipping direct PMTiles building fetch; scoped GeoJSON extraction handles PMTiles snapshots');
          return {
            buildings: { type: 'FeatureCollection', features: [] },
            overtureRelease: snapshot.metadata?.overture_release || '2026-01-21.0',
            source: 'static_geometry',
          };
        }

        console.log(`[BuildingAdapter] Fetching from CloudFront: ${snapshot.urls.buildings}`);
        const response = await fetch(snapshot.urls.buildings);
        if (!response.ok) {
          throw new Error(`Failed to fetch buildings: ${response.status}`);
        }
        geojson = await response.json();
        const featureCount = geojson && typeof geojson === 'object' && Array.isArray((geojson as { features?: unknown }).features)
          ? (geojson as { features: unknown[] }).features.length
          : 0;
        console.log(`[BuildingAdapter] Downloaded ${featureCount} CloudFront/S3 buildings`);
      }
      return {
        buildings: this.fromStaticGeometryGeoJSON(geojson),
        overtureRelease: snapshot.metadata?.overture_release || '2026-01-21.0',
        source: 'static_geometry',
      };
    }

    console.warn('[BuildingAdapter] No CloudFront/S3 buildings available');
    return {
      buildings: { type: 'FeatureCollection', features: [] },
      overtureRelease: '2026-01-21.0',
      source: 'static_geometry',
    };
  }
}
