const { spawn } = require('node:child_process');

/** One invocation claims at most one job; the database lease protects overlap. */
exports.handler = async (_event, context) => {
  const remaining = context.getRemainingTimeInMillis();
  if (remaining < 30_000) throw new Error('Insufficient time to start a tile job');
  const worker = process.env.CANONICAL_TILE_WORKER_PATH || '/var/task/canonical-worker.cjs';
  const timeoutMs = Math.min(remaining - 15_000, 14 * 60_000 + 30_000);
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [worker], { env: { ...process.env,
      CANONICAL_TILE_BUILDER_PATH: process.env.CANONICAL_TILE_BUILDER_PATH || '/var/task/canonical-builder.cjs' },
    stdio: ['ignore', 'inherit', 'inherit'] });
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`Canonical tile worker exited (${code ?? signal})`));
    });
  });
  return { ok: true };
};
