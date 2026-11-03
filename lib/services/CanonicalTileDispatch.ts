import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import type { SupabaseClient } from '@supabase/supabase-js';

type Dispatch = () => Promise<void>;

/** Wake the existing leased worker only for an already queued, finalized map.
 * This never stages old campaigns or builds tiles inside a map request. */
export async function dispatchCanonicalTileBuild(
  db: SupabaseClient,
  bundle: { campaign_id: string; asset_signature: string; links_status?: string | null },
  dispatch: Dispatch = async () => {
    const client = new LambdaClient({ region: process.env.AWS_REGION || 'us-east-2', maxAttempts: 1 });
    await client.send(new InvokeCommand({
      FunctionName: process.env.CANONICAL_TILE_WORKER_FUNCTION || 'wolfgrid-canonical-tiles',
      InvocationType: 'Event',
      Payload: Buffer.from(JSON.stringify({ source: 'campaign-map-published' })),
    }), { abortSignal: AbortSignal.timeout(3000) });
  }
): Promise<boolean> {
  if (bundle.links_status !== 'ready') return false;
  try {
    const { data: job, error } = await db.from('campaign_map_tile_jobs')
      .select('status').eq('campaign_id', bundle.campaign_id)
      .eq('canonical_signature', bundle.asset_signature).maybeSingle();
    if (error) throw error;
    if (job?.status !== 'queued') return false;
    await dispatch();
    return true;
  } catch (error) {
    // The scheduled worker still owns retries; a wake-up failure must not fail provisioning.
    console.warn('[canonical-tiles] Immediate worker dispatch failed; scheduled retry remains active', {
      campaignId: bundle.campaign_id,
      error: error instanceof Error ? error.name : 'dispatch_failed',
    });
    return false;
  }
}
