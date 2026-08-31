import { getCache } from '@vercel/functions';

type CacheEnvelope<T> = {
  value: T;
  cachedAt: string;
};

const localFallback = new Map<string, { value: unknown; expiresAt: number }>();

async function getValue<T>(key: string): Promise<CacheEnvelope<T> | undefined> {
  try {
    return (await getCache({ namespace: 'storm-maps' }).get(key)) as CacheEnvelope<T> | undefined;
  } catch {
    const cached = localFallback.get(key);
    if (!cached || cached.expiresAt <= Date.now()) {
      localFallback.delete(key);
      return undefined;
    }
    return cached.value as CacheEnvelope<T>;
  }
}

async function setValue<T>(key: string, value: CacheEnvelope<T>, ttl: number) {
  try {
    await getCache({ namespace: 'storm-maps' }).set(key, value, {
      ttl,
      tags: ['storm-maps'],
      name: 'storm-map-provider-response',
    });
  } catch {
    localFallback.set(key, { value, expiresAt: Date.now() + ttl * 1000 });
  }
}

export async function getCachedStormValue<T>(key: string): Promise<CacheEnvelope<T> | undefined> {
  return getValue<T>(key);
}

export async function setCachedStormValue<T>(
  key: string,
  value: T,
  ttlSeconds: number,
  staleTtlSeconds = ttlSeconds * 6,
) {
  const envelope = { value, cachedAt: new Date().toISOString() };
  await Promise.all([
    setValue(key, envelope, ttlSeconds),
    setValue(`stale:${key}`, envelope, staleTtlSeconds),
  ]);
  return envelope;
}

export async function getStaleStormValue<T>(key: string): Promise<CacheEnvelope<T> | undefined> {
  return getValue<T>(`stale:${key}`);
}
