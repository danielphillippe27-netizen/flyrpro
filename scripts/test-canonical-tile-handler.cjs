/** Validate Lambda launch behavior using a local fake worker. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { handler } = require('../ops/canonical-tiles/handler.cjs');

async function main() {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'wolfgrid-handler-test-'));
  try {
    const worker = path.join(temporary, 'worker.cjs');
    const marker = path.join(temporary, 'marker');
    await fs.writeFile(worker, `require('node:fs').writeFileSync(process.env.FAKE_MARKER,process.env.CANONICAL_TILE_BUILDER_PATH);process.exit(process.env.FAKE_FAILURE==='1'?1:0);`);
    process.env.CANONICAL_TILE_WORKER_PATH = worker;
    delete process.env.CANONICAL_TILE_BUILDER_PATH;
    process.env.FAKE_MARKER = marker;
    process.env.FAKE_FAILURE = '0';
    assert.deepEqual(await handler({}, { getRemainingTimeInMillis: () => 60_000 }), { ok: true });
    assert.equal(await fs.readFile(marker, 'utf8'), '/var/task/canonical-builder.cjs');
    process.env.FAKE_FAILURE = '1';
    await assert.rejects(handler({}, { getRemainingTimeInMillis: () => 60_000 }), /worker exited/);
    await assert.rejects(handler({}, { getRemainingTimeInMillis: () => 10_000 }), /Insufficient time/);
    console.log('PASS: worker handler starts correctly and reports failures and insufficient runtime');
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
