import {config} from 'dotenv';
import {writeFileSync} from 'node:fs';
import {createAdminClient} from '../lib/supabase/server';
import {WIND_PRODUCT} from '../lib/storm-maps/intelligence/wind-archive-format';
import {recentWindDays} from '../lib/storm-maps/intelligence/storm-browser';
config({path:'.env.local',quiet:true});
async function main(){
 const admin=createAdminClient();
 const {data,error}=await admin.from('storm_archive_assets').select('source_time,captured_at,metadata').eq('provider','xweather').eq('product',WIND_PRODUCT).order('source_time',{ascending:false}).limit(1000);
 if(error)throw Error('Wind verification unavailable.');
 const report={checkedAt:new Date().toISOString(),countries:Object.fromEntries(['CA','US','AU'].map(country=>{const rows=(data??[]).filter(row=>row.metadata.country===country);const indexed=rows.filter(row=>row.metadata.windRegionVersion===1);return[country,{savedHours:new Set(rows.map(row=>row.source_time)).size,indexed:indexed.length,pending:rows.length-indexed.length,days:recentWindDays(indexed)}];}))};
 writeFileSync('docs/storm-intelligence/wind-region-verification-2026-10-24.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));
}
main().catch(()=>{console.error('Wind verification failed.');process.exitCode=1;});
