import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { prepareFarmMap } from '../../lib/farms/prepareFarmMap';
async function main() {
  const farmId = process.argv[2];
  const country = process.argv[3];
  const region = process.argv[4];
  if (!/^[a-f0-9-]{36}$/.test(farmId ?? '') || !['CA', 'US'].includes(country) || !/^[A-Z]{2}$/.test(region ?? '')) throw new Error('Use <farm UUID> <CA|US> <region>');
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const campaignId = await prepareFarmMap(db, farmId, country as 'CA' | 'US', region);
  console.log(JSON.stringify({ farmId, campaignId, canonicalMapPrepared: true }));
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
