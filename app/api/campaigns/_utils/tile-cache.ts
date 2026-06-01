import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { FetchSource, PMTiles, type RangeResponse } from 'pmtiles';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';
import { resolveUserFromRequest, type RequestUser } from '@/app/api/_utils/request-user';
import { ensureCampaignAccess } from '@/app/api/campaigns/_utils/access';
import type { CampaignSnapshotRow } from '@/lib/diamond/geometry';

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

const AUTH_TTL_MS = 60_000;
const ACCESS_TTL_MS = 60_000;
const SNAPSHOT_TTL_MS = 30_000;
const MAX_ARCHIVES = 64;
const AWS_REGION = process.env.AWS_REGION || process.env.AWS_S3_BUCKET_REGION || 'us-east-2';

const authCache = new Map<string, CacheEntry<RequestUser | null>>();
const accessCache = new Map<string, CacheEntry<boolean>>();
const snapshotCache = new Map<string, CacheEntry<CampaignSnapshotRow | null>>();
const archiveCache = new Map<string, PMTiles>();
let s3Client: S3Client | null = null;

class EtagTolerantFetchSource extends FetchSource {
  async getBytes(
    offset: number,
    length: number,
    signal?: AbortSignal
  ): Promise<RangeResponse> {
    const response = await super.getBytes(offset, length, signal, undefined);
    return {
      ...response,
      etag: undefined,
    };
  }
}

class S3RangeSource {
  constructor(
    private readonly url: string,
    private readonly bucket: string,
    private readonly key: string
  ) {}

  getKey() {
    return this.url;
  }

  async getBytes(
    offset: number,
    length: number,
    signal?: AbortSignal
  ): Promise<RangeResponse> {
    const response = await getS3Client().send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: this.key,
        Range: `bytes=${offset}-${offset + length - 1}`,
      }),
      signal ? { abortSignal: signal } : undefined
    );
    const body = response.Body as
      | { transformToByteArray?: () => Promise<Uint8Array> }
      | undefined;
    if (!body?.transformToByteArray) {
      throw new Error(`Unable to read S3 PMTiles range: ${this.bucket}/${this.key}`);
    }
    const bytes = await body.transformToByteArray();
    const data = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(data).set(bytes);
    return {
      data,
      etag: undefined,
      cacheControl: response.CacheControl,
      expires: response.Expires?.toUTCString(),
    };
  }
}

function getS3Client() {
  if (!s3Client) {
    s3Client = new S3Client({
      region: AWS_REGION,
      credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
        ? {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
            sessionToken: process.env.AWS_SESSION_TOKEN,
          }
        : undefined,
    });
  }
  return s3Client;
}

function parseS3Url(url: string): { bucket: string; key: string } | null {
  if (!url.startsWith('s3://')) return null;
  const withoutScheme = url.slice('s3://'.length);
  const slashIndex = withoutScheme.indexOf('/');
  if (slashIndex <= 0 || slashIndex === withoutScheme.length - 1) return null;
  return {
    bucket: withoutScheme.slice(0, slashIndex),
    key: withoutScheme.slice(slashIndex + 1),
  };
}

function getCached<T>(cache: Map<string, CacheEntry<T>>, key: string): T | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;
}

function setCached<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T, ttlMs: number) {
  cache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
}

function requestAuthCacheKey(request: NextRequest) {
  const authorization = request.headers.get('authorization')?.trim();
  if (authorization) return `authorization:${authorization}`;

  const token = request.nextUrl.searchParams.get('access_token')?.trim() ??
    request.nextUrl.searchParams.get('token')?.trim();
  if (token) return `query:${token}`;

  const cookie = request.headers.get('cookie')?.trim();
  if (cookie) return `cookie:${cookie}`;

  return 'anonymous';
}

export async function resolveCachedTileUser(request: NextRequest): Promise<RequestUser | null> {
  const cacheKey = requestAuthCacheKey(request);
  const cached = getCached(authCache, cacheKey);
  if (cached !== undefined) return cached;

  const user = await resolveUserFromRequest(request, {
    allowQueryToken: true,
    queryTokenParamNames: ['access_token', 'token'],
  });
  setCached(authCache, cacheKey, user, AUTH_TTL_MS);
  return user;
}

export async function ensureCachedCampaignAccess(
  supabase: SupabaseClient,
  campaignId: string,
  userId: string
) {
  const cacheKey = `${campaignId}:${userId}`;
  const cached = getCached(accessCache, cacheKey);
  if (cached !== undefined) return cached;

  const allowed = await ensureCampaignAccess(supabase, campaignId, userId);
  setCached(accessCache, cacheKey, allowed, ACCESS_TTL_MS);
  return allowed;
}

export async function getCachedCampaignSnapshot(
  supabase: SupabaseClient,
  campaignId: string
): Promise<CampaignSnapshotRow | null> {
  const cached = getCached(snapshotCache, campaignId);
  if (cached !== undefined) return cached;

  const { data, error } = await supabase
    .from('campaign_snapshots')
    .select('bucket, prefix, buildings_key, addresses_key, buildings_url, metadata_key, buildings_count, created_at, tile_metrics')
    .eq('campaign_id', campaignId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  const snapshot = data as CampaignSnapshotRow | null;
  setCached(snapshotCache, campaignId, snapshot, SNAPSHOT_TTL_MS);
  return snapshot;
}

export function getCachedPmtilesArchive(url: string) {
  const cached = archiveCache.get(url);
  if (cached) return cached;

  const s3Url = parseS3Url(url);
  const archive = new PMTiles(
    s3Url
      ? new S3RangeSource(url, s3Url.bucket, s3Url.key)
      : new EtagTolerantFetchSource(url)
  );
  archiveCache.set(url, archive);

  if (archiveCache.size > MAX_ARCHIVES) {
    const oldestKey = archiveCache.keys().next().value as string | undefined;
    if (oldestKey) archiveCache.delete(oldestKey);
  }

  return archive;
}
