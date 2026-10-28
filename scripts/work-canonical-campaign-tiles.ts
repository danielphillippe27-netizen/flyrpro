/** Run in the existing worker environment with tippecanoe, storage and service credentials.
 * Default: claim one job. --drain processes ready jobs until the queue is empty.
 * No credentials or production operations are required to build from a local fixture.
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let failures = 0;
  let skippedSuperseded: boolean;
  do {
    skippedSuperseded = false;
    const { data, error } = await db.rpc('claim_canonical_campaign_tile_job');
    if (error) throw error;
    const job = data?.[0];
    if (!job) break;
    const finish = async (values: Record<string, unknown>) => {
      const result = await db.from('campaign_map_tile_jobs').update({ ...values, lease_until: null, updated_at: new Date().toISOString() })
        .eq('campaign_id', job.campaign_id).eq('canonical_signature', job.canonical_signature).eq('lease_id', job.lease_id);
      if (result.error) throw result.error;
    };
    const directory = await mkdtemp(path.join(tmpdir(), 'wolfgrid-tile-job-'));
    try {
      const { data: current, error: readError } = await db.from('campaign_map_bundles').select('asset_signature')
        .eq('campaign_id', job.campaign_id).eq('is_current', true).maybeSingle();
      if (readError) throw readError;
      if (current?.asset_signature !== job.canonical_signature) {
        await finish({ status: 'superseded' });
        // Stale revisions are cheap to discard and must not consume a full
        // scheduler interval before the current revision can be built.
        skippedSuperseded = true;
        continue;
      }
      await new Promise<void>((resolve, reject) => {
        // Carry the TypeScript loader used to start this worker into the child.
        // A bare --import tsx fails when the existing npx-based scripts use a
        // cached runner rather than a project-local tsx installation.
        const builder = process.env.CANONICAL_TILE_BUILDER_PATH
          || path.join(path.dirname(path.resolve(process.argv[1])), 'build-canonical-campaign-tiles.ts');
        const loaderArgs = builder.endsWith('.ts') ? process.execArgv : [];
        const child = spawn(process.execPath, [...loaderArgs, builder,
          `--campaign=${job.campaign_id}`, `--signature=${job.canonical_signature}`, `--output=${directory}`, '--publish'],
        { stdio: ['ignore', 'inherit', 'pipe'], timeout: 14 * 60_000 });
        let errors = '';
        child.stderr.on('data', (chunk) => { errors = (errors + chunk).slice(-2000); });
        child.on('error', reject);
        child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`Compilation failed (${code}): ${errors}`)));
      });
      await finish({ status: 'succeeded', last_error: null });
    } catch (error) {
      failures += 1;
      await finish({ status: job.attempts >= 5 ? 'failed' : 'queued',
        available_at: new Date(Date.now() + Math.min(3600, 30 * 2 ** job.attempts) * 1000).toISOString(),
        last_error: error instanceof Error ? error.message.slice(0, 2000) : 'Unknown tile build failure' });
      console.error('Canonical tile job failed', { campaignId: job.campaign_id, attempt: job.attempts });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  } while (skippedSuperseded || process.argv.includes('--drain'));
  // Schedulers need a non-zero result even though the failed job has been
  // safely returned to the retry queue (or marked failed after its limit).
  if (failures) process.exitCode = 1;
}
main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
