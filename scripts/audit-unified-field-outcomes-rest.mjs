// Read-only aggregate audit through the project's existing Supabase API connection.
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { writeFile } from 'node:fs/promises';
config({path:'.env.local',quiet:true});
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
async function rows(table,columns){
 const result=[];
 for(let from=0;;from+=1000){
   const {data,error}=await db.from(table).select(columns).order('id').range(from,from+999);
   if(error)throw new Error(`${table}: ${error.code}`);
   result.push(...data);if(data.length<1000)return result;
 }
}
try {
 const [farms,homes,touches,outcomes,sessions]=await Promise.all([
   rows('farms','id,linked_campaign_id'),rows('farm_addresses','id,farm_id,campaign_address_id'),
   rows('farm_touches','id,farm_id,homes_reached'),rows('farm_touch_addresses','id,farm_id,farm_touch_id,farm_address_id,campaign_address_id,status'),
   rows('sessions','id,campaign_id,farm_id,farm_touch_id'),
 ]);
 const counts=new Map(),links=new Map();
 const visits=new Set(['no_answer','delivered','talked','appointment','future_seller','hot_lead']);
 for(const row of outcomes)if(visits.has(row.status))counts.set(row.farm_touch_id,(counts.get(row.farm_touch_id)??0)+1);
 for(const row of homes)if(row.campaign_address_id){const key=`${row.farm_id}:${row.campaign_address_id}`;links.set(key,(links.get(key)??0)+1);}
 const farmCampaigns=new Set(farms.map(f=>f.linked_campaign_id).filter(Boolean));
 const report={auditedAt:new Date().toISOString(),readOnly:true,transport:'Supabase REST',snapshot:'Paginated reads; concurrent changes can affect counts.',
   farms:farms.length,farmsWithoutCampaign:farms.filter(f=>!f.linked_campaign_id).length,
   farmHomes:homes.length,homesWithoutCampaignAddress:homes.filter(h=>!h.campaign_address_id).length,
   ambiguousAddressLinks:[...links.values()].filter(n=>n>1).length,
   farmSessions:sessions.filter(s=>s.farm_id).length,
   farmSessionsMissingTouch:sessions.filter(s=>s.farm_id&&!s.farm_touch_id).length,
   linkedCampaignSessionsWithoutFarmContext:sessions.filter(s=>!s.farm_id&&farmCampaigns.has(s.campaign_id)).length,
   outcomes:outcomes.length,doNotKnockOutcomes:outcomes.filter(o=>o.status==='do_not_knock').length,
   touchTotalsDifferingFromVisitOutcomes:touches.filter(t=>(t.homes_reached??0)!==(counts.get(t.id)??0)).length,
   repairsApplied:0,
 };
 await writeFile('docs/unified-outcomes/live-audit.json',JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report,null,2));
}catch(error){console.error('Read-only API audit failed:',error.message);process.exitCode=1;}
