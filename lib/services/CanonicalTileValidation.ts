import { PMTiles } from 'pmtiles';
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';

/** Validate the actual compiled bytes before publication. Native Mapbox uses
 * signed 16-bit coordinates at extent 8192; valid protobuf alone is insufficient. */
export async function validateCanonicalTileArchive(bytes: Uint8Array, bounds: number[], expected: Record<string, Set<string>>) {
  const archive = new PMTiles({ getKey: () => 'canonical-build-validation', getBytes: async (offset, length) => {
    const data = new Uint8Array(bytes.subarray(offset, offset + length));
    return { data: data.buffer };
  } });
  const header = await archive.getHeader();
  if (header.tileType !== 1 || header.maxZoom !== 18) throw new Error('Unexpected canonical tile format or zoom');
  const seen = new Map<string, Set<string>>();
  let tileCount = 0, candidateCount = 0;
  const tileX = (lon: number, zoom: number) => Math.floor((lon + 180) / 360 * 2 ** zoom);
  const tileY = (lat: number, zoom: number) => Math.floor((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * 2 ** zoom);
  for (let z = header.minZoom; z <= header.maxZoom; z++) {
    const limit = 2 ** z - 1;
    const x0 = Math.max(0, tileX(bounds[0], z) - 1), x1 = Math.min(limit, tileX(bounds[2], z) + 1);
    const y0 = Math.max(0, tileY(bounds[3], z) - 1), y1 = Math.min(limit, tileY(bounds[1], z) + 1);
    candidateCount += (x1 - x0 + 1) * (y1 - y0 + 1);
    if (candidateCount > 100_000) throw new Error('Campaign exceeds the bounded tile validator; split or use a larger worker validation job');
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      const result = await archive.getZxy(z, x, y);
      if (!result) continue;
      tileCount++;
      const tile = new VectorTile(new Pbf(new Uint8Array(result.data)));
      for (const [name, layer] of Object.entries(tile.layers)) {
        if (!expected[name]) throw new Error(`Unexpected tile layer ${name}`);
        if (!seen.has(name)) seen.set(name, new Set());
        for (let i = 0; i < layer.length; i++) {
          const feature = layer.feature(i);
          const id = String(feature.properties.feature_id ?? '');
          if (!id || !expected[name].has(id)) throw new Error(`Unknown canonical identity in ${name}`);
          if (z === header.maxZoom) seen.get(name)!.add(id);
          for (const ring of feature.loadGeometry()) for (const point of ring) {
            if ([point.x, point.y].some((value) => value * 8192 / layer.extent < -32768 || value * 8192 / layer.extent > 32767)) {
              throw new Error(`Native coordinate overflow: ${name} ${z}/${x}/${y}`);
            }
          }
        }
      }
    }
  }
  for (const [layer, ids] of Object.entries(expected)) {
    const missing = [...ids].filter((id) => !seen.get(layer)?.has(id));
    if (missing.length) throw new Error(`${missing.length} canonical features missing from ${layer} at field zoom`);
  }
  return { tileCount, featureCounts: Object.fromEntries([...seen].map(([name, ids]) => [name, ids.size])) };
}
