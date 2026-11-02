import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ExternalMapPointer } from '../ExternalMapPayload';

async function main() {
  const objects = new Map<string, Buffer>();
  const server = createServer((request, response) => {
    const key = request.url!.split('?')[0];
    if (request.method === 'PUT') {
      const chunks: Buffer[] = [];
      request.on('data', chunk => chunks.push(Buffer.from(chunk)));
      request.on('end', () => { objects.set(key, Buffer.concat(chunks)); response.end(); });
    } else if (request.method === 'GET' && objects.has(key)) {
      response.end(objects.get(key));
    } else { response.statusCode = 404; response.end(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    process.env.AWS_ENDPOINT_URL_S3 = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    process.env.AWS_ACCESS_KEY_ID = 'test';
    process.env.AWS_SECRET_ACCESS_KEY = 'test';
    process.env.AWS_REGION = 'us-east-1';
    process.env.AWS_S3_FORCE_PATH_STYLE = 'true';
    const { putExternalMapPayload, readExternalMapPayload } = await import('../ExternalMapPayload');
    const campaign = '11111111-1111-4111-8111-111111111111';
    const payload = { buildings_geojson: { type: 'FeatureCollection', features: [{ id: 'roof' }] }, padding: 'large-map'.repeat(600000) };
    const pointer = await putExternalMapPayload('test-bucket', campaign, payload);
    assert.deepEqual(await readExternalMapPayload(pointer, campaign), payload);
    await assert.rejects(() => readExternalMapPayload(pointer, '22222222-2222-4222-8222-222222222222'), /Invalid external/);
    const { publishCanonicalTileArtifact } = await import('../CanonicalTilePublication');
    const writes: Record<string, unknown>[] = [];
    const query = { eq() { return query; }, async upsert(value: Record<string, unknown>) { writes.push(value); return { error: null }; },
      update(value: Record<string, unknown>) { writes.push(value); return query; }, then(resolve: (value: unknown) => void) { resolve({ error: null }); } };
    const db = { from() { return query; } } as unknown as SupabaseClient;
    const manifest = { asset_signature: 'large-revision', tiles: { geometry_revision: 'geometry' }, records: payload.padding };
    await publishCanonicalTileArtifact(db, { campaign_id: campaign, asset_signature: 'large-revision', canonical_signature: 'canonical',
      bucket: 'test-bucket', bundle: manifest, compact_bundle: manifest });
    assert.equal(writes.length, 2);
    const legacyPointer = writes[0].bundle as ExternalMapPointer;
    const compactPointer = writes[1].compact_bundle as ExternalMapPointer;
    assert.equal(legacyPointer.kind, 'wolfgrid-map-json-gzip-v1');
    assert.equal(compactPointer.kind, 'wolfgrid-map-json-gzip-v1');
    assert.equal((await readExternalMapPayload(compactPointer, campaign) as typeof manifest).records, manifest.records);
    const key = [...objects.keys()].find(value => value.endsWith(`/${pointer.sha256}.json.gz`))!;
    objects.set(key, Buffer.from('corrupt'));
    await assert.rejects(() => readExternalMapPayload(pointer, campaign), /checksum mismatch/);
    console.log('PASS: large external map payload round-trip, campaign isolation and corruption detection');
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
