import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {parse as parseCsv} from 'csv-parse/sync';
import {createAdminClient} from '@/lib/supabase/server';
import {safeCanadaNext} from './country-format';
export async function collectCountryArchive(now=new Date(),includeHistory=false){
 const admin=createAdminClient(),window=`countries:${now.toISOString().slice(0,13)}:${Math.floor(now.getUTCMinutes()/10)}`;
 const {error:claim}=await admin.from('storm_collection_runs').insert({window_key:window});
 if(claim){if(claim.code==='23505')return {status:'already_attempted',window};throw Error('Country collection ledger unavailable.');}
 const details:Record<string,unknown>={},failures:string[]=[];
 async function fetchText(url:string){const response=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(25000)});if(!response.ok)throw Error('Public source unavailable.');const text=await response.text();if(text.length>8_000_000)throw Error('Source response too large.');return text;}
 async function store(provider:string,product:string,body:string,time:Date,metadata:Record<string,unknown>){
  const bytes=gzipSync(body),hash=createHash('sha256').update(bytes).digest('hex'),path=`${provider}/${product}/${time.toISOString().slice(0,10)}/${hash}.gz`;
  const {data:existing,error:readError}=await admin.from('storm_archive_assets').select('id').eq('provider',provider).eq('product',product).eq('content_hash',hash).maybeSingle();
  if(readError)throw Error('Archive lookup failed.');if(existing)return 'unchanged';
  const {error:upload}=await admin.storage.from('storm-archive').upload(path,bytes,{contentType:'application/gzip',upsert:true});if(upload)throw Error('Archive upload failed.');
  const {error}=await admin.from('storm_archive_assets').upsert({provider,product,content_hash:hash,storage_path:path,source_time:time.toISOString(),byte_size:bytes.length,metadata},{onConflict:'provider,product,content_hash'});if(error)throw Error('Archive record failed.');return 'stored';
 }
 try{
   let url='https://api.weather.gc.ca/collections/weather-alerts/items?f=json&limit=1000';const features:GeoJSON.Feature[]=[];let pages=0;
   while(url){if(!safeCanadaNext(url))throw Error('Invalid Canadian pagination link.');const body=JSON.parse(await fetchText(url));if(body.type!=='FeatureCollection'||!Array.isArray(body.features))throw Error('Invalid Canadian alert feed.');features.push(...body.features);const next=body.links?.find((link:{rel:string;href:string})=>link.rel==='next')?.href??'';if(++pages>=10&&next)throw Error('Canadian pagination limit exceeded.');url=next;}
   const status=await store('eccc','ca-weather-alerts',JSON.stringify({type:'FeatureCollection',features}),now,{country:'CA',evidence:'warning',impactGeometry:false,warningFeatures:features.length,sourceUrl:'https://api.weather.gc.ca/collections/weather-alerts/items',attribution:'Environment and Climate Change Canada; Open Government Licence – Canada'});
   details.CA={status:'connected',archiveStatus:status,warningFeatures:features.length,evidence:'Official warnings and warning-area geometry, not confirmed storm footprints'};
 }catch{failures.push('CA_warnings');details.CA={status:'failed'};}
 // Retry historical public exports daily; a failed export is never recorded as zero storms.
 if(includeHistory||(now.getUTCHours()===2&&Math.floor(now.getUTCMinutes()/10)===3)){
  try{const csv=await fetchText('https://zenodo.org/records/17517119/files/integrated_canadian_hail_db_v1.1.csv?download=1');if(csv.trimStart().startsWith('<'))throw Error('Invalid CSV response.');const rows=parseCsv(csv,{columns:true,skip_empty_lines:true});if(!rows.length)throw Error('Empty Canadian hail archive.');await store('eccc-ichd','ca-hail-history-v1-1',csv,new Date('2024-12-31T23:59:59Z'),{country:'CA',evidence:'reported-observations',period:'2005–2024',rows:rows.length,sourceUrl:'https://zenodo.org/records/17517119',attribution:'Brunet and Brimelow; Contains information licensed under the Open Government Licence – Canada'});details.CanadianHailHistory={status:'stored',reports:rows.length};}catch{details.CanadianHailHistory={status:'unavailable',reason:'Published dataset download is unavailable; current access returned an error.'};failures.push('CA_historical_hail');}

 }
 details.limitations=['National warnings are not complete hail or tornado occurrence archives.','Location-based Xweather hail history requires configured watch locations.','CSSL/NTP surveyed tracks require confirmed commercial access.'];
 const status=(details.CA as {status?:string})?.status==='failed'?'failed':failures.length?'partial':'complete';
 const {error}=await admin.from('storm_collection_runs').update({status,details:{...details,failures},completed_at:new Date().toISOString()}).eq('window_key',window);if(error)throw Error('Country collection result could not be recorded.');
 return {status,window,details,failures};
}
