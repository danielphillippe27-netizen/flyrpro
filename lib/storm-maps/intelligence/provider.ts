import { getCachedStormValue, setCachedStormValue } from '../cache';
import { cycloneEvent, reportEvents, type CycloneResponse } from './normalize';
import type { StormHazard } from './model';

export async function xweatherData<T>(path: string, params: Record<string,string>): Promise<T[]> {
  const id=process.env.XWEATHER_CLIENT_ID, secret=process.env.XWEATHER_CLIENT_SECRET;
  if(!id||!secret)throw new Error('Xweather archive access is not configured');
  const url=new URL(`https://data.api.xweather.com/${path}`);
  Object.entries(params).forEach(([key,value])=>url.searchParams.set(key,value));
  url.searchParams.set('client_id',id);url.searchParams.set('client_secret',secret);
  // Never propagate upstream errors or URLs: they can include credentials.
  let response:Response;
  try {response=await fetch(url,{signal:AbortSignal.timeout(20000),cache:'no-store'});}catch{throw new Error('Xweather did not respond. Please retry.');}
  if(!response.ok)throw new Error('Xweather archive request unavailable. Check provider access.');
  const body=await response.json();
  if(!body.success)throw new Error('This Xweather archive request is not available with the current provider access.');
  return Array.isArray(body.response)?body.response:[];
}
export async function loadReportEvents(bbox: number[], start: string, end: string, hazard: StormHazard) {
  const key=`intelligence:reports:${start}:${end}`;
  const cached=await getCachedStormValue<GeoJSON.FeatureCollection>(key);
  let data=cached?.value;
  if(!data){
    const compact=(v:string)=>v.replace(/[-:TZ.]/g,'').slice(0,12);
    const url=`https://mesonet.agron.iastate.edu/geojson/lsr.php?sts=${compact(start)}&ets=${compact(end)}`;
    const r=await fetch(url,{signal:AbortSignal.timeout(25000)});
    if(!r.ok)throw new Error('Historical U.S. storm reports are unavailable. Retry with a shorter date range.');
    data=await r.json();
    if(data?.type!=='FeatureCollection'||!Array.isArray(data.features))throw new Error('Historical report response was invalid');
    await setCachedStormValue(key,data,1800,1800);
  }
  return reportEvents(data,bbox,start,end,hazard);
}
export async function loadCyclones(start:string,end:string,bbox:[number,number,number,number],sourceId?:string,active=false) {
  const path=sourceId?`tropicalcyclones/archive/${sourceId}`:active?'tropicalcyclones':'tropicalcyclones/archive/within';
  const params:Record<string,string>=sourceId?{}:active?{limit:'100'}:{p:`${bbox[1]},${bbox[0]},${bbox[3]},${bbox[2]}`,from:start,to:end,limit:'100'};
  return (await xweatherData<CycloneResponse>(path,{...params,filter:'geo,windfield'})).map(cycloneEvent);
}
export type HailArchiveRow={loc:{lat:number;long:number};periods:Array<{dateTimeISO:string;maxSizeMM:number|null;maxSizeIN:number|null;probSevere:number|null}>;profile?:{tz:string}};
