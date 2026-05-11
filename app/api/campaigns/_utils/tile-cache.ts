import { PMTiles } from 'pmtiles';
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

const authCache = new Map<string, CacheEntry<RequestUser | null>>();
const accessCache = new Map<string, CacheEntry<boolean>>();
const snapshotCache = new Map<string, CacheEntry<CampaignSnapshotRow | null>>();
const archiveCache = new Map<string, PMTiles>();

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

  const archive = new PMTiles(url);
  archiveCache.set(url, archive);

  if (archiveCache.size > MAX_ARCHIVES) {
    const oldestKey = archiveCache.keys().next().value as string | undefined;
    if (oldestKey) archiveCache.delete(oldestKey);
  }

  return archive;
}
