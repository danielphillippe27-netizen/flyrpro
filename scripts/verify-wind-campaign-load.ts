import {config} from 'dotenv';
import {createAdminClient} from '../lib/supabase/server';
config({path:'.env.local',quiet:true});
async function main(){
 const admin=createAdminClient(),id='dfbc2e18-5f5a-4307-b083-059473e6c53f';
 const [campaign,addresses]=await Promise.all([admin.from('campaigns').select('id,name,storm_context').eq('id',id).single(),admin.from('campaign_addresses').select('id',{count:'exact',head:true}).eq('campaign_id',id)]);
 if(campaign.error||addresses.error)throw Error('Campaign verification query failed.');
 console.log(JSON.stringify({id:campaign.data.id,name:campaign.data.name,addressCount:addresses.count,windEvidence:campaign.data.storm_context?.gustSelection,evidenceKind:campaign.data.storm_context?.evidenceKind}));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
