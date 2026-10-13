import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { createAdminClient } from '@/lib/supabase/server';
import { loadReportCollection,xweatherData } from './provider';
import { reportEvents,cycloneEvent,type CycloneResponse } from './normalize';
import type { StormEvent } from './model';
import { collectionWindow,reportCollectionStart,meshReferenceTime } from './archive-format';
const NOAA_URL='https://mrms.ncep.noaa.gov/2D/MESH_Max_1440min/MRMS_MESH_Max_1440min.latest.grib2.gz';
const hash=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
export async function collectStormArchive(now=new Date()){
 const admin=createAdminClient(),window=collectionWindow(now);
 const {error:claimError}=await admin.from('storm_collection_runs').insert({window_key:window});
 if(claimError){if(claimError.code==='23505')return {status:'already_attempted',window};throw Error('Archive collector database unavailable.');}
 const start=reportCollectionStart(now),details:Record<string,unknown>={},failures:string[]=[];
 async function asset(provider:string,product:string,bytes:Buffer,sourceTime:Date,metadata:Record<string,unknown>){
  const digest=hash(bytes),path=`${provider}/${product}/${sourceTime.toISOString().slice(0,10)}/${digest}.gz`;
  const {data:existing,error:readError}=await admin.from('storm_archive_assets').select('id').eq('provider',provider).eq('product',product).eq('content_hash',digest).maybeSingle();
  if(readError)throw Error('Archive lookup failed.');if(existing)return {status:'unchanged',bytes:bytes.length,sourceTime:sourceTime.toISOString()};
  const {error:uploadError}=await admin.storage.from('storm-archive').upload(path,bytes,{contentType:'application/gzip',upsert:true});
  if(uploadError)throw Error('Archive storage failed.');
  const {error}=await admin.from('storm_archive_assets').upsert({provider,product,content_hash:digest,source_time:sourceTime.toISOString(),storage_path:path,byte_size:bytes.length,metadata},{onConflict:'provider,product,content_hash'});
  if(error)throw Error('Archive asset record failed.');
  return {status:'stored',bytes:bytes.length,sourceTime:sourceTime.toISOString()};
 }
 async function saveEvent(event:StormEvent,payload:unknown){
  const sourceTimes=event.features.filter(f=>f.properties.kind!=='forecast'&&f.properties.kind!=='cone').map(f=>Date.parse(f.properties.time)).filter(t=>Number.isFinite(t)&&t<=+now);
  const updated=sourceTimes.length?new Date(Math.max(...sourceTimes)).toISOString():event.start;
  const {error}=await admin.from('storm_events').upsert({event_key:event.key,provider_event_id:event.sourceId,hazard:event.hazard,source:event.source,event_start:event.start,event_end:event.end,source_updated_at:updated,metadata:event},{onConflict:'event_key'});
  if(error)throw Error('Event archive write failed.');
  const {error:snapshotError}=await admin.from('storm_event_snapshots').upsert({event_key:event.key,content_hash:hash(JSON.stringify(payload)),payload},{onConflict:'event_key,content_hash',ignoreDuplicates:true});
  if(snapshotError)throw Error('Event snapshot write failed.');
 }
 await Promise.all([
  (async()=>{try{
   const collection=await loadReportCollection(start.toISOString(),now.toISOString());
   const hail=reportEvents(collection,[-180,-85,180,85],start.toISOString(),now.toISOString(),'hail'),tornado=reportEvents(collection,[-180,-85,180,85],start.toISOString(),now.toISOString(),'tornado');
   await asset('iem','storm-reports',gzipSync(JSON.stringify(collection)),now,{evidence:'reported-observations',coverage:'U.S. local storm reports',from:start.toISOString(),to:now.toISOString()});
   for(const event of [...hail,...tornado])await saveEvent(event,event);
   details.reports={hailEvents:hail.length,tornadoEvents:tornado.length,hailReports:hail.reduce((n,e)=>n+e.reportCount,0),tornadoReports:tornado.reduce((n,e)=>n+e.reportCount,0),lookbackDays:7};
  }catch{failures.push('reports');details.reports={status:'failed'};}})(),
  (async()=>{try{
   const active=await xweatherData<CycloneResponse>('tropicalcyclones',{limit:'100',filter:'geo,windfield'});
   const rows=new Map(active.map(row=>[row.id,row]));
   // Include recently ended storms so disappearance from the active feed does not lose the final advisory.
   try{
    for(const year of new Set([start.getUTCFullYear(),now.getUTCFullYear()])){
     for(let page=0;page<5;page++){
      const recent=await xweatherData<CycloneResponse>('tropicalcyclones/archive/search',{query:`year:${year}`,fields:'id,profile',limit:'50',skip:String(page*50)});
      for(const row of recent){
       const ended=row.profile.lifespan.endDateTimeISO;
       if(rows.has(row.id)||!ended||Date.parse(ended)<+start)continue;
       const {data:existing}=await admin.from('storm_events').select('source_updated_at').eq('event_key',`xweather:${row.id}`).maybeSingle();
       if(existing&&Date.parse(existing.source_updated_at)>=Date.parse(ended))continue;
       const full=await xweatherData<CycloneResponse>(`tropicalcyclones/archive/${row.id}`,{filter:'geo,windfield'});
       for(const complete of full)rows.set(complete.id,complete);
      }
      if(recent.length<50)break;
      if(page===4)failures.push('cyclone_archive_truncated');
     }
    }
   }catch{failures.push('cyclone_recent_archive');}
   if(active.length>=100)failures.push('cyclone_active_truncated');
   for(const row of rows.values())await saveEvent(cycloneEvent(row),row);
   details.cyclones={events:rows.size,active:active.length,evidence:'Advisory tracks, forecasts, and supplied wind polygons; not a complete damage footprint'};
  }catch{failures.push('cyclones');details.cyclones={status:'failed'};}})(),
  (async()=>{try{
   const response=await fetch(NOAA_URL,{cache:'no-store',signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error('Grid unavailable.');
   const bytes=Buffer.from(await response.arrayBuffer()),reference=meshReferenceTime(bytes);
   if(+reference>+now+3600000||+now-+reference>48*3600000)throw Error('Grid is stale.');
   details.hailGrid=await asset('noaa-mrms','mesh-max-1440min',bytes,reference,{evidence:'modeled-hail-grid',coverage:'CONUS MRMS grid',units:'mm',intervalMinutes:1440,sourceUrl:NOAA_URL,format:'GRIB2 gzip',mapIntegration:'pending'});
  }catch{failures.push('hail_grid');details.hailGrid={status:'failed'};}})(),
 ]);
 details.limitations=['Xweather native hail grid export is not connected.','Tornado reports are not surveyed impact tracks.','Coverage is limited to the named provider feeds; this cannot establish every storm worldwide.'];
 const status=failures.length?['reports','cyclones','hailGrid'].every(key=>(details[key] as {status?:string})?.status==='failed')?'failed':'partial':'complete';
 const {error}=await admin.from('storm_collection_runs').update({status,details:{...details,failures},completed_at:new Date().toISOString()}).eq('window_key',window);
 if(error)throw Error('Collector run record failed.');
 return {status,window,details,failures};
}
