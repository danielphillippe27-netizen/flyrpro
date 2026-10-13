import { bbox, bboxPolygon, booleanPointInPolygon, feature, featureCollection, intersect, point } from '@turf/turf';
import { MAX_CAMPAIGN_HOMES } from '@/lib/services/campaignHomeLimits';

export type TerritoryAddressPoint = { id: string; lon: number; lat: number };
export type TerritoryCampaignPart = { boundary: GeoJSON.Polygon; addressCount: number };

/** Cut between distinct source coordinates, preserving holes and excluding empty pieces. */
export function partitionStormCampaigns(boundary: GeoJSON.Polygon, addresses: TerritoryAddressPoint[]): TerritoryCampaignPart[] {
  const unique = [...new Map(addresses.map(address => [address.id, address])).values()];
  if (!unique.length) throw new Error('No campaign addresses were found in this territory.');
  function split(polygon: GeoJSON.Polygon, pins: TerritoryAddressPoint[], depth = 0): TerritoryCampaignPart[] {
    if (pins.length <= MAX_CAMPAIGN_HOMES) return [{ boundary: polygon, addressCount: pins.length }];
    if (depth > 40) throw new Error('This territory could not be divided into campaigns. Draw smaller territories.');
    const bounds = bbox(polygon);
    const axes: ('lon' | 'lat')[] = bounds[2] - bounds[0] >= bounds[3] - bounds[1] ? ['lon', 'lat'] : ['lat', 'lon'];
    for (const axis of axes) {
      const sorted = [...pins].sort((a, b) => a[axis] - b[axis]);
      const target = Math.min(MAX_CAMPAIGN_HOMES, Math.ceil(pins.length / Math.ceil(pins.length / MAX_CAMPAIGN_HOMES)));
      const cuts = sorted.slice(1).flatMap((pin, index) => pin[axis] > sorted[index][axis] ? [index + 1] : []);
      if (!cuts.length) continue;
      const cut = cuts.length ? cuts.reduce((best, candidate) => Math.abs(candidate - target) < Math.abs(best - target) ? candidate : best) : 0;
      const coordinate = (sorted[cut - 1][axis] + sorted[cut][axis]) / 2;
      const boxes: GeoJSON.BBox[] = axis === 'lon'
        ? [[bounds[0], bounds[1], coordinate, bounds[3]], [coordinate, bounds[1], bounds[2], bounds[3]]]
        : [[bounds[0], bounds[1], bounds[2], coordinate], [bounds[0], coordinate, bounds[2], bounds[3]]];
      const parts: TerritoryCampaignPart[] = [];
      for (const box of boxes) {
        const clipped = intersect(featureCollection([feature(polygon), bboxPolygon(box)]));
        if (!clipped) continue;
        const polygons = clipped.geometry.type === 'Polygon' ? [clipped.geometry.coordinates] : clipped.geometry.coordinates;
        for (const coordinates of polygons) {
          const child: GeoJSON.Polygon = { type: 'Polygon', coordinates };
          const contained = pins.filter(pin => booleanPointInPolygon(point([pin.lon, pin.lat]), child));
          if (contained.length) parts.push(...split(child, contained, depth + 1));
        }
      }
      if (parts.reduce((sum, part) => sum + part.addressCount, 0) !== pins.length) throw new Error('Address coverage could not be preserved while splitting this territory.');
      return parts;
    }
    throw new Error('More than 1,000 addresses share the same location. Draw a smaller territory.');
  }
  return split(boundary, unique);
}
