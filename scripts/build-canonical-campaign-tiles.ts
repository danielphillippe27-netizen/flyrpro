import { publishCanonicalTileArtifact } from '../lib/services/CanonicalTilePublication';
/** Build only from a finalized canonical bundle. Never called synchronously by a map GET. */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { prepareCanonicalTiles, stableTileHash } from '../lib/services/CanonicalTilePreparation';
import { responseFromCampaignMapBundleRow, readCurrentCampaignMapBundle } from '../lib/services/CampaignMapBundlePrebuilder';
import type { CanonicalTileBundle } from '../lib/map/canonicalTileBundle';
import { validateCanonicalTileArchive } from '../lib/services/CanonicalTileValidation';
import { CanonicalGeometryPack, canonicalGeometryEntries, encodeCanonicalGeometryPack } from '../lib/services/CanonicalGeometryPack';
import { makeCanonicalCompactBundle } from '../lib/services/CanonicalCompactBundle';

async function main() {
  const args = process.argv.slice(2);
  const flag = (name: string) => args.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
  const input = flag('input');
  const campaignId = flag('campaign');
  if (!input && !campaignId) throw new Error('Use --campaign=<uuid> or --input=<canonical-bundle.json>');
  const publish = args.includes('--publish');
  if (publish && !campaignId) throw new Error('Publishing requires a campaign ID');
  const db = campaignId ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) : null;
  const current = db ? await readCurrentCampaignMapBundle(db, campaignId!) : null;
  if (db && !current) throw new Error('A finalized canonical bundle is required before building tiles');
  const bundle = input ? JSON.parse(await readFile(input, 'utf8'))
    : responseFromCampaignMapBundleRow(current!);
  if (campaignId && bundle.campaign_id !== campaignId) throw new Error('Campaign identity mismatch');
  if (flag('signature') && flag('signature') !== bundle.asset_signature) throw new Error('Canonical revision changed before build');
  const prepared = prepareCanonicalTiles(bundle);
  const directory = flag('output') ?? await mkdtemp(path.join(tmpdir(), 'wolfgrid-canonical-tiles-'));
  await mkdir(directory, { recursive: true });
  const archivePath = path.join(directory, 'campaign.pmtiles');
  const commandArgs = ['--force', '--output', archivePath, '--minimum-zoom', '10', '--maximum-zoom', '18',
    // Keep a generous buffer for rounded extrusions at seams, but clip geometry
    // beyond it. Unclipped large parcels overflow Mapbox Native's coordinate range.
    '--buffer', '127', '--no-feature-limit', '--no-tile-size-limit', '--no-tiny-polygon-reduction'];
  for (const [layer, collection] of Object.entries(prepared.collections)) {
    if (!collection.features.length) continue;
    const file = path.join(directory, `${layer}.ndjson`);
    await writeFile(file, collection.features.map((feature) => JSON.stringify({
      ...feature, tippecanoe: { minzoom: prepared.layers[layer].minzoom },
    })).join('\n'));
    commandArgs.push('--named-layer', `${layer}:${file}`);
  }
  await new Promise<void>((resolve, reject) => {
    const process = spawn(globalThis.process.env.TIPPECANOE_BIN || 'tippecanoe', commandArgs, { stdio: ['ignore', 'ignore', 'pipe'] });
    let errors = '';
    process.stderr.on('data', (chunk) => { errors = (errors + chunk).slice(-5000); });
    process.on('error', reject);
    process.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`Tile compiler failed (${code}): ${errors}`)));
  });
  const bytes = await readFile(archivePath);
  const validation = await validateCanonicalTileArchive(bytes, prepared.bounds, Object.fromEntries(
    Object.entries(prepared.collections).map(([name, collection]) => [name, new Set(collection.features.map((feature) => String(feature.properties?.feature_id)))])));
  const geometryEntries = canonicalGeometryEntries(prepared.collections, bundle.roads, bundle.building_units, bundle.addresses);
  const geometryBytes = encodeCanonicalGeometryPack(geometryEntries);
  const geometryPack = new CanonicalGeometryPack(geometryBytes);
  // Validate each independently compressed record before exposing the package.
  for (const id of geometryPack.ids()) geometryPack.get(id);
  const geometrySha256 = createHash('sha256').update(geometryBytes).digest('hex');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const canonicalSignature = String(bundle.asset_signature);
  // The URL identifies bytes, not just input geometry: compiler upgrades must never
  // overwrite an archive that a phone has already checksummed and cached.
  // The revision addresses both artifacts: changing exact shapes or roads must
  // not make an existing /geometry URL return different bytes.
  const geometryRevision = stableTileHash({ geometry: prepared.geometryRevision, sha256, geometrySha256 });
  const assetSignature = stableTileHash({ schema: 'tiles-v2', canonicalSignature, geometryRevision, geometrySha256 });
  const manifest: CanonicalTileBundle = {
    schema: 'tiles-v2', campaign_id: bundle.campaign_id, asset_signature: assetSignature,
    canonical_signature: canonicalSignature, source_version: bundle.source_version,
    records: prepared.records,
    tiles: { geometry_revision: geometryRevision, tile_url_template: '', archive_url: '', sha256,
      byte_length: bytes.length, bounds: prepared.bounds, layers: prepared.layers,
      geometry_pack: { url: '', sha256: geometrySha256, byte_length: geometryBytes.length, count: geometryPack.size } },
    links: bundle.links ?? [], address_orphans: bundle.address_orphans ?? [], building_orphans: bundle.building_orphans ?? [],
    building_units: bundle.building_units ?? [], counts: bundle.counts ?? {},
    display_mode_hint: bundle.display_mode_hint ?? (prepared.records.buildings.length ? 'buildings' : 'addresses'),
    links_status: bundle.links_status ?? 'ready', reconciliation: bundle.reconciliation ?? {},
    built_at: bundle.built_at ?? null, expires_at: bundle.expires_at ?? null,
    updated_at: bundle.updated_at ?? null, layer_fetched_at: bundle.layer_fetched_at ?? {},
    reconciliation_report: bundle.reconciliation_report ?? {}, roads: bundle.roads ?? { type: 'FeatureCollection', features: [] },
  };
  const compactBundle = makeCanonicalCompactBundle(manifest);
  await writeFile(path.join(directory, 'bundle-v2.json'), JSON.stringify(manifest));
  await writeFile(path.join(directory, 'bundle-v3.json'), JSON.stringify(compactBundle));
  await writeFile(path.join(directory, 'canonical-geometry.wgp'), geometryBytes);
  await writeFile(path.join(directory, 'canonical-details.json.gz'), gzipSync(JSON.stringify(bundle)));
  if (publish && db) {
    const { data: snapshot, error: snapshotError } = await db.from('campaign_snapshots').select('bucket').eq('campaign_id', campaignId!).maybeSingle();
    if (snapshotError || !snapshot?.bucket) throw new Error('Campaign storage bucket unavailable');
    const prefix = `campaign-tiles/${campaignId}/${geometryRevision}`;
    const archiveKey = `${prefix}/campaign.pmtiles`;
    const detailsKey = `${prefix}/${canonicalSignature}.json.gz`;
    const geometryKey = `${prefix}/${canonicalSignature}-${geometrySha256}.wgp`;
    const storage = new S3Client({ region: process.env.AWS_REGION || 'us-east-2' });
    await storage.send(new PutObjectCommand({ Bucket: snapshot.bucket, Key: archiveKey, Body: bytes,
      ContentType: 'application/vnd.pmtiles', CacheControl: 'private, max-age=31536000, immutable' }));
    await storage.send(new PutObjectCommand({ Bucket: snapshot.bucket, Key: detailsKey, Body: gzipSync(JSON.stringify(bundle)),
      ContentType: 'application/gzip', CacheControl: 'private, max-age=31536000, immutable' }));
    await storage.send(new PutObjectCommand({ Bucket: snapshot.bucket, Key: geometryKey, Body: geometryBytes,
      ContentType: 'application/octet-stream', CacheControl: 'private, max-age=31536000, immutable' }));
    // Publish the two manifests separately; large farms can exceed the gateway
    // request limit when both are sent in one body. Current-signature reads
    // still prevent an older build from replacing a newer map revision.
    await publishCanonicalTileArtifact(db, {
      campaign_id: campaignId, asset_signature: assetSignature, canonical_signature: canonicalSignature,
      geometry_revision: geometryRevision, bucket: snapshot.bucket, archive_key: archiveKey,
      details_key: detailsKey, geometry_key: geometryKey, sha256, byte_length: bytes.length, bundle: manifest, compact_bundle: compactBundle,
    });
  }
  console.log(JSON.stringify({ directory, campaignId: bundle.campaign_id, geometryRevision,
    validation,
    archiveBytes: bytes.length, geometryBytes: geometryBytes.length, canonicalBytes: Buffer.byteLength(JSON.stringify(bundle)),
    bundleBytes: Buffer.byteLength(JSON.stringify(manifest)), published: publish,
    counts: Object.fromEntries(Object.entries(prepared.records).map(([key, value]) => [key, value.length])),
  }));
}
main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
