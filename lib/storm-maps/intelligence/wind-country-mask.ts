import boundaries from './wind-country-boundaries.json';
import regions from './wind-region-boundaries.json';
import type { WindCountry } from './wind-archive-format';
const size=8192;
type Span=[number,number];
export type WindBoundary={type:string;coordinates:unknown};
const cache=new Map<WindCountry,Span[][]>();
/** Natural Earth 1:50m land boundaries, sampled at native Mercator cell centres.
 * Public domain: https://www.naturalearthdata.com/about/terms-of-use/
 * Source: nvkelso/natural-earth-vector geojson/ne_50m_admin_0_countries.geojson
 */
export function windBoundaryRows(geometry:WindBoundary){
 const polygons=geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;
 const crossings:number[][]=Array.from({length:size},()=>[]);
 for(const rings of polygons as number[][][][])for(const ring of rings){
  const points=ring.map(([lon,lat])=>[(lon+180)/360*size,(1-Math.asinh(Math.tan(Math.max(-85.05112878,Math.min(85.05112878,lat))*Math.PI/180))/Math.PI)/2*size]);
  for(let i=0,j=points.length-1;i<points.length;j=i++){
   const [ax,ay]=points[j],[bx,by]=points[i];if(ay===by)continue;
   for(let y=Math.max(0,Math.ceil(Math.min(ay,by)-.5));y<Math.min(size,Math.ceil(Math.max(ay,by)-.5));y++)crossings[y].push(ax+(y+.5-ay)/(by-ay)*(bx-ax));
  }
 }
 const rows=crossings.map(values=>{values.sort((a,b)=>a-b);const spans:Span[]=[];for(let i=0;i+1<values.length;i+=2)spans.push([Math.ceil(values[i]-.5),Math.ceil(values[i+1]-.5)]);return spans;});
 return rows;
}
function countryRows(country:WindCountry){
 const existing=cache.get(country);if(existing)return existing;
 let rows=windBoundaryRows(boundaries[country]);
 if(country==='US'){
  const alaska=regions.find(region=>region.country==='US'&&region.name==='Alaska');
  if(!alaska)throw Error('Alaska wind exclusion boundary unavailable.');
  const excluded=windBoundaryRows(alaska.geometry);
  rows=rows.map((spans,y)=>{
   let remaining=spans;
   for(const [west,east] of excluded[y])remaining=remaining.flatMap(([start,end]):Span[]=>end<=west||start>=east?[[start,end]]:[...(start<west?[[start,west] as Span]:[]),...(end>east?[[east,end] as Span]:[])]);
   return remaining;
  });
 }
 cache.set(country,rows);return rows;
}
export function windCountryCell(country:WindCountry,x:number,y:number){return countryRows(country)[y]?.some(([start,end])=>x>=start&&x<end)??false;}
export function windCountryTileMask(country:WindCountry,tx:number,ty:number){
 const rows=countryRows(country),mask=new Uint8Array(512*512);
 for(let y=0;y<512;y++)for(const [start,end] of rows[ty*512+y]??[])mask.fill(1,y*512+Math.max(0,Math.min(512,start-tx*512)),y*512+Math.max(0,Math.min(512,end-tx*512)));
 return mask;
}
