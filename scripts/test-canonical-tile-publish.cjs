/** Full worker + compiler + publication test using only synthetic data and a local fake API/S3.
 * Usage: node scripts/test-canonical-tile-publish.cjs /absolute/worker.cjs /absolute/builder.cjs */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

async function main() {
  const [worker, builder] = process.argv.slice(2);
  assert(worker && builder && path.isAbsolute(worker) && path.isAbsolute(builder), 'Supply bundled worker and builder paths');
  const campaignId = '11111111-1111-4111-8111-111111111111';
  const addressId = '22222222-2222-4222-8222-222222222222';
  const polygon = { type: 'Polygon', coordinates: [[[-79, 43], [-78.9999, 43], [-78.9999, 43.0001], [-79, 43.0001], [-79, 43]]] };
  const point = { type: 'Point', coordinates: [-78.99995, 43.00005] };
  const feature = (geometry, properties) => ({ type: 'Feature', geometry, properties });
  const collection = (features) => ({ type: 'FeatureCollection', features });
  const row = { campaign_id: campaignId, asset_signature: 'test-revision', source_version: '1', is_current: true,
    addresses_geojson: collection([feature(point, { id: addressId, address_id: addressId, source_geometry: point })]),
    buildings_geojson: collection([feature(polygon, { id: 'building-1', building_id: 'building-1', address_id: addressId })]),
    parcels_geojson: collection([feature(polygon, { id: 'parcel-1', parcel_id: 'parcel-1', address_ids: [addressId] })]),
    roads_geojson: collection([]), links: [{ building_id: 'building-1', address_id: addressId, confidence: 1 }],
    address_orphans: [], building_orphans: [], building_units: [], counts: {}, reconciliation: {}, reconciliation_report: {} };
  const objects = new Map(); const updates = []; let artifact; let unexpected;
  const server = http.createServer(async (request, response) => {
    try {
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      const url = new URL(request.url, 'http://localhost');
      response.setHeader('Content-Type', 'application/json');
      if (url.pathname === '/rest/v1/rpc/claim_canonical_campaign_tile_job') {
        response.end(JSON.stringify([{ campaign_id: campaignId, canonical_signature: row.asset_signature, lease_id: 'local-lease', attempts: 1 }]));
      } else if (url.pathname === '/rest/v1/campaign_map_bundles' && request.method === 'GET') {
        response.end(JSON.stringify(row));
      } else if (url.pathname === '/rest/v1/campaign_snapshots' && request.method === 'GET') {
        response.end(JSON.stringify({ bucket: 'local-test-bucket' }));
      } else if (url.pathname === '/rest/v1/campaign_map_tile_artifacts' && request.method === 'POST') {
        artifact = JSON.parse(body); assert.equal(artifact.compact_bundle, undefined, 'Do not send both large manifests in one request'); response.statusCode = 204; response.end();
      } else if (url.pathname === '/rest/v1/campaign_map_tile_artifacts' && request.method === 'PATCH') {
        const patch = JSON.parse(body); assert.deepEqual(Object.keys(patch), ['compact_bundle']);
        assert.equal(url.searchParams.get('asset_signature'), `eq.${artifact.asset_signature}`);
        artifact = { ...artifact, ...patch }; response.statusCode = 204; response.end();
      } else if (url.pathname === '/rest/v1/campaign_map_tile_jobs' && request.method === 'PATCH') {
        updates.push({ body: JSON.parse(body), lease: url.searchParams.get('lease_id') }); response.statusCode = 204; response.end();
      } else if (url.pathname.startsWith('/local-test-bucket/') && request.method === 'PUT') {
        objects.set(decodeURIComponent(url.pathname.slice('/local-test-bucket/'.length)), body); response.statusCode = 200; response.end();
      } else {
        unexpected = `${request.method} ${url.pathname}`; response.statusCode = 404; response.end('{}');
      }
    } catch (error) { unexpected = String(error); response.statusCode = 500; response.end('{}'); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'wolfgrid-tile-publish-test-'));
  try {
    const endpoint = `http://127.0.0.1:${server.address().port}`;
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [worker], { cwd: temporary, env: {
        PATH: process.env.PATH, NEXT_PUBLIC_SUPABASE_URL: endpoint, SUPABASE_SERVICE_ROLE_KEY: 'local-test-only',
        AWS_ACCESS_KEY_ID: 'local-test', AWS_SECRET_ACCESS_KEY: 'local-test', AWS_REGION: 'us-east-2',
        AWS_EC2_METADATA_DISABLED: 'true', AWS_ENDPOINT_URL_S3: endpoint, CANONICAL_TILE_BUILDER_PATH: builder,
      }, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = ''; child.stdout.on('data', (chunk) => { output += chunk; }); child.stderr.on('data', (chunk) => { output += chunk; });
      child.on('error', reject); child.on('exit', (code) => resolve({ code, output }));
    });
    assert.equal(result.code, 0, result.output); assert.equal(unexpected, undefined);
    assert.equal(updates.length, 1); assert.equal(updates[0].body.status, 'succeeded'); assert.equal(updates[0].lease, 'eq.local-lease');
    assert(artifact && artifact.canonical_signature === row.asset_signature);
    assert.equal(artifact.compact_bundle.schema, 'tiles-v3');
    assert.equal(artifact.compact_bundle.records.addresses[0].id, addressId);
    for (const key of [artifact.archive_key, artifact.details_key, artifact.geometry_key]) assert(objects.has(key), `Missing uploaded artifact ${key}`);
    assert.equal(crypto.createHash('sha256').update(objects.get(artifact.archive_key)).digest('hex'), artifact.sha256);
    assert.equal(crypto.createHash('sha256').update(objects.get(artifact.geometry_key)).digest('hex'), artifact.compact_bundle.tiles.geometry_pack.sha256);
    assert.equal(objects.get(artifact.geometry_key).subarray(0, 4).toString(), 'WGP1');
    assert.equal(objects.get(artifact.geometry_key).readUInt32LE(4), 4);
    console.log('PASS: synthetic worker built, validated and published matching tiles, exact shapes and compact field data to local fake services');
  } finally { await new Promise((resolve) => server.close(resolve)); await fs.rm(temporary, { recursive: true, force: true }); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
