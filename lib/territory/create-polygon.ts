import type MapboxDraw from '@mapbox/mapbox-gl-draw';

export function getDrawnPolygon(
  draw: MapboxDraw | null | undefined
): { type: 'Polygon'; coordinates: number[][][] } | null {
  const features = draw?.getAll();
  if (!features || features.features.length === 0) return null;

  const polygonFeature = features.features.find(
    (feature): feature is GeoJSON.Feature<GeoJSON.Polygon> =>
      feature.geometry?.type === 'Polygon' && feature.geometry.coordinates[0]?.length >= 3
  );
  if (!polygonFeature) return null;

  let polygon = polygonFeature.geometry as { type: 'Polygon'; coordinates: number[][][] };
  const ring = polygon.coordinates[0];
  if (!ring || ring.length < 3) return null;

  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    polygon = {
      ...polygon,
      coordinates: [[...ring, [first[0], first[1]]]],
    };
  }

  return polygon;
}
