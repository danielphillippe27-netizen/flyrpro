import type { StormEvent } from './model';
import type { CycloneResponse } from './normalize';
export function torontoDigestClock(now:Date){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(now);
 const value=(type:string)=>parts.find(p=>p.type===type)!.value;
 return {date:`${value('year')}-${value('month')}-${value('day')}`,hour:Number(value('hour'))};
}
export function buildStormDigest(hail:StormEvent[]|null,cyclones:CycloneResponse[]|null,start:Date,end:Date){
 const reports=hail?.reduce((total,e)=>total+e.reportCount,0)??null;
 const states=hail?new Set(hail.filter(e=>e.reportCount).map(e=>e.sourceId.split(':').at(-1))).size:null;
 const maximum=hail?.reduce((max,e)=>Math.max(max,e.maxHailMM??0),0)??null;
 const updates=cyclones?.filter(c=>{
  const times=[c.position?.dateTimeISO,...(c.track??[]).map(p=>p.dateTimeISO)].flatMap(v=>v?[Date.parse(v)]:[]).filter(Number.isFinite);
  const latest=times.length?Math.max(...times):NaN;
  return latest>=+start&&latest<=+end;
 })??null;
 const hailText=reports==null?'Hail feed unavailable':`${reports} U.S. hail reports${reports?` in ${states} states; largest ${((maximum??0)/25.4).toFixed(2)} in`:''}`;
 const cycloneText=updates==null?'Cyclone feed unavailable':`${updates.length} tropical cyclone updates${updates.length?`: ${updates.slice(0,3).map(c=>c.profile.name).join(', ')}${updates.length>3?' + more':''}`:''}`;
 return {text:`WolfGrid daily storm update (past 24h): ${hailText}. ${cycloneText}. https://wolfgrid.app/storms`,hailReports:reports,hailStates:states,maximumHailMM:maximum,cycloneUpdates:updates?.map(c=>({id:c.id,name:c.profile.name,category:c.profile.maxStormCat}))??null,start:start.toISOString(),end:end.toISOString(),coverage:'U.S. reported hail; global active tropical cyclone advisories. Not complete impact footprints.'};
}
