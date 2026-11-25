import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {createAdminClient} from '@/lib/supabase/server';
import { STORM_COUNTRIES } from '../storm-countries';
import { isXweatherEnabled } from '../xweather-config';
import {xweatherData,type HailArchiveRow} from './provider';
export async function collectWatchedHail(now=new Date()){
 if (!isXweatherEnabled()) return { status: 'paused' };
 const admin=createAdminClient();
 const {data:locations,error}=await admin.from('storm_hail_watch_locations').select('id,country,name,latitude,longitude').eq('enabled',true).in('country',STORM_COUNTRIES);
 if(error)throw Error('Hail watch configuration unavailable.');
 if(!locations?.length)return {status:'waiting_for_locations',coverage:'Location-based hail history, not national swaths.'};
 if(locations.length>50)throw Error('Hail watch request budget exceeded. Configure bounded batches before adding more locations.');
 const window=`hail-watch:${now.toISOString().slice(0,10)}`,{error:claim}=await admin.from('storm_collection_runs').insert({window_key:window});
 if(claim){if(claim.code==='23505')return {status:'already_attempted',window};throw Error('Hail watch ledger unavailable.');}
 const from=new Date(+now-86400000),results:Array<{name:string;country:string;status:string;periods?:number}>=[];
 for(const location of locations){
  try{
   const rows=await xweatherData<HailArchiveRow>(`hail/archive/${location.latitude},${location.longitude}`,{from:from.toISOString(),to:now.toISOString()});
   if(!rows.length||rows.some(row=>!Array.isArray(row.periods)||!row.periods.length))throw Error('Incomplete point history.');
   const bytes=gzipSync(JSON.stringify(rows)),hash=createHash('sha256').update(bytes).digest('hex'),path=`xweather/hail-point-history/${now.toISOString().slice(0,10)}/${hash}.gz`;
   const {error:upload}=await admin.storage.from('storm-archive').upload(path,bytes,{contentType:'application/gzip',upsert:true});if(upload)throw Error('Point history storage failed.');
   const {error:record}=await admin.from('storm_archive_assets').upsert({provider:'xweather',product:`${location.country.toLowerCase()}-hail-point-history`,content_hash:hash,storage_path:path,source_time:now.toISOString(),byte_size:bytes.length,metadata:{country:location.country,watchLocationId:location.id,name:location.name,latitude:location.latitude,longitude:location.longitude,evidence:'modeled-point-measurements',impactGeometry:false,from:from.toISOString(),to:now.toISOString(),coverage:'This monitored point only; not nationwide coverage.'}},{onConflict:'provider,product,content_hash'});if(record)throw Error('Point history record failed.');
   results.push({name:location.name,country:location.country,status:'stored',periods:rows.reduce((n,r)=>n+r.periods.length,0)});
  }catch{results.push({name:location.name,country:location.country,status:'failed'});}
 }
 const status=results.some(r=>r.status==='failed')?'partial':'complete';
 const {error:recordError}=await admin.from('storm_collection_runs').update({status,details:{results,coverage:'Configured U.S. and Canadian watch locations only.'},completed_at:new Date().toISOString()}).eq('window_key',window);if(recordError)throw Error('Hail watch result record failed.');
 return {status,window,results};
}
