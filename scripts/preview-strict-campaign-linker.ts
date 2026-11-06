/** Read-only preview. Load credentials with -r dotenv/config; never writes to Supabase. */
import { createClient } from '@supabase/supabase-js';
import { StableLinkerService, type BuildingFeature } from '../lib/services/StableLinkerService';
import { readCurrentCampaignMapBundle, responseFromCampaignMapBundleRow } from '../lib/services/CampaignMapBundlePrebuilder';
import { fetchAllInPages } from '../lib/supabase/fetchAllInPages';

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase credentials are required for read-only preview');
  const supabase = createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const campaignId = process.argv[2];
  if (!campaignId) {
    const result = await supabase.from('campaign_addresses').select('campaign_id,house_number,street_name')
      .ilike('street_name','%tennessee%').in('house_number',['1109','1112','1116','1119']).limit(50);
    if (result.error) throw result.error;
    const ids = [...new Set((result.data ?? []).map(a=>a.campaign_id))];
    const campaigns = ids.length ? await supabase.from('campaigns').select('id,name').in('id',ids) : {data:[]};
    console.log(JSON.stringify({candidateCampaigns:campaigns.data, matchingAddresses:result.data},null,2));
    return;
  }
  const bundle = await readCurrentCampaignMapBundle(supabase,campaignId);
  if (!bundle) throw new Error('Campaign has no current map bundle');
  const source = responseFromCampaignMapBundleRow(bundle);
  const addresses = await fetchAllInPages<Record<string,unknown>>(async(from,to)=>
    await supabase.from('campaign_addresses').select('*').eq('campaign_id',campaignId).order('id').range(from,to));
  const links = await fetchAllInPages<Record<string,unknown>>(async(from,to)=>
    await supabase.from('building_address_links').select('address_id,building_id,match_type,confidence').eq('campaign_id',campaignId).order('address_id').range(from,to));
  const groups = new Map<string,Record<string,unknown>[]>();
  const byAddress = new Map(addresses.map(a=>[a.id,a]));
  for(const link of links) groups.set(String(link.building_id),[...(groups.get(String(link.building_id)) ?? []),link]);
  const suspiciousGroups = [...groups].flatMap(([buildingId,group])=>{
    if(group.length < 2) return [];
    const streets = [...new Set(group.map(l=>String(byAddress.get(l.address_id)?.street_name ?? '').toLowerCase()))];
    return streets.length > 1 ? [{buildingId,streets,links:group.map(l=>({addressId:l.address_id,formatted:byAddress.get(l.address_id)?.formatted,matchType:l.match_type}))}] : [];
  });
  const simulate = process.argv.includes('--simulate-unlinked');
  // A fresh-link simulation clears assignments only in these local copies. It
  // never updates the campaign and still protects manually sourced addresses.
  const localAddresses = addresses.map(a=>({...a,...(simulate ? {building_id:null,building_gers_id:null,match_source:null} : {})}));
  const readOnlyClient = {from(table:string) {
    const rows = table === 'campaign_addresses' ? localAddresses : table === 'building_address_links' ? (simulate ? [] : links) : [];
    const query = {select:()=>query,eq:()=>query,order:()=>query,range:async(from:number,to:number)=>({data:rows.slice(from,to+1),error:null})};
    return query;
  }};
  const summary = await new StableLinkerService(readOnlyClient as never).runSpatialJoin(campaignId,
    source.buildings as unknown as {features:BuildingFeature[]}, 'preview', {dryRun:true,parcelsGeoJSON:source.parcels as never});
  const {preview,...metrics}=summary;
  const focus = (id:string)=>/tennessee|parks? st/i.test(String(byAddress.get(id)?.formatted ?? byAddress.get(id)?.street_name ?? ''));
  console.log(JSON.stringify({campaignId,mode:simulate?'fresh_link_simulation_in_memory':'additive_preview',metrics,
    existingCrossStreetGroups:suspiciousGroups.map(group=>({...group,proposedAddresses:preview?.proposedLinks.filter(l=>l.buildingId===group.buildingId).map(l=>({addressId:l.addressId,formatted:byAddress.get(l.addressId)?.formatted})) ?? []})),
    focusedProposals:preview?.proposedLinks.filter(l=>focus(l.addressId)),
    focusedUnresolved:preview?.unresolvedAddressIds.filter(focus).map(id=>({id,formatted:byAddress.get(id)?.formatted})),
  },null,2));
}
main().catch(error=>{console.error(error instanceof Error ? error.message : String(error));process.exitCode=1;});
