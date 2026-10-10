import booleanIntersects from '@turf/boolean-intersects';
import type { StormFeatureProperties } from './types';
export type StormTerritories = GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon>;
export function stormTerritoryImpact(territories: StormTerritories | undefined, risk: GeoJSON.FeatureCollection<GeoJSON.Geometry, StormFeatureProperties>) {
  if (!territories) return [];
  return territories.features.flatMap((territory) => {
    const matches = risk.features.filter((feature) => {
      if (feature.properties.kind === 'report' || !['Polygon', 'MultiPolygon'].includes(feature.geometry.type)) return false;
      try { return booleanIntersects(territory, feature); } catch { return false; }
    });
    return matches.length ? [{ id: String(territory.properties?.id || territory.id || ''), name: String(territory.properties?.name || 'Campaign territory'), events: [...new Set(matches.map((feature) => feature.properties.event))] }] : [];
  });
}
