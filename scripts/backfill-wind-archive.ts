import { config } from 'dotenv';
import { collectWindArchive } from '../lib/storm-maps/intelligence/wind-archive-collector';
config({ path: '.env.local', quiet: true });
async function main() {
  const batches = Math.min(200, Math.max(1, Number(process.env.WIND_BACKFILL_BATCHES ?? '100')));
  for (let index = 0; index < batches; index++) {
    const shard = process.env.WIND_BACKFILL_SHARD == null ? undefined : Number(process.env.WIND_BACKFILL_SHARD);
    const result = await collectWindArchive(new Date(), `backfill-${shard ?? 'all'}-${Date.now()}-${index}`, 4, shard);
    console.log(JSON.stringify(result));
    if (!('remainingFrames' in result) || result.remainingFrames === 0 || result.failedFrames > 0 || result.assetsStored === 0) break;
  }
}
main().catch(() => { console.error('Wind archive backfill failed. Inspect the collection ledger.'); process.exitCode = 1; });
