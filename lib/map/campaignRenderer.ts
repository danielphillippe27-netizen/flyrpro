import type { BuildingFeatureCollection } from '@/types/map-buildings';

export type CampaignMapRenderer = 'mapbox3D' | 'google2D';

function hasFiniteCoordinates(value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0) return false;
  if (typeof value[0] === 'number') {
    return value.length >= 2 && value.every((entry) => typeof entry === 'number' && Number.isFinite(entry));
  }
  return value.every(hasFiniteCoordinates);
}

export function hasRenderableCampaignBuildings(
  collection: BuildingFeatureCollection | null | undefined,
): boolean {
  return Boolean(collection?.features.some((feature) => {
    const properties = feature.properties as unknown as Record<string, unknown> | null | undefined;
    const featureType = String(properties?.feature_type ?? properties?.render_kind ?? '').toLowerCase();
    if (featureType === 'manual_pin' || featureType === 'field_manual_pin') return false;
    const geometry = feature.geometry;
    return Boolean(
      geometry &&
      (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') &&
      hasFiniteCoordinates(geometry.coordinates),
    );
  }));
}

export function resolveCampaignMapRenderer(input: {
  dataResolved: boolean;
  hasRenderableBuildings: boolean;
  activeSession: boolean;
  sessionUses2D: boolean;
  mapboxAvailable: boolean;
  googleAvailable: boolean;
}): CampaignMapRenderer | null {
  if (!input.dataResolved) return null;
  if (input.activeSession) {
    if ((input.sessionUses2D || !input.mapboxAvailable) && input.googleAvailable) return 'google2D';
    return input.mapboxAvailable ? 'mapbox3D' : null;
  }
  if (!input.hasRenderableBuildings) return input.googleAvailable ? 'google2D' : null;
  return input.mapboxAvailable ? 'mapbox3D' : null;
}
