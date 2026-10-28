import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { booleanPointInPolygon } from '@turf/turf';
import { findDurhamPlaceMatches, type DurhamFarmAddress, type DurhamPlace } from './durhamPlaces';

const s3 = new S3Client({ region: process.env.AWS_REGION || process.env.AWS_S3_BUCKET_REGION || 'us-east-2' });
const prefix = 'farms/overture-places/durham/2026-10-21.0';
async function read(key: string) {
  const response = await s3.send(new GetObjectCommand({ Bucket: 'flyr-pro-addresses-2025', Key: `${prefix}/${key}` }));
  if (!response.Body) throw new Error('Durham place data is unavailable');
  return JSON.parse(await response.Body.transformToString());
}
export async function matchDurhamFarmAddresses(addresses: DurhamFarmAddress[]) {
  const [snapshot, boundary] = await Promise.all([
    read('places.json') as Promise<{ release: string; places: DurhamPlace[] }>,
    read('boundary.geojson') as Promise<GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon>>,
  ]);
  const polygon = boundary.features[0];
  if (!polygon) throw new Error('Durham boundary is unavailable');
  const withinDurham = addresses.filter(a => a.longitude != null && a.latitude != null && booleanPointInPolygon([a.longitude, a.latitude], polygon));
  return { release: snapshot.release, addressesInDurham: withinDurham.length, matches: findDurhamPlaceMatches(withinDurham, snapshot.places) };
}
