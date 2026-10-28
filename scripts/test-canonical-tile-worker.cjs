/** Offline worker integration against a fake Supabase API and a fake compiler.
 * Usage: node scripts/test-canonical-tile-worker.cjs /absolute/path/to/worker.cjs
 * No production credentials, network services or campaign data are used. */
const assert = require('node:assert/strict');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');
const { spawn } = require('node:child_process');

async function runCase(worker, temporary, options) {
  const updates = [];
  let claimed = 0;
  const campaignId = '11111111-1111-4111-8111-111111111111';
  const marker = path.join(temporary, `invoked-${options.name}`);
  const server = http.createServer(async (request, response) => {
    let body = ''; for await (const chunk of request) body += chunk;
    response.setHeader('Content-Type', 'application/json');
    if (request.url.startsWith('/rest/v1/rpc/claim_canonical_campaign_tile_job')) {
      claimed += 1;
      if (claimed > (options.staleThenCurrent ? 2 : 1)) return response.end('[]');
      const signature = options.staleThenCurrent && claimed === 1 ? 'obsolete' : 'expected';
      response.end(JSON.stringify([{ campaign_id: campaignId, canonical_signature: signature, lease_id: 'lease', attempts: options.attempts ?? 1 }]));
    } else if (request.url.startsWith('/rest/v1/campaign_map_bundles')) {
      response.end(JSON.stringify({ asset_signature: options.stale ? 'newer' : 'expected' }));
    } else if (request.url.startsWith('/rest/v1/campaign_map_tile_jobs') && request.method === 'PATCH') {
      updates.push({ body: JSON.parse(body), url: new URL(request.url, 'http://localhost') }); response.statusCode = 204; response.end();
    } else { response.statusCode = 404; response.end('{}'); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const builder = path.join(temporary, 'fake-builder.cjs');
    await fs.writeFile(builder, `const fs=require('node:fs');fs.writeFileSync(process.env.FAKE_MARKER,JSON.stringify(process.argv.slice(2)));process.exit(process.env.FAKE_FAILURE==='1'?1:0);`);
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [worker], { env: { ...process.env,
        NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${server.address().port}`,
        SUPABASE_SERVICE_ROLE_KEY: 'local-test-only', CANONICAL_TILE_BUILDER_PATH: builder,
        FAKE_MARKER: marker, FAKE_FAILURE: options.fail ? '1' : '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = ''; child.stdout.on('data', (chunk) => { output += chunk; }); child.stderr.on('data', (chunk) => { output += chunk; });
      child.on('error', reject); child.on('exit', (code) => resolve({ code, output }));
    });
    assert.equal(result.code, options.fail ? 1 : 0, result.output);
    assert.equal(updates.length, options.staleThenCurrent ? 2 : 1);
    if (options.staleThenCurrent) assert.equal(updates[0].body.status, 'superseded');
    const finalUpdate = updates[updates.length - 1];
    assert.equal(finalUpdate.body.status, options.expected, JSON.stringify(finalUpdate.body));
    assert.equal(updates[0].url.searchParams.get('lease_id'), 'eq.lease', 'Completion must be scoped to the claimed lease');
    const invoked = await fs.readFile(marker, 'utf8').catch(() => null);
    if (options.stale) assert.equal(invoked, null, 'A superseded campaign is never compiled');
    else {
      assert(invoked.includes(`--campaign=${campaignId}`) && invoked.includes('--signature=expected') && invoked.includes('--publish'));
      if (options.fail) assert(finalUpdate.body.last_error?.includes('Compilation failed'));
    }
  } finally { await new Promise((resolve) => server.close(resolve)); }
}

async function main() {
  const worker = process.argv[2]; assert(worker && path.isAbsolute(worker), 'Supply the bundled worker path');
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'wolfgrid-worker-test-'));
  try {
    await runCase(worker, temporary, { name: 'success', expected: 'succeeded' });
    await runCase(worker, temporary, { name: 'superseded', stale: true, expected: 'superseded' });
    await runCase(worker, temporary, { name: 'stale-then-current', staleThenCurrent: true, expected: 'succeeded' });
    await runCase(worker, temporary, { name: 'retry', fail: true, expected: 'queued' });
    await runCase(worker, temporary, { name: 'exhausted', fail: true, attempts: 5, expected: 'failed' });
    console.log('PASS: worker publishes current jobs, skips superseded revisions and handles retry limits');
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
