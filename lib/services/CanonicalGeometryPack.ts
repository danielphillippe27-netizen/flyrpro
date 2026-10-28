import { gzipSync, gunzipSync } from 'node:zlib';
import * as wkx from 'wkx';
import { canonicalFeatureId } from '@/lib/map/canonicalTileBundle';

/** Exact field geometry, independently of clipped or simplified vector tiles.
 *
 * WGP1 is a sequence of independently gzip-compressed OGC WKB records. All
 * integers are little-endian: magic (4 bytes), record count (u32), followed by
 * id length (u16), UTF-8 id, payload length (u32), and compressed WKB. IDs are
 * the canonical feature identifiers, not IDs assigned to individual tiles.
 * The exact shapes remain available to offline field tools; they are not used
 * as a bulk GeoJSON rendering source.
 */
const MAGIC = Buffer.from('WGP1');
const MAX_RECORD_BYTES = 64 * 1024 * 1024;

export type CanonicalGeometryEntry = { id: string; geometry: GeoJSON.Geometry };

/** Preserve exact canonical shapes, including unit and road geometry, independently
 * of the vector-tile compiler's clipping and simplification. Road ordinals are
 * scoped to the immutable canonical bundle revision. */
export function canonicalGeometryEntries(
  collections: Record<string, GeoJSON.FeatureCollection>, roads: unknown, units?: unknown, originalAddresses?: unknown
): CanonicalGeometryEntry[] {
  const entries: CanonicalGeometryEntry[] = [];
  for (const layer of ['buildings', 'addresses', 'parcels']) {
    for (const feature of collections[layer]?.features ?? []) {
      const rawId = feature.properties?.feature_id;
      if ((typeof rawId !== 'string' && typeof rawId !== 'number') || !String(rawId).trim() || !feature.geometry) {
        throw new Error(`Missing exact geometry identity in ${layer}`);
      }
      entries.push({ id: String(rawId), geometry: feature.geometry });
    }
  }
  if (Array.isArray(units)) for (const unit of units) {
    if (!unit || typeof unit !== 'object' || !unit.unit_geometry) continue;
    if ((typeof unit.id !== 'string' && typeof unit.id !== 'number') || !String(unit.id).trim()) {
      throw new Error('Missing exact unit geometry identity');
    }
    entries.push({ id: `unit:${unit.id}`, geometry: unit.unit_geometry as GeoJSON.Geometry });
  }
  const addressFeatures = (originalAddresses as GeoJSON.FeatureCollection | null)?.features;
  if (Array.isArray(addressFeatures)) for (const feature of addressFeatures) {
    const source = feature.properties?.source_geometry;
    if (!source) continue;
    const rawId = [feature.properties?.address_id, feature.properties?.id, feature.id]
      .find((value) => (typeof value === 'string' || typeof value === 'number') && String(value).trim());
    if ((typeof rawId !== 'string' && typeof rawId !== 'number') || !String(rawId).trim() || typeof source !== 'object') {
      throw new Error('Invalid original address geometry');
    }
    entries.push({ id: `source:${canonicalFeatureId('address', String(rawId))}`, geometry: source as GeoJSON.Geometry });
  }
  const features = (roads as GeoJSON.FeatureCollection | null)?.features;
  if (Array.isArray(features)) features.forEach((feature, index) => {
    if (feature.geometry) entries.push({ id: `road:${index}`, geometry: feature.geometry });
  });
  return entries;
}

export function encodeCanonicalGeometryPack(entries: CanonicalGeometryEntry[]): Buffer {
  const sorted = [...entries].sort((a, b) => a.id.localeCompare(b.id));
  const header = Buffer.alloc(8);
  MAGIC.copy(header);
  header.writeUInt32LE(sorted.length, 4);
  const chunks: Buffer[] = [header];
  const seen = new Set<string>();
  for (const { id, geometry } of sorted) {
    if (!id || seen.has(id)) throw new Error(`Duplicate or empty geometry identity: ${id}`);
    seen.add(id);
    const idBytes = Buffer.from(id, 'utf8');
    if (idBytes.length > 0xffff) throw new Error('Geometry identity is too long');
    // WGP1 stores longitude/latitude WKB and therefore assumes WGS84. Never
    // silently discard a different coordinate reference system.
    const crs = (geometry as GeoJSON.Geometry & { crs?: { properties?: { name?: string } } }).crs;
    const crsName = crs?.properties?.name;
    if (crs && (typeof crsName !== 'string' || !/^(?:EPSG:4326|CRS:84|urn:ogc:def:crs:OGC:1\.3:CRS84)$/i.test(crsName))) {
      throw new Error(`Unsupported geometry coordinate system: ${id}`);
    }
    const wkb = wkx.Geometry.parseGeoJSON(geometry).toWkb();
    if (wkb.length > MAX_RECORD_BYTES) throw new Error(`Geometry is too large: ${id}`);
    const payload = gzipSync(wkb);
    const idLength = Buffer.alloc(2); idLength.writeUInt16LE(idBytes.length);
    const payloadLength = Buffer.alloc(4); payloadLength.writeUInt32LE(payload.length);
    chunks.push(idLength, idBytes, payloadLength, payload);
  }
  return Buffer.concat(chunks);
}

/** Index once, then inflate only the shape requested by a field operation. */
export class CanonicalGeometryPack {
  private readonly entries = new Map<string, { offset: number; length: number }>();

  constructor(private readonly bytes: Buffer) {
    if (bytes.length < 8 || !bytes.subarray(0, 4).equals(MAGIC)) throw new Error('Invalid geometry pack header');
    const count = bytes.readUInt32LE(4);
    // Each entry needs at least an ID length, one ID byte and a payload length.
    if (count > Math.floor((bytes.length - 8) / 7)) throw new Error('Invalid geometry pack count');
    let offset = 8;
    for (let i = 0; i < count; i++) {
      if (offset + 2 > bytes.length) throw new Error('Truncated geometry identity');
      const idLength = bytes.readUInt16LE(offset); offset += 2;
      if (!idLength || offset + idLength + 4 > bytes.length) throw new Error('Invalid geometry identity');
      const idBytes = bytes.subarray(offset, offset + idLength);
      const id = idBytes.toString('utf8'); offset += idLength;
      if (!Buffer.from(id, 'utf8').equals(idBytes)) throw new Error('Invalid geometry identity encoding');
      const length = bytes.readUInt32LE(offset); offset += 4;
      if (!length || offset + length > bytes.length || this.entries.has(id)) throw new Error('Invalid geometry record');
      this.entries.set(id, { offset, length });
      offset += length;
    }
    if (offset !== bytes.length) throw new Error('Unexpected bytes after geometry pack');
  }

  get size(): number { return this.entries.size; }
  ids(): IterableIterator<string> { return this.entries.keys(); }

  get(id: string): Buffer | undefined {
    const entry = this.entries.get(id);
    if (!entry) return undefined;
    const wkb = gunzipSync(this.bytes.subarray(entry.offset, entry.offset + entry.length), { maxOutputLength: MAX_RECORD_BYTES });
    // A corrupt WKB record must not be mistaken for a usable offline shape.
    wkx.Geometry.parse(wkb);
    return wkb;
  }
}
