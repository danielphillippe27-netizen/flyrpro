import { config } from 'dotenv';
import { gunzipSync } from 'node:zlib';
import { createAdminClient } from '../lib/supabase/server';
import { WIND_PRODUCT, type WindArchiveBundle } from '../lib/storm-maps/intelligence/wind-archive-format';
import { windArchiveStatistics } from '../lib/storm-maps/intelligence/wind-archive-rendering';
config({path:'.env.local',quiet:true});
async function main(){
 const admin=createAdminClient();
 const {data,error}=await admin.from('storm_archive_assets').select('id,bucket,storage_path,metadata').eq('provider','xweather').eq('product',WIND_PRODUCT).order('source_time',{ascending:false}).limit(1000);
 if(error)throw Error('Wind archive index unavailable.');
 const rows=(data??[]).filter(row=>row.metadata.country!=='NZ'&&row.metadata.windRegionVersion!==1);let next=0,completed=0;
 await Promise.all(Array.from({length:3},async()=>{while(next<rows.length){const row=rows[next++];
 const {data:file,error:download}=await admin.storage.from(row.bucket).download(row.storage_path);if(download||!file)throw Error('Saved frame unavailable.');
 const bundle:WindArchiveBundle=JSON.parse(gunzipSync(Buffer.from(await file.arrayBuffer()),{maxOutputLength:80000000}).toString());
 const statistics=await windArchiveStatistics(bundle.numericTiles,bundle.country);
 const {error:update}=await admin.from('storm_archive_assets').update({metadata:{...row.metadata,...statistics,windMaskVersion:2,windRegionVersion:1}}).eq('id',row.id);if(update)throw Error('Wind hour indexing failed.');
 completed++;if(completed%20===0||completed===rows.length)console.log(JSON.stringify({indexed:completed,total:rows.length}));
 }}));
 console.log('Saved wind hours indexed by regional maximum gust.');
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Wind indexing failed.');process.exitCode=1;});
