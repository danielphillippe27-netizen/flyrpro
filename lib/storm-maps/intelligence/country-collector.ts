import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {parse as parseCsv} from 'csv-parse/sync';
import {createAdminClient} from '@/lib/supabase/server';
import {capFeedItems,capSummary,trustedCapUrl,safeCanadaNext} from './country-format';
export async function collectCountryArchive(now=new Date(),includeHistory=false){
 const admin=createAdminClient(),window=`countries:${now.toISOString().slice(0,13)}:${Math.floor(now.getUTCMinutes()/10)}`;
 const {error:claim}=await admin.from('storm_collection_runs').insert({window_key:window});
 if(claim){if(claim.code==='23505')return {status:'already_attempted',window};throw Error('Country collection ledger unavailable.');}
 const details:Record<string,unknown>={},failures:string[]=[],deadline=Date.now()+230000;
 async function fetchText(url:string){const response=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(25000)});if(!response.ok)throw Error('Public source unavailable.');const text=await response.text();if(text.length>8_000_000)throw Error('Source response too large.');return text;}
 async function store(provider:string,product:string,body:string,time:Date,metadata:Record<string,unknown>){
  const bytes=gzipSync(body),hash=createHash('sha256').update(bytes).digest('hex'),path=`${provider}/${product}/${time.toISOString().slice(0,10)}/${hash}.gz`;
  const {data:existing,error:readError}=await admin.from('storm_archive_assets').select('id').eq('provider',provider).eq('product',product).eq('content_hash',hash).maybeSingle();
  if(readError)throw Error('Archive lookup failed.');if(existing)return 'unchanged';
  const {error:upload}=await admin.storage.from('storm-archive').upload(path,bytes,{contentType:'application/gzip',upsert:true});if(upload)throw Error('Archive upload failed.');
  const {error}=await admin.from('storm_archive_assets').upsert({provider,product,content_hash:hash,storage_path:path,source_time:time.toISOString(),byte_size:bytes.length,metadata},{onConflict:'provider,product,content_hash'});if(error)throw Error('Archive record failed.');return 'stored';
 }
 async function capCountry(country:'AU'|'NZ',provider:string,feedUrl:string){
  try{
   const feed=await fetchText(feedUrl),items=capFeedItems(feed);
   await store(provider,`${country.toLowerCase()}-warning-feed`,feed,now,{country,evidence:'warning',impactGeometry:false,sourceUrl:feedUrl,attribution:country==='NZ'?'MetService, CC BY 4.0':'Bureau of Meteorology via WMO',items:items.length});
   const recent=items.filter(item=>Date.parse(item.published)>=+now-7*86400000&&(country==='NZ'||/thunderstorm|tornado|hail|severe weather|cyclone/i.test(item.title)));
   if(recent.length>100)failures.push(`${country}_cap_limit`);
   let stored=0,unchanged=0,invalid=0;
   const selected=recent.slice(0,100);
   for(let offset=0;offset<selected.length;offset+=10){if(Date.now()>deadline){failures.push(`${country}_cap_deadline`);break;}await Promise.all(selected.slice(offset,offset+10).map(async item=>{
    try{
     if(!trustedCapUrl(item.url,country)){invalid++;return;}
     const {data:existing,error}=await admin.from('storm_archive_assets').select('id').eq('provider',provider).eq('product',`${country.toLowerCase()}-cap-alert`).eq('metadata->>sourceUrl',item.url).limit(1);
     if(error)throw Error('CAP lookup failed.');if(existing?.length){unchanged++;return;}
     const xml=await fetchText(item.url),summary=capSummary(xml);
     await store(provider,`${country.toLowerCase()}-cap-alert`,xml,new Date(summary.sent),{country,sourceUrl:item.url,attribution:country==='NZ'?'MetService, CC BY 4.0':'Bureau of Meteorology via WMO',...summary});stored++;
    }catch{invalid++;}
   }));}
   if(invalid)failures.push(`${country}_cap_documents`);
   details[country]={status:invalid?'partial':'connected',warningFeedItems:items.length,storedCapDocuments:stored,unchangedCapDocuments:unchanged,failedDocuments:invalid,evidence:'Warnings and watches, including cancellations. Not confirmed hail/tornado impact footprints.'};
  }catch{failures.push(`${country}_warnings`);details[country]={status:'failed'};}
 }
 await Promise.all([
  (async()=>{try{
   let url='https://api.weather.gc.ca/collections/weather-alerts/items?f=json&limit=1000';const features:GeoJSON.Feature[]=[];let pages=0;
   while(url){if(!safeCanadaNext(url))throw Error('Invalid Canadian pagination link.');const body=JSON.parse(await fetchText(url));if(body.type!=='FeatureCollection'||!Array.isArray(body.features))throw Error('Invalid Canadian alert feed.');features.push(...body.features);const next=body.links?.find((link:{rel:string;href:string})=>link.rel==='next')?.href??'';if(++pages>=10&&next)throw Error('Canadian pagination limit exceeded.');url=next;}
   const status=await store('eccc','ca-weather-alerts',JSON.stringify({type:'FeatureCollection',features}),now,{country:'CA',evidence:'warning',impactGeometry:false,warningFeatures:features.length,sourceUrl:'https://api.weather.gc.ca/collections/weather-alerts/items',attribution:'Environment and Climate Change Canada; Open Government Licence – Canada'});
   details.CA={status:'connected',archiveStatus:status,warningFeatures:features.length,evidence:'Official warnings and warning-area geometry, not confirmed storm footprints'};
  }catch{failures.push('CA_warnings');details.CA={status:'failed'};}})(),
  capCountry('AU','bom-wmo','https://severeweather.wmo.int/v2/cap-alerts/au-bom-en/rss.xml'),
  capCountry('NZ','metservice','https://alerts.metservice.com/cap/rss'),
 ]);
 // Retry historical public exports daily; a failed export is never recorded as zero storms.
 if(includeHistory||(now.getUTCHours()===2&&Math.floor(now.getUTCMinutes()/10)===3)){
  try{const csv=await fetchText('https://zenodo.org/records/17517119/files/integrated_canadian_hail_db_v1.1.csv?download=1');if(csv.trimStart().startsWith('<'))throw Error('Invalid CSV response.');const rows=parseCsv(csv,{columns:true,skip_empty_lines:true});if(!rows.length)throw Error('Empty Canadian hail archive.');await store('eccc-ichd','ca-hail-history-v1-1',csv,new Date('2024-12-31T23:59:59Z'),{country:'CA',evidence:'reported-observations',period:'2005–2024',rows:rows.length,sourceUrl:'https://zenodo.org/records/17517119',attribution:'Brunet and Brimelow; Contains information licensed under the Open Government Licence – Canada'});details.CanadianHailHistory={status:'stored',reports:rows.length};}catch{details.CanadianHailHistory={status:'unavailable',reason:'Published dataset download is unavailable; current access returned an error.'};failures.push('CA_historical_hail');}
  const start=new Date(+now-30*86400000);
  for(const hazard of ['hail','tornado'])try{const params=new URLSearchParams({action:'form',stormType:hazard,search_area:'N',s_day:String(start.getUTCDate()),s_month:String(start.getUTCMonth()+1),s_year:String(start.getUTCFullYear()),e_day:String(now.getUTCDate()),e_month:String(now.getUTCMonth()+1),e_year:String(now.getUTCFullYear()),output_type:'csv',sort_by:'dt_commence',sort_by_dir:'desc',submit:'Generate report'});const csv=await fetchText(`https://www.bom.gov.au/australia/stormarchive/storm.php?${params}`);if(csv.trimStart().startsWith('<')||!csv.trim())throw Error('Invalid CSV response.');const records=parseCsv(csv,{columns:true,skip_empty_lines:true});await store('bom',`au-${hazard}-reports`,csv,now,{country:'AU',evidence:'reported-observations',sourceUrl:'https://www.bom.gov.au/australia/stormarchive/',from:start.toISOString(),to:now.toISOString(),rows:records.length});details[`Australian_${hazard}_history`]={status:'stored',records:records.length};}catch{details[`Australian_${hazard}_history`]={status:'unavailable',reason:'BOM historical report export is returning errors.'};failures.push(`AU_historical_${hazard}`);}
 }
 details.limitations=['National warnings are not complete hail or tornado occurrence archives.','Location-based Xweather hail history requires configured watch locations.','New Zealand hail/tornado impact geometry requires a separately connected data product.','CSSL/NTP surveyed tracks require confirmed commercial access.'];
 const status=['CA','AU','NZ'].every(country=>(details[country] as {status?:string})?.status==='failed')?'failed':failures.length?'partial':'complete';
 const {error}=await admin.from('storm_collection_runs').update({status,details:{...details,failures},completed_at:new Date().toISOString()}).eq('window_key',window);if(error)throw Error('Country collection result could not be recorded.');
 return {status,window,details,failures};
}
