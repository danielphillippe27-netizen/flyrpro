/** Build a self-contained worker image context. Never includes credentials or campaign data.
 * Usage: node scripts/package-canonical-tile-worker.cjs /absolute/new-directory */
const fs = require('node:fs/promises');
const path = require('node:path');
const { build } = require('esbuild');

async function main() {
  const output = process.argv[2];
  if (!output || !path.isAbsolute(output)) throw new Error('Supply an absolute new output directory');
  // Avoid overwriting an existing package or any unrelated files.
  await fs.mkdir(output);
  try {
    const common = { bundle: true, platform: 'node', format: 'cjs', target: 'node22', logLevel: 'warning' };
    await build({ ...common, entryPoints: ['scripts/build-canonical-campaign-tiles.ts'], outfile: path.join(output, 'canonical-builder.cjs') });
    await build({ ...common, entryPoints: ['scripts/work-canonical-campaign-tiles.ts'], outfile: path.join(output, 'canonical-worker.cjs') });
    await fs.copyFile('ops/canonical-tiles/handler.cjs', path.join(output, 'canonical-handler.cjs'));
    await fs.copyFile('ops/canonical-tiles/Dockerfile', path.join(output, 'Dockerfile'));
    console.log(`Built worker package in ${output}`);
  } catch (error) {
    await fs.rm(output, { recursive: true, force: true });
    throw error;
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
