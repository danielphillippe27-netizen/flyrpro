import boundaries from './wind-region-boundaries.json';
import {windBoundaryRows} from './wind-country-mask';
import type {WindCountry} from './wind-archive-format';
const grids=new Map<string,Uint8Array>();
const regions=new Map<WindCountry,Array<{name:string;rows:ReturnType<typeof windBoundaryRows>}>>();
export function windRegions(country:WindCountry){
 let value=regions.get(country);
 if(!value){value=boundaries.filter(region=>region.country===country&&!(country==='US'&&region.name==='Alaska')).map(region=>({name:region.name,rows:windBoundaryRows(region.geometry)}));regions.set(country,value);}
 return value;
}
/** Administrative labels use the same native cells as the wind display. */
export function windRegionTile(country:WindCountry,tx:number,ty:number){
 const key=`${country}/${tx}/${ty}`,existing=grids.get(key);if(existing)return existing;
 const grid=new Uint8Array(512*512);
 windRegions(country).forEach((region,index)=>{
  for(let y=0;y<512;y++)for(const [start,end] of region.rows[ty*512+y]??[])grid.fill(index+1,y*512+Math.max(0,Math.min(512,start-tx*512)),y*512+Math.max(0,Math.min(512,end-tx*512)));
 });
 grids.set(key,grid);return grid;
}
