import * as wkx from 'wkx';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { CanonicalGeometryPack } from './CanonicalGeometryPack';

// One immutable pack at a time; auth and campaign/revision access are checked by the route.
let cached: { key: string; expires: number; pack: Promise<CanonicalGeometryPack> } | undefined;
export async function readTownhomeFootprints(bucket: string, objectKey: string, ids: string[]): Promise<GeoJSON.FeatureCollection> {
  const key = `${bucket}/${objectKey}`;
  if (!cached || cached.key !== key || cached.expires < Date.now()) {
    const pack = new S3Client({region:process.env.AWS_REGION || 'us-east-2'})
      .send(new GetObjectCommand({Bucket:bucket,Key:objectKey}))
      .then(async response => {
        if (!response.Body) throw new Error('Missing geometry package');
        return new CanonicalGeometryPack(Buffer.from(await response.Body.transformToByteArray()));
      });
    cached = {key,expires:Date.now()+60000,pack};
    pack.catch(()=>{if(cached?.pack===pack)cached=undefined;});
  }
  return selectTownhomeFootprints(await cached.pack,ids);
}
export function selectTownhomeFootprints(pack:CanonicalGeometryPack,ids:string[]):GeoJSON.FeatureCollection {
  return {type:'FeatureCollection',features:[...new Set(ids)].flatMap(id=>{
    const bytes=pack.get(`building:${id}`);if(!bytes)return [];
    const geometry=wkx.Geometry.parse(bytes).toGeoJSON() as GeoJSON.Geometry;
    if(geometry.type!=='Polygon' && geometry.type!=='MultiPolygon')return [];
    return [{type:'Feature' as const,id,geometry,properties:{building_id:id}}];
  })};
}
