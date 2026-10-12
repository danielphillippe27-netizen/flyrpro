import { gunzipSync } from 'node:zlib';
/** Read the authoritative reference time from GRIB2 section 1, not HTTP cache time. */
export function meshReferenceTime(compressed:Buffer):Date{
 if(compressed.length>10_000_000)throw Error('Grid is too large.');
 const grid=gunzipSync(compressed,{maxOutputLength:100_000_000});
 if(grid.subarray(0,4).toString()!=='GRIB'||grid[7]!==2)throw Error('Invalid GRIB2 grid.');
 let offset=16;
 while(offset+21<=grid.length){
  const size=grid.readUInt32BE(offset);
  if(size<5||offset+size>grid.length)throw Error('Invalid GRIB2 section.');
  if(grid[offset+4]===1){
   const time=new Date(Date.UTC(grid.readUInt16BE(offset+12),grid[offset+14]-1,grid[offset+15],grid[offset+16],grid[offset+17],grid[offset+18]));
   if(!Number.isFinite(+time))throw Error('Invalid grid timestamp.');
   return time;
  }
  offset+=size;
 }
 throw Error('Missing grid reference time.');
}
export function collectionWindow(now:Date){return now.toISOString().slice(0,13);}
export function reportCollectionStart(now:Date){const start=new Date(now);start.setUTCHours(0,0,0,0);start.setUTCDate(start.getUTCDate()-6);return start;}
