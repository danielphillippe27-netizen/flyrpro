import type { StormEvent } from './model';
export function torontoDigestClock(now:Date){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(now);
 const value=(type:string)=>parts.find(p=>p.type===type)!.value;
 return {date:`${value('year')}-${value('month')}-${value('day')}`,hour:Number(value('hour'))};
}
export function buildStormDigest(hail:StormEvent[]|null,start:Date,end:Date){
 const reports=hail?.reduce((total,e)=>total+e.reportCount,0)??null;
 const states=hail?new Set(hail.filter(e=>e.reportCount).map(e=>e.sourceId.split(':').at(-1))).size:null;
 const maximum=hail?.reduce((max,e)=>Math.max(max,e.maxHailMM??0),0)??null;
 const hailText=reports==null?'Hail feed unavailable':`${reports} U.S. hail reports${reports?` in ${states} states; largest ${((maximum??0)/25.4).toFixed(2)} in`:''}`;
 return {text:`WolfGrid daily storm update (past 24h): ${hailText}. https://wolfgrid.app/storms?country=US`,hailReports:reports,hailStates:states,maximumHailMM:maximum,start:start.toISOString(),end:end.toISOString(),coverage:'Reported U.S. hail observations.'};
}
