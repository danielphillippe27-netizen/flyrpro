import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/** Large immutable map payloads stay in private object storage; only pointers enter Postgres. */
export type ExternalMapPointer = { kind: 'wolfgrid-map-json-gzip-v1'; bucket: string; key: string; sha256: string; asset_signature?: string };
const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-2' });
export function isExternalMapPointer(value: unknown): value is ExternalMapPointer {
  const v = value as Partial<ExternalMapPointer> | null;
  return !!v && v.kind === 'wolfgrid-map-json-gzip-v1' && typeof v.bucket === 'string' &&
    typeof v.key === 'string' && /^campaign-map-payloads\/[a-f0-9-]+\/[a-f0-9]{64}\.json\.gz$/i.test(v.key) &&
    typeof v.sha256 === 'string' && /^[a-f0-9]{64}$/.test(v.sha256);
}
export async function putExternalMapPayload(bucket: string, campaignId: string, value: unknown): Promise<ExternalMapPointer> {
  if (!/^[a-f0-9-]{36}$/i.test(campaignId)) throw new Error('Invalid campaign id');
  const bytes = gzipSync(JSON.stringify(value));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const key = `campaign-map-payloads/${campaignId}/${sha256}.json.gz`;
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes,
    ContentType: 'application/json', ContentEncoding: 'gzip', CacheControl: 'private, max-age=31536000, immutable' }));
  return { kind: 'wolfgrid-map-json-gzip-v1', bucket, key, sha256 };
}
export async function readExternalMapPayload(pointer: ExternalMapPointer, campaignId: string): Promise<unknown> {
  if (!isExternalMapPointer(pointer) || !pointer.key.toLowerCase().startsWith(`campaign-map-payloads/${campaignId.toLowerCase()}/`)) throw new Error('Invalid external map payload');
  const result = await s3.send(new GetObjectCommand({ Bucket: pointer.bucket, Key: pointer.key }));
  if (!result.Body) throw new Error('External map payload missing');
  const bytes = Buffer.from(await result.Body.transformToByteArray());
  if (createHash('sha256').update(bytes).digest('hex') !== pointer.sha256) throw new Error('External map payload checksum mismatch');
  return JSON.parse(gunzipSync(bytes, { maxOutputLength: 512 * 1024 * 1024 }).toString('utf8'));
}

/** Call only after campaign access and current-revision checks. */
export async function signedExternalMapPayloadURL(pointer: ExternalMapPointer, campaignId: string): Promise<string> {
  if (!isExternalMapPointer(pointer) || !pointer.key.toLowerCase().startsWith(`campaign-map-payloads/${campaignId.toLowerCase()}/`)) throw new Error('Invalid external map payload');
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: pointer.bucket, Key: pointer.key }), { expiresIn: 120 });
}
