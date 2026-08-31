import { NextRequest, NextResponse } from 'next/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { resolveWorkspaceMembershipForUser, type MinimalSupabaseClient } from '@/app/api/_utils/workspace';
import { createAdminClient } from '@/lib/supabase/server';
import { isWorkspaceStormMapsActive } from '@/lib/storm-maps/addon';
import { providerForLayer, STORM_RASTER_CATALOG } from '@/lib/storm-maps/catalog';
import { issueStormMapsTileToken } from '@/lib/storm-maps/token';
import { getEcccRadarFrameTimes } from '@/lib/storm-maps/providers';
import type { StormMapsManifest, StormRasterLayer, StormRasterLayerId } from '@/lib/storm-maps/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function roundedDate(now: number, minutes: number, offsetMinutes = 0) {
  const date = new Date(now + offsetMinutes * 60_000);
  date.setUTCSeconds(0, 0);
  date.setUTCMinutes(Math.floor(date.getUTCMinutes() / minutes) * minutes);
  return date;
}

function radarProviderForCenter(lat: number, lon: number): 'iem' | 'eccc' {
  const likelyCanadaOrNorthernCoverage = lat >= 49
    || (lat >= 48 && lon <= -122)
    || (lat >= 41.5 && lon >= -85 && lon <= -74)
    || (lat >= 43 && lon >= -79);
  return likelyCanadaOrNorthernCoverage ? 'eccc' : 'iem';
}

function radarFrames(provider: 'iem' | 'eccc', now: number, ecccTimes: string[] = []) {
  if (provider === 'iem') {
    const current = roundedDate(now, 5, -5);
    return Array.from({ length: 12 }, (_, index) => {
      const minutesAgo = (11 - index) * 5;
      const time = new Date(current.getTime() - minutesAgo * 60_000);
      return {
        key: minutesAgo === 0 ? 'now' : `m${String(minutesAgo).padStart(2, '0')}m`,
        time: minutesAgo === 0 ? 'now' : `m${String(minutesAgo).padStart(2, '0')}m`,
        label: time.toISOString(),
      };
    });
  }

  if (ecccTimes.length > 0) return ecccTimes.map((time) => ({ key: time, time, label: time }));
  const current = roundedDate(now, 6, -6);
  return Array.from({ length: 11 }, (_, index) => {
    const minutesAgo = (10 - index) * 6;
    const time = new Date(current.getTime() - minutesAgo * 60_000).toISOString();
    return { key: time, time, label: time };
  });
}

function forecastFrames(layerId: StormRasterLayerId, now: number) {
  const start = roundedDate(now, 60);
  const offsets = layerId.startsWith('accumulation') ? [0] : [0, 1, 3, 6, 12, 24];
  return offsets.map((hours) => {
    const time = layerId.startsWith('accumulation')
      ? new Date(start.getTime() + hours * 60 * 60 * 1000).toISOString().replace('.000Z', 'Z')
      : hours === 0
        ? 'now'
        : new Date(start.getTime() + hours * 60 * 60 * 1000).toISOString().replace('.000Z', 'Z');
    return { key: time, time, label: hours === 0 ? 'Now' : `+${hours}h` };
  });
}

export async function GET(request: NextRequest) {
  const user = await resolveUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const workspaceId = request.nextUrl.searchParams.get('workspaceId');
  if (!workspaceId) return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 });

  const admin = createAdminClient();
  const membership = await resolveWorkspaceMembershipForUser(
    admin as unknown as MinimalSupabaseClient,
    user.id,
    workspaceId,
  );
  if (!membership.workspaceId) {
    return NextResponse.json({ error: membership.error || 'Workspace not found' }, { status: membership.status || 403 });
  }
  if (!(await isWorkspaceStormMapsActive(admin, membership.workspaceId))) {
    return NextResponse.json({ error: 'Storm Maps add-on is not active' }, { status: 403 });
  }

  const lat = Number.parseFloat(request.nextUrl.searchParams.get('lat') || '43.65');
  const lon = Number.parseFloat(request.nextUrl.searchParams.get('lon') || '-79.35');
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ error: 'lat and lon must be valid coordinates' }, { status: 400 });
  }

  const radarProvider = radarProviderForCenter(lat, lon);
  const generatedAt = Date.now();
  const ecccTimes = radarProvider === 'eccc' ? await getEcccRadarFrameTimes() : [];
  const tomorrowConfigured = Boolean(process.env.TOMORROW_IO_API_KEY);
  const layers = Object.values(STORM_RASTER_CATALOG).map((entry): StormRasterLayer => {
    const provider = providerForLayer(entry.id, radarProvider);
    const available = provider !== 'tomorrow' || tomorrowConfigured;
    return {
      id: entry.id,
      label: entry.label,
      description: entry.description,
      unit: entry.id === 'radar' && radarProvider === 'eccc' ? 'mm/h' : entry.unit,
      group: entry.group,
      premium: entry.premium,
      coverageLabel: entry.coverageLabel,
      legend: entry.legend,
      provider,
      available,
      unavailableReason: available ? undefined : 'Tomorrow.io production credentials are not configured.',
      frames: entry.id === 'radar'
        ? radarFrames(radarProvider, generatedAt, ecccTimes)
        : provider === 'iem'
          ? [{ key: 'now', time: 'now', label: 'Now' }]
          : forecastFrames(entry.id, generatedAt),
    };
  });

  const approvedTiles = layers.flatMap((layer) => layer.frames.map((frame) => `${layer.provider}:${layer.id}:${frame.time}`));
  const issued = issueStormMapsTileToken(membership.workspaceId, approvedTiles, generatedAt);
  const payload: StormMapsManifest = {
    enabled: true,
    generatedAt: new Date(generatedAt).toISOString(),
    expiresAt: issued.expiresAt,
    tileToken: issued.token,
    radarProvider,
    layers,
    featureEndpoint: '/api/storm-maps/features',
    providerHealth: {
      tomorrow: { available: tomorrowConfigured, status: tomorrowConfigured ? 'ready' : 'unconfigured' },
      iem: { available: true, status: 'ready' },
      eccc: { available: true, status: 'ready' },
    },
    attribution: [
      { label: 'Tomorrow.io', url: 'https://www.tomorrow.io/' },
      { label: 'NOAA/NWS', url: 'https://www.weather.gov/' },
      { label: 'Iowa Environmental Mesonet', url: 'https://mesonet.agron.iastate.edu/' },
      { label: 'ECCC/MSC', url: 'https://weather.gc.ca/' },
    ],
    disclaimer: 'Beta weather visualization—follow official authorities for safety decisions.',
  };

  return NextResponse.json(payload, { headers: { 'Cache-Control': 'private, no-store' } });
}
