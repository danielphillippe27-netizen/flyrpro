import { createClient } from '@supabase/supabase-js';
import {
  readCurrentCampaignMapBundle,
  responseFromCampaignMapBundleRow,
} from '../lib/services/CampaignMapBundlePrebuilder';
import {
  CampaignMapReconciliationService,
  MAP_RECONCILIATION_ALGORITHM_VERSION,
} from '../lib/services/CampaignMapReconciliationService';

const campaignId = process.env.RECONCILIATION_CAMPAIGN_ID;
if (!campaignId) throw new Error('RECONCILIATION_CAMPAIGN_ID is required');
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Supabase production credentials are required');
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

async function main(): Promise<void> {
  const beforeRow = await readCurrentCampaignMapBundle(supabase, campaignId);
  if (!beforeRow) throw new Error('Campaign has no canonical map bundle');
  const before = responseFromCampaignMapBundleRow(beforeRow);
  const service = new CampaignMapReconciliationService(supabase);
  const run = await service.enqueue(campaignId, beforeRow.asset_signature);
  if (!run) throw new Error('Reconciliation is disabled for this campaign');
  await service.processRun(run);

  const afterRow = await readCurrentCampaignMapBundle(supabase, campaignId);
  if (!afterRow) throw new Error('Campaign bundle disappeared after reconciliation');
  const after = responseFromCampaignMapBundleRow(afterRow);
  console.log(JSON.stringify({
    campaign_id: campaignId,
    algorithm_version: MAP_RECONCILIATION_ALGORITHM_VERSION,
    run_id: run.id,
    mode: run.mode,
    before: {
      links: Array.isArray(before.links) ? before.links.length : 0,
      address_orphans: Array.isArray(before.address_orphans) ? before.address_orphans.length : 0,
      building_orphans: Array.isArray(before.building_orphans) ? before.building_orphans.length : 0,
    },
    after: {
      links: Array.isArray(after.links) ? after.links.length : 0,
      address_orphans: Array.isArray(after.address_orphans) ? after.address_orphans.length : 0,
      building_orphans: Array.isArray(after.building_orphans) ? after.building_orphans.length : 0,
      report: after.reconciliation_report,
      asset_signature: after.asset_signature,
    },
  }, null, 2));
}

void main();
