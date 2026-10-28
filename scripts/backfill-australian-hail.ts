import { config } from 'dotenv';
import { collectAustralianHail } from '../lib/storm-maps/intelligence/australian-hail-collector';
config({ path: '.env.local', quiet: true });
async function main() {
  const maximumBatches = Number(process.env.AU_BACKFILL_BATCHES ?? '80');
  for (let index = 0; index < maximumBatches; index++) {
    const result = await collectAustralianHail(new Date(), `backfill-${Date.now()}-${index}`);
    console.log(JSON.stringify(result));
    if (!('remainingFrames' in result) || result.remainingFrames === 0 || ('failedFrames' in result && result.failedFrames > 0)) break;
  }
}
main().catch(() => { console.error('Australian backfill failed; inspect the collection ledger.'); process.exitCode = 1; });
