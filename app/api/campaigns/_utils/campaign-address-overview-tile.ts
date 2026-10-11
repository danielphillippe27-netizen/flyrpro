import Pbf from 'pbf';
import type { createAdminClient } from '@/lib/supabase/server';

type AddressRow = { id: string; gers_id: string | null; source_id: string | null; house_number: string | null; formatted: string | null; coordinate: unknown };
type TilePoint = { x: number; y: number; properties: Record<string, string | number> };
const EXTENT = 4096;
const BUFFER = Math.ceil(127 / 256 * EXTENT);
const rowsCache = new Map<string, { expires: number; rows: Promise<AddressRow[]> }>();

export function isNetsymsUsAddressKey(key: string) {
  return /^bedrock\/usa\/[^/]*netsyms[^/]*\/addresses\//.test(key);
}

async function campaignRows(supabase: ReturnType<typeof createAdminClient>, campaignId: string) {
  const cached = rowsCache.get(campaignId);
  if (cached && cached.expires > Date.now()) return cached.rows;
  const rows = (async () => {
    const all: AddressRow[] = [];
    for (let offset=0; ; offset+=1000) {
      const { data, error } = await supabase.from('campaign_addresses')
        .select('id,gers_id,source_id,house_number,formatted,coordinate')
        .eq('campaign_id',campaignId).order('id').range(offset,offset+999);
      if (error) throw new Error(`Campaign overview address read failed: ${error.message}`);
      all.push(...(data ?? []) as AddressRow[]);
      if (!data || data.length<1000) return all;
    }
  })().catch(error => { rowsCache.delete(campaignId); throw error; });
  rowsCache.set(campaignId,{expires:Date.now()+30_000,rows});
  while(rowsCache.size>32)rowsCache.delete(rowsCache.keys().next().value!);
  return rows;
}

/** Campaign-scoped MVT, derived from already provisioned source coordinates.
 * Keeps the complete address set at every zoom without fetching a whole city's
 * dense low-zoom tile. Promotes campaign stop IDs for clicks and feature-state;
 * retains the original dataset ID separately. No live state goes into the tile. */
export function encodeCampaignAddressOverview(rows: AddressRow[], tile: {z:number;x:number;y:number}): Uint8Array {
  const points: TilePoint[]=[];
  for(const row of rows) {
    const addressId=[row.gers_id,row.source_id].map(id=>id?.replace(/^bedrock_us:/,'')).find(id=>id?.startsWith('netsyms:us:'));
    if(!addressId)continue;
    let coordinate=row.coordinate as {lat?:unknown;lon?:unknown} | null;
    if(typeof row.coordinate==='string') {
      try {coordinate=JSON.parse(row.coordinate);} catch {continue;}
    }
    if(coordinate?.lon==null || coordinate?.lat==null)continue;
    const lon=Number(coordinate.lon),lat=Number(coordinate.lat);
    if(!Number.isFinite(lon)||!Number.isFinite(lat)||lon < -180||lon > 180||lat < -85.05112878||lat > 85.05112878)continue;
    const n=2**tile.z;
    const x=Math.round(((lon+180)/360*n-tile.x)*EXTENT);
    const y=Math.round(((1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*n-tile.y)*EXTENT);
    if(x < -BUFFER||x > EXTENT+BUFFER||y < -BUFFER||y > EXTENT+BUFFER)continue;
    points.push({x,y,properties:{address_id:row.id,source_id:addressId,gers_id:row.gers_id??addressId,house_number:row.house_number??'',house_number_label:row.house_number??'',full_address:row.formatted??'',longitude:lon,latitude:lat}});
  }
  if(!points.length)return new Uint8Array();
  const keys: string[]=[];
  const values: Array<string|number>=[];
  const keyIndex=new Map<string,number>();
  const valueIndex=new Map<string,number>();
  const features=points.map(point=>{
    const tags:number[]=[];
    for(const [key,value] of Object.entries(point.properties)) {
      if(!keyIndex.has(key)){keyIndex.set(key,keys.length);keys.push(key);}
      const identity=JSON.stringify([typeof value,value]);
      if(!valueIndex.has(identity)){valueIndex.set(identity,values.length);values.push(value);}
      tags.push(keyIndex.get(key)!,valueIndex.get(identity)!);
    }
    return {tags,geometry:[9,point.x<0?-point.x*2-1:point.x*2,point.y<0?-point.y*2-1:point.y*2]};
  });
  const pbf=new Pbf();
  pbf.writeMessage(3,(_unused,p)=>{
    p.writeVarintField(15,2);
    p.writeStringField(1,'addresses');
    for(const feature of features)p.writeMessage(2,(f,q)=>{
      q.writePackedVarint(2,f.tags);q.writeVarintField(3,1);q.writePackedVarint(4,f.geometry);
    },feature);
    for(const key of keys)p.writeStringField(3,key);
    for(const value of values)p.writeMessage(4,(v,q)=>{
      if(typeof v==='string')q.writeStringField(1,v);else q.writeDoubleField(3,v);
    },value);
    p.writeVarintField(5,EXTENT);
  },null);
  return pbf.finish();
}

export async function campaignAddressOverviewTile(
  supabase: ReturnType<typeof createAdminClient>, campaignId:string, tile:{z:number;x:number;y:number}
) {
  return encodeCampaignAddressOverview(await campaignRows(supabase,campaignId),tile);
}
