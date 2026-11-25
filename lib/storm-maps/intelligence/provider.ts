import { loadTornadoSurveys } from './tornado-surveys';
import { getCachedStormValue, setCachedStormValue } from '../cache';
import { reportEvents } from './normalize';
import type { StormHazard } from './model';

export async function loadReportCollection(start:string,end:string) {
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
  if(!data)throw Error('Historical report response was empty');
  return data;
}
export async function loadReportEvents(bbox:number[],start:string,end:string,hazard:StormHazard){
  const reports=reportEvents(await loadReportCollection(start,end),bbox,start,end,hazard);
  if(hazard!=='tornado')return reports;
  try {const surveys=await loadTornadoSurveys(bbox,start,end);return [...surveys,...reports.map(event=>({...event,surveyStatus:'unavailable' as const}))];}
  catch {return reports.map(event=>({...event,surveyStatus:'error' as const}));}
}
